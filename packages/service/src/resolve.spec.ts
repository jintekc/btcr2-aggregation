import { decode, encode } from '@did-btcr2/common';
import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk, type BeaconService, type DataNeed, type ResolverState } from '@did-btcr2/method';
import { BTCR2MerkleTree } from '@did-btcr2/smt';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { createExternalIdentity, createIdentity } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { driveResolution, type ResolverLike } from './resolve.js';
import { MemoryArtifactStore, putProof, putUpdate, putAnnouncement, putGenesis } from './store.js';
import { createHonoApp } from './hono-adapter.js';

// Hermetic coverage of the resolve DRIVER (the resolve()/provide() loop, need
// dispatch, and per-DID SMT proof selection) with a scripted fake resolver and a
// mock esplora, plus the `GET /resolve/:did` route. The full live-cohort round-trip
// lives in e2e/resolve-cohort.ts.

/** A mock esplora reporting one OP_RETURN signal per address in `byAddress`. */
function mockChain(byAddress: Map<string, string>): BitcoinConnection {
  return {
    rest: {
      block: { count: async () => 200 },
      address: {
        getTxs: async (addr: string) => {
          const signalHex = byAddress.get(addr);
          if (!signalHex) return [];
          return [
            {
              txid: 'aa'.repeat(32), version: 2, locktime: 0, vin: [], size: 0, weight: 0, fee: 0,
              vout: [{ scriptpubkey: `6a20${signalHex}`, scriptpubkey_asm: `OP_RETURN OP_PUSHBYTES_32 ${signalHex}`, scriptpubkey_type: 'op_return', value: 0 }],
              status: { confirmed: true, block_height: 150, block_hash: '00'.repeat(32), block_time: 1_700_000_000 },
            },
          ];
        },
      },
    },
  } as unknown as BitcoinConnection;
}

/** A fake resolver that replays `states` on each `resolve()` and records `provide()`. */
function scriptedResolver(states: ResolverState[]): {
  resolver: ResolverLike;
  provided: Array<{ need: DataNeed; data: unknown }>;
  resolveCalls: () => number;
} {
  const provided: Array<{ need: DataNeed; data: unknown }> = [];
  let i = 0;
  const resolver: ResolverLike = {
    resolve() {
      // Clamp to the last state so a never-resolving script (loop guard test) keeps
      // returning action-required.
      const state = states[Math.min(i, states.length - 1)];
      i += 1;
      return state;
    },
    provide(need, data) {
      provided.push({ need, data });
    },
  };
  return { resolver, provided, resolveCalls: () => i };
}

const RESOLVED: ResolverState = {
  status: 'resolved',
  result: { didDocument: { id: 'did:btcr2:k1qexample' } as never, metadata: { versionId: '2' } },
};

/** One action-required state carrying a single need, then resolved. */
function oneNeed(need: DataNeed): ResolverState[] {
  return [{ status: 'action-required', needs: [need] }, RESOLVED];
}

const DID = 'did:btcr2:k1qexampleparticipant';
const HASH = 'aa'.repeat(32);

describe('driveResolution - need dispatch', () => {
  it('satisfies NeedBeaconSignals from the indexer and provides a signals Map', async () => {
    const addr = 'tb1pbeaconaddress';
    const service = { id: `${DID}#initialP2TR`, type: 'SingletonBeacon', serviceEndpoint: `bitcoin:${addr}` } as unknown as BeaconService;
    const need: DataNeed = { kind: 'NeedBeaconSignals', beaconServices: [service] };
    const { resolver, provided } = scriptedResolver(oneNeed(need));

    const result = await driveResolution(resolver, DID, { bitcoin: mockChain(new Map([[addr, HASH]])) });
    expect(result.metadata.versionId).toBe('2');
    expect(provided).toHaveLength(1);
    const data = provided[0].data as Map<BeaconService, Array<{ signalBytes: string }>>;
    expect(data).toBeInstanceOf(Map);
    expect(data.get(service)?.[0]?.signalBytes).toBe(HASH);
  });

  it('satisfies NeedCASAnnouncement from the store', async () => {
    const store = new MemoryArtifactStore();
    const announcement = { [DID]: 'someBase64UrlUpdateHash' };
    await putAnnouncement(store, HASH, announcement);
    const need: DataNeed = { kind: 'NeedCASAnnouncement', announcementHash: HASH, beaconServiceId: `${DID}#beacon-cas` };
    const { resolver, provided } = scriptedResolver(oneNeed(need));

    await driveResolution(resolver, DID, { bitcoin: mockChain(new Map()), store });
    expect(provided[0].data).toEqual(announcement);
  });

  it('throws a clear error when a NeedCASAnnouncement is absent', async () => {
    const need: DataNeed = { kind: 'NeedCASAnnouncement', announcementHash: HASH, beaconServiceId: `${DID}#beacon-cas` };
    const { resolver } = scriptedResolver(oneNeed(need));
    await expect(
      driveResolution(resolver, DID, { bitcoin: mockChain(new Map()), store: new MemoryArtifactStore() }),
    ).rejects.toThrow(/no CAS announcement for hash/);
  });

  it('satisfies NeedSignedUpdate from the store', async () => {
    const store = new MemoryArtifactStore();
    const update = { '@context': ['x'], patch: [], targetVersionId: 2, proof: {} } as never;
    await putUpdate(store, HASH, update);
    const need: DataNeed = { kind: 'NeedSignedUpdate', updateHash: HASH, beaconServiceId: `${DID}#beacon-cas` };
    const { resolver, provided } = scriptedResolver(oneNeed(need));

    await driveResolution(resolver, DID, { bitcoin: mockChain(new Map()), store });
    expect(provided[0].data).toEqual(update);
  });

  it('throws a clear error when a NeedSignedUpdate is absent', async () => {
    const need: DataNeed = { kind: 'NeedSignedUpdate', updateHash: HASH, beaconServiceId: `${DID}#beacon-cas` };
    const { resolver } = scriptedResolver(oneNeed(need));
    await expect(
      driveResolution(resolver, DID, { bitcoin: mockChain(new Map()), store: new MemoryArtifactStore() }),
    ).rejects.toThrow(/no signed update for hash/);
  });

  it('satisfies NeedGenesisDocument from the store (EXTERNAL onboarding)', async () => {
    const store = new MemoryArtifactStore();
    const genesis = { id: 'did:btcr2:x1qexternal', service: [] };
    await putGenesis(store, HASH, genesis);
    const need: DataNeed = { kind: 'NeedGenesisDocument', genesisHash: HASH };
    const { resolver, provided } = scriptedResolver(oneNeed(need));

    await driveResolution(resolver, DID, { bitcoin: mockChain(new Map()), store });
    expect(provided[0].data).toEqual(genesis);
  });

  it('throws when a NeedGenesisDocument is absent', async () => {
    const need: DataNeed = { kind: 'NeedGenesisDocument', genesisHash: HASH };
    const { resolver } = scriptedResolver(oneNeed(need));
    await expect(
      driveResolution(resolver, DID, { bitcoin: mockChain(new Map()), store: new MemoryArtifactStore() }),
    ).rejects.toThrow(/no genesis document/);
  });

  it('enforces the iteration cap on a resolver that never resolves', async () => {
    const need: DataNeed = { kind: 'NeedCASAnnouncement', announcementHash: HASH, beaconServiceId: 'x' };
    const store = new MemoryArtifactStore();
    await putAnnouncement(store, HASH, { [DID]: 'x' });
    // A single, ever-repeating action-required state: the driver provides forever.
    const { resolver } = scriptedResolver([{ status: 'action-required', needs: [need] }]);
    await expect(
      driveResolution(resolver, DID, { bitcoin: mockChain(new Map()), store, maxIterations: 5 }),
    ).rejects.toThrow(/exceeded 5 iterations/);
  });
});

describe('driveResolution - per-DID SMT proof selection', () => {
  // Two DIDs share ONE SMT root; the resolver of DID A must receive A's own proof
  // (only it verifies against A's leaf index), NOT B's - the whole point of keying
  // proofs per-DID in the store.
  const didA = createIdentity().did;
  const didB = createIdentity().did;

  function buildProofs(): { rootHex: string; proofA: ReturnType<BTCR2MerkleTree['proof']>; proofB: ReturnType<BTCR2MerkleTree['proof']> } {
    const tree = new BTCR2MerkleTree();
    tree.addEntries([
      { did: didA, nonce: new Uint8Array(32).fill(7), signedUpdate: new TextEncoder().encode('update-a') },
      { did: didB, nonce: new Uint8Array(32).fill(9), signedUpdate: new TextEncoder().encode('update-b') },
    ]);
    tree.finalize();
    const proofA = tree.proof(didA);
    const proofB = tree.proof(didB);
    const rootHex = encode(decode(proofA.id, 'base64urlnopad'), 'hex');
    return { rootHex, proofA, proofB };
  }

  it('selects the resolved DID\'s own proof from a store holding both', async () => {
    const { rootHex, proofA, proofB } = buildProofs();
    const store = new MemoryArtifactStore();
    // Key each proof by its per-DID hex update hash (how persistCohortArtifacts keys them).
    await putProof(store, encode(decode(proofA.updateId!, 'base64urlnopad'), 'hex'), proofA);
    await putProof(store, encode(decode(proofB.updateId!, 'base64urlnopad'), 'hex'), proofB);

    const need: DataNeed = { kind: 'NeedSMTProof', smtRootHash: rootHex, beaconServiceId: `${didA}#beacon-smt` };
    const { resolver, provided } = scriptedResolver(oneNeed(need));
    await driveResolution(resolver, didA, { bitcoin: mockChain(new Map()), store });
    expect(provided[0].data).toEqual(proofA);
    expect(provided[0].data).not.toEqual(proofB);
  });

  it('throws when no stored proof verifies for the resolved DID', async () => {
    const { rootHex, proofB } = buildProofs();
    const store = new MemoryArtifactStore();
    // Only B's proof is present; resolving A must fail rather than surface B's proof.
    await putProof(store, encode(decode(proofB.updateId!, 'base64urlnopad'), 'hex'), proofB);
    const need: DataNeed = { kind: 'NeedSMTProof', smtRootHash: rootHex, beaconServiceId: `${didA}#beacon-smt` };
    const { resolver } = scriptedResolver(oneNeed(need));
    await expect(
      driveResolution(resolver, didA, { bitcoin: mockChain(new Map()), store }),
    ).rejects.toThrow(/no SMT proof for did/);
  });

  it('skips a proof with a malformed nonce without throwing a decode error', async () => {
    const { rootHex, proofA } = buildProofs();
    const store = new MemoryArtifactStore();
    // A proof at the right root but with a malformed (non-32-byte) nonce: base64UrlToHash
    // would throw RangeError. The scan must catch it and fall through to a clean
    // "no SMT proof" error, NOT propagate the RangeError.
    await putProof(store, 'aa'.repeat(32), { ...proofA, nonce: 'tooShort' });
    const need: DataNeed = { kind: 'NeedSMTProof', smtRootHash: rootHex, beaconServiceId: `${didA}#beacon-smt` };
    const { resolver } = scriptedResolver(oneNeed(need));
    await expect(
      driveResolution(resolver, didA, { bitcoin: mockChain(new Map()), store }),
    ).rejects.toThrow(/no SMT proof for did/);
  });

  it('skips a non-inclusion proof (no updateId) for the resolved DID', async () => {
    const { rootHex, proofA } = buildProofs();
    const store = new MemoryArtifactStore();
    // A non-inclusion proof (updateId removed) carries no update to apply; it must be
    // skipped, surfacing "no SMT proof" rather than being applied or throwing.
    const nonInclusion = { ...proofA };
    delete (nonInclusion as { updateId?: string }).updateId;
    await putProof(store, 'bb'.repeat(32), nonInclusion as never);
    const need: DataNeed = { kind: 'NeedSMTProof', smtRootHash: rootHex, beaconServiceId: `${didA}#beacon-smt` };
    const { resolver } = scriptedResolver(oneNeed(need));
    await expect(
      driveResolution(resolver, didA, { bitcoin: mockChain(new Map()), store }),
    ).rejects.toThrow(/no SMT proof for did/);
  });
});

describe('GET /resolve/:did route', () => {
  function appWith(opts: { bitcoin?: BitcoinConnection }) {
    const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
    return createHonoApp(transport, { store: new MemoryArtifactStore(), bitcoin: opts.bitcoin });
  }

  it('resolves a valid KEY DID to its genesis document when no updates are on-chain', async () => {
    // An empty chain: the genesis SingletonBeacons fire no signals, so resolution
    // completes at the deterministic genesis document (the 3 initial beacons, no
    // appended aggregate beacon). Proves the route -> driver -> resolver wiring.
    const { did } = createIdentity();
    const app = appWith({ bitcoin: mockChain(new Map()) });
    const res = await app.request(`/resolve/${did}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { didDocument: { id: string; service: Array<{ type: string }> } };
    expect(body.didDocument.id).toBe(did);
    expect(body.didDocument.service.every((s) => s.type === 'SingletonBeacon')).toBe(true);
  });

  it('rejects a non-did:btcr2 path with 400', async () => {
    const app = appWith({ bitcoin: mockChain(new Map()) });
    const res = await app.request('/resolve/not-a-did');
    expect(res.status).toBe(400);
  });

  it('rejects a well-prefixed but out-of-charset DID with 400', async () => {
    const app = appWith({ bitcoin: mockChain(new Map()) });
    const res = await app.request('/resolve/did:btcr2:invalid@%23');
    expect(res.status).toBe(400);
  });

  it('returns 502 with a generic message when resolution throws', async () => {
    // A valid-charset DID whose resolution fails because the chain read errors. The
    // route must surface a generic 502, not the underlying esplora error text.
    const throwingChain = {
      rest: {
        block: { count: async () => { throw new Error('esplora unreachable: connect ECONNREFUSED'); } },
        address: { getTxs: async () => [] },
      },
    } as unknown as BitcoinConnection;
    const app = appWith({ bitcoin: throwingChain });
    const res = await app.request(`/resolve/${createIdentity().did}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('resolution failed');
    expect(body.error).not.toContain('ECONNREFUSED');
  });

  it('does not mount the route without a Bitcoin connection', async () => {
    const app = appWith({});
    const res = await app.request(`/resolve/${createIdentity().did}`);
    // No route, no SPA fallback configured -> Hono's default 404.
    expect(res.status).toBe(404);
  });
});

describe('POST /resolve/:did route (EXTERNAL x1, genesis in-band)', () => {
  function appWith(opts: { bitcoin?: BitcoinConnection }) {
    const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
    return createHonoApp(transport, { store: new MemoryArtifactStore(), bitcoin: opts.bitcoin });
  }

  function postResolve(app: ReturnType<typeof appWith>, did: string, body: unknown) {
    return app.request(`/resolve/${did}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('resolves an x1 DID to its genesis document from the supplied sidecar genesis', async () => {
    // An x1 DID is only a commitment to its genesis; the coordinator does not hold it,
    // so the controller supplies it in-band. With an empty chain (no updates yet) the
    // resolution completes at the (real-DID-substituted) genesis document.
    const { did, genesisDocument } = createExternalIdentity();
    const app = appWith({ bitcoin: mockChain(new Map()) });
    const res = await postResolve(app, did, { genesisDocument });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { didDocument: { id: string; service: Array<{ type: string }> } };
    expect(body.didDocument.id).toBe(did);
    expect(body.didDocument.service.some((s) => s.type === 'SingletonBeacon')).toBe(true);
  });

  it('rejects a genesis that does not hash to the x1 DID at resolution time (trustless)', async () => {
    // Victim DID + attacker genesis: the resolver re-verifies the commitment and throws,
    // surfaced as a generic 502 - a forged genesis cannot fabricate a resolution.
    const victim = createExternalIdentity();
    const attacker = createExternalIdentity();
    const app = appWith({ bitcoin: mockChain(new Map()) });
    const res = await postResolve(app, victim.did, { genesisDocument: attacker.genesisDocument });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('resolution failed');
  });

  it('returns 502 for an x1 DID posted without a genesis (unresolvable)', async () => {
    // No genesis and none in the store: the resolver cannot build the x1 document.
    const { did } = createExternalIdentity();
    const app = appWith({ bitcoin: mockChain(new Map()) });
    const res = await postResolve(app, did, {});
    expect(res.status).toBe(502);
  });

  it('rejects a malformed JSON body with 400', async () => {
    const { did } = createExternalIdentity();
    const app = appWith({ bitcoin: mockChain(new Map()) });
    const res = await postResolve(app, did, 'not json at all');
    expect(res.status).toBe(400);
  });

  it('rejects a non-did:btcr2 path with 400 before parsing', async () => {
    const app = appWith({ bitcoin: mockChain(new Map()) });
    const res = await postResolve(app, 'not-a-did', { genesisDocument: {} });
    expect(res.status).toBe(400);
  });
});
