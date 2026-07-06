import { bitswap } from '@helia/block-brokers';
import { Helia } from '@helia/utils';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { webSockets } from '@libp2p/websockets';
import * as wsFilters from '@libp2p/websockets/filters';
import { multiaddr } from '@multiformats/multiaddr';
import { MemoryBlockstore } from 'blockstore-core';
import { MemoryDatastore } from 'datastore-core';
import { createLibp2p } from 'libp2p';
import { cidFromHashHex, type PublishableArtifact } from '@btcr2-aggregation/shared';

/**
 * The in-browser Helia node (ADR 0011). HEAVY MODULE: helia + libp2p land here,
 * so it must only ever be reached through `await import('./ipfs-node')` - Vite
 * then splits it into its own lazy chunk and the eager bundle stays exactly as
 * lean as before this feature.
 *
 * Composed from `@helia/utils` + `@helia/block-brokers` + a hand-configured
 * libp2p, same recipe as the coordinator's node: dial-only websocket transport
 * (browsers cannot listen), noise + yamux, bitswap, in-memory stores, and no
 * public-network machinery (no DHT, no bootstrap, no relay). The node holds the
 * controller's own artifact blocks - the controller is a real IPFS host of
 * their own data for as long as the tab lives - and serves them over bitswap to
 * the explicitly dialed coordinator, which pins them for durability.
 */

export interface BrowserIpfsNode {
  /** This tab's peer id. */
  readonly peerId: string;
  /** Dial the first reachable of the coordinator's multiaddrs. */
  dialAny(addrs: string[]): Promise<void>;
  /**
   * Store + pin every plan entry's canonical bytes under its digest CID. After
   * this resolves, the blocks are servable to any connected peer over bitswap.
   */
  publish(plan: PublishableArtifact[]): Promise<void>;
  stop(): Promise<void>;
}

/** Create the browser node. The store owns its lifecycle (one per tab session). */
export async function createBrowserIpfsNode(): Promise<BrowserIpfsNode> {
  const libp2p = await createLibp2p({
    // filters.all: permit plain `/ws` multiaddrs (the localhost/dev default).
    // The stock browser filter admits only DNS+wss shapes; a public coordinator
    // announces wss addresses anyway (IPFS_ANNOUNCE), which also pass.
    transports: [webSockets({ filter: wsFilters.all })],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  });
  const helia = new Helia({
    libp2p,
    blockstore: new MemoryBlockstore(),
    datastore: new MemoryDatastore(),
    blockBrokers: [bitswap()],
    routers: [],
  });
  await helia.start();

  return {
    peerId: libp2p.peerId.toString(),

    async dialAny(addrs: string[]): Promise<void> {
      let lastError: unknown;
      for (const addr of addrs) {
        try {
          await libp2p.dial(multiaddr(addr));
          return;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(`could not dial the coordinator's IPFS node (${addrs.length} address(es) tried)`);
    },

    async publish(plan: PublishableArtifact[]): Promise<void> {
      for (const artifact of plan) {
        const cid = cidFromHashHex(artifact.hashHex);
        await helia.blockstore.put(cid, artifact.bytes);
        if (!(await helia.pins.isPinned(cid))) {
          // pins.add is an async generator: drain it fully or the pin is lost.
          for await (const p of helia.pins.add(cid)) {
            void p;
          }
        }
      }
    },

    async stop(): Promise<void> {
      await helia.stop();
    },
  };
}
