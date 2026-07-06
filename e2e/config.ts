import { pathToFileURL } from 'node:url';
import { startDemoServer } from '@btcr2-aggregation/service';
import { DEFAULT_NETWORK, type NetworkConfigDTO } from '@btcr2-aggregation/shared';

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
 */
export async function runConfigCheck(network: string): Promise<NetworkConfigDTO> {
  const server = await startDemoServer({ port: 0, network, webDistDir: null, quiet: true });
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

async function main(): Promise<void> {
  // The default network, then an operator override, both over a real HTTP socket.
  const def = await runConfigCheck(DEFAULT_NETWORK);
  console.log(`default: GET /v1/config -> ${def.network} (${def.label}), isMainnet=${def.isMainnet}`);

  const override = await runConfigCheck('signet');
  console.log(`override: GET /v1/config -> ${override.network} (${override.label})`);

  // A mainnet coordinator must flag isMainnet so the client can guard live actions.
  const mainnet = await runConfigCheck('bitcoin');
  if (!mainnet.isMainnet) {
    throw new Error('expected isMainnet=true for the bitcoin network');
  }
  console.log(`mainnet: GET /v1/config -> ${mainnet.network}, isMainnet=${mainnet.isMainnet}`);

  console.log('e2e:config PASS (runtime network injection over a real socket)');
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
