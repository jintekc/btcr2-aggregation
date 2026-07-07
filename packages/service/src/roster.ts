import { bytesToHex } from '@noble/hashes/utils';
import type { PendingOptIn } from '@did-btcr2/aggregation/service';

/** Constant-shape byte equality for compressed pubkeys (roster membership checks). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** The outcome of the fixed-roster opt-in decision, with a reason on rejection. */
export type RosterDecision = { accepted: true } | { accepted: false; reason: string };

/**
 * Decide a fixed-roster (baked) cohort opt-in (ADR 0012). A baked cohort's
 * aggregate beacon address is derived from - and commits to - an EXACT set of
 * member public keys, so the seated key set must be exactly that roster or every
 * baked genesis (and any operator pre-funding) is stranded. This decision gates
 * on three things, in order:
 *
 * 1. **Binding.** `participantPk` (the key that will be aggregated into the MuSig2
 *    beacon) must equal `communicationPk` (the key the transport
 *    bootstrap-authenticates against the sender's self-verifying genesis). A baked
 *    roster's public keys are, by design, published in resolvable geneses (served
 *    over `GET /cas/genesis/:hash` and `GET /resolve/:did`), so a third party can
 *    learn them; without this binding they could present a roster member's
 *    `participantPk` under their OWN DID (own `communicationPk`), seat a key nobody
 *    in the cohort can sign for, and stall MuSig2 signing forever (a DoS). Honest
 *    participants set `participantPk === communicationPk === their own key`, so the
 *    binding never rejects a legitimate member.
 * 2. **Membership.** `participantPk` must be one of the roster keys.
 * 3. **Uniqueness.** The key must not already be seated this cohort. Duplicate keys
 *    drift the aggregate off the pre-derived address (the library sorts but does
 *    not de-duplicate cohort keys before aggregation), so a member opting in twice
 *    would invalidate the baked address.
 *
 * `seenPks` is the set of hex participant keys already accepted for this cohort;
 * the caller records an accepted key into it.
 */
export function decideRosterOptIn(
  rosterPks: Uint8Array[],
  optIn: Pick<PendingOptIn, 'participantPk' | 'communicationPk'>,
  seenPks: ReadonlySet<string>,
): RosterDecision {
  if (!bytesEqual(optIn.participantPk, optIn.communicationPk)) {
    return {
      accepted: false,
      reason: 'participantPk is not bound to the authenticated communicationPk',
    };
  }
  if (!rosterPks.some((pk) => bytesEqual(pk, optIn.participantPk))) {
    return { accepted: false, reason: 'participantPk is not in the fixed roster' };
  }
  if (seenPks.has(bytesToHex(optIn.participantPk))) {
    return { accepted: false, reason: 'roster key already seated this cohort (duplicate)' };
  }
  return { accepted: true };
}
