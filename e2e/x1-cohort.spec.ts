import { describe, expect, it } from 'vitest';
import { runHeadlessCohort, runRejectedX1 } from './headless-cohort.js';

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

// The library fix (ADR 066) made EXTERNAL (x1) DIDs first-class aggregation members
// over HTTP: they authenticate from a self-verifying genesis carried on the opt-in,
// exactly as KEY (k1) DIDs authenticate from their DID string. These prove the app
// consumes that surface end to end.
describe('EXTERNAL (x1) aggregation cohort over real HTTP', () => {
  it('drives an all-x1 CAS cohort to a 64-byte aggregated Taproot signature', async () => {
    const result = await runHeadlessCohort({
      quiet: true,
      identityTypes: ['EXTERNAL', 'EXTERNAL'],
    });

    expect(result.signatureLength).toBe(64);
    expect(result.hasSignedTx).toBe(true);
    expect(result.serviceMilestones).toEqual(EXPECTED_SERVICE_MILESTONES);
    expect(result.participants).toHaveLength(2);
    for (const participant of result.participants) {
      expect(participant.idType).toBe('EXTERNAL');
      expect(participant.did.startsWith('did:btcr2:x1')).toBe(true);
      expect(participant.milestones).toEqual(EXPECTED_PARTICIPANT_MILESTONES);
      expect(participant.artifact).toBe('cas');
    }
  }, 60000);

  it('drives a mixed k1 + x1 CAS cohort to a valid aggregate signature (both included)', async () => {
    const result = await runHeadlessCohort({
      quiet: true,
      identityTypes: ['KEY', 'EXTERNAL'],
    });

    expect(result.signatureLength).toBe(64);
    expect(result.serviceMilestones).toEqual(EXPECTED_SERVICE_MILESTONES);
    expect(result.participants.map((p) => p.idType)).toEqual(['KEY', 'EXTERNAL']);
    expect(result.participants[0].did.startsWith('did:btcr2:k1')).toBe(true);
    expect(result.participants[1].did.startsWith('did:btcr2:x1')).toBe(true);
    for (const participant of result.participants) {
      // Both members co-signed and were announced in the same CAS map.
      expect(participant.milestones).toEqual(EXPECTED_PARTICIPANT_MILESTONES);
      expect(participant.artifact).toBe('cas');
    }
  }, 60000);

  it('drives a mixed k1 + x1 SMT cohort (x1 works with the privacy beacon too)', async () => {
    const result = await runHeadlessCohort({
      quiet: true,
      beaconType: 'SMTBeacon',
      identityTypes: ['KEY', 'EXTERNAL'],
    });

    expect(result.signatureLength).toBe(64);
    expect(result.participants.map((p) => p.idType)).toEqual(['KEY', 'EXTERNAL']);
    for (const participant of result.participants) {
      expect(participant.milestones).toEqual(EXPECTED_PARTICIPANT_MILESTONES);
      // Each member (k1 and x1) receives its own SMT inclusion proof.
      expect(participant.artifact).toBe('smt');
    }
  }, 60000);

  it('rejects a self-consistent attacker claiming a victim x1 DID (trustless hash binding)', async () => {
    // The attacker signs + advertises its OWN key and presents its OWN genesis, but claims
    // the victim's DID (see runRejectedX1). The signature and communicationPk-consistency
    // gates therefore pass on their own terms; ONLY the genesis-hashes-to-the-claimed-DID
    // binding can reject. So this fails loudly if that binding ever regressed - it does not
    // stay green on the strength of the other gates.
    const { joined, accepted } = await runRejectedX1({ quiet: true });
    expect(joined).toBe(false);
    expect(accepted).toBe(false);
  }, 30000);
});
