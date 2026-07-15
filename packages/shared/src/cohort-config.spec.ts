import { bytesToHex } from '@noble/hashes/utils';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { describe, expect, it } from 'vitest';
import { buildCohortConfig } from './index.js';

// Coverage of the operator recovery-key threading (mainnet guard rails, ADR 0010):
// a real deployment funds the cohort beacon with real value, so the ADR 042 recovery
// leaf must be a key whose secret the OPERATOR holds - not the throwaway default,
// whose secret is derived and immediately discarded.

describe('buildCohortConfig recovery key', () => {
  it('defaults to a fresh throwaway recovery key per call', () => {
    const a = buildCohortConfig(2);
    const b = buildCohortConfig(2);
    expect(a.recoveryKey).toMatch(/^[0-9a-f]{64}$/);
    // Throwaway: a new key every time (nobody holds any of their secrets).
    expect(a.recoveryKey).not.toBe(b.recoveryKey);
    expect(a.recoverySequence).toBe(144);
  });

  it('threads an operator-supplied recovery key through verbatim (lowercased)', () => {
    const operatorKey = bytesToHex(SchnorrKeyPair.generate().publicKey.xOnly);
    const config = buildCohortConfig(3, 'SMTBeacon', 'signet', operatorKey.toUpperCase());
    expect(config.recoveryKey).toBe(operatorKey);
    expect(config.beaconType).toBe('SMTBeacon');
    expect(config.network).toBe('signet');
    expect(config.minParticipants).toBe(3);
  });

  it('rejects a malformed recovery key (not 64 hex chars)', () => {
    expect(() => buildCohortConfig(2, 'CASBeacon', 'mutinynet', 'abc123')).toThrow(/64 hex/);
    expect(() => buildCohortConfig(2, 'CASBeacon', 'mutinynet', 'zz'.repeat(32))).toThrow(/64 hex/);
  });

  it('rejects an off-curve x coordinate (would only fail deep in cohort keygen)', () => {
    // x = 0 is not on secp256k1, so BIP341 lift_x fails.
    expect(() => buildCohortConfig(2, 'CASBeacon', 'mutinynet', '00'.repeat(32))).toThrow(/x-only|off-curve/);
  });
});

// Coverage of the configurable k-of-n script-path fallback threshold (F1c, ADR 042).
// n-of-n MuSig2 stays the primary spend; fallbackThreshold only sizes the ADR 042
// fallback tapleaf committed into the beacon address (via beacon-address.ts). Omitted,
// the library derives n-1 floored at 1; provided, it must be a positive integer that
// does not exceed the participant count (a k > n fallback leaf can never be satisfied).
describe('buildCohortConfig fallback threshold', () => {
  it('sets fallbackThreshold on the config when a valid one is provided', () => {
    const config = buildCohortConfig(3, 'CASBeacon', 'mutinynet', undefined, 2);
    expect(config.fallbackThreshold).toBe(2);
    // The primary cohort shape is unchanged; the fallback is an additive leaf.
    expect(config.minParticipants).toBe(3);
    expect(config.beaconType).toBe('CASBeacon');
  });

  it('accepts a fallbackThreshold equal to the participant count', () => {
    const config = buildCohortConfig(3, 'CASBeacon', 'mutinynet', undefined, 3);
    expect(config.fallbackThreshold).toBe(3);
  });

  it('leaves fallbackThreshold unset when omitted (library derives n-1 floored at 1)', () => {
    const config = buildCohortConfig(3);
    expect(config.fallbackThreshold).toBeUndefined();
  });

  it('rejects a fallbackThreshold below 1', () => {
    expect(() => buildCohortConfig(3, 'CASBeacon', 'mutinynet', undefined, 0)).toThrow(/fallbackThreshold/);
  });

  it('rejects a fallbackThreshold above the participant count', () => {
    expect(() => buildCohortConfig(3, 'CASBeacon', 'mutinynet', undefined, 4)).toThrow(/fallbackThreshold/);
  });

  it('rejects a non-integer fallbackThreshold', () => {
    expect(() => buildCohortConfig(3, 'CASBeacon', 'mutinynet', undefined, 1.5)).toThrow(/fallbackThreshold/);
  });
});
