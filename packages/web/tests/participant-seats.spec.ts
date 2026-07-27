import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useParticipant } from '../src/stores/participant';
import type { DirectoryCohortDTO } from '../src/lib/directory';

/**
 * Store-level coverage for the SVC-JOIN-1/2 + PWEB-1 seat-count fixes (the live-UAT gap where
 * two browsers joined one cohort and the participant surface never reflected both). Drives the
 * participant store's `handleDirectorySnapshot` directly (no DOM, no network - the handler reads
 * the rows it is passed) and asserts:
 *   - an Advertised row sets awaitingSeats to its live joined/capacity;
 *   - a post-Advertised row (e.g. CohortSet 2/2) UPDATES awaitingSeats without nulling and arms
 *     the join grace (the directory now keeps a seated cohort listed, so the 2/2 count survives);
 *   - a row absent from the directory entirely nulls awaitingSeats;
 *   - grace expiry with full counts fails with the locked-with-all-seats copy, and with not-full
 *     counts keeps the old filled-or-closed copy;
 *   - the cohort-joined log reads the D-11 sent-not-accepted copy, not "running distributed keygen".
 *
 * Runs in the root vitest node env like the other web store specs. NEW spec under
 * `packages/web/tests/` (tests-outside-src convention); imports via `../src/...`.
 */

// A fresh fake participant runner per createParticipant call (EventEmitter), exposed via a hoisted
// holder so the cohort-joined test can emit the event after join() registers its handlers.
const mockParticipant = vi.hoisted(() => ({ latestRunner: null as import('node:events').EventEmitter | null }));

vi.mock('@btcr2-aggregation/participant', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    createParticipant: () => {
      const runner = new EventEmitter();
      mockParticipant.latestRunner = runner;
      return { runner, start: async () => {}, stop: () => {} };
    },
  };
});

const JOIN_SEAT_GRACE_MS = 90000;

function row(over: Partial<DirectoryCohortDTO> = {}): DirectoryCohortDTO {
  return {
    cohortId: 'cohort-1',
    beaconType: 'CASBeacon',
    network: 'mutinynet',
    threshold: 2,
    capacity: 2,
    joined: 0,
    phase: 'Advertised',
    ...over,
  };
}

/** Put the store in the "opted in, waiting for a seat for cohort-1" state the handler acts on. */
function armWaiting(): void {
  useParticipant.setState({
    status: 'live',
    seated: false,
    optedIn: true,
    pickedCohortId: 'cohort-1',
    awaitingSeats: null,
    log: [],
  });
}

beforeEach(() => {
  vi.useRealTimers();
  // startOver resets the module-scope closures (joinGrace timer, joinGraceLogged one-shot, live
  // participant) as well as the store state, so each test starts from a clean join-grace state.
  useParticipant.getState().startOver();
  useParticipant.setState({ log: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleDirectorySnapshot seat-count reflection (SVC-JOIN-2 / IN-01)', () => {
  it('sets awaitingSeats from an Advertised row (still filling)', () => {
    armWaiting();
    useParticipant.getState().handleDirectorySnapshot([row({ phase: 'Advertised', joined: 1, capacity: 2 })]);
    expect(useParticipant.getState().awaitingSeats).toEqual({ joined: 1, capacity: 2 });
    // Still openly Advertised: no terminal, no grace expiry.
    expect(useParticipant.getState().status).toBe('live');
  });

  it('updates awaitingSeats to 2/2 from a CohortSet row WITHOUT nulling, and arms the grace', () => {
    vi.useFakeTimers();
    armWaiting();
    // First seen Advertised 1/2, then the cohort locks and advances to CohortSet 2/2. The row is
    // still present (widened directory), so the count updates to 2/2 rather than blanking.
    useParticipant.getState().handleDirectorySnapshot([row({ phase: 'Advertised', joined: 1, capacity: 2 })]);
    useParticipant.getState().handleDirectorySnapshot([row({ phase: 'CohortSet', joined: 2, capacity: 2 })]);
    expect(useParticipant.getState().awaitingSeats).toEqual({ joined: 2, capacity: 2 });
    expect(useParticipant.getState().status).toBe('live');
    // The cohort left Advertised while opted in, so the bounded grace was armed: firing it
    // reaches a terminal (proving the arm), which the copy test below pins precisely.
    vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS);
    expect(useParticipant.getState().status).toBe('failed');
  });

  it('nulls awaitingSeats when the picked row is absent from the directory entirely', () => {
    armWaiting();
    useParticipant.getState().handleDirectorySnapshot([row({ phase: 'Advertised', joined: 1, capacity: 2 })]);
    expect(useParticipant.getState().awaitingSeats).toEqual({ joined: 1, capacity: 2 });
    // The cohort vanishes from the directory (a different, unrelated row remains).
    useParticipant
      .getState()
      .handleDirectorySnapshot([row({ cohortId: 'other-cohort', phase: 'Advertised', joined: 0, capacity: 3 })]);
    expect(useParticipant.getState().awaitingSeats).toBeNull();
  });
});

describe('join-grace expiry copy (SVC-JOIN-1/2)', () => {
  it('fails with the locked-with-all-seats-filled copy when the last-known counts were full', () => {
    vi.useFakeTimers();
    armWaiting();
    // The cohort locked with every seat filled (2/2) but this browser never got cohort-ready.
    useParticipant.getState().handleDirectorySnapshot([row({ phase: 'CohortSet', joined: 2, capacity: 2 })]);
    vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS);
    const { status, error } = useParticipant.getState();
    expect(status).toBe('failed');
    expect(error).toBe(
      'The cohort locked with all 2 seats filled, but this browser never received its seat confirmation.',
    );
  });

  it('keeps the old filled-or-closed copy when the last-known counts were not full', () => {
    vi.useFakeTimers();
    armWaiting();
    // Left Advertised while still not full (1 of 2): the honest cause is "filled or closed".
    useParticipant.getState().handleDirectorySnapshot([row({ phase: 'CohortSet', joined: 1, capacity: 2 })]);
    vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS);
    const { status, error } = useParticipant.getState();
    expect(status).toBe('failed');
    expect(error).toBe('That cohort filled or closed before you were seated. Pick another from the directory.');
  });
});

describe('cohort-joined log copy (D-11 sent-not-accepted)', () => {
  it('logs "opt-in sent ... waiting for the cohort to fill", never "running distributed keygen"', async () => {
    vi.useFakeTimers();
    useParticipant.setState({ identity: { did: 'did:btcr2:test' } as never, status: 'ready', log: [] });
    await useParticipant.getState().join('http://svc.test', 'cohort-1', { threshold: 2, capacity: 2 });
    // The runner emits cohort-joined = opt-in SENT (no seat granted, no keygen yet).
    mockParticipant.latestRunner?.emit('cohort-joined', { cohortId: 'cohort-1' });
    const texts = useParticipant.getState().log.map((entry) => entry.text);
    expect(texts.some((t) => t.includes('running distributed keygen'))).toBe(false);
    expect(texts.some((t) => t.includes('opt-in sent for cohort cohort-1; waiting for the cohort to fill'))).toBe(true);
    // Tear the poll interval down (fake timers keep it inert, but be tidy).
    useParticipant.getState().leave();
  });
});
