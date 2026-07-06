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
