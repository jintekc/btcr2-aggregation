/**
 * Operator on-demand cohort drafts (SVC-01, D-10/D-12/D-13). RED stub - the full
 * implementation lands in the GREEN step of this task.
 */

import type { BeaconType, NetworkName } from '@btcr2-aggregation/shared';

/** Untrusted create-form body: beacon type + the two cohort-size bounds. */
export interface DraftInput {
  beaconType: string;
  threshold: number;
  capacity: number;
}

/** The wire shape of an operator cohort (draft now; advertised entries in plan 03). */
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
  activeNetwork: NetworkName;
  recoveryKey?: string;
}

/** The create/discard/list surface the gated operator cohort routes call. */
export interface OperatorCohorts {
  createDraft(input: DraftInput): OperatorCohortDTO;
  discardDraft(draftId: string): boolean;
  listCohorts(): OperatorCohortDTO[];
}

export function createOperatorCohorts(_opts: OperatorCohortsOptions): OperatorCohorts {
  return {
    createDraft(): OperatorCohortDTO {
      throw new Error('operator: not implemented');
    },
    discardDraft(): boolean {
      return false;
    },
    listCohorts(): OperatorCohortDTO[] {
      return [];
    },
  };
}
