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

import { IN_FLIGHT_PHASES, OPEN_PHASES } from '@btcr2-aggregation/shared';
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
