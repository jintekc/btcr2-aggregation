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
import type { NetworkConfig } from '@btcr2-aggregation/shared';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { bridgeRunnerToSse } from './dashboard-sse.js';
import { mountStaticSite } from './static-site.js';
import { mountArtifactRoutes, type ArtifactStore } from './store.js';
import { resolveBtcr2 } from './resolve.js';
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
   * Bitcoin REST (esplora) connection. When supplied together with {@link store},
   * a read-only `GET /resolve/:did` route resolves a did:btcr2 identifier
   * server-side (discovering beacon signals over this connection, fetching off-chain
   * artifacts from the store). Server-driven so the browser never bundles the
   * resolver's `level`/`classic-level` dependencies.
   */
  bitcoin?: BitcoinConnection;
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
  const { runner, webDistDir, store, broadcaster, network, bitcoin } = opts;
  const app = new Hono<Env>();

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

  if (runner) {
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
