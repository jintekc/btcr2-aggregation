import { beforeEach, describe, expect, it } from 'vitest';
import type { DirectoryCohortDTO } from '../lib/operator';
import { pickedCohortClosed, useParticipant } from './participant';

// Coverage of the store-level mainnet guard on register(): the acknowledgment gate
// must live BENEATH the UI (defense in depth) and fire before any network I/O, so
// these tests never need a coordinator - a blocked registration fails synchronously
// and an allowed one falls through to the no-identity early return untouched.

describe('participant store - register() mainnet guard', () => {
  beforeEach(() => {
    useParticipant.setState({
      identity: null,
      did: null,
      network: 'mutinynet',
      regStatus: 'idle',
      regError: null,
      log: [],
    });
  });

  it('refuses a mainnet registration without the real-funds acknowledgment', async () => {
    useParticipant.setState({ network: 'bitcoin' });
    await useParticipant.getState().register('http://127.0.0.1:0');
    const s = useParticipant.getState();
    expect(s.regStatus).toBe('failed');
    expect(s.regError).toMatch(/mainnet/i);
  });

  it('passes the gate with acknowledgeMainnet (then stops at the no-identity guard)', async () => {
    useParticipant.setState({ network: 'bitcoin' });
    await useParticipant.getState().register('http://127.0.0.1:0', { acknowledgeMainnet: true });
    const s = useParticipant.getState();
    // No identity/result in this state, so registration exits silently - the point
    // is that the MAINNET gate did not fire.
    expect(s.regStatus).toBe('idle');
    expect(s.regError).toBeNull();
  });

  it('does not gate test networks (mutinynet proceeds without acknowledgment)', async () => {
    await useParticipant.getState().register('http://127.0.0.1:0');
    const s = useParticipant.getState();
    expect(s.regStatus).toBe('idle');
    expect(s.regError).toBeNull();
  });
});

// Browse-and-pick join outcome (PART-02, D-06/D-11/D-12/D-14). These cover the two
// deterministic pieces the store owns: the pure `pickedCohortClosed` directory
// predicate and the `handleDirectorySnapshot` transition it drives. Both are
// hermetic (setState -> pure fn / method -> getState); the live createParticipant +
// interval poll path is exercised by plan 01's e2e, not here.

/** Build a minimal directory row for the outcome predicate tests. */
function dirRow(cohortId: string, phase: string): DirectoryCohortDTO {
  return {
    cohortId,
    beaconType: 'CASBeacon',
    network: 'mutinynet',
    threshold: 2,
    capacity: 2,
    joined: 0,
    phase,
  };
}

describe('participant store - browse-and-pick join outcome', () => {
  describe('pickedCohortClosed', () => {
    it('is false when the picked cohort is present and still Advertised (joinable)', () => {
      expect(pickedCohortClosed([dirRow('abc', 'Advertised')], 'abc')).toBe(false);
    });

    it('is true when the picked cohort is absent from the snapshot', () => {
      expect(pickedCohortClosed([dirRow('other', 'Advertised')], 'abc')).toBe(true);
      expect(pickedCohortClosed([], 'abc')).toBe(true);
    });

    it('is true when the picked cohort is present but past Advertised (membership locked)', () => {
      expect(pickedCohortClosed([dirRow('abc', 'CohortSet')], 'abc')).toBe(true);
    });
  });

  describe('handleDirectorySnapshot', () => {
    beforeEach(() => {
      useParticipant.setState({
        status: 'live',
        seated: false,
        joinClosed: false,
        pickedCohortId: 'abc',
        error: null,
        log: [],
        steps: { join: 'done', submit: 'active', sign: 'idle', anchored: 'idle' },
      });
    });

    it('transitions to a filled-or-closed terminal state when the picked cohort leaves Advertised before seating', () => {
      useParticipant.getState().handleDirectorySnapshot([]);
      const s = useParticipant.getState();
      expect(s.status).toBe('failed');
      expect(s.joinClosed).toBe(true);
      expect(s.error).toMatch(/filled or closed/i);
    });

    it('is a no-op once seated (a seated cohort legitimately leaves Advertised)', () => {
      useParticipant.setState({ seated: true });
      useParticipant.getState().handleDirectorySnapshot([]);
      const s = useParticipant.getState();
      expect(s.status).toBe('live');
      expect(s.joinClosed).toBe(false);
    });

    it('stays live while the picked cohort is still Advertised', () => {
      useParticipant.getState().handleDirectorySnapshot([dirRow('abc', 'Advertised')]);
      const s = useParticipant.getState();
      expect(s.status).toBe('live');
      expect(s.joinClosed).toBe(false);
    });
  });
});
