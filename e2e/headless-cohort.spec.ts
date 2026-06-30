import { describe, expect, it } from 'vitest';
import { runHeadlessCohort } from './headless-cohort.js';

const EXPECTED_SERVICE_MILESTONES = [
  'cohort-advertised',
  'opt-in-received',
  'keygen-complete',
  'signing-started',
  'signing-complete',
];

const EXPECTED_PARTICIPANT_MILESTONES = [
  'cohort-discovered',
  'cohort-joined',
  'cohort-ready',
  'cohort-complete',
];

describe('headless real-HTTP aggregation cohort', () => {
  it('drives a full CAS cohort to a 64-byte aggregated Taproot signature', async () => {
    const result = await runHeadlessCohort({ quiet: true });

    expect(result.beaconType).toBe('CASBeacon');
    expect(result.signatureLength).toBe(64);
    expect(result.hasSignedTx).toBe(true);
    expect(result.serviceMilestones).toEqual(EXPECTED_SERVICE_MILESTONES);

    expect(result.participants).toHaveLength(2);
    for (const participant of result.participants) {
      expect(participant.milestones).toEqual(EXPECTED_PARTICIPANT_MILESTONES);
      expect(participant.beaconType).toBe('CASBeacon');
      // A CAS cohort delivers the announcement map, not an SMT proof.
      expect(participant.artifact).toBe('cas');
    }
  }, 60000);

  it('drives a full SMT cohort and delivers each participant an SMT inclusion proof', async () => {
    const result = await runHeadlessCohort({ quiet: true, beaconType: 'SMTBeacon' });

    expect(result.beaconType).toBe('SMTBeacon');
    expect(result.signatureLength).toBe(64);
    expect(result.hasSignedTx).toBe(true);
    expect(result.serviceMilestones).toEqual(EXPECTED_SERVICE_MILESTONES);

    expect(result.participants).toHaveLength(2);
    for (const participant of result.participants) {
      expect(participant.milestones).toEqual(EXPECTED_PARTICIPANT_MILESTONES);
      expect(participant.beaconType).toBe('SMTBeacon');
      // An SMT cohort delivers this DID's inclusion proof, not the CAS map.
      expect(participant.artifact).toBe('smt');
    }
  }, 60000);
});
