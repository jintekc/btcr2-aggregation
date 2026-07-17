/**
 * Neutral, participant-facing data + logic surface for the browse directory (PART-01).
 *
 * The browse components import the public reads and DTO types from HERE rather than the
 * operator-named {@link file://./operator.ts} module, so the anonymous surface reads from a
 * participant-framed module (D-08 / 02-CONTEXT integration point). The re-exported
 * `fetchDirectory`/`fetchStatus` keep their `credentials: 'omit'` shape (the source of
 * truth is unchanged in `operator.ts`), so the browse surface never sends the operator
 * session cookie (Security V4/V9).
 *
 * The pure helpers below encode the plain-language status contract and the joinability
 * gate. Joinability is Advertised-ONLY: the library finalizes and locks cohort membership
 * at the co-sign threshold the instant a cohort leaves the Advertised phase (02-RESEARCH
 * Finding 3 / Pitfall 1), so a Filling / Collecting-updates / Full row is display-only.
 * This is the delta from D-09's OPEN_PHASES set, which governs DISPLAY (all open phases are
 * listed in the directory) while {@link isJoinable} governs the join gate.
 */

export {
  fetchDirectory,
  fetchStatus,
  type DirectoryCohortDTO,
  type ServiceStatus,
  type OperatorBeaconType,
} from './operator.js';

import type { DirectoryCohortDTO, OperatorBeaconType } from './operator.js';

/**
 * The single protocol phase from which a cohort is joinable. A cohort can only be joined
 * while it is still `Advertised` with a free seat; once it advances (CohortSet /
 * CollectingUpdates) the roster is locked, so those rows are display-only.
 */
export const JOINABLE_PHASE = 'Advertised';

/**
 * The mid-signing phases the widened directory DISPLAY set surfaces (D-26): a service that
 * is busy co-signing still looks alive to a stranger, listed as a non-joinable "In progress"
 * row. These mirror the service's `IN_FLIGHT_PHASES` (`packages/service/src/operator-cohorts.ts`)
 * and are never in {@link JOINABLE_PHASE}, so {@link isJoinable} stays Advertised-only.
 */
const IN_FLIGHT_PHASES = new Set<string>(['SigningStarted', 'NoncesCollected', 'AwaitingPartialSigs']);

/** The plain-language status labels the directory renders (D-09/D-26). */
export type StatusLabel = 'Open' | 'Filling' | 'Collecting updates' | 'In progress' | 'Full' | string;

/** The Badge/StatusDot tones this surface uses (a subset of the primitives' Tone union). */
export type StatusTone = 'accent' | 'warn' | 'neutral';

/**
 * A row is joinable only while it is Advertised AND has a free seat. Every other phase is
 * membership-locked, and a full Advertised row has no seat to take.
 */
export function isJoinable(row: DirectoryCohortDTO): boolean {
  return row.phase === JOINABLE_PHASE && row.joined < row.capacity;
}

/**
 * Map the raw protocol phase (+ seat fullness) to the plain-language label. A full cohort
 * reads `Full` regardless of phase; otherwise the open phases map to Open / Filling /
 * Collecting updates, and an unrecognized phase falls back to its raw string.
 */
export function statusLabel(row: DirectoryCohortDTO): StatusLabel {
  // In-flight signing rows read the D-26 "In progress" label BEFORE the full check: a
  // co-signing cohort has every seat filled (joined == capacity), so a plain "Full" would
  // mask that it is actively signing. "In progress" is the more honest, informative state.
  if (IN_FLIGHT_PHASES.has(row.phase)) {
    return 'In progress';
  }
  if (row.joined >= row.capacity) {
    return 'Full';
  }
  switch (row.phase) {
    case 'Advertised':
      return 'Open';
    case 'CohortSet':
      return 'Filling';
    case 'CollectingUpdates':
      return 'Collecting updates';
    default:
      return row.phase;
  }
}

/**
 * The Badge tone for a row's status (UI-SPEC Color contract): Open is the single accent
 * affordance, Filling warns, and Collecting updates / Full recede to neutral.
 */
export function statusTone(row: DirectoryCohortDTO): StatusTone {
  switch (statusLabel(row)) {
    case 'Open':
      return 'accent';
    case 'Filling':
      return 'warn';
    default:
      return 'neutral';
  }
}

/** The beacon-type chip gloss (D-08): a short code plus a one-phrase expansion. */
export function beaconGloss(beaconType: OperatorBeaconType): string {
  return beaconType === 'CASBeacon' ? 'CAS · content-addressed' : 'SMT · sparse Merkle tree';
}

/**
 * The two honest numbers a cohort now carries (G-02-1): the co-sign figure is `k-of-n`,
 * where `threshold` = k (the ADR-042 signing floor) and `capacity` = n (the seat count).
 * A row where k == n is the honest unanimous default; k < n names the stall-fallback
 * condition. Pure helpers so the same strings the components render are the strings the
 * spec asserts (no DOM, T-KOFN-01/T-KOFN-07).
 */
export function cosignValue(row: { threshold: number; capacity: number }): string {
  return `${row.threshold}-of-${row.capacity}`;
}

/**
 * The caption beneath the co-sign figure. k == n degrades to `all signers required`
 * (unanimous n-of-n); k < n states the unanimous norm AND the stall fallback floor, so
 * the caption never implies only k routinely sign.
 */
export function cosignCaption(row: { threshold: number; capacity: number }): string {
  if (row.threshold === row.capacity) {
    return 'all signers required';
  }
  return `all co-sign; anchors if at least ${row.threshold} of ${row.capacity} sign`;
}
