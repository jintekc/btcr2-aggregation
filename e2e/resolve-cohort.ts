import { pathToFileURL } from 'node:url';
import { canonicalHash } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import { p2tr } from '@scure/btc-signer';
import { BitcoinConnection } from '@did-btcr2/bitcoin';
import { createParticipant } from '@btcr2-aggregation/participant';
import {
  createService,
  deriveCohortBeaconAddress,
  MemoryArtifactStore,
  resolveBtcr2,
} from '@btcr2-aggregation/service';
import {
  bakedExternalIdentityFromKeys,
  buildCohortConfig,
  buildSingletonRegistrationTx,
  createExternalIdentity,
  createIdentity,
  genesisP2trBeaconAddress,
  MIN_REGISTRATION_FUNDING_SATS,
  NETWORK,
  resolveNetwork,
  updateHashBytes,
  type BeaconType,
  type Identity,
  type IdType,
  type NetworkConfig,
} from '@btcr2-aggregation/shared';
import { startRegtestStack, type RegtestStack } from './lib/regtest.js';

/**
 * M3d resolve round-trip - the milestone Definition of Done.
 *
 * Runs a real fixture cohort (CAS and SMT), persists its off-chain artifacts into a
 * content-addressed store under the exact hex keys a did:btcr2 resolver requests,
 * then drives the real `resolveBtcr2` server-side driver to reconstruct a
 * participant's DID document and asserts it contains the appended
 * CASBeacon / SMTBeacon service.
 *
 * WHY DISCOVERY GOES THROUGH THE GENESIS SINGLETON BEACON (the key M3d finding).
 * A KEY DID's deterministic genesis document contains only the participant's own
 * SingletonBeacons (at their key's p2pkh/p2wpkh/p2tr addresses); it does NOT contain
 * the cohort's aggregate CAS/SMT beacon. The aggregate beacon is ADDED by the very
 * update we want to resolve, and its on-chain signal lives at the cohort beacon
 * address. A resolver only queries beacon addresses already in the document, so it
 * NEVER queries the aggregate address for a first update: the aggregate-announced
 * first update is undiscoverable (a chicken-and-egg the earlier "one on-chain hop"
 * assumption missed - proven false here). The faithful, spec-compliant way to make a
 * did:btcr2 controller's FIRST update discoverable is to publish it through a beacon
 * that IS in the genesis document: a SingletonBeacon signal (OP_RETURN =
 * sha256(canonical signed update)) at one of the controller's own genesis addresses.
 * That first update adds the aggregate beacon; subsequent updates ride it. This e2e
 * models exactly that: it places the participant's real, persisted signed update's
 * hash at their genesis P2TR SingletonBeacon on a mock chain, and the resolver
 * fetches the real signed update from the store and applies it - reconstructing the
 * appended aggregate beacon service. The cohort's aggregate beacon tx (built and,
 * under LIVE, broadcast) is what enables the controller's later aggregated updates.
 *
 * Hermetic by default (a mock esplora, no chain) so it runs in the gate. The
 * `LIVE=1` variant is the M3-PLAN definition of done: it broadcasts REAL beacon
 * transactions and resolves over real esplora, for both beacon types and both
 * onboarding models (KEY with its ADR 0008 registration tx; BAKED per ADR 0012
 * with none). On regtest (the default, and the CI leg - see ADR 0013) the run is
 * fully self-contained: e2e/lib/regtest.ts boots a throwaway bitcoind +
 * esplora-electrs, funds every address from its mining wallet, and auto-mines.
 * `LIVE_NETWORK=mutinynet` keeps the operator in the funding loop (manual leg).
 */

/** Reject if `p` does not settle within `ms` (the timeout does not keep Node alive). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref();
    p.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))); },
    );
  });
}

/** Minimal harvested-cohort view the resolve round-trip reads. */
interface HarvestedCohort {
  beaconAddress: string;
  signalBytes?: Uint8Array;
  pendingUpdates: Map<string, Record<string, unknown>>;
}

/** A resolved DID document, reduced to the service array the assertion inspects. */
interface ResolvedDoc {
  service?: Array<{ id: string; type: string; serviceEndpoint: string | string[] }>;
}

/**
 * A mock esplora that reports a single OP_RETURN beacon signal for each address in
 * `signalsByAddress` (hex value -> the 32-byte OP_RETURN payload) and nothing for
 * any other address. Shaped exactly like the fields `BeaconSignalDiscovery.indexer`
 * reads: `rest.block.count()` and `rest.address.getTxs(addr)` with a trailing
 * `OP_RETURN OP_PUSHBYTES_32 <hash>` vout. Everything else is absent because the
 * indexer never touches it.
 */
function mockResolveChain(signalsByAddress: Map<string, string>): BitcoinConnection {
  const conn = {
    rest: {
      block: { count: async () => 200 },
      address: {
        getTxs: async (addr: string) => {
          const signalHex = signalsByAddress.get(addr);
          if (!signalHex) {
            return [];
          }
          return [
            {
              txid: 'aa'.repeat(32),
              version: 2,
              locktime: 0,
              vin: [],
              vout: [
                {
                  scriptpubkey: `6a20${signalHex}`,
                  scriptpubkey_asm: `OP_RETURN OP_PUSHBYTES_32 ${signalHex}`,
                  scriptpubkey_type: 'op_return',
                  value: 0,
                },
              ],
              size: 0,
              weight: 0,
              fee: 0,
              status: { confirmed: true, block_height: 150, block_hash: '00'.repeat(32), block_time: 1_700_000_000 },
            },
          ];
        },
      },
    },
  };
  return conn as unknown as BitcoinConnection;
}

/** The participant's genesis P2TR SingletonBeacon address (BeaconUtils' p2tr branch). */
function genesisP2trAddress(identity: Identity): string {
  const network = resolveNetwork(NETWORK).scureNetwork;
  const xOnly = identity.keys.publicKey.compressed.slice(1, 33);
  return p2tr(xOnly, undefined, network).address;
}

/** Poll until `store` holds `count` `update` entries, or reject after `timeoutMs`. */
async function waitForUpdates(store: MemoryArtifactStore, count: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await store.entries('update')).length >= count) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`store did not reach ${count} update entries within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Drive one hermetic resolve round-trip of `beaconType` (KEY or EXTERNAL); return any problems. */
async function runResolveCohort(
  beaconType: BeaconType,
  quiet: boolean,
  idType: IdType = 'KEY',
): Promise<string[]> {
  const n = 2;
  const log = quiet ? () => {} : (msg: string) => console.log(msg);
  const slug = beaconType === 'SMTBeacon' ? 'smt' : 'cas';
  const store = new MemoryArtifactStore();

  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(n, beaconType),
    store,
  });
  let cohortId = '';
  service.runner.on('signing-complete', (result) => { cohortId = result.cohortId; });

  const { baseUrl } = await service.start(0);
  // KEY (k1) participants resolve from their deterministic genesis; EXTERNAL (x1)
  // participants carry a self-verifying genesis document (createExternalIdentity),
  // supplied to the resolver out-of-band via the sidecar below (NeedGenesisDocument).
  const identities: Identity[] = Array.from({ length: n }, () =>
    idType === 'EXTERNAL' ? createExternalIdentity() : createIdentity(),
  );
  const participants = identities.map((identity) => createParticipant({ identity, baseUrl, beaconType }));
  const complete = participants.map(
    (p) => new Promise<void>((resolve) => p.runner.on('cohort-complete', () => resolve())),
  );

  try {
    await Promise.all(participants.map((p) => p.start()));
    await withTimeout(service.runner.run(), 30_000, `${beaconType} aggregation run`);
    await withTimeout(Promise.all(complete), 15_000, 'participant completion');
    if (!cohortId) {
      return ['no cohortId captured from signing-complete'];
    }
    const cohort = service.runner.session.getCohort(cohortId) as unknown as HarvestedCohort | undefined;
    if (!cohort) {
      return [`cohort ${cohortId} not found via runner.session.getCohort`];
    }
    // createService persists artifacts fire-and-forget on signing-complete; wait.
    await waitForUpdates(store, n, 5_000);

    // Resolve the FIRST cohort member. Its signed update (which adds the aggregate
    // beacon) is anchored to its genesis document, so it is discoverable only at a
    // beacon already in that document. Publish it at the member's genesis P2TR
    // SingletonBeacon: OP_RETURN = the update's hex canonical hash (the exact store
    // key), which the resolver fetches from the store and applies.
    const did = [...cohort.pendingUpdates.keys()][0];
    const identity = identities.find((i) => i.did === did);
    if (!identity) {
      return [`resolved did ${did} has no matching participant identity`];
    }
    const update = cohort.pendingUpdates.get(did)!;
    const updateHashHex = canonicalHash(update, { encoding: 'hex' });
    // Both onboarding models publish the first update through a SingletonBeacon at the
    // controller's genesis P2TR address: for k1 it is one of the deterministic genesis
    // beacons; for x1 it is the one declared in the (sidecar-supplied) genesis document
    // - and buildExternalGenesis puts it at this exact key-derived address.
    const genesisBeaconAddr = genesisP2trAddress(identity);
    const chain = mockResolveChain(new Map([[genesisBeaconAddr, updateHashHex]]));

    // EXTERNAL resolution needs the genesis document out-of-band (the DID is only a
    // hash commitment to it); the controller supplies it in the sidecar. KEY resolution
    // needs no sidecar (the genesis is deterministic from the DID string).
    const sidecar = identity.genesisDocument
      ? { genesisDocument: identity.genesisDocument }
      : undefined;
    const { didDocument, metadata } = await resolveBtcr2(did, { bitcoin: chain, store, sidecar });
    const doc = didDocument as unknown as ResolvedDoc;
    const services = doc.service ?? [];

    const problems: string[] = [];
    const beacon = services.find((s) => s.id === `${did}#beacon-${slug}`);
    if (!beacon) {
      problems.push(
        `resolved document does not contain the appended ${beaconType} service ` +
          `${did}#beacon-${slug}; services=[${services.map((s) => `${s.id.split('#')[1]}:${s.type}`).join(', ')}]`,
      );
    } else {
      if (beacon.type !== beaconType) {
        problems.push(`appended beacon has type ${beacon.type}, expected ${beaconType}`);
      }
      const endpoint = Array.isArray(beacon.serviceEndpoint) ? beacon.serviceEndpoint[0] : beacon.serviceEndpoint;
      if (endpoint !== `bitcoin:${cohort.beaconAddress}`) {
        problems.push(
          `appended beacon serviceEndpoint ${endpoint} != the real cohort beacon ` +
            `bitcoin:${cohort.beaconAddress}`,
        );
      }
    }
    if (problems.length === 0) {
      log(
        `[ok] ${idType} ${beaconType}: resolved ${did} (version ${metadata.versionId}) -> document ` +
          `contains the appended ${beaconType} at bitcoin:${cohort.beaconAddress}, reconstructed from ` +
          `the persisted store${sidecar ? ' + sidecar genesis' : ''}`,
      );
    }
    return problems;
  } finally {
    for (const p of participants) {
      p.stop();
    }
    await service.stop();
  }
}

/* -------------------------------------------------------------------------- */
/* LIVE=1 variant: real broadcasts + real esplora resolution (M3-PLAN DoD).    */
/* -------------------------------------------------------------------------- */

/**
 * How a live leg gets addresses funded and confirmations mined. On regtest the
 * harness IS the faucet and the miner (fully automated - the CI path); on an
 * operator network (mutinynet manual runs) funding is a printed prompt + an
 * esplora poll and confirmations ride real blocks.
 */
interface LiveOps {
  /**
   * Fund `address` with `sats` (confirmed + esplora-visible); resolves to the
   * SET of txids the live tx builder could legitimately spend from the address.
   * A set, not one txid: the builder spends the DEEPEST confirmed UTXO above
   * dust (ADR 0010), which on an operator-funded address with prior history is
   * not necessarily the payment that satisfied this fund() call.
   */
  fund(address: string, sats: number): Promise<Set<string>>;
  confirmPollIntervalMs: number;
  confirmTimeoutMs: number;
}

/** Esplora transaction subset the on-chain assertions read. */
interface EsploraTx {
  vin: Array<{ txid: string }>;
  vout: Array<{ scriptpubkey: string }>;
  status: { confirmed: boolean };
}

/** Esplora `GET /address/:addr/utxo` entry subset the registration leg reads. */
interface EsploraAddressUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

/** Sats pre-funded to each cohort beacon address (well above the live-path floor). */
const LIVE_FUND_SATS = Number(process.env.FUND_SATS ?? 100_000);
/** Sats pre-funded to a KEY member's genesis P2TR for its registration tx. */
const REGISTRATION_FUND_SATS = 10_000;
/** Longest a manual (non-regtest) leg waits for operator funding. */
const FUND_TIMEOUT_MS = Number(process.env.FUND_TIMEOUT_MS ?? 1_800_000);

/** Poll esplora until `txid` confirms, or reject after `timeoutMs`. */
async function waitForConfirmed(
  chain: BitcoinConnection,
  txid: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await chain.rest.transaction.isConfirmed(txid).catch(() => false)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`tx ${txid} did not confirm within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Above-dust threshold for spendable-UTXO eligibility (the builder's floor). */
const SPENDABLE_DUST_SATS = 546;

/** Operator-funded `LiveOps.fund`: print the address, poll for a confirmed UTXO. */
async function manualFund(chain: BitcoinConnection, address: string, sats: number): Promise<Set<string>> {
  console.log(`\n[live] FUND ${address} with >= ${sats} sats (waiting up to ${FUND_TIMEOUT_MS / 60_000}min)`);
  const deadline = Date.now() + FUND_TIMEOUT_MS;
  for (;;) {
    const utxos = (await chain.rest.address.getUtxos(address).catch(() => [])) as EsploraAddressUtxo[];
    if (utxos.some((u) => u.status.confirmed && u.value >= sats)) {
      // Every confirmed above-dust UTXO is a legitimate builder input (it spends
      // the DEEPEST one, e.g. an earlier small test payment), so all their txids
      // count as "funded" for the vin assertion.
      const eligible = utxos.filter((u) => u.status.confirmed && u.value > SPENDABLE_DUST_SATS);
      if (eligible.length > 1) {
        console.log(
          `[live] note: ${eligible.length} eligible UTXOs at ${address}; the builder spends the ` +
            'deepest one, and one below the live funding floor would abort the run',
        );
      }
      console.log(`[live] funded: ${eligible.map((u) => u.txid).join(', ')}`);
      return new Set(eligible.map((u) => u.txid));
    }
    if (Date.now() > deadline) {
      throw new Error(`address ${address} was not funded with ${sats} confirmed sats in time`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

/**
 * One REAL live round-trip of (`beaconType`, `model`): pre-fund the pre-derived
 * cohort beacon address, run the cohort with `live + broadcast` so the service
 * builds, co-signs, and broadcasts the aggregate beacon tx spending it, then
 * resolve a member over the real HTTP `GET /resolve/:did` route against the same
 * live connection - asserting both the on-chain transaction (real prevout, real
 * OP_RETURN signal, confirmed) and the reconstructed document.
 *
 * Model semantics (the "both onboarding models" of the DoD):
 * - `KEY`: the first update is undiscoverable at the aggregate beacon (ADR 0007),
 *   so the member funds its genesis P2TR and broadcasts the ADR 0008 singleton
 *   registration tx (`buildSingletonRegistrationTx`, first Node end-to-end use).
 *   BOTH txs then exist on-chain; method@0.51.0 resolves the duplicate cleanly
 *   (round 1 applies the update from the singleton signal, round 2 confirms the
 *   aggregate copy as a byte-identical duplicate) - but the duplicate still
 *   increments the resolver's version counter, so versionId reads 2 or 3
 *   depending on rounds, and the DID must stay first-update-terminal (a later
 *   genuine update would trip LATE_PUBLISHING against the inflated counter).
 *   Content, not the counter, is asserted.
 * - `BAKED`: the aggregate beacon is IN the genesis (ADR 0012), so the single
 *   beacon tx is the only on-chain artifact and the first update resolves at the
 *   aggregate beacon with no registration tx - versionId is exactly 2.
 *
 * The cohort beacon address is pre-derived from the roster for BOTH models
 * (`deriveCohortBeaconAddress` is pure; a KEY member's cohort key IS its DID key
 * per ADR 0006), so funding happens before the run - no mid-run funding race and
 * no operator, which is what makes the regtest gate automatable at all.
 */
async function runLiveResolveCohort(
  beaconType: BeaconType,
  model: 'KEY' | 'BAKED',
  net: NetworkConfig,
  chain: BitcoinConnection,
  ops: LiveOps,
  quiet: boolean,
): Promise<string[]> {
  const n = 2;
  const log = quiet ? () => {} : (msg: string) => console.log(msg);
  const slug = beaconType === 'SMTBeacon' ? 'smt' : 'cas';
  const problems: string[] = [];
  const store = new MemoryArtifactStore();

  const config = { ...buildCohortConfig(n, beaconType, net.name), maxParticipants: n };
  let identities: Identity[];
  if (model === 'BAKED') {
    const roster = Array.from({ length: n }, () => SchnorrKeyPair.generate());
    const rosterAddr = deriveCohortBeaconAddress(config, roster.map((k) => k.publicKey.compressed));
    identities = roster.map((keys) => bakedExternalIdentityFromKeys(keys, rosterAddr, beaconType, net));
  } else {
    identities = Array.from({ length: n }, () => createIdentity(net));
  }
  const rosterPks = identities.map((i) => i.keys.publicKey.compressed);
  const beaconAddress = deriveCohortBeaconAddress(config, rosterPks);
  const fundTxids = await ops.fund(beaconAddress, LIVE_FUND_SATS);

  const service = createService({
    identity: createIdentity(net),
    config,
    store,
    bitcoin: chain,
    live: true,
    broadcast: true,
    rosterPks,
    confirmPollIntervalMs: ops.confirmPollIntervalMs,
    confirmTimeoutMs: ops.confirmTimeoutMs,
  });
  let cohortId = '';
  service.runner.on('signing-complete', (result) => { cohortId = result.cohortId; });
  const anchored = new Promise<{ txid: string; confirmed: boolean }>((resolve, reject) => {
    service.broadcaster!.on('beacon-anchored', (event) => resolve(event));
    service.broadcaster!.on('beacon-broadcast-failed', ({ reason }) =>
      reject(new Error(`beacon broadcast failed: ${reason}`)));
  });
  // The rejection is consumed by the withTimeout await below; this pre-attached
  // no-op handler keeps an EARLY broadcast failure (which fires during
  // runner.run(), long before that await) - or one after an early return - from
  // crashing the process as an unhandled rejection and skipping teardown.
  anchored.catch(() => {});

  const { baseUrl } = await service.start(0);
  const participants = identities.map((identity) => createParticipant({ identity, baseUrl, beaconType }));
  const complete = participants.map(
    (p) => new Promise<void>((resolve) => p.runner.on('cohort-complete', () => resolve())),
  );

  try {
    await Promise.all(participants.map((p) => p.start()));
    await withTimeout(service.runner.run(), 120_000, `live ${model} ${beaconType} aggregation run`);
    await withTimeout(Promise.all(complete), 30_000, 'live participant completion');
    if (!cohortId) {
      return ['no cohortId captured from signing-complete'];
    }
    const cohort = service.runner.session.getCohort(cohortId) as unknown as HarvestedCohort | undefined;
    if (!cohort) {
      return [`cohort ${cohortId} not found via runner.session.getCohort`];
    }
    // PARITY: the address the harness funded is the address the cohort announced.
    if (cohort.beaconAddress !== beaconAddress) {
      problems.push(`announced beacon address ${cohort.beaconAddress} != pre-derived/funded ${beaconAddress}`);
    }
    if (!cohort.signalBytes) {
      return [...problems, 'cohort has no signalBytes'];
    }
    const { txid: beaconTxid, confirmed } = await withTimeout(
      anchored, ops.confirmTimeoutMs + 30_000, 'beacon-anchored event',
    );
    if (!confirmed) {
      problems.push(`beacon tx ${beaconTxid} was broadcast but did not confirm in-window`);
    }
    await waitForUpdates(store, n, 10_000);

    // ON-CHAIN, PATH-UNIQUE assertions (the anti-false-green rule): the broadcast
    // tx must spend a UTXO this leg actually funded (never the all-zero fixture
    // prevout) and its last vout must carry the cohort's real 32-byte signal.
    const beaconTx = (await chain.rest.transaction.get(beaconTxid)) as unknown as EsploraTx;
    const expectedOpReturn = `6a20${bytesToHex(cohort.signalBytes)}`;
    if (beaconTx.vout[beaconTx.vout.length - 1]?.scriptpubkey !== expectedOpReturn) {
      problems.push(
        `beacon tx ${beaconTxid} last vout is not the cohort signal ${expectedOpReturn} ` +
          `(vouts: ${beaconTx.vout.map((v) => v.scriptpubkey).join(', ')})`,
      );
    }
    if (!beaconTx.vin.some((v) => fundTxids.has(v.txid))) {
      problems.push(
        `beacon tx ${beaconTxid} does not spend a funded UTXO (${[...fundTxids].join(', ')}) ` +
          `(vins: ${beaconTx.vin.map((v) => v.txid).join(', ')})`,
      );
    }
    // Confirmation via a read INDEPENDENT of the code path under test: the
    // `beacon-anchored` flag above is produced by the app's own isConfirmed
    // polling, so it alone cannot prove that polling is honest.
    if (!beaconTx.status.confirmed) {
      problems.push(`beacon tx ${beaconTxid} is not confirmed per the direct esplora read`);
    }

    // Resolve the first cohort member end to end over the REAL HTTP route,
    // against the same injected live connection the service broadcast through.
    const did = [...cohort.pendingUpdates.keys()][0];
    const identity = identities.find((i) => i.did === did);
    if (!identity) {
      return [...problems, `resolved did ${did} has no matching participant identity`];
    }
    if (model === 'KEY') {
      // ADR 0008 self-bootstrap: fund the genesis P2TR, broadcast the singleton
      // registration tx carrying the update hash, and let it confirm.
      const update = cohort.pendingUpdates.get(did)!;
      const genesisAddr = genesisP2trBeaconAddress(identity.keys, net);
      await ops.fund(genesisAddr, REGISTRATION_FUND_SATS);
      const utxos = (await chain.rest.address.getUtxos(genesisAddr)) as unknown as EsploraAddressUtxo[];
      const utxo = utxos
        .filter((u) => u.status.confirmed && BigInt(u.value) >= MIN_REGISTRATION_FUNDING_SATS)
        .sort((a, b) => b.value - a.value)[0];
      if (!utxo) {
        return [...problems, `no confirmed spendable UTXO at the genesis beacon ${genesisAddr}`];
      }
      const registration = buildSingletonRegistrationTx({
        keys: identity.keys,
        utxo: { txid: utxo.txid, vout: utxo.vout, value: utxo.value },
        updateHash: updateHashBytes(update),
        network: net,
      });
      await chain.rest.transaction.send(registration.rawHex);
      await waitForConfirmed(chain, registration.txid, ops.confirmTimeoutMs, ops.confirmPollIntervalMs);
      log(`[live] ${model} ${beaconType}: registration tx ${registration.txid} confirmed at ${genesisAddr}`);
    }

    const res = await fetch(`${baseUrl}/resolve/${did}`);
    const body = (await res.json()) as {
      didDocument?: ResolvedDoc;
      didDocumentMetadata?: { versionId?: unknown };
      error?: string;
    };
    if (res.status !== 200) {
      problems.push(`GET /resolve/${did} returned ${res.status} (${body.error ?? 'no error body'})`);
      return problems;
    }
    const services = body.didDocument?.service ?? [];
    const beacon = services.find((s) => s.id === `${did}#beacon-${slug}`);
    if (!beacon || beacon.type !== beaconType) {
      problems.push(
        `resolved document lacks the ${beaconType} service ${did}#beacon-${slug}; ` +
          `services=[${services.map((s) => `${s.id.split('#')[1]}:${s.type}`).join(', ')}]`,
      );
    } else {
      const endpoint = Array.isArray(beacon.serviceEndpoint) ? beacon.serviceEndpoint[0] : beacon.serviceEndpoint;
      if (endpoint !== `bitcoin:${beaconAddress}`) {
        problems.push(`beacon serviceEndpoint ${endpoint} != the real funded cohort beacon bitcoin:${beaconAddress}`);
      }
    }
    // versionId: BAKED sees ONE signal -> exactly 2. KEY sees the same first
    // update at BOTH beacons; method@0.51.0 confirms the duplicate instead of
    // erroring but still increments its counter. On regtest both signals are
    // deterministically confirmed + indexed before this resolve (the leg waited
    // on each), so the round-2 duplicate confirmation MUST be observed: exactly
    // 3. On operator networks indexing lag makes 2 or 3 both faithful.
    const versionId = String(body.didDocumentMetadata?.versionId);
    const acceptable =
      model === 'KEY' ? (net.name === 'regtest' ? ['3'] : ['2', '3']) : ['2'];
    if (!acceptable.includes(versionId)) {
      problems.push(`resolved ${did} at versionId ${versionId}, expected ${acceptable.join(' or ')}`);
    }

    if (problems.length === 0) {
      log(
        `[ok] live ${model} ${beaconType}: beacon tx ${beaconTxid} confirmed on ${net.name} spending ` +
          `${[...fundTxids].join(', ')} with the real signal; GET /resolve/${did} reconstructed the ` +
          `document with the ${beaconType} at bitcoin:${beaconAddress} (versionId ${versionId})`,
      );
    }
    return problems;
  } finally {
    for (const p of participants) {
      p.stop();
    }
    await service.stop();
  }
}

/**
 * The LIVE=1 driver: regtest (default) is fully self-contained - the harness
 * boots a throwaway bitcoind + esplora-electrs, funds every address from its
 * mining wallet, and auto-mines so the app's own confirmation polling is
 * exercised against real blocks. Any other test network (LIVE_NETWORK=mutinynet
 * being the documented manual leg) keeps the operator in the funding loop.
 * mainnet is refused outright: this leg mints throwaway keys and burns fees.
 */
async function runLiveResolve(quiet: boolean): Promise<string[]> {
  const netName = process.env.LIVE_NETWORK ?? 'regtest';
  const envHost = process.env.ESPLORA_HOST;
  const base = resolveNetwork(netName, envHost);
  if (base.isMainnet) {
    throw new Error(
      'the live resolve leg refuses mainnet: it generates throwaway keys and burns real sats. ' +
        'See docs/adr/0010-mainnet-guard-rails.md.',
    );
  }
  let stack: RegtestStack | undefined;
  let net = base;
  let ops: LiveOps;
  if (netName === 'regtest' && envHost === undefined) {
    stack = await startRegtestStack({ quiet });
    const { fund } = stack;
    net = resolveNetwork('regtest', stack.esploraHost);
    stack.startAutoMine(1500);
    // Fresh keys every leg -> the funded payment is the address's only UTXO.
    ops = {
      fund: async (address, sats) => new Set([await fund(address, sats)]),
      confirmPollIntervalMs: 500,
      confirmTimeoutMs: 60_000,
    };
  } else {
    const pollChain = new BitcoinConnection({ network: net.name, rest: { host: net.esploraHost } });
    ops = {
      fund: (address, sats) => manualFund(pollChain, address, sats),
      confirmPollIntervalMs: 10_000,
      confirmTimeoutMs: Number(process.env.CONFIRM_TIMEOUT_MS ?? 600_000),
    };
  }
  const chain = new BitcoinConnection({ network: net.name, rest: { host: net.esploraHost } });
  const problems: string[] = [];
  try {
    for (const model of ['KEY', 'BAKED'] as const) {
      for (const beaconType of ['CASBeacon', 'SMTBeacon'] as const) {
        const legProblems = await runLiveResolveCohort(beaconType, model, net, chain, ops, quiet);
        problems.push(...legProblems.map((p) => `live ${model} ${beaconType}: ${p}`));
      }
    }
  } finally {
    await stack?.stop();
  }
  return problems;
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  // Both onboarding models x both beacon types. The x1 runs prove the ADR-0007 prize
  // now reachable end to end (ADR 066): an EXTERNAL controller co-signs, its update
  // lands in the real CAS/SMT announcement, and it resolves via its sidecar genesis.
  const casK1 = await runResolveCohort('CASBeacon', quiet, 'KEY');
  const smtK1 = await runResolveCohort('SMTBeacon', quiet, 'KEY');
  const casX1 = await runResolveCohort('CASBeacon', quiet, 'EXTERNAL');
  const smtX1 = await runResolveCohort('SMTBeacon', quiet, 'EXTERNAL');
  const problems = [
    ...casK1.map((p) => `k1 CAS: ${p}`),
    ...smtK1.map((p) => `k1 SMT: ${p}`),
    ...casX1.map((p) => `x1 CAS: ${p}`),
    ...smtX1.map((p) => `x1 SMT: ${p}`),
  ];

  const live = process.env.LIVE === '1';
  if (live) {
    problems.push(...(await runLiveResolve(quiet)));
  }

  if (problems.length > 0) {
    console.error('\nRESOLVE E2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nRESOLVE E2E PASSED: real CAS and SMT cohorts - for both KEY (k1) and EXTERNAL (x1) ' +
      'controllers - persisted their artifacts, and resolveBtcr2 reconstructed each ' +
      "participant's DID document (containing the appended aggregate beacon service) from the " +
      'persisted store (x1 via its sidecar genesis), driven server-side over a mock chain (no live network).' +
      (live
        ? '\nLIVE legs PASSED: KEY and BAKED cohorts (CAS and SMT) broadcast real, confirmed beacon ' +
          'txs spending the pre-funded UTXOs, KEY additionally anchored its singleton registration ' +
          'tx, and every leg resolved over the real HTTP GET /resolve/:did against live esplora.'
        : ''),
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
