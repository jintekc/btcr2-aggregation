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
}

/** The non-oracle answer for an unknown/evicted cohort with no live-set presence. */
function absentDetail(): CohortDetailDTO {
  return { exists: false, members: [], seatsJoined: 0, capacity: 0, phase: 'unknown' };
}

/** The internal folded entry for one cohort: its members plus event-time enrichment. */
interface MonitorEntry {
  /**
   * Members keyed by DID, insertion-ordered (Map preserves insertion order) so the
   * projection lists them in the order they were first observed. A pending opt-in is
   * promoted in place to seated on acceptance, keeping its original `since` stamp.
   */
  members: Map<string, CohortMemberDTO>;
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
): CohortMonitor {
  const entries = new Map<string, MonitorEntry>();
  /**
   * Retained terminal records (D-23), keyed by cohortId, bounded at {@link MAX_TERMINAL}
   * oldest-first. Captured AT EVENT TIME so a session-GC'd cohort still projects its fate.
   */
  const ended = new Map<string, EndedRecord>();

  /** Get-or-create a cohort entry WITHOUT touching insertion order (that is `remember`'s job). */
  function entryFor(cohortId: string): MonitorEntry {
    let entry = entries.get(cohortId);
    if (!entry) {
      entry = { members: new Map(), capacity: 0 };
      entries.set(cohortId, entry);
    }
    return entry;
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
  runner.on('opt-in-received', ({ cohortId, participantDid }) => {
    safely('opt-in-received', () => {
      const entry = entryFor(cohortId);
      if (!entry.members.has(participantDid)) {
        entry.members.set(participantDid, { did: participantDid, status: 'pending', since: Date.now() });
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
        entry.members.set(participantDid, { did: participantDid, status: 'seated', since: Date.now() });
      }
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
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });

  // signing-started / nonce-received: the cohort is co-signing (its phase now drives the
  // `co-signing` chip). Nothing to fold beyond keeping the entry fresh so a cohort that is
  // progressing through signing without new members is not evicted mid-life.
  runner.on('signing-started', ({ cohortId }) => {
    safely('signing-started', () => {
      const entry = entryFor(cohortId);
      snapshotCapacity(cohortId, entry);
      remember(cohortId, entry);
    });
  });
  runner.on('nonce-received', ({ cohortId }) => {
    safely('nonce-received', () => {
      const entry = entryFor(cohortId);
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
      const viaFallback = result.path === 'script-path' || entries.get(cohortId)?.fellBack === true;
      const { seatsJoined, capacity } = snapshotSeats(cohortId);
      rememberEnded(cohortId, { chip: viaFallback ? 'fallback' : 'anchored', seatsJoined, capacity });
    });
  });

  // cohort-failed carries an attributed cohortId + reason (unlike the bare `error` event,
  // which has neither, planning note 2): record a terminal `failed` record with its reason.
  runner.on('cohort-failed', ({ cohortId, reason }) => {
    safely('cohort-failed', () => {
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
    broadcaster.on('beacon-broadcast-failed', ({ cohortId, reason }) => {
      safely('beacon-broadcast-failed', () => {
        const { seatsJoined, capacity } = snapshotSeats(cohortId);
        rememberEnded(cohortId, { chip: 'failed', seatsJoined, capacity, reason: reason || 'broadcast failed' });
      });
    });
    broadcaster.on('beacon-anchored', ({ cohortId, confirmed }) => {
      if (!confirmed) {
        return;
      }
      safely('beacon-anchored', () => {
        // Preserve a fallback tag if signing-complete already recorded one; a confirmed
        // anchor of an optimistic-path cohort stays `anchored`.
        const viaFallback = ended.get(cohortId)?.chip === 'fallback';
        const { seatsJoined, capacity } = snapshotSeats(cohortId);
        rememberEnded(cohortId, { chip: viaFallback ? 'fallback' : 'anchored', seatsJoined, capacity });
      });
    });
  }

  return {
    detail(cohortId: string): CohortDetailDTO {
      const entry = entries.get(cohortId);
      const cohort = runner.session.getCohort(cohortId);
      // Neither a fold entry nor a live cohort: the non-oracle absent answer. An
      // advertised cohort with nobody joined still has a live cohort (no entry yet), so it
      // reads exists:true with an empty member list and its real seat count.
      if (!entry && !cohort) {
        return absentDetail();
      }
      // Members always come from the OWN fold so an ended (session-GC'd) cohort still
      // projects its members; a live cohort with no opt-ins yet simply has none.
      const members: CohortMemberDTO[] = entry
        ? [...entry.members.values()].map((m) => ({ did: m.did, status: m.status, since: m.since }))
        : [];
      if (cohort) {
        // Live enrichment: authoritative seat count and phase from the session.
        const phase = runner.session.getCohortPhase(cohortId);
        return {
          exists: true,
          members,
          seatsJoined: cohort.participants.length,
          capacity: cohort.minParticipants,
          phase: phase ?? 'unknown',
        };
      }
      // Ended/entry-only: the session has GC'd the cohort, so derive the seat count from
      // the seated fold and the last-known capacity snapshot; phase is honestly unknown.
      const seatsJoined = members.filter((m) => m.status === 'seated').length;
      return {
        exists: true,
        members,
        seatsJoined,
        capacity: entry ? entry.capacity : 0,
        phase: 'unknown',
      };
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
