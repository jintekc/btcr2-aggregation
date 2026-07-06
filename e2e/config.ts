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

async function main(): Promise<void> {
  // Hermeticity: these env vars are the operator interface under test below; an
  // ambient value from the invoking shell must not leak into the assertions.
  delete process.env.ALLOW_MAINNET;
  delete process.env.RECOVERY_KEY;

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
