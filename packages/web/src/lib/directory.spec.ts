import { describe, expect, it } from 'vitest';
import {
  JOINABLE_PHASE,
  beaconGloss,
  isJoinable,
  statusLabel,
  statusTone,
  type DirectoryCohortDTO,
} from './directory';

// Hermetic unit tests for the pure browse helpers (no network). These encode the
// Advertised-only joinability delta (RESEARCH Finding 3 / Pitfall 1): a cohort locks
// membership at threshold the instant it leaves Advertised, so only an Advertised row
// with a free seat is joinable, and every other phase is display-only.

function row(over: Partial<DirectoryCohortDTO> = {}): DirectoryCohortDTO {
  return {
    cohortId: 'cohort-1',
    beaconType: 'CASBeacon',
    network: 'mutinynet',
    threshold: 3,
    capacity: 3,
    joined: 0,
    phase: 'Advertised',
    ...over,
  };
}

describe('directory helpers - JOINABLE_PHASE', () => {
  it('is the string Advertised (the only joinable phase)', () => {
    expect(JOINABLE_PHASE).toBe('Advertised');
  });
});

describe('directory helpers - isJoinable (Advertised-only + capacity)', () => {
  it('is true for an Advertised row with a free seat', () => {
    expect(isJoinable(row({ phase: 'Advertised', joined: 1, capacity: 3 }))).toBe(true);
  });

  it('is false for an Advertised row at capacity', () => {
    expect(isJoinable(row({ phase: 'Advertised', joined: 3, capacity: 3 }))).toBe(false);
  });

  it('is false for a CohortSet row even with a free seat', () => {
    expect(isJoinable(row({ phase: 'CohortSet', joined: 1, capacity: 3 }))).toBe(false);
  });

  it('is false for a CollectingUpdates row even with a free seat', () => {
    expect(isJoinable(row({ phase: 'CollectingUpdates', joined: 1, capacity: 3 }))).toBe(false);
  });
});

describe('directory helpers - statusLabel (all four labels incl. Full)', () => {
  it('maps Advertised -> Open', () => {
    expect(statusLabel(row({ phase: 'Advertised', joined: 1, capacity: 3 }))).toBe('Open');
  });

  it('maps CohortSet -> Filling', () => {
    expect(statusLabel(row({ phase: 'CohortSet', joined: 1, capacity: 3 }))).toBe('Filling');
  });

  it('maps CollectingUpdates -> Collecting updates', () => {
    expect(statusLabel(row({ phase: 'CollectingUpdates', joined: 1, capacity: 3 }))).toBe('Collecting updates');
  });

  it('maps a full row -> Full regardless of phase', () => {
    expect(statusLabel(row({ phase: 'Advertised', joined: 3, capacity: 3 }))).toBe('Full');
    expect(statusLabel(row({ phase: 'CohortSet', joined: 5, capacity: 3 }))).toBe('Full');
  });

  it('falls back to the raw phase for an unknown phase', () => {
    expect(statusLabel(row({ phase: 'SomethingNew', joined: 0, capacity: 3 }))).toBe('SomethingNew');
  });

  it('maps an in-flight signing phase -> In progress even when full (D-26)', () => {
    // A co-signing cohort is full (joined == capacity); the in-flight label wins so the
    // busy row reads "In progress" rather than a bare "Full".
    expect(statusLabel(row({ phase: 'SigningStarted', joined: 3, capacity: 3 }))).toBe('In progress');
    expect(statusLabel(row({ phase: 'NoncesCollected', joined: 3, capacity: 3 }))).toBe('In progress');
    expect(statusLabel(row({ phase: 'AwaitingPartialSigs', joined: 3, capacity: 3 }))).toBe('In progress');
  });
});

describe('directory helpers - statusTone', () => {
  it('maps Open -> accent', () => {
    expect(statusTone(row({ phase: 'Advertised', joined: 1, capacity: 3 }))).toBe('accent');
  });

  it('maps Filling -> warn', () => {
    expect(statusTone(row({ phase: 'CohortSet', joined: 1, capacity: 3 }))).toBe('warn');
  });

  it('maps Collecting updates -> neutral', () => {
    expect(statusTone(row({ phase: 'CollectingUpdates', joined: 1, capacity: 3 }))).toBe('neutral');
  });

  it('maps Full -> neutral', () => {
    expect(statusTone(row({ phase: 'Advertised', joined: 3, capacity: 3 }))).toBe('neutral');
  });
});

describe('directory helpers - beaconGloss', () => {
  it('maps CASBeacon -> CAS content-addressed gloss', () => {
    expect(beaconGloss('CASBeacon')).toBe('CAS · content-addressed');
  });

  it('maps SMTBeacon -> SMT sparse Merkle tree gloss', () => {
    expect(beaconGloss('SMTBeacon')).toBe('SMT · sparse Merkle tree');
  });
});
