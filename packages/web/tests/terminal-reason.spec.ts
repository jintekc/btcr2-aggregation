import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCohortFate } from '../src/lib/cohort-fate';
import {
  CANCELED_NARRATION,
  HONEST_TERMINAL_FALLBACK,
  STALL_NARRATION,
  terminalReason,
} from '../src/stores/participant';
import type { StepKey, StepStatus } from '../src/lib/types';

/**
 * The participant-facing half of the cancel slice (SVC-04, D-02, UI-SPEC E14).
 *
 * The dangerous part of this feature is NOT the new copy, it is where the copy is decided. The
 * shipped `terminalReason` classifier's first branch fires on submitted-but-unsigned plus
 * not-validation-requested plus an unexplained reason - which is EXACTLY what a cohort canceled
 * after a participant submitted but before validation looks like. Left alone, an operator's
 * deliberate cancel would be narrated to the participant as `This service stalled while
 * collecting updates.`, the precise misattribution the 04 D-45 fix exists to prevent.
 *
 * So the first case below is constructed to be that input, byte for byte, and the second case is
 * the SAME input with the cancel fact false, proving the D-45 behavior survives for genuine
 * stalls. The regression this closes is pinned rather than described.
 *
 * The cancel fact arrives as a dedicated BOOLEAN, never as another alternative in the
 * regular-expression chain: keying narration on message text is what D-45 removed, and the
 * server-side fate is already carried out of band by the intent registry for the same reason.
 * The source-order pins at the bottom hold that shape in place.
 */

/** A participant whose own update is in but co-signing never completed. */
const submittedUnsigned: Record<StepKey, StepStatus> = {
  join: 'done',
  submit: 'done',
  sign: 'active',
  anchored: 'idle',
};

/** The honest reason the post-seat gone streak lands on a cohort that went dark. */
const UNEXPLAINED = "The cohort ended and this service didn't say why.";

const PARTICIPANT_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/stores/participant.ts', import.meta.url)),
  'utf8',
);

describe('terminalReason - the cancel fact is checked before the stall branch (D-02, 04 D-45)', () => {
  it('narrates a cancel as a cancel on the EXACT input that produces stall copy today', () => {
    // Submitted, never validation-requested, unexplained: all three of the stall branch's
    // conditions hold. Only the cancel fact distinguishes them, and it must win.
    expect(
      terminalReason({
        canceled: true,
        error: UNEXPLAINED,
        steps: submittedUnsigned,
        validationRequested: false,
      }),
    ).toBe(CANCELED_NARRATION);
  });

  it('never narrates a cancel as a stall, a failure, or an expiry', () => {
    const copy = terminalReason({
      canceled: true,
      error: UNEXPLAINED,
      steps: submittedUnsigned,
      validationRequested: false,
    });
    expect(copy).not.toBe(STALL_NARRATION);
    expect(copy).not.toMatch(/stall|fail|expired|timed out/i);
    // It says who ended it, in the operator's own name, because a cancel is a deliberate act.
    expect(copy).toBe('The operator canceled this cohort.');
  });

  it('keeps the shipped stall copy for the same input when the cancel fact is FALSE', () => {
    expect(
      terminalReason({
        canceled: false,
        error: UNEXPLAINED,
        steps: submittedUnsigned,
        validationRequested: false,
      }),
    ).toBe(STALL_NARRATION);
  });

  it('keeps the honest fallback when nothing is known and no stall signal is present', () => {
    // Not seated far enough to have submitted: neither stall branch applies, and the cancel fact
    // is false because the service did not say so. No certainty is invented.
    expect(
      terminalReason({
        canceled: false,
        error: UNEXPLAINED,
        steps: { join: 'done', submit: 'idle', sign: 'idle', anchored: 'idle' },
        validationRequested: false,
      }),
    ).toBe(HONEST_TERMINAL_FALLBACK);
  });

  it('prefers the cancel attribution over every other recognizable reason', () => {
    // A cohort that is canceled while its stated reason names something else is still a cancel:
    // the fact came from the service itself, the reason string is best-effort inference.
    expect(
      terminalReason({
        canceled: true,
        error: 'phase timed out',
        steps: submittedUnsigned,
        validationRequested: true,
      }),
    ).toBe(CANCELED_NARRATION);
  });
});

describe('terminalReason source shape (the ordering is load-bearing, not incidental)', () => {
  it('checks the cancel fact BEFORE the stall branch in source order', () => {
    const cancelBranch = PARTICIPANT_SOURCE.indexOf('if (input.canceled)');
    const stallBranch = PARTICIPANT_SOURCE.indexOf('validationRequested && unexplained');
    expect(cancelBranch).toBeGreaterThan(-1);
    expect(stallBranch).toBeGreaterThan(-1);
    expect(cancelBranch).toBeLessThan(stallBranch);
  });

  it('does NOT add a cancel alternative to the message-text chain (the D-45 lesson)', () => {
    // The classifier's regular expressions must stay free of any cancel wording: the fact is
    // carried out of band, so a service that happens to say "canceled" in an unrelated error
    // can never fabricate this attribution.
    const regexes = PARTICIPANT_SOURCE.match(/\/[^\n/]*\/\.test\(e\)/g) ?? [];
    expect(regexes.length).toBeGreaterThan(0);
    for (const source of regexes) {
      expect(source).not.toMatch(/cancel/i);
    }
  });

  it('leaves the post-seat gone-streak constant and its comparison exactly as shipped', () => {
    // The streak exists to win a race against cohort-complete (03-07 CR-01). The fate read
    // upgrades the copy AFTER it triggers and must never shorten it.
    expect(PARTICIPANT_SOURCE).toContain('const POST_SEAT_GONE_CONFIRMATIONS = 2;');
    expect(PARTICIPANT_SOURCE).toContain('postSeatGoneStreak < POST_SEAT_GONE_CONFIRMATIONS');
  });
});

describe('fetchCohortFate - the anonymous public read (T-05-10-04)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the canceled fact on a 200, anonymously', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return Promise.resolve(new Response(JSON.stringify({ canceled: true }), { status: 200 }));
    });

    await expect(fetchCohortFate('http://svc.example', 'cohort-1')).resolves.toEqual({
      kind: 'ok',
      canceled: true,
    });
    expect(calls[0][0]).toBe('http://svc.example/v1/cohort-fate/cohort-1');
    // No operator session cookie ever rides a participant's public read.
    expect(calls[0][1]?.credentials).toBe('omit');
  });

  it('reports unreachable WITHOUT throwing on a network failure', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('connection refused')));
    await expect(fetchCohortFate('http://svc.example', 'cohort-1')).resolves.toEqual({
      kind: 'unreachable',
    });
  });

  it('reports unreachable on a non-2xx and on a malformed body, never a fabricated cancel', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })));
    await expect(fetchCohortFate('http://svc.example', 'c')).resolves.toEqual({ kind: 'unreachable' });

    vi.stubGlobal('fetch', () => Promise.resolve(new Response('not json', { status: 200 })));
    await expect(fetchCohortFate('http://svc.example', 'c')).resolves.toEqual({ kind: 'unreachable' });
  });

  it('reads a non-boolean canceled field as NOT canceled (an accusation needs a real true)', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ canceled: 'yes' }), { status: 200 })),
    );
    await expect(fetchCohortFate('http://svc.example', 'c')).resolves.toEqual({
      kind: 'ok',
      canceled: false,
    });
  });
});
