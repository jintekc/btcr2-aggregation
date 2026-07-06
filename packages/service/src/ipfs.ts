import { join } from 'node:path';
import { bitswap } from '@helia/block-brokers';
import { Helia } from '@helia/utils';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { webSockets } from '@libp2p/websockets';
import * as wsFilters from '@libp2p/websockets/filters';
import { multiaddr } from '@multiformats/multiaddr';
import { MemoryBlockstore } from 'blockstore-core';
import { FsBlockstore } from 'blockstore-fs';
import { MemoryDatastore } from 'datastore-core';
import { FsDatastore } from 'datastore-fs';
import { createLibp2p } from 'libp2p';
import type { Libp2p } from '@libp2p/interface';
import {
  artifactHashHex,
  canonicalArtifactBytes,
  cidFromHashHex,
  normalizeDigestHex,
} from '@btcr2-aggregation/shared';
import type { ArtifactStore } from './store.js';

/**
 * Opt-in IPFS (Helia) pinning node for the aggregation coordinator (ADR 0011).
 *
 * Composed from `@helia/utils` + `@helia/block-brokers` + a hand-configured
 * libp2p, NOT the `helia` meta-package: the meta-package's default libp2p eagerly
 * imports `@libp2p/webrtc -> node-datachannel`, a native addon this repo's
 * dependency-build policy refuses to compile, so importing it on Node crashes.
 * The composed node is pure JS end to end and deliberately minimal: a localhost
 * websocket listener, noise + yamux, bitswap, and NO public-network machinery
 * (no DHT, no bootstrap peers, no relay, no delegated routing). Peers reach it
 * only by explicitly dialing the multiaddrs served on `GET /v1/ipfs` - exactly
 * what the in-browser publisher does.
 *
 * Every block is a did:btcr2 artifact stored VERBATIM as its canonical JCS bytes
 * under `CIDv1(raw, sha2-256(digest))`, so the CID's digest is byte-identical to
 * the artifact's on-chain/store hex key (docs/M3b2-ipfs-cid-spike.md).
 */

/** Upper bound on hashes per `POST /v1/ipfs/pin` request (a publish plan is <= 3). */
export const MAX_PIN_REQUEST = 8;

/** Default bound on one pin's bitswap fetch (unreachable holder => fail, not hang). */
export const DEFAULT_PIN_TIMEOUT_MS = 15_000;

export interface IpfsNodeOptions {
  /**
   * Directory for durable block/pin storage (`<dir>/blocks`, `<dir>/data`).
   * Omit for in-memory stores: pins then live only for the process lifetime,
   * which is exactly right for the hermetic gate and throwaway demos.
   */
  dir?: string;
  /** Listen host for the websocket transport (default 127.0.0.1: localhost-only). */
  listenHost?: string;
  /** Listen port (default 0: ephemeral). */
  listenPort?: number;
  /**
   * Extra multiaddrs to announce to peers instead of the listen address, e.g.
   * `/dns4/example.org/tcp/443/wss` behind a TLS-terminating proxy. Required for
   * browsers on other machines: a page served over https may only dial wss.
   */
  announce?: string[];
  /** Per-pin bitswap fetch bound, ms (default {@link DEFAULT_PIN_TIMEOUT_MS}). */
  pinTimeoutMs?: number;
}

/** Where a pinned block's bytes came from. */
export type PinSource = 'already-pinned' | 'store' | 'local' | 'network';

/** Outcome of one `pin()` attempt. */
export interface PinOutcome {
  /** The (normalized) hex digest that was requested. */
  hash: string;
  /** The canonical CID for that digest. */
  cid: string;
  pinned: boolean;
  /**
   * 'store' = bytes came from this coordinator's own artifact store (digest
   * re-verified before storing); 'network' = fetched over bitswap from a
   * connected peer (the publishing browser); 'local' = the block was already in
   * the blockstore, only the pin was added; 'already-pinned' = fully idempotent.
   */
  source?: PinSource;
  error?: string;
}

export interface IpfsNode {
  /** This node's peer id (part of the dialable multiaddr). */
  readonly peerId: string;
  /** The underlying Helia node, for advanced use (tests, GC, direct block access). */
  readonly helia: Helia<Libp2p>;
  /** Dialable multiaddrs (announce addresses when configured, else listen addresses). */
  multiaddrs(): string[];
  /**
   * Store + pin one artifact locally under its canonical CID. The digest is
   * recomputed from the artifact and must match `hashHex` when supplied - bytes
   * that do not hash to their CID are refused rather than poisoning the store.
   * Returns the CID string. Idempotent.
   */
  publish(artifact: object, hashHex?: string): Promise<string>;
  /**
   * Ensure `hashHex`'s block is present and pinned, preferring local sources:
   * already pinned -> this coordinator's artifact store (re-verified) -> a block
   * already in the blockstore -> a bounded bitswap fetch from connected peers.
   * Never throws for a per-hash failure; the outcome carries the error.
   */
  pin(hashHex: string, store?: ArtifactStore): Promise<PinOutcome>;
  /** True when the block for `hashHex` is in the local blockstore. */
  hasBlock(hashHex: string): Promise<boolean>;
  /** Fetch a block by digest (local or bitswap), bounded by `timeoutMs` (default pin timeout). */
  getBlock(hashHex: string, opts?: { timeoutMs?: number }): Promise<Uint8Array>;
  /** Explicitly dial a peer multiaddr (how a test/e2e node reaches this one). */
  dial(addr: string): Promise<void>;
  stop(): Promise<void>;
}

/** The artifact-store namespaces whose keys are the artifact's own digest. */
const DIGEST_KEYED_KINDS = ['update', 'announcement', 'genesis'] as const;

/**
 * Create the composed Helia node. The caller owns the lifecycle (`stop()`); the
 * service only routes requests to it, mirroring the injected `bitcoin` connection.
 */
export async function createIpfsNode(opts: IpfsNodeOptions = {}): Promise<IpfsNode> {
  const pinTimeoutMs = opts.pinTimeoutMs ?? DEFAULT_PIN_TIMEOUT_MS;

  const blockstore = opts.dir ? new FsBlockstore(join(opts.dir, 'blocks')) : new MemoryBlockstore();
  const datastore = opts.dir ? new FsDatastore(join(opts.dir, 'data')) : new MemoryDatastore();
  // The fs stores must be opened before first use (they create their directories
  // on open); open() is a no-op for the memory stores' base class.
  if (blockstore instanceof FsBlockstore) {
    await blockstore.open();
  }
  if (datastore instanceof FsDatastore) {
    await datastore.open();
  }

  const libp2p = await createLibp2p({
    addresses: {
      listen: [`/ip4/${opts.listenHost ?? '127.0.0.1'}/tcp/${opts.listenPort ?? 0}/ws`],
      ...(opts.announce && opts.announce.length > 0 ? { announce: opts.announce } : {}),
    },
    // filters.all: dial/listen on plain `/ws` addresses (the localhost default);
    // the stock filter admits only DNS+wss shapes meant for the public internet.
    transports: [webSockets({ filter: wsFilters.all })],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
    datastore,
  });

  const helia = new Helia({
    libp2p,
    blockstore,
    datastore,
    blockBrokers: [bitswap()],
    // No routers: this node never looks providers up (bitswap asks connected
    // peers directly) and never advertises to a DHT. Explicit dial only.
    routers: [],
  });
  await helia.start();

  async function drainPin(cid: ReturnType<typeof cidFromHashHex>, signal?: AbortSignal): Promise<void> {
    // pins.add is an async generator; it MUST be fully drained or the pin is not
    // committed (spike doc pitfall 6).
    try {
      for await (const _ of helia.pins.add(cid, { signal })) {
        void _;
      }
    } catch (err) {
      // Check-then-act race: two concurrent requests for the same digest both
      // pass an isPinned pre-check, and the loser's pins.add throws "Already
      // pinned" (adversarially reproduced on fs-backed stores: every cohort
      // member's publish plan shares the announcement digest, so simultaneous
      // publishes race here routinely). A block that IS pinned is a success,
      // not a failure - re-check rather than trusting the message text.
      if (await helia.pins.isPinned(cid)) {
        return;
      }
      throw err;
    }
  }

  const node: IpfsNode = {
    peerId: libp2p.peerId.toString(),
    helia,

    multiaddrs(): string[] {
      return libp2p.getMultiaddrs().map((a) => a.toString());
    },

    async publish(artifact: object, hashHex?: string): Promise<string> {
      const computed = artifactHashHex(artifact);
      if (hashHex !== undefined && normalizeDigestHex(hashHex) !== computed) {
        throw new Error(
          `refusing to publish: artifact hashes to ${computed}, not the claimed ${hashHex}`,
        );
      }
      const cid = cidFromHashHex(computed);
      await helia.blockstore.put(cid, canonicalArtifactBytes(artifact));
      if (!(await helia.pins.isPinned(cid))) {
        await drainPin(cid);
      }
      return cid.toString();
    },

    async pin(hashHex: string, store?: ArtifactStore): Promise<PinOutcome> {
      const hash = normalizeDigestHex(hashHex);
      const cid = cidFromHashHex(hash);
      const outcome = (source: PinSource): PinOutcome => ({ hash, cid: cid.toString(), pinned: true, source });
      try {
        if (await helia.pins.isPinned(cid)) {
          return outcome('already-pinned');
        }
        // Prefer this coordinator's own artifact store: for a cohort artifact the
        // canonical bytes are already here, so no transfer is needed. The digest is
        // re-verified before the block is stored - a value that does not hash to
        // the requested key (e.g. an SMT proof, which is keyed by its member's
        // update hash, or a corrupt blob) must never become a block whose CID lies.
        if (store) {
          for (const kind of DIGEST_KEYED_KINDS) {
            const value = await store.get(kind, hash);
            if (value !== undefined && value !== null && typeof value === 'object') {
              if (artifactHashHex(value as object) !== hash) {
                continue;
              }
              await helia.blockstore.put(cid, canonicalArtifactBytes(value as object));
              await drainPin(cid);
              return outcome('store');
            }
          }
        }
        // A block already held locally (e.g. published directly on this node) just
        // needs the pin; otherwise pins.add pulls it over bitswap from whichever
        // connected peer has it - the publishing browser - bounded by the timeout.
        const hadBlock = await helia.blockstore.has(cid);
        await drainPin(cid, AbortSignal.timeout(pinTimeoutMs));
        return outcome(hadBlock ? 'local' : 'network');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { hash, cid: cid.toString(), pinned: false, error: message };
      }
    },

    hasBlock(hashHex: string): Promise<boolean> {
      return helia.blockstore.has(cidFromHashHex(hashHex));
    },

    async getBlock(hashHex: string, getOpts?: { timeoutMs?: number }): Promise<Uint8Array> {
      return helia.blockstore.get(cidFromHashHex(hashHex), {
        signal: AbortSignal.timeout(getOpts?.timeoutMs ?? pinTimeoutMs),
      });
    },

    async dial(addr: string): Promise<void> {
      await libp2p.dial(multiaddr(addr));
    },

    async stop(): Promise<void> {
      await helia.stop();
      if (blockstore instanceof FsBlockstore) {
        await blockstore.close();
      }
      if (datastore instanceof FsDatastore) {
        await datastore.close();
      }
    },
  };
  return node;
}

/**
 * Validate a `POST /v1/ipfs/pin` body. Returns the normalized hashes or a
 * human-readable problem string. Exported for direct unit testing.
 */
export function validatePinRequest(body: unknown): { hashes: string[] } | { problem: string } {
  if (body === null || typeof body !== 'object' || !Array.isArray((body as { hashes?: unknown }).hashes)) {
    return { problem: 'expected a JSON body { hashes: string[] }' };
  }
  const raw = (body as { hashes: unknown[] }).hashes;
  if (raw.length === 0) {
    return { problem: 'hashes must not be empty' };
  }
  if (raw.length > MAX_PIN_REQUEST) {
    return { problem: `at most ${MAX_PIN_REQUEST} hashes per request` };
  }
  const hashes: string[] = [];
  for (const h of raw) {
    if (typeof h !== 'string') {
      return { problem: 'hashes must be strings' };
    }
    try {
      hashes.push(normalizeDigestHex(h));
    } catch {
      return { problem: `not a 64-char hex sha256 digest: "${h}"` };
    }
  }
  return { hashes };
}
