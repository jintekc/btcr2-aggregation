import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BitcoinConnection } from '@did-btcr2/bitcoin';
import { buildCohortConfig, createIdentity, DEFAULT_NETWORK, resolveNetwork } from '@btcr2-aggregation/shared';
import { createIpfsNode, createService, MemoryArtifactStore, type IpfsNode, type Service } from './index.js';
import { createOfflineBitcoinConnection } from './offline-chain.js';
// The NaN-guarded knob parser (review WR-04) moved to `runtime-settings.ts` when the runtime
// settings holder started seeding its own numeric fields from the environment: one guard, two
// callers, so it can never be fixed in one place and left broken in the other. Behavior here is
// byte-identical to the local copy it replaces.
import { numericKnob } from './runtime-settings.js';

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

/**
 * Default funding window (12 minutes), env-tunable via `FUNDING_WINDOW_MS`. Under
 * `BROADCAST=1` (the live+broadcast path, D-35) each cohort's aggregate beacon address must
 * be funded by the operator before its funding wait gives up; this is that wait's default
 * budget. Sized modestly (~10-15 min per D-38) so a genuinely unfunded cohort dead-ends with
 * an honest reason in a reasonable time rather than hanging for the full phase timeout, while
 * still giving a human operator time to fund the address after seeing the FUND-THIS prompt.
 *
 * The D-38 boot invariant pairs this with {@link DEFAULT_PHASE_TIMEOUT_MS}: a live+broadcast
 * boot fails fast unless `phaseTimeoutMs > fundingWindowMs`, so the funding wait can surface
 * its specific "funding never arrived" reason from inside `onProvideTxData` BEFORE the
 * library's phase-stall timer fires (else the operator sees a generic stall instead). The
 * per-cohort TTL leg of the same invariant is a runtime clamp landed by the 04-06 funding
 * stage; this constant + the phase-timeout leg are the boot-time half.
 */
export const DEFAULT_FUNDING_WINDOW_MS = 720_000;

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
   * Activate the ADR 042 k-of-n script-path fallback for signing liveness (F1c;
   * env `AUTO_FALLBACK=0` disables, default ON). n-of-n MuSig2 stays the primary
   * spend and the normal outcome; this only converts a STALLED optimistic signing
   * round (a co-signer vanishing mid-round so the single stall timer fires while
   * signing is in flight) from a hard `cohort-failed` into a graceful k-of-n
   * script-path recovery, so one defector cannot deny the whole cohort its anchor.
   *
   * This is the counterpart to the generous {@link DEFAULT_PHASE_TIMEOUT_MS}
   * discovery window: a longer `phaseTimeoutMs` means the fallback also fires later,
   * but it turns the eventual signing stall from a failure into a recovery, so the
   * long window costs discovery reach without costing signing liveness. Inert on the
   * fixture/offline default (nothing is broadcast); a live fallback broadcast stays
   * behind the existing `live` + mainnet rails.
   */
  autoFallbackOnStall?: boolean;
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
   *
   * NOTE: this flag controls only the injected Bitcoin CONNECTION (offline stub vs real
   * esplora) used by `GET /resolve/:did` and the `/v1/tx/*` proxy. It does NOT by itself
   * switch cohort co-signing off the fixture path - that is gated by {@link broadcast}
   * (D-35), so `LIVE=1` alone keeps its existing meaning (live esplora, fixture co-sign).
   */
  live?: boolean;
  /**
   * Enable the live+broadcast cohort path (D-35; env `BROADCAST=1`, which REQUIRES
   * `LIVE=1`/`live` and throws at boot otherwise). When set, `createService` receives
   * `{ live: true, broadcast: true }`, so each cohort builds a REAL aggregation beacon tx
   * that spends a funded UTXO at the cohort beacon address and broadcasts it on-chain -
   * real money moves. Default false: the hermetic fixture co-sign path. The middle mode
   * (live sign, no push) is deliberately NOT exposed via env (D-35); a programmatic caller
   * can still reach it through {@link CreateServiceOptions} directly.
   */
  broadcast?: boolean;
  /**
   * Change address for the live beacon tx under {@link broadcast} (env `LIVE_CHANGE_ADDRESS`).
   * Defaults to the cohort beacon address inside `createService`; set the operator funding
   * wallet here to avoid reusing the cohort address for change. Only meaningful with
   * {@link broadcast}.
   */
  changeAddress?: string;
  /**
   * Funding window in ms for the live+broadcast path (env `FUNDING_WINDOW_MS`, default
   * {@link DEFAULT_FUNDING_WINDOW_MS} = 12 min). The budget the funding wait allows for the
   * operator to fund a cohort beacon address before it dead-ends with an honest "funding
   * never arrived" reason (D-38). The 04-06 funding stage consumes this as the funding wait's
   * window (clamped per-cohort against the remaining TTL); this plan defines the knob, threads
   * it into `createService`, and enforces the boot invariant `phaseTimeoutMs > fundingWindowMs`
   * under {@link broadcast}.
   */
  fundingWindowMs?: number;
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
  /**
   * Optional service display name (D-51; env `SERVICE_NAME`). A boot-time constant surfaced on
   * `GET /v1/config` so the operator console health strip and the public directory header label
   * the service. Display text only: there is no edit surface and no validation beyond trimming.
   * Omit to run the service unnamed (the surfaces simply show no name).
   */
  serviceName?: string;
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
  const log = opts.quiet ? () => {} : (msg: string) => console.log(`[demo] ${msg}`);
  // Every numeric knob rides {@link numericKnob} (review WR-04) so a malformed value warns loudly
  // and falls back, instead of silently poisoning a downstream comparison with NaN. Guarded even
  // for the programmatic option, because a caller that computed it from its own env (the live-UAT
  // harness does) can hand a NaN straight through.
  const minParticipants = numericKnob('minParticipants', opts.minParticipants, 2, log)!;
  const cohortTtlMs = numericKnob('COHORT_TTL_MS', opts.cohortTtlMs, DEFAULT_COHORT_TTL_MS, log)!;
  const phaseTimeoutMs = numericKnob('PHASE_TIMEOUT_MS', opts.phaseTimeoutMs, DEFAULT_PHASE_TIMEOUT_MS, log)!;
  // ADR 042 k-of-n script-path fallback (F1c): default ON for the self-hosted product
  // so a stalled signing round recovers instead of hard-failing; `AUTO_FALLBACK=0`
  // opts out. Only converts a SIGNING-phase stall into a fallback (the library scopes
  // it); an idle Advertised cohort still expires on the same stall timer (plan 02-06).
  const autoFallbackOnStall = opts.autoFallbackOnStall ?? process.env.AUTO_FALLBACK !== '0';

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

  // Live+broadcast enablement (D-35): the ONLY env-exposed path that moves Bitcoin for
  // cohort beacons. LIVE=1 alone keeps its meaning (live esplora for resolve + the /v1/tx
  // proxy, fixture co-sign); BROADCAST=1 additionally has createService build + broadcast a
  // REAL aggregation beacon tx per cohort. BROADCAST without LIVE is refused at boot: the
  // only tx there is the zero-chain fixture, which is meaningless to broadcast.
  const useBroadcast = opts.broadcast ?? process.env.BROADCAST === '1';
  if (useBroadcast && !useLive) {
    throw new Error(
      'Refusing to start: BROADCAST=1 requires LIVE=1 (broadcast: true requires live: true). ' +
        'Without a live esplora connection the only beacon tx to broadcast is the zero-chain ' +
        'fixture, which cannot anchor. Set LIVE=1 (and fund each cohort beacon address) to ' +
        'broadcast for real, or unset BROADCAST to run the hermetic fixture co-sign path.',
    );
  }
  // Funding-window knob (D-38; env FUNDING_WINDOW_MS). Threaded into createService for the
  // 04-06 funding stage; enforced here by the phase-timeout leg of the boot invariant.
  const changeAddress = opts.changeAddress ?? process.env.LIVE_CHANGE_ADDRESS;
  // Guarded (review WR-04): a malformed value used to make `phaseTimeoutMs <= fundingWindowMs`
  // false, silently skipping the D-38 boot invariant below, and then made the wait never poll once
  // while still emitting the "could not observe the chain" blind-lapse verdict.
  const fundingWindowMs = numericKnob(
    'FUNDING_WINDOW_MS',
    opts.fundingWindowMs ?? process.env.FUNDING_WINDOW_MS,
    DEFAULT_FUNDING_WINDOW_MS,
    log,
  )!;
  // D-38 phase-timeout leg: under BROADCAST the funding wait must be able to throw its own
  // "funding never arrived" reason from inside onProvideTxData BEFORE the library's phase-stall
  // timer fires, else the operator sees a generic stall instead of the honest funding message.
  // Fail fast at boot on a config that would let the phase timer win the race.
  if (useBroadcast && phaseTimeoutMs <= fundingWindowMs) {
    throw new Error(
      `Refusing to start: under BROADCAST=1 the phase-stall timeout PHASE_TIMEOUT_MS ` +
        `(${phaseTimeoutMs}ms) must EXCEED the funding window FUNDING_WINDOW_MS (${fundingWindowMs}ms), ` +
        'so the funding wait can surface its specific "funding never arrived" reason before the ' +
        'phase-stall timer fires. Raise PHASE_TIMEOUT_MS or lower FUNDING_WINDOW_MS.',
    );
  }
  // Loud live+broadcast boot banner (D-35/D-40), mirroring the ADR 0010 mainnet loud-boot
  // idiom. Fires on ANY live+broadcast boot regardless of network, because even a test-network
  // beacon spends a real (if valueless) UTXO the operator must fund per cohort.
  if (useLive && useBroadcast) {
    log(`!!! LIVE + BROADCAST: ${net.label.toUpperCase()} !!!`);
    log(`  - each cohort's aggregate beacon tx is BROADCAST on-chain to ${net.label}`);
    log('  - the operator MUST fund each cohort beacon address before its funding window elapses');
    log(`  - funding window: ${fundingWindowMs}ms; an unfunded cohort dead-ends with a funding reason (no retry fixes it)`);
    // Throwaway-recovery-key warning (D-40): fires on any live+broadcast boot, not just
    // mainnet, because funds sent to a below-threshold-failed cohort are lost on any network.
    if (!recoveryKey) {
      log('  !!! RECOVERY_KEY UNSET: cohort recovery keys are THROWAWAY (secret discarded) !!!');
      log('      funds sent to a cohort that fails below its fallback threshold are UNRECOVERABLE,');
      log('      regardless of network; set RECOVERY_KEY to a key whose secret you hold offline');
    }
  }

  // Operator console credential (HOST-01, ADR 0015). Fail-closed: no password => the
  // console + mutating routes + gated telemetry do NOT mount, but the public
  // participant surface still serves. Loud boot warning mirrors the ADR 0010 mainnet
  // banner. Never logged. Unlike mainnet this does NOT throw - a fresh self-hosted
  // service is expected to boot before the operator sets a password (D-07).
  // Optional service display name (D-51): mirror the RECOVERY_KEY/NETWORK env idiom, trimming
  // only (a name is display text, no further validation). An empty/whitespace value coalesces to
  // undefined so the config DTO stays byte-identical (no serviceName key) rather than an empty one.
  const serviceName = (opts.serviceName ?? process.env.SERVICE_NAME)?.trim() || undefined;

  // Boot seeds for the runtime SETTINGS holder (SVC-04 criterion 3 / SVC-05, D-10/D-12/D-19): what
  // a NEW cohort starts from, and the participation terms. Each rides an existing idiom rather than
  // a new one, and the two idioms do different jobs in different places. The numbers are NaN-guarded
  // HERE by `numericKnob` (review WR-04), so a malformed value warns and falls back instead of
  // poisoning a comparison. The strings are TRIMMED here, by the RECOVERY_KEY/SERVICE_NAME idiom, so
  // an empty value collapses to undefined rather than storing an empty string that reads as "set to
  // nothing". Their LENGTH bound is not here at all: it lives once inside `createRuntimeSettings`,
  // where every seed path meets, deliberately rather than a second time here, because a guard that
  // exists twice is a guard that can be fixed once and stay broken once (the same reason 05-30 put
  // the discovery-window ceiling clamp at the holder).
  //
  // Every one of these is a SEED, never a lock: the console edits the in-memory value behind the
  // gated settings routes, and a restart returns each to the environment value below. They also
  // never reach a cohort that already exists: `createDraft` reads the holder once at creation and
  // nothing re-reads it afterwards (D-13).
  const defaultBeaconTypeRaw = process.env.DEFAULT_BEACON_TYPE?.trim() || undefined;
  const defaultBeaconType =
    defaultBeaconTypeRaw === 'CASBeacon' || defaultBeaconTypeRaw === 'SMTBeacon'
      ? defaultBeaconTypeRaw
      : undefined;
  if (defaultBeaconTypeRaw && !defaultBeaconType) {
    log(`ignoring malformed DEFAULT_BEACON_TYPE="${defaultBeaconTypeRaw}"; expected CASBeacon or SMTBeacon`);
  }
  const defaultSize = numericKnob('DEFAULT_SIZE', process.env.DEFAULT_SIZE, undefined, log);
  const defaultThreshold = numericKnob('DEFAULT_THRESHOLD', process.env.DEFAULT_THRESHOLD, undefined, log);
  const defaultDiscoveryWindowMs = numericKnob(
    'DEFAULT_DISCOVERY_WINDOW_MS',
    process.env.DEFAULT_DISCOVERY_WINDOW_MS,
    undefined,
    log,
  );
  const defaultFundingWindowMs = numericKnob(
    'DEFAULT_FUNDING_WINDOW_MS',
    process.env.DEFAULT_FUNDING_WINDOW_MS,
    undefined,
    log,
  );
  // Trimmed to undefined so an empty TERMS_TEXT means the join flow has NO terms step, which is a
  // different fact from terms that say nothing (SVC-05, D-19).
  const termsText = process.env.TERMS_TEXT?.trim() || undefined;

  const operatorPassword = opts.operatorPassword ?? process.env.OPERATOR_PASSWORD;
  // Guarded (review WR-04): a NaN TTL made `Date.now() > expiresAt` always false, so operator
  // sessions NEVER expired, and `Math.floor(NaN / 1000)` emitted an invalid `Max-Age=NaN` cookie
  // attribute. Falls back to undefined, which is the auth module's own 24h default.
  const operatorSessionTtlMs = numericKnob(
    'OPERATOR_SESSION_TTL_MS',
    opts.operatorSessionTtlMs ?? process.env.OPERATOR_SESSION_TTL_MS,
    undefined,
    log,
  );
  const operatorCookieSecure =
    opts.operatorCookieSecure ?? (process.env.OPERATOR_COOKIE_SECURE === '0' ? false : undefined);
  if (!operatorPassword) {
    log('!!! OPERATOR CONSOLE DISABLED !!!');
    log('  - no OPERATOR_PASSWORD set at boot; the public participant surface still serves');
    log('  - the operator console, mutating cohort routes, and gated monitoring are OFF');
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
    // Signing-liveness fallback default-on for the product (env AUTO_FALLBACK=0 off).
    autoFallbackOnStall,
    // Live+broadcast cohort path (D-35): tie createService's live co-sign + on-chain
    // broadcast to BROADCAST=1 (which requires LIVE=1). LIVE=1 alone leaves these false, so
    // cohort co-signing stays on the fixture path (existing meaning preserved). The
    // changeAddress + allowMainnet + fundingWindowMs knobs only bite under this path.
    live: useBroadcast,
    broadcast: useBroadcast,
    changeAddress,
    allowMainnet,
    fundingWindowMs,
    // Operator-held recovery key exactly when RECOVERY_KEY was supplied (env or opts); otherwise the
    // cohort recovery key is an auto-derived throwaway. Drives the funding-stage recovery-key
    // disclosure honestly (D-40): the boot banner already warns on a throwaway under BROADCAST, and
    // this carries the same fact into the per-cohort funding view.
    recoveryKeyOperatorHeld: Boolean(recoveryKey),
    webDistDir: resolvedDist,
    store,
    bitcoin,
    ipfs,
    // Optional service display name surfaced on GET /v1/config (D-51).
    serviceName,
    // Runtime-settings boot seeds (SVC-04 criterion 3 / SVC-05). Each is undefined unless its env
    // var was set, in which case createService keeps its existing derivation, so a service booted
    // without any of these behaves exactly as it did before.
    defaultBeaconType,
    defaultSize,
    defaultThreshold,
    defaultDiscoveryWindowMs,
    defaultFundingWindowMs,
    termsText,
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
  // Every numeric env knob rides {@link numericKnob} (review WR-04): a malformed value warns and
  // falls back instead of handing a silent NaN to startDemoServer. `PORT` takes a minimum of 0 so
  // `PORT=0` keeps its ephemeral-port meaning; the rest must be strictly positive.
  const warn = (msg: string): void => console.warn(`[demo] ${msg}`);
  const port = numericKnob('PORT', process.env.PORT, 8080, warn, 0)!;
  // Bind loopback by default (safe for a local run behind nothing); a container or
  // any deployment that must accept off-host traffic sets HOST=0.0.0.0 and fronts
  // this with a TLS-terminating reverse proxy (see docs/DEPLOY.md). An explicit
  // empty HOST= coalesces to unset (loopback), never a bind-all-interfaces `''`.
  const host = process.env.HOST || undefined;
  const minParticipants = numericKnob('MIN_PARTICIPANTS', process.env.MIN_PARTICIPANTS, 2, warn)!;
  const cohortTtlMs = numericKnob('COHORT_TTL_MS', process.env.COHORT_TTL_MS, undefined, warn);
  const phaseTimeoutMs = numericKnob('PHASE_TIMEOUT_MS', process.env.PHASE_TIMEOUT_MS, undefined, warn);
  // Live+broadcast contract (D-35): LIVE=1 controls the esplora connection; BROADCAST=1
  // (requires LIVE=1) enables real cohort beacon broadcast; LIVE_CHANGE_ADDRESS + FUNDING_WINDOW_MS
  // tune the funded path. startDemoServer also reads these from process.env, so passing them
  // explicitly here just keeps the direct-invocation surface self-documenting.
  const live = process.env.LIVE === '1';
  const broadcast = process.env.BROADCAST === '1';
  const changeAddress = process.env.LIVE_CHANGE_ADDRESS || undefined;
  const fundingWindowMs = numericKnob('FUNDING_WINDOW_MS', process.env.FUNDING_WINDOW_MS, undefined, warn);
  startDemoServer({ port, host, minParticipants, cohortTtlMs, phaseTimeoutMs, live, broadcast, changeAddress, fundingWindowMs })
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
