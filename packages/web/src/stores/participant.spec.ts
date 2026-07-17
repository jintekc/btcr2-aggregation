import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '@btcr2-aggregation/shared';
import type { DirectoryCohortDTO } from '../lib/operator';
import { fetchAnchor, type AnchorDTO } from '../lib/anchor';
import {
  deriveStage,
  pickedCohortClosed,
  preSeatFitWarning,
  roundTripOutcome,
  useParticipant,
  type StageInput,
} from './participant';

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

// Public anchor client (PART-04, D-20/D-21). Mode-honest last-known anchor read; the
// store polls it only in post-sign stages. Anonymous by construction (credentials
// omitted); an unknown cohort is a normal { state: 'none' } answer, not an error.

describe('lib/anchor fetchAnchor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs the public anchor read with the operator cookie omitted', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify({ enabled: true, state: 'confirmed', txid: 'ab12' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const dto = await fetchAnchor('http://127.0.0.1:8080/', 'cohort-1');
    expect(dto).toEqual({ enabled: true, state: 'confirmed', txid: 'ab12' });
    // Public read: the anonymous surface must never send the operator session cookie.
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.url).toContain('/v1/anchor/cohort-1');
  });

  it('throws on a non-2xx response (the poll caller counts it as unreachable, D-24)', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('nope', { status: 502 })),
    );
    await expect(fetchAnchor('http://127.0.0.1:8080', 'cohort-1')).rejects.toThrow(/502/);
  });
});

// Explicit-submit window (PART-03, D-12). The deferred onProvideUpdate is exercised
// end to end by the browser capstone (03-06); here we pin the store-owned projection
// and the teardown-safety contract: submitUpdate() closes the window idempotently, and
// every teardown path clears it WITHOUT settling the deferred (Pitfall 2).

describe('participant store - explicit submit window (PART-03, D-12)', () => {
  beforeEach(() => {
    useParticipant.setState({ status: 'live', pendingSubmit: false, error: null, log: [] });
  });

  afterEach(() => {
    // leave() tears down module-scope state so nothing leaks across tests.
    useParticipant.getState().leave();
  });

  it('submitUpdate() closes an open submit window', () => {
    useParticipant.setState({ pendingSubmit: true });
    useParticipant.getState().submitUpdate();
    expect(useParticipant.getState().pendingSubmit).toBe(false);
  });

  it('submitUpdate() is idempotent - a repeated click is a no-op', () => {
    useParticipant.setState({ pendingSubmit: true });
    useParticipant.getState().submitUpdate();
    expect(() => useParticipant.getState().submitUpdate()).not.toThrow();
    expect(useParticipant.getState().pendingSubmit).toBe(false);
  });

  it('leave() clears an open submit window without stalling the cohort (Pitfall 2)', () => {
    useParticipant.setState({ pendingSubmit: true });
    useParticipant.getState().leave();
    expect(useParticipant.getState().pendingSubmit).toBe(false);
  });
});

// Pure render authority (D-01/D-31, Pattern 3). deriveStage is the SINGLE stage
// selector the cohort page renders; no parallel stage enum is stored. roundTripOutcome
// and preSeatFitWarning are the honest round-trip + pre-seat-fit helpers. All three are
// pure (no set/get), spec-pinned in the same style as pickedCohortClosed.

/** Build a minimal StageInput for the deriveStage transition tests. */
function stageInput(over: Partial<StageInput> = {}): StageInput {
  return {
    status: 'live',
    optedIn: true,
    seated: false,
    pendingSubmit: false,
    steps: { join: 'done', submit: 'active', sign: 'idle', anchored: 'idle' },
    anchor: null,
    resolveStatus: 'idle',
    ...over,
  };
}

describe('participant store - deriveStage (pure render authority)', () => {
  it('is waiting-for-seats while opted in but not yet seated', () => {
    expect(deriveStage(stageInput({ seated: false }))).toBe('waiting-for-seats');
  });

  it('is seated once the cohort locks with us in it (before the submit window)', () => {
    expect(deriveStage(stageInput({ seated: true }))).toBe('seated');
  });

  it('is submit-window while the explicit-submit deferred is open', () => {
    // pendingSubmit dominates seated: the runner is asking for the update right now.
    expect(deriveStage(stageInput({ seated: true, pendingSubmit: true }))).toBe('submit-window');
  });

  it('is co-signing once the update is submitted (steps.submit done)', () => {
    expect(
      deriveStage(stageInput({ seated: true, steps: { join: 'done', submit: 'done', sign: 'active', anchored: 'idle' } })),
    ).toBe('co-signing');
  });

  it('is signed on a hermetic complete (no broadcast: anchor disabled or null)', () => {
    expect(deriveStage(stageInput({ status: 'complete', anchor: { enabled: false, state: 'none' } }))).toBe('signed');
    expect(deriveStage(stageInput({ status: 'complete', anchor: null }))).toBe('signed');
  });

  it('is anchored on a live complete with a broadcast/confirmed anchor', () => {
    expect(
      deriveStage(stageInput({ status: 'complete', anchor: { enabled: true, state: 'confirmed', txid: 'ab' } })),
    ).toBe('anchored');
    expect(
      deriveStage(stageInput({ status: 'complete', anchor: { enabled: true, state: 'broadcast', txid: 'ab' } })),
    ).toBe('anchored');
  });

  it('is resolved once resolution lands (regardless of anchor mode)', () => {
    expect(deriveStage(stageInput({ status: 'complete', resolveStatus: 'resolved' }))).toBe('resolved');
  });
});

describe('participant store - roundTripOutcome (Finding 7, three honest outcomes)', () => {
  it('is reflected on a live path where the appended beacon is present', () => {
    expect(roundTripOutcome({ beaconPresent: true, anchorEnabled: true })).toBe('reflected');
  });

  it('is hermetic-genesis when the service does not broadcast (expected, NOT a mismatch)', () => {
    expect(roundTripOutcome({ beaconPresent: false, anchorEnabled: false })).toBe('hermetic-genesis');
    // Even if a beacon somehow appears, a no-broadcast service is still the expected
    // fixture outcome, never a mismatch warning.
    expect(roundTripOutcome({ beaconPresent: true, anchorEnabled: false })).toBe('hermetic-genesis');
  });

  it('is not-reflected on a live path where the beacon is absent (honest warning + retry)', () => {
    expect(roundTripOutcome({ beaconPresent: false, anchorEnabled: true })).toBe('not-reflected');
  });
});

describe('participant store - preSeatFitWarning (D-19, warn-only, pre-seat computable only)', () => {
  const k1: Identity = { did: 'did:btcr2:k1qexample', keys: {} as Identity['keys'] };
  const x1Cas: Identity = {
    did: 'did:btcr2:x1example',
    keys: {} as Identity['keys'],
    genesisDocument: { service: [{ type: 'CASBeacon', serviceEndpoint: 'bitcoin:tb1qexample' }] },
  };

  it('returns null for no identity', () => {
    expect(preSeatFitWarning(null, dirRow('abc', 'Advertised'), 'mutinynet')).toBeNull();
  });

  it('returns null for a KEY identity on the matching network (no baked beacon)', () => {
    expect(preSeatFitWarning(k1, dirRow('abc', 'Advertised'), 'mutinynet')).toBeNull();
  });

  it('warns on a baked aggregate-beacon TYPE mismatch (baked CAS, cohort SMT)', () => {
    const smtRow = { ...dirRow('abc', 'Advertised'), beaconType: 'SMTBeacon' as const };
    expect(preSeatFitWarning(x1Cas, smtRow, 'mutinynet')).toMatch(/beacon/i);
  });

  it('returns null when the baked beacon type matches the cohort type', () => {
    expect(preSeatFitWarning(x1Cas, dirRow('abc', 'Advertised'), 'mutinynet')).toBeNull();
  });

  it('warns on a network mismatch (row network differs from the participant network)', () => {
    const signetRow = { ...dirRow('abc', 'Advertised'), network: 'signet' };
    expect(preSeatFitWarning(k1, signetRow, 'mutinynet')).toMatch(/network|signet|mutinynet/i);
  });
});
