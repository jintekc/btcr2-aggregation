import {
  AggregationParticipantRunner,
  HttpClientTransport,
  type CohortAdvert,
} from '@did-btcr2/aggregation/participant';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { buildSignedUpdate, type BeaconType, type Identity } from '@btcr2-aggregation/shared';

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
}

/** Coerce an advert's `beaconType` (typed `string`) to a known {@link BeaconType}. */
function normalizeBeaconType(beaconType: string): BeaconType {
  return beaconType === 'SMTBeacon' ? 'SMTBeacon' : 'CASBeacon';
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
}

/**
 * Create an aggregation participant wired to the service over the real HTTP
 * transport (`HttpClientTransport`: fetch for sends, SSE for inbound events). It
 * auto-joins every advertised cohort and contributes a signed did:btcr2 update
 * appending a beacon service whose type (CAS or SMT) matches the cohort it joined.
 * This module uses no Node-only APIs, so the same code drives the in-browser
 * participant in M2.
 */
export function createParticipant(opts: CreateParticipantOptions): Participant {
  const { did, keys } = opts.identity;
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

  const runner = new AggregationParticipantRunner({
    transport,
    did,
    keys,
    shouldJoin: async (advert: CohortAdvert) => {
      cohortBeaconTypes.set(advert.cohortId, normalizeBeaconType(advert.beaconType));
      return true;
    },
    onProvideUpdate: async ({ cohortId, beaconAddress }) =>
      buildSignedUpdate(did, keys, beaconAddress, cohortBeaconTypes.get(cohortId) ?? defaultBeaconType),
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
  };
}
