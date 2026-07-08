/**
 * Operator on-demand cohort drafts (SVC-01, D-10/D-12/D-13).
 *
 * This is the create/configure/discard half of the two-step cohort flow: an
 * authenticated operator shapes a cohort by hand (beacon type, n-of-n co-sign
 * threshold, capacity) and it is stored as an un-advertised DRAFT - app-level config
 * that is NOT yet handed to the {@link AggregationServiceRunner}. Advertising a draft
 * (moving it onto the live runner), the public directory, and the loop removal are
 * plan 03; this file deliberately never touches the runner, so a draft has zero
 * protocol side effects until the operator explicitly advertises it (D-12).
 *
 * Two decisions are load-bearing here:
 * - The Bitcoin network is the SERVICE's single active network, resolved once at boot
 *   and passed in as {@link OperatorCohortsOptions.activeNetwork}; it is NEVER read
 *   from the create-form body (D-10). A form that could pick a network would let the
 *   browser derive addresses/DIDs for a chain the coordinator does not run.
 * - `capacity` is applied app-side as `maxParticipants` on top of
 *   {@link buildCohortConfig} (whose `minParticipants` is the n-of-n threshold), so
 *   the operator sets an explicit seat ceiling rather than an open cohort (D-11/D-19).
 *
 * State is a per-{@link createOperatorCohorts} `Map` (mirrors the `seatedRosterKeys` /
 * `genesisStaging` closure scoping in index.ts), NOT a module singleton, so two
 * services in one process (tests) never share drafts.
 */

import { randomUUID } from 'node:crypto';
import { buildCohortConfig, type BeaconType, type NetworkName } from '@btcr2-aggregation/shared';
import type { CohortConfig } from '@did-btcr2/aggregation/service';

/** The two aggregation beacon types an operator may draft (singleton is single-party). */
const KNOWN_BEACON_TYPES = new Set<string>(['CASBeacon', 'SMTBeacon']);

/** Untrusted create-form body: beacon type + the two cohort-size bounds. */
export interface DraftInput {
  beaconType: string;
  threshold: number;
  capacity: number;
}

/**
 * The wire shape of an operator cohort. Only operator-safe fields are exposed
 * (T-02-04): no recovery key, no keys, no secrets - just what the operator's own
 * cohort list renders. `state` is `'draft'` for now; advertised entries arrive in
 * plan 03.
 */
export interface OperatorCohortDTO {
  draftId: string;
  beaconType: BeaconType;
  network: NetworkName;
  threshold: number;
  capacity: number;
  state: 'draft';
}

/** Construction inputs for {@link createOperatorCohorts}. */
export interface OperatorCohortsOptions {
  /** The service's single active Bitcoin network (D-10); never a form value. */
  activeNetwork: NetworkName;
  /**
   * Operator recovery key (x-only hex) threaded from the service cohort config, so a
   * drafted cohort carries the same recovery leaf the operator funds. Optional - when
   * absent {@link buildCohortConfig} derives a throwaway (fine off-chain / on test nets).
   */
  recoveryKey?: string;
}

/** The create/discard/list surface the gated operator cohort routes call. */
export interface OperatorCohorts {
  /** Validate + store a draft; throws a user-facing `Error` on invalid input. */
  createDraft(input: DraftInput): OperatorCohortDTO;
  /** Remove an un-advertised draft. Returns false for an unknown id (route 404). */
  discardDraft(draftId: string): boolean;
  /** All drafts as DTOs (advertised entries join this list in plan 03). */
  listCohorts(): OperatorCohortDTO[];
}

/**
 * Validate a create-form body into a `{ beaconType, threshold, capacity }` triple.
 * Guard-clause style (index.ts / shared house style): throws on the first problem with
 * a user-facing message the route surfaces verbatim as the 400 body. The two numeric
 * messages are the exact UI-SPEC validation strings so the server and the browser agree
 * on the copy the operator sees.
 */
function validateDraft(input: DraftInput): { beaconType: BeaconType; threshold: number; capacity: number } {
  const { beaconType, threshold, capacity } = input;
  if (typeof beaconType !== 'string' || !KNOWN_BEACON_TYPES.has(beaconType)) {
    throw new Error(`operator: unknown beacon type "${String(beaconType)}" (expected CASBeacon or SMTBeacon)`);
  }
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error('Threshold must be at least 1 signer.');
  }
  if (!Number.isInteger(capacity) || capacity < threshold) {
    throw new Error('Capacity must be at least the co-sign threshold.');
  }
  return { beaconType: beaconType as BeaconType, threshold, capacity };
}

/**
 * Build the per-service operator cohort surface. `drafts` is closure state keyed by a
 * fresh CSPRNG draft id; each entry keeps both the built {@link CohortConfig} (so plan
 * 03 can hand it straight to the runner on advertise) and the operator-facing
 * {@link OperatorCohortDTO}.
 */
export function createOperatorCohorts(opts: OperatorCohortsOptions): OperatorCohorts {
  const { activeNetwork, recoveryKey } = opts;
  const drafts = new Map<string, { config: CohortConfig; dto: OperatorCohortDTO }>();

  return {
    createDraft(input: DraftInput): OperatorCohortDTO {
      const { beaconType, threshold, capacity } = validateDraft(input);
      // Build on the SERVICE active network (D-10). `minParticipants` is the n-of-n
      // threshold; set `maxParticipants` = capacity so the cohort has an explicit seat
      // ceiling app-side rather than being open (D-11/D-19).
      const config = buildCohortConfig(threshold, beaconType, activeNetwork, recoveryKey);
      config.maxParticipants = capacity;
      const draftId = randomUUID();
      const dto: OperatorCohortDTO = {
        draftId,
        beaconType,
        network: activeNetwork,
        threshold,
        capacity,
        state: 'draft',
      };
      drafts.set(draftId, { config, dto });
      console.log(`[operator] created draft ${draftId} (${beaconType} ${threshold}-of-${threshold}, cap ${capacity})`);
      return dto;
    },

    discardDraft(draftId: string): boolean {
      const existed = drafts.delete(draftId);
      if (existed) {
        console.log(`[operator] discarded draft ${draftId}`);
      }
      return existed;
    },

    listCohorts(): OperatorCohortDTO[] {
      return [...drafts.values()].map((d) => d.dto);
    },
  };
}
