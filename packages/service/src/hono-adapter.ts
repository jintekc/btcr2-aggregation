import type { HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import {
  formatSseComment,
  formatSseEvent,
  type AggregationServiceRunner,
  type HttpRequestLike,
  type HttpServerTransport,
  type SseStream,
} from '@did-btcr2/aggregation/service';
import {
  DEFAULT_NETWORK,
  resolveNetwork,
  toNetworkConfigDTO,
  type NetworkConfig,
  type NetworkName,
} from '@btcr2-aggregation/shared';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { bridgeRunnerToSse } from './dashboard-sse.js';
import {
  loginHandler,
  logoutHandler,
  requireOperator,
  requireSameOrigin,
  sessionProbeHandler,
  type OperatorAuthConfig,
} from './operator-auth.js';
import type { DraftInput, OperatorCohorts } from './operator-cohorts.js';
import { mountStaticSite } from './static-site.js';
import { mountArtifactRoutes, type ArtifactStore } from './store.js';
import { resolveBtcr2 } from './resolve.js';
import { validatePinRequest, type IpfsNode, type PinOutcome } from './ipfs.js';
import type { Sidecar } from '@did-btcr2/method';
import type { BeaconBroadcaster } from './broadcast.js';

type Env = { Bindings: HttpBindings };

const DEBUG = process.env.SSE_DEBUG === '1';
function dbg(msg: string): void {
  if (DEBUG) {
    console.error(`[adapter] ${msg}`);
  }
}

/** Collect a Hono request's headers into a lowercased-key record (per HttpRequestLike). */
function lowercaseHeaders(c: Context<Env>): Record<string, string> {
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

/** Map a Hono context to the transport's framework-agnostic request shape. */
async function toRequestLike(c: Context<Env>): Promise<HttpRequestLike> {
  const method = c.req.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return {
    method,
    url: c.req.url,
    headers: lowercaseHeaders(c),
    body: hasBody ? await c.req.text() : undefined,
    remoteAddr: c.env.incoming.socket?.remoteAddress,
  };
}

/**
 * Hijack the raw Node response for an SSE GET. `@hono/node-server` exposes the
 * underlying ServerResponse on `c.env.outgoing`; we write `event:/data:/id:` and
 * comment frames straight to it (formatted exactly as the client's SSE parser
 * expects). Returns the {@link SseStream} handle; the caller wires the producer.
 */
function openRawSse(c: Context<Env>): SseStream {
  const res = c.env.outgoing;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  return {
    writeEvent(event, data, id) {
      dbg(`SSE write event=${event} id=${id ?? '-'} bytes=${data.length} on ${c.req.url}`);
      res.write(formatSseEvent(event, data, id));
    },
    writeComment(comment) {
      res.write(formatSseComment(comment));
    },
    close() {
      res.end();
    },
    onClose(cb) {
      res.on('close', cb);
    },
  };
}

/** Open an SSE stream backed by the protocol transport (adverts / inbox). */
function openTransportSse(c: Context<Env>, transport: HttpServerTransport): Response {
  const stream = openRawSse(c);
  const reqLike: HttpRequestLike = {
    method: c.req.method,
    url: c.req.url,
    headers: lowercaseHeaders(c),
    remoteAddr: c.env.incoming.socket?.remoteAddress,
  };
  transport.handleSse(reqLike, stream);
  return RESPONSE_ALREADY_SENT;
}

/** Optional features layered onto the protocol transport by {@link createHonoApp}. */
export interface HonoAppOptions {
  /** Runner whose lifecycle events stream to the read-only dashboard SSE route. */
  runner?: AggregationServiceRunner;
  /** Absolute path to the built web SPA; serves the same-origin production topology. */
  webDistDir?: string;
  /** Content-addressed artifact store backing the read-only `GET /cas/*` routes. */
  store?: ArtifactStore;
  /**
   * Beacon-tx broadcast emitter (live broadcasting only). Its lifecycle events are
   * forwarded on the dashboard SSE route so the dashboard shows "anchored on-chain".
   */
  broadcaster?: BeaconBroadcaster;
  /** Network config used to derive the anchored tx's block-explorer URL. */
  network?: NetworkConfig;
  /**
   * The Bitcoin network name this coordinator targets, served on `GET /v1/config`
   * so the browser derives its addresses/DIDs at runtime instead of from the
   * build-time {@link DEFAULT_NETWORK}. Always available (unlike {@link network},
   * which is live-only), so the config route is unconditional. Defaults to
   * {@link DEFAULT_NETWORK}.
   */
  networkName?: NetworkName;
  /**
   * Bitcoin REST (esplora) connection. When supplied together with {@link store},
   * a read-only `GET /resolve/:did` route resolves a did:btcr2 identifier
   * server-side (discovering beacon signals over this connection, fetching off-chain
   * artifacts from the store). Server-driven so the browser never bundles the
   * resolver's `level`/`classic-level` dependencies.
   */
  bitcoin?: BitcoinConnection;
  /**
   * Opt-in IPFS pinning node (ADR 0011). When supplied, `GET /v1/ipfs` reports it
   * as enabled with its dialable multiaddrs, and `POST /v1/ipfs/pin` pins a
   * publish plan's digests (sourcing bytes from {@link store} when the digest
   * verifies, else over bitswap from the connected publisher). The probe route is
   * mounted unconditionally so the browser can cheaply discover availability.
   */
  ipfs?: IpfsNode;
  /**
   * Operator authentication (HOST-01, ADR 0015). When present, the operator surface is
   * mounted: the public `POST /v1/operator/login`, the session guard on both the
   * `/v1/operator/*` and `/dashboard/*` prefixes, and the gated
   * `POST /v1/operator/logout` + `GET /v1/operator/session` routes; the runner's
   * `/dashboard/events` telemetry feed is gated too (mounted only when a runner AND
   * operator auth are both present). When ABSENT, none of that mounts - the
   * fail-closed default (D-07): a service booted without an operator password exposes
   * no operator/mutating routes and no gated telemetry at all, while the public
   * participant surface still serves.
   */
  operatorAuth?: OperatorAuthConfig;
  /**
   * Operator on-demand cohort drafts (SVC-01). When present ALONGSIDE
   * {@link operatorAuth}, the gated `POST/GET/DELETE /v1/operator/cohorts` routes are
   * mounted so an authenticated operator can create, list, and discard cohort drafts.
   * Inert without {@link operatorAuth} (the routes only mount inside the auth block, so
   * they always inherit the session guard - never an unauthenticated mutating surface).
   */
  operatorCohorts?: OperatorCohorts;
}

/**
 * Mount {@link HttpServerTransport} under Hono. Non-SSE routes pass through
 * `handleRequest` and return a standard `Response`; the two protocol SSE GET routes
 * hijack the raw Node response and stream transport-driven events. When a `runner`
 * is supplied, a read-only `GET /dashboard/events` SSE route streams the runner's
 * lifecycle events to a browser dashboard (demo telemetry; kept out of the signed
 * protocol surface). When a `store` is supplied, read-only `GET /cas/*` routes serve
 * the off-chain resolution artifacts by hex hash. When `webDistDir` is supplied, the
 * built web SPA is served from that directory as a trailing catch-all, giving the
 * same-origin production topology (one server hosts the app, the protocol, the
 * dashboard, and the artifact store, no CORS, no Vite proxy).
 */
export function createHonoApp(
  transport: HttpServerTransport,
  opts: HonoAppOptions = {},
): Hono<Env> {
  const {
    runner,
    webDistDir,
    store,
    broadcaster,
    network,
    networkName,
    bitcoin,
    ipfs,
    operatorAuth,
    operatorCohorts,
  } = opts;
  const app = new Hono<Env>();

  // Precompute the served network DTO once at construction (resolveNetwork throws on
  // an unknown name, so an operator misconfiguration fails fast at boot rather than
  // per-request). Defaults to the app default when no name is threaded in (tests, the
  // headless path).
  const networkDto = toNetworkConfigDTO(resolveNetwork(networkName ?? DEFAULT_NETWORK));

  const handle = async (c: Context<Env>): Promise<Response> => {
    const reqLike = await toRequestLike(c);
    const r = await transport.handleRequest(reqLike);
    dbg(`${c.req.method} ${new URL(c.req.url).pathname} -> ${r.status}`);
    return new Response(r.body, { status: r.status, headers: r.headers });
  };

  app.post('/v1/messages', handle);
  app.post('/v1/adverts', handle);
  app.get('/v1/adverts', (c) => {
    dbg(`SSE open GET ${new URL(c.req.url).pathname}`);
    return openTransportSse(c, transport);
  });
  app.get('/v1/actors/:did/inbox', (c) => {
    dbg(`SSE open GET ${new URL(c.req.url).pathname}`);
    return openTransportSse(c, transport);
  });
  app.get('/v1/.well-known/aggregation', handle);

  // Runtime network config for the browser. Read-only, unauthenticated, and always
  // mounted (no store/bitcoin/live dependency) so the same-origin SPA can fetch the
  // coordinator's Bitcoin network on load and derive its addresses/DIDs from it,
  // rather than baking DEFAULT_NETWORK in at build time. Only the JSON-safe DTO is
  // returned (the client rebuilds the full config via `resolveNetwork(network)`).
  app.get('/v1/config', (c) => c.json(networkDto));

  // Public cohort directory + service status (SVC-02, D-09/D-14/D-15). Always mounted
  // (like /v1/config, OUTSIDE the operator-auth block): the anonymous participant
  // surface browses the open cohorts and reads a truthful open-count with no session.
  // Both derive from the live advertised set via `operatorCohorts`. When no operator
  // surface is configured (fail-closed boot, no OPERATOR_PASSWORD) there is nothing to
  // advertise, so they return an empty directory / zero open count rather than 500 -
  // the anonymous surface always gets a sane answer.
  app.get('/v1/directory', (c) => c.json(operatorCohorts ? operatorCohorts.directory() : []));
  app.get('/v1/status', (c) =>
    c.json(
      operatorCohorts
        ? operatorCohorts.status()
        : { up: true as const, network: networkName ?? DEFAULT_NETWORK, openCohorts: 0 },
    ),
  );

  // IPFS publish surface (ADR 0011). The probe is unconditional (mirrors
  // /v1/config) so the SPA can discover availability with one same-origin fetch;
  // the pin route exists only when a node is actually running.
  app.get('/v1/ipfs', (c) =>
    c.json(
      ipfs
        ? { enabled: true as const, peerId: ipfs.peerId, multiaddrs: ipfs.multiaddrs() }
        : { enabled: false as const },
    ),
  );
  if (ipfs) {
    app.post(
      '/v1/ipfs/pin',
      // A pin request is at most MAX_PIN_REQUEST 64-char digests; 4 KiB is ample
      // and bounds the unauthenticated body during streaming.
      bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
      async (c) => {
        let body: unknown;
        try {
          body = await c.req.json();
        } catch {
          return c.json({ error: 'expected a JSON body { hashes: string[] }' }, 400);
        }
        const validated = validatePinRequest(body);
        if ('problem' in validated) {
          return c.json({ error: validated.problem }, 400);
        }
        // Sequential on purpose: a publish plan is tiny (<= MAX_PIN_REQUEST) and
        // one bitswap session at a time keeps the fetch path simple to reason
        // about. Per-hash failures land in the outcome, not an HTTP error.
        const results: PinOutcome[] = [];
        for (const hash of validated.hashes) {
          results.push(await ipfs.pin(hash, store));
        }
        return c.json({ results });
      },
    );
  }

  // Operator surface (HOST-01, ADR 0015). Mounted ONLY when operator auth is
  // configured (fail-closed, D-07): a service booted without an OPERATOR_PASSWORD
  // exposes no operator/mutating routes and no gated telemetry at all. Registration
  // order is load-bearing (Hono matches in order, RESEARCH Pitfall 3): the public
  // login POST and the same-origin CSRF guard come first, THEN the session guard on
  // each gated prefix, THEN the gated routes - so the guard can never sit behind a
  // route it is meant to protect. Login stays OUTSIDE requireOperator (it is how a
  // session is obtained) but still gets the same-origin CSRF check.
  if (operatorAuth) {
    app.use('/v1/operator/*', requireSameOrigin());
    app.post(
      '/v1/operator/login',
      // Bound the unauthenticated login body before it is parsed (a password JSON is
      // tiny; 4 KiB is ample). Mirrors the /v1/ipfs/pin body limit.
      bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
      loginHandler(operatorAuth),
    );
    app.use('/v1/operator/*', requireOperator(operatorAuth.sessions));
    app.use('/dashboard/*', requireOperator(operatorAuth.sessions));
    app.post('/v1/operator/logout', logoutHandler(operatorAuth.sessions));
    app.get('/v1/operator/session', sessionProbeHandler());

    // On-demand cohort drafts (SVC-01). Registered AFTER the requireSameOrigin +
    // requireOperator prefix guards above, so every create/list/discard inherits both
    // the session gate (T-02-01) and the CSRF check on the mutating verbs (T-02-03).
    // Only mounted when the operator supplied a cohort surface; absent, the operator
    // console still authenticates but exposes no cohort routes.
    if (operatorCohorts) {
      app.post(
        '/v1/operator/cohorts',
        // A create body is a tiny `{ beaconType, size }`; 4 KiB bounds
        // it during streaming before c.req.json() buffers it (T-02-02). Mirrors the
        // login / ipfs-pin body limits.
        bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
        async (c) => {
          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return c.json({ error: 'expected a JSON body { beaconType, size }' }, 400);
          }
          try {
            // validateDraft throws a user-facing message on invalid input; surface it
            // verbatim as the 400 body (the two numeric messages are the UI-SPEC copy).
            const dto = operatorCohorts.createDraft(body as DraftInput);
            return c.json(dto, 201);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 400);
          }
        },
      );
      app.get('/v1/operator/cohorts', (c) => c.json({ cohorts: operatorCohorts.listCohorts() }));
      app.delete('/v1/operator/cohorts/:id', (c) => {
        const ok = operatorCohorts.discardDraft(c.req.param('id'));
        return ok ? c.json({ ok: true }) : c.json({ error: 'unknown draft' }, 404);
      });
      // Advertise a draft (SVC-02). Inherits the requireSameOrigin + requireOperator
      // prefix guards above, so it is a session-gated, CSRF-checked mutating action
      // (T-03-01/T-03-03). `advertiseDraft` is the SOLE `runner.advertiseCohort` caller
      // now (D-17); an unknown draft id -> 404 (already-advertised ids are gone from the
      // drafts map, so they read as unknown too).
      app.post('/v1/operator/cohorts/:id/advertise', (c) => {
        const dto = operatorCohorts.advertiseDraft(c.req.param('id'));
        return dto ? c.json(dto) : c.json({ error: 'unknown draft' }, 404);
      });
    }
  }

  // Live telemetry feed. Gated (D-08): mounted only when a runner AND operator auth
  // are both present, so it inherits the `/dashboard/*` guard registered above. The
  // browser `EventSource` sends the httpOnly session cookie automatically, so no SSE
  // transport change is needed - the guard runs before this handler.
  if (runner && operatorAuth) {
    app.get('/dashboard/events', (c) => {
      dbg('SSE open GET /dashboard/events');
      const stream = openRawSse(c);
      bridgeRunnerToSse(runner, stream, { broadcaster, network });
      return RESPONSE_ALREADY_SENT;
    });
  }

  // Read-only artifact routes after the protocol/dashboard routes, before the SPA.
  if (store) {
    mountArtifactRoutes(app, store);
  }

  // Read-only server-driven resolve route. Needs both a Bitcoin connection (to
  // discover beacon signals) and the artifact store (to serve off-chain artifacts).
  // Registered before the SPA catch-all so a valid `did:btcr2:...` segment resolves
  // rather than falling through to index.html.
  if (bitcoin && store) {
    // Shared resolution + error handling. The suffix after `did:btcr2:` is bech32m
    // (lowercase alphanumeric); guard the shape before the resolver so malformed input
    // is a cheap 400 that never reaches (nor leaks the internals of) the DID parser. A
    // 502 (not 500) on failure: the fault is upstream (the chain or the artifact
    // source), not the route; the detail is logged server-side and a generic message
    // is returned so resolver internals are not disclosed to an untrusted caller.
    const resolveResult = async (
      did: string,
      sidecar?: Sidecar,
    ): Promise<{ status: 200 | 400 | 502; body: object }> => {
      if (!/^did:btcr2:[a-z0-9]+$/.test(did)) {
        return { status: 400, body: { error: 'not a valid did:btcr2 identifier' } };
      }
      try {
        const { didDocument, metadata } = await resolveBtcr2(did, { bitcoin, store, sidecar });
        return { status: 200, body: { didDocument, didDocumentMetadata: metadata } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[resolve] ${did} failed: ${message}`);
        return { status: 502, body: { error: 'resolution failed' } };
      }
    };

    // KEY (k1): the genesis is deterministic from the DID, so no sidecar is needed.
    app.get('/resolve/:did', async (c) => {
      const { status, body } = await resolveResult(c.req.param('did'));
      return c.json(body, status);
    });

    // EXTERNAL (x1): the DID is only a hash commitment to its genesis, which the
    // coordinator does not hold, so the controller supplies it in-band - exactly as it
    // does on the aggregation opt-in (ADR 066). The resolver re-verifies that the
    // supplied genesis hashes to the DID, so an untrusted body cannot forge a
    // resolution; the body is bounded before it is parsed (a real genesis is ~1 KB).
    app.post(
      '/resolve/:did',
      bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
      async (c) => {
        const did = c.req.param('did');
        let genesisDocument: unknown;
        try {
          ({ genesisDocument } = await c.req.json<{ genesisDocument?: unknown }>());
        } catch {
          return c.json({ error: 'expected a JSON body { genesisDocument }' }, 400);
        }
        const sidecar =
          genesisDocument && typeof genesisDocument === 'object'
            ? ({ genesisDocument } as Sidecar)
            : undefined;
        const { status, body } = await resolveResult(did, sidecar);
        return c.json(body, status);
      },
    );
  }

  // Same-origin Bitcoin tx proxy for the browser's first-update singleton-beacon
  // registration. The controller SIGNS the OP_RETURN spend in the browser (their
  // key never leaves the client); the proxy only reads UTXOs and relays the raw
  // signed tx to esplora. Server-side so the browser stays same-origin (no reliance
  // on an esplora host's CORS, which varies by network) and never bundles a Bitcoin
  // client. Mounted whenever a connection is present; the offline default answers
  // "no funds" and refuses to broadcast, so registration is correctly live-only.
  if (bitcoin) {
    app.get('/v1/tx/utxos/:address', async (c) => {
      const address = c.req.param('address');
      // Cheap shape guard before hitting esplora: a Bitcoin address is base58 or
      // bech32(m), so alnum-only bounded length. This also neutralizes any path
      // injection into the esplora URL (no '/', '.', '..').
      if (!/^[a-zA-Z0-9]{8,100}$/.test(address)) {
        return c.json({ error: 'invalid address' }, 400);
      }
      try {
        const utxos = await bitcoin.rest.address.getUtxos(address);
        return c.json(utxos);
      } catch (err) {
        console.error(`[tx] utxos ${address} failed: ${err instanceof Error ? err.message : String(err)}`);
        return c.json({ error: 'utxo lookup failed' }, 502);
      }
    });

    app.post(
      '/v1/tx/broadcast',
      // Reject an oversized body DURING streaming, before it is buffered by
      // c.req.json(): a raw tx is at most a few hundred kB of hex, so 512 kB is
      // ample. Without this the post-parse `rawHex.length` cap gives no memory
      // protection against an unauthenticated large-body flood.
      bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
      async (c) => {
        let rawHex: unknown;
        try {
          ({ rawHex } = await c.req.json<{ rawHex?: unknown }>());
        } catch {
          return c.json({ error: 'expected a JSON body { rawHex }' }, 400);
        }
        // A raw tx is even-length hex; bound the length so an oversized body cannot
        // be relayed. 200 kB of hex covers any standard tx (bodyLimit above already
        // rejects a large body during streaming; this bounds what reaches esplora).
        if (typeof rawHex !== 'string' || rawHex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(rawHex) || rawHex.length > 400_000) {
          return c.json({ error: 'rawHex must be an even-length hex string' }, 400);
        }
        try {
          const txid = await bitcoin.rest.transaction.send(rawHex.toLowerCase());
          return c.json({ txid });
        } catch (err) {
          // Broadcast rejection (bad tx, insufficient fee, offline connection) is an
          // upstream failure; surface a generic 502 and log the detail server-side.
          console.error(`[tx] broadcast failed: ${err instanceof Error ? err.message : String(err)}`);
          return c.json({ error: 'broadcast failed' }, 502);
        }
      },
    );
  }

  // Static site last so it only catches paths the other routes did not.
  if (webDistDir) {
    mountStaticSite(app, webDistDir);
  }

  return app;
}
