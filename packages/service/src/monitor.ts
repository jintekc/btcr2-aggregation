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
 * The partial-signature leg is deliberately NOT read here: the runner exposes no event or
 * accessor for it (D-32, RESEARCH Finding 9), so this tracer scope stops at members/seats
 * and later plans layer submissions / co-sign / anchor / funding honestly on top.
 */

import { bytesToHex } from '@noble/hashes/utils';
import type { Transaction } from '@scure/btc-signer';
import type { AggregationServiceEvents, AggregationServiceRunner } from '@did-btcr2/aggregation/service';

/**
 * Upper bound on monitored cohort entries (mirrors the anchor-state / operator-cohorts
 * `MAX_TERMINAL` = 24 bound). Past this cap the OLDEST cohort entry is evicted so a
 * long-lived self-hosted service that advertises many cohorts cannot grow the fold map
 * without limit (T-04-01-02, DoS).
 */
const MAX_MONITORED = 24;

/** Whether a folded member has only opted in (`pending`) or been seated (`seated`). */
export type MemberStatus = 'pending' | 'seated';

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
 * Build the per-service cohort monitor. Subscribes ONCE to the runner's membership events
 * and folds them into a bounded per-cohort Map; `detail(cohortId)` projects that fold,
 * enriched from `runner.session` for a still-live cohort.
 *
 * The listeners are fire-and-forget (a thrown handler is caught and logged, never
 * rejected back to the runner), matching the persist/broadcast `.catch` discipline in
 * {@link file://./index.ts}: a monitoring failure must never disturb the protocol.
 */
export function createCohortMonitor(runner: AggregationServiceRunner): CohortMonitor {
  const entries = new Map<string, MonitorEntry>();

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
  };
}
