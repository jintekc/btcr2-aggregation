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

/** The plain-language status labels the directory renders (D-09). */
export type StatusLabel = 'Open' | 'Filling' | 'Collecting updates' | 'Full' | string;

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
