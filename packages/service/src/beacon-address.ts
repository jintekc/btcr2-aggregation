import { AggregationCohort } from '@did-btcr2/aggregation/core';
import type { CohortConfig } from '@did-btcr2/aggregation/service';
import { decode } from '@did-btcr2/common';

/**
 * Derive a cohort's aggregate Taproot beacon address from its config and a FIXED
 * roster of member public keys, BEFORE the cohort exists (ADR 0012).
 *
 * MuSig2 key aggregation is non-interactive and the library's address computation
 * is a pure function of the sorted member keys (BIP-327), the recovery parameters
 * (`recoveryKey`, `recoverySequence`, `fundingModel`, `fallbackThreshold`) and the
 * network - participant DIDs and cohort/service ids are NOT inputs. So an operator
 * who fixes the roster can compute the address first, bake it into each member's
 * EXTERNAL genesis (`buildBakedExternalGenesis`), mint the x1 DIDs from those
 * geneses, and only then advertise the cohort.
 *
 * Parity is exact by construction: this constructs an {@link AggregationCohort}
 * with the same fields the library service itself builds from a {@link CohortConfig}
 * at advertise time (including the hex-to-bytes recovery key conversion), then runs
 * the library's own `computeBeaconAddress()`. The derived address only holds if the
 * advertised cohort seats EXACTLY this roster - pin `maxParticipants` and the
 * `rosterPks` opt-in gate (see `createService`) so an interloper cannot take a seat
 * and silently invalidate it.
 *
 * @throws when the roster size does not equal `config.minParticipants` (the
 * library finalizes keygen at `minParticipants`, so the seated key set - and the
 * address - would differ), or when a key is not a 33-byte compressed pubkey.
 */
export function deriveCohortBeaconAddress(config: CohortConfig, memberPks: Uint8Array[]): string {
  if (memberPks.length !== config.minParticipants) {
    throw new Error(
      `deriveCohortBeaconAddress: roster has ${memberPks.length} keys but the cohort finalizes ` +
        `at minParticipants=${config.minParticipants}; the seated key set would differ from the ` +
        'roster, so the derived address would not match the cohort',
    );
  }
  for (const pk of memberPks) {
    if (pk.length !== 33) {
      throw new Error(
        `deriveCohortBeaconAddress: expected 33-byte compressed public keys, got ${pk.length} bytes ` +
          '(pass keys.publicKey.compressed, not the x-only form)',
      );
    }
  }
  const cohort = new AggregationCohort({
    minParticipants: config.minParticipants,
    network: config.network,
    beaconType: config.beaconType,
    // Mirror the library service's own construction from a CohortConfig
    // (service.js advertise path), including the hex recovery-key decode.
    recoveryKey: decode(config.recoveryKey, 'hex'),
    recoverySequence: config.recoverySequence,
    fundingModel: config.fundingModel,
    fallbackThreshold: config.fallbackThreshold,
  });
  // Copy: the library's cohortKeys setter sorts the array IN PLACE (BIP-327), so
  // passing memberPks directly would reorder the caller's array and silently
  // mis-pair any index-aligned parallel arrays (secrets, labels, identities).
  cohort.cohortKeys = [...memberPks];
  return cohort.computeBeaconAddress();
}
