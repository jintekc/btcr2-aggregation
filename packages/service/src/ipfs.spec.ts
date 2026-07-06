import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { artifactHashHex, cidStringFromHashHex } from '@btcr2-aggregation/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createHonoApp } from './hono-adapter.js';
import { createIpfsNode, validatePinRequest, MAX_PIN_REQUEST, type IpfsNode } from './ipfs.js';
import { MemoryArtifactStore } from './store.js';

// Hermetic coverage of the opt-in IPFS pinning node (ADR 0011): in-memory stores,
// localhost-only websocket listeners, no public network machinery. The two-node
// cases exercise REAL bitswap over a real local socket - the same transfer path the
// in-browser publisher uses - because a mocked transfer could not catch a broken
// digest/CID identity or an undrained pin.

const nodes: IpfsNode[] = [];
async function makeNode(pinTimeoutMs?: number): Promise<IpfsNode> {
  const node = await createIpfsNode({ pinTimeoutMs });
  nodes.push(node);
  return node;
}
afterAll(async () => {
  await Promise.all(nodes.map((n) => n.stop().catch(() => {})));
});

/** An artifact with deliberately unsorted keys (JCS must reorder them). */
const ARTIFACT = { z: 1, a: { c: 3, b: 2 }, m: 'hi' };
const ARTIFACT_HEX = artifactHashHex(ARTIFACT);
/** A digest no node holds (for the bounded-failure path). */
const MISSING_HEX = 'ee'.repeat(32);

describe('createIpfsNode publish/pin', () => {
  it('publishes an artifact under its digest CID and round-trips the exact bytes', async () => {
    const node = await makeNode();
    const cid = await node.publish(ARTIFACT);
    expect(cid).toBe(cidStringFromHashHex(ARTIFACT_HEX));
    expect(await node.hasBlock(ARTIFACT_HEX)).toBe(true);
    const bytes = await node.getBlock(ARTIFACT_HEX);
    expect(new TextDecoder().decode(bytes)).toBe('{"a":{"b":2,"c":3},"m":"hi","z":1}');
    // Idempotent: publishing again (already pinned) must not throw.
    await expect(node.publish(ARTIFACT)).resolves.toBe(cid);
  });

  it('refuses to publish bytes under a digest they do not hash to', async () => {
    const node = await makeNode();
    await expect(node.publish(ARTIFACT, MISSING_HEX)).rejects.toThrow(/refusing to publish/);
  });

  it('pins from the artifact store with digest re-verification, never trusting the key', async () => {
    const node = await makeNode(500);
    const store = new MemoryArtifactStore();
    await store.put('update', ARTIFACT_HEX, ARTIFACT);
    // A value stored under a key it does NOT hash to (the SMT-proof namespace
    // shape, or a corrupt blob) must not become a lying block: the pin falls
    // through to the (empty) network and fails bounded instead.
    await store.put('update', MISSING_HEX, { not: 'the artifact' });

    const good = await node.pin(ARTIFACT_HEX, store);
    expect(good).toMatchObject({ pinned: true, source: 'store', cid: cidStringFromHashHex(ARTIFACT_HEX) });

    const bad = await node.pin(MISSING_HEX, store);
    expect(bad.pinned).toBe(false);
    expect(bad.error).toBeTruthy();
    expect(await node.hasBlock(MISSING_HEX)).toBe(false);

    // Idempotency: a second pin of the good hash reports already-pinned.
    const again = await node.pin(ARTIFACT_HEX, store);
    expect(again).toMatchObject({ pinned: true, source: 'already-pinned' });
  });

  it('pins a locally-held (unpinned) block without any network', async () => {
    const node = await makeNode(500);
    const { cidFromHashHex, canonicalArtifactBytes } = await import('@btcr2-aggregation/shared');
    await node.helia.blockstore.put(cidFromHashHex(ARTIFACT_HEX), canonicalArtifactBytes(ARTIFACT));
    const outcome = await node.pin(ARTIFACT_HEX);
    expect(outcome).toMatchObject({ pinned: true, source: 'local' });
  });

  it('reports pinned:true for BOTH sides of a concurrent same-digest pin race', async () => {
    // Every cohort member's publish plan carries the identical announcement
    // digest, so simultaneous publishes race pin() on one CID. helia's pins.add
    // throws "Already pinned" for the loser; that must surface as success (the
    // block IS pinned), never as pinned:false. fs-backed stores on purpose: the
    // fs I/O yields between the isPinned pre-check and the pin write, which is
    // what makes the race reachable (the adversarial-review repro).
    const dir = await mkdtemp(join(tmpdir(), 'btcr2-ipfs-race-'));
    try {
      const node = await createIpfsNode({ dir });
      const store = new MemoryArtifactStore();
      try {
        for (let round = 0; round < 5; round += 1) {
          const artifact = { round, z: 1, a: { c: 3, b: 2 } };
          await store.put('update', artifactHashHex(artifact), artifact);
          const outcomes = await Promise.all([
            node.pin(artifactHashHex(artifact), store),
            node.pin(artifactHashHex(artifact), store),
            node.pin(artifactHashHex(artifact), store),
          ]);
          for (const outcome of outcomes) {
            expect(outcome.pinned, `round ${round}: ${JSON.stringify(outcome)}`).toBe(true);
          }
        }
      } finally {
        await node.stop();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists blocks and pins across a restart when a dir is configured', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'btcr2-ipfs-spec-'));
    try {
      const first = await createIpfsNode({ dir });
      await first.publish(ARTIFACT);
      await first.stop();

      const second = await createIpfsNode({ dir });
      try {
        expect(await second.hasBlock(ARTIFACT_HEX)).toBe(true);
        // The pin metadata lives in the datastore; a restarted operator node must
        // still report the artifact pinned (durability is the whole point of dir).
        const outcome = await second.pin(ARTIFACT_HEX);
        expect(outcome).toMatchObject({ pinned: true, source: 'already-pinned' });
      } finally {
        await second.stop();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fetches a block over bitswap from an explicitly dialed peer (the publish path)', async () => {
    const holder = await makeNode();
    const service = await makeNode();
    await holder.publish(ARTIFACT);

    // The holder dials the service (exactly what the browser does), then the
    // service pin pulls the block over the wire.
    const [addr] = service.multiaddrs();
    expect(addr).toMatch(/\/ws\/p2p\//);
    await holder.dial(addr);

    const outcome = await service.pin(ARTIFACT_HEX);
    expect(outcome).toMatchObject({ pinned: true, source: 'network' });
    const bytes = await service.getBlock(ARTIFACT_HEX);
    expect(artifactHashHex(JSON.parse(new TextDecoder().decode(bytes)) as object)).toBe(ARTIFACT_HEX);
  });
});

describe('validatePinRequest', () => {
  it('normalizes well-formed requests', () => {
    expect(validatePinRequest({ hashes: [ARTIFACT_HEX.toUpperCase()] })).toEqual({ hashes: [ARTIFACT_HEX] });
  });

  it('rejects malformed shapes with a reason', () => {
    expect(validatePinRequest(null)).toHaveProperty('problem');
    expect(validatePinRequest({})).toHaveProperty('problem');
    expect(validatePinRequest({ hashes: 'abc' })).toHaveProperty('problem');
    expect(validatePinRequest({ hashes: [] })).toEqual({ problem: 'hashes must not be empty' });
    expect(validatePinRequest({ hashes: [42] })).toEqual({ problem: 'hashes must be strings' });
    expect(validatePinRequest({ hashes: ['zz'.repeat(32)] })).toHaveProperty('problem');
    expect(validatePinRequest({ hashes: [ARTIFACT_HEX.slice(1)] })).toHaveProperty('problem');
    expect(
      validatePinRequest({ hashes: Array.from({ length: MAX_PIN_REQUEST + 1 }, () => ARTIFACT_HEX) }),
    ).toEqual({ problem: `at most ${MAX_PIN_REQUEST} hashes per request` });
  });
});

describe('IPFS routes', () => {
  function makeApp(ipfs?: IpfsNode, store?: MemoryArtifactStore) {
    const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
    return createHonoApp(transport, { ipfs, store });
  }

  it('GET /v1/ipfs is unconditional and reports disabled without a node', async () => {
    const res = await makeApp().request('/v1/ipfs');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it('GET /v1/ipfs reports the node peer id and dialable multiaddrs when enabled', async () => {
    const node = await makeNode();
    const res = await makeApp(node).request('/v1/ipfs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; peerId: string; multiaddrs: string[] };
    expect(body.enabled).toBe(true);
    expect(body.peerId).toBe(node.peerId);
    expect(body.multiaddrs.length).toBeGreaterThan(0);
    expect(body.multiaddrs[0]).toContain(body.peerId);
  });

  it('POST /v1/ipfs/pin validates the body and pins from the store', async () => {
    const node = await makeNode(500);
    const store = new MemoryArtifactStore();
    await store.put('announcement', ARTIFACT_HEX, ARTIFACT);
    const app = makeApp(node, store);

    const bad = await app.request('/v1/ipfs/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes: ['nope'] }),
    });
    expect(bad.status).toBe(400);

    const notJson = await app.request('/v1/ipfs/pin', { method: 'POST', body: 'not json' });
    expect(notJson.status).toBe(400);

    const res = await app.request('/v1/ipfs/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes: [ARTIFACT_HEX, MISSING_HEX] }),
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: Array<{ hash: string; pinned: boolean; source?: string }> };
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ hash: ARTIFACT_HEX, pinned: true, source: 'store' });
    expect(results[1].pinned).toBe(false);
  });

  it('POST /v1/ipfs/pin does not exist when the node is disabled', async () => {
    const res = await makeApp().request('/v1/ipfs/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes: [ARTIFACT_HEX] }),
    });
    expect(res.status).toBe(404);
  });
});
