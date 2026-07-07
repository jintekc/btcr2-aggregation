import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { buildCohortConfig, deriveRecoveryKey } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { deriveCohortBeaconAddress } from './beacon-address.js';

function roster(n: number): Uint8Array[] {
  return Array.from({ length: n }, () => SchnorrKeyPair.generate().publicKey.compressed);
}

describe('deriveCohortBeaconAddress', () => {
  it('is deterministic and independent of the roster key ORDER (BIP-327 sorting)', () => {
    const config = buildCohortConfig(3);
    const keys = roster(3);
    const a = deriveCohortBeaconAddress(config, keys);
    const b = deriveCohortBeaconAddress(config, [...keys].reverse());
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('changes when the roster changes (the address commits to the exact key set)', () => {
    const config = buildCohortConfig(2);
    expect(deriveCohortBeaconAddress(config, roster(2))).not.toBe(
      deriveCohortBeaconAddress(config, roster(2)),
    );
  });

  it('changes when the recovery key changes (the address commits to the recovery leaf)', () => {
    const keys = roster(2);
    const a = deriveCohortBeaconAddress(buildCohortConfig(2, 'CASBeacon', undefined, deriveRecoveryKey()), keys);
    const b = deriveCohortBeaconAddress(buildCohortConfig(2, 'CASBeacon', undefined, deriveRecoveryKey()), keys);
    expect(a).not.toBe(b);
  });

  it('does NOT change with the beacon type (the hazard classifyCohortFit guards)', () => {
    // The address commits to keys + recovery params + network, never the beacon
    // type. A CAS-baked identity therefore CAN be seated in an SMT cohort of the
    // same roster at the same address - the reason cohort-fit classification is
    // type-aware (ADR 0012). Pinned so a future library change is noticed.
    const recoveryKey = deriveRecoveryKey();
    const keys = roster(2);
    expect(
      deriveCohortBeaconAddress(buildCohortConfig(2, 'CASBeacon', undefined, recoveryKey), keys),
    ).toBe(deriveCohortBeaconAddress(buildCohortConfig(2, 'SMTBeacon', undefined, recoveryKey), keys));
  });

  it('rejects a roster whose size differs from minParticipants (seated set would differ)', () => {
    expect(() => deriveCohortBeaconAddress(buildCohortConfig(3), roster(2))).toThrow(/minParticipants/);
  });

  it('rejects x-only (32-byte) keys with a pointer to the compressed form', () => {
    const config = buildCohortConfig(2);
    const xOnly = SchnorrKeyPair.generate().publicKey.compressed.slice(1, 33);
    expect(() => deriveCohortBeaconAddress(config, [xOnly, roster(1)[0]])).toThrow(/33-byte/);
  });

  it('does not mutate the caller memberPks array (documented as a pure derivation)', () => {
    const keys = roster(3);
    const snapshot = keys.map((k) => bytesToHex(k));
    deriveCohortBeaconAddress(buildCohortConfig(3), keys);
    expect(keys.map((k) => bytesToHex(k))).toEqual(snapshot);
  });

  it('matches a GOLDEN address for fixed secrets (fails loudly if the library derivation changes)', () => {
    // Pins the EXACT bech32m address for a fixed roster + recovery key, so a
    // future @did-btcr2/aggregation upgrade under the caret range that changes
    // beacon-address derivation fails HERE at upgrade time rather than silently
    // stranding every baked genesis + operator pre-funding (ADR 0012).
    const recoveryKey = bytesToHex(SchnorrKeyPair.fromSecret('33'.repeat(32)).publicKey.xOnly);
    const config = {
      beaconType: 'CASBeacon' as const,
      minParticipants: 2,
      network: 'mutinynet',
      recoveryKey,
      recoverySequence: 144,
    };
    const pks = [SchnorrKeyPair.fromSecret('11'.repeat(32)), SchnorrKeyPair.fromSecret('22'.repeat(32))].map(
      (k) => k.publicKey.compressed,
    );
    expect(deriveCohortBeaconAddress(config, pks)).toBe(
      'tb1pywjctefa2nmgqcku22rhkgq3hjp97c3prl77z88zse4hj5qvdgls0skwrs',
    );
  });
});
