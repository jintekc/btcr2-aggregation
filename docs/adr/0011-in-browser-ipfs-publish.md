# ADR 0011: Opt-in IPFS publish - an in-browser Helia node with the coordinator as pinning convenience

- Status: Accepted
- Date: 2026-07-06
- Milestone: M3f (the "optional in-browser Helia publish" item locked by the M3b store
  decision and the M3-PLAN resolution-artifact-storage topology)

## Context

The M3b store lock (docs/M3-PLAN.md) fixed the resolution-artifact topology:
**participant opt-in publishing to IPFS (Helia), sidecar-export, or both** - the DID
controller can self-host; the coordinator "runs an IPFS node to pin opt-in content as
a convenience, but is not the sole host". Sidecar-export shipped first (M3b) as the
zero-infra default; the IPFS half was spiked (docs/M3b2-ipfs-cid-spike.md, RESOLVED/GO)
and deferred. The spike's load-bearing result: every did:btcr2 artifact key is
`sha256(JCS-canonicalize(artifact))` carried as a bare 32-byte digest, and the IPFS
**raw codec (0x55)** is a byte-identity transform, so
`CIDv1(raw, multihash(sha2-256, digest))` addresses the canonical JSON bytes with a
CID whose multihash digest is **byte-identical to the on-chain hex**. Anyone holding
the on-chain hash can derive the CID offline; a fetched block is self-verifying
against the on-chain commitment. (`@helia/json`, dag-json, and unixfs are categorically
unusable: they re-serialize or re-frame the bytes and break the digest identity.)

Three constraints shaped the implementation:

1. **The `helia` meta-package is unusable on Node here.** Its bundled default libp2p
   (`@helia/libp2p`) eagerly imports `@libp2p/webrtc -> node-datachannel`, a native
   N-API addon whose build script this repo's dependency-build policy refuses to run,
   so `import 'helia'` crashes at module load. (Verified against helia@7.0.5 tarballs;
   the import chain is eager even when a prebuilt libp2p instance is passed.)
2. **The web bundle rule (ADR 0002) predates this feature**: "packages/web imports no
   helia/blockstore". A publish feature in the SPA necessarily supersedes that -
   consciously, and without regressing the eager bundle.
3. **Digest identity does not hold for SMT proofs.** The resolver requests a proof by
   the cohort's shared SMT ROOT hash, while the store keys proofs by their member's
   update hash (per-DID, ADR 0007 era); the proof's own content hash equals neither.
   No on-chain-derivable CID can address a proof block.

## Decision

**Compose Helia from `@helia/utils` + `@helia/block-brokers` + a hand-configured
libp2p (the documented helia-v5 custom-node pattern) on BOTH sides, keep the browser
node behind a lazy chunk, and make the coordinator a pin-on-request convenience that
verifies every byte it stores.**

1. **Native-free composed stack, pinned to the helia-v5 line** (`@helia/utils@1.4.0`,
   `@helia/block-brokers@4.2.4`, `libp2p@2.10.0`, websockets/noise/yamux/identify):
   `new Helia({ libp2p, blockstore, datastore, blockBrokers: [bitswap()], routers: [] })`.
   Pure JS end to end - no webrtc, no native addons, and deliberately **no
   public-network machinery**: no DHT, no bootstrap peers, no relay, no delegated
   routing. Peers reach a node only by explicitly dialing it; bitswap asks connected
   peers directly, so `routers: []` costs nothing on this topology.
2. **Shared CID module (`packages/shared/src/ipfs.ts`, browser-clean).**
   `cidFromHashHex`/`hashHexFromCidString` implement the digest-identity mapping
   (golden-vectored against the spike); `buildPublishPlan` produces the controller's
   publish set with one uniform code path: the signed **update**, the CAS
   **announcement**, and the x1 **genesis** - whose canonical hash IS the DID's own
   commitment (`Identifier.decode(did).genesisBytes`), so for an x1 DID the genesis
   CID is derivable from the DID string alone. **SMT proofs are excluded by design**
   (constraint 3) and stay in the sidecar; the publish panel says so.
3. **Coordinator: injected `IpfsNode`, pin-on-request.** `createIpfsNode()` (service)
   listens on a localhost websocket (`IPFS=1`, optional `IPFS_DIR` for fs-backed
   durability, `IPFS_ANNOUNCE` for wss behind a TLS proxy) and is injected into
   `createService` like the Bitcoin connection - the caller owns the lifecycle.
   `GET /v1/ipfs` is mounted unconditionally (the SPA's cheap availability probe);
   `POST /v1/ipfs/pin { hashes }` (enabled only, bounded: <= 8 hashes, 4 KiB body,
   64-hex digests) pins each hash by preference order: already pinned -> **the
   coordinator's own artifact store** (bytes re-verified: a value that does not hash
   to the requested key - an SMT proof, a corrupt blob - is skipped rather than
   stored as a lying block) -> a block already held locally -> a **bounded bitswap
   fetch from connected peers** (the publishing browser). Outcomes carry the source
   (`store`/`network`/`local`/`already-pinned`) so tests can assert the real path.
4. **Browser: lazy Helia node, publish from the sidecar.** `lib/ipfs-node.ts` holds
   ALL heavy imports and is reached only via `await import(...)` on the explicit
   opt-in click - Vite splits it into its own chunk (~487 kB, ~143 kB gzip) and the
   eager bundle stays exactly as before (verified: zero helia/libp2p references in
   the eager chunk). The node is dial-only (browsers cannot listen), holds the plan's
   blocks in memory, and keeps serving them over bitswap until the round resets
   (teardown symmetry with the live participant). The store action builds the plan
   from the **sidecar** (the same artifact set the controller downloads), dials the
   probed multiaddr, publishes, then asks the coordinator to pin.
5. **No mainnet gate; discoverability is the point.** Publishing moves data, never
   funds. The artifacts were already served publicly by hex (`/cas/*`) and committed
   on-chain; IPFS adds derivable addressing, not new disclosure. Sidecar download
   remains the sovereign default hand-off.

## Consequences

- The full publish round-trip is proven twice, with a **path-unique signal** both
  times (the recurring false-green lesson): the coordinator's store already holds
  cohort updates/announcements, so only the **x1 genesis** - which the coordinator
  never holds - proves the browser->coordinator bitswap leg. `e2e:ipfs` (hermetic,
  gate check 15) asserts genesis `source: 'network'`, store-sourcing for the rest,
  bounded failure for an unknown digest, and the full circle: a third node fetches
  the genesis by the CID derived from the DID alone and verifies the commitment. The
  prod browser e2e drives the same flow through the real UI (lazy chunk in Chromium,
  ws dial, `pinned (network)` rendered). `e2e:config` covers the `IPFS=1` env form
  and the disabled-probe default; unit specs pin the golden CID vector, digest
  re-verification, and fs-store durability across a restart.
- ADR 0002's bundle-cleanliness rule is superseded in one precise way: helia/libp2p
  may exist in `packages/web` **only inside the lazy `ipfs-node` chunk**. The
  invariants that matter are unchanged, explicit, and now AUTOMATED (the prod
  browser e2e fails the gate on any of them): no `classic-level`/`@web5/dids`/quoted
  `node:` specifier anywhere in `dist`, no helia/libp2p/bitswap in the eager chunk,
  and the lazy `ipfs-node-*.js` chunk must exist (so removing the dynamic-import
  seam cannot pass silently).
- The pin route is an unauthenticated convenience with bounded cost per request
  (8 hashes, one bitswap session each, 15 s cap) and hash-verified content only. An
  operator who wants stricter admission (auth, allowlists, rate limits) fronts it
  with a proxy - the same posture as the rest of the demo surface. A browser tab is
  an ephemeral host by nature: durability comes from pinners (the coordinator, or
  any pinning service the controller hands the CID to), sovereignty from the sidecar.
- The helia-v5 line is not the newest major. That is deliberate (constraint 1): the
  composed pattern uses only documented public APIs, and moving to v7+ later means
  swapping the composition seam, not the on-wire format (bitswap and the CID
  construction are version-stable).
