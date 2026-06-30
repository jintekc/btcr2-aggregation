import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Env, Hono } from 'hono';
import type {
  CASAnnouncement,
  Sidecar,
  SignedBTCR2Update,
  SMTProof,
} from '@did-btcr2/method';

/**
 * The four content-addressed artifact namespaces a did:btcr2 resolver may request
 * while resolving an aggregated update. Each maps to one `DataNeed`:
 *   announcement -> NeedCASAnnouncement  (CAS map, keyed by announcement hash)
 *   proof        -> NeedSMTProof         (SMT inclusion proof, keyed by root hash)
 *   update       -> NeedSignedUpdate     (the signed update body, keyed by update hash)
 *   genesis      -> NeedGenesisDocument  (EXTERNAL onboarding only)
 * All keys are lowercase hex (the resolver's hashes and the on-chain signal are hex).
 */
export const ARTIFACT_KINDS = ['announcement', 'proof', 'update', 'genesis'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** The stored value type for each artifact kind. */
export interface ArtifactValueByKind {
  announcement: CASAnnouncement;
  proof: SMTProof;
  update: SignedBTCR2Update;
  genesis: Record<string, unknown>;
}

const HEX_KEY = /^[0-9a-f]+$/;

/** True if `key` is a non-empty lowercase-hex string (case-insensitive check). */
export function isHexKey(key: string): boolean {
  return HEX_KEY.test(key.toLowerCase());
}

/**
 * Normalize an artifact key to lowercase hex, throwing if it is not pure hex. This
 * is also the filesystem-safety guard: a pure-hex key can never contain `/`, `.`,
 * or `..`, so it cannot escape the store root via path traversal.
 */
export function normalizeHexKey(key: string): string {
  const lower = key.toLowerCase();
  if (!HEX_KEY.test(lower)) {
    throw new Error(`artifact key must be non-empty lowercase hex, got "${key}"`);
  }
  return lower;
}

/**
 * A content-addressed store for the off-chain resolution artifacts produced by a
 * completed cohort. Keyed by hex hash within each {@link ArtifactKind} namespace;
 * values are plain JSON (every artifact type is JSON-serializable). The resolver's
 * `provide()` is hash-guarded, so an untrusted store is safe: a wrong blob fails
 * the hash check rather than corrupting resolution.
 */
export interface ArtifactStore {
  /** Store `value` under `hashHex` in the `kind` namespace (idempotent overwrite). */
  put(kind: ArtifactKind, hashHex: string, value: unknown): Promise<void>;
  /** Retrieve the value at `hashHex`, or `undefined` if absent. */
  get(kind: ArtifactKind, hashHex: string): Promise<unknown>;
  /** True if `hashHex` is present in the `kind` namespace. */
  has(kind: ArtifactKind, hashHex: string): Promise<boolean>;
  /** All `[hashHex, value]` pairs in the `kind` namespace (order unspecified). */
  entries(kind: ArtifactKind): Promise<Array<[string, unknown]>>;
}

/** In-memory artifact store. The default for tests and the hermetic, no-persist path. */
export class MemoryArtifactStore implements ArtifactStore {
  readonly #maps = new Map<ArtifactKind, Map<string, unknown>>();

  #map(kind: ArtifactKind): Map<string, unknown> {
    let map = this.#maps.get(kind);
    if (!map) {
      map = new Map<string, unknown>();
      this.#maps.set(kind, map);
    }
    return map;
  }

  // Declared async so a key-validation failure surfaces as a rejected promise
  // (honoring the ArtifactStore contract), not a synchronous throw that a caller
  // using `.catch()` would miss.
  async put(kind: ArtifactKind, hashHex: string, value: unknown): Promise<void> {
    this.#map(kind).set(normalizeHexKey(hashHex), value);
  }

  async get(kind: ArtifactKind, hashHex: string): Promise<unknown> {
    return this.#map(kind).get(normalizeHexKey(hashHex));
  }

  async has(kind: ArtifactKind, hashHex: string): Promise<boolean> {
    return this.#map(kind).has(normalizeHexKey(hashHex));
  }

  async entries(kind: ArtifactKind): Promise<Array<[string, unknown]>> {
    return [...this.#map(kind).entries()];
  }
}

/**
 * Filesystem-backed artifact store. Each kind is a subdirectory under `root`; each
 * artifact is a `<hashHex>.json` file. Durable across restarts; the natural default
 * for a self-hosted aggregator that pins its cohorts' artifacts.
 */
export class FileSystemArtifactStore implements ArtifactStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #dir(kind: ArtifactKind): string {
    return join(this.#root, kind);
  }

  #file(kind: ArtifactKind, hashHex: string): string {
    return join(this.#dir(kind), `${normalizeHexKey(hashHex)}.json`);
  }

  async put(kind: ArtifactKind, hashHex: string, value: unknown): Promise<void> {
    const file = this.#file(kind, hashHex);
    await mkdir(this.#dir(kind), { recursive: true });
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  async get(kind: ArtifactKind, hashHex: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.#file(kind, hashHex), 'utf8'));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT = absent. ENAMETOOLONG = a key too long to name a file, so it can
      // never exist => also absent. Genuine operator faults (EACCES, EISDIR, ...)
      // still surface rather than being masked as a miss.
      if (code === 'ENOENT' || code === 'ENAMETOOLONG') {
        return undefined;
      }
      throw err;
    }
  }

  async has(kind: ArtifactKind, hashHex: string): Promise<boolean> {
    return existsSync(this.#file(kind, hashHex));
  }

  async entries(kind: ArtifactKind): Promise<Array<[string, unknown]>> {
    let names: string[];
    try {
      names = await readdir(this.#dir(kind));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
    const out: Array<[string, unknown]> = [];
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const key = name.slice(0, -'.json'.length);
      if (!isHexKey(key)) {
        continue;
      }
      out.push([key, JSON.parse(await readFile(join(this.#dir(kind), name), 'utf8'))]);
    }
    return out;
  }
}

/** Store a CAS announcement under its hex announcement hash. */
export function putAnnouncement(
  store: ArtifactStore,
  hashHex: string,
  value: CASAnnouncement,
): Promise<void> {
  return store.put('announcement', hashHex, value);
}

/** Store an SMT proof under its hex root hash. */
export function putProof(store: ArtifactStore, rootHashHex: string, value: SMTProof): Promise<void> {
  return store.put('proof', rootHashHex, value);
}

/** Store a signed update body under its hex canonical update hash. */
export function putUpdate(
  store: ArtifactStore,
  hashHex: string,
  value: SignedBTCR2Update,
): Promise<void> {
  return store.put('update', hashHex, value);
}

/** Store a genesis document under its hex hash (EXTERNAL onboarding). */
export function putGenesis(
  store: ArtifactStore,
  hashHex: string,
  value: Record<string, unknown>,
): Promise<void> {
  return store.put('genesis', hashHex, value);
}

/**
 * Export a store's contents as a resolver-ready {@link Sidecar} (the JSON the DID
 * controller can download and keep, or hand to `DidBtcr2.resolve(did, { sidecar })`).
 * The `Sidecar` is the array form the resolver post-processes into hex-keyed maps,
 * so extra entries are harmless: the resolver only consumes the artifacts whose
 * hash it actually needs. Pass `genesisHash` to include a specific genesis document
 * (EXTERNAL onboarding); otherwise it is omitted.
 */
export async function exportSidecar(
  store: ArtifactStore,
  opts: { genesisHash?: string } = {},
): Promise<Sidecar> {
  const updates = (await store.entries('update')).map(([, v]) => v as SignedBTCR2Update);
  const casUpdates = (await store.entries('announcement')).map(([, v]) => v as CASAnnouncement);
  const smtProofs = (await store.entries('proof')).map(([, v]) => v as SMTProof);

  const sidecar: Sidecar = { '@context': 'https://btcr2.dev/context/v1' };
  if (opts.genesisHash) {
    const genesis = await store.get('genesis', opts.genesisHash);
    if (genesis !== undefined) {
      sidecar.genesisDocument = genesis as object;
    }
  }
  if (updates.length > 0) {
    sidecar.updates = updates;
  }
  if (casUpdates.length > 0) {
    sidecar.casUpdates = casUpdates;
  }
  if (smtProofs.length > 0) {
    sidecar.smtProofs = smtProofs;
  }
  return sidecar;
}

/** URL path segment -> artifact kind. The segments are stable public route names. */
const KIND_BY_SEGMENT: Readonly<Record<string, ArtifactKind>> = {
  announcement: 'announcement',
  proof: 'proof',
  update: 'update',
  genesis: 'genesis',
};

/**
 * Upper bound on the route's `:hash` param. Every artifact hash is a sha256 digest
 * (64 hex chars); cap generously above that so an over-long (but still hex) key is
 * rejected at the boundary and never reaches the filesystem to trip ENAMETOOLONG.
 */
const MAX_ROUTE_KEY_LEN = 128;

/**
 * Mount the read-only artifact routes `GET /cas/{announcement,proof,update,genesis}/:hash`
 * onto a Hono app, returning the stored JSON by hex key (404 when absent). Mount
 * after the protocol (`/v1`) and `/dashboard` routes and before any SPA catch-all,
 * so it only serves the content-addressed namespace. Read-only by design: artifacts
 * are written by the aggregator from completed cohorts, never by clients.
 */
export function mountArtifactRoutes<E extends Env>(app: Hono<E>, store: ArtifactStore): void {
  app.get('/cas/:kind/:hash', async (c) => {
    const kind = KIND_BY_SEGMENT[c.req.param('kind')];
    if (!kind) {
      return c.json({ error: 'unknown artifact kind' }, 404);
    }
    const hash = c.req.param('hash');
    if (!isHexKey(hash) || hash.length > MAX_ROUTE_KEY_LEN) {
      return c.json({ error: 'hash must be hex' }, 400);
    }
    const value = await store.get(kind, hash.toLowerCase());
    if (value === undefined) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(value as Record<string, unknown>);
  });

  // Keep the /cas namespace self-contained: any other shape under /cas (wrong
  // segment count, bare prefix) is a 404 here, not a fall-through to a SPA
  // catch-all that may be mounted after these routes. The specific two-segment
  // route is registered first, so it still wins for a well-formed request.
  app.get('/cas', (c) => c.json({ error: 'not found' }, 404));
  app.get('/cas/*', (c) => c.json({ error: 'not found' }, 404));
}
