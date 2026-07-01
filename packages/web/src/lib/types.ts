/** Status of one step in the participant flow stepper. */
export type StepStatus = 'idle' | 'active' | 'done' | 'failed';

/** The four protocol milestones an attendee passes through, in order. */
export type StepKey = 'join' | 'submit' | 'sign' | 'anchored';

export interface FlowStep {
  key: StepKey;
  label: string;
  hint: string;
}

/** Ordered definition of the participant stepper. */
export const FLOW_STEPS: readonly FlowStep[] = [
  { key: 'join', label: 'Join cohort', hint: 'Opt in and run distributed keygen' },
  { key: 'submit', label: 'Submit update', hint: 'Sign your DID update, add the CAS beacon' },
  { key: 'sign', label: 'Co-sign', hint: 'Contribute your MuSig2 nonce + partial signature' },
  { key: 'anchored', label: 'Anchored', hint: 'Aggregated Taproot signature produced' },
];

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
