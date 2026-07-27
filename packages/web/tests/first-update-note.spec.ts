import { describe, expect, it } from 'vitest';
import { firstUpdateResolveNote } from '../src/stores/participant';

/**
 * Pure-function coverage for the ADR 0007 first-update honest-resolve note (D-46): the KEY DID
 * chicken-and-egg where a resolver only discovers signals at beacons already in the document under
 * resolution, so a KEY controller's FIRST aggregated update resolves only after their own genesis
 * registration signal confirms. {@link firstUpdateResolveNote} is the render authority the Resolve
 * round-trip card reads; this asserts every branch without a DOM or network, INCLUDING the D-07
 * confirmed-only "anchored" discipline: the copy may claim "anchored" only when anchorConfirmed
 * (state === 'confirmed'), never on the mode bit alone (a broadcast/none/failed anchor keeps
 * anchorEnabled true, and auto-resolve fires on a failed anchor too, so an enabled-keyed claim
 * would render a false "anchored" right under the broadcast-failed narration). NEW spec under
 * `packages/web/tests/` (tests-outside-src convention); imports via `../src/...`.
 */
describe('firstUpdateResolveNote', () => {
  const base = {
    idType: 'KEY',
    anchorEnabled: true,
    anchorConfirmed: true,
    beaconPresent: false,
    regStatus: 'idle',
  } as const;

  it('claims anchored + register-first when the anchor is CONFIRMED and nothing is registered', () => {
    const note = firstUpdateResolveNote(base);
    expect(note).toMatch(/Your update is anchored/);
    expect(note).toMatch(/Register first update/);
    expect(note).toMatch(/resolution will not show it/);
  });

  it('drops the anchored claim on an UNCONFIRMED anchor (broadcast/none): state-neutral copy', () => {
    const note = firstUpdateResolveNote({ ...base, anchorConfirmed: false });
    expect(note).toMatch(/Resolution will not show your update/);
    expect(note).toMatch(/Register first update/);
    // D-07/Truth 8: never claim "anchored" before the beacon tx is mined.
    expect(note).not.toMatch(/anchored/i);
  });

  it('never claims anchored on a FAILED anchor (enabled stays true; auto-resolve fires on failed)', () => {
    // A terminally failed broadcast keeps anchorEnabled true but is not confirmed: the note must
    // still guide registration (valid in every anchor state per ADR 0007) WITHOUT the word
    // "anchored", so it cannot contradict the broadcast-failed narration rendered above it.
    const note = firstUpdateResolveNote({ ...base, anchorConfirmed: false });
    expect(note).not.toBeNull();
    expect(note).not.toMatch(/anchored/i);
  });

  it('returns the awaiting-confirmation note once the registration signal is broadcast', () => {
    const note = firstUpdateResolveNote({ ...base, regStatus: 'registered' });
    expect(note).toMatch(/registration signal is broadcast/);
    expect(note).toMatch(/confirms on-chain/);
    // The registered branch applies whatever the anchor state is, and never claims "anchored".
    const unconfirmed = firstUpdateResolveNote({ ...base, anchorConfirmed: false, regStatus: 'registered' });
    expect(unconfirmed).toBe(note);
    expect(note).not.toMatch(/anchored/i);
  });

  it('returns null for an EXTERNAL (x1) DID: it bakes the aggregate beacon into genesis', () => {
    expect(firstUpdateResolveNote({ ...base, idType: 'EXTERNAL' })).toBeNull();
  });

  it('returns null on a hermetic (no-broadcast) service: no on-chain signal to discover', () => {
    expect(firstUpdateResolveNote({ ...base, anchorEnabled: false, anchorConfirmed: false })).toBeNull();
  });

  it('returns null once the aggregate beacon is present: the first update already resolved', () => {
    expect(firstUpdateResolveNote({ ...base, beaconPresent: true })).toBeNull();
    // Even a broadcast-but-present combination is resolved: presence dominates.
    expect(firstUpdateResolveNote({ ...base, beaconPresent: true, regStatus: 'registered' })).toBeNull();
  });
});
