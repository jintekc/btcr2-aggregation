import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BitcoinConnection } from '@did-btcr2/bitcoin';
import { buildCohortConfig, createIdentity, DEFAULT_NETWORK, resolveNetwork } from '@btcr2-aggregation/shared';
import { createIpfsNode, createService, MemoryArtifactStore, type IpfsNode, type Service } from './index.js';
import { createOfflineBitcoinConnection } from './offline-chain.js';

/**
 * Default location of the built web SPA, resolved relative to this module so it
 * works whether run from `dist/` or via tsx on `src/`: both sit two levels under
 * `packages/`, so `../../web/dist` lands on `packages/web/dist`.
 */
const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

/**
 * Default per-phase stall timeout (30 minutes), env-tunable via `PHASE_TIMEOUT_MS`.
 *
 * An operator-advertised cohort must stay discoverable long enough for STRANGERS to
 * find and join it over time (the two-sided North Star), not just for in-process peers
 * that joined within seconds (the removed booth topology). The library exposes exactly
 * ONE inter-phase stall timer with no way to exempt the Advertised phase (see
 * {@link CreateServiceOptions.phaseTimeoutMs}): an idle Advertised cohort never
 * transitions, so this stall timer is what would otherwise tear it down. Raising the
 * default to a generous 30-minute discovery window is the clean library-native lever.
 *
 * The single-timer tradeoff: a genuine mid-signing stall (a participant vanishing
 * mid-round) now also waits this long before the runner acts. Plan 02-07 (F1c) turns
 * that from a hard failure into a graceful k-of-n script-path fallback, so the long
 * window costs discovery reach without costing signing liveness. An operator who wants
 * snappier signing liveness lowers `PHASE_TIMEOUT_MS`, at the cost of a shorter window
 * for strangers to discover an idle cohort.
 */
export const DEFAULT_PHASE_TIMEOUT_MS = 1_800_000;

/**
 * Default overall per-cohort TTL (30 minutes), env-tunable via `COHORT_TTL_MS`. The
 * wall-clock budget from advertise to signing-complete; on expiry the cohort's
 * completion rejects so an abandoned cohort cannot pin itself open forever. Matched to
 * {@link DEFAULT_PHASE_TIMEOUT_MS} so the discovery window is the same generous 30
 * minutes whether a cohort sits idle in Advertised or stalls after a partial join.
 */
export const DEFAULT_COHORT_TTL_MS = 1_800_000;

export interface DemoServerOptions {
  /** Port to listen on (default 8080). */
  port?: number;
  /** Host to bind (default 127.0.0.1). */
  host?: string;
  /** Participants required before a cohort finalizes (default 2). */
  minParticipants?: number;
  /**
   * DEV/TEST-ONLY, default 0 and INERT on the production boot path (D-18): this
   * service no longer spawns any in-process peers at boot. A cohort now comes into
   * existence only when the operator advertises a draft, and the participants that
   * co-sign it are real clients. Test harnesses that want honest in-process peers
   * construct them directly with `createParticipant` (see the e2e harnesses); the
   * field is retained only so existing callers that pass `fillers: 0` still compile.
   */
  fillers?: number;
  /**
   * Overall per-cohort TTL in ms (default {@link DEFAULT_COHORT_TTL_MS} = 30 min;
   * env `COHORT_TTL_MS`). A cohort that does not complete within this window rejects on
   * its own completion promise, so a participant who joins and then walks away mid-flow
   * cannot pin a cohort open forever. Sized as a generous discovery window so an
   * advertised cohort stays joinable long enough for a stranger to find it.
   */
  cohortTtlMs?: number;
  /**
   * Per-phase stall timeout in ms (default {@link DEFAULT_PHASE_TIMEOUT_MS} = 30 min;
   * env `PHASE_TIMEOUT_MS`). This is the library's single inter-phase stall timer, with
   * no Advertised-phase exemption, so it doubles as the idle-Advertised lifetime: an
   * advertised, unjoined cohort is torn down when this fires. Defaulted to a generous
   * discovery window so strangers can find and join a cohort over time (the two-sided
   * North Star), replacing the 60s booth-era default that tore idle cohorts down before
   * anyone could join. The tradeoff (a genuine mid-signing stall also waits this long)
   * is documented on {@link DEFAULT_PHASE_TIMEOUT_MS} and softened by plan 02-07's
   * k-of-n fallback; lower `PHASE_TIMEOUT_MS` for snappier signing liveness at the cost
   * of a shorter discovery window.
   */
  phaseTimeoutMs?: number;
  /**
   * Absolute path to the built web SPA to serve from this origin. Defaults to
   * `packages/web/dist` when it exists (run `pnpm -r build` first); pass `null`
   * to serve the protocol + dashboard only (no UI).
   */
  webDistDir?: string | null;
  /**
   * Bitcoin network for resolution + the first-update registration tx proxy.
   * Defaults to the env `NETWORK` or {@link DEFAULT_NETWORK} (mutinynet). Cohort
   * co-signing stays on the fixture path regardless; this connection powers only
   * `GET /resolve/:did` and the `/v1/tx/*` proxy.
   */
  network?: string;
  /**
   * Override the esplora REST host for the resolved {@link network} (env
   * `ESPLORA_HOST`). The registry ships a sensible public host per network, but a
   * self-hoster running their own node (a private indexer, or `regtest` where the
   * default `http://127.0.0.1:3000` may not match their setup) points it here.
   * Only meaningful under {@link live}; the offline connection makes no requests.
   */
  esploraHost?: string;
  /**
   * Use a real esplora connection for the network above. Default false (env
   * `LIVE=1` also enables it): an offline connection so the gate stays hermetic -
   * resolution returns the genesis document and the registration proxy reports no
   * funds. Set true (or `LIVE=1`) for a real self-hosted deployment.
   */
  live?: boolean;
  /**
   * Permit running the coordinator on Bitcoin mainnet. Default false (env
   * `ALLOW_MAINNET=1` also enables it): a mainnet {@link network} throws at boot
   * without this explicit opt-in, because a mainnet coordinator deals in real
   * money end to end - the browser mints mainnet DIDs and beacon addresses it
   * invites the controller to FUND, and under {@link live} the `/v1/tx/broadcast`
   * proxy relays real signed transactions to the chain. Test networks and regtest
   * pass through. See docs/adr/0010-mainnet-guard-rails.md.
   */
  allowMainnet?: boolean;
  /**
   * Operator-held x-only recovery public key (64 hex chars) for every cohort this
   * coordinator advertises (env `RECOVERY_KEY` also sets it). When omitted, each
   * cohort gets a THROWAWAY recovery key whose secret is discarded - inert here
   * because demo cohorts sign the zero-chain fixture tx and the cohort beacon
   * address is never funded, but any deployment that funds beacons for real MUST
   * set this to a key whose secret it holds offline (ADR 042 recovery leaf).
   */
  recoveryKey?: string;
  /**
   * Run an IPFS (Helia) pinning node so browser participants can opt in to
   * publishing their resolution artifacts (ADR 0011). Default false (env
   * `IPFS=1` also enables it): the default gate stays IPFS-free. Data-only -
   * publishing artifacts never moves funds, so this is independent of `live`
   * and the mainnet rails.
   */
  ipfs?: boolean;
  /**
   * Directory for the IPFS node's durable block/pin storage (env `IPFS_DIR`).
   * Omit for in-memory storage (pins last for the process lifetime).
   */
  ipfsDir?: string;
  /**
   * Multiaddrs the IPFS node announces instead of its listen address (env
   * `IPFS_ANNOUNCE`, comma-separated), e.g. `/dns4/host/tcp/443/wss` behind a
   * TLS proxy so a browser on another machine (https page) can dial it.
   */
  ipfsAnnounce?: string[];
  /** Per-pin bitswap fetch bound, ms (tests shorten it; default 15s). */
  ipfsPinTimeoutMs?: number;
  /**
   * Operator console password (HOST-01, ADR 0015; env `OPERATOR_PASSWORD`). When set,
   * the operator console + gated telemetry mount and require a valid session. When
   * UNSET the service still boots and serves the public participant surface, but the
   * operator surface is DISABLED with a loud boot warning (fail-closed, D-07, mirrors
   * the ADR 0010 mainnet loud-boot pattern). Never bake this into the image; never log
   * it (M4 .env-out-of-image lesson).
   */
  operatorPassword?: string;
  /** Operator session TTL in ms (env `OPERATOR_SESSION_TTL_MS`; default 24h). */
  operatorSessionTtlMs?: number;
  /**
   * Set the operator cookie `Secure` flag (default true). Env `OPERATOR_COOKIE_SECURE=0`
   * opts out for a local-http run so the session cookie is not silently dropped.
   */
  operatorCookieSecure?: boolean;
  /** Suppress logs. */
  quiet?: boolean;
}

export interface DemoServer {
  service: Service;
  baseUrl: string;
  /** Stop the service and the HTTP server (and the IPFS node, if one is running). */
  stop(): Promise<void>;
}

/**
 * Long-lived self-hosted aggregation service: serves the aggregation protocol, the
 * gated dashboard feed, and the built SPA on a real port. It advertises NOTHING on its
 * own - a cohort comes into existence only when the authenticated operator advertises a
 * draft through the operator console (SVC-02); a fresh service therefore starts idle
 * and stays idle until the operator acts. Bitcoin tx defaults to the zero-chain fixture
 * (no node, no broadcast) unless the live path is opted in.
 */
export async function startDemoServer(opts: DemoServerOptions = {}): Promise<DemoServer> {
  const minParticipants = opts.minParticipants ?? 2;
  const cohortTtlMs = opts.cohortTtlMs ?? DEFAULT_COHORT_TTL_MS;
  const phaseTimeoutMs = opts.phaseTimeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;
  const log = opts.quiet ? () => {} : (msg: string) => console.log(`[demo] ${msg}`);

  // Serve the built web SPA from this origin when available (explicit path,
  // explicit null to disable, or the default dist if it has been built).
  const resolvedDist =
    opts.webDistDir === null
      ? undefined
      : (opts.webDistDir ?? (existsSync(DEFAULT_WEB_DIST) ? DEFAULT_WEB_DIST : undefined));

  // Content-addressed store + a Bitcoin connection so this origin also serves
  // `GET /resolve/:did`, the read-only `/cas/*` artifact routes, and the `/v1/tx/*`
  // registration proxy. The connection is OFFLINE by default (zero network I/O, so
  // the hermetic gate stays chain-free: resolution returns the genesis document and
  // the tx proxy reports no funds), and a real esplora connection under `live`/
  // `LIVE=1`. Cohort co-signing is unaffected - it stays on the fixture tx path
  // (the injected connection is not passed as `live` to createService, so the
  // beacon tx is still the fixture; resolvability comes from each controller's own
  // singleton-beacon registration, not from broadcasting the aggregate tx).
  const store = new MemoryArtifactStore();
  // Resolve the operator's network once (validates the name for both the live and
  // offline paths; resolveNetwork throws on an unknown name so a typo fails fast).
  // This one network drives the cohort config, the coordinator identity, the live
  // esplora connection, and the network the browser fetches from `GET /v1/config` -
  // one source of truth end to end.
  const net = resolveNetwork(
    opts.network ?? process.env.NETWORK ?? DEFAULT_NETWORK,
    opts.esploraHost ?? process.env.ESPLORA_HOST,
  );
  const networkName = net.name;
  const useLive = opts.live ?? process.env.LIVE === '1';

  // Mainnet guard rail: real money end to end, so it never happens by accident.
  // Guarded even offline - an offline mainnet coordinator still hands the browser
  // mainnet DIDs and a genesis beacon address it invites the controller to fund.
  const allowMainnet = opts.allowMainnet ?? process.env.ALLOW_MAINNET === '1';
  if (net.isMainnet && !allowMainnet) {
    throw new Error(
      `Refusing to start the coordinator on ${net.label} without an explicit opt-in ` +
        '(ALLOW_MAINNET=1 or allowMainnet: true). Mainnet moves real funds: the browser ' +
        'derives real beacon addresses to fund, and a LIVE coordinator relays real ' +
        'transactions. Default to a test network (mutinynet/signet/regtest).',
    );
  }
  // Operator recovery key for the ADR 042 recovery leaf of every advertised cohort.
  // Optional here (demo cohorts sign the fixture tx, so the cohort beacon address is
  // never funded); required practice for any deployment that funds beacons for real.
  const recoveryKey = opts.recoveryKey ?? process.env.RECOVERY_KEY;
  if (net.isMainnet) {
    log(`!!! ${net.label.toUpperCase()}: REAL FUNDS !!!`);
    log('  - every address/DID the browser mints is a real mainnet object; funding one spends real bitcoin');
    log(`  - first-update registration txs pay a real ${useLive ? 'on-chain' : '(when live)'} fee from the controller's UTXO`);
    log(`  - the /v1/tx/broadcast proxy ${useLive ? 'RELAYS raw signed txs to mainnet' : 'is offline (LIVE unset), broadcasts are refused'}`);
    log(
      recoveryKey
        ? '  - cohort recovery key: operator-supplied (RECOVERY_KEY)'
        : '  - cohort recovery key: THROWAWAY (secret discarded); inert for fixture cohorts, but set RECOVERY_KEY before funding any cohort beacon',
    );
  }

  // Operator console credential (HOST-01, ADR 0015). Fail-closed: no password => the
  // console + mutating routes + gated telemetry do NOT mount, but the public
  // participant surface still serves. Loud boot warning mirrors the ADR 0010 mainnet
  // banner. Never logged. Unlike mainnet this does NOT throw - a fresh self-hosted
  // service is expected to boot before the operator sets a password (D-07).
  const operatorPassword = opts.operatorPassword ?? process.env.OPERATOR_PASSWORD;
  const operatorSessionTtlMs =
    opts.operatorSessionTtlMs ??
    (process.env.OPERATOR_SESSION_TTL_MS ? Number(process.env.OPERATOR_SESSION_TTL_MS) : undefined);
  const operatorCookieSecure =
    opts.operatorCookieSecure ?? (process.env.OPERATOR_COOKIE_SECURE === '0' ? false : undefined);
  if (!operatorPassword) {
    log('!!! OPERATOR CONSOLE DISABLED !!!');
    log('  - no OPERATOR_PASSWORD set at boot; the public participant surface still serves');
    log('  - the operator console, mutating cohort routes, and /dashboard/events are OFF');
    log('  - set OPERATOR_PASSWORD (and restart) to enable operator sign-in');
  }

  const bitcoin = useLive
    ? new BitcoinConnection({ network: net.name, rest: { host: net.esploraHost } })
    : createOfflineBitcoinConnection();

  // Opt-in IPFS pinning node (ADR 0011). Created before the service so the pin
  // routes exist from the first request; this server owns its lifecycle (stop()
  // below), mirroring the injected Bitcoin connection.
  const useIpfs = opts.ipfs ?? process.env.IPFS === '1';
  const ipfsAnnounce =
    opts.ipfsAnnounce ??
    (process.env.IPFS_ANNOUNCE ? process.env.IPFS_ANNOUNCE.split(',').map((a) => a.trim()).filter(Boolean) : undefined);
  const ipfs: IpfsNode | undefined = useIpfs
    ? await createIpfsNode({
        dir: opts.ipfsDir ?? process.env.IPFS_DIR,
        announce: ipfsAnnounce,
        pinTimeoutMs: opts.ipfsPinTimeoutMs,
      })
    : undefined;
  if (ipfs) {
    const dir = opts.ipfsDir ?? process.env.IPFS_DIR;
    log(`ipfs: pinning node ${ipfs.peerId} (${dir ? `durable at ${dir}` : 'in-memory'})`);
    for (const addr of ipfs.multiaddrs()) {
      log(`ipfs:   dialable at ${addr}`);
    }
  }

  // The browser derives its addresses/DIDs at runtime from `GET /v1/config` (served
  // with this coordinator's network, below), so the SPA and the chain always agree -
  // no build-time DEFAULT_NETWORK mismatch to warn about anymore (was the M3e
  // placeholder; runtime injection is M3f).

  const service = createService({
    identity: createIdentity(net),
    // The default cohort config seeds the runner; per-cohort configs supplied by the
    // operator on advertise take over from here (SVC-01/SVC-02). Long-lived process:
    // keep advert/inbox SSE alive across idle periods, and bound each cohort so an
    // abandoned one rejects on its own rather than lingering.
    config: buildCohortConfig(minParticipants, 'CASBeacon', net.name, recoveryKey),
    heartbeatIntervalMs: 15000,
    cohortTtlMs,
    phaseTimeoutMs,
    webDistDir: resolvedDist,
    store,
    bitcoin,
    ipfs,
    // Operator auth (possibly undefined => fail-closed, operator surface unmounted).
    operatorPassword,
    operatorSessionTtlMs,
    operatorCookieSecure,
  });
  const { baseUrl } = await service.start(opts.port ?? 8080, opts.host ?? '127.0.0.1');
  log(
    `service listening on ${baseUrl} (minParticipants=${minParticipants}, ` +
      `web ${resolvedDist ? 'served' : 'not served'}, resolve=${networkName}${useLive ? ' (live esplora)' : ' (offline)'})`,
  );
  log(
    operatorPassword
      ? 'idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)'
      : 'idle; set OPERATOR_PASSWORD to enable the operator console and advertise cohorts',
  );

  return {
    service,
    baseUrl,
    async stop() {
      await service.stop();
      // After the HTTP server: no request can reach the pin routes once the
      // service is down, so the node can close its stores safely.
      await ipfs?.stop();
    },
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const port = Number(process.env.PORT ?? 8080);
  // Bind loopback by default (safe for a local run behind nothing); a container or
  // any deployment that must accept off-host traffic sets HOST=0.0.0.0 and fronts
  // this with a TLS-terminating reverse proxy (see docs/DEPLOY.md). An explicit
  // empty HOST= coalesces to unset (loopback), never a bind-all-interfaces `''`.
  const host = process.env.HOST || undefined;
  const minParticipants = Number(process.env.MIN_PARTICIPANTS ?? 2);
  const cohortTtlMs = process.env.COHORT_TTL_MS ? Number(process.env.COHORT_TTL_MS) : undefined;
  const phaseTimeoutMs = process.env.PHASE_TIMEOUT_MS ? Number(process.env.PHASE_TIMEOUT_MS) : undefined;
  startDemoServer({ port, host, minParticipants, cohortTtlMs, phaseTimeoutMs })
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
