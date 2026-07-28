import { describe, expect, it } from 'vitest';
import type { AggregationServiceRunner } from '@did-btcr2/aggregation/service';
import { createOperatorCohorts, type DirectoryCohortDTO } from '../src/operator-cohorts.js';
import { createCohortIntents } from '../src/cohort-intent.js';

/**
 * SVC-JOIN-2 regression coverage: the public directory DISPLAY must span the whole
 * mid-signing arc so a seated-but-unfinished cohort never vanishes from `/v1/directory`
 * during the live funding wait (the wait runs inside `onProvideTxData`, which the library
 * calls while the cohort sits in UpdatesCollected / DataDistributed / Validated /
 * FallbackRequested). At the same time the widened DISPLAY must NEVER inflate the public
 * open COUNT, which stays exactly the joinable OPEN_PHASES tier (Pitfall 3 / D-09).
 *
 * A stubbed runner drives phase + membership directly (no real protocol): `advertiseCohort`
 * mints a live cohort id and the tests then pin its reported phase and joined count. The
 * completion promise never settles, so the enrichment prune is out of the way and these tests
 * isolate the phase FILTER. NEW spec under `packages/service/tests/` (tests-outside-src
 * convention); imports the module under test via `../src/operator-cohorts.js`.
 */

const ACTIVE_NETWORK = 'signet';

/** The four phases the funding wait sits in - added to the DISPLAY set by this fix. */
const FUNDING_WAIT_PHASES = ['UpdatesCollected', 'DataDistributed', 'Validated', 'FallbackRequested'];

interface StubCohort {
  id: string;
  participants: unknown[];
}

/** A minimal runner stub exposing exactly what `directory()`/`status()` read. */
function stubRunner() {
  const cohorts: StubCohort[] = [];
  const phases = new Map<string, string>();
  let seq = 0;
  const runner = {
    session: {
      cohorts,
      getCohortPhase: (id: string) => phases.get(id),
    },
    advertiseCohort: () => {
      const id = `cohort-${seq}`;
      seq += 1;
      cohorts.push({ id, participants: [] });
      phases.set(id, 'Advertised');
      // Never settles: these tests assert the phase filter, not the completion prune.
      return { cohortId: id, completion: new Promise<unknown>(() => {}) };
    },
  } as unknown as AggregationServiceRunner;
  return {
    runner,
    setPhase(id: string, phase: string): void {
      phases.set(id, phase);
    },
    setJoined(id: string, n: number): void {
      const cohort = cohorts.find((c) => c.id === id);
      if (!cohort) {
        throw new Error(`stub cohort ${id} not found`);
      }
      cohort.participants = Array.from({ length: n }, (_v, i) => ({ seat: i }));
    },
  };
}

/** Advertise ONE size-2 (k == n) cohort and return its live id + the surface + the stub. */
function advertiseOne() {
  const stub = stubRunner();
  const oc = createOperatorCohorts({
    runner: stub.runner,
    activeNetwork: ACTIVE_NETWORK,
    autoFallbackOnStall: true,
    intents: createCohortIntents(),
  });
  const draft = oc.createDraft({ beaconType: 'CASBeacon', size: 2, threshold: 2 });
  const advertised = oc.advertiseDraft(draft.draftId);
  if (!advertised) {
    throw new Error('advertiseDraft returned undefined');
  }
  // draftId on the advertised DTO is the LIVE cohort id (drafts and advertised never share ids).
  return { oc, stub, cohortId: advertised.draftId };
}

describe('operator directory DISPLAY spans the funding-wait phases (SVC-JOIN-2)', () => {
  it('lists a seated cohort in every funding-wait phase carrying its live joined/capacity', () => {
    const { oc, stub, cohortId } = advertiseOne();
    // Both seats locked (the funding wait only starts after the cohort fills).
    stub.setJoined(cohortId, 2);

    for (const phase of FUNDING_WAIT_PHASES) {
      stub.setPhase(cohortId, phase);
      const directory = oc.directory() as DirectoryCohortDTO[];
      expect(directory).toHaveLength(1);
      expect(directory[0]).toMatchObject({ cohortId, phase, joined: 2, capacity: 2 });
      // The widened DISPLAY must NOT inflate the joinable open count (Pitfall 3 / D-09).
      expect(oc.status().openCohorts).toBe(0);
    }
  });

  it('counts an Advertised (joinable) row in the open count, and lists it', () => {
    const { oc, stub, cohortId } = advertiseOne();
    stub.setPhase(cohortId, 'Advertised');
    expect(oc.directory()).toHaveLength(1);
    expect(oc.status().openCohorts).toBe(1);
  });

  it('excludes settled/pre-advert phases (Complete/Failed/Created) from directory and open count', () => {
    const { oc, stub, cohortId } = advertiseOne();
    stub.setJoined(cohortId, 2);
    for (const phase of ['Complete', 'Failed', 'Created']) {
      stub.setPhase(cohortId, phase);
      expect(oc.directory()).toHaveLength(0);
      expect(oc.status().openCohorts).toBe(0);
    }
  });
});
