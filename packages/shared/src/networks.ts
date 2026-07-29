import { NETWORK, TEST_NETWORK, type BTC_NETWORK } from '@scure/btc-signer/utils';

/**
 * The Bitcoin networks this reference aggregator can target. Matches
 * `@did-btcr2/bitcoin`'s `NetworkName` union exactly so a {@link NetworkConfig}'s
 * `name` can be handed straight to `new BitcoinConnection({ network })` once the
 * live chain wiring lands in M3c.
 */
export type NetworkName =
  | 'bitcoin'
  | 'testnet3'
  | 'testnet4'
  | 'signet'
  | 'mutinynet'
  | 'regtest';

/** @scure/btc-signer address-format params (bech32 HRP, version bytes, WIF). */
export type { BTC_NETWORK };

/**
 * Regtest address params (`bcrt` HRP). @scure/btc-signer ships mainnet
 * ({@link NETWORK}) and a shared test profile ({@link TEST_NETWORK}, used by
 * testnet3/testnet4/signet/mutinynet), but not regtest, so we define it here.
 * Mirrors `@did-btcr2/bitcoin`'s `getNetwork('regtest')`.
 */
const REGTEST_NETWORK: BTC_NETWORK = {
  bech32: 'bcrt',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

/**
 * A block hash at a fixed, low, already-buried height: the second half of a chain's
 * identity where {@link NetworkConfig.genesisHash} alone cannot separate two chains.
 *
 * It exists because of one fact about Bitcoin Core: EVERY signet shares block zero.
 * `SigNetParams` builds its genesis from fixed constants and the signet challenge (the
 * thing that actually distinguishes mutinynet from plain signet) never enters that
 * hash, so the two chains are identical at height 0 and have diverged by height 1.
 */
export interface ChainBlockMarker {
  /** Height of the marker block. Low, so an esplora probe is one cheap request. */
  height: number;
  /** The block hash at {@link height} on this chain. */
  hash: string;
}

/** Everything the app needs to operate against one Bitcoin network. */
export interface NetworkConfig {
  /** Canonical network name; assignable to `BitcoinConnection`'s `network`. */
  name: NetworkName;
  /** Human label for UI/logs. */
  label: string;
  /**
   * Esplora REST base URL (no trailing slash). Used in M3c to construct
   * `new BitcoinConnection({ network, rest: { host } })`. Deployment-specific
   * for regtest; override via {@link resolveNetwork}'s second argument.
   */
  esploraHost: string;
  /** @scure/btc-signer params for deriving addresses on this network. */
  scureNetwork: BTC_NETWORK;
  /** True for real-money mainnet; live operations must opt in explicitly. */
  isMainnet: boolean;
  /**
   * Hash of block zero on this chain. Block zero is the conventional chain identifier:
   * it is immutable, it is reachable from every esplora deployment at
   * `GET /block-height/0`, and it costs one request to read.
   *
   * This is the value the PARTICIPANT-side endpoint guard compares against (PART-05,
   * D-20). It lives here, in the declared single source of truth for chain parameters,
   * rather than in `packages/web`, because a browser-local copy would be a second
   * source of truth for the one fact that whole guard rests on.
   *
   * NOT sufficient on its own for the signet family: see {@link distinguishingBlock}.
   */
  genesisHash: string;
  /**
   * A second chain marker, present ONLY where {@link genesisHash} is shared with
   * another registered network (today: mutinynet and signet, which are both signets).
   * Where block zero is already unique this is absent, so the common probe stays a
   * single request.
   */
  distinguishingBlock?: ChainBlockMarker;
  /** Block-explorer URL for a txid, or `''` where there is no public explorer. */
  explorerTxUrl(txid: string): string;
}

/**
 * The full chain identity of a {@link NetworkConfig}: block zero, plus the second
 * marker where block zero is ambiguous. Two networks with the same fingerprint are
 * indistinguishable to a chain probe, which is exactly what the registry spec forbids.
 */
export function chainFingerprint(config: NetworkConfig): string {
  const marker = config.distinguishingBlock;
  return marker ? `${config.genesisHash}@${marker.height}:${marker.hash}` : config.genesisHash;
}

/**
 * The network registry. mutinynet is the public default (fast, free, verifiable);
 * regtest is the hermetic CI live-path target; mainnet is first-class but guarded
 * (see {@link assertNetworkAllowed}). All chain interaction stays opt-in behind the
 * M3c `LIVE` flag; in the fixture path these entries are inert config.
 */
export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  bitcoin: {
    name: 'bitcoin',
    label: 'Bitcoin mainnet',
    esploraHost: 'https://blockstream.info/api',
    scureNetwork: NETWORK,
    isMainnet: true,
    genesisHash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    explorerTxUrl: (txid) => `https://mempool.space/tx/${txid}`,
  },
  mutinynet: {
    name: 'mutinynet',
    label: 'Mutinynet (signet)',
    esploraHost: 'https://mutinynet.com/api',
    scureNetwork: TEST_NETWORK,
    isMainnet: false,
    // Shared with `signet` below: both are signets, and a signet's genesis block does
    // not depend on its challenge. The height-1 marker is what separates them.
    genesisHash: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
    distinguishingBlock: {
      height: 1,
      hash: '000002855893a0a9b24eaffc5efc770558a326fee4fc10c9da22fc19cd2954f9',
    },
    explorerTxUrl: (txid) => `https://mutinynet.com/tx/${txid}`,
  },
  signet: {
    name: 'signet',
    label: 'Signet',
    esploraHost: 'https://mempool.space/signet/api',
    scureNetwork: TEST_NETWORK,
    isMainnet: false,
    // Identical to mutinynet's: see the note there. Height 1 is where they diverge.
    genesisHash: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
    distinguishingBlock: {
      height: 1,
      hash: '00000086d6b2636cb2a392d45edc4ec544a10024d30141c9adf4bfd9de533b53',
    },
    explorerTxUrl: (txid) => `https://mempool.space/signet/tx/${txid}`,
  },
  testnet3: {
    name: 'testnet3',
    label: 'Testnet3',
    esploraHost: 'https://mempool.space/testnet/api',
    scureNetwork: TEST_NETWORK,
    isMainnet: false,
    genesisHash: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
    explorerTxUrl: (txid) => `https://mempool.space/testnet/tx/${txid}`,
  },
  testnet4: {
    name: 'testnet4',
    label: 'Testnet4',
    esploraHost: 'https://mempool.space/testnet4/api',
    scureNetwork: TEST_NETWORK,
    isMainnet: false,
    genesisHash: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
    explorerTxUrl: (txid) => `https://mempool.space/testnet4/tx/${txid}`,
  },
  regtest: {
    name: 'regtest',
    label: 'Regtest (local)',
    esploraHost: 'http://127.0.0.1:3000',
    scureNetwork: REGTEST_NETWORK,
    isMainnet: false,
    // Every regtest chain shares this genesis, and two DIFFERENT local regtest chains
    // are therefore indistinguishable to any chain probe. No marker can fix that (a
    // local chain's block 1 is deployment-specific), so the guard's honest reach on
    // regtest is "this is a regtest chain", not "this is YOUR regtest chain".
    genesisHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
    explorerTxUrl: () => '',
  },
};

/** The public default network: fast, free coins, verifiable, no real-money risk. */
export const DEFAULT_NETWORK: NetworkName = 'mutinynet';

/**
 * The JSON-serializable projection of a {@link NetworkConfig} served on
 * `GET /v1/config` so the browser can derive its network at runtime instead of
 * from the build-time {@link DEFAULT_NETWORK}. Deliberately just the name plus two
 * display fields: {@link NetworkConfig.explorerTxUrl} is a function (dropped by
 * `JSON.stringify`) and {@link NetworkConfig.scureNetwork} is reconstructed on the
 * client via {@link resolveNetwork}(`network`) from the same shared registry, so the
 * `name` is the single join key and nothing derivable is put on the wire.
 */
export interface NetworkConfigDTO {
  /** Canonical network name; the client passes this to {@link resolveNetwork}. */
  network: NetworkName;
  /** Human label for UI/logs. */
  label: string;
  /** True for real-money mainnet (lets the client show a guard before live actions). */
  isMainnet: boolean;
}

/** Serialize a {@link NetworkConfig} to its wire {@link NetworkConfigDTO} (drops the function). */
export function toNetworkConfigDTO(config: NetworkConfig): NetworkConfigDTO {
  return { network: config.name, label: config.label, isMainnet: config.isMainnet };
}

/** True if `name` is a network this app knows how to target. */
export function isNetworkName(name: string): name is NetworkName {
  return Object.prototype.hasOwnProperty.call(NETWORKS, name);
}

/**
 * Resolve a network name to its {@link NetworkConfig}, optionally overriding the
 * Esplora host (regtest hosts and self-run nodes are deployment-specific). Throws
 * on an unknown name so a typo never silently falls back to the wrong chain.
 */
export function resolveNetwork(name: string, esploraHost?: string): NetworkConfig {
  if (!isNetworkName(name)) {
    const known = Object.keys(NETWORKS).join(', ');
    throw new Error(`Unknown Bitcoin network "${name}". Known: ${known}.`);
  }
  const base = NETWORKS[name];
  return esploraHost ? { ...base, esploraHost } : base;
}

/**
 * Guard for live operations. mainnet moves real money, so a live run against it
 * must pass `allowMainnet: true` (an explicit operator opt-in). Hermetic and
 * test-network paths pass through. Returns the resolved config so callers can
 * inline the check. M3c live wiring calls this before constructing the connection.
 */
export function assertNetworkAllowed(
  name: string,
  opts: { allowMainnet?: boolean } = {},
): NetworkConfig {
  const config = resolveNetwork(name);
  if (config.isMainnet && !opts.allowMainnet) {
    throw new Error(
      `Refusing to operate on ${config.label} without an explicit mainnet opt-in ` +
        `(allowMainnet: true). mainnet moves real funds.`,
    );
  }
  return config;
}
