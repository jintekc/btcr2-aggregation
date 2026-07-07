import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, it } from 'vitest';
import { decideRosterOptIn } from './roster.js';

/** A pending opt-in shaped like an honest member: participantPk === communicationPk. */
function honestOptIn(key: Uint8Array) {
  return { participantPk: key, communicationPk: key };
}

describe('decideRosterOptIn', () => {
  const member = SchnorrKeyPair.generate().publicKey.compressed;
  const other = SchnorrKeyPair.generate().publicKey.compressed;
  const roster = [member, SchnorrKeyPair.generate().publicKey.compressed];

  it('accepts an honest roster member (bound key, in roster, not yet seated)', () => {
    expect(decideRosterOptIn(roster, honestOptIn(member), new Set())).toEqual({ accepted: true });
  });

  it('rejects a non-roster key', () => {
    const decision = decideRosterOptIn(roster, honestOptIn(other), new Set());
    expect(decision.accepted).toBe(false);
  });

  it('rejects a FORGED opt-in presenting a roster key under a different communication key', () => {
    // The forge the roster gate must stop: an attacker who learned a roster key
    // (public in resolvable geneses) presents it as participantPk while the
    // transport authenticated a DIFFERENT communicationPk (their own). Seating an
    // unsignable key would stall MuSig2 signing (DoS). The binding rejects it.
    const decision = decideRosterOptIn(roster, { participantPk: member, communicationPk: other }, new Set());
    expect(decision).toEqual({ accepted: false, reason: expect.stringMatching(/bound/) });
  });

  it('rejects a duplicate seating of an already-seated roster key (address drift)', () => {
    const seen = new Set([bytesToHex(member)]);
    const decision = decideRosterOptIn(roster, honestOptIn(member), seen);
    expect(decision).toEqual({ accepted: false, reason: expect.stringMatching(/duplicate/) });
  });
});
