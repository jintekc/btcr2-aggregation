import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createParticipant, type Participant } from '@btcr2-aggregation/participant';
import { buildCohortConfig, createIdentity } from '@btcr2-aggregation/shared';
import { createService, type Service } from './index.js';

/**
 * Default location of the built web SPA, resolved relative to this module so it
 * works whether run from `dist/` or via tsx on `src/`: both sit two levels under
 * `packages/`, so `../../web/dist` lands on `packages/web/dist`.
 */
const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface DemoServerOptions {
  /** Port to listen on (default 8080). */
  port?: number;
  /** Host to bind (default 127.0.0.1). */
  host?: string;
  /** Participants required before a cohort finalizes (default 2). */
  minParticipants?: number;
  /**
   * Operator-run in-process honest peers per cohort. Set to `minParticipants - 1`
   * so a single browser attendee can complete a cohort solo; set 0 for an
   * all-real-attendee cohort (the honest p2p demo). Each peer is an independent
   * participant with its own key, NOT a service-owned co-signer.
   */
  fillers?: number;
  /**
   * Per-cohort TTL in ms (default 180000 = 3 min). A cohort that does not
   * complete within this window rejects, and the advertise loop moves on to a
   * fresh cohort, so one attendee walking away mid-flow cannot wedge the booth.
   */
  cohortTtlMs?: number;
  /** Per-phase stall timeout in ms (default 60000 = 1 min). */
  phaseTimeoutMs?: number;
  /**
   * Absolute path to the built web SPA to serve from this origin. Defaults to
   * `packages/web/dist` when it exists (run `pnpm -r build` first); pass `null`
   * to serve the protocol + dashboard only (no UI).
   */
  webDistDir?: string | null;
  /** Suppress logs. */
  quiet?: boolean;
}

export interface DemoServer {
  service: Service;
  baseUrl: string;
  /** Stop the advertise loop, fillers, and the HTTP server. */
  stop(): Promise<void>;
}

/**
 * Long-lived demo coordinator: serves the aggregation protocol + dashboard feed
 * on a real port and continuously advertises a CAS cohort for browser
 * participants to join. When a cohort completes (or fails), it advertises the
 * next one, so the booth keeps accepting attendees. Bitcoin tx is still the M1
 * fixture (no node, no broadcast).
 */
export async function startDemoServer(opts: DemoServerOptions = {}): Promise<DemoServer> {
  const minParticipants = opts.minParticipants ?? 2;
  const fillers = opts.fillers ?? 0;
  const cohortTtlMs = opts.cohortTtlMs ?? 180000;
  const phaseTimeoutMs = opts.phaseTimeoutMs ?? 60000;
  const log = opts.quiet ? () => {} : (msg: string) => console.log(`[demo] ${msg}`);

  // Serve the built web SPA from this origin when available (explicit path,
  // explicit null to disable, or the default dist if it has been built).
  const resolvedDist =
    opts.webDistDir === null
      ? undefined
      : (opts.webDistDir ?? (existsSync(DEFAULT_WEB_DIST) ? DEFAULT_WEB_DIST : undefined));

  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(minParticipants),
    // Long-lived booth: keep advert/inbox SSE alive between attendees, and bound
    // every cohort so an abandoned one rejects and the loop advertises the next.
    heartbeatIntervalMs: 15000,
    cohortTtlMs,
    phaseTimeoutMs,
    webDistDir: resolvedDist,
  });
  const { baseUrl } = await service.start(opts.port ?? 8080, opts.host ?? '127.0.0.1');
  log(
    `coordinator listening on ${baseUrl} (minParticipants=${minParticipants}, fillers=${fillers}, ` +
      `web ${resolvedDist ? 'served' : 'not served'})`,
  );

  let running = true;

  const loop = async (): Promise<void> => {
    let round = 0;
    while (running) {
      round += 1;
      const peers: Participant[] = [];
      const { cohortId, completion } = service.runner.advertiseCohort(buildCohortConfig(minParticipants));
      log(`round ${round}: advertised cohort ${cohortId}; waiting for ${minParticipants} participant(s)`);

      for (let i = 0; i < fillers; i += 1) {
        const peer = createParticipant({ identity: createIdentity(), baseUrl });
        peers.push(peer);
        await peer.start();
      }
      if (fillers > 0) {
        log(`round ${round}: started ${fillers} in-process peer(s); ${minParticipants - fillers} seat(s) open for browsers`);
      }

      try {
        const result = await completion;
        log(`round ${round}: cohort ${cohortId} complete, ${result.signature.length}-byte ${result.path ?? 'key-path'} signature`);
      } catch (err) {
        log(`round ${round}: cohort ${cohortId} ended: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        for (const peer of peers) {
          peer.stop();
        }
      }
    }
  };

  void loop();

  return {
    service,
    baseUrl,
    async stop() {
      running = false;
      await service.stop();
    },
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const port = Number(process.env.PORT ?? 8080);
  const minParticipants = Number(process.env.MIN_PARTICIPANTS ?? 2);
  const fillers = Number(process.env.FILLERS ?? 0);
  const cohortTtlMs = process.env.COHORT_TTL_MS ? Number(process.env.COHORT_TTL_MS) : undefined;
  const phaseTimeoutMs = process.env.PHASE_TIMEOUT_MS ? Number(process.env.PHASE_TIMEOUT_MS) : undefined;
  startDemoServer({ port, minParticipants, fillers, cohortTtlMs, phaseTimeoutMs })
    .then((server) => {
      let shuttingDown = false;
      const shutdown = () => {
        if (shuttingDown) {
          // A second Ctrl+C forces exit even if a lingering SSE socket keeps
          // server.close() from resolving.
          process.exit(0);
        }
        shuttingDown = true;
        // Backstop: never hang on shutdown (an open dashboard SSE can keep the
        // HTTP server from closing).
        const force = setTimeout(() => process.exit(0), 3000);
        force.unref();
        void server.stop().then(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
