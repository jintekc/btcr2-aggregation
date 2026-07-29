import type { HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import {
  formatSseComment,
  formatSseEvent,
  type HttpRequestLike,
  type HttpServerTransport,
  type SseStream,
} from '@did-btcr2/aggregation/service';
import {
  DEFAULT_NETWORK,
  resolveNetwork,
  toNetworkConfigDTO,
  type NetworkName,
} from '@btcr2-aggregation/shared';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import {
  loginHandler,
  logoutHandler,
  requireOperator,
  requireSameOrigin,
  sessionProbeHandler,
  type OperatorAuthConfig,
} from './operator-auth.js';
import {
  ADVERTISING_PAUSED_REASON,
  isAdvertisePaused,
  NOT_SIGNING_REASON,
  type DraftInput,
  type OperatorCohorts,
} from './operator-cohorts.js';
import type { RuntimeSettings, SettingsPatch } from './runtime-settings.js';
import type { AnchorState } from './anchor-state.js';
import { BROADCAST_DISABLED_TEXT, type CohortMonitor } from './monitor.js';
import { mountStaticSite } from './static-site.js';
import { mountArtifactRoutes, type ArtifactStore } from './store.js';
import { resolveBtcr2, UnconfirmedSignalError } from './resolve.js';
import { validatePinRequest, type IpfsNode, type PinOutcome } from './ipfs.js';
import type { Sidecar } from '@did-btcr2/method';

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
  /** Absolute path to the built web SPA; serves the same-origin production topology. */
  webDistDir?: string;
  /** Content-addressed artifact store backing the read-only `GET /cas/*` routes. */
  store?: ArtifactStore;
  /**
   * The Bitcoin network name this coordinator targets, served on `GET /v1/config`
   * so the browser derives its addresses/DIDs at runtime instead of from the
   * build-time {@link DEFAULT_NETWORK}. Always available (unlike {@link network},
   * which is live-only), so the config route is unconditional. Defaults to
   * {@link DEFAULT_NETWORK}.
   */
  networkName?: NetworkName;
  /**
   * Optional operator-supplied service display name (D-51), a boot-time env constant
   * (`SERVICE_NAME`) surfaced on `GET /v1/config` beside the network so the operator console
   * health strip and the public directory header can label the service. Additive and optional:
   * when unset the config DTO is byte-identical (no `serviceName` key), so the frozen public
   * network fields never change. It is display text only, never markup or a URL (the browser
   * renders it as auto-escaped React text content, T-04-03-01).
   *
   * Superseded by {@link runtimeSettings} when one is threaded in (Phase 5 D-16 makes the name
   * runtime-editable): this static option remains the fallback for callers that wire no holder
   * (the headless path and the older specs), so its behavior is unchanged for them.
   */
  serviceName?: string;
  /**
   * Per-service runtime settings holder (SVC-04, D-08/D-12/D-16). When present it is the
   * PER-REQUEST source of truth for the service display name on `GET /v1/config`, so an
   * operator's runtime rename is reflected on the very next request instead of being frozen
   * into this app's construction closure. It also backs the gated
   * `POST /v1/operator/advertising/pause` + `/resume` routes and the `paused` bit on the
   * no-operator-surface `GET /v1/status` fallback. Optional: a caller that omits it keeps the
   * pre-existing behavior exactly (a never-paused service whose name is the static option above).
   */
  runtimeSettings?: RuntimeSettings;
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
   * mounted: the public `POST /v1/operator/login`, the session guard on the
   * `/v1/operator/*` prefix, and the gated `POST /v1/operator/logout` +
   * `GET /v1/operator/session` routes (plus the gated cohort + monitoring reads when
   * their surfaces are supplied). When ABSENT, none of that mounts - the fail-closed
   * default (D-07): a service booted without an operator password exposes no
   * operator/mutating routes and no gated monitoring at all, while the public
   * participant surface still serves. The retired dashboard-SSE telemetry feed
   * (`/dashboard/events`) is gone - the operator's live view is now the gated,
   * polled monitoring reads (D-02/D-19).
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
  /**
   * Retained anchor state backing the PUBLIC `GET /v1/anchor/:cohortId` read (PART-04,
   * D-20/D-21). Present only when this service broadcasts on-chain (a broadcaster is
   * wired); when absent, the route still mounts and answers the fail-open
   * `{ enabled: false, state: 'none' }` (mode honesty, mirrors `/v1/directory`'s empty
   * default). Anchor facts are public chain data, so the route is anonymous - it does
   * NOT weaken the operator-gated telemetry (ADR 0015); it is mounted OUTSIDE the
   * operator-auth block beside `/v1/directory` and `/v1/ipfs`.
   */
  anchorState?: AnchorState;
  /**
   * Per-service cohort monitoring fold backing the GATED `GET /v1/operator/cohorts/:id`
   * detail read (SVC-03, D-19/D-26). Present alongside {@link operatorCohorts}; the route
   * is registered INSIDE the operatorAuth block after `requireOperator`, so an anonymous
   * caller is rejected with 401 BEFORE any cohort-id lookup (no existence oracle,
   * T-04-01-01). Absent, the route answers the non-oracle `{ exists: false }` default.
   */
  monitor?: CohortMonitor;
}

/**
 * Mount {@link HttpServerTransport} under Hono. Non-SSE routes pass through
 * `handleRequest` and return a standard `Response`; the two protocol SSE GET routes
 * hijack the raw Node response and stream transport-driven events. When a `store` is
 * supplied, read-only `GET /cas/*` routes serve the off-chain resolution artifacts by
 * hex hash. When `webDistDir` is supplied, the built web SPA is served from that
 * directory as a trailing catch-all, giving the same-origin production topology (one
 * server hosts the app, the protocol, and the artifact store, no CORS, no Vite proxy).
 * The operator's live cohort view is served by the gated, polled monitoring reads (the
 * booth-era `/dashboard/events` SSE telemetry feed was retired, D-02/D-19).
 */
export function createHonoApp(
  transport: HttpServerTransport,
  opts: HonoAppOptions = {},
): Hono<Env> {
  const {
    webDistDir,
    store,
    networkName,
    serviceName,
    runtimeSettings,
    bitcoin,
    ipfs,
    operatorAuth,
    operatorCohorts,
    anchorState,
    monitor,
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
  // The optional service name rides ADDITIVELY on the config DTO: included only when the
  // operator set SERVICE_NAME, so the browser reads it at load, and the frozen network fields
  // (network/label/isMainnet) stay byte-identical when it is unset (D-51/D-26; config.spec pin).
  //
  // Read PER REQUEST from the runtime holder when one is wired (Phase 5 D-16): the name is now
  // runtime-editable, and a value captured into this construction closure would serve the boot
  // name forever while the console claimed the rename had applied. Without a holder this falls
  // back to the static boot option, so the pre-Phase-5 behavior is unchanged.
  //
  // The participation terms (SVC-05, D-19) ride the SAME per-request read as a SECOND additive
  // key. They belong here rather than on a new route because the participant who must accept them
  // is anonymous and already fetches this on load, and because the operator publishing terms is
  // publishing them: there is nothing gated about the text a stranger is asked to agree to. Unset
  // terms mean the join flow has NO terms step, so the key is ABSENT rather than an empty string -
  // "this operator set no terms" and "this operator set terms that say nothing" are different
  // facts and the wire must keep them apart. Both strings render in the browser as plain
  // auto-escaped React text content, never markup and never a link target (T-05-07-02).
  app.get('/v1/config', (c) => {
    const name = runtimeSettings ? runtimeSettings.serviceName.value : serviceName;
    const termsText = runtimeSettings?.termsText.value;
    return c.json({
      ...networkDto,
      ...(name ? { serviceName: name } : {}),
      ...(termsText ? { termsText } : {}),
    });
  });

  // Public cohort directory + service status (SVC-02, D-09/D-14/D-15). Always mounted
  // (like /v1/config, OUTSIDE the operator-auth block): the anonymous participant
  // surface browses the open cohorts and reads a truthful open-count with no session.
  // Both derive from the live advertised set via `operatorCohorts`. When no operator
  // surface is configured (fail-closed boot, no OPERATOR_PASSWORD) there is nothing to
  // advertise, so they return an empty directory / zero open count rather than 500 -
  // the anonymous surface always gets a sane answer.
  app.get('/v1/directory', (c) => c.json(operatorCohorts ? operatorCohorts.directory() : []));
  // The no-operator-surface fallback carries the SAME key set as the real status (including the
  // `paused` bit, SVC-04 D-07): a headless client parses one shape regardless of how the service
  // booted. A service with no operator surface has nothing to advertise and no way to pause, so
  // it reports the honest `false` unless a runtime holder says otherwise.
  app.get('/v1/status', (c) =>
    c.json(
      operatorCohorts
        ? operatorCohorts.status()
        : {
            up: true as const,
            network: networkName ?? DEFAULT_NETWORK,
            openCohorts: 0,
            paused: runtimeSettings?.paused ?? false,
          },
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

  // Public anchor read (PART-04, D-20/D-21). Mounted here in the PUBLIC block beside
  // /v1/directory + /v1/ipfs and BEFORE the `if (operatorAuth)` gate: anchor facts are
  // public chain data (like /resolve + /cas), so a participant tracks their anchor with
  // no session, and this must NOT weaken the operator-gated surface (ADR 0015 - the
  // /v1/operator/* gating below is byte-untouched). Read-only, no body.
  // Guard the cohortId shape with a cheap 400 BEFORE any lookup, then return the retained
  // DTO. When no anchorState is wired (the hermetic default, no broadcaster) answer the
  // fail-open `{ enabled: false, state: 'none' }` - never a 500 - mirroring how
  // /v1/directory defaults to `[]`. An unknown cohortId reads as `{ state: 'none' }`
  // (never a 404), so never-existed and evicted are indistinguishable (no existence
  // oracle). The read never touches esplora: it serves last-known broadcaster state, so
  // an anonymous route can never drive chain I/O (DoS) nor break the hermetic default.
  app.get('/v1/anchor/:cohortId', (c) => {
    const cohortId = c.req.param('cohortId');
    if (!/^[0-9a-zA-Z-]{1,64}$/.test(cohortId)) {
      return c.json({ error: 'invalid cohort id' }, 400);
    }
    return c.json(anchorState ? anchorState.read(cohortId) : { enabled: false, state: 'none' });
  });

  // Public funding signal (D-44). Mounted here in the PUBLIC block beside /v1/anchor and
  // BEFORE the `if (operatorAuth)` gate: like the anchor read, it is anonymous by design so a
  // seated participant can poll whether a live cohort is still awaiting its operator's funding
  // with no session. It is a NEW, ADDITIVE sibling read - the frozen /v1/anchor + DirectoryCohortDTO
  // stay byte-untouched (D-26). Non-oracle: it returns ONLY `{ awaitingFunding }` (never an amount,
  // a key, or an existence oracle, T-04-07-01); an unknown/hermetic id reads `{ awaitingFunding: false }`.
  // Guard the `:cohortId` shape with the same cheap 400 as the anchor read BEFORE any lookup. When no
  // monitor is wired (hermetic default), answer the fail-open `false` rather than 500. The read serves
  // last-known funding-watch state and never drives chain I/O, so the anonymous route cannot be a DoS vector.
  app.get('/v1/funding/:cohortId', (c) => {
    const cohortId = c.req.param('cohortId');
    if (!/^[0-9a-zA-Z-]{1,64}$/.test(cohortId)) {
      return c.json({ error: 'invalid cohort id' }, 400);
    }
    return c.json(monitor ? monitor.publicFunding(cohortId) : { awaitingFunding: false });
  });

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
    app.post('/v1/operator/logout', logoutHandler(operatorAuth.sessions));
    app.get('/v1/operator/session', sessionProbeHandler());

    // Advertising drain mode (SVC-04, D-06/D-08). Registered inside the gated block AFTER the
    // requireSameOrigin + requireOperator prefix guards, so only an authenticated operator can
    // change whether this service offers new cohorts and an anonymous caller is rejected with
    // 401 before either handler runs (T-05-04-01). They mount on the runtime holder rather than
    // the cohort surface because the flag is a service-level fact: a service with no cohorts
    // can still be paused, and the state must outlive any individual cohort.
    //
    // Both are IDEMPOTENT and take no body: the operator is asking for an END STATE, not
    // toggling one, so a double-click or a retried request lands in the same place. Each
    // returns the resulting state so the console renders what the SERVICE reports rather than
    // what the browser assumed.
    if (runtimeSettings) {
      app.post('/v1/operator/advertising/pause', (c) => {
        runtimeSettings.pause();
        return c.json({ paused: runtimeSettings.paused });
      });
      app.post('/v1/operator/advertising/resume', (c) => {
        runtimeSettings.resume();
        return c.json({ paused: runtimeSettings.paused });
      });

      // The ONE-WAY broadcast kill switch (SVC-04, D-14). Registered inside the same gated block
      // after both prefix guards, so an anonymous caller is rejected with 401 before the handler
      // runs and only an authenticated operator can change this service's money-movement mode
      // (T-05-08-01).
      //
      // There is deliberately NO enable counterpart, here or anywhere: ADR 0010's layered
      // environment opt-in remains the sole path to broadcasting, so the worst an attacker holding
      // a session can do is stand this service DOWN (T-05-08-02). Idempotent and body-less like
      // the two advertising toggles, and it answers with the RESULTING state so the console
      // renders what the service reports rather than what the browser assumed.
      app.post('/v1/operator/broadcast/disable', (c) => {
        // Read BEFORE the call so the log entry fires only on the transition. The ring's
        // consecutive-duplicate guard would also catch a double-click, but this is the precise
        // answer: a repeat genuinely changed nothing, so there is nothing to record.
        const alreadyDisabled = runtimeSettings.broadcastDisabled;
        runtimeSettings.disableBroadcast();
        if (!alreadyDisabled) {
          monitor?.noteOperatorAction(BROADCAST_DISABLED_TEXT);
        }
        return c.json({ broadcastDisabled: runtimeSettings.broadcastDisabled });
      });

      // The service settings surface (SVC-04 criterion 3 / SVC-05, D-10/D-12/D-13/D-16/D-19).
      // Both verbs are registered INSIDE this gated block after `requireSameOrigin()` and
      // `requireOperator(...)`, so an anonymous caller is rejected with 401 before either handler
      // runs and before anything about this service's configuration is disclosed (T-05-07-01).
      // Only an authenticated operator may read or reshape what this running service offers.
      app.get('/v1/operator/settings', (c) => c.json(runtimeSettings.snapshot()));
      app.put(
        '/v1/operator/settings',
        // The SAME 4 KiB limit and 413 handler as every other gated write. It bounds the body
        // DURING streaming, before `c.req.json()` buffers it, and layers under the holder's own
        // explicit length caps on the two free-text fields (T-05-07-03): the terms are the one
        // field an operator could otherwise grow without limit, on a surface they can re-save.
        bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
        async (c) => {
          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return c.json({ error: 'expected a JSON settings body' }, 400);
          }
          // `applySettings` saves as a SET: it validates every supplied field first and applies
          // NONE on any failure (T-05-07-05), so this 400 leaves the service exactly as it was and
          // the console keeps rendering the previous served snapshot. The message is app-authored
          // UI-SPEC copy (shared byte-identically with the create form's validation), never a raw
          // library string.
          const problem = runtimeSettings.applySettings(body as SettingsPatch);
          if (problem) {
            return c.json({ error: problem }, 400);
          }
          // Answer with the NEW snapshot so the console re-renders from what the SERVICE reports
          // rather than from the patch the browser sent: a field the service normalized (an
          // emptied name, trimmed terms) must show as the service holds it, not as it was typed.
          return c.json(runtimeSettings.snapshot());
        },
      );
    }

    // On-demand cohort drafts (SVC-01). Registered AFTER the requireSameOrigin +
    // requireOperator prefix guards above, so every create/list/discard inherits both
    // the session gate (T-02-01) and the CSRF check on the mutating verbs (T-02-03).
    // Only mounted when the operator supplied a cohort surface; absent, the operator
    // console still authenticates but exposes no cohort routes.
    if (operatorCohorts) {
      app.post(
        '/v1/operator/cohorts',
        // A create body is a tiny `{ beaconType, size, threshold }`; 4 KiB bounds
        // it during streaming before c.req.json() buffers it (T-02-02). Mirrors the
        // login / ipfs-pin body limits.
        bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
        async (c) => {
          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return c.json({ error: 'expected a JSON body { beaconType, size, threshold }' }, 400);
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
      // The operator cohort-list read. `cohorts` is byte-identical to before (existing
      // consumers keep working); a NEW `monitoring` sibling key carries the summary chip
      // rows + service-level metrics from the fold (SVC-03, D-06), present only when a
      // monitor is wired. The public directory/status/anchor DTOs are untouched (D-26).
      //
      // `monitoring.health` is an ADDITIVE key on that same gated read (review CR-01, D-17/D-43):
      // {@link CohortMonitor.serviceHealth} already computed the honest broadcast mode + esplora
      // reachability, but NOTHING served it, so the console's health strip hardcoded 'Hermetic'
      // even on a service broadcasting real Bitcoin transactions. It rides the read the console
      // already polls rather than a second route, so the mode chip refreshes on the same tick as
      // the rows/metrics and no new gated surface is introduced.
      //
      // `defaults` is a second ADDITIVE key (Phase 5 D-11): this service's CURRENT cohort-timing
      // defaults, so the create form's `Leave it empty to use this service's default of {n} min.`
      // help can name a real number. A draft row carries its OWN captured defaults (the values as
      // they stood when it was created, which is what that draft will actually use), but a cohort
      // that does not exist yet has no row to read, and inventing the number or borrowing another
      // draft's stale capture would both be claims this service has not made.
      //
      // Read from the holder PER REQUEST, never captured into this closure: that is the D-16
      // lesson the service name learned the hard way, and 05-07 makes these values editable at
      // runtime, so a boot-time capture would serve the old number forever.
      app.get('/v1/operator/cohorts', (c) =>
        c.json({
          cohorts: operatorCohorts.listCohorts(),
          monitoring: monitor
            ? { rows: monitor.summary(), metrics: monitor.serviceMetrics(), health: monitor.serviceHealth() }
            : undefined,
          defaults: runtimeSettings
            ? {
                // Spread so an unset default is an ABSENT key rather than an explicit undefined,
                // keeping the wire shape additive and letting the client tell "no default" apart
                // from "a default of nothing".
                ...(runtimeSettings.defaultDiscoveryWindowMs.value !== undefined
                  ? { discoveryWindowMs: runtimeSettings.defaultDiscoveryWindowMs.value }
                  : {}),
                ...(runtimeSettings.defaultFundingWindowMs.value !== undefined
                  ? { fundingWindowMs: runtimeSettings.defaultFundingWindowMs.value }
                  : {}),
              }
            : undefined,
        }),
      );
      // Edit a DRAFT in place (SVC-04 criterion 3, D-10/D-13). The repository's FIRST PATCH route,
      // mounted with the same shape as the create POST above: the 4 KiB `bodyLimit` with its 413
      // handler (T-05-06-03) and the JSON-parse guard, both inside the gated block so the
      // requireSameOrigin CSRF check and the requireOperator session gate reject an anonymous
      // caller with 401 BEFORE any draft lookup (T-05-06-01).
      //
      // The `:id` shape guard runs before the lookup, exactly as on cancel/finalize. Then the
      // verdicts map straight through: `undefined` (not a draft: unknown, advertised, in flight,
      // or terminal) is 404, a thrown validation `Error` is 400 with its message as the body (the
      // same app-authored UI-SPEC copy the create route returns for the same input, never a raw
      // library string, T-05-06-02), and success is 200 with the updated DTO.
      app.patch(
        '/v1/operator/cohorts/:id',
        bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
        async (c) => {
          const id = c.req.param('id');
          if (!/^[0-9a-zA-Z-]{1,64}$/.test(id)) {
            return c.json({ error: 'invalid cohort id' }, 400);
          }
          let body: unknown;
          try {
            body = await c.req.json();
          } catch {
            return c.json({ error: 'expected a JSON body { beaconType, size, threshold }' }, 400);
          }
          try {
            const dto = operatorCohorts.updateDraft(id, body as DraftInput);
            return dto ? c.json(dto) : c.json({ error: 'unknown draft' }, 404);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 400);
          }
        },
      );
      app.delete('/v1/operator/cohorts/:id', (c) => {
        const ok = operatorCohorts.discardDraft(c.req.param('id'));
        return ok ? c.json({ ok: true }) : c.json({ error: 'unknown draft' }, 404);
      });
      // Advertise a draft (SVC-02). Inherits the requireSameOrigin + requireOperator
      // prefix guards above, so it is a session-gated, CSRF-checked mutating action
      // (T-03-01/T-03-03). `advertiseDraft` is the SOLE `runner.advertiseCohort` caller
      // now (D-17); an unknown draft id -> 404 (already-advertised ids are gone from the
      // drafts map, so they read as unknown too).
      // A paused service refuses with 409 + the app-authored reason (SVC-04, D-06), never a
      // silent no-op and never a false 200: the operator must be able to tell "I am draining"
      // from "that draft is gone".
      app.post('/v1/operator/cohorts/:id/advertise', (c) => {
        const result = operatorCohorts.advertiseDraft(c.req.param('id'));
        if (isAdvertisePaused(result)) {
          return c.json({ error: ADVERTISING_PAUSED_REASON }, 409);
        }
        return result ? c.json(result) : c.json({ error: 'unknown draft' }, 404);
      });
      // Re-advertise an expired cohort (SVC-02, F2). Inherits the same requireSameOrigin
      // + requireOperator prefix guards, so it is a session-gated, CSRF-checked mutating
      // action exactly like advertise (T-06-01). `readvertiseExpired` is the SECOND (and
      // only other) operator-driven `runner.advertiseCohort` caller (D-17); an unknown or
      // non-expired cohort id -> 404.
      app.post('/v1/operator/cohorts/:id/readvertise', (c) => {
        const result = operatorCohorts.readvertiseExpired(c.req.param('id'));
        // The SAME paused 409 as the advertise route above: both are advertise actions, so a
        // paused service refuses them in identical words.
        if (isAdvertisePaused(result)) {
          return c.json({ error: ADVERTISING_PAUSED_REASON }, 409);
        }
        return result ? c.json(result) : c.json({ error: 'unknown expired cohort' }, 404);
      });
      // Cancel an advertised cohort (SVC-04, D-01/D-04/D-05). Registered inside the same
      // gated block, so it inherits the requireSameOrigin CSRF check and the requireOperator
      // session gate registered above: an anonymous caller is rejected with 401 BEFORE this
      // handler runs, hence before ANY cohort-id lookup, so a never-existed and an existing
      // cohort id are indistinguishable to them (T-05-01-01). Guard the `:id` shape with the
      // same cheap 400 the anchor/detail reads use BEFORE any lookup. Unknown, never-advertised,
      // and already-settled ids all answer the SAME 404 body with no reason, member count, or
      // amount, so the response leaks nothing either (T-05-01-02). A raw library throw can never
      // become the response body: `cancelCohort` returns a closed verdict union.
      app.post('/v1/operator/cohorts/:id/cancel', (c) => {
        const id = c.req.param('id');
        if (!/^[0-9a-zA-Z-]{1,64}$/.test(id)) {
          return c.json({ error: 'invalid cohort id' }, 400);
        }
        const outcome = operatorCohorts.cancelCohort(id);
        return outcome === 'ok' ? c.json({ ok: true }) : c.json({ error: 'unknown cohort' }, 404);
      });
      // Finalize a stalled signing round on the k-of-n fallback path (SVC-04, D-01). A sibling of
      // the cancel route in every respect: registered inside the same gated block, so it inherits
      // the requireSameOrigin CSRF check and the requireOperator session gate and an anonymous
      // caller is rejected with 401 BEFORE this handler runs, hence before any cohort-id lookup
      // (T-05-03-01); and it guards the `:id` shape with the same cheap 400 before any lookup.
      //
      // A REFUSED finalize is a 409, never a 500 (RESEARCH Pitfall 4). `finalizeCohort` returns a
      // closed verdict union whose refusal carries the app-authored NOT_SIGNING_REASON, so the
      // library's own `INVALID_PHASE` / `NO_SIGNING_SESSION` text can never become a response body
      // (T-05-03-02) and the console has a reason it can render verbatim in its action-error line.
      app.post('/v1/operator/cohorts/:id/finalize', async (c) => {
        const id = c.req.param('id');
        if (!/^[0-9a-zA-Z-]{1,64}$/.test(id)) {
          return c.json({ error: 'invalid cohort id' }, 400);
        }
        const outcome = await operatorCohorts.finalizeCohort(id);
        if (outcome === 'unknown') {
          // The SAME opaque body the cancel route uses, so unknown / never-advertised /
          // already-settled stay indistinguishable across both verbs.
          return c.json({ error: 'unknown cohort' }, 404);
        }
        if (outcome === 'not-signing') {
          return c.json({ error: NOT_SIGNING_REASON }, 409);
        }
        return c.json({ ok: true });
      });
      // Gated per-cohort monitoring detail read (SVC-03, D-19/D-26). Registered AFTER the
      // requireSameOrigin + requireOperator prefix guards above, so an anonymous caller is
      // rejected with 401 BEFORE this handler runs (no existence oracle, T-04-01-01). Guard
      // the `:id` shape with the same cheap 400 as the public anchor read BEFORE any lookup,
      // then return the monitor's pure projection. When no monitor is wired, answer the
      // non-oracle `{ exists: false }` default rather than 500 (mirrors /v1/anchor fail-open).
      // A GET, so it inherits the operator gate but not the CSRF check on mutating verbs.
      app.get('/v1/operator/cohorts/:id', (c) => {
        const id = c.req.param('id');
        if (!/^[0-9a-zA-Z-]{1,64}$/.test(id)) {
          return c.json({ error: 'invalid cohort id' }, 400);
        }
        return c.json(
          monitor
            ? monitor.detail(id)
            : {
                exists: false,
                members: [],
                seatsJoined: 0,
                capacity: 0,
                phase: 'unknown',
                submissions: [],
                coSign: { noncesReceived: 0, total: 0, awaitingPartialSigs: false },
                anchor: { enabled: false, state: 'none' },
                fallback: { used: false },
                activity: [],
              },
        );
      });
      // Gated per-cohort monitoring JSON export (SVC-03, D-34). A sibling of the detail read,
      // registered AFTER the same requireSameOrigin + requireOperator prefix guards, so an
      // anonymous caller is rejected with 401 BEFORE this handler runs (no existence oracle,
      // V5). It carries a two-segment path (`:id/export`), so it never collides with the
      // single-segment detail route above. Guard the `:id` shape with the same cheap 400
      // BEFORE any lookup, then stream the monitor's exportRecord (the same projection the
      // drill-down shows plus the activity ring; off-chain artifacts stay referenced by hash).
      // The Content-Disposition filename is built ONLY from the already-shape-validated id, so
      // there is no user-controlled header content (T-04-04-02). A plain gated GET, no new
      // auth surface (D-34).
      app.get('/v1/operator/cohorts/:id/export', (c) => {
        const id = c.req.param('id');
        if (!/^[0-9a-zA-Z-]{1,64}$/.test(id)) {
          return c.json({ error: 'invalid cohort id' }, 400);
        }
        c.header('content-disposition', `attachment; filename="cohort-${id}.json"`);
        return c.json(
          monitor
            ? monitor.exportRecord(id)
            : {
                cohortId: id,
                exportedAt: Date.now(),
                exists: false,
                members: [],
                seatsJoined: 0,
                capacity: 0,
                phase: 'unknown',
                submissions: [],
                coSign: { noncesReceived: 0, total: 0, awaitingPartialSigs: false },
                anchor: { enabled: false, state: 'none' },
                fallback: { used: false },
                activity: [],
              },
        );
      });
    }
  }

  // Read-only artifact routes after the protocol routes, before the SPA.
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
    ): Promise<{ status: 200 | 400 | 502 | 503; body: object }> => {
      if (!/^did:btcr2:[a-z0-9]+$/.test(did)) {
        return { status: 400, body: { error: 'not a valid did:btcr2 identifier' } };
      }
      try {
        const { didDocument, metadata } = await resolveBtcr2(did, { bitcoin, store, sidecar });
        return { status: 200, body: { didDocument, didDocumentMetadata: metadata } };
      } catch (err) {
        // D-46: a mempool-resident beacon signal is a RETRYABLE condition, not a fault. Answer a
        // DISTINGUISHABLE 503 with the honest retry copy (never the generic 502), so the browser
        // resolve UI tells the user to try again once the signal confirms. `retryable: true` tags
        // the outcome for callers; the raw upstream detail stays server-side logged, mirroring the
        // 502-generic convention (no resolver internals disclosed).
        if (err instanceof UnconfirmedSignalError) {
          console.error(`[resolve] ${did}: a beacon signal is awaiting confirmation`);
          return {
            status: 503,
            body: {
              error: 'A beacon signal is awaiting confirmation. Resolve again after it confirms.',
              retryable: true,
            },
          };
        }
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
