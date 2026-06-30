import {
  AggregationParticipantRunner,
  HttpClientTransport,
} from '@did-btcr2/aggregation/participant';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { buildSignedUpdate, type Identity } from '@btcr2-aggregation/shared';

export interface CreateParticipantOptions {
  /** Participant identity (the attendee). */
  identity: Identity;
  /** Base URL of the aggregation service, e.g. `http://127.0.0.1:8080`. */
  baseUrl: string;
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
 * appending a CAS beacon service. This module uses no Node-only APIs, so the same
 * code drives the in-browser participant in M2.
 */
export function createParticipant(opts: CreateParticipantOptions): Participant {
  const { did, keys } = opts.identity;

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

  const runner = new AggregationParticipantRunner({
    transport,
    did,
    keys,
    shouldJoin: async () => true,
    onProvideUpdate: async ({ beaconAddress }) => buildSignedUpdate(did, keys, beaconAddress),
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
