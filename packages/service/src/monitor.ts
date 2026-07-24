/**
 * Per-service cohort monitoring fold: the read-model tracer for the operator's live
 * cohort view (SVC-03, Phase 4 D-19/D-27). This is the thinnest end-to-end monitoring
 * seam - runner membership events folded into a per-cohort detail projection served by
 * the gated `GET /v1/operator/cohorts/:id` read - proving the polled-snapshot
 * architecture on one honest fact (members + seats) before the deeper drill-down
 * surfaces and the dashboard-SSE retirement build on it in later plans.
 *
 * The {@link AggregationServiceRunner} emits membership milestones as they happen
 * (`opt-in-received` before the accept decision, `participant-accepted` when a seat is
 * granted, `keygen-complete` when the beacon address is known); the browser must survive
 * a fresh page load, so those fire-once frames are folded into a bounded per-service Map
 * keyed by cohortId and exposed as a single `detail(cohortId)` the console polls (D-19: a
 * poll of last-known state, NOT a second SSE).
 *
 * The design mirrors {@link file://./anchor-state.ts} `createAnchorState` (the proven
 * bounded-fold template, D-27) rather than entangling that public, frozen module:
 * - It is a per-service closure factory (never a module singleton), mirroring
 *   `createAnchorState` / `createOperatorCohorts`'s closure-scoped Maps, so two services
 *   in one process (tests) never share monitoring state.
 * - The entry Map is bounded at {@link MAX_MONITORED} with oldest-first (insertion-order)
 *   eviction, reusing the `remember()` idiom, so a long-running service cannot grow the
 *   map without bound (T-04-01-02, DoS) and every read stays a cheap projection.
 * - Members are folded from the monitor's OWN entry (each wall-clock stamped at receipt,
 *   because the runner supplies no timestamps, D-22), so an ENDED cohort that the session
 *   has already GC'd (`removeCohort`, RESEARCH Pitfall 2) still projects its members.
 *   Seats/phase/capacity are enriched live from `runner.session` for a cohort still in
 *   the live set, so an in-flight cohort reads its current seat count.
 * - The non-oracle default: an unknown/never-existed/evicted cohortId reads identically
 *   to a live one that simply has no members yet - `{ exists: false }` only when there is
 *   neither a fold entry nor a live cohort, never a distinct 404 shape (the route's
 *   requireOperator gate is the real anonymous boundary, T-04-01-01).
 *
 * Beyond the per-cohort `detail` members/seats projection, the monitor also folds each
 * cohort's lifecycle + terminal fate into a `summary()` (one status-chip row per live or
 * ended cohort) and `serviceMetrics()` (bounded live counts), which back the operator
 * cohort-list chips + metrics row (D-06/D-23), merged into `GET /v1/operator/cohorts`.
 *
 * The PER-MEMBER partial-signature leg is deliberately NOT read here: the runner exposes no
 * event or accessor for it (D-32, RESEARCH Finding 9), so the summary's `co-signing` chip is
 * phase-derived and later plans layer per-member submissions / co-sign / anchor / funding
 * honestly on top.
 */

import { bytesToHex } from '@noble/hashes/utils';
import type { Transaction } from '@scure/btc-signer';
import type { AggregationServiceEvents, AggregationServiceRunner } from '@did-btcr2/aggregation/service';
import type { BeaconBroadcaster } from './broadcast.js';
import type { AnchorReadDTO, AnchorState } from './anchor-state.js';
import type { FundingStateName } from './funding-watch.js';

/**
 * Upper bound on monitored cohort entries (mirrors the anchor-state / operator-cohorts
 * `MAX_TERMINAL` = 24 bound). Past this cap the OLDEST cohort entry is evicted so a
 * long-lived self-hosted service that advertises many cohorts cannot grow the fold map
 * without limit (T-04-01-02, DoS).
 */
const MAX_MONITORED = 24;

/**
 * Upper bound on retained ENDED-cohort records (mirrors {@link MAX_MONITORED} and the
 * anchor-state / operator-cohorts `MAX_TERMINAL` = 24 bound). Past this cap the OLDEST
 * ended record is evicted oldest-first so a long-lived service that anchors/fails many
 * cohorts cannot grow the ended map without limit (T-04-02-03, DoS). An anchored cohort
 * that ages out simply stops being counted - the metrics are a bounded live view, never a
 * since-boot cumulative (D-06).
 */
const MAX_TERMINAL = 24;

/**
 * Upper bound on the per-cohort activity ring (D-21). Past this cap the OLDEST entry is
 * evicted oldest-first so a long-lived, chatty cohort cannot grow its ring without limit
 * (T-04-04-03, DoS) while the operator still sees a deep-enough recent history. Sized well
 * above one cohort's full lifecycle event count (opt-ins + submissions + validations +
 * nonces + signing + broadcast frames) so a typical cohort never evicts mid-life.
 */
const ACTIVITY_RING_SIZE = 200;

/**
 * Cohort phases that count as OPEN/filling for the summary chip + open metric (mirrors
 * `operator-cohorts.ts` `OPEN_PHASES`): a cohort still discovering/gathering participants,
 * before signing starts. Kept as local string members so this module does not depend on
 * the library's phase enum value shape (same convention as operator-cohorts.ts).
 */
const OPEN_PHASES = new Set<string>(['Advertised', 'CohortSet', 'CollectingUpdates']);

/**
 * In-flight (mid co-sign) phases for the `co-signing` chip + inFlight metric (mirrors
 * `operator-cohorts.ts` `IN_FLIGHT_PHASES`): the cohort's signing round is under way. Kept
 * local for the same reason as {@link OPEN_PHASES}.
 */
const IN_FLIGHT_PHASES = new Set<string>(['SigningStarted', 'NoncesCollected', 'AwaitingPartialSigs']);

/** Whether a folded member has only opted in (`pending`) or been seated (`seated`). */
export type MemberStatus = 'pending' | 'seated';

/**
 * The per-member round state answering "who is holding this cohort up" (D-31), a forward
 * progression through the co-sign round: `seated` (accepted, nothing submitted yet) ->
 * `submitted` (signed update received) -> `validated` (approved the aggregated data) ->
 * `nonce-sent` (contributed a MuSig2 nonce). `rejected` is the off-path terminal for a
 * member whose message was dropped or who rejected validation; a rejection also lands in
 * the activity ring. This is deliberately NOT extended past `nonce-sent`: the per-member
 * partial-signature leg emits no runner event (D-32), so the monitor never claims it.
 */
export type MemberRound = 'seated' | 'submitted' | 'validated' | 'nonce-sent' | 'rejected';

/** Tone of one activity-ring entry (mirrors the client LogLevel): info/good/warn/bad. */
export type ActivityLevel = 'info' | 'good' | 'warn' | 'bad';

/**
 * One entry in a cohort's bounded activity ring (D-21/D-22). `id` is a per-cohort monotonic
 * sequence (stable across polls, so the client's LogPanel keys + auto-follow work); `t` is
 * the server wall-clock time (ms) the event was folded, because the runner supplies no
 * timestamps (D-22); `level` colors the line by event kind; `text` is the plain-language
 * summary. Raw protocol detail (pubkeys, signed-update JSON) lives behind the drill-down
 * expanders, never in the log text.
 */
export interface ActivityEntryDTO {
  id: number;
  t: number;
  level: ActivityLevel;
  text: string;
}

/**
 * One submission row in the drill-down (D-30): whether a seated member has submitted their
 * signed update yet and, if so, the server wall-clock time it was received (`at`, stamped at
 * receipt because the runner carries no timestamp). `raw` carries the member's signed-update
 * document for the `Raw signed update` technical expander, present only for a LIVE cohort
 * whose `pendingUpdates` the session still holds (an ended/GC'd cohort keeps the who/when
 * from the fold but drops the raw body). Operator-gated like the whole detail DTO (D-26).
 */
export interface SubmissionDTO {
  did: string;
  submitted: boolean;
  at?: number;
  raw?: unknown;
}

/**
 * Honest per-cohort co-sign progress (D-32). `noncesReceived` of `total` counts the members
 * who have contributed a MuSig2 nonce (an identified `nonce-received` event), so this leg is
 * a real observed count. `awaitingPartialSigs` flips true once every nonce is in but signing
 * has not completed - the honest signal for the partial-signature leg, which emits NO runner
 * event: there is deliberately NO partial-signature count anywhere in this shape (the
 * unobservable leg is never invented, prohibition + D-32).
 */
export interface CoSignDTO {
  noncesReceived: number;
  total: number;
  awaitingPartialSigs: boolean;
}

/**
 * Whether this cohort took the ADR-042 k-of-n script-path fallback (D-33). `used` is true
 * when `getResult().path === 'script-path'` or `fallback-started` fired; `k`/`n` are the
 * fallback threshold and cohort size when derivable from the live cohort (absent once the
 * session has GC'd the cohort, so the client discloses the fallback plainly without inventing
 * a count it can no longer read).
 */
export interface FallbackDTO {
  used: boolean;
  k?: number;
  n?: number;
}

/**
 * The live status-chip key for one cohort row, from the fixed UI-SPEC tone map (D-04): a
 * live cohort reads `filling` (seats filling) or `co-signing` (signing in flight);
 * `needs-funding` is the live-cohort funding-attention placeholder populated by the
 * live-path plan 04-06 (this plan never emits it); an ENDED cohort reads its terminal fate
 * `fallback` (anchored via the k-of-n script path, D-33), `anchored` (anchored via the
 * optimistic key path), or `failed`. The client maps each key to its Badge/StatusDot tone.
 */
export type CohortChip = 'filling' | 'co-signing' | 'needs-funding' | 'fallback' | 'anchored' | 'failed';

/**
 * One row in the operator cohort-list monitoring summary (D-06). Carries the live status
 * `chip`, the seat count + capacity, the raw phase (or `'ended'` for a retained terminal
 * record the session may have GC'd), and a short failure `reason` on a failed row. Derived
 * from the live set + retained ended records, never a since-boot cumulative.
 */
export interface CohortSummaryDTO {
  cohortId: string;
  chip: CohortChip;
  seatsJoined: number;
  capacity: number;
  phase: string;
  reason?: string;
}

/**
 * Service-level live counts for the operator metrics row (D-06): `open` (joinable/filling),
 * `inFlight` (mid co-sign), `anchored` (successfully anchored, INCLUDING the k-of-n
 * fallback path - both put the beacon tx on-chain), and `failed` (terminal). Derived from
 * the live set + the bounded retained ended records; NEVER a cumulative since-boot counter
 * (an anchored cohort evicted past the {@link MAX_TERMINAL} cap stops being counted, D-06).
 */
export interface ServiceMetricsDTO {
  open: number;
  inFlight: number;
  anchored: number;
  failed: number;
}

/**
 * The resolved broadcast mode of the service (D-17), for the operator health strip. `hermetic`
 * is the fixture co-sign path (no chain); `live-no-broadcast` builds a real beacon tx on a live
 * esplora but never pushes it (the middle mode, reachable programmatically but not via env);
 * `live` broadcasts each cohort's beacon tx on-chain. Derived ONCE at construction from the
 * live/broadcast wiring in {@link file://./index.ts}, never re-derived per read.
 */
export type ServiceMode = 'hermetic' | 'live-no-broadcast' | 'live';

/**
 * The service-level health the operator strip renders honestly (D-17/D-43): the resolved
 * {@link ServiceMode} and an esplora-reachability bit. `esploraReachable` is `'n/a'` on the
 * hermetic path (no esplora is contacted), else a boolean that the live-path funding watch /
 * confirm poll flips via {@link CohortMonitor.noteEsploraObservation}. A `false` reading means a
 * mid-flight esplora outage: the strip flips, but every cohort's last-known chip/detail stays
 * frozen (stale-honest, D-43) while the retry/confirm machinery keeps working underneath.
 */
export interface ServiceHealthDTO {
  mode: ServiceMode;
  esploraReachable: boolean | 'n/a';
}

/**
 * The operator-facing funding view for a live+broadcast cohort (D-36 through D-43), fed by the
 * live-path funding watch via {@link CohortMonitor.noteFunding}. Carries the honest funding
 * `state`, the ONE suggested minimum (D-37), the beacon address (+ a derived explorer URL) the
 * operator funds, the always-disclosed recovery-key state (D-40), the mainnet real-money flag +
 * change-routing bit (D-42), the truncated-window disclosure when the wait clamped the window
 * (D-38), and the esplora-stale bit for a mid-flight observation gap (D-43). Present ONLY for a
 * live+broadcast cohort; a hermetic cohort never carries it (the funding stage cannot exist on the
 * fixture path). The recovery-key VALUE is never serialized, only its STATE (T-04-06-04).
 */
export interface FundingView {
  state: FundingStateName;
  suggestedMinSats: number;
  beaconAddress: string;
  /** Block-explorer URL for {@link beaconAddress}, present only when the network derives one. */
  explorerUrl?: string;
  /** `operator-held` when the operator supplied RECOVERY_KEY; `throwaway` when it was auto-derived (D-40). */
  recoveryKeyState: 'operator-held' | 'throwaway';
  /** True on a mainnet cohort: the funding stage adds the real-money + change-routing lines (D-42). */
  mainnet: boolean;
  /** True when a LIVE_CHANGE_ADDRESS redirects change off the beacon address (D-42). */
  changeAddressRedirected: boolean;
  /** The clamped window in whole minutes, present ONLY when the remaining TTL truncated it (D-38). */
  truncatedWindowMin?: number;
  /** True when the last funding observation FAILED (esplora outage): the state below is frozen stale (D-43). */
  esploraStale: boolean;
  /**
   * The terminal lapse outcome, set ONLY once the cohort has failed for want of funding (D-38/D-39):
   * `window-closed` when the funding window lapsed on a successful (observed) read, `blind-lapse`
   * when an esplora gap spanned the lapse so whether funds arrived is unknown. Absent while the
   * cohort is still live. Never claimed on a blind lapse as a definite "funding never arrived".
   */
  terminal?: 'window-closed' | 'blind-lapse';
}

/** The terminal chip of a retained ended-cohort record (a strict subset of {@link CohortChip}). */
type EndedChip = 'anchored' | 'fallback' | 'failed';

/**
 * A retained ended-cohort record (D-23): its terminal chip plus the seats/capacity snapshot
 * taken AT EVENT TIME (Pitfall 2), so a cohort the session has already GC'd
 * (`removeCohort`) still projects an honest bounded fate instead of vanishing without a
 * trace. `reason` is the short failure message on a `failed` record.
 */
interface EndedRecord {
  chip: EndedChip;
  seatsJoined: number;
  capacity: number;
  reason?: string;
}

/**
 * One member in a cohort's monitoring projection. `did` is the participant DID;
 * `status` distinguishes a pending opt-in from a seated member (D-29); `since` is the
 * server wall-clock time (ms) the member was first observed, stamped at event receipt
 * because the runner carries no timestamps (D-22).
 */
export interface CohortMemberDTO {
  did: string;
  status: MemberStatus;
  since: number;
  /**
   * The per-member round state (D-31). A pending opt-in carries `seated` as an inert default
   * (the drill-down renders a pending member by its `status`, not its `round`), so the round
   * chip only surfaces for seated members that have actually progressed through the co-sign
   * round.
   */
  round: MemberRound;
  /**
   * The member's compressed signing public key (hex), captured from the opt-in payload. It
   * sits behind the drill-down's `Technical detail` expander only (D-28), never on the plain
   * row; absent for a member first observed on a later round event (no opt-in payload seen).
   */
  participantPk?: string;
  /** The member's communication public key (hex), same expander-only disclosure as {@link participantPk} (D-28). */
  communicationPk?: string;
}

/**
 * The gated wire shape of one cohort's monitoring detail (operator-only, D-26). Carries
 * only the tracer-scope facts: the member list (pending vs seated), the seat count and
 * capacity, and the current phase. `exists` is false ONLY for an unknown/evicted cohort
 * with no live-set presence, so a never-existed and an evicted cohort read identically
 * (no existence oracle beyond the route's requireOperator gate). `phase` is the raw
 * library phase string, or `'unknown'` for an ended/evicted cohort the session no longer
 * holds.
 */
export interface CohortDetailDTO {
  exists: boolean;
  members: CohortMemberDTO[];
  seatsJoined: number;
  capacity: number;
  phase: string;
  /** Who has and has not submitted their signed update, with wall-clock times (D-30). */
  submissions: SubmissionDTO[];
  /** Honest co-sign progress: nonces k/n plus the awaiting-partial-sigs flag, never a partial-sig count (D-32). */
  coSign: CoSignDTO;
  /**
   * The operator's anchor view, composed from the injected anchor-state read (D-18). A
   * broadcasting service surfaces the real Signed -> Broadcast -> Confirmed lifecycle; a
   * hermetic (no-broadcast) service reads `{ enabled: false, state: 'none' }` so the
   * drill-down honestly shows there is no on-chain anchor. The public anchor read is
   * byte-untouched (this is the SAME projection, not a second fold).
   */
  anchor: AnchorReadDTO;
  /** Whether the cohort took the k-of-n fallback path, with k/n when derivable (D-33). */
  fallback: FallbackDTO;
  /** The bounded per-cohort activity ring, server wall-clock stamped, oldest-first (D-21/D-22). */
  activity: ActivityEntryDTO[];
  /**
   * The operator funding view, present ONLY for a live+broadcast cohort whose funding watch has
   * reported at least once (D-36 through D-43). Absent on a hermetic cohort (no funding stage on
   * the fixture path) and before the first watch reading lands.
   */
  funding?: FundingView;
}

/**
 * The full monitoring export record for one cohort (D-34): the detail DTO (which already
 * carries the activity ring) plus a `cohortId` and `exportedAt` stamp. Off-chain artifacts
 * are referenced by hash at `/cas/`, never inlined - only the signed-update bodies the
 * detail already surfaces to the operator cross here, nothing more.
 */
export interface CohortExportDTO extends CohortDetailDTO {
  cohortId: string;
  exportedAt: number;
}

/** The gated per-cohort read surface backed by the fold. */
export interface CohortMonitor {
  /**
   * Last-known monitoring detail for a cohort. A pure projection: polling twice with no
   * intervening runner event returns deep-equal DTOs (idempotent, no side effect). An
   * unknown/evicted cohortId with no live-set presence reads as the non-oracle
   * `{ exists: false, members: [], seatsJoined: 0, capacity: 0, phase: 'unknown' }`.
   */
  detail(cohortId: string): CohortDetailDTO;
  /**
   * One {@link CohortSummaryDTO} row per live (filling / co-signing) cohort PLUS one per
   * retained ended record (anchored / fallback / failed), for the operator cohort-list
   * chips (D-06/D-23). A pure projection over the live set + the bounded ended map. An
   * ended cohort the session has GC'd still appears (its fate was captured at event time),
   * and a live cohort and its later ended record never double-count.
   */
  summary(): CohortSummaryDTO[];
  /**
   * Service-level live counts ({@link ServiceMetricsDTO}) for the operator metrics row:
   * open / inFlight from the live set, anchored / failed from the retained ended records.
   * Never a cumulative since-boot total (D-06).
   */
  serviceMetrics(): ServiceMetricsDTO;
  /**
   * The full monitoring export record for a cohort (D-34): the same detail projection the
   * drill-down shows plus the activity ring, `cohortId`, and an `exportedAt` stamp, all
   * plain JSON-serializable. Off-chain artifacts stay referenced by hash at `/cas/`.
   */
  exportRecord(cohortId: string): CohortExportDTO;
  /**
   * Service-level health for the operator strip (D-17/D-43): the resolved {@link ServiceMode}
   * and the esplora-reachability bit (`'n/a'` on hermetic). A pure projection over the mode
   * fixed at construction plus the last {@link noteEsploraObservation} reading.
   */
  serviceHealth(): ServiceHealthDTO;
  /**
   * Record the outcome of a live esplora observation (D-43), flipping the reachability bit the
   * {@link serviceHealth} strip renders. Called by the live-path funding watch / confirm poll on
   * each success (`true`) or failure (`false`). A no-op on the hermetic path (no esplora is
   * contacted, so the bit stays `'n/a'`). It NEVER touches any cohort's fold state, so a `false`
   * reading leaves every last-known chip/detail frozen (stale-honest, not a fabricated state).
   */
  noteEsploraObservation(ok: boolean): void;
  /**
   * Record the latest operator funding view for a live+broadcast cohort (D-36 through D-43), fed
   * by the live-path funding watch in {@link file://./index.ts}. The view rides the gated per-cohort
   * detail read and drives the `needs-funding` attention chip on the summary list until the cohort
   * is `funded` (D-44). A no-op on the hermetic path: a hermetic monitor never serves a funding
   * view even if this is (defensively) called, because the funding stage cannot exist off-chain.
   */
  noteFunding(cohortId: string, view: FundingView): void;
  /**
   * The PUBLIC, non-oracle funding signal for a cohort (D-44), backing the anonymous
   * `GET /v1/funding/:cohortId` read a seated participant polls. Returns ONLY an
   * `awaitingFunding` boolean, and ONLY `true` for a live+broadcast cohort whose funding
   * state is still `waiting` or `awaiting-confirmation` (the operator has not yet funded the
   * beacon address). Everything else reads `false`: a hermetic/live-no-broadcast service (no
   * funding stage exists off-chain), a funded/dead-end cohort, and an unknown/never-existed
   * cohortId - so the read can never leak an amount, a key, or a cohort's existence beyond a
   * single waiting bit (T-04-07-01). Distinct from {@link noteFunding}'s rich operator view:
   * this is the anonymous participant projection, deliberately stripped to one boolean.
   */
  publicFunding(cohortId: string): { awaitingFunding: boolean };
}

/**
 * The non-oracle answer for an unknown/evicted cohort with no live-set presence. The anchor
 * view still reflects the injected anchor state (mode-honest): a broadcasting service reads
 * `{ enabled: true, state: 'none' }`, a hermetic one `{ enabled: false, state: 'none' }`.
 */
function absentDetail(anchor: AnchorReadDTO): CohortDetailDTO {
  return {
    exists: false,
    members: [],
    seatsJoined: 0,
    capacity: 0,
    phase: 'unknown',
    submissions: [],
    coSign: { noncesReceived: 0, total: 0, awaitingPartialSigs: false },
    anchor,
    fallback: { used: false },
    activity: [],
  };
}

/** The internal folded member record: the wire fields plus a private submission stamp. */
interface MemberRecord {
  did: string;
  status: MemberStatus;
  since: number;
  round: MemberRound;
  /** Server wall-clock (ms) the member's signed update was received, stamped at receipt (D-30). */
  submittedAt?: number;
  /** Hex-encoded signing / communication public keys from the opt-in payload (D-28, expander-only). */
  participantPk?: string;
  communicationPk?: string;
}

/** The internal folded entry for one cohort: its members plus event-time enrichment. */
interface MonitorEntry {
  /**
   * Members keyed by DID, insertion-ordered (Map preserves insertion order) so the
   * projection lists them in the order they were first observed. A pending opt-in is
   * promoted in place to seated on acceptance, keeping its original `since` stamp.
   */
  members: Map<string, MemberRecord>;
  /**
   * Last-known cohort capacity (n seats), snapshotted from the live session at each
   * membership event so an ended cohort (GC'd from the session) still projects its
   * capacity. 0 until a live cohort is observed for it.
   */
  capacity: number;
  /** The beacon address, recorded at `keygen-complete` (D-44 funding stage seed; unused in the tracer DTO). */
  beaconAddress?: string;
  /**
   * True once `fallback-started` fired for this cohort (the optimistic n-of-n key path was
   * abandoned for the ADR-042 k-of-n script path). Used to tag the ended record `fallback`
   * even if the `signing-complete` result's `path` is absent (belt-and-suspenders, D-33).
   */
  fellBack?: boolean;
  /** DIDs that have contributed a MuSig2 nonce, so the co-sign k/n count is a real observed set (D-32). */
  noncesSent: Set<string>;
  /** True once `signing-complete` fired: freezes `awaitingPartialSigs` back to false (the leg finished). */
  signingComplete: boolean;
  /** The bounded activity ring (oldest-first), server wall-clock stamped (D-21/D-22). */
  activity: ActivityEntryDTO[];
  /** Per-cohort monotonic activity id, so a poll never re-keys an existing log line. */
  activitySeq: number;
}

/**
 * Guard a payload accessor that may throw. Lifted VERBATIM from the retired
 * `dashboard-sse.ts` (D-19) before its deletion: the fixture beacon tx throws on several
 * `@scure/btc-signer` accessors (notably `tx.fee`, whose dummy prevout carries no amount),
 * so every field read that shapes a tx/activity payload must be individually guarded.
 */
function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Shorten a DID for the plain-language activity log text (the full DID still rides the
 * Members section behind a copy-full field). Keeps the method prefix + a head/tail slice so
 * a log line stays readable without wrapping; a short DID is returned unchanged.
 */
function shortDid(did: string): string {
  return did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did;
}

/**
 * A JSON-safe summary of a signed beacon transaction (no raw bytes). Lifted VERBATIM from
 * the retired `dashboard-sse.ts` so the deeper drill-down plans (anchor / activity, 04-04+)
 * keep ONE tested home for the tx-summary shape rather than re-deriving it. `tx.fee` throws
 * when fixture inputs carry no prevout amount, so it is guarded and kept last; a missing fee
 * must never drop the frame.
 */
export function summarizeTx(tx: Transaction): Record<string, unknown> {
  return {
    txid: safe(() => tx.id),
    version: safe(() => tx.version),
    inputs: safe(() => tx.inputsLength),
    outputs: safe(() => tx.outputsLength),
    vsize: safe(() => tx.vsize),
    weight: safe(() => tx.weight),
    // tx.fee throws when fixture inputs carry no prevout amount, so guard it and keep it
    // last; a missing fee must never drop the signing-complete frame.
    fee: safe(() => Number(tx.fee)),
  };
}

/**
 * Convert a runner event payload into a JSON-serializable shape (hex-encoded pubkeys,
 * summarized tx). Lifted VERBATIM from the retired `dashboard-sse.ts` (D-19); the member /
 * activity fold of the later drill-down plans reuses it to shape per-event payloads without
 * leaking raw `Uint8Array` bytes to the operator wire.
 */
export function serialize(event: keyof AggregationServiceEvents, payload: unknown): unknown {
  const p = payload as Record<string, unknown>;
  switch (event) {
    case 'opt-in-received':
      return {
        cohortId: p.cohortId,
        participantDid: p.participantDid,
        participantPk: p.participantPk ? bytesToHex(p.participantPk as Uint8Array) : undefined,
        communicationPk: p.communicationPk ? bytesToHex(p.communicationPk as Uint8Array) : undefined,
      };
    case 'signing-complete': {
      const signature = p.signature as Uint8Array | undefined;
      return {
        cohortId: p.cohortId,
        path: p.path ?? 'key-path',
        signature: signature && signature.length > 0 ? bytesToHex(signature) : '',
        signedTx: p.signedTx ? summarizeTx(p.signedTx as Transaction) : undefined,
      };
    }
    case 'error':
      return { message: payload instanceof Error ? payload.message : String(payload) };
    default:
      // The remaining events carry only strings/numbers/booleans (JSON-safe).
      return payload;
  }
}

/**
 * Build the per-service cohort monitor. Subscribes ONCE to the runner's membership +
 * lifecycle events (and, when supplied, the {@link BeaconBroadcaster} frames) and folds
 * them into two bounded per-cohort Maps: the live `entries` fold (members/seats, backing
 * `detail`) and the retained `ended` set (terminal fate, backing the `summary` chips +
 * `serviceMetrics`). `detail(cohortId)` projects the live fold; `summary()` /
 * `serviceMetrics()` project the live set + the ended set.
 *
 * The optional `broadcaster` (present only when the service broadcasts on-chain) refines
 * the terminal fate: a co-signed cohort whose beacon-tx broadcast then FAILS reads
 * `failed`, not `anchored`, so the operator sees the honest on-chain outcome (D-18/D-23).
 *
 * The listeners are fire-and-forget (a thrown handler is caught and logged, never
 * rejected back to the runner), matching the persist/broadcast `.catch` discipline in
 * {@link file://./index.ts}: a monitoring failure must never disturb the protocol.
 */
export function createCohortMonitor(
  runner: AggregationServiceRunner,
  broadcaster?: BeaconBroadcaster,
  anchorState?: AnchorState,
  mode?: ServiceMode,
): CohortMonitor {
  // The resolved broadcast mode (D-17), fixed at construction. When the caller does not supply
  // one, derive the honest binary from the wiring available here: a broadcaster present means
  // the service broadcasts (`live`); otherwise `hermetic`. The `live-no-broadcast` middle mode
  // is indistinguishable from hermetic without the caller's knowledge of the live esplora
  // connection, so index.ts passes it explicitly (the funding watch is a live-esplora path).
  const serviceMode: ServiceMode = mode ?? (broadcaster ? 'live' : 'hermetic');
  // Last esplora observation (D-43). Starts reachable on a live path (optimistic until a failed
  // observation); irrelevant on hermetic, where serviceHealth reports `'n/a'`. Flipped ONLY by
  // noteEsploraObservation, never by a fold listener, so it can never mutate cohort state.
  let esploraReachable = true;
  /**
   * The operator anchor view for a cohort: the SAME projection the public read serves,
   * composed from the injected {@link anchorState} (byte-untouched, D-26), or the mode-honest
   * `{ enabled: false, state: 'none' }` for a hermetic (non-broadcasting) service that wired
   * no anchor state at all.
   */
  const anchorView = (cohortId: string): AnchorReadDTO =>
    anchorState ? anchorState.read(cohortId) : { enabled: false, state: 'none' };
  const entries = new Map<string, MonitorEntry>();
  /**
   * Retained terminal records (D-23), keyed by cohortId, bounded at {@link MAX_TERMINAL}
   * oldest-first. Captured AT EVENT TIME so a session-GC'd cohort still projects its fate.
   */
  const ended = new Map<string, EndedRecord>();
  /**
   * Latest operator funding view per live+broadcast cohort (D-36 through D-43), set by the live-path
   * funding watch via {@link noteFunding}. Never populated on the hermetic path. Unbounded is fine:
   * one entry per live cohort, and the live cohort set is itself bounded by the runner's session.
   */
  const fundingViews = new Map<string, FundingView>();

  /** Get-or-create a cohort entry WITHOUT touching insertion order (that is `remember`'s job). */
  function entryFor(cohortId: string): MonitorEntry {
    let entry = entries.get(cohortId);
    if (!entry) {
      entry = {
        members: new Map(),
        capacity: 0,
        noncesSent: new Set(),
        signingComplete: false,
        activity: [],
        activitySeq: 0,
      };
      entries.set(cohortId, entry);
    }
    return entry;
  }

  /**
   * Get-or-create a member record for a DID on an entry. A DID that first appears on a
   * round event (update/validation/nonce/reject) without a prior opt-in is recorded as a
   * seated member, wall-clock stamped at receipt: it is participating, so seated is honest.
   */
  function memberFor(entry: MonitorEntry, did: string): MemberRecord {
    let member = entry.members.get(did);
    if (!member) {
      member = { did, status: 'seated', since: Date.now(), round: 'seated' };
      entry.members.set(did, member);
    }
    return member;
  }

  /**
   * Append one entry to a cohort's bounded activity ring (D-21), evicting the OLDEST past
   * {@link ACTIVITY_RING_SIZE}. `t` is stamped here (server wall-clock) because the runner
   * carries no timestamps (D-22); `id` is the per-cohort monotonic sequence so the client
   * LogPanel's key + auto-follow stay stable across polls.
   */
  function appendActivity(entry: MonitorEntry, level: ActivityLevel, text: string): void {
    entry.activity.push({ id: entry.activitySeq, t: Date.now(), level, text });
    entry.activitySeq += 1;
    while (entry.activity.length > ACTIVITY_RING_SIZE) {
      entry.activity.shift();
    }
  }

  /**
   * Refresh a cohort's insertion order (so a progressing cohort stays "fresh" and is not
   * evicted mid-life) and evict the oldest entry past the cap. Mirrors anchor-state's
   * `remember`: delete-then-set moves the key to the end of the insertion order.
   */
  function remember(cohortId: string, entry: MonitorEntry): void {
    entries.delete(cohortId);
    entries.set(cohortId, entry);
    while (entries.size > MAX_MONITORED) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      entries.delete(oldest);
    }
  }

  /** Snapshot the live cohort's capacity (n seats) at event time so ended cohorts keep it. */
  function snapshotCapacity(cohortId: string, entry: MonitorEntry): void {
    // `minParticipants` IS the seat count n: the operator model pins min === max === n, so
    // this is the cohort's capacity (operator-cohorts.ts D-11). Absent when the cohort is
    // not (yet) in the live set - keep the last-known value rather than zeroing it.
    const capacity = runner.session.getCohort(cohortId)?.minParticipants;
    if (typeof capacity === 'number') {
      entry.capacity = capacity;
    }
  }

  /**
   * Snapshot a cohort's seats + capacity AT EVENT TIME (Pitfall 2): prefer the live cohort
   * (authoritative seat count), else fall back to the monitor's own fold (seated members +
   * last-known capacity snapshot), so a cohort the session has already GC'd still records
   * honest ended numbers instead of zeros.
   */
  function snapshotSeats(cohortId: string): { seatsJoined: number; capacity: number } {
    const cohort = runner.session.getCohort(cohortId);
    if (cohort) {
      return { seatsJoined: cohort.participants.length, capacity: cohort.minParticipants };
    }
    const entry = entries.get(cohortId);
    if (entry) {
      const seatsJoined = [...entry.members.values()].filter((m) => m.status === 'seated').length;
      return { seatsJoined, capacity: entry.capacity };
    }
    return { seatsJoined: 0, capacity: 0 };
  }

  /**
   * Record a cohort's terminal outcome, evicting the OLDEST ended record past the cap
   * (Map preserves insertion order; delete-then-set refreshes a re-recorded cohort to the
   * end). Mirrors the anchor-state `remember` idiom so the ended set stays bounded (DoS).
   */
  function rememberEnded(cohortId: string, record: EndedRecord): void {
    ended.delete(cohortId);
    ended.set(cohortId, record);
    while (ended.size > MAX_TERMINAL) {
      const oldest = ended.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      ended.delete(oldest);
    }
  }

  /** Run a fold body defensively: a thrown listener must never reject back to the runner. */
  function safely(what: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[monitor] ${what} fold failed: ${message}`);
    }
  }

  // opt-in-received fires BEFORE the accept decision (this is D-29's pending signal):
  // record the participant as a PENDING member, wall-clock stamped at receipt.
  runner.on('opt-in-received', ({ cohortId, participantDid, participantPk, communicationPk }) => {
    safely('opt-in-received', () => {
      const entry = entryFor(cohortId);
      if (!entry.members.has(participantDid)) {
        entry.members.set(participantDid, {
          did: participantDid,
          status: 'pending',
          since: Date.now(),
          round: 'seated',
          // Capture the pubkeys for the Technical detail expander (D-28). Guarded because a
          // malformed opt-in (the fire-and-forget defensive test) may omit them.
          ...(participantPk ? { participantPk: bytesToHex(participantPk) } : {}),
          ...(communicationPk ? { communicationPk: bytesToHex(communicationPk) } : {}),
        });
        appendActivity(entry, 'info', `${shortDid(participantDid)} opted in.`);
      }
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // participant-accepted grants a seat: promote the member to SEATED in place (keeping its
  // original `since`), or record it seated directly if no opt-in was folded first.
  runner.on('participant-accepted', ({ cohortId, participantDid }) => {
    safely('participant-accepted', () => {
      const entry = entryFor(cohortId);
      const existing = entry.members.get(participantDid);
      if (existing) {
        existing.status = 'seated';
      } else {
        entry.members.set(participantDid, {
          did: participantDid,
          status: 'seated',
          since: Date.now(),
          round: 'seated',
        });
      }
      appendActivity(entry, 'good', `${shortDid(participantDid)} was seated.`);
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // keygen-complete carries the beacon address (D-44 funding-stage seed for a later plan);
  // record it so an ended cohort keeps it, and refresh the capacity snapshot.
  runner.on('keygen-complete', ({ cohortId, beaconAddress }) => {
    safely('keygen-complete', () => {
      const entry = entryFor(cohortId);
      entry.beaconAddress = beaconAddress;
      appendActivity(entry, 'info', 'Keygen finalized. The beacon address is ready.');
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // update-received: a seated member submitted their signed update (D-30). Mark the member
  // `submitted` and wall-clock stamp the receipt (the payload carries no timestamp, D-22).
  runner.on('update-received', ({ cohortId, participantDid }) => {
    safely('update-received', () => {
      const entry = entryFor(cohortId);
      const member = memberFor(entry, participantDid);
      if (member.round !== 'rejected') {
        member.round = 'submitted';
      }
      member.submittedAt = Date.now();
      appendActivity(entry, 'info', `${shortDid(participantDid)} submitted an update.`);
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // validation-received: a member acknowledged the aggregated data. Approved advances the
  // member to `validated`; a rejection marks it `rejected` and lands a bad-tone activity line
  // (a validation reject is one of the "who is holding this cohort up" answers, D-31).
  runner.on('validation-received', ({ cohortId, participantDid, approved }) => {
    safely('validation-received', () => {
      const entry = entryFor(cohortId);
      const member = memberFor(entry, participantDid);
      if (approved) {
        if (member.round !== 'rejected') {
          member.round = 'validated';
        }
        appendActivity(entry, 'good', `${shortDid(participantDid)} validated the aggregated data.`);
      } else {
        member.round = 'rejected';
        appendActivity(entry, 'bad', `${shortDid(participantDid)} rejected the aggregated data.`);
      }
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // message-rejected: the state machine silently dropped an inbound message (bad proof,
  // oversized, wrong version). Unlike the bare `error` event it IS cohort-attributed
  // (planning note 2): mark the sender `rejected` and append the reason to the activity ring.
  runner.on('message-rejected', ({ cohortId, from, code, reason }) => {
    safely('message-rejected', () => {
      const entry = entryFor(cohortId);
      const member = memberFor(entry, from);
      member.round = 'rejected';
      appendActivity(entry, 'bad', `Rejected a message from ${shortDid(from)}: ${reason} (${code}).`);
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // signing-started: the co-sign round opened (its phase now drives the `co-signing` chip).
  runner.on('signing-started', ({ cohortId }) => {
    safely('signing-started', () => {
      const entry = entryFor(cohortId);
      appendActivity(entry, 'info', 'Signing round started.');
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // nonce-received: a member contributed their MuSig2 nonce (an IDENTIFIED co-sign event, so
  // the k/n count is a real observed set, D-32). Mark the member `nonce-sent` and record the
  // DID so `coSign.noncesReceived` counts unique contributors.
  runner.on('nonce-received', ({ cohortId, participantDid }) => {
    safely('nonce-received', () => {
      const entry = entryFor(cohortId);
      const member = memberFor(entry, participantDid);
      if (member.round !== 'rejected') {
        member.round = 'nonce-sent';
      }
      entry.noncesSent.add(participantDid);
      appendActivity(entry, 'info', `${shortDid(participantDid)} sent their signing nonce.`);
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // fallback-started: the optimistic n-of-n key path was abandoned for the ADR-042 k-of-n
  // script path. Tag the entry so the eventual ended record reads `fallback` even if the
  // signing-complete result's `path` is absent (D-33 belt-and-suspenders).
  runner.on('fallback-started', ({ cohortId }) => {
    safely('fallback-started', () => {
      const entry = entryFor(cohortId);
      entry.fellBack = true;
      appendActivity(entry, 'warn', 'Falling back to the k-of-n signing path.');
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // signing-complete: the cohort anchored (co-sign succeeded). Capture the terminal record
  // AT EVENT TIME (Pitfall 2) so it survives the session GC. `fallback` when the k-of-n
  // script path produced the tx (result.path === 'script-path', or fallback-started fired),
  // else `anchored`. On a broadcasting service this is refined by the broadcaster frames
  // below (a broadcast that then fails flips it to `failed`).
  runner.on('signing-complete', (result) => {
    safely('signing-complete', () => {
      const cohortId = result.cohortId;
      const entry = entries.get(cohortId);
      const viaFallback = result.path === 'script-path' || entry?.fellBack === true;
      // Mark the co-sign leg done so `awaitingPartialSigs` flips back to false (the partial
      // signatures arrived, so the honest awaiting line clears) and log the completion.
      if (entry) {
        entry.signingComplete = true;
        appendActivity(entry, 'good', 'Co-signing complete.');
      }
      const { seatsJoined, capacity } = snapshotSeats(cohortId);
      rememberEnded(cohortId, { chip: viaFallback ? 'fallback' : 'anchored', seatsJoined, capacity });
    });
  });

  // cohort-failed carries an attributed cohortId + reason (unlike the bare `error` event,
  // which has neither, planning note 2): record a terminal `failed` record with its reason.
  runner.on('cohort-failed', ({ cohortId, reason }) => {
    safely('cohort-failed', () => {
      const entry = entries.get(cohortId);
      if (entry) {
        appendActivity(entry, 'bad', `Cohort failed: ${reason || 'cohort failed'}.`);
      }
      const { seatsJoined, capacity } = snapshotSeats(cohortId);
      rememberEnded(cohortId, { chip: 'failed', seatsJoined, capacity, reason: reason || 'cohort failed' });
    });
  });

  // Broadcaster frames (live broadcasting services only) refine the on-chain fate. A
  // beacon-tx broadcast that FAILS after a successful co-sign is an honest `failed` outcome
  // (the tx never anchored), so it overrides the anchored record from signing-complete. A
  // confirmed anchor reinforces the anchored/fallback record (kept fresh at event time); a
  // pending (confirmed:false) frame is NOT terminal and is left to the signing-complete
  // record so "Anchored" is reserved for a real confirmation (D-18).
  if (broadcaster) {
    // A broadcast frame (accepted to the network) is folded into the activity ring so the
    // operator sees the on-chain progression in the log too, in step with the anchor view.
    broadcaster.on('beacon-broadcast', ({ cohortId, txid }) => {
      safely('beacon-broadcast', () => {
        const entry = entries.get(cohortId);
        if (entry) {
          appendActivity(entry, 'info', `Beacon tx broadcast (${txid.slice(0, 12)}…).`);
        }
      });
    });
    broadcaster.on('beacon-broadcast-failed', ({ cohortId, reason }) => {
      safely('beacon-broadcast-failed', () => {
        const entry = entries.get(cohortId);
        if (entry) {
          appendActivity(entry, 'bad', `Beacon broadcast failed: ${reason || 'broadcast failed'}.`);
        }
        const { seatsJoined, capacity } = snapshotSeats(cohortId);
        rememberEnded(cohortId, { chip: 'failed', seatsJoined, capacity, reason: reason || 'broadcast failed' });
      });
    });
    broadcaster.on('beacon-anchored', ({ cohortId, confirmed }) => {
      if (!confirmed) {
        return;
      }
      safely('beacon-anchored', () => {
        const entry = entries.get(cohortId);
        if (entry) {
          appendActivity(entry, 'good', 'Beacon tx confirmed on-chain.');
        }
        // Preserve a fallback tag if signing-complete already recorded one; a confirmed
        // anchor of an optimistic-path cohort stays `anchored`.
        const viaFallback = ended.get(cohortId)?.chip === 'fallback';
        const { seatsJoined, capacity } = snapshotSeats(cohortId);
        rememberEnded(cohortId, { chip: viaFallback ? 'fallback' : 'anchored', seatsJoined, capacity });
      });
    });
  }

  /**
   * The shared detail projection backing both `detail` and `exportRecord`. A pure read over
   * the fold + the live session: it composes the members (with round state), submissions
   * (who/when + the live raw signed-update body), honest co-sign progress, the anchor view,
   * the fallback flag, and the bounded activity ring. Never mutates state.
   */
  function buildDetail(cohortId: string): CohortDetailDTO {
    const entry = entries.get(cohortId);
    const cohort = runner.session.getCohort(cohortId);
    const anchor = anchorView(cohortId);
    // Neither a fold entry nor a live cohort: the non-oracle absent answer. An advertised
    // cohort with nobody joined still has a live cohort (no entry yet), so it reads
    // exists:true with an empty member list and its real seat count.
    if (!entry && !cohort) {
      return absentDetail(anchor);
    }
    // Members always come from the OWN fold so an ended (session-GC'd) cohort still projects
    // its members; a live cohort with no opt-ins yet simply has none.
    const members: CohortMemberDTO[] = entry
      ? [...entry.members.values()].map((m) => ({
          did: m.did,
          status: m.status,
          since: m.since,
          round: m.round,
          ...(m.participantPk !== undefined ? { participantPk: m.participantPk } : {}),
          ...(m.communicationPk !== undefined ? { communicationPk: m.communicationPk } : {}),
        }))
      : [];

    // Seats + capacity + phase: prefer the authoritative live session, else the fold snapshot.
    const seatsJoined = cohort
      ? cohort.participants.length
      : members.filter((m) => m.status === 'seated').length;
    const capacity = cohort ? cohort.minParticipants : entry ? entry.capacity : 0;
    const phase = cohort ? runner.session.getCohortPhase(cohortId) ?? 'unknown' : 'unknown';

    // Submissions (D-30): one row per seated member. `submitted` is true when the fold saw an
    // `update-received` (round advanced) or the live cohort still holds a pending update; the
    // raw signed-update body rides only from the LIVE pendingUpdates (an ended cohort keeps
    // the who/when but drops the raw body once the session GC's it).
    const pendingUpdates = cohort?.pendingUpdates;
    const submissions: SubmissionDTO[] = entry
      ? [...entry.members.values()]
          .filter((m) => m.status === 'seated')
          .map((m) => {
            const submitted =
              m.round === 'submitted' ||
              m.round === 'validated' ||
              m.round === 'nonce-sent' ||
              (pendingUpdates?.has(m.did) ?? false);
            const raw = pendingUpdates?.get(m.did);
            return {
              did: m.did,
              submitted,
              ...(m.submittedAt !== undefined ? { at: m.submittedAt } : {}),
              ...(raw !== undefined ? { raw } : {}),
            };
          })
      : [];

    // Honest co-sign progress (D-32): nonces are a real observed set; `awaitingPartialSigs`
    // flips true only once every nonce is in and signing has NOT completed. There is NO
    // partial-signature count anywhere - the leg that emits no event is never invented.
    const noncesReceived = entry ? entry.noncesSent.size : 0;
    const coSign: CoSignDTO = {
      noncesReceived,
      total: capacity,
      awaitingPartialSigs:
        capacity > 0 && noncesReceived >= capacity && !(entry?.signingComplete ?? false),
    };

    // Fallback (D-33): `used` from the live result path or the folded fallback-started tag;
    // k/n only when the live cohort is still readable (absent once GC'd, disclosed plainly).
    const result = safe(() => runner.session.getResult(cohortId));
    const used = result?.path === 'script-path' || entry?.fellBack === true;
    const k = cohort ? cohort.effectiveFallbackThreshold : undefined;
    const fallback: FallbackDTO = {
      used,
      ...(k !== undefined && k > 0 ? { k } : {}),
      ...(capacity > 0 ? { n: capacity } : {}),
    };

    // Funding view (D-36 through D-43): present ONLY for a live+broadcast cohort whose funding
    // watch has reported. Gated on serviceMode so a stray note on the hermetic path can never
    // surface a funding stage that cannot exist off-chain.
    const funding = serviceMode === 'live' ? fundingViews.get(cohortId) : undefined;

    return {
      exists: true,
      members,
      seatsJoined,
      capacity,
      phase,
      submissions,
      coSign,
      anchor,
      fallback,
      // Copy the ring so a caller can never mutate the fold's internal array.
      activity: entry ? entry.activity.map((a) => ({ ...a })) : [],
      ...(funding ? { funding: { ...funding } } : {}),
    };
  }

  return {
    detail(cohortId: string): CohortDetailDTO {
      return buildDetail(cohortId);
    },

    exportRecord(cohortId: string): CohortExportDTO {
      // The export is exactly the detail projection (which already carries the activity ring)
      // plus a cohortId + exportedAt stamp. Off-chain artifacts stay referenced by hash at
      // /cas/ - only the signed-update bodies the detail already surfaces cross here (D-34).
      return { cohortId, exportedAt: Date.now(), ...buildDetail(cohortId) };
    },

    serviceHealth(): ServiceHealthDTO {
      // Pure projection: the mode is fixed at construction; esplora reachability is `'n/a'` on
      // the hermetic path (no esplora is ever contacted) and the last observed reading otherwise.
      return {
        mode: serviceMode,
        esploraReachable: serviceMode === 'hermetic' ? 'n/a' : esploraReachable,
      };
    },

    noteEsploraObservation(ok: boolean): void {
      // Flip ONLY the reachability bit; never touch the fold, so a failed observation freezes
      // every cohort's last-known state stale-honest (D-43) rather than inventing a new one. A
      // no-op on hermetic: serviceHealth reports `'n/a'` there regardless of this flag.
      esploraReachable = ok;
    },

    noteFunding(cohortId: string, view: FundingView): void {
      // Store the latest funding view for the gated detail read + the `needs-funding` summary chip.
      // A no-op off the broadcasting path: a hermetic/live-no-broadcast service never surfaces a
      // funding stage (the funding stage cannot exist without a real on-chain beacon), so a stray
      // note is dropped rather than fabricating one.
      if (serviceMode !== 'live') {
        return;
      }
      fundingViews.set(cohortId, view);
    },

    publicFunding(cohortId: string): { awaitingFunding: boolean } {
      // Non-oracle by construction (T-04-07-01): only a live+broadcast cohort can carry a
      // funding view, and only its still-unfunded states (waiting / awaiting-confirmation)
      // read `awaitingFunding: true`. A hermetic/live-no-broadcast service, a funded or
      // dead-end cohort, and an unknown cohortId all read `false`, so the anonymous read
      // leaks neither amounts, keys, nor cohort existence beyond a single waiting bit.
      if (serviceMode !== 'live') {
        return { awaitingFunding: false };
      }
      const view = fundingViews.get(cohortId);
      const awaitingFunding =
        view !== undefined && (view.state === 'waiting' || view.state === 'awaiting-confirmation');
      return { awaitingFunding };
    },

    summary(): CohortSummaryDTO[] {
      const rows: CohortSummaryDTO[] = [];
      const live = new Set<string>();
      // Live rows: cohorts still in the session whose phase is filling or co-signing. A
      // completed/failed cohort's phase is neither, so it never appears as a live row - it
      // reads from the ended set below, so the live + ended rows never double-count.
      for (const cohort of runner.session.cohorts) {
        const phase = runner.session.getCohortPhase(cohort.id);
        let chip: CohortChip | undefined;
        if (phase && OPEN_PHASES.has(phase)) {
          chip = 'filling';
        } else if (phase && IN_FLIGHT_PHASES.has(phase)) {
          chip = 'co-signing';
        }
        if (!chip || !phase) {
          continue;
        }
        // Funding attention (D-44): the moment keygen completes, a live+broadcast cohort awaiting
        // funding (any state that is not `funded`) reads `needs-funding` (warn) instead of its
        // phase chip, so the operator is nudged to fund it before the wait clock runs down. A
        // `funded` cohort keeps its phase chip (co-signing continues normally).
        const funding = fundingViews.get(cohort.id);
        if (funding && funding.state !== 'funded') {
          chip = 'needs-funding';
        }
        live.add(cohort.id);
        rows.push({
          cohortId: cohort.id,
          chip,
          seatsJoined: cohort.participants.length,
          capacity: cohort.minParticipants,
          phase,
        });
      }
      // Ended rows: retained terminal records, captured at event time so a session-GC'd
      // cohort still projects its fate (D-23). Skip any id still live in a filling/co-signing
      // phase (defensive: a live phase wins over a stale ended flip).
      for (const [cohortId, record] of ended) {
        if (live.has(cohortId)) {
          continue;
        }
        rows.push({
          cohortId,
          chip: record.chip,
          seatsJoined: record.seatsJoined,
          capacity: record.capacity,
          phase: 'ended',
          ...(record.reason !== undefined ? { reason: record.reason } : {}),
        });
      }
      return rows;
    },

    serviceMetrics(): ServiceMetricsDTO {
      let open = 0;
      let inFlight = 0;
      // open / inFlight from the LIVE set only (never a cumulative counter): a cohort is
      // counted exactly once by its current phase, and drops out the moment it ends.
      for (const cohort of runner.session.cohorts) {
        const phase = runner.session.getCohortPhase(cohort.id);
        if (phase && OPEN_PHASES.has(phase)) {
          open += 1;
        } else if (phase && IN_FLIGHT_PHASES.has(phase)) {
          inFlight += 1;
        }
      }
      // anchored / failed from the bounded retained records: `fallback` counts as anchored
      // (the k-of-n script path still put the beacon tx on-chain), everything else that is
      // not `failed` is an optimistic anchor.
      let anchored = 0;
      let failed = 0;
      for (const record of ended.values()) {
        if (record.chip === 'failed') {
          failed += 1;
        } else {
          anchored += 1;
        }
      }
      return { open, inFlight, anchored, failed };
    },
  };
}
