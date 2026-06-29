import { describe, expect, it } from 'vitest';
import { runHeadlessCohort } from './headless-cohort.js';

describe('headless real-HTTP aggregation cohort', () => {
  it('drives a full CAS cohort to a 64-byte aggregated Taproot signature', async () => {
    const result = await runHeadlessCohort({ quiet: true });

    expect(result.signatureLength).toBe(64);
    expect(result.hasSignedTx).toBe(true);

    expect(result.serviceMilestones).toEqual([
      'cohort-advertised',
      'opt-in-received',
      'keygen-complete',
      'signing-started',
      'signing-complete',
    ]);

    expect(result.participants).toHaveLength(2);
    for (const participant of result.participants) {
      expect(participant.milestones).toEqual([
        'cohort-discovered',
        'cohort-joined',
        'cohort-ready',
        'cohort-complete',
      ]);
    }
  }, 60000);
});
