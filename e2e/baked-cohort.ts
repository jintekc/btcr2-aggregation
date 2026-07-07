import { pathToFileURL } from 'node:url';
import { canonicalHash } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bytesToHex } from '@noble/hashes/utils';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { createParticipant } from '@btcr2-aggregation/participant';
import {
  createService,
  deriveCohortBeaconAddress,
  MemoryArtifactStore,
  type ArtifactKind,
} from '@btcr2-aggregation/service';
import {
  bakedExternalIdentityFromKeys,
  buildCohortConfig,
  createExternalIdentity,
  createIdentity,
  genesisP2trBeaconAddress,
  type BeaconType,
} from '@btcr2-aggregation/shared';

/**
 * M3f BAKED-GENESIS round-trip (ADR 0012): the EXTERNAL-genesis-baked onboarding
 * model plus the coordinator's genesis store, end to end over real HTTP.
 *
 * The pre-provisioning story this proves: an operator fixes a cohort ROSTER (keys
 * only - no DIDs exist yet), derives the cohort's aggregate beacon address from
 * those keys (`deriveCohortBeaconAddress`, a pure function - MuSig2 key aggregation
 * is non-interactive), bakes that address into each member's x1 genesis, mints the
 * DIDs, and only then runs the cohort. Because the aggregate beacon is IN the
 * genesis, the resolver queries it on its FIRST discovery round: the member's first
 * aggregated update is discoverable with no singleton registration transaction,
 * eliminating the ADR 0007 chicken-and-egg for pre-provisioned cohorts.
 *
 * The genesis store half: each accepted member's baked genesis is persisted by the
 * coordinator (staged at bootstrap-auth, promoted at `participant-accepted`), so
 * the member's x1 DID resolves via a plain sidecar-less `GET /resolve/:did` - the
 * first time an x1 DID resolves over GET at all.
 *
 * Guard rails proven here, straight from the design skeptics:
 *   - PARITY: the cohort's announced beacon address must equal the pre-derived one.
 *   - ROSTER: an interloper's opt-in is rejected (`rosterPks` + `maxParticipants`),
 *     so the seated key set cannot drift from the address commitment.
 *   - DECLINE, NOT STALL: a baked identity seated in a cohort that does not match
 *     its baked beacon declines (cooperative non-inclusion) and the cohort still
 *     completes for everyone else.
 *   - PRIVACY LINE: a CLASSIC x1 member's genesis (which maps its DID to a personal
 *     funding address) is NOT auto-persisted; only baked-shape geneses are.
 *   - Non-member negatives differ by beacon type: a stranger baked at the same CAS
 *     address resolves (via POST + sidecar) to version 1 (its DID is absent from
 *     the announcement, the signal is skipped); at an SMT address it fails closed
 *     (no proof for its leaf exists, so resolution 502s).
 *
 * Hermetic: a mock esplora serves the aggregate beacon signal; no chain, no keys
 * of value. Runs in the gate as `pnpm e2e:baked`.
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

/** Minimal harvested-cohort view this round-trip reads. */
interface HarvestedCohort {
  beaconAddress: string;
  signalBytes?: Uint8Array;
  participants: string[];
  pendingUpdates: Map<string, Record<string, unknown>>;
}

/** A resolved DID document, reduced to the service array the assertions inspect. */
interface ResolvedDoc {
  service?: Array<{ id: string; type: string; serviceEndpoint: string | string[] }>;
}

/** The `/resolve/:did` HTTP response body shape. */
interface ResolveResponse {
  didDocument?: ResolvedDoc;
  didDocumentMetadata?: { versionId?: unknown };
  error?: string;
}

/**
 * A mock esplora reporting one OP_RETURN signal per address in `signalsByAddress`
 * (populated AFTER the cohort completes - the Map is shared by reference) and
 * nothing elsewhere. Shaped exactly like the fields `BeaconSignalDiscovery.indexer`
 * reads. Injected into `createService` so the real HTTP `GET /resolve/:did` route
 * drives discovery against it.
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

/** Poll until `store` holds `count` entries of `kind`, or reject after `timeoutMs`. */
async function waitForKind(
  store: MemoryArtifactStore,
  kind: ArtifactKind,
  count: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await store.entries(kind)).length >= count) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`store did not reach ${count} '${kind}' entries within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** GET/POST `/resolve/:did`; returns the HTTP status and parsed body. */
async function httpResolve(
  baseUrl: string,
  did: string,
  genesisDocument?: Record<string, unknown>,
): Promise<{ status: number; body: ResolveResponse }> {
  const res = genesisDocument
    ? await fetch(`${baseUrl}/resolve/${did}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ genesisDocument }),
      })
    : await fetch(`${baseUrl}/resolve/${did}`);
  return { status: res.status, body: (await res.json()) as ResolveResponse };
}

/**
 * The main leg: a pre-provisioned, fixed-roster baked cohort of `beaconType`.
 * Returns any problems (empty = pass).
 */
async function runBakedCohort(beaconType: BeaconType, quiet: boolean): Promise<string[]> {
  const n = 2;
  const log = quiet ? () => {} : (msg: string) => console.log(msg);
  const slug = beaconType === 'SMTBeacon' ? 'smt' : 'cas';
  const problems: string[] = [];
  const store = new MemoryArtifactStore();

  // 1. Fix the roster (keys only; no DIDs exist yet) and the cohort config, then
  //    derive the aggregate beacon address from the roster + config alone.
  //    maxParticipants pins the ceiling so the address commitment cannot drift.
  const roster = Array.from({ length: n }, () => SchnorrKeyPair.generate());
  const rosterPks = roster.map((k) => k.publicKey.compressed);
  const config = { ...buildCohortConfig(n, beaconType), maxParticipants: n };
  const beaconAddress = deriveCohortBeaconAddress(config, rosterPks);

  // 2. Bake the address into each member's genesis and mint the x1 DIDs.
  const identities = roster.map((keys) => bakedExternalIdentityFromKeys(keys, beaconAddress, beaconType));

  // 3. The signal map is populated after the cohort completes (shared reference).
  const signals = new Map<string, string>();
  const service = createService({
    identity: createIdentity(),
    config,
    store,
    bitcoin: mockResolveChain(signals),
    rosterPks,
  });
  let cohortId = '';
  service.runner.on('signing-complete', (result) => { cohortId = result.cohortId; });
  // Track accepted DIDs deterministically (not via a race-and-timeout) so the
  // interloper-rejection assertion cannot false-green on seat timing.
  const acceptedDids = new Set<string>();
  service.runner.on('participant-accepted', ({ participantDid }) => acceptedDids.add(participantDid));

  const { baseUrl } = await service.start(0);

  // An interloper races the baked members for a seat. It is itself a BAKED x1
  // identity (self-consistent, so its genesis IS staged at bootstrap-auth) but its
  // key is NOT in the roster, so the gate must reject it - and because it is never
  // ACCEPTED, its staged genesis must never be promoted to the store. That double
  // duty pins BOTH the roster gate AND the staged-at-auth / promoted-at-acceptance
  // boundary (a regression that persisted at the auth seam would leak its genesis).
  const interloperIdentity = bakedExternalIdentityFromKeys(SchnorrKeyPair.generate(), beaconAddress, beaconType);
  const interloper = createParticipant({ identity: interloperIdentity, baseUrl, beaconType });
  const participants = identities.map((identity) => createParticipant({ identity, baseUrl, beaconType }));
  const complete = participants.map(
    (p) => new Promise<void>((resolve) => p.runner.on('cohort-complete', () => resolve())),
  );

  try {
    await interloper.start();
    await Promise.all(participants.map((p) => p.start()));
    await withTimeout(service.runner.run(), 30_000, `${beaconType} baked aggregation run`);
    await withTimeout(Promise.all(complete), 15_000, 'baked participant completion');
    if (!cohortId) {
      return ['no cohortId captured from signing-complete'];
    }
    const cohort = service.runner.session.getCohort(cohortId) as unknown as HarvestedCohort | undefined;
    if (!cohort) {
      return [`cohort ${cohortId} not found via runner.session.getCohort`];
    }

    // PARITY: the address the cohort actually announced must equal the pre-derived
    // one (this is the assert that makes baked genesis sound at all).
    if (cohort.beaconAddress !== beaconAddress) {
      problems.push(
        `announced beacon address ${cohort.beaconAddress} != pre-derived ${beaconAddress}`,
      );
    }
    // ROSTER: exactly the baked members seated; the interloper was rejected.
    const seated = [...cohort.participants].sort();
    const expected = identities.map((i) => i.did).sort();
    if (JSON.stringify(seated) !== JSON.stringify(expected)) {
      problems.push(`seated participants [${seated.join(', ')}] != baked roster [${expected.join(', ')}]`);
    }
    // Deterministic interloper-rejection: its DID was never accepted.
    if (acceptedDids.has(interloperIdentity.did)) {
      problems.push('interloper DID was accepted into the cohort (roster gate failed)');
    }
    // Both baked members SUBMITTED (exit-ramp fit), not declined.
    for (const p of participants) {
      if (!p.getSubmittedUpdate(cohortId)) {
        problems.push('a baked member declined its own cohort (classifyCohortFit regression)');
      }
    }

    // 4. Genesis store: each accepted member's baked genesis was persisted (staged
    //    at bootstrap-auth, promoted at participant-accepted) and is served by hash.
    await waitForKind(store, 'genesis', n, 5_000);
    await waitForKind(store, 'update', n, 5_000);
    for (const identity of identities) {
      const genesisHash = canonicalHash(identity.genesisDocument!, { encoding: 'hex' });
      const res = await fetch(`${baseUrl}/cas/genesis/${genesisHash}`);
      if (res.status !== 200) {
        problems.push(`GET /cas/genesis/${genesisHash} returned ${res.status}, expected 200`);
        continue;
      }
      const served = (await res.json()) as Record<string, unknown>;
      if (canonicalHash(served, { encoding: 'hex' }) !== genesisHash) {
        problems.push('served genesis does not hash to its own key');
      }
    }
    const unknown = await fetch(`${baseUrl}/cas/genesis/${'ab'.repeat(32)}`);
    if (unknown.status !== 404) {
      problems.push(`GET /cas/genesis/<unknown> returned ${unknown.status}, expected 404`);
    }
    // The staged-at-auth / promoted-at-acceptance boundary: EXACTLY the n accepted
    // members' geneses are persisted - not the interloper's, whose baked genesis
    // was staged at bootstrap-auth but never promoted (it was never accepted). A
    // regression that persisted from the auth seam would leak it here.
    const genesisEntries = await store.entries('genesis');
    if (genesisEntries.length !== n) {
      problems.push(`store holds ${genesisEntries.length} genesis entries, expected exactly ${n}`);
    }
    const interloperHash = canonicalHash(interloperIdentity.genesisDocument!, { encoding: 'hex' });
    if (genesisEntries.some(([key]) => key === interloperHash)) {
      problems.push('interloper genesis was persisted despite never being accepted (staging boundary leak)');
    }

    // 5. Publish the aggregate signal on the mock chain, then resolve each member
    //    over real HTTP with a plain GET: no sidecar, no body - genesis from the
    //    store, first update discovered at the BAKED aggregate beacon.
    if (!cohort.signalBytes) {
      return [...problems, 'cohort has no signalBytes to publish'];
    }
    signals.set(beaconAddress, bytesToHex(cohort.signalBytes));
    for (const identity of identities) {
      const { status, body } = await httpResolve(baseUrl, identity.did);
      if (status !== 200) {
        problems.push(`GET /resolve/${identity.did} returned ${status} (${body.error ?? 'no error body'})`);
        continue;
      }
      const services = body.didDocument?.service ?? [];
      const baked = services.find((s) => s.id === `${identity.did}#beacon-${slug}`);
      const ramp = services.find((s) => s.id === `${identity.did}#beacon-singleton`);
      if (!baked || baked.type !== beaconType) {
        problems.push(`resolved doc lacks the baked ${beaconType} service for ${identity.did}`);
      } else {
        const endpoint = Array.isArray(baked.serviceEndpoint) ? baked.serviceEndpoint[0] : baked.serviceEndpoint;
        if (endpoint !== `bitcoin:${beaconAddress}`) {
          problems.push(`baked service endpoint ${endpoint} != bitcoin:${beaconAddress}`);
        }
      }
      if (!ramp || ramp.type !== 'SingletonBeacon') {
        problems.push(`resolved doc lacks the appended #beacon-singleton exit ramp for ${identity.did}`);
      } else {
        const endpoint = Array.isArray(ramp.serviceEndpoint) ? ramp.serviceEndpoint[0] : ramp.serviceEndpoint;
        const expectedRamp = `bitcoin:${genesisP2trBeaconAddress(identity.keys)}`;
        if (endpoint !== expectedRamp) {
          problems.push(`exit-ramp endpoint ${endpoint} != ${expectedRamp}`);
        }
      }
      if (String(body.didDocumentMetadata?.versionId) !== '2') {
        problems.push(
          `resolved ${identity.did} at versionId ${String(body.didDocumentMetadata?.versionId)}, expected 2`,
        );
      }
    }

    // 6. Non-member negatives. A stranger baked at the SAME address: GET has no
    //    genesis for it (never a member) -> 502. POST supplies the genesis; the
    //    outcome differs by beacon type and both are pinned here.
    const stranger = bakedExternalIdentityFromKeys(SchnorrKeyPair.generate(), beaconAddress, beaconType);
    const strangerGet = await httpResolve(baseUrl, stranger.did);
    if (strangerGet.status !== 502) {
      problems.push(`non-member GET /resolve returned ${strangerGet.status}, expected 502`);
    }
    const strangerPost = await httpResolve(baseUrl, stranger.did, stranger.genesisDocument);
    if (beaconType === 'CASBeacon') {
      // Its DID is absent from the announcement map: the signal is skipped and the
      // genesis document itself resolves (version 1, no exit ramp appended).
      if (strangerPost.status !== 200) {
        problems.push(`non-member CAS POST /resolve returned ${strangerPost.status}, expected 200 (v1)`);
      } else {
        if (String(strangerPost.body.didDocumentMetadata?.versionId) !== '1') {
          problems.push(
            `non-member CAS resolved at versionId ${String(strangerPost.body.didDocumentMetadata?.versionId)}, expected 1`,
          );
        }
        const services = strangerPost.body.didDocument?.service ?? [];
        if (services.some((s) => s.id.endsWith('#beacon-singleton'))) {
          problems.push('non-member CAS resolution applied an update it should not have seen');
        }
      }
    } else if (strangerPost.status !== 502) {
      // SMT fails closed: the root signal demands a proof and no proof exists for
      // a non-member's leaf (inclusion or otherwise), so resolution errors.
      problems.push(`non-member SMT POST /resolve returned ${strangerPost.status}, expected 502 (fail-closed)`);
    }

    if (problems.length === 0) {
      log(
        `[ok] baked ${beaconType}: pre-derived ${beaconAddress} == announced; interloper rejected; ` +
          `${n} baked geneses persisted + served; sidecar-less GET /resolve reached versionId 2 with ` +
          'the baked beacon + #beacon-singleton exit ramp; non-member negative pinned',
      );
    }
    return problems;
  } finally {
    interloper.stop();
    for (const p of participants) {
      p.stop();
    }
    await service.stop();
  }
}

/**
 * The mismatch leg (CAS only, one extra cohort): a baked identity seated in a
 * cohort that is NOT the one it was baked for must DECLINE (cooperative
 * non-inclusion) - never throw (a throw inside onProvideUpdate submits nothing and
 * stalls the whole n-of-n round) - and the cohort must complete for everyone else.
 * Doubles as the PRIVACY pin: the classic x1 co-member's genesis (which maps its
 * DID to a personal funding address) must NOT be auto-persisted; the baked
 * (operator-authored) genesis is.
 */
async function runMismatchDecline(quiet: boolean, foreignAddress: string): Promise<string[]> {
  const log = quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const store = new MemoryArtifactStore();

  const mismatchKeys = SchnorrKeyPair.generate();
  // Baked for the FIRST leg's cohort address; this cohort's address will differ.
  const mismatchBaked = bakedExternalIdentityFromKeys(mismatchKeys, foreignAddress, 'CASBeacon');
  const classicX1 = createExternalIdentity();

  const config = { ...buildCohortConfig(2, 'CASBeacon'), maxParticipants: 2 };
  const service = createService({
    identity: createIdentity(),
    config,
    store,
    rosterPks: [mismatchKeys.publicKey.compressed, classicX1.keys.publicKey.compressed],
  });
  let cohortId = '';
  service.runner.on('signing-complete', (result) => { cohortId = result.cohortId; });

  const { baseUrl } = await service.start(0);
  const pMismatch = createParticipant({ identity: mismatchBaked, baseUrl, beaconType: 'CASBeacon' });
  const pClassic = createParticipant({ identity: classicX1, baseUrl, beaconType: 'CASBeacon' });
  const complete = [pMismatch, pClassic].map(
    (p) => new Promise<void>((resolve) => p.runner.on('cohort-complete', () => resolve())),
  );

  try {
    await Promise.all([pMismatch.start(), pClassic.start()]);
    // DECLINE, NOT STALL: the run must complete despite the mismatched member.
    await withTimeout(service.runner.run(), 30_000, 'mismatch-decline aggregation run');
    await withTimeout(Promise.all(complete), 15_000, 'mismatch-decline participant completion');
    if (!cohortId) {
      return ['no cohortId captured from signing-complete'];
    }
    const cohort = service.runner.session.getCohort(cohortId) as unknown as HarvestedCohort | undefined;
    if (!cohort) {
      return [`cohort ${cohortId} not found via runner.session.getCohort`];
    }

    if (cohort.beaconAddress === foreignAddress) {
      problems.push('test bug: this cohort derived the SAME address as the foreign one');
    }
    if (!pMismatch.getDeclineReason(cohortId)) {
      problems.push('mismatched baked member did not record a decline reason');
    }
    if (pMismatch.getSubmittedUpdate(cohortId)) {
      problems.push('mismatched baked member submitted an update (must decline)');
    }
    if (!pClassic.getSubmittedUpdate(cohortId)) {
      problems.push('classic x1 co-member did not submit its update');
    }
    if (cohort.pendingUpdates.size !== 1) {
      problems.push(`cohort has ${cohort.pendingUpdates.size} updates, expected exactly 1 (the classic x1's)`);
    }

    // PRIVACY LINE: only the baked (operator-authored) genesis is persisted; the
    // classic x1 genesis, which embeds a personal funding address, is not.
    const geneses = await store.entries('genesis');
    const mismatchHash = canonicalHash(mismatchBaked.genesisDocument!, { encoding: 'hex' });
    const classicHash = canonicalHash(classicX1.genesisDocument!, { encoding: 'hex' });
    if (!geneses.some(([key]) => key === mismatchHash)) {
      problems.push('accepted baked member genesis was not persisted');
    }
    if (geneses.some(([key]) => key === classicHash)) {
      problems.push('classic x1 member genesis WAS persisted (privacy line violated)');
    }

    if (problems.length === 0) {
      log(
        '[ok] mismatch-decline: baked-for-elsewhere member declined (cooperative non-inclusion), the ' +
          "cohort completed with the classic x1's update alone, the baked genesis was persisted and " +
          'the classic x1 genesis was not (privacy line)',
      );
    }
    return problems;
  } finally {
    pMismatch.stop();
    pClassic.stop();
    await service.stop();
  }
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  const cas = await runBakedCohort('CASBeacon', quiet);
  const smt = await runBakedCohort('SMTBeacon', quiet);
  // The mismatch leg needs a real foreign beacon address; derive one from a
  // throwaway roster + config (pure function, no cohort needed).
  const foreignConfig = { ...buildCohortConfig(2, 'CASBeacon'), maxParticipants: 2 };
  const foreignAddress = deriveCohortBeaconAddress(
    foreignConfig,
    [SchnorrKeyPair.generate(), SchnorrKeyPair.generate()].map((k) => k.publicKey.compressed),
  );
  const decline = await runMismatchDecline(quiet, foreignAddress);

  const problems = [
    ...cas.map((p) => `baked CAS: ${p}`),
    ...smt.map((p) => `baked SMT: ${p}`),
    ...decline.map((p) => `mismatch-decline: ${p}`),
  ];
  if (problems.length > 0) {
    console.error('\nBAKED E2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nBAKED E2E PASSED: fixed-roster cohorts (CAS and SMT) seated exactly their pre-derived ' +
      'rosters at the pre-derived aggregate beacon address, persisted every accepted baked genesis, ' +
      'and each member resolved to versionId 2 via a sidecar-less HTTP GET /resolve/:did (first ' +
      'update discovered at the BAKED beacon, no registration tx); interloper, mismatch-decline, ' +
      'privacy-line, and non-member negatives all pinned.',
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
