# M3b-2 spike: IPFS (Helia) publish + on-chain-hash to CID mapping

> Spike owner: M3b-2 (deferred, de-risked now). Status: **RESOLVED / GO**.
> Verified empirically against the installed tree (`multiformats@13.4.2`,
> `@noble/hashes@1.3.3`, `@scure/base@1.2.6`, `json-canonicalize@1.2.0`) and by
> source read of `@did-btcr2/common@9.1.0`, `@did-btcr2/aggregation@0.3.0`,
> `@did-btcr2/method@0.45.0`, `@did-btcr2/smt@0.3.0` under `node_modules/.pnpm/`.
> Produced by the M3b-2 research workflow (3 angles + synthesis).

## 1. Verdict

**Deterministic hex to CID is feasible. GO.** The mapping is the **identity on the
32-byte digest**: a resolver that knows only the on-chain hex hash can reconstruct
the exact CID with zero IPFS round-trip and zero network calls, using pure
`multiformats` primitives.

Root cause (verified): every did:btcr2 / aggregation store key is `sha256` over the
**JCS-canonicalized** (RFC 8785) JSON bytes of the artifact, stored/transported as a
**bare 32-byte digest** with no multihash prefix, no IPLD codec, and no block
framing.

- `@did-btcr2/common@9.1.0` `canonicalization.js`: `canonicalize()` =
  `json-canonicalize(JSON.parse(JSON.stringify(obj)))`; `hash()` =
  `sha256(canonicalString)`; `canonicalHashBytes(obj)` = the raw 32-byte digest;
  `canonicalHash(obj, {encoding:'hex'})` = its hex. (lines 41-119, source-confirmed)
- The IPFS **raw codec `0x55`** is a byte-identity transform (`raw.encode(bytes) ===
  bytes`, verified). So a `CIDv1(raw, multihash(sha2-256 0x12, <that same 32-byte
  digest>))` carries a multihash digest byte-identical to the on-chain hex.

Empirical proof (run against installed `multiformats@13.4.2` + `@noble/hashes@1.3.3`):

```
raw.code=0x55  json.code=0x200
canonical = {"a":{"b":2,"c":3},"m":"hi","z":1}
onchain   = 0f7bac401c7f249cd255bd68fe72bc9d769465d7785a09d1494fb142878af40f
mh.bytes  = 12200f7bac401c7f249cd255bd68fe72bc9d769465d7785a09d1494fb142878af40f
CID       = bafkreiappoweahd7esonevn5nd7hfpe5o2kglv3ylie5cskpwfbipcxub4
cid.multihash.digest === onchainHex  -> true        # identity holds
raw.encode identity                  -> true
json codec digest === onchainHex     -> false        # helia json is WRONG
json block = {"z":1,"a":{"c":3,"b":2},"m":"hi"}      # JSON.stringify, NOT JCS, keys unsorted
CID.parse -> mh.code 18 (0x12), size 32, codec 0x55
```

The negative result matters as much as the positive: the `json` (`0x0200`) and
`dag-json` (`0x0129`) codecs re-serialize via `JSON.stringify` (original key order),
so their block bytes differ from the JCS canonical bytes and their multihash will
**not** equal the on-chain hash. Therefore `@helia/json` and the JSON/dag-json codecs
are categorically unusable for digest identity; `@helia/unixfs` is also out (it
chunks + wraps in dag-pb, so the CID addresses a dag-pb root block, not
`sha256(content)`).

**Browser safety: confirmed.** Helia (libp2p + datastore + blockstore) stays
service-side. `packages/web/src` imports zero `multiformats`/`helia`/`blockstore`
today (grep: empty), and only the lightweight `multiformats` CID primitives (no
`node:crypto`, no libp2p) are ever needed in shared code. The fetch-by-hash read
route is a service endpoint regardless.

## 2. The mapping (exact multihash/CID construction + code)

Construction, given the on-chain hex hash (the value already in `signalBytes` for CAS
announcements / SMT roots, or `hex(decodeBase64UrlNoPad(...))` for a per-DID update
hash):

```
multihash = varint(0x12) || varint(0x20) || <32-byte digest>   # prefix 1220 + digest
CID       = CIDv1(codec=raw 0x55, multihash)                    # base32, starts "bafkrei"
```

Constants (all source-confirmed): sha2-256 = `0x12`; multihash length byte for 32 =
`0x20`; raw codec = `0x55`; avoid json `0x0200` and dag-json `0x0129`.

```ts
// packages/service/src/ipfs/cid.ts  (also safe to place in shared: pure, browser-clean)
import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';
import { raw } from 'multiformats/codecs/raw';
import { hex } from '@scure/base';

/** Build the canonical CIDv1(raw, sha2-256) for an on-chain hex digest. Identity on the digest, no hashing. */
export function cidFromOnChainHex(onChainHex: string): CID {
  const digest32 = hex.decode(onChainHex);           // 32 raw bytes, no re-hash
  if (digest32.length !== 32) throw new Error(`expected 32-byte digest, got ${digest32.length}`);
  const mh = Digest.create(0x12, digest32);          // wrap existing digest, sha2-256
  return CID.create(1, raw.code, mh);                // raw 0x55
}

/** Inverse: CID -> on-chain hex (for verifying a CID matches a beacon commitment). */
export function onChainHexFromCid(cid: CID): string {
  return hex.encode(cid.multihash.digest);
}
```

> WARNING: never derive the digest via `multiformats/hashes/sha2`. In `13.4.2` that
> module does `import crypto from 'crypto'` (source-confirmed, line 1) and is not
> browser-safe. The CID-build path does not need it: the digest is already known
> (on-chain hex) or comes from `@noble/hashes` (`sha256`), which is already a service
> dependency and is browser-safe. Use `@scure/base` `hex` for decode (already a
> transitive of `@did-btcr2/common`).

Where the hex comes from (encoding bridge, from `@did-btcr2/aggregation` `cohort.js` +
`@did-btcr2/method` `cas-beacon.js`, source-confirmed):

- **CAS announcement (whole map)**: `signalBytes = hash(canonicalize(announcement))`
  and the resolver keys `casMap` by `canonicalHash(announcement, {encoding:'hex'})`:
  same bytes. So `cidFromOnChainHex(hex(signalBytes))` addresses the canonical
  announcement JSON.
- **Per-DID update**: `announcement[did] = canonicalHash(signedUpdate)` in
  **base64urlnopad**. Bridge with `hex.encode(base64urlnopad.decode(announcement[did]))`
  first, then `cidFromOnChainHex(...)`, to address the canonical signed-update JSON.
- **SMT**: `signalBytes = tree.rootHash` (the SMT root) keys `smtMap`; per-leaf content
  is `encoder.encode(canonicalize(signedUpdate))`, same identity as CAS for the update
  bodies.

## 3. Helia API choice (with code)

Decision: **`helia.blockstore.put(cid, bytes)` with a precomputed raw CID**, not
`@helia/json`, not `@helia/unixfs`.

- `@helia/json` / json + dag-json codecs: re-serialize via `JSON.stringify` -> non-JCS
  bytes -> wrong digest. **Rejected** (empirically `false` above).
- `@helia/unixfs`: chunks + dag-pb wrap -> CID is a dag-pb root, not `sha256(content)`.
  **Rejected.**
- Raw blockstore `put`: stores the `Uint8Array` **verbatim** (CID -> bytes map, no
  transformation, no re-hash). With raw `0x55` + the exact JCS bytes we hashed, the
  stored block's hash equals the on-chain commitment by construction. **Chosen.**

Keep Helia minimal and offline-capable so it never becomes a libp2p server we do not
want. Suggested deps (server-only, install in `packages/service`): `helia` /
`@helia/http` (offline: empty `blockBrokers`/`routers`), `blockstore-fs` (durable
per-CID files, pure JS, no native bindings: `npm view` shows no
`level`/`classic-level`/`node-gyp`), `datastore-fs` (pin metadata persistence across
restarts), and an explicit `multiformats` `^13` pin.

```ts
// packages/service/src/ipfs/store.ts  (service-only; never imported by packages/web or the participant browser bundle)
import { createHelia } from 'helia';
import { FsBlockstore } from 'blockstore-fs';
import { FsDatastore } from 'datastore-fs';
import { canonicalize } from '@did-btcr2/common';
import { cidFromOnChainHex } from './cid.js';

export async function makeIpfsStore(dir: string) {
  const helia = await createHelia({
    blockstore: new FsBlockstore(`${dir}/blocks`),
    datastore:  new FsDatastore(`${dir}/data`),
    // offline-only: no blockBrokers/routers wired -> blockstore-only node, no public DHT advertise
  });
  return {
    /** Pin one artifact under its canonical CID. `artifact` is the same object did-btcr2 hashed. */
    async publish(artifact: unknown, onChainHex: string): Promise<string> {
      const bytes = new TextEncoder().encode(canonicalize(artifact)); // EXACT JCS bytes, not JSON.stringify
      const cid = cidFromOnChainHex(onChainHex);
      await helia.blockstore.put(cid, bytes);                          // verbatim store
      for await (const _ of helia.pins.add(cid)) { /* drain async generator */ }
      return cid.toString();
    },
    async get(onChainHex: string): Promise<Uint8Array> {
      return helia.blockstore.get(cidFromOnChainHex(onChainHex));
    },
    helia,
  };
}
```

> WARNING: `helia.pins.add(cid)` is an **async generator**; it must be fully drained
> (`for await ... of`) or the pin is not committed and the block can be GC'd.

> WARNING: pin the **same bytes did-btcr2 hashed**:
> `TextEncoder().encode(canonicalize(artifact))` via `@did-btcr2/common`. A
> re-stringified or pretty-printed copy yields a different digest and a dead CID. Add a
> unit test: `sha256(storedBytes) === hex.decode(onChainHex)` and a `put`/`get`
> round-trip per artifact type.

Browser participants cannot embed Helia (the participant bundle is browser-targeted).
They publish via an authenticated HTTP route on the service node (or a remote
pinning-service API), or fall back to sidecar-export. The hex->CID derivation itself
(`cidFromOnChainHex`) is pure `multiformats` and browser-safe, so the **read** side
("here is the on-chain hash, give me the CID / gateway URL") works isomorphically.

## 4. Sidecar-export as the safe default + how IPFS complements it

Ship **sidecar-export first as the default**; make IPFS **opt-in**. Rationale:
sidecar-export needs no new heavyweight dependency, no network, no GC/pinning
lifecycle, and is already the resolution path the SDK expects (`SidecarData = {
updateMap, casMap, smtMap }`, all **hex-keyed**). It keeps the hermetic CI gate green
with zero infra, and it is the sovereign minimum: the DID controller hands the resolver
exactly the bytes needed. (M3b-1 already ships this via `exportSidecar` producing the
resolver's `Sidecar` array form.)

IPFS complements (does not replace) sidecar:

- **Sidecar** = the authoritative, zero-infra hand-off; the resolver `provide()` is
  independently hash-guarded (validates the provided announcement/update against the
  need's hash), so the source is untrusted-safe.
- **IPFS** = public discoverability: a third party who only has the on-chain hex can
  derive the CID (Section 2) and fetch the blob from any gateway / the service's read
  route without a prior sidecar hand-off. Because the CID is identity-on-digest, **the
  same map that builds the sidecar builds the IPFS pin set**: no separate hashing pass.
- Recommended manifest: alongside each publish, persist a small `hex -> CID` manifest
  (and optionally CIDs handed to a remote pinning service). This is bookkeeping, not a
  trust anchor: the CID is always re-derivable from the hex.

Topology: store = participant opt-in publishing to **IPFS (Helia) OR sidecar-export OR
both** (per the M3b lock). Default path = sidecar; `--ipfs`/config flag enables Helia
on the service node; browser participants reach IPFS only via the service route or a
pinning API.

## 5. Pitfalls + mitigations

1. **Wrong codec.** `@helia/json` / json `0x0200` / dag-json `0x0129` use
   `JSON.stringify` (unsorted keys) -> digest not equal to on-chain (empirically
   `false`). Mitigation: raw codec `0x55` only.
2. **Wrong primitive.** `@helia/unixfs` chunks + dag-pb-wraps -> CID is a dag-pb root.
   Mitigation: `blockstore.put` raw path only.
3. **Wrong bytes.** Re-stringified / pretty-printed JSON breaks identity. Mitigation:
   always `TextEncoder().encode(canonicalize(artifact))` from `@did-btcr2/common`;
   unit-test `sha256(bytes) === digest` + round-trip.
4. **Encoding bridge.** CAS announcement per-DID values are **base64urlnopad**;
   `signalBytes` and all sidecar map keys are **hex**. Mitigation: build the CID from
   the **hex** 32-byte digest; decode base64urlnopad announcement values to bytes first.
5. **Browser-unsafe sha2.** `multiformats/hashes/sha2` (`13.4.2`) imports `node:crypto`.
   Mitigation: never import it in shared/browser code; source digests from the on-chain
   hex or `@noble/hashes`.
6. **Un-drained pin.** `helia.pins.add` is an async generator. Mitigation: drain with
   `for await ... of`; verify with `helia.pins.isPinned(cid)`.
7. **multiformats version skew.** Three copies present in the tree (`12.1.3`, `13.1.0`,
   `13.4.2`). A v12 resolution would be a different package instance. Mitigation: add an
   explicit `"multiformats": "^13"` to `packages/service` (and dedupe Helia's transitive
   to the same major). CID/digest/raw API is stable across `13.x`.
8. **Restart durability.** In-memory blockstore loses pins on restart. Mitigation:
   `blockstore-fs` + `datastore-fs` (pure-JS, no native bindings: no
   `level`/`classic-level`/`node-gyp`, so the M2 browser hazard does not recur; and
   these are service-only anyway).
9. **Accidental browser leak of Helia.** Mitigation: keep all of
   Helia/libp2p/blockstore strictly under `packages/service`; keep `cidFromOnChainHex`
   in a pure module (shared/service-pure) and assert in the web e2e/grep that
   `packages/web` imports no `helia`/`blockstore` (currently clean).
10. **Blockstore CID verification on get.** Some blockstores verify `CID == hash(bytes)`
    on read. With raw `0x55` + verbatim canonical bytes this passes by construction,
    which is a feature: it proves the served blob matches the on-chain commitment.

## 6. Concrete M3b-2 task list

1. **Pin versions.** Add `"multiformats": "^13"` to `packages/service/package.json`;
   plan `helia`, `@helia/http` (or `helia`), `blockstore-fs`, `datastore-fs` as
   service-only deps; dedupe Helia's `multiformats` to `^13`. (Defer the actual Helia
   install until the IPFS path is wired; the CID module needs only `multiformats` +
   `@scure/base`.)
2. **CID module (pure, shared-safe).** Implement `cidFromOnChainHex` /
   `onChainHexFromCid` (Section 2) in a module with no `node:` imports. Unit-test
   against the Section 1 vector (`0f7bac... ->
   bafkreiappoweahd7esonevn5nd7hfpe5o2kglv3ylie5cskpwfbipcxub4`) and `CID.parse`
   round-trip (mh.code 18, size 32, codec 0x55).
3. **Canonical-bytes helper + golden test.** Wrap
   `TextEncoder().encode(canonicalize(artifact))`; assert `sha256(bytes) ===
   hex.decode(canonicalHash(artifact,{encoding:'hex'}))` for a CAS announcement, a
   per-DID signed update, and an SMT leaf, harvested from a completed fixture cohort via
   `runner.session.getCohort(id).{casAnnouncement, pendingUpdates, signalBytes,
   smtProofs}` (per the M3b harvest spike).
4. **Encoding-bridge util.** `hexFromAnnouncementValue(b64url)` =
   `hex.encode(base64urlnopad.decode(b64url))`; cover with the cohort's real
   announcement values.
5. **Service IPFS store (opt-in, gated).** Implement `makeIpfsStore` (Section 3) behind
   a config/CLI flag; offline Helia + `blockstore-fs`/`datastore-fs`; `publish()` drains
   `pins.add`; `get()` by hex. Unit-test put/get round-trip + `isPinned`. Implement it as
   an `ArtifactStore` (M3b-1 interface) so the existing `/cas/*` routes serve it
   unchanged.
6. **Sidecar-export stays the default path.** M3b-1's `exportSidecar` already produces
   the resolver `Sidecar`; keep it as the no-IPFS resolution hand-off and the CI-green
   baseline.
7. **hex -> CID manifest.** On publish, persist a small `{hex: cid}` manifest (and any
   remote-pinning-service receipts); treat as bookkeeping, re-derivable from hex.
8. **Read route.** The M3b-1 `GET /cas/:kind/:hash` already serves by hex; for IPFS,
   derive the CID and serve the pinned block (or sidecar map entry); 404 on miss.
   `cidFromOnChainHex` also lets clients build a gateway URL directly.
9. **Browser-leak guard.** Extend the web e2e / a lint check to assert `packages/web`
   and the participant browser bundle import no
   `helia`/`blockstore`/`multiformats/hashes/sha2`.
10. **Keep the gate hermetic.** All IPFS wiring stays behind the opt-in flag; the
    fixture/sidecar path remains the default so the existing gate stays green with no new
    infra.
