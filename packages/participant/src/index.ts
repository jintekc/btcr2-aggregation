import {
  AggregationParticipantRunner,
  HttpClientTransport,
  type CohortAdvert,
} from '@did-btcr2/aggregation/participant';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import {
  buildSignedUpdate,
  classifyCohortFit,
  type BeaconType,
  type Identity,
} from '@btcr2-aggregation/shared';

export interface CreateParticipantOptions {
  /** Participant identity (the attendee). */
  identity: Identity;
  /** Base URL of the aggregation service, e.g. `http://127.0.0.1:8080`. */
  baseUrl: string;
  /**
   * Fallback beacon type for the appended service when a cohort's advertised
   * type is somehow unavailable. The advertised type is the source of truth (the
   * cohort builds that artifact on-chain), so this only matters defensively.
   * Defaults to CAS.
   */
  beaconType?: BeaconType;
  /**
   * The browse-and-pick picked cohort (PART-02, D-14): when set, this participant
   * joins ONLY the advert whose `cohortId` matches this value and ignores every
   * other advert on the public transport. This is the single browse-and-pick
   * mechanism - the participant chose one cohort from the directory, so it opts
   * into that cohort alone rather than whatever advert happens to arrive.
   *
   * Omitting it keeps the legacy accept-all behavior (join every advertised
   * cohort). Phase 2 does NOT rely on that path: a browsing participant always
   * carries the picked cohortId, and accept-all only survives as the pre-Phase-2
   * default for callers (the in-process demo drivers) that never picked.
   */
  cohortId?: string;
}

/**
 * Pure browse-and-pick predicate (PART-02, D-14): does an advertised cohort match
 * the one this participant picked? Returns `true` when no cohort was picked
 * (`pickedCohortId` undefined = legacy accept-all) OR the picked id is exactly the
 * advert's id; `false` otherwise. Selectivity is enforced entirely client-side,
 * before any opt-in is sent, so a non-matching advert never reaches the service.
 */
export function matchesPickedCohort(
  pickedCohortId: string | undefined,
  advertCohortId: string,
): boolean {
  return pickedCohortId === undefined || pickedCohortId === advertCohortId;
}

/** Coerce an advert's `beaconType` (typed `string`) to a known {@link BeaconType}. */
function normalizeBeaconType(beaconType: string): BeaconType {
  return beaconType === 'SMTBeacon' ? 'SMTBeacon' : 'CASBeacon';
}

/** A signed did:btcr2 update body (the object `buildSignedUpdate` produces). */
export type SubmittedUpdate = ReturnType<typeof buildSignedUpdate>;

export interface Participant {
  /** The participant runner. Attach event listeners to it. */
  readonly runner: AggregationParticipantRunner;
  /** The underlying fetch + SSE client transport. */
  readonly transport: HttpClientTransport;
  /** Open SSE subscriptions and begin listening for cohorts. */
  start(): Promise<void>;
  /** Tear down subscriptions and reconnect loops. */
  stop(): void;
  /**
   * The exact signed update body this participant submitted for `cohortId`, or
   * `undefined` if it has not (yet) submitted one. BIP340 signing injects fresh
   * randomness per call, so the body cannot be rebuilt to the same canonical hash
   * later; it is captured here at submit time. This is the artifact a resolver
   * needs (`NeedSignedUpdate`) and the body of the controller's downloadable
   * sovereign sidecar. The runner exposes only the update's hash (via
   * `cohort-complete`), not the body, hence this accessor.
   */
  getSubmittedUpdate(cohortId: string): SubmittedUpdate | undefined;
  /**
   * Why this participant DECLINED to submit an update for `cohortId` (cooperative
   * non-inclusion), or `undefined` if it did not decline. Today the only decline
   * cause is a BAKED identity seated in a cohort that does not match its baked
   * aggregate beacon (`classifyCohortFit` = `'mismatch'`, ADR 0012): submitting
   * would leave the DID unresolvable, and THROWING inside onProvideUpdate would
   * send neither a submit nor a decline and stall the whole n-of-n cohort - so the
   * participant declines, still co-signs, and the rest of the cohort is unharmed.
   */
  getDeclineReason(cohortId: string): string | undefined;
}

/**
 * Create an aggregation participant wired to the service over the real HTTP
 * transport (`HttpClientTransport`: fetch for sends, SSE for inbound events). It
 * auto-joins every advertised cohort and contributes a signed did:btcr2 update
 * appending a beacon service whose type (CAS or SMT) matches the cohort it joined.
 * This module uses no Node-only APIs, so the same code drives the in-browser
 * participant in M2.
 *
 * Works for both onboarding models transparently: a KEY (`k1`) identity authenticates
 * from its DID string, while an EXTERNAL (`x1`) identity carries its self-verifying
 * `genesisDocument` (read from {@link CreateParticipantOptions.identity}) on the opt-in
 * so the service can bootstrap-authenticate it (ADR 066). The caller picks the model by
 * constructing the identity; nothing here branches on it.
 */
export function createParticipant(opts: CreateParticipantOptions): Participant {
  const { did, keys, genesisDocument } = opts.identity;
  const defaultBeaconType: BeaconType = opts.beaconType ?? 'CASBeacon';

  const transport = new HttpClientTransport({
    baseUrl: opts.baseUrl,
    resolveSenderPk: resolveBtcr2SenderPk,
    // The transport calls its stored fetch as a bare function. The browser's
    // `window.fetch` throws "Illegal invocation" when its `this` is not the
    // Window, so bind it. Node's fetch is unbound, so this is a no-op there and
    // keeps `createParticipant` isomorphic.
    fetchImpl: globalThis.fetch.bind(globalThis),
  });
  transport.registerActor(did, keys);

  // `onProvideUpdate` is handed only `{ cohortId, beaconAddress }`, not the beacon
  // type, but `shouldJoin` sees the full advert (which carries beaconType). Record
  // each joined cohort's type so the appended service matches the artifact the
  // cohort actually builds on-chain.
  const cohortBeaconTypes = new Map<string, BeaconType>();

  // The signed update body this participant returned into the runner, per cohort.
  // Captured at submit time because the runner never re-emits it and BIP340 signing
  // is non-deterministic (a later rebuild would hash differently).
  const submittedUpdates = new Map<string, SubmittedUpdate>();

  // Cohorts this participant declined to submit an update for, with the reason.
  const declinedCohorts = new Map<string, string>();

  const runner = new AggregationParticipantRunner({
    transport,
    did,
    keys,
    // Present only for an EXTERNAL (x1) identity. The runner threads it onto the
    // opt-in so the service can bootstrap-authenticate this not-yet-registered
    // sender from its self-verifying genesis (ADR 066). Omitted (undefined) for a
    // KEY (k1) identity, whose key the service derives from the DID string, so the
    // k1 opt-in is byte-identical to before.
    genesisDocument,
    shouldJoin: async (advert: CohortAdvert) => {
      // Browse-and-pick (PART-02, D-14): the picked filter is the single
      // browse-and-pick mechanism. When the participant chose a cohort, ignore
      // every advert except that one - selectivity is enforced here, client-side,
      // before the opt-in, so a non-matching advert sends nothing to the service.
      if (!matchesPickedCohort(opts.cohortId, advert.cohortId)) {
        return false;
      }
      cohortBeaconTypes.set(advert.cohortId, normalizeBeaconType(advert.beaconType));
      return true;
    },
    onProvideUpdate: async ({ cohortId, beaconAddress }) => {
      const beaconType = cohortBeaconTypes.get(cohortId) ?? defaultBeaconType;
      // A BAKED identity seated in a cohort that does not match its baked aggregate
      // beacon (wrong address, or the other beacon type at the same address) must
      // NOT submit: the update would strand the DID unresolvable. It must not throw
      // either - the runner catches an onProvideUpdate throw and sends neither a
      // submit nor a decline, which stalls the entire n-of-n cohort for everyone.
      // Returning null is the protocol's cooperative non-inclusion: this member
      // still co-signs, the cohort completes, and only its own update is absent.
      if (classifyCohortFit(genesisDocument, beaconAddress, beaconType) === 'mismatch') {
        const reason =
          `baked aggregate beacon does not match cohort ${cohortId} ` +
          `(${beaconType} at bitcoin:${beaconAddress}); declining (cooperative non-inclusion)`;
        declinedCohorts.set(cohortId, reason);
        console.warn(`[participant ${did}] ${reason}`);
        return null;
      }
      const update = buildSignedUpdate(
        did,
        keys,
        beaconAddress,
        beaconType,
        // For x1, the current document is resolved from this genesis before the
        // beacon-service patch is applied; for k1 it is undefined (deterministic
        // resolution from the key), leaving the k1 update path unchanged.
        genesisDocument,
      );
      submittedUpdates.set(cohortId, update);
      return update;
    },
  });

  return {
    runner,
    transport,
    // The runner's start() only registers message handlers; the client transport's
    // SSE subscriptions (broadcast adverts + this actor's inbox) are opened by
    // transport.start(). Register handlers first so no inbound event is missed.
    start: async () => {
      await runner.start();
      transport.start();
    },
    stop: () => {
      runner.stop();
      transport.stop();
    },
    getSubmittedUpdate: (cohortId: string) => submittedUpdates.get(cohortId),
    getDeclineReason: (cohortId: string) => declinedCohorts.get(cohortId),
  };
}
