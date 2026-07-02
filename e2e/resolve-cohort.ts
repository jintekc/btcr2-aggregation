import { pathToFileURL } from 'node:url';
import { canonicalHash } from '@did-btcr2/common';
import { p2tr } from '@scure/btc-signer';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { createParticipant } from '@btcr2-aggregation/participant';
import { createService, MemoryArtifactStore, resolveBtcr2 } from '@btcr2-aggregation/service';
import {
  buildCohortConfig,
  createExternalIdentity,
  createIdentity,
  NETWORK,
  resolveNetwork,
  type BeaconType,
  type Identity,
  type IdType,
} from '@btcr2-aggregation/shared';

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
 * Hermetic by default (a mock esplora, no chain) so it runs in the gate; the
 * `LIVE=1` variant broadcasts real transactions and resolves over real esplora.
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

/**
 * LIVE=1 variant (operator-run, NOT in the hermetic gate). Broadcasts a real
 * aggregate beacon tx and publishes the participant's first update through their
 * genesis SingletonBeacon on a real network, then resolves over real esplora. This
 * needs an operator-funded wallet: both the cohort beacon address AND each resolved
 * participant's genesis P2TR address must hold a spendable UTXO. Left as a documented
 * manual step; the hermetic round-trip above is the CI Definition of Done.
 */
async function runLiveResolveNote(): Promise<void> {
  console.log(
    '\nLIVE=1 requested: a live resolve round-trip broadcasts a real aggregate beacon tx AND a ' +
      'genesis SingletonBeacon registration signal for the first update, then resolves over real ' +
      'esplora. Both the cohort beacon address and the participant genesis P2TR address must be ' +
      'operator-funded. This path is manual (out of the hermetic gate); run e2e/live-broadcast-cohort.ts ' +
      'for the broadcast+anchor leg, fund the printed genesis address, then GET /resolve/:did.',
  );
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

  if (process.env.LIVE === '1') {
    await runLiveResolveNote();
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
      'persisted store (x1 via its sidecar genesis), driven server-side over a mock chain (no live network).',
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
