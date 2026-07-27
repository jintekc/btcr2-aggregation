import { describe, expect, it } from 'vitest';
import { firstUpdateResolveNote } from '../src/stores/participant';

/**
 * Pure-function coverage for the ADR 0007 first-update honest-resolve note (D-46): the KEY DID
 * chicken-and-egg where a resolver only discovers signals at beacons already in the document under
 * resolution, so a KEY controller's FIRST aggregated update resolves only after their own genesis
 * registration signal confirms. {@link firstUpdateResolveNote} is the render authority the Resolve
 * round-trip card reads; this asserts every branch without a DOM or network. NEW spec under
 * `packages/web/tests/` (tests-outside-src convention); imports via `../src/...`.
 */
describe('firstUpdateResolveNote', () => {
  const base = { idType: 'KEY', anchorEnabled: true, beaconPresent: false, regStatus: 'idle' } as const;

  it('returns the register-first note when a KEY update is anchored but not yet registered', () => {
    const note = firstUpdateResolveNote(base);
    expect(note).toMatch(/Register first update/);
    expect(note).toMatch(/resolution will not show it/);
  });

  it('returns the awaiting-confirmation note once the registration signal is broadcast', () => {
    const note = firstUpdateResolveNote({ ...base, regStatus: 'registered' });
    expect(note).toMatch(/registration signal is broadcast/);
    expect(note).toMatch(/confirms on-chain/);
  });

  it('returns null for an EXTERNAL (x1) DID: it bakes the aggregate beacon into genesis', () => {
    expect(firstUpdateResolveNote({ ...base, idType: 'EXTERNAL' })).toBeNull();
  });

  it('returns null on a hermetic (no-broadcast) service: no on-chain signal to discover', () => {
    expect(firstUpdateResolveNote({ ...base, anchorEnabled: false })).toBeNull();
  });

  it('returns null once the aggregate beacon is present: the first update already resolved', () => {
    expect(firstUpdateResolveNote({ ...base, beaconPresent: true })).toBeNull();
    // Even a broadcast-but-present combination is resolved: presence dominates.
    expect(firstUpdateResolveNote({ ...base, beaconPresent: true, regStatus: 'registered' })).toBeNull();
  });
});
