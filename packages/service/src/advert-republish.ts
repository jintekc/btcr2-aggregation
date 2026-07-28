/**
 * Transport ADVERT-SLOT repair (SVC-04, RESEARCH Pattern 3 / Pitfall 3): re-install the
 * cohort advert that a settling cohort's teardown just cleared, so canceling or completing
 * one cohort never quietly makes its still-open siblings unjoinable.
 *
 * Three verified `HttpServerTransport@0.4.0` facts compose into the defect this repairs:
 *
 * 1. There is exactly ONE advert slot (`#currentAdvert`), overwritten by every
 *    `publishRepeating` call. It is not a set of live adverts, it is a single cell.
 * 2. A NEW SSE broadcast subscriber is replayed only that one slot. A participant that
 *    connects later learns about exactly the cohort sitting in the cell, and nothing else.
 * 3. The stop closure `publishRepeating` returns CLEARS the cell when the stopping cohort
 *    still owns it, and the runner runs that closure from `#disposeCohort` (so on stop, on
 *    completion, and on failure) as well as at `keygen-complete`.
 *
 * So with cohorts A and B both open and B advertised most recently, ending B empties the
 * cell: A is still listed in the public directory (which derives from
 * `runner.session.cohorts`, not from the advert cell) yet a freshly connecting browser
 * receives no `COHORT_ADVERT` at all, never opts in, and sits at "connecting" with nothing
 * having visibly failed. The latent defect predates this phase, but the operator Cancel
 * action turns it from a rare race into a button, so the repair ships with it.
 *
 * `session.advertise` cannot be re-called to fix this: it throws `INVALID_PHASE` once a
 * cohort has left the `Created` phase. What CAN be done, entirely app-side and without
 * forking the library, is to rebuild exactly the message `AggregationService.advertise`
 * builds and hand it back to the transport. That is all this module does.
 *
 * Everything here is fire-and-forget: an advert repair failure is logged and swallowed,
 * never thrown into a settle path, matching the discipline of every other side effect in
 * this service.
 */

import { createCohortAdvertMessage } from '@did-btcr2/aggregation/core';
import type { CohortConfig, HttpServerTransport } from '@did-btcr2/aggregation/service';
import type { SchnorrKeyPair } from '@did-btcr2/keypair';

/** Construction inputs for {@link createAdvertRepublisher}. */
export interface AdvertRepublisherDeps {
  /** The service's transport: the owner of the single advert slot being repaired. */
  transport: HttpServerTransport;
  /** The coordinator DID (the advert's `from` and the registered signing actor). */
  did: string;
  /** The coordinator keys, whose compressed public key rides the advert as `communicationPk`. */
  keys: SchnorrKeyPair;
}

/** The advert-slot repair surface. */
export interface AdvertRepublisher {
  /**
   * Re-install the transport's advert slot with THIS cohort's advert, and write it to every
   * currently connected broadcast subscriber. Safe to call for any still-open cohort.
   */
  republish(cohortId: string, config: CohortConfig): void;
  /**
   * Clear the advert slot IF it still holds an advert this republisher installed. Used when a
   * settle leaves no open cohort at all: without it, the advert this module last installed
   * would linger for its whole TTL, because the runner's own stop closure only recognizes the
   * advert IT published (ids differ), and a late subscriber would be handed an advert for a
   * cohort that no longer exists. A no-op when the slot has since moved on.
   */
  clear(): void;
}

/**
 * Build the per-service advert republisher. Closure-scoped like every other per-service
 * factory here, and it remembers only the stop closure of the advert IT last installed, so
 * {@link AdvertRepublisher.clear} can never clear an advert the runner owns.
 */
export function createAdvertRepublisher(deps: AdvertRepublisherDeps): AdvertRepublisher {
  const { transport, did, keys } = deps;
  /** The stop closure for the advert this module last installed (undefined = we hold none). */
  let stopCurrent: (() => void) | undefined;

  return {
    republish(cohortId: string, config: CohortConfig): void {
      try {
        // Retire our own previous advert first. The closure is id-scoped, so this clears the
        // slot only if it still holds OUR last advert, never the runner's.
        stopCurrent?.();
        stopCurrent = undefined;
        // Reconstruct exactly what `AggregationService.advertise` builds: the network is a
        // separate cohort parameter and everything else on the config is an advertised
        // condition (ADR 039). Never hand-roll the body, and never sign the envelope here -
        // `publishRepeating` signs it and installs the slot with a fresh expiry derived from
        // the transport's own configured advertTtlMs, atomically.
        const { network, ...conditions } = config;
        const message = createCohortAdvertMessage({
          from: did,
          cohortId,
          network,
          communicationPk: keys.publicKey.compressed,
          ...conditions,
        });
        // `HttpServerTransport` IGNORES the interval argument (a documented upstream limit
        // surfaced by the Phase 4 live UAT: it publishes once and keeps the advert in its
        // replay window rather than repeating on a timer), so 0 is the honest value to pass.
        stopCurrent = transport.publishRepeating(message, did, 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[advert] failed to re-publish the advert for cohort ${cohortId}: ${message}`);
      }
    },

    clear(): void {
      try {
        stopCurrent?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[advert] failed to clear the advert slot: ${message}`);
      }
      stopCurrent = undefined;
    },
  };
}
