import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startDemoServer } from '@btcr2-aggregation/service';
import { DEFAULT_NETWORK, deriveRecoveryKey, type NetworkConfigDTO } from '@btcr2-aggregation/shared';

/**
 * Runtime network config over a real socket - the operator-network-injection proof.
 *
 * A coordinator started on a chosen network must serve exactly that network on
 * `GET /v1/config`, so the same-origin SPA derives its addresses/DIDs from the chain
 * the operator actually runs instead of a build-time constant. This boots a real
 * demo server (offline, protocol-only) on an operator-overridden network and asserts
 * the endpoint round-trips it. The full browser-consumes-it proof rides both browser
 * E2Es (a page.evaluate fetch of /v1/config inside the cohort scenario).
 */

/** Fetch and parse the coordinator's `GET /v1/config`. */
async function getConfig(baseUrl: string): Promise<NetworkConfigDTO> {
  const res = await fetch(`${baseUrl}/v1/config`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`GET /v1/config -> HTTP ${res.status}`);
  }
  return (await res.json()) as NetworkConfigDTO;
}

/**
 * Boot a coordinator on `network` (offline, no web) and assert `GET /v1/config`
 * reports that exact network. Returns the served DTO for the caller to log/assert.
 * `allowMainnet` left undefined falls through to the ALLOW_MAINNET env inside
 * startDemoServer - exactly the operator interface, so the env path is testable.
 */
export async function runConfigCheck(network: string, allowMainnet?: boolean): Promise<NetworkConfigDTO> {
  const server = await startDemoServer({ port: 0, network, webDistDir: null, quiet: true, allowMainnet });
  try {
    const dto = await getConfig(server.baseUrl);
    if (dto.network !== network) {
      throw new Error(`expected served network "${network}", got "${dto.network}"`);
    }
    if (typeof dto.label !== 'string' || typeof dto.isMainnet !== 'boolean') {
      throw new Error(`malformed config DTO: ${JSON.stringify(dto)}`);
    }
    return dto;
  } finally {
    await server.stop();
  }
}

/** Fetch and parse the coordinator's `GET /v1/ipfs` probe. */
async function getIpfsInfo(baseUrl: string): Promise<{ enabled: boolean; peerId?: string; multiaddrs?: string[] }> {
  const res = await fetch(`${baseUrl}/v1/ipfs`, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`GET /v1/ipfs -> HTTP ${res.status}`);
  }
  return (await res.json()) as { enabled: boolean; peerId?: string; multiaddrs?: string[] };
}

async function main(): Promise<void> {
  // Hermeticity: these env vars are the operator interface under test below; an
  // ambient value from the invoking shell must not leak into the assertions.
  delete process.env.ALLOW_MAINNET;
  delete process.env.RECOVERY_KEY;
  delete process.env.IPFS;
  delete process.env.IPFS_DIR;
  delete process.env.IPFS_ANNOUNCE;

  // The default network, then an operator override, both over a real HTTP socket.
  const def = await runConfigCheck(DEFAULT_NETWORK);
  console.log(`default: GET /v1/config -> ${def.network} (${def.label}), isMainnet=${def.isMainnet}`);

  const override = await runConfigCheck('signet');
  console.log(`override: GET /v1/config -> ${override.network} (${override.label})`);

  // Mainnet guard rail: a bitcoin-network coordinator must REFUSE to boot without
  // the explicit operator opt-in (real funds), and boot with it.
  let refused = false;
  try {
    await runConfigCheck('bitcoin');
  } catch (err) {
    refused = true;
    const msg = err instanceof Error ? err.message : String(err);
    if (!/ALLOW_MAINNET|allowMainnet/.test(msg)) {
      throw new Error(`mainnet refusal did not name the opt-in: ${msg}`);
    }
    console.log('mainnet: boot without opt-in refused (as required)');
  }
  if (!refused) {
    throw new Error('a mainnet coordinator booted WITHOUT the ALLOW_MAINNET opt-in');
  }

  // With the opt-in, it boots and must flag isMainnet so the client can guard
  // live actions (the register panel acknowledgment, the real-funds badge).
  const mainnet = await runConfigCheck('bitcoin', true);
  if (!mainnet.isMainnet) {
    throw new Error('expected isMainnet=true for the bitcoin network');
  }
  console.log(`mainnet: opt-in boot, GET /v1/config -> ${mainnet.network}, isMainnet=${mainnet.isMainnet}`);

  // The ENV form of the opt-in (ALLOW_MAINNET=1) is the interface real operators
  // use (`NETWORK=bitcoin ALLOW_MAINNET=1 pnpm demo`); exercise it explicitly so
  // the env parse cannot silently regress while the option-based tests stay green.
  process.env.ALLOW_MAINNET = '1';
  try {
    const viaEnv = await runConfigCheck('bitcoin');
    if (!viaEnv.isMainnet) {
      throw new Error('expected isMainnet=true for the env-opted-in bitcoin boot');
    }
  } finally {
    delete process.env.ALLOW_MAINNET;
  }
  console.log('mainnet: ALLOW_MAINNET=1 env opt-in boots (operator interface)');

  // RECOVERY_KEY env threading: an invalid key must fail at boot (proof the env
  // reaches buildCohortConfig's validation), and a valid x-only key must boot.
  process.env.RECOVERY_KEY = 'not-a-key';
  try {
    let recoveryRefused = false;
    try {
      await runConfigCheck(DEFAULT_NETWORK);
    } catch (err) {
      recoveryRefused = true;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/64 hex/.test(msg)) {
        throw new Error(`invalid RECOVERY_KEY refusal had the wrong reason: ${msg}`);
      }
    }
    if (!recoveryRefused) {
      throw new Error('a coordinator booted with an invalid RECOVERY_KEY');
    }
    process.env.RECOVERY_KEY = deriveRecoveryKey();
    await runConfigCheck(DEFAULT_NETWORK);
  } finally {
    delete process.env.RECOVERY_KEY;
  }
  console.log('recovery: RECOVERY_KEY env validated at boot (invalid refused, valid boots)');

  // IPFS opt-in (ADR 0011): the default boot serves the probe as DISABLED (the
  // route is unconditional so the SPA can always ask), and the env form `IPFS=1`
  // - the operator interface (`IPFS=1 pnpm demo`) - boots a pinning node whose
  // peer id and dialable multiaddrs are served. Exercised through the env
  // exactly as an operator would set it, so the env parse cannot silently
  // regress while option-based tests stay green.
  {
    const server = await startDemoServer({ port: 0, webDistDir: null, quiet: true });
    try {
      const off = await getIpfsInfo(server.baseUrl);
      if (off.enabled !== false || off.multiaddrs !== undefined) {
        throw new Error(`expected a disabled IPFS probe by default, got ${JSON.stringify(off)}`);
      }
    } finally {
      await server.stop();
    }
  }
  process.env.IPFS = '1';
  try {
    const server = await startDemoServer({ port: 0, webDistDir: null, quiet: true });
    try {
      const on = await getIpfsInfo(server.baseUrl);
      if (!on.enabled || !on.peerId || !on.multiaddrs?.length) {
        throw new Error(`expected an enabled IPFS probe under IPFS=1, got ${JSON.stringify(on)}`);
      }
      if (!on.multiaddrs[0].includes(on.peerId)) {
        throw new Error(`served multiaddr does not carry the peer id: ${on.multiaddrs[0]}`);
      }
    } finally {
      await server.stop();
    }
  } finally {
    delete process.env.IPFS;
  }
  console.log('ipfs: probe disabled by default, IPFS=1 env boots a dialable pinning node');

  // IPFS_DIR env: the durable-storage operator interface. A regression that drops
  // the env threading silently degrades an operator's "durable" node to in-memory
  // (probe looks identical; pins vanish on restart), so assert the env actually
  // lands: the node creates its block/pin store directories under the dir.
  {
    const dir = await mkdtemp(join(tmpdir(), 'btcr2-e2e-ipfs-dir-'));
    process.env.IPFS = '1';
    process.env.IPFS_DIR = dir;
    try {
      const server = await startDemoServer({ port: 0, webDistDir: null, quiet: true });
      try {
        const on = await getIpfsInfo(server.baseUrl);
        if (!on.enabled) {
          throw new Error('IPFS_DIR boot did not enable the node');
        }
        if (!existsSync(join(dir, 'blocks')) || !existsSync(join(dir, 'data'))) {
          throw new Error(`IPFS_DIR=${dir} did not reach the node (no blocks/data dirs created)`);
        }
      } finally {
        await server.stop();
      }
    } finally {
      delete process.env.IPFS;
      delete process.env.IPFS_DIR;
      await rm(dir, { recursive: true, force: true });
    }
  }
  console.log('ipfs: IPFS_DIR env threads through to durable fs-backed stores');

  // IPFS_ANNOUNCE env: the wss-behind-TLS deployment interface (a browser on an
  // https page can only dial wss, so the operator announces the proxied address
  // instead of the raw listen address). Assert the comma-split env values are
  // exactly what the probe serves - these are the addresses every browser dials,
  // so a parse regression bricks remote publishes with the gate otherwise green.
  {
    const wss = '/dns4/agg.example.org/tcp/443/wss';
    const ws = '/dns4/agg.internal/tcp/8081/ws';
    process.env.IPFS = '1';
    process.env.IPFS_ANNOUNCE = ` ${wss}, ${ws} `;
    try {
      const server = await startDemoServer({ port: 0, webDistDir: null, quiet: true });
      try {
        const on = await getIpfsInfo(server.baseUrl);
        const addrs = on.multiaddrs ?? [];
        if (addrs.length !== 2 || !addrs[0].startsWith(`${wss}/p2p/`) || !addrs[1].startsWith(`${ws}/p2p/`)) {
          throw new Error(`IPFS_ANNOUNCE did not shape the served multiaddrs: ${JSON.stringify(addrs)}`);
        }
      } finally {
        await server.stop();
      }
    } finally {
      delete process.env.IPFS;
      delete process.env.IPFS_ANNOUNCE;
    }
  }
  console.log('ipfs: IPFS_ANNOUNCE env replaces the served multiaddrs (wss-behind-TLS interface)');

  console.log('e2e:config PASS (runtime network injection + mainnet guard over a real socket)');
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    // Exit explicitly: startDemoServer runs a background advertise loop whose per-cohort
    // TTL timer can otherwise keep the process alive after the checks pass.
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.stack : err);
      process.exit(1);
    });
}
