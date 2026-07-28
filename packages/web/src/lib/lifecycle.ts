/**
 * Pure cohort-lifecycle predicates for the operator console (SVC-04, Phase 5 D-03/D-04).
 *
 * Every decision the `Lifecycle` section makes - whether a Cancel control exists at all, which
 * confirmation rung it takes, and whether a typed confirmation matches - lives here as a plain
 * function over the polled {@link CohortDetailDTO}. The component renders these; it never
 * re-derives them inline. This follows the `terminalReason` precedent in
 * {@link file://../stores/participant.ts}: a rule that decides what a human is told is a rule
 * worth testing without a DOM.
 *
 * The module is deliberately DOM-free and import-light (types plus the shared phase sets), so a
 * unit spec can exercise the whole decision surface with plain object literals.
 */

import { FINALIZABLE_PHASES, IN_FLIGHT_PHASES, OPEN_PHASES } from '@btcr2-aggregation/shared';
import type { CohortDetailDTO } from './operator';

/**
 * Whether the operator may cancel this cohort right now.
 *
 * - `unavailable`: render NO lifecycle control. Either no detail read has landed yet (so the
 *   phase is unobserved, UI-SPEC E1 loading), the service does not know this cohort, or the
 *   cohort has already settled without a broadcast. A control must never appear and then vanish,
 *   so "not yet known" and "nothing to act on" both render nothing.
 * - `available`: the cohort is live (open or mid-signing) and its beacon transaction has NOT gone
 *   out, so a cancel genuinely stops it.
 * - `broadcast`: the beacon transaction is already on the network (D-04). The control is HIDDEN,
 *   not disabled, and replaced by the honest line: there is nothing left to cancel.
 */
export type CancelAvailability = 'unavailable' | 'available' | 'broadcast';

/**
 * Decide whether Cancel is offered for the cohort this detail describes (D-04).
 *
 * Order matters. The broadcast check runs BEFORE the phase check because a cohort whose beacon
 * transaction is out may already have left every live phase: it must still explain itself with
 * the post-broadcast line rather than silently rendering nothing.
 *
 * A `failed` anchor is read through its `txid`, not its state name: a broadcast that later failed
 * to confirm still put a transaction on the wire (nothing left to cancel), while a send that
 * never reached the network carries no txid and leaves the cohort genuinely cancelable.
 */
export function cancelAvailability(detail: CohortDetailDTO | undefined): CancelAvailability {
  if (!detail || !detail.exists) {
    return 'unavailable';
  }
  const { anchor } = detail;
  if (anchor.txid !== undefined || anchor.state === 'broadcast' || anchor.state === 'confirmed') {
    return 'broadcast';
  }
  // Live means joinable (open) or working through the signing arc, including the funding-wait
  // phases the 04-08 live-UAT widening added. Anything else (a settled or session-GC'd cohort,
  // whose detail projects `phase: 'unknown'`) has nothing to cancel.
  if (OPEN_PHASES.has(detail.phase) || IN_FLIGHT_PHASES.has(detail.phase)) {
    return 'available';
  }
  return 'unavailable';
}

/**
 * Which confirmation rung a cancel of this cohort takes (D-03, the fixed UI-SPEC tone ladder).
 *
 * Rung 4 (type-to-confirm plus the recovery-key disclosure) is reserved for a cohort whose beacon
 * address HAS RECEIVED FUNDS, because canceling it can strand real money. That is any funding
 * state past `waiting`:
 *
 * - `awaiting-confirmation`: a payment is in the mempool.
 * - `funded`: a confirmed, spendable payment is at the address.
 * - `dead-end`: money arrived but below the usable minimum. The funds are already stranded and a
 *   cancel makes that permanent, so this is the LAST state that should get the cheap ceremony.
 *
 * Rung 3 covers everything else, including a hermetic cohort that carries no funding view at all
 * (no chain, so no money to lose) and a live cohort still waiting for its first payment.
 */
export function cancelRung(detail: CohortDetailDTO): 3 | 4 {
  const state = detail.funding?.state;
  if (state === 'awaiting-confirmation' || state === 'funded' || state === 'dead-end') {
    return 4;
  }
  return 3;
}

/**
 * Whether the operator may finalize this cohort's signing round right now (D-01).
 *
 * - `unavailable`: render NO finalize control. No detail read has landed yet, or the service does
 *   not know this cohort.
 * - `not-signing`: the cohort exists but its signing round has not started. The control renders
 *   DISABLED with the reason beside it, rather than hidden: unlike cancel-after-broadcast, this
 *   really will become possible, so a disabled control with an explanation is the honest shape.
 * - `available`: the cohort is in one of the library's three signing phases, the only window in
 *   which the underlying fallback primitive works.
 * - `committed`: the cohort already took the k-of-n fallback path. The control is replaced by the
 *   line saying so, because there is nothing left to trigger.
 */
export type FinalizeAvailability = 'unavailable' | 'not-signing' | 'available' | 'committed';

/**
 * Decide whether `Finalize now` is offered for the cohort this detail describes (D-01).
 *
 * The phase test reads {@link FINALIZABLE_PHASES}, the SAME set the server's finalize guard reads,
 * and deliberately NOT `IN_FLIGHT_PHASES`. The two sets differ by the four funding-wait phases
 * 04-08 added to the wider set for the public directory display: a cohort sitting in one of them
 * is genuinely in flight, but the library's `startFallbackSigning` throws there, so offering the
 * control would be offering a button that can only fail (RESEARCH Pattern 2 / Pitfall 4).
 *
 * The committed check runs FIRST, because a cohort that has already fallen back sits in
 * `FallbackRequested` (outside the finalizable set) and would otherwise read as a plain
 * `not-signing`, telling the operator to wait for a round that already finished.
 */
export function finalizeAvailability(detail: CohortDetailDTO | undefined): FinalizeAvailability {
  if (!detail || !detail.exists) {
    return 'unavailable';
  }
  if (detail.fallback.used) {
    return 'committed';
  }
  if (FINALIZABLE_PHASES.has(detail.phase)) {
    return 'available';
  }
  return 'not-signing';
}

/**
 * Whether this cohort has CLOSED: every seat is filled, so it locked and stopped accepting joins
 * (D-01).
 *
 * Closing is an AUTOMATIC lifecycle event, not an operator verb. The cohort model pins
 * `min === max === n`, so the nth seat both fills the cohort and starts keygen; there is no
 * primitive that stops accepting joins while leaving the cohort able to proceed, and a partially
 * filled n-of-n cohort that stopped accepting joins could never anchor. The console therefore
 * NARRATES this as a stage on the timeline and never renders a Close button.
 *
 * Derived from the served seat counts rather than a server flag, because the fact is already on
 * the wire: `capacity > 0` guards the pre-first-read window, where both numbers are zero and
 * "0 of 0 seats filled" would otherwise read as closed.
 */
export function closedAtNthSeat(detail: CohortDetailDTO | undefined): boolean {
  if (!detail || !detail.exists) {
    return false;
  }
  return detail.capacity > 0 && detail.seatsJoined >= detail.capacity;
}

/**
 * Whether the honest seat-reclaim workaround line belongs on screen (D-18).
 *
 * It is shown ONLY while a cohort is genuinely still filling: joinable by phase and not yet at its
 * nth seat. Past that point there is no abandoned seat to reclaim, so the note would be noise.
 *
 * The note exists because `@did-btcr2/aggregation@0.4.0` offers no seat-release API at all: a
 * participant who opts in and then goes quiet holds their seat until the whole cohort ends. Rather
 * than invent a per-seat control this app cannot honor, the console states the real workaround in
 * words (cancel and re-advertise, or wait out the discovery window). Per-seat reclaim is re-parked
 * pending an upstream primitive.
 */
export function seatReclaimNoteVisible(detail: CohortDetailDTO | undefined): boolean {
  if (!detail || !detail.exists) {
    return false;
  }
  return OPEN_PHASES.has(detail.phase) && !closedAtNthSeat(detail);
}

/**
 * The type-to-confirm gate: an EXACT, case-sensitive comparison (D-03 rung 4).
 *
 * Surrounding whitespace is trimmed on both sides, because a value copied out of the console
 * commonly carries it and that is not a different id. Everything else must match exactly: a
 * prefix, a superstring, or a case difference all keep the confirm button disabled, so no partial
 * input can ever arm a destructive action.
 */
export function typeToConfirmMatches(typed: string, expected: string): boolean {
  const want = expected.trim();
  if (want === '') {
    return false;
  }
  return typed.trim() === want;
}

/**
 * The short cohort id used in confirmation copy and as the rung-4 type-to-confirm value.
 *
 * Deliberately a PLAIN prefix with no truncation glyph: the drill-down heading's own `shortId`
 * appends a horizontal ellipsis, which an operator cannot type and which would make the
 * case-sensitive match unsatisfiable. Eight characters is enough to identify a cohort on a
 * console that shows a handful of them, and short enough to type without a copy step.
 */
export function cohortShortId(id: string): string {
  return id.slice(0, 8);
}
