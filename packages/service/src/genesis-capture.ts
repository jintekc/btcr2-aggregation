import { canonicalHash, encode } from '@did-btcr2/common';
import { Identifier } from '@did-btcr2/method';
import { putGenesis, type ArtifactStore } from './store.js';

/**
 * Bounded staging cache for BAKED EXTERNAL genesis documents observed at
 * transport bootstrap-auth time, keyed by sender DID (ADR 0012).
 *
 * WHY STAGE AT ALL: an x1 genesis crosses the coordinator exactly once per DID
 * per process lifetime - on the bootstrap opt-in. After that the transport
 * resolves the sender from its peer registry and the genesis never travels
 * again, so the opt-in is the only capture point. But bootstrap-auth runs
 * BEFORE the envelope signature, nonce, and rate-limit gates: anything captured
 * there is attacker-influenceable (self-consistent geneses are free to mint),
 * so this cache is deliberately (a) bounded, (b) transient, and (c) NOT the
 * durable store. Durable persistence happens only on the runner's
 * `participant-accepted` event - membership is operator-gated and bounded by
 * cohort size, so acceptance is the trust boundary (`persistMemberGenesis`).
 *
 * Eviction is least-recently-remembered. The window that matters is
 * bootstrap-auth to acceptance of the SAME opt-in message (one request's
 * handling), so a flood would have to interleave `cap` distinct baked opt-ins
 * inside that window to evict a legitimate member's entry; the generous default
 * cap makes that immaterial, and a miss only degrades `GET /resolve/:did` to
 * the sidecar `POST` path (observable via the persist log).
 */
export class GenesisStagingCache {
  #entries = new Map<string, Record<string, unknown>>();
  readonly #cap: number;

  constructor(cap = 1024) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`GenesisStagingCache: cap must be a positive integer, got ${cap}`);
    }
    this.#cap = cap;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** Stage `genesis` for `did`, refreshing its recency; evicts the oldest past the cap. */
  remember(did: string, genesis: Record<string, unknown>): void {
    this.#entries.delete(did);
    this.#entries.set(did, genesis);
    while (this.#entries.size > this.#cap) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.#entries.delete(oldest);
    }
  }

  /** Remove and return the staged genesis for `did`, if any. */
  take(did: string): Record<string, unknown> | undefined {
    const genesis = this.#entries.get(did);
    if (genesis !== undefined) {
      this.#entries.delete(did);
    }
    return genesis;
  }
}

/** What {@link persistMemberGenesis} did with an accepted member's staged genesis. */
export type GenesisPersistOutcome = 'persisted' | 'not-external' | 'hash-mismatch';

/**
 * Durably persist an ACCEPTED cohort member's genesis document into the store's
 * `genesis` namespace, keyed by the hex genesis hash the member's x1 DID commits
 * to - the exact key the resolve driver's `NeedGenesisDocument` requests and
 * `GET /cas/genesis/:hash` serves. Once persisted, the member's DID resolves via
 * a plain sidecar-less `GET /resolve/:did` against this coordinator.
 *
 * The content is RE-VERIFIED here (canonical hash of the document must equal the
 * DID's committed genesis bytes) even though bootstrap-auth already checked it:
 * the staging cache sits between, and a content-addressed store should never
 * trust a key it did not recompute. A `'hash-mismatch'` therefore indicates
 * staging corruption or a bug, never normal operation; callers should log it
 * loudly. A KEY (k1) member returns `'not-external'` (nothing to persist).
 */
export async function persistMemberGenesis(
  store: ArtifactStore,
  did: string,
  genesis: Record<string, unknown>,
): Promise<GenesisPersistOutcome> {
  let genesisHash: string;
  try {
    const components = Identifier.decode(did);
    if (components.idType !== 'EXTERNAL') {
      return 'not-external';
    }
    genesisHash = encode(components.genesisBytes, 'hex');
  } catch {
    // An undecodable DID cannot commit to a genesis; treat like a non-external
    // sender (defensive: transport auth already rejected such senders upstream).
    return 'not-external';
  }
  if (canonicalHash(genesis, { encoding: 'hex' }) !== genesisHash) {
    return 'hash-mismatch';
  }
  await putGenesis(store, genesisHash, genesis);
  return 'persisted';
}
