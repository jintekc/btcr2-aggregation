# ADR 0009: EXTERNAL (x1) onboarding - x1 co-signs and resolves as a first-class cohort member

- Status: Accepted
- Date: 2026-07-02
- Milestone: M3f (EXTERNAL onboarding), consuming the library fix shipped as `@did-btcr2/method@0.51.0` + `@did-btcr2/aggregation@0.4.0`

## Context

Scoping M3f surfaced a hard blocker in the published library: an EXTERNAL (`x1`)
did:btcr2 identifier could not authenticate over the aggregation **HTTP** transport,
so it was rejected `401` before it could opt in - only KEY (`k1`) DIDs could join a
cohort over HTTP. The root cause and the trustless fix are spec'd in
`docs/specs/x1-k1-transport-auth.md`; the fix landed in the library (its ADR 066) and
republished the packages above. The essence:

- An `x1` DID is `bech32m('x', [versionNetworkByte, ...sha256(canonical genesis)])` - a
  cryptographic **commitment to its genesis document**. A genesis supplied by an
  untrusted party is therefore self-verifying: re-hash it and compare to the DID.
- The aggregation **communication key** for an `x1` DID is the verification method
  referenced by `capabilityInvocation[0]` (`getAggregationCommunicationKey`), the exact
  relationship the method already enforces for DID updates. This yields the invariant
  *transport-authenticated as D implies authorized to update D*.
- The genesis rides **in-band on the opt-in** (`CohortOptInBody.genesisDocument`); the
  server bootstrap-authenticates a not-yet-registered `x1` sender from it with **zero
  trust** (no trust-on-first-use), cross-checking the advertised `communicationPk`
  against the genesis-derived key and bounding the body before hashing.

This ADR records how the **reference app** consumes that surface so an `x1` controller
is a first-class cohort member: it co-signs, its update lands in a real CAS/SMT
announcement, and it resolves - end to end, in Node and in the browser.

## Decision

1. **Model an `x1` identity in `shared`, keyed off a self-verifying genesis.**
   `Identity` gains an optional `genesisDocument`; `createExternalIdentity`
   (`importExternalIdentity` for the deterministic re-import) builds a genesis whose
   single Multikey is referenced by every relationship - so `capabilityInvocation[0]`,
   the aggregation communication key, **is** the identity keypair - and mints the `x1`
   DID committing to it (`GenesisDocument.toGenesisBytes` + `DidBtcr2.create`, EXTERNAL).
   The genesis is a pure function of the key, so the DID is deterministic.

2. **The `x1` genesis declares a SingletonBeacon at the key's genesis P2TR address.**
   That is the same address a KEY controller funds for its first-update registration
   (`genesisP2trBeaconAddress`, ADR 0008), so an `x1` controller's first aggregated
   update is discoverable through a beacon **already in its genesis** - resolution works
   the same way for both models (ADR 0007's discovery finding), no special case.

3. **`buildSignedUpdate` is genesis-aware; `k1` is byte-identical.** With a
   `genesisDocument` it resolves the current document via `Resolver.external(...)`; without
   one it takes the unchanged `Resolver.deterministic(...)` KEY path. Either way it signs
   with `capabilityInvocation[0]` (= `verificationMethod[0]` for both).

4. **The participant is isomorphic; nothing branches on the model.** `createParticipant`
   reads `identity.genesisDocument` and threads it to `AggregationParticipantRunner` (which
   puts it on the opt-in) and to `buildSignedUpdate`. A `k1` identity leaves it `undefined`,
   so the `k1` opt-in and update are unchanged.

5. **The service injects the genesis-aware resolver and bounds the bootstrap body.**
   `createService` passes `resolveSenderPk: resolveBtcr2SenderPk` (a `k1` sender still
   decodes from its DID; an unregistered `x1` sender bootstrap-authenticates from its
   opt-in genesis) and exposes an optional `maxBodyBytes` (default 64 KiB, the transport's
   own) so a large fake genesis is rejected `413` before it is parsed and hashed.

6. **`x1` resolution supplies the genesis in-band, and the resolver re-verifies it.** The
   coordinator does not hold a controller's genesis, so `GET /resolve/:did` (unchanged,
   `k1`) is joined by a new `POST /resolve/:did` carrying `{ genesisDocument }` (bounded 64
   KiB), resolved with that as the sidecar. The resolver re-verifies the genesis hashes to
   the DID (`Resolver.external` throws on mismatch), so a forged body cannot fabricate a
   resolution - a mismatched genesis returns a generic `502`. The browser sends the genesis
   only for `x1`; a `k1` resolve is still a plain `GET`.

7. **In-browser onboarding is a toggle.** `KeyGenPanel` offers KEY (`k1`) vs EXTERNAL
   (`x1`); the participant store generates/imports the chosen model and carries the genesis
   into the downloadable sovereign sidecar (`genesisDocument`, the `NeedGenesisDocument`
   artifact) for `x1`. The new `method` calls used to build/resolve a genesis
   (`GenesisDocument.toGenesisBytes`, `Identifier.decode`, `Resolver.external`) are sans-I/O,
   so the web bundle stays browser-clean (no `level`/`@web5/dids`, ADR 0007).

## Consequences

- `x1` and `k1` are now symmetric, first-class members over HTTP (and, per the library,
  in-memory and nostr). A mixed `k1`+`x1` cohort produces a valid aggregate signature,
  proven headless and in **both** browser topologies (attendee-B is an `x1` DID).
- **The ADR-0007 prize is reachable end to end:** an `x1` update lands in a real CAS/SMT
  announcement and resolves (`e2e/resolve-cohort.ts` runs `k1` and `x1` x CAS and SMT, the
  `x1` runs via a sidecar genesis). The aggregate-resolution needs
  (`NeedCASAnnouncement`/`NeedSMTProof`/`NeedGenesisDocument`) are now exercised by a real
  external controller, not just synthetic blobs.
- **Trustless, no TOFU.** A genesis that does not hash to the claimed DID authenticates
  nothing: it is rejected at opt-in (`401`) and at resolution (`502`). The headless
  negative probe models the realistic squatter - a **self-consistent** attacker (its own
  key + its own genesis) claiming the victim's DID - so the genesis-hash-to-DID binding is
  the *only* gate that can reject it; the test fails loudly if that binding regresses
  (rather than passing on the strength of the signature / `communicationPk` gates).
- **Still open (not solved here):** baking a *specific* ephemeral cohort's aggregate beacon
  address into an `x1` genesis at creation time is impossible - the address is known only
  after key aggregation. So "resolves on the very first update via a pre-baked aggregate
  beacon" still wants a standing / fixed-roster cohort; for now an `x1` first update
  resolves through its genesis SingletonBeacon exactly as a `k1` update does (item 2), or
  through a pre-baked beacon if the genesis carries one.
- **The other M3f items remain:** runtime browser-network injection (`GET /v1/config`, so
  the browser is not pinned to `DEFAULT_NETWORK` - ADR 0008 consequence), the mainnet guard
  rails on the live path, and optional in-browser Helia publish.
- **Dependency note:** the bump to `method@0.51.0` / `aggregation@0.4.0` (both published the
  same day) trips the repo's `minimumReleaseAge` supply-chain gate until the releases age
  past the cutoff; the versions are staged in `minimumReleaseAgeExclude`. Every existing
  `k1` flow is unchanged under the bump (typecheck, lint, 111 unit tests, all node + browser
  e2es green).
