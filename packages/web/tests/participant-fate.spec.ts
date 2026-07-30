import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANCELED_NARRATION,
  HONEST_TERMINAL_FALLBACK,
  STALL_NARRATION,
  terminalReason,
  useParticipant,
} from '../src/stores/participant';
import type { StepKey, StepStatus } from '../src/lib/types';

/**
 * The CALLER of the public cohort-fate read (SVC-04, D-02, T-05-10-04, `05-AUDIT-2.md`
 * entries 5 and 9).
 *
 * `packages/web/src/lib/cohort-fate.ts` states the invariant in words at the top of the file:
 * a network fault must never be able to fabricate an accusation against an operator. The read
 * itself has thorough rows (`terminal-reason.spec.ts`), and the server route is non-oracle by
 * deep equality. What NOTHING had was a caller. Every one of the nine
 * `handlePostSeatSnapshot` calls in the repo passed a single argument, so the whole guarded
 * block inside the store - the one place an answer becomes an accusation - had never executed
 * in a test at all. This file executes it, on every shape of answer it can receive.
 *
 * Three properties are asserted here and nowhere else:
 *
 * 1. **Only a 200 carrying the boolean `true` may name the operator.** A thrown fetch, a 500,
 *    an unreadable body and a truthy-but-not-boolean field are each exercised, and each row
 *    asserts BOTH that `canceled` stayed false AND that the rendered terminal copy is
 *    unchanged. A refusal that left the flag false but swapped the sentence for something else
 *    would still be a defect, and only the second assertion catches it.
 * 2. **The read is anonymous and cohort-keyed.** Its exact path and its `credentials: 'omit'`
 *    are asserted at the point the STORE makes the call, not only inside the client.
 * 3. **The answer applies to the round that asked.** An answer that arrives after the
 *    participant has moved on is discarded.
 *
 * These are async store tests, not renders: they call an action and read state back. Seeding
 * with `setState` is correct here for exactly that reason (the prohibition on `setState`
 * seeding applies to `renderStatic`, which reads a store's INITIAL state).
 */

const BASE = 'http://svc.example';
const COHORT = 'abc';

/** The path the shipped public route serves, as `fetchCohortFate` builds it. */
const FATE_URL = `${BASE}/v1/cohort-fate/${COHORT}`;

const PARTICIPANT_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/stores/participant.ts', import.meta.url)),
  'utf8',
);

/**
 * The shipped gone-streak length, read OUT OF THE SOURCE rather than retyped.
 *
 * The constant is module-private and must stay exactly as it is: it exists to win the race
 * against cohort-complete (03-07 CR-01), and a spec that hardcoded 2 would quietly stop
 * completing the streak the day somebody changed it, leaving every row below passing
 * vacuously against a fate read that never ran. `terminal-reason.spec.ts` pins the constant's
 * VALUE; this reads it, so the two cannot disagree.
 */
const GONE_STREAK = Number(
  /const POST_SEAT_GONE_CONFIRMATIONS = (\d+);/.exec(PARTICIPANT_SOURCE)?.[1],
);

/** A participant seated but not yet submitted: the classifier's stall branch cannot fire. */
const preSubmitSteps: Record<StepKey, StepStatus> = {
  join: 'done',
  submit: 'active',
  sign: 'idle',
  anchored: 'idle',
};

/** A participant whose update is in but co-signing never completed (the mid-round shape). */
const submittedUnsignedSteps: Record<StepKey, StepStatus> = {
  join: 'done',
  submit: 'done',
  sign: 'active',
  anchored: 'idle',
};

/** The recorded `fetch`, typed as the thing it stands in for so its call tuple is fetch's own. */
let fateFetch: ReturnType<typeof vi.fn<typeof fetch>>;

/** Install a `fetch` stub answering every call with `answer()`, and record the calls. */
function stubFate(answer: () => Promise<Response>): void {
  fateFetch = vi.fn<typeof fetch>(() => answer());
  vi.stubGlobal('fetch', fateFetch);
}

/**
 * Let the fate read's whole promise chain run.
 *
 * The store fires it as `void fetchCohortFate(...).then(...)`, so nothing in the caller is
 * awaitable. A macrotask turn drains every already-resolved microtask behind it, which is what
 * makes a NEGATIVE assertion ("still false") meaningful rather than merely early.
 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Seat the store on a live picked cohort, in the shape the shipped post-seat rows use.
 * Mirrors `packages/web/src/stores/participant.spec.ts`'s post-seat seed rather than
 * inventing one, plus the two facts the terminal copy is computed from.
 */
function seatOnLiveCohort(steps: Record<StepKey, StepStatus> = preSubmitSteps): void {
  useParticipant.setState({
    status: 'live',
    seated: true,
    pickedCohortId: COHORT,
    unreachable: false,
    canceled: false,
    validationRequested: false,
    error: null,
    log: [],
    steps: { ...steps },
  });
}

/** Feed enough consecutive gone snapshots to complete the shipped streak. */
function completeGoneStreak(): void {
  for (let i = 0; i < GONE_STREAK; i += 1) {
    useParticipant.getState().handlePostSeatSnapshot([], BASE);
  }
}

/**
 * The sentence a participant actually reads on the terminal card.
 *
 * This is the EXACT expression `packages/web/src/components/cohort/CohortPage.tsx:210` renders,
 * evaluated over the store's own facts, so a refusal that changed the copy without changing the
 * flag cannot slip past.
 */
function renderedTerminalReason(): string {
  const s = useParticipant.getState();
  return terminalReason({
    canceled: s.canceled,
    error: s.error,
    steps: s.steps,
    validationRequested: s.validationRequested,
  });
}

beforeEach(() => {
  seatOnLiveCohort();
});

afterEach(() => {
  // `leave()` tears the live round down, which resets the module-scope gone streak. Without it
  // a leftover streak from one row would complete the next row's on its first snapshot.
  useParticipant.getState().leave();
  vi.unstubAllGlobals();
});

describe('the fate read is reached at all (the streak, then one question)', () => {
  it('reads the shipped streak length out of the source rather than assuming it', () => {
    // If this regex ever stops matching, every row below would complete no streak and pass
    // vacuously. Fail loudly here instead.
    expect(Number.isInteger(GONE_STREAK)).toBe(true);
    expect(GONE_STREAK).toBeGreaterThanOrEqual(1);
  });

  it('asks nothing until the gone streak has ALREADY landed the terminal state', async () => {
    stubFate(async () => new Response(JSON.stringify({ canceled: true }), { status: 200 }));
    for (let i = 0; i < GONE_STREAK - 1; i += 1) {
      useParticipant.getState().handlePostSeatSnapshot([], BASE);
    }
    await settle();
    // The streak is deliberately unshortened: the fate read can only ever UPGRADE the copy, so
    // asking early would buy nothing and could only cost the race against cohort-complete.
    expect(useParticipant.getState().status).toBe('live');
    expect(fateFetch).toHaveBeenCalledTimes(0);
  });

  it('asks the cohort-keyed PUBLIC path, anonymously, with no session cookie', async () => {
    stubFate(async () => new Response(JSON.stringify({ canceled: false }), { status: 200 }));
    completeGoneStreak();
    await settle();
    expect(fateFetch.mock.calls[0]?.[0]).toBe(FATE_URL);
    // An anonymous read of public state. Sending credentials would make a route that answers
    // every stranger identically behave differently for a participant who happens to be holding
    // an operator session cookie in the same browser, which is the one thing it must not do.
    expect(fateFetch.mock.calls[0]?.[1]?.credentials).toBe('omit');
  });

  it('asks ONCE per completed streak, never on a loop', async () => {
    stubFate(async () => new Response(JSON.stringify({ canceled: false }), { status: 200 }));
    completeGoneStreak();
    await settle();
    expect(fateFetch).toHaveBeenCalledTimes(1);
    // Further snapshots after the terminal landed add no further reads: the round is over, and a
    // repeating anonymous read would add recurring public load for an answer that cannot change
    // what already happened (T-05-10-03).
    useParticipant.getState().handlePostSeatSnapshot([], BASE);
    useParticipant.getState().handlePostSeatSnapshot([], BASE);
    await settle();
    expect(fateFetch).toHaveBeenCalledTimes(1);
  });
});

describe('a fault cannot fabricate a cancel accusation (T-05-10-04)', () => {
  /** Every refusal shape asserts the same two facts: no flag, and no change of sentence. */
  async function expectRefused(): Promise<void> {
    completeGoneStreak();
    await settle();
    const s = useParticipant.getState();
    expect(s.status).toBe('failed');
    expect(s.canceled).toBe(false);
    expect(renderedTerminalReason()).toBe(HONEST_TERMINAL_FALLBACK);
    expect(renderedTerminalReason()).not.toBe(CANCELED_NARRATION);
  }

  it('refuses to accuse anyone when the service cannot be reached at all', async () => {
    stubFate(() => Promise.reject(new TypeError('Failed to fetch')));
    await expectRefused();
  });

  it('refuses to accuse anyone on a 500 (a broken service is not a deliberate act)', async () => {
    stubFate(async () => new Response('boom', { status: 500 }));
    await expectRefused();
  });

  it('refuses to accuse anyone when the 200 body cannot be read as JSON', async () => {
    // A captive portal, a proxy error page, an HTML login wall: all answer 200 with something
    // that is not an answer.
    stubFate(async () => new Response('<html>not json</html>', { status: 200 }));
    await expectRefused();
  });

  it('refuses a truthy value that is not the boolean true', async () => {
    // A specific attribution is a positive claim, so it needs a real boolean. `'yes'` is truthy
    // in every language this body could have been serialized by, and it is still not an answer.
    stubFate(async () => new Response(JSON.stringify({ canceled: 'yes' }), { status: 200 }));
    await expectRefused();
  });

  it('never names the operator on a refusal even where the copy is NOT the fallback', async () => {
    // The mid-round shape: submitted, never validation-requested, unexplained, which is what the
    // shipped classifier narrates as a stall. A refused fate read must leave that sentence
    // exactly as it is - it must neither invent the accusation nor rewrite the honest inference.
    useParticipant.getState().leave();
    seatOnLiveCohort(submittedUnsignedSteps);
    stubFate(async () => new Response('boom', { status: 500 }));
    completeGoneStreak();
    await settle();
    expect(useParticipant.getState().canceled).toBe(false);
    expect(renderedTerminalReason()).toBe(STALL_NARRATION);
    expect(renderedTerminalReason()).not.toBe(CANCELED_NARRATION);
  });
});

describe('a real answer, and only a real answer, becomes an attribution', () => {
  it('names the operator on a 200 whose body carries the boolean true', async () => {
    // The row that keeps the four refusals above honest: without it they would all pass on a
    // fate read that never worked at all.
    stubFate(async () => new Response(JSON.stringify({ canceled: true }), { status: 200 }));
    completeGoneStreak();
    await settle();
    const s = useParticipant.getState();
    expect(s.canceled).toBe(true);
    expect(renderedTerminalReason()).toBe(CANCELED_NARRATION);
    // The service said so, in the operator's own name, and the participant is told which it was.
    expect(s.log.some((entry) => /canceled by the operator/.test(entry.text))).toBe(true);
  });

  it('leaves a 200 that reports NOT canceled on the honest fallback', async () => {
    // "The service says it did not cancel" and "we could not ask" lead to the same copy today,
    // and both must stay short of an accusation.
    stubFate(async () => new Response(JSON.stringify({ canceled: false }), { status: 200 }));
    completeGoneStreak();
    await settle();
    expect(useParticipant.getState().canceled).toBe(false);
    expect(renderedTerminalReason()).toBe(HONEST_TERMINAL_FALLBACK);
  });
});

describe('the round guard: a late answer belongs to the round that asked', () => {
  it('discards a REAL cancel that arrives after the participant moved to another cohort', async () => {
    let deliver: ((res: Response) => void) | null = null;
    stubFate(
      () =>
        new Promise<Response>((resolve) => {
          deliver = resolve;
        }),
    );
    completeGoneStreak();
    await settle();
    // The question is genuinely in flight, so the answer below really does arrive late rather
    // than being prevented from arriving.
    expect(fateFetch).toHaveBeenCalledTimes(1);
    expect(deliver).not.toBeNull();

    // The participant has moved on. The answer is about a cohort that is no longer theirs.
    useParticipant.setState({ pickedCohortId: 'a-different-cohort' });
    deliver!(new Response(JSON.stringify({ canceled: true }), { status: 200 }));
    await settle();

    // A real cancel, correctly refused: attributing it now would put a cancel notice on a round
    // the participant is no longer in.
    expect(useParticipant.getState().canceled).toBe(false);
  });
});
