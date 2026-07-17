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
  /**
   * Opt-in explicit-submit gate (PART-03, D-12). STRICTLY OPT-IN: when omitted,
   * this participant keeps today's auto-submit - `onProvideUpdate` builds the update
   * and returns it immediately - so every headless caller (the e2e peers, the
   * in-process FILLERS, the Phase 2 capstones) stays byte-for-byte unchanged.
   *
   * When supplied, `onProvideUpdate` builds the signed update EXACTLY ONCE, hands it
   * to this gate as a {@link SubmitGateInfo}, awaits the returned promise, and only
   * then records and submits that exact body. The browser store (03-04) resolves the
   * promise when the user clicks "Submit my DID update", turning the auto-submit into
   * a user-consented submit with no library change and no rebuild of the body.
   *
   * One consent covers the whole round: this single submit approval also authorizes
   * the n-of-n beacon co-signature (D-14); there is deliberately no second
   * signing-approval gate.
   *
   * This callback MUST NOT reject or throw. A throw inside `onProvideUpdate` sends
   * neither a submit nor a decline and stalls the whole n-of-n cohort (Finding 1). A
   * participant that never resolves the gate stalls only until the service's
   * `phaseTimeoutMs` expires the cohort for everyone; there is no per-member forfeit.
   * The caller (the store) owns teardown: on stop it drops the deferred without
   * settling it rather than rejecting here.
   */
  onSubmitGate?: (info: SubmitGateInfo) => Promise<void>;
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

/**
 * The payload handed to an opt-in {@link CreateParticipantOptions.onSubmitGate}
 * when this participant is asked to provide its cohort update (PART-03, D-12). It
 * carries the update body that has ALREADY been built and signed - built exactly
 * once - so a UI can preview the precise body that will be submitted: the previewed
 * body IS the submitted body. BIP340 signing injects fresh randomness per call, so
 * rebuilding would change the canonical hash and break the resolve round-trip check
 * (D-29); the gate therefore never triggers a rebuild, it only defers the submit of
 * this one captured body until the user consents.
 */
export interface SubmitGateInfo {
  /** The cohort this update is being provided for. */
  cohortId: string;
  /** The cohort's aggregate beacon address (the value after the `bitcoin:` scheme). */
  beaconAddress: string;
  /** The cohort's beacon type (CAS or SMT). */
  beaconType: BeaconType;
  /** The already-built, already-signed update body that will be submitted as-is. */
  update: SubmittedUpdate;
}

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
 * Everything {@link createUpdateProvider} needs to answer the runner's
 * `onProvideUpdate` call: the identity it signs with, the per-cohort beacon-type and
 * capture maps, and the optional explicit-submit gate. The maps are the SAME
 * instances `createParticipant` exposes through `getSubmittedUpdate` /
 * `getDeclineReason`, so recording into them here is what those accessors read.
 */
export interface UpdateProviderContext {
  /** The participant's DID. */
  did: string;
  /** The participant's Schnorr keypair (the signer for the update). */
  keys: Identity['keys'];
  /** Present only for an EXTERNAL (x1) identity; drives the fit classification. */
  genesisDocument?: Record<string, unknown>;
  /** Fallback beacon type when a cohort's advertised type was not recorded. */
  defaultBeaconType: BeaconType;
  /** Per-cohort beacon type recorded at join time from the advert. */
  cohortBeaconTypes: Map<string, BeaconType>;
  /** Sink for the exact submitted body, keyed by cohort (build-once capture). */
  submittedUpdates: Map<string, SubmittedUpdate>;
  /** Sink for the decline reason, keyed by cohort (cooperative non-inclusion). */
  declinedCohorts: Map<string, string>;
  /** Opt-in explicit-submit gate; absent = auto-submit (see CreateParticipantOptions). */
  onSubmitGate?: (info: SubmitGateInfo) => Promise<void>;
}

/**
 * Build the participant runner's `onProvideUpdate` handler. Extracted and exported
 * so its decline / build-once / gate contract can be unit-tested WITHOUT a runner,
 * transport, or network (the seam PART-03's specs exercise). Behavior is identical to
 * calling the body inline: the mismatch decline path runs FIRST (before the gate is
 * ever offered, D-15/D-19 backstop), the signed update is built EXACTLY ONCE, and an
 * opt-in gate - when present - is awaited before the body is recorded and returned.
 *
 * The handler NEVER throws or returns a rejected promise on the gate path: a throw
 * inside `onProvideUpdate` sends neither a submit nor a decline and stalls the whole
 * n-of-n cohort (Finding 1 / Pitfall 2). The only non-submit outcome is the explicit
 * `null` decline for a baked-mismatch identity, which the runner treats as
 * cooperative non-inclusion (the member still co-signs).
 */
export function createUpdateProvider(
  ctx: UpdateProviderContext,
): (args: { cohortId: string; beaconAddress: string }) => Promise<SubmittedUpdate | null> {
  const {
    did,
    keys,
    genesisDocument,
    defaultBeaconType,
    cohortBeaconTypes,
    submittedUpdates,
    declinedCohorts,
    onSubmitGate,
  } = ctx;
  return async ({ cohortId, beaconAddress }) => {
    const beaconType = cohortBeaconTypes.get(cohortId) ?? defaultBeaconType;
    // A BAKED identity seated in a cohort that does not match its baked aggregate
    // beacon (wrong address, or the other beacon type at the same address) must NOT
    // submit: the update would strand the DID unresolvable. It must not throw either
    // - the runner catches an onProvideUpdate throw and sends neither a submit nor a
    // decline, which stalls the entire n-of-n cohort for everyone. Returning null is
    // the protocol's cooperative non-inclusion: this member still co-signs, the
    // cohort completes, and only its own update is absent. This decline runs BEFORE
    // any onSubmitGate is offered, so a baked mismatch never reaches a submit window.
    if (classifyCohortFit(genesisDocument, beaconAddress, beaconType) === 'mismatch') {
      const reason =
        `baked aggregate beacon does not match cohort ${cohortId} ` +
        `(${beaconType} at bitcoin:${beaconAddress}); declining (cooperative non-inclusion)`;
      declinedCohorts.set(cohortId, reason);
      console.warn(`[participant ${did}] ${reason}`);
      return null;
    }
    // Build the update EXACTLY ONCE. BIP340 signing is non-deterministic, so this
    // body can never be rebuilt to the same canonical hash later; the preview handed
    // to the gate below and the body recorded and returned here are the SAME object
    // (identity-equal), which is what keeps the D-29 resolve round-trip check valid.
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
    // Opt-in explicit-submit gate (D-12), STRICTLY OPT-IN. Only when a gate is
    // supplied do we defer: await the user's decision on this already-built body
    // BEFORE recording and submitting it. Absent a gate this is byte-identical to the
    // historical auto-submit (no await, immediate set-and-return). Never reject here.
    if (onSubmitGate) {
      await onSubmitGate({ cohortId, beaconAddress, beaconType, update });
    }
    submittedUpdates.set(cohortId, update);
    return update;
  };
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

  // The update-provision handler: decline-first, build-once, opt-in-gate-then-submit.
  // Extracted so its contract is unit-testable (createUpdateProvider), but the maps it
  // writes are the very ones getSubmittedUpdate / getDeclineReason read below.
  const provideUpdate = createUpdateProvider({
    did,
    keys,
    genesisDocument,
    defaultBeaconType,
    cohortBeaconTypes,
    submittedUpdates,
    declinedCohorts,
    onSubmitGate: opts.onSubmitGate,
  });

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
    // Delegate to the extracted handler. Kept as an inline arrow so the runner's own
    // callback types still flow to `cohortId` / `beaconAddress`; the body is
    // decline-first, build-once, opt-in-gate-then-submit (see createUpdateProvider).
    onProvideUpdate: async ({ cohortId, beaconAddress }) =>
      provideUpdate({ cohortId, beaconAddress }),
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
