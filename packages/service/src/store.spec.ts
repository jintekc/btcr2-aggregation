import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHonoApp } from './hono-adapter.js';
import {
  exportSidecar,
  FileSystemArtifactStore,
  isHexKey,
  MemoryArtifactStore,
  mountArtifactRoutes,
  normalizeHexKey,
  putAnnouncement,
  putGenesis,
  putProof,
  type ArtifactStore,
} from './store.js';

/** A sans-I/O server transport (never started) for exercising createHonoApp wiring. */
function makeTransport(): HttpServerTransport {
  return new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
}

// Synthetic, structurally-valid artifacts (no chain, no cohort). 64-hex keys.
const ANN_HASH = 'a'.repeat(64);
const PROOF_HASH = 'b'.repeat(64);
const UPDATE_HASH = 'c'.repeat(64);
const GENESIS_HASH = 'd'.repeat(64);

const ANNOUNCEMENT = {
  'did:btcr2:k1qexampleparticipantone': 'a4ayc_80_OGda4BO_1o_V0etpOqiLx1JwB5S3beHW0s',
  'did:btcr2:k1qexampleparticipanttwo': '1HNeOiZeFu7gP1lxi5tdAwGcB9i2xR-Q2jpmbuwTqzU',
};
const PROOF = {
  id: 'TgdAhWK-24tgzgXB3s_jrRa3IjCWfeAfZAt-Rym0n84',
  nonce: 'zzdAhWK-24tgzgXB3s_jrRa3IjCWfeAfZAt-Rym0abc',
  collapsed: 'AAdAhWK-24tgzgXB3s_jrRa3IjCWfeAfZAt-Rym0xyz',
  hashes: ['QQdAhWK-24tgzgXB3s_jrRa3IjCWfeAfZAt-Rym0n01'],
};
const UPDATE = {
  '@context': ['https://w3id.org/security/v2', 'https://w3id.org/json-ld-patch/v1'],
  patch: [{ op: 'add', path: '/service/-', value: { id: '#beacon-cas', type: 'CASBeacon' } }],
  sourceHash: 'z6MksourcehashplaceholderBASE58btc',
  targetHash: 'z6MktargethashplaceholderBASE58btc',
  targetVersionId: 2,
  proof: { type: 'DataIntegrityProof', cryptosuite: 'bip340-jcs-2025', proofValue: 'z3sig' },
};
const GENESIS = { id: 'did:btcr2:x1qexamplegenesis', verificationMethod: [] };

// Temp dirs created by the FileSystemArtifactStore variant, removed in afterAll.
const tempDirs: string[] = [];
async function makeTempStore(): Promise<ArtifactStore> {
  const root = await mkdtemp(join(tmpdir(), 'btcr2-store-'));
  tempDirs.push(root);
  return new FileSystemArtifactStore(root);
}

/** Seed a store with one artifact of each kind. */
async function seed(store: ArtifactStore): Promise<void> {
  await putAnnouncement(store, ANN_HASH, ANNOUNCEMENT);
  await putProof(store, PROOF_HASH, PROOF);
  await store.put('update', UPDATE_HASH, UPDATE);
  await putGenesis(store, GENESIS_HASH, GENESIS);
}

describe('hex key validation', () => {
  it('accepts pure hex, case-insensitively', () => {
    expect(isHexKey(ANN_HASH)).toBe(true);
    expect(isHexKey('ABCDEF0123')).toBe(true);
    expect(normalizeHexKey('ABCDEF')).toBe('abcdef');
  });

  it('rejects non-hex and path-traversal keys', () => {
    expect(isHexKey('../etc/passwd')).toBe(false);
    expect(isHexKey('abc.json')).toBe(false);
    expect(isHexKey('')).toBe(false);
    expect(() => normalizeHexKey('../secret')).toThrow(/lowercase hex/);
  });
});

describe.each([
  ['MemoryArtifactStore', (): Promise<ArtifactStore> => Promise.resolve(new MemoryArtifactStore())],
  ['FileSystemArtifactStore', makeTempStore],
] as const)('%s round-trip', (_name, make) => {
  let store: ArtifactStore;

  beforeAll(async () => {
    store = await make();
    await seed(store);
  });

  it('round-trips every artifact kind by hex key', async () => {
    expect(await store.get('announcement', ANN_HASH)).toEqual(ANNOUNCEMENT);
    expect(await store.get('proof', PROOF_HASH)).toEqual(PROOF);
    expect(await store.get('update', UPDATE_HASH)).toEqual(UPDATE);
    expect(await store.get('genesis', GENESIS_HASH)).toEqual(GENESIS);
  });

  it('normalizes uppercase keys to lowercase on read', async () => {
    expect(await store.get('announcement', ANN_HASH.toUpperCase())).toEqual(ANNOUNCEMENT);
  });

  it('reports presence and absence', async () => {
    expect(await store.has('announcement', ANN_HASH)).toBe(true);
    expect(await store.has('announcement', 'f'.repeat(64))).toBe(false);
    expect(await store.get('proof', 'f'.repeat(64))).toBeUndefined();
  });

  it('lists entries per kind', async () => {
    const entries = await store.entries('announcement');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual([ANN_HASH, ANNOUNCEMENT]);
    expect(await store.entries('update')).toHaveLength(1);
  });

  it('rejects a non-hex key on write', async () => {
    await expect(store.put('announcement', '../escape', {})).rejects.toThrow(/lowercase hex/);
  });

  it('treats an over-long (but hex) key as absent rather than throwing', async () => {
    // A key too long to name a file must read back as a clean miss, not an error.
    expect(await store.get('announcement', 'a'.repeat(5000))).toBeUndefined();
  });
});

describe('FileSystemArtifactStore - corrupt file tolerance', () => {
  // A corrupt (unparseable) artifact file must not abort resolution. `entries()`
  // (which the SMT resolve driver scans) skips it, and a by-hash `get()` treats it
  // as absent, so one bad blob never breaks reads over the store's valid artifacts.
  it('skips a corrupt file in entries() and returns undefined from get()', async () => {
    const root = await mkdtemp(join(tmpdir(), 'btcr2-store-corrupt-'));
    tempDirs.push(root);
    const store = new FileSystemArtifactStore(root);
    await putProof(store, PROOF_HASH, PROOF);

    // Write a syntactically-invalid JSON file next to the valid one, under a valid
    // hex key so it is not filtered out by the .json/hex-name guards.
    const corruptKey = 'c'.repeat(64);
    await writeFile(join(root, 'proof', `${corruptKey}.json`), '{ not valid json', 'utf8');

    const entries = await store.entries('proof');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual([PROOF_HASH, PROOF]);
    expect(await store.get('proof', corruptKey)).toBeUndefined();
    // The valid artifact is still readable.
    expect(await store.get('proof', PROOF_HASH)).toEqual(PROOF);
  });
});

describe('exportSidecar', () => {
  it('produces a resolver-ready Sidecar with one array per populated kind', async () => {
    const store = new MemoryArtifactStore();
    await seed(store);

    const sidecar = await exportSidecar(store, { genesisHash: GENESIS_HASH });
    expect(sidecar['@context']).toBe('https://btcr2.dev/context/v1');
    expect(sidecar.updates).toEqual([UPDATE]);
    expect(sidecar.casUpdates).toEqual([ANNOUNCEMENT]);
    expect(sidecar.smtProofs).toEqual([PROOF]);
    expect(sidecar.genesisDocument).toEqual(GENESIS);
  });

  it('omits empty arrays and the genesis document when not requested', async () => {
    const store = new MemoryArtifactStore();
    await putAnnouncement(store, ANN_HASH, ANNOUNCEMENT);

    const sidecar = await exportSidecar(store);
    expect(sidecar.casUpdates).toEqual([ANNOUNCEMENT]);
    expect(sidecar.updates).toBeUndefined();
    expect(sidecar.smtProofs).toBeUndefined();
    expect(sidecar.genesisDocument).toBeUndefined();
  });
});

describe('mountArtifactRoutes (GET /cas/:kind/:hash)', () => {
  let app: Hono;

  beforeAll(async () => {
    const store = new MemoryArtifactStore();
    await seed(store);
    app = new Hono();
    mountArtifactRoutes(app, store);
  });

  it('serves a stored artifact as JSON by hex key', async () => {
    const res = await app.request(`/cas/announcement/${ANN_HASH}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ANNOUNCEMENT);

    const proofRes = await app.request(`/cas/proof/${PROOF_HASH}`);
    expect(proofRes.status).toBe(200);
    expect(await proofRes.json()).toEqual(PROOF);
  });

  it('accepts an uppercase hex hash (normalized to lowercase)', async () => {
    const res = await app.request(`/cas/update/${UPDATE_HASH.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(UPDATE);
  });

  it('404s an absent hash', async () => {
    const res = await app.request(`/cas/announcement/${'f'.repeat(64)}`);
    expect(res.status).toBe(404);
  });

  it('404s an unknown artifact kind', async () => {
    const res = await app.request(`/cas/bogus/${ANN_HASH}`);
    expect(res.status).toBe(404);
  });

  it('400s a non-hex hash', async () => {
    const res = await app.request('/cas/announcement/not-hex');
    expect(res.status).toBe(400);
  });
});

describe('createHonoApp store wiring', () => {
  it('mounts /cas/* only when a store is provided', async () => {
    const store = new MemoryArtifactStore();
    await seed(store);

    const withStore = createHonoApp(makeTransport(), { store });
    const hit = await withStore.request(`/cas/announcement/${ANN_HASH}`);
    expect(hit.status).toBe(200);
    expect(await hit.json()).toEqual(ANNOUNCEMENT);

    // No store => no /cas namespace, so the same path is unhandled (404).
    const noStore = createHonoApp(makeTransport(), {});
    expect((await noStore.request(`/cas/announcement/${ANN_HASH}`)).status).toBe(404);
  });

  it('400s an over-long (but hex) hash at the route before it reaches the store', async () => {
    const store = new MemoryArtifactStore();
    const app = createHonoApp(makeTransport(), { store });
    const res = await app.request(`/cas/announcement/${'a'.repeat(5000)}`);
    expect(res.status).toBe(400);
  });

  it('keeps /cas self-contained (404, not the SPA shell) when a web dist is also served', async () => {
    const store = new MemoryArtifactStore();
    await seed(store);
    const dist = await mkdtemp(join(tmpdir(), 'btcr2-web-'));
    tempDirs.push(dist);
    await writeFile(join(dist, 'index.html'), '<!doctype html><title>app</title>', 'utf8');

    const app = createHonoApp(makeTransport(), { store, webDistDir: dist });

    // Well-formed artifact request still served by the /cas handler.
    expect((await app.request(`/cas/announcement/${ANN_HASH}`)).status).toBe(200);
    // Malformed /cas shapes 404 in the namespace, not the 200 HTML SPA shell.
    expect((await app.request('/cas')).status).toBe(404);
    expect((await app.request('/cas/announcement')).status).toBe(404);
    expect((await app.request('/cas/announcement/aa/bb')).status).toBe(404);
    // A genuine app route still falls through to the SPA shell.
    const spa = await app.request('/some/app/route');
    expect(spa.status).toBe(200);
    expect(spa.headers.get('content-type')).toContain('text/html');
  });
});

// Remove the temp dirs the FileSystemArtifactStore variant created.
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});
