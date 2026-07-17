/**
 * Status of one internal protocol step. Retained as the substrate the store's event
 * handlers write and `deriveStage` reads (join/submit/sign/anchored); the standalone
 * FlowStepper that rendered these directly is retired (D-31, superseded by the pure
 * stage derivation on the live cohort page).
 */
export type StepStatus = 'idle' | 'active' | 'done' | 'failed';

/** The four internal protocol milestones the store tracks (the deriveStage substrate). */
export type StepKey = 'join' | 'submit' | 'sign' | 'anchored';

/** Severity colorway for a log line. */
export type LogLevel = 'info' | 'good' | 'warn' | 'bad';

export interface LogEntry {
  id: number;
  /** Monotonic ms offset since the page loaded (deterministic, no wall clock). */
  t: number;
  level: LogLevel;
  text: string;
}

/** Lifecycle status of a cohort as seen from the coordinator dashboard. */
export type CohortStatus = 'advertised' | 'keygen' | 'signing' | 'fallback' | 'complete' | 'failed';

export interface DashboardParticipant {
  did: string;
  /** Hex-encoded cohort signing public key. */
  pk?: string;
}

/** On-chain anchor lifecycle of a cohort's beacon tx (live broadcasting only). */
export type AnchorStatus = 'broadcast' | 'confirmed' | 'failed';

export interface CohortState {
  cohortId: string;
  status: CohortStatus;
  participants: DashboardParticipant[];
  /** DIDs that have been formally accepted into the cohort. */
  accepted: string[];
  updates: number;
  nonces: number;
  beaconAddress?: string;
  /** 128-hex aggregated key-path signature (empty for the script-path fallback). */
  signature?: string;
  path?: string;
  txid?: string;
  reason?: string;
  /**
   * On-chain anchor state, present only when the coordinator broadcasts live
   * (M3c): the broadcast beacon txid, whether it has confirmed, a block-explorer
   * URL, and any broadcast failure reason.
   */
  anchorTxid?: string;
  anchorStatus?: AnchorStatus;
  anchorConfirmed?: boolean;
  explorerUrl?: string;
  anchorError?: string;
  /** Monotonic ms offset of the first event for this cohort (for ordering). */
  firstSeen: number;
}
