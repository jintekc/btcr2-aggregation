import { pathToFileURL } from 'node:url';
import { canonicalHash, decode, encode } from '@did-btcr2/common';
import { Resolver } from '@did-btcr2/method';
import { createParticipant } from '@btcr2-aggregation/participant';
import { createService, exportSidecar, MemoryArtifactStore } from '@btcr2-aggregation/service';
import {
  buildCohortConfig,
  createIdentity,
  type BeaconType,
  type Identity,
} from '@btcr2-aggregation/shared';

/**
 * Hermetic persist round-trip: drive a real fixture cohort (CAS and SMT) through
 * `createService` with a `MemoryArtifactStore` wired, then prove the store holds
 * each off-chain resolution artifact under the EXACT hex key a did:btcr2 resolver
 * requests, and that `exportSidecar(store) -> Resolver.sidecarData(sidecar)`
 * reproduces those keys. No Bitcoin node and no broadcast: the cohort still builds
 * the real CAS announcement / SMT tree internally, so the artifacts and their
 * on-chain `signalBytes` are real; only the beacon tx prevout is a fixture. This is
 * the connective tissue between the M3b store and real cohort data, and the
 * prerequisite for the M3d resolve round-trip.
 */

/** hex canonical hash - the resolver's updateMap/casMap key and the store key. */
const hex = (obj: Record<string, unknown>): string => canonicalHash(obj, { encoding: 'hex' });
/** Re-encode a base64urlnopad hash as hex (the cohort -> store encoding bridge). */
const hexOfB64 = (s: string): string => encode(decode(s, 'base64urlnopad'), 'hex');
/** Sorted-array equality. */
const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

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

/** A minimal structural view of an SMT proof (the e2e declares no aggregation dep). */
interface ProofView {
  id: string;
  updateId?: string;
}
/** The harvested-cohort shape the assertions read (a real AggregationCohort fits). */
interface HarvestedCohort {
  pendingUpdates: Map<string, Record<string, unknown>>;
  casAnnouncement?: Record<string, string>;
  smtProofs?: Map<string, ProofView>;
  signalBytes?: Uint8Array;
}

/** Poll until `store` holds `count` entries of `kind`, or reject after `timeoutMs`. */
async function waitForEntries(
  store: MemoryArtifactStore,
  kind: 'update' | 'announcement' | 'proof',
  count: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await store.entries(kind)).length >= count) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`store did not reach ${count} ${kind} entries within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Assert the wired store holds the cohort's artifacts under the resolver's keys. */
async function checkPersisted(
  cohort: HarvestedCohort,
  store: MemoryArtifactStore,
  beaconType: BeaconType,
): Promise<string[]> {
  const problems: string[] = [];
  const signalHex = cohort.signalBytes ? encode(cohort.signalBytes, 'hex') : '';
  const updates = [...cohort.pendingUpdates.values()];
  const expectedUpdateKeys = updates.map((u) => hex(u));

  // Signed update bodies: one per member, keyed by hex canonical hash.
  const updateKeys = (await store.entries('update')).map(([k]) => k);
  if (!sameSet(updateKeys, expectedUpdateKeys)) {
    problems.push(`update keys: expected [${[...expectedUpdateKeys].sort()}], got [${[...updateKeys].sort()}]`);
  }
  for (const u of updates) {
    if ((await store.get('update', hex(u))) === undefined) {
      problems.push(`update ${hex(u)} not retrievable`);
    }
  }

  if (beaconType === 'CASBeacon') {
    const ann = cohort.casAnnouncement;
    if (!ann) {
      problems.push('cohort.casAnnouncement is missing for a CAS cohort');
    } else {
      const annKey = hex(ann);
      // The announcement's hex canonical hash IS the on-chain signal.
      if (annKey !== signalHex) {
        problems.push(`announcement hash ${annKey} != signalBytes hex ${signalHex}`);
      }
      if (!(await store.has('announcement', annKey))) {
        problems.push('CAS announcement not persisted under its hash');
      }
      // Each CAS map base64url value decodes to one of the persisted update keys.
      for (const [did, b64hash] of Object.entries(ann)) {
        if (!expectedUpdateKeys.includes(hexOfB64(b64hash))) {
          problems.push(`CAS announcement hash for ${did} is not a persisted update key`);
        }
      }
    }
    if ((await store.entries('proof')).length > 0) {
      problems.push('a CAS cohort must not persist SMT proofs');
    }
  } else {
    const proofs = cohort.smtProofs;
    if (!proofs) {
      problems.push('cohort.smtProofs is missing for an SMT cohort');
    } else {
      for (const proof of proofs.values()) {
        // Every proof's root (proof.id) is the on-chain signal.
        if (hexOfB64(proof.id) !== signalHex) {
          problems.push(`SMT proof root ${hexOfB64(proof.id)} != signalBytes hex ${signalHex}`);
        }
        if (!proof.updateId) {
          problems.push('a fixture-cohort SMT proof unexpectedly lacks updateId');
          continue;
        }
        const key = hexOfB64(proof.updateId);
        if (!(await store.has('proof', key))) {
          problems.push(`SMT proof not persisted under its update hash ${key}`);
        }
        if (!expectedUpdateKeys.includes(key)) {
          problems.push(`SMT proof key ${key} is not a persisted update key`);
        }
      }
      const proofKeys = (await store.entries('proof')).map(([k]) => k);
      if (proofKeys.length !== cohort.pendingUpdates.size) {
        problems.push(`persisted ${proofKeys.length} proofs, expected ${cohort.pendingUpdates.size}`);
      }
    }
    if ((await store.entries('announcement')).length > 0) {
      problems.push('an SMT cohort must not persist a CAS announcement');
    }
  }

  // Full encoding bridge: exportSidecar -> the real Resolver.sidecarData.
  const data = Resolver.sidecarData(await exportSidecar(store));
  if (!sameSet([...data.updateMap.keys()], expectedUpdateKeys)) {
    problems.push('sidecarData.updateMap keys do not match the persisted update keys');
  }
  if (beaconType === 'CASBeacon') {
    if ([...data.casMap.keys()].join(',') !== signalHex) {
      problems.push(`sidecarData.casMap key != on-chain signal ${signalHex}`);
    }
    if (data.smtMap.size !== 0) {
      problems.push('sidecarData.smtMap should be empty for a CAS cohort');
    }
  } else {
    // All per-DID proofs share one root, so the root-keyed smtMap holds exactly one.
    if (data.smtMap.size !== 1 || [...data.smtMap.keys()].join(',') !== signalHex) {
      problems.push(`sidecarData.smtMap should hold one entry keyed by the root ${signalHex}`);
    }
    if (data.casMap.size !== 0) {
      problems.push('sidecarData.casMap should be empty for an SMT cohort');
    }
  }
  return problems;
}

/** Drive one fixture cohort of `beaconType` with a wired store; return any problems. */
async function runPersistCohort(beaconType: BeaconType, quiet: boolean): Promise<string[]> {
  const n = 2;
  const log = quiet ? () => {} : (msg: string) => console.log(msg);
  const store = new MemoryArtifactStore();

  const serviceIdentity = createIdentity();
  const participantIdentities: Identity[] = Array.from({ length: n }, () => createIdentity());
  const service = createService({
    identity: serviceIdentity,
    config: buildCohortConfig(n, beaconType),
    store,
  });

  let cohortId = '';
  service.runner.on('signing-complete', (result) => {
    cohortId = result.cohortId;
    log(`[service] signing-complete ${beaconType} cohort ${cohortId}`);
  });

  const { baseUrl } = await service.start(0);
  const participants = participantIdentities.map((identity) =>
    createParticipant({ identity, baseUrl, beaconType }),
  );
  const participantComplete = participants.map(
    (participant) =>
      new Promise<void>((resolve) => participant.runner.on('cohort-complete', () => resolve())),
  );

  try {
    await Promise.all(participants.map((participant) => participant.start()));
    await withTimeout(service.runner.run(), 30000, `${beaconType} aggregation run`);
    await withTimeout(Promise.all(participantComplete), 15000, 'participant completion');

    if (!cohortId) {
      return ['no cohortId captured from signing-complete'];
    }
    const cohort = service.runner.session.getCohort(cohortId) as HarvestedCohort | undefined;
    if (!cohort) {
      return [`cohort ${cohortId} not found via runner.session.getCohort`];
    }

    // The wiring persists fire-and-forget on signing-complete; wait for it to land.
    await waitForEntries(store, 'update', n, 5000);
    if (beaconType === 'CASBeacon') {
      await waitForEntries(store, 'announcement', 1, 5000);
    } else {
      await waitForEntries(store, 'proof', n, 5000);
    }

    const problems = await checkPersisted(cohort, store, beaconType);
    if (problems.length === 0) {
      const kind = beaconType === 'CASBeacon' ? 'CAS announcement' : `${n} SMT proofs`;
      log(`[ok] ${beaconType}: ${n} updates + ${kind} persisted under resolver keys; sidecar round-trips`);
    }
    return problems;
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  const cas = await runPersistCohort('CASBeacon', quiet);
  const smt = await runPersistCohort('SMTBeacon', quiet);
  const problems = [...cas.map((p) => `CAS: ${p}`), ...smt.map((p) => `SMT: ${p}`)];

  if (problems.length > 0) {
    console.error('\nPERSIST E2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nPERSIST E2E PASSED: real CAS and SMT cohorts persisted their off-chain artifacts ' +
      'into the wired store under the resolver\'s exact hex keys, and exportSidecar -> ' +
      'Resolver.sidecarData round-tripped (no chain).',
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
