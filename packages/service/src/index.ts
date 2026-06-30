import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import {
  AggregationServiceRunner,
  HttpServerTransport,
  type CohortConfig,
} from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import type { Identity } from '@btcr2-aggregation/shared';
import { createHonoApp } from './hono-adapter.js';
import { makeProvideTxData } from './tx.js';
import { persistCohortArtifacts } from './persist.js';
import type { ArtifactStore } from './store.js';

export { createHonoApp, type HonoAppOptions } from './hono-adapter.js';
export { makeProvideTxData } from './tx.js';
export { bridgeRunnerToSse } from './dashboard-sse.js';
export { startDemoServer, type DemoServer, type DemoServerOptions } from './demo-server.js';
export {
  ARTIFACT_KINDS,
  type ArtifactKind,
  type ArtifactValueByKind,
  type ArtifactStore,
  MemoryArtifactStore,
  FileSystemArtifactStore,
  isHexKey,
  normalizeHexKey,
  putAnnouncement,
  putProof,
  putUpdate,
  putGenesis,
  exportSidecar,
  mountArtifactRoutes,
} from './store.js';
export {
  persistCohortArtifacts,
  type PersistableCohort,
  type PersistSummary,
} from './persist.js';

export interface CreateServiceOptions {
  /** Service identity (the coordinator). */
  identity: Identity;
  /** Cohort configuration the runner advertises on `run()`. */
  config: CohortConfig;
  /**
   * SSE heartbeat interval, in ms. Defaults to 0 (disabled) so a one-shot M1
   * process exits cleanly once a cohort completes. The long-lived demo server
   * sets a positive value (e.g. 15000) to keep advert/inbox SSE connections
   * alive through idle periods and intermediary proxies.
   */
  heartbeatIntervalMs?: number;
  /**
   * Per-cohort overall TTL, in ms. Left undefined the runner NEVER times a
   * cohort out, so a participant who joins then walks away mid-flow leaves the
   * cohort's completion promise pending forever (it can neither complete nor
   * fail). The long-lived booth MUST set this so a stalled cohort rejects and
   * the advertise loop can move on.
   */
  cohortTtlMs?: number;
  /**
   * Per-phase stall timeout, in ms. Bounds each protocol phase (keygen, nonce,
   * signing); if a participant drops mid-round the phase times out and the
   * cohort fails fast for the remaining members instead of hanging.
   */
  phaseTimeoutMs?: number;
  /**
   * Absolute path to the built web SPA (e.g. `packages/web/dist`). When set, the
   * server also serves the app from this origin (production same-origin
   * topology). Omit for the headless M1 path, which serves no UI.
   */
  webDistDir?: string;
  /**
   * Content-addressed artifact store. When set, the server exposes read-only
   * `GET /cas/*` routes serving the off-chain resolution artifacts (CAS
   * announcements, SMT proofs, signed updates) by hex hash. The cohort artifacts
   * are persisted into it when live broadcasting is enabled (M3c). Omit for the
   * headless M1 path, which persists nothing.
   */
  store?: ArtifactStore;
}

export interface StartedService {
  port: number;
  baseUrl: string;
}

export interface Service {
  /** The aggregation runner driving the cohort. Attach event listeners to it. */
  readonly runner: AggregationServiceRunner;
  /** The underlying sans-I/O HTTP server transport. */
  readonly transport: HttpServerTransport;
  /** Start listening. Pass port 0 (default) for an ephemeral port. */
  start(port?: number, host?: string): Promise<StartedService>;
  /** Stop the runner, transport, and HTTP server. */
  stop(): Promise<void>;
}

/**
 * Create an aggregation service: an {@link HttpServerTransport} mounted under Hono
 * on a real port, driven by an {@link AggregationServiceRunner} configured with the
 * fixture beacon-tx callback. did:btcr2 KEY senders are authenticated by resolving
 * their DID to a public key (`resolveBtcr2SenderPk`); SSE heartbeats are disabled
 * so the process exits cleanly once a cohort completes.
 */
export function createService(opts: CreateServiceOptions): Service {
  const { did, keys } = opts.identity;

  const transport = new HttpServerTransport({
    resolveSenderPk: resolveBtcr2SenderPk,
    heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 0,
  });
  transport.registerActor(did, keys);

  // `onProvideTxData` reads `runner` lazily (only when signing starts, long after
  // construction), so closing over the const binding here is safe.
  const runner: AggregationServiceRunner = new AggregationServiceRunner({
    transport,
    did,
    keys,
    config: opts.config,
    onProvideTxData: makeProvideTxData(() => runner),
    // Undefined => disabled (the one-shot M1 path relies on that). The booth
    // passes both so abandoned/stalled cohorts reject instead of wedging.
    cohortTtlMs: opts.cohortTtlMs,
    phaseTimeoutMs: opts.phaseTimeoutMs,
  });

  // When a store is configured, harvest each completed cohort's off-chain
  // resolution artifacts (the per-member signed updates plus the CAS announcement
  // or SMT proofs) and persist them under the exact hex keys a did:btcr2 resolver
  // will request. The artifacts live on the cohort accessor, NOT on the
  // `signing-complete` result, so a handler that read only the result would
  // persist nothing and resolution would silently fail. Fire-and-forget: a persist
  // failure must never crash the runner, so it is caught and logged. The headless
  // M1/M2 path configures no store, so this never runs in the hermetic gate; the
  // hermetic persist test wires a MemoryArtifactStore here explicitly.
  if (opts.store) {
    const store = opts.store;
    runner.on('signing-complete', ({ cohortId }) => {
      const cohort = runner.session.getCohort(cohortId);
      if (!cohort) {
        return;
      }
      void persistCohortArtifacts(store, cohort).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[service] failed to persist cohort ${cohortId} artifacts: ${message}`);
      });
    });
  }

  const app = createHonoApp(transport, {
    runner,
    webDistDir: opts.webDistDir,
    store: opts.store,
  });
  let server: ServerType | undefined;

  return {
    runner,
    transport,
    start(port = 0, host = '127.0.0.1'): Promise<StartedService> {
      transport.start();
      return new Promise<StartedService>((resolve, reject) => {
        try {
          server = serve({ fetch: app.fetch, port, hostname: host }, (info: AddressInfo) => {
            resolve({ port: info.port, baseUrl: `http://${host}:${info.port}` });
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    stop(): Promise<void> {
      runner.stop();
      transport.stop();
      return new Promise<void>((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}
