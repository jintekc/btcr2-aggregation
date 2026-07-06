import { pathToFileURL } from 'node:url';
import { bytesToHex } from '@noble/hashes/utils';
import { BitcoinConnection, type NetworkName as BtcNetworkName } from '@did-btcr2/bitcoin';
import { createParticipant } from '@btcr2-aggregation/participant';
import { createService } from '@btcr2-aggregation/service';
import {
  importIdentity,
  resolveNetwork,
  type BeaconType,
  type CohortConfig,
  type Identity,
} from '@btcr2-aggregation/shared';

/**
 * REAL live broadcast e2e (gated behind `LIVE=1`; NOT part of the hermetic gate).
 *
 * Drives a full n-of-n MuSig2 aggregation cohort to a REAL aggregate beacon
 * transaction and BROADCASTS it on a live Bitcoin test network (mutinynet by
 * default), then asserts it lands on-chain carrying the cohort's signal.
 *
 * The cohort's beacon UTXO is operator-funded (the public mutinynet faucet cannot be
 * scripted). To make funding a single, race-free manual step, every key is
 * deterministic (fixed participant + recovery secrets), so the beacon address is
 * stable across runs. The flow:
 *
 *   1. LEARN  - run a throwaway zero-chain (fixture) cohort with the deterministic
 *               keys to read the beacon address off `keygen-complete`. Same keys ->
 *               the live run below computes the identical address.
 *   2. FUND   - print the address; the operator funds it out-of-band; poll
 *               `getUtxos` until a single (confirmed) UTXO >= FUND_SATS appears
 *               (the builder spends exactly one UTXO), remembering the funded txids.
 *   3. LIVE   - run the cohort with `live:true, broadcast:true`: the service builds
 *               the real beacon tx spending that UTXO, n-of-n co-signs it, and the
 *               broadcast handler pushes it + polls confirmation.
 *   4. ASSERT - fetch the tx from esplora; assert a `vout` is the OP_RETURN carrying
 *               the cohort's `signalBytes` (6a20 + 32 bytes), that a `vin` spends a
 *               funded beacon UTXO (never the all-zero fixture prevout), and that it
 *               confirms.
 *
 * Env: LIVE=1 (required to run), LIVE_NETWORK (default mutinynet), ESPLORA_HOST
 * (default the registry host), FUND_SATS (default 100000), LIVE_N (default 2),
 * LIVE_PARTICIPANT_SECRETS / LIVE_RECOVERY_SECRET (comma-sep 32-byte hex; fixed
 * defaults below), REQUIRE_CONFIRMED (default 1), FUND_TIMEOUT_MS (default 1800000),
 * ALLOW_MAINNET=1 (required for a mainnet target). Flag: --smt for an SMT cohort.
 */

const NETWORK_NAME = process.env.LIVE_NETWORK ?? 'mutinynet';
const FUND_SATS = Number(process.env.FUND_SATS ?? 100000);
const N = Number(process.env.LIVE_N ?? 2);
const REQUIRE_CONFIRMED = process.env.REQUIRE_CONFIRMED !== '0';
const FUND_TIMEOUT_MS = Number(process.env.FUND_TIMEOUT_MS ?? 1_800_000);
const RECOVERY_SEQUENCE = 144;

// Fixed, throwaway 32-byte secrets so the beacon address is stable run-to-run (the
// operator funds the same address each time). Override via env for real deployments.
const DEFAULT_PARTICIPANT_SECRETS = [
  '1111111111111111111111111111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222222222222222222222222222',
  '4444444444444444444444444444444444444444444444444444444444444444',
];
const DEFAULT_RECOVERY_SECRET = '3333333333333333333333333333333333333333333333333333333333333333';
// The coordinator DID; not part of the cohort keys, so it does not affect the beacon
// address. Fixed only so the run is fully reproducible.
const SERVICE_SECRET = '5555555555555555555555555555555555555555555555555555555555555555';

/** Reject if `p` does not settle within `ms` (the timeout does not keep Node alive). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref();
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** An unref'd sleep (does not keep the process alive). */
function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref();
  });
}

/** Build the deterministic cohort config: fixed recoveryKey => stable beacon address. */
function buildDeterministicConfig(beaconType: BeaconType, recoverySecret: string): CohortConfig {
  const recoveryKey = bytesToHex(importIdentity(recoverySecret).keys.publicKey.xOnly);
  return {
    beaconType,
    minParticipants: N,
    network: NETWORK_NAME,
    recoveryKey,
    recoverySequence: RECOVERY_SEQUENCE,
  };
}

/**
 * Phase 1 (LEARN): run one throwaway zero-chain fixture cohort with the deterministic
 * identities and read the beacon address off `keygen-complete`. Deterministic keys
 * mean the live run computes the same address, so the operator can pre-fund it.
 */
async function learnBeaconAddress(
  config: CohortConfig,
  identities: Identity[],
  beaconType: BeaconType,
): Promise<string> {
  const service = createService({
    identity: importIdentity(SERVICE_SECRET),
    config,
    phaseTimeoutMs: 60_000,
    cohortTtlMs: 120_000,
  });

  // Resolve as soon as keygen finalizes (the beacon address is available then, before
  // update submission), so this works for both CAS and SMT without depending on the
  // whole fixture cohort completing.
  const gotAddress = new Promise<string>((resolve) => {
    service.runner.on('keygen-complete', (info: { beaconAddress: string }) => resolve(info.beaconAddress));
  });

  const { baseUrl } = await service.start(0);
  const participants = identities.map((identity) => createParticipant({ identity, baseUrl, beaconType }));
  try {
    await Promise.all(participants.map((p) => p.start()));
    // The run may fail after we grab the address (we tear down mid-flow); ignore that.
    void service.runner.run().catch(() => undefined);
    return await withTimeout(gotAddress, 60_000, 'learn-phase keygen-complete');
  } finally {
    for (const p of participants) {
      p.stop();
    }
    await service.stop();
  }
}

/** A fundable UTXO at the beacon address. */
interface FundingUtxo {
  txid: string;
  value: number;
}

/** The address's spendable UTXOs, honoring the confirmed requirement. */
async function eligibleUtxos(bitcoin: BitcoinConnection, address: string): Promise<FundingUtxo[]> {
  const utxos = await bitcoin.rest.address.getUtxos(address);
  return utxos
    .filter((u) => !REQUIRE_CONFIRMED || u.status.confirmed)
    .map((u) => ({ txid: u.txid, value: u.value }));
}

/**
 * Phase 2 (FUND): print the address and poll until a SINGLE UTXO holds >= FUND_SATS.
 * The beacon-tx builder spends exactly one UTXO (`fetchSpendableUtxo`), so the check
 * is on the largest single UTXO, not the sum (dust-split funding must not pass).
 * Returns the set of the address's eligible-UTXO txids at fund time, so Phase 4 can
 * assert the broadcast tx actually spends one of them (an on-chain path discriminator).
 */
async function waitForFunding(bitcoin: BitcoinConnection, address: string): Promise<Set<string>> {
  const netConfig = resolveNetwork(NETWORK_NAME);
  console.log('\n================ FUND THE BEACON ADDRESS ================');
  console.log(`  network : ${netConfig.label} (${NETWORK_NAME})`);
  console.log(`  address : ${address}`);
  console.log(`  amount  : one UTXO >= ${FUND_SATS} sats (${REQUIRE_CONFIRMED ? 'confirmed' : 'mempool ok'})`);
  if (!REQUIRE_CONFIRMED) {
    console.warn(
      '  WARNING : REQUIRE_CONFIRMED=0 - may spend an unconfirmed UTXO; the network can ' +
        'reject a child of an unconfirmed parent. Prefer a confirmed UTXO.',
    );
  }
  if (NETWORK_NAME === 'mutinynet') {
    console.log('  faucet  : https://faucet.mutinynet.com/  (paste the address above)');
  }
  console.log('========================================================\n');

  const deadline = Date.now() + FUND_TIMEOUT_MS;
  for (;;) {
    const utxos = await eligibleUtxos(bitcoin, address).catch(() => [] as FundingUtxo[]);
    const largest = utxos.reduce((m, u) => Math.max(m, u.value), 0);
    if (largest >= FUND_SATS) {
      console.log(`[fund] detected a ${largest}-sat UTXO at ${address}; proceeding.`);
      return new Set(utxos.map((u) => u.txid));
    }
    if (Date.now() >= deadline) {
      throw new Error(`funding timed out after ${FUND_TIMEOUT_MS}ms (largest UTXO ${largest}/${FUND_SATS} sats)`);
    }
    console.log(`[fund] waiting for funding... (largest UTXO ${largest}/${FUND_SATS} sats) - polling every 10s`);
    await sleep(10_000);
  }
}

/** Fetch a tx from esplora, retrying while it is still propagating into the index. */
async function getTxWithRetry(
  bitcoin: BitcoinConnection,
  txid: string,
  tries = 10,
  delayMs = 3000,
): Promise<{ vin: Array<{ txid: string }>; vout: Array<{ scriptpubkey: string }> }> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await bitcoin.rest.transaction.get(txid);
    } catch (err) {
      lastErr = err;
      await sleep(delayMs);
    }
  }
  throw new Error(`could not fetch tx ${txid} after ${tries} tries: ${String(lastErr)}`);
}

/** Poll isConfirmed until true or the window elapses. Returns the final flag. */
async function pollConfirmed(bitcoin: BitcoinConnection, txid: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await bitcoin.rest.transaction.isConfirmed(txid).catch(() => false)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(10_000);
  }
}

interface LiveRunResult {
  txid: string;
  signalBytes: Uint8Array;
  beaconAddress: string;
}

/**
 * Phase 3 (LIVE): run the cohort with live broadcasting, capture the broadcast txid
 * and the cohort's signalBytes.
 */
async function runLiveCohort(
  config: CohortConfig,
  identities: Identity[],
  bitcoin: BitcoinConnection,
  beaconType: BeaconType,
  allowMainnet: boolean,
): Promise<LiveRunResult> {
  const service = createService({
    identity: importIdentity(SERVICE_SECRET),
    config,
    live: true,
    broadcast: true,
    bitcoin,
    // Forward the operator opt-in so a mainnet target (config.network) is permitted
    // here rather than throwing at construction after funding already happened.
    allowMainnet,
    // Live network latency: give each phase and the overall cohort ample room; the
    // confirmation wait lives in the broadcast handler, not a protocol phase.
    phaseTimeoutMs: 120_000,
    cohortTtlMs: 300_000,
    confirmPollIntervalMs: 10_000,
    confirmTimeoutMs: 600_000,
  });

  const broadcaster = service.broadcaster;
  if (!broadcaster) {
    await service.stop();
    throw new Error('service.broadcaster undefined despite broadcast:true');
  }

  // Resolve on broadcast, but ALSO reject fast on a broadcast rejection so a real
  // esplora policy error (datacarrier / non-standard / insufficient-fee) surfaces its
  // actual reason immediately instead of the generic 120s broadcast-event timeout.
  const broadcastSeen = new Promise<string>((resolve, reject) => {
    broadcaster.on('beacon-broadcast', (p) => {
      console.log(`[live] beacon-broadcast: ${p.txid}`);
      resolve(p.txid);
    });
    broadcaster.on('beacon-broadcast-failed', (p) => {
      console.error(`[live] beacon-broadcast-failed: ${p.reason}`);
      reject(new Error(`broadcast rejected by the network: ${p.reason}`));
    });
  });
  broadcaster.on('beacon-anchored', (p) => {
    console.log(`[live] beacon-anchored: ${p.txid} confirmed=${p.confirmed}`);
  });

  const { baseUrl } = await service.start(0);
  const participants = identities.map((identity) => createParticipant({ identity, baseUrl, beaconType }));
  try {
    await Promise.all(participants.map((p) => p.start()));
    console.log(`[live] broadcasting a REAL ${beaconType} beacon tx on ${NETWORK_NAME}...`);
    const result = await withTimeout(service.runner.run(), 300_000, 'live cohort run');
    if (result.signature.length !== 64 && result.path !== 'script-path') {
      throw new Error(`unexpected signature length ${result.signature.length} for ${result.path ?? 'key-path'}`);
    }
    const cohort = service.runner.session.getCohort(result.cohortId);
    if (!cohort?.signalBytes) {
      throw new Error('cohort or signalBytes missing after signing-complete');
    }
    const txid = await withTimeout(broadcastSeen, 120_000, 'beacon-broadcast event');
    return { txid, signalBytes: cohort.signalBytes, beaconAddress: cohort.beaconAddress };
  } finally {
    for (const p of participants) {
      p.stop();
    }
    await service.stop();
  }
}

async function main(): Promise<number> {
  const beaconType: BeaconType = process.argv.includes('--smt') ? 'SMTBeacon' : 'CASBeacon';

  if (process.env.LIVE !== '1') {
    console.log(
      `live-broadcast e2e is gated. Set LIVE=1 to broadcast a REAL ${beaconType} tx on ${NETWORK_NAME}.\n` +
        'Inputs (env): LIVE_NETWORK, ESPLORA_HOST, FUND_SATS, LIVE_N, LIVE_PARTICIPANT_SECRETS,\n' +
        'LIVE_RECOVERY_SECRET, REQUIRE_CONFIRMED, FUND_TIMEOUT_MS, ALLOW_MAINNET. Flag: --smt.',
    );
    return 0;
  }

  const netConfig = resolveNetwork(NETWORK_NAME, process.env.ESPLORA_HOST);
  const allowMainnet = process.env.ALLOW_MAINNET === '1';
  if (netConfig.isMainnet && !allowMainnet) {
    console.error(`Refusing to broadcast on ${netConfig.label} without ALLOW_MAINNET=1.`);
    return 1;
  }

  const secretsEnv = process.env.LIVE_PARTICIPANT_SECRETS?.split(',').map((s) => s.trim());
  const participantSecrets = (secretsEnv ?? DEFAULT_PARTICIPANT_SECRETS).slice(0, N);
  if (participantSecrets.length < N) {
    console.error(`need ${N} participant secrets, have ${participantSecrets.length} (set LIVE_PARTICIPANT_SECRETS)`);
    return 1;
  }
  const recoverySecret = process.env.LIVE_RECOVERY_SECRET ?? DEFAULT_RECOVERY_SECRET;
  const identities = participantSecrets.map((secret) => importIdentity(secret));
  const config = buildDeterministicConfig(beaconType, recoverySecret);

  const bitcoin = new BitcoinConnection({
    network: netConfig.name as BtcNetworkName,
    rest: { host: netConfig.esploraHost },
  });

  console.log(`[live] esplora: ${netConfig.esploraHost}`);
  console.log('[live] Phase 1/4: learning the deterministic beacon address (fixture cohort)...');
  const learnedAddress = await learnBeaconAddress(config, identities, beaconType);
  console.log(`[live] beacon address: ${learnedAddress}`);

  console.log('[live] Phase 2/4: waiting for the operator to fund the beacon address...');
  const fundingTxids = await waitForFunding(bitcoin, learnedAddress);

  console.log('[live] Phase 3/4: running the live cohort and broadcasting...');
  const { txid, signalBytes, beaconAddress } = await runLiveCohort(
    config,
    identities,
    bitcoin,
    beaconType,
    allowMainnet,
  );
  if (beaconAddress !== learnedAddress) {
    console.error(`beacon address drift: learned ${learnedAddress}, live run used ${beaconAddress}`);
    return 1;
  }

  console.log('[live] Phase 4/4: asserting the tx is on-chain and carries the signal...');
  const problems: string[] = [];
  const tx = await getTxWithRetry(bitcoin, txid);
  const expectedOpReturn = `6a20${bytesToHex(signalBytes)}`;
  const hasSignal = tx.vout.some((v) => v.scriptpubkey === expectedOpReturn);
  if (!hasSignal) {
    problems.push(
      `on-chain tx ${txid} does not carry the expected OP_RETURN signal ${expectedOpReturn}; ` +
        `vout scripts: ${tx.vout.map((v) => v.scriptpubkey).join(', ')}`,
    );
  }
  // On-chain path discriminator: the tx must spend one of the operator-funded UTXOs at
  // the beacon address, and never the all-zero fixture prevout. This is the real-chain
  // analog of the hermetic scenario's servedTxids check; combined with confirmation it
  // proves a genuine live tx, not a fixture-shaped one that happened to carry the signal.
  const zero = '00'.repeat(32);
  if (tx.vin.some((v) => v.txid === zero)) {
    problems.push(`on-chain tx ${txid} spends the all-zero fixture prevout, not a funded UTXO`);
  }
  if (!tx.vin.some((v) => fundingTxids.has(v.txid))) {
    problems.push(
      `on-chain tx ${txid} does not spend any UTXO the funded beacon address held ` +
        `(vin txids: ${tx.vin.map((v) => v.txid).join(', ')}; funded: ${[...fundingTxids].join(', ')})`,
    );
  }
  const confirmed = await pollConfirmed(bitcoin, txid, 600_000);
  if (!confirmed) {
    problems.push(`tx ${txid} did not confirm within the window`);
  }

  if (problems.length > 0) {
    console.error('\nLIVE-BROADCAST E2E FAILED:');
    for (const p of problems) {
      console.error(`  - ${p}`);
    }
    return 1;
  }

  console.log(
    `\nLIVE-BROADCAST E2E PASSED (${beaconType}): broadcast + confirmed a real aggregate beacon tx.\n` +
      `  txid     : ${txid}\n` +
      `  signal   : ${bytesToHex(signalBytes)} (in the tx OP_RETURN)\n` +
      `  explorer : ${netConfig.explorerTxUrl(txid)}`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
