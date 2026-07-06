import { pathToFileURL } from 'node:url';
import { createParticipant } from '@btcr2-aggregation/participant';
import {
  createIpfsNode,
  createService,
  MemoryArtifactStore,
  type PinOutcome,
} from '@btcr2-aggregation/service';
import {
  artifactHashHex,
  buildCohortConfig,
  buildPublishPlan,
  createExternalIdentity,
  createIdentity,
} from '@btcr2-aggregation/shared';

/*
 * M3f IPFS publish E2E (ADR 0011), fully hermetic: a real CAS cohort (k1 + x1)
 * over real HTTP, a coordinator running an opt-in in-memory Helia pinning node,
 * and a separate "controller" Helia node standing in for the browser publisher.
 *
 * The proof has to be path-unique (the recurring false-green lesson): the
 * coordinator's artifact store already holds the cohort's update bodies and CAS
 * announcement, so pinning those proves only the store-sourcing path. The x1
 * GENESIS document is the artifact the coordinator NEVER holds - its pin can
 * only succeed by a real bitswap transfer from the controller node over the
 * dialed websocket. We assert exactly that (`source: 'network'`), then complete
 * the circle: a third node dials the coordinator and fetches the genesis block
 * by the CID derived from the DID alone, verifying the bytes against the DID's
 * own hash commitment.
 */

const PIN_TIMEOUT_MS = 2000;

function fail(problems: string[], message: string): void {
  problems.push(message);
}

async function main(): Promise<number> {
  const problems: string[] = [];

  // Coordinator: store + in-memory pinning node, ephemeral everything.
  const ipfs = await createIpfsNode({ pinTimeoutMs: PIN_TIMEOUT_MS });
  const store = new MemoryArtifactStore();
  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(2, 'CASBeacon'),
    store,
    ipfs,
  });

  // One KEY + one EXTERNAL participant; the x1 genesis is the network-only artifact.
  const k1 = createIdentity();
  const x1 = createExternalIdentity();
  const participants: ReturnType<typeof createParticipant>[] = [];

  const holder = await createIpfsNode({ pinTimeoutMs: PIN_TIMEOUT_MS });
  const third = await createIpfsNode({ pinTimeoutMs: PIN_TIMEOUT_MS });

  try {
    const { baseUrl } = await service.start(0);
    console.log(`coordinator on ${baseUrl}; ipfs node ${ipfs.peerId}`);

    participants.push(
      createParticipant({ identity: k1, baseUrl }),
      createParticipant({ identity: x1, baseUrl }),
    );

    // Capture the x1 participant's cohort-complete payload (cohortId + CAS map).
    const x1Complete = new Promise<{ cohortId: string; casAnnouncement?: Record<string, string> }>(
      (resolve) => participants[1].runner.on('cohort-complete', resolve),
    );

    await Promise.all(participants.map((p) => p.start()));
    const result = await service.runner.run();
    if (result.signature.length !== 64) {
      fail(problems, `expected a 64-byte aggregated signature, got ${result.signature.length}`);
    }
    const { cohortId, casAnnouncement } = await x1Complete;
    const update = participants[1].getSubmittedUpdate(cohortId);
    if (!update || !casAnnouncement || !x1.genesisDocument) {
      throw new Error('x1 participant did not capture its update/announcement/genesis');
    }

    // The controller's publish plan: update + announcement + genesis.
    const plan = buildPublishPlan({
      update,
      casAnnouncement,
      genesisDocument: x1.genesisDocument,
    });
    if (plan.map((p) => p.kind).join(',') !== 'update,announcement,genesis') {
      fail(problems, `unexpected publish plan: ${plan.map((p) => p.kind).join(',')}`);
    }
    const genesisEntry = plan.find((p) => p.kind === 'genesis')!;

    // Persistence is fire-and-forget on signing-complete: wait for the store to
    // hold the update before pinning, so the store-sourced outcomes are stable.
    const updateEntry = plan.find((p) => p.kind === 'update')!;
    const deadline = Date.now() + 10_000;
    while (!(await store.has('update', updateEntry.hashHex))) {
      if (Date.now() > deadline) {
        throw new Error('cohort artifacts were never persisted to the store');
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    // The genesis must NOT be in the store - that gap is what makes the bitswap
    // proof real. If a future slice adds genesis persistence, this e2e must
    // switch its network-proof artifact.
    if (await store.has('genesis', genesisEntry.hashHex)) {
      throw new Error('genesis unexpectedly present in the artifact store; the network-pin proof would be vacuous');
    }

    // The "browser": hold all blocks, then dial the coordinator's node.
    for (const entry of plan) {
      const value =
        entry.kind === 'update' ? update : entry.kind === 'announcement' ? casAnnouncement : x1.genesisDocument;
      await holder.publish(value as object, entry.hashHex);
    }
    const probeRes = await fetch(`${baseUrl}/v1/ipfs`);
    const probe = (await probeRes.json()) as { enabled: boolean; peerId?: string; multiaddrs?: string[] };
    if (!probe.enabled || !probe.multiaddrs?.length) {
      throw new Error(`GET /v1/ipfs did not report an enabled node: ${JSON.stringify(probe)}`);
    }
    if (probe.peerId !== ipfs.peerId) {
      fail(problems, `probe peerId ${probe.peerId} != node peerId ${ipfs.peerId}`);
    }
    await holder.dial(probe.multiaddrs[0]);
    console.log(`controller node ${holder.peerId} dialed ${probe.multiaddrs[0]}`);

    // The publish round-trip: ask the coordinator to pin the whole plan.
    const pinRes = await fetch(`${baseUrl}/v1/ipfs/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes: plan.map((p) => p.hashHex) }),
    });
    if (pinRes.status !== 200) {
      throw new Error(`POST /v1/ipfs/pin -> HTTP ${pinRes.status}`);
    }
    const { results } = (await pinRes.json()) as { results: PinOutcome[] };
    const byHash = new Map(results.map((r) => [r.hash, r]));
    for (const entry of plan) {
      const outcome = byHash.get(entry.hashHex);
      if (!outcome?.pinned) {
        fail(problems, `${entry.kind} was not pinned: ${JSON.stringify(outcome)}`);
        continue;
      }
      if (outcome.cid !== entry.cid) {
        fail(problems, `${entry.kind} CID mismatch: route ${outcome.cid} != plan ${entry.cid}`);
      }
      // Path-unique assertions: cohort artifacts come from the coordinator's own
      // store; the genesis can ONLY have crossed the wire from the controller.
      const expectedSource = entry.kind === 'genesis' ? 'network' : 'store';
      if (outcome.source !== expectedSource) {
        fail(problems, `${entry.kind} pinned via '${outcome.source}', expected '${expectedSource}'`);
      }
    }
    console.log(`pinned: ${results.map((r) => `${r.hash.slice(0, 8)}=${r.source}`).join(' ')}`);

    // Full circle: a third party derives the genesis CID from the DID alone and
    // fetches the block from the coordinator, verifying the DID's commitment.
    await third.dial(probe.multiaddrs[0]);
    const fetched = await third.getBlock(genesisEntry.hashHex, { timeoutMs: 5000 });
    const parsed = JSON.parse(new TextDecoder().decode(fetched)) as Record<string, unknown>;
    if (artifactHashHex(parsed) !== genesisEntry.hashHex) {
      fail(problems, 'third-party genesis fetch: bytes do not hash to the DID commitment');
    }

    // Negative probes: a digest nobody holds fails bounded (not a hang), and a
    // malformed request is rejected at the boundary.
    const missing = 'ee'.repeat(32);
    const missRes = await fetch(`${baseUrl}/v1/ipfs/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes: [missing] }),
    });
    const missBody = (await missRes.json()) as { results: PinOutcome[] };
    if (missRes.status !== 200 || missBody.results[0].pinned) {
      fail(problems, `expected a bounded pin failure for a missing block, got ${JSON.stringify(missBody)}`);
    }
    const badRes = await fetch(`${baseUrl}/v1/ipfs/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes: ['not-hex'] }),
    });
    if (badRes.status !== 400) {
      fail(problems, `expected 400 for a malformed pin request, got ${badRes.status}`);
    }
  } catch (err) {
    fail(problems, err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    for (const p of participants) {
      p.stop();
    }
    await service.stop().catch(() => {});
    await Promise.all([ipfs.stop(), holder.stop(), third.stop()].map((p) => p.catch(() => {})));
  }

  if (problems.length > 0) {
    console.error('\nIPFS E2E FAILED:');
    for (const p of problems) {
      console.error(`  - ${p}`);
    }
    return 1;
  }
  console.log(
    '\nIPFS E2E PASSED: a k1+x1 cohort completed; the controller node published its artifacts; ' +
      'the coordinator pinned cohort artifacts from its own store and pulled the x1 genesis over ' +
      'REAL bitswap; a third party fetched the genesis by the CID derived from the DID alone.',
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
