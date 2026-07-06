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
  /** Block-explorer URL for a txid, or `''` where there is no public explorer. */
  explorerTxUrl(txid: string): string;
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
    explorerTxUrl: (txid) => `https://mempool.space/tx/${txid}`,
  },
  mutinynet: {
    name: 'mutinynet',
    label: 'Mutinynet (signet)',
    esploraHost: 'https://mutinynet.com/api',
    scureNetwork: TEST_NETWORK,
    isMainnet: false,
    explorerTxUrl: (txid) => `https://mutinynet.com/tx/${txid}`,
  },
  signet: {
    name: 'signet',
    label: 'Signet',
    esploraHost: 'https://mempool.space/signet/api',
    scureNetwork: TEST_NETWORK,
    isMainnet: false,
    explorerTxUrl: (txid) => `https://mempool.space/signet/tx/${txid}`,
  },
  testnet3: {
    name: 'testnet3',
    label: 'Testnet3',
    esploraHost: 'https://mempool.space/testnet/api',
    scureNetwork: TEST_NETWORK,
    isMainnet: false,
    explorerTxUrl: (txid) => `https://mempool.space/testnet/tx/${txid}`,
  },
  testnet4: {
    name: 'testnet4',
    label: 'Testnet4',
    esploraHost: 'https://mempool.space/testnet4/api',
    scureNetwork: TEST_NETWORK,
    isMainnet: false,
    explorerTxUrl: (txid) => `https://mempool.space/testnet4/tx/${txid}`,
  },
  regtest: {
    name: 'regtest',
    label: 'Regtest (local)',
    esploraHost: 'http://127.0.0.1:3000',
    scureNetwork: REGTEST_NETWORK,
    isMainnet: false,
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
