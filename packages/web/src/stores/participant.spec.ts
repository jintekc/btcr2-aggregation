import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryCohortDTO } from '../lib/operator';
import { pickedCohortClosed, useParticipant } from './participant';

// The join-seat grace window (participant.ts JOIN_SEAT_GRACE_MS). Mirrored here as a
// literal (the store keeps it module-private) so the grace-window tests can advance
// fake timers exactly to the boundary. Must stay in step with the source constant.
const JOIN_SEAT_GRACE_MS = 90000;

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
function dirRow(cohortId: string, phase: string, joined = 0, capacity = 2): DirectoryCohortDTO {
  return {
    cohortId,
    beaconType: 'CASBeacon',
    network: 'mutinynet',
    threshold: 2,
    capacity,
    joined,
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
      // Fake timers so the moved grace window (armed at observed departure) is driven
      // deterministically, and so no real module-scope setTimeout leaks across tests.
      vi.useFakeTimers();
      useParticipant.setState({
        status: 'live',
        seated: false,
        // Default the tests to the NOT-opted-in case (no cohort-joined yet): the picked
        // cohort leaving Advertised then legitimately means we missed it. The opted-in
        // member-protection case (CR-01) sets optedIn: true explicitly below.
        optedIn: false,
        joinClosed: false,
        pickedCohortId: 'abc',
        awaitingSeats: null,
        error: null,
        log: [],
        steps: { join: 'done', submit: 'active', sign: 'idle', anchored: 'idle' },
      });
    });

    afterEach(() => {
      // leave() clears the module-scope joinGrace timer + joinGraceLogged one-shot so the
      // armed grace never fires into (or leaks past) a later test; then restore real timers.
      useParticipant.getState().leave();
      vi.useRealTimers();
    });

    it('transitions to a filled-or-closed terminal state when the picked cohort leaves Advertised before opting in', () => {
      // Preserved path (CR-01): not yet opted in (no cohort-joined), so a cohort that
      // leaves the Advertised set closed before we could join - failing now is correct.
      useParticipant.getState().handleDirectorySnapshot([]);
      const s = useParticipant.getState();
      expect(s.status).toBe('failed');
      expect(s.joinClosed).toBe(true);
      expect(s.error).toMatch(/filled or closed/i);
    });

    it('also fails the not-opted-in path when connecting (pre-live close)', () => {
      // The legitimate "closed before I could opt in" path also holds from 'connecting'.
      useParticipant.setState({ status: 'connecting', optedIn: false });
      useParticipant.getState().handleDirectorySnapshot([dirRow('other', 'Advertised')]);
      const s = useParticipant.getState();
      expect(s.status).toBe('failed');
      expect(s.joinClosed).toBe(true);
    });

    it('captures awaitingSeats and never fails an opted-in member while the picked cohort is still Advertised (G-02-2)', () => {
      // The wait-for-n truth: opted in, the picked cohort is STILL openly Advertised and
      // filling (1/2 seats). The store records the polled counts into awaitingSeats for a
      // truthful waiting line, and - critically - advancing well past the OLD 90s window
      // does NOT fail the member (the grace no longer arms at opt-in). This is RED on the
      // pre-move code: there was no awaitingSeats field, and the opt-in-armed grace fired.
      useParticipant.setState({ optedIn: true, status: 'live' });
      useParticipant.getState().handleDirectorySnapshot([dirRow('abc', 'Advertised', 1, 2)]);
      let s = useParticipant.getState();
      expect(s.awaitingSeats).toEqual({ joined: 1, capacity: 2 });
      vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS + 1000);
      s = useParticipant.getState();
      expect(s.status).toBe('live');
      expect(s.joinClosed).toBe(false);
    });

    it('arms the grace once on an observed departure and resolves to filled-or-closed after the window (G-02-2)', () => {
      // Opted in, then the picked cohort leaves Advertised (departure). The poll never
      // fails directly; it arms the bounded grace. With no cohort-ready inside the window
      // the grace resolves to the deterministic filled-or-closed terminal. RED on the
      // pre-move code: its opted-in branch only logged and armed nothing, so advancing
      // timers would leave the member 'live'.
      useParticipant.setState({ optedIn: true, status: 'live' });
      useParticipant.getState().handleDirectorySnapshot([]);
      // Still live the instant the timer is armed (the poll itself never fails a member).
      expect(useParticipant.getState().status).toBe('live');
      vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS);
      const s = useParticipant.getState();
      expect(s.status).toBe('failed');
      expect(s.joinClosed).toBe(true);
      expect(s.error).toMatch(/filled or closed/i);
    });

    it('protects a genuine member seated during the grace window (CR-01)', () => {
      // The departure arms the grace, then cohort-ready seats the member (simulated by
      // setState seated: true). The grace callback's !seated guard must spare it: after
      // the full window it stays live, never failed.
      useParticipant.setState({ optedIn: true, status: 'live' });
      useParticipant.getState().handleDirectorySnapshot([]);
      useParticipant.setState({ seated: true });
      vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS);
      const s = useParticipant.getState();
      expect(s.status).toBe('live');
      expect(s.joinClosed).toBe(false);
    });

    it('measures the grace from the FIRST departure and later polls do not reset it (arm-once)', () => {
      // Arm-once means the 90s window starts at the FIRST observed departure and later
      // ~5s poll ticks over the still-departed cohort must NOT re-arm or extend it. Arm at
      // t0, advance to just under the window while feeding more departure snapshots (which
      // must not push the deadline out), then cross the ORIGINAL boundary and assert the
      // join fails exactly at t0 + JOIN_SEAT_GRACE_MS - not later. No seated:true shortcut:
      // the pre-fix test masked arm-once behind the callback's !seated guard, so it passed
      // even with the one-shot removed and timers stacked. This pins the TIMING (WR-03).
      useParticipant.setState({ optedIn: true, status: 'live' });
      useParticipant.getState().handleDirectorySnapshot([]);        // arm at t0
      vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS - 1000);            // t0 + 89s
      // Later departure ticks must not re-arm or reset the window (joinGraceLogged one-shot).
      useParticipant.getState().handleDirectorySnapshot([]);
      useParticipant.getState().handleDirectorySnapshot([dirRow('other', 'CohortSet')]);
      // Still inside the ORIGINAL window: not yet failed.
      expect(useParticipant.getState().status).toBe('live');
      // Cross the original t0 + 90s boundary. If a later poll had reset the window this
      // would still be 'live'; arm-once means the single timer fires exactly here.
      vi.advanceTimersByTime(1000);                                // t0 + 90s
      const s = useParticipant.getState();
      expect(s.status).toBe('failed');
      expect(s.joinClosed).toBe(true);
      expect(s.error).toMatch(/filled or closed/i);
    });

    it('protects an opted-in member the instant the picked cohort leaves Advertised (CR-01)', () => {
      // CR-01 core: after cohort-joined (optedIn: true) but before cohort-ready (seated
      // still false), a directory poll that no longer lists the picked cohort as
      // Advertised is AMBIGUOUS - the cohort locks membership at threshold BEFORE keygen
      // finishes, so this member may be forming with cohort-ready imminent. The poll must
      // NOT tear it down (that would drop it from the n-of-n round and stall every member);
      // it only arms the bounded grace. Assert the member is protected at that instant.
      useParticipant.setState({ optedIn: true });
      useParticipant.getState().handleDirectorySnapshot([]);
      const s = useParticipant.getState();
      expect(s.status).toBe('live');
      expect(s.joinClosed).toBe(false);
      expect(s.seated).toBe(false);
      expect(s.error).toBeNull();
    });

    it('is a no-op once seated (a seated cohort legitimately leaves Advertised)', () => {
      useParticipant.setState({ seated: true, optedIn: true });
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

    it('resets awaitingSeats to null on leave()', () => {
      // The waiting surface must not survive a leave: leave() clears awaitingSeats along
      // with seated/optedIn/joinClosed. RED on the pre-move code (leave never touched it).
      useParticipant.setState({ awaitingSeats: { joined: 1, capacity: 2 } });
      useParticipant.getState().leave();
      expect(useParticipant.getState().awaitingSeats).toBeNull();
    });
  });
});
