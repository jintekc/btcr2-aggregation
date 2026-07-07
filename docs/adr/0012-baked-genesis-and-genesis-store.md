# ADR 0012: Baked-genesis EXTERNAL onboarding + membership-gated genesis persistence

- Status: Accepted
- Date: 2026-07-06
- Milestone: M3f (network matrix completion: `GenesisDocument.create` baked-beacon path + genesis store route)

## Context

ADR 0009 shipped EXTERNAL (`x1`) onboarding with a genesis that declares a
SingletonBeacon at the key's own P2TR address, and recorded what it left open:
baking a specific cohort's aggregate beacon address into an `x1` genesis at
creation time is impossible for an EPHEMERAL cohort, because the address is only
known after key aggregation. Two consequences stood until now:

1. A controller's FIRST aggregated update was never discoverable at the aggregate
   beacon (ADR 0007's chicken-and-egg): discovery only queries beacons already in
   the document, and the aggregate beacon is added BY the first update. The
   faithful workaround is a funded singleton registration transaction (ADR 0008).
2. An `x1` DID could not resolve over plain `GET /resolve/:did` at all: the
   coordinator never held any genesis (the store's `genesis` kind, its
   `GET /cas/genesis/:hash` route, and the resolve driver's store fallback all
   existed - with no writer), so `x1` resolution always needed the controller to
   POST its genesis as a sidecar.

The unlock is that MuSig2 key aggregation is non-interactive: the library's
`AggregationCohort.computeBeaconAddress()` is a pure function of the sorted
member public keys (BIP-327), the recovery parameters (`recoveryKey`,
`recoverySequence`, `fundingModel`, `fallbackThreshold`) and the network.
Participant DIDs and cohort/service ids are NOT inputs (probed and pinned by
spec). So an operator who fixes a ROSTER of keys can derive the aggregate beacon
address before any DID exists.

## Decision

1. **A baked genesis declares the pre-known aggregate beacon, and nothing else.**
   `buildBakedExternalGenesis(keys, beaconAddress, beaconType)` produces a genesis
   whose single service is the cohort's `CASBeacon`/`SMTBeacon` at the pre-derived
   address, with the `#beacon-<slug>` fragment an update would otherwise append.
   The verification methods and relationships are identical to the classic `x1`
   genesis, so transport bootstrap-auth (ADR 066) is unchanged. Both genesis
   shapes are now built through the library's `GenesisDocument.create` (the
   M3-PLAN vehicle); a spec pins the classic output deep-equal to the
   pre-refactor literal, so no existing `x1` DID drifts.

2. **Identity minting is `fromKeys`, deliberately.** There is no
   `createBakedExternalIdentity` that generates keys: the address is a function of
   ALL roster keys, so keys must exist before the address by construction
   (`bakedExternalIdentityFromKeys`, `importBakedExternalIdentity`). One secret
   therefore maps to MULTIPLE `x1` DIDs (the classic one, plus one per baked
   (address, type)); importing a bare secret as EXTERNAL in the web UI re-derives
   the CLASSIC DID. Baked identities are headless/operator-provisioned in this
   slice; the web is untouched.

3. **The address derivation lives in the service package with exact parity.**
   `deriveCohortBeaconAddress(config, memberPks)` constructs an
   `AggregationCohort` with precisely the fields the library service builds from a
   `CohortConfig` at advertise time and runs the library's own
   `computeBeaconAddress()` - never a reimplementation. The baked e2e asserts the
   pre-derived address equals the address the real cohort announces, and a
   golden-vector unit test pins the exact bech32m output so a caret-range library
   upgrade that changed the derivation would fail loudly rather than silently
   strand every baked genesis. It lives in the service package (not `shared`)
   because it is a server-side surface - `CohortConfig`-construction parity with
   `@did-btcr2/aggregation/service` - and because `shared`'s only reference to the
   aggregation package is `import type`/`export type` (`CohortConfig`,
   `SigningTxData`), so `shared` contributes no aggregation runtime to any bundle.
   (This is a layering choice, not a bundle-size one: the eager web chunk already
   ships `@did-btcr2/aggregation` core - `AggregationCohort`, `computeBeaconAddress`
   - via the participant runner it imports; that is pre-existing and unchanged.)

4. **A fixed roster is ENFORCED, not documented.** The address commits to the
   exact seated key set, so one interloper opt-in would silently invalidate every
   baked genesis and strand any pre-funding. `createService` gains `rosterPks`:
   an `onOptInReceived` gate (`decideRosterOptIn`) that accepts an opt-in only when
   its key is (a) BOUND to the authenticated sender - `participantPk` must equal
   `communicationPk`, which the transport cross-checks against the sender's genesis
   - (b) in the roster, and (c) not already seated this cohort. The binding is
   load-bearing: a baked roster's public keys are served in resolvable geneses, so
   without it a third party could present a roster member's `participantPk` under
   their own DID and seat a key nobody can sign for, stalling MuSig2 (a DoS); the
   uniqueness check stops a duplicate key from drifting the aggregate off the
   pre-derived address (the library sorts but does not de-duplicate cohort keys).
   Paired with `maxParticipants` on the config. The e2e races an interloper (itself
   a baked, self-consistent x1 whose genesis IS staged at auth) against the roster
   and asserts it never seats and its genesis is never persisted; a unit spec pins
   the forge/duplicate/non-member rejections directly.

5. **A mismatched baked identity DECLINES; it never throws mid-protocol.** The
   beacon address does not commit to the beacon TYPE, so a CAS-baked identity can
   be seated in an SMT cohort at the very same address; and a baked identity can
   be seated in a cohort other than the one it was baked for. Submitting in
   either case leaves the DID permanently unresolvable (the baked beacon reads
   signals of the wrong artifact kind, or the update strands at a beacon not in
   any document). Throwing is worse: the library runner catches an
   `onProvideUpdate` throw and sends NEITHER a submit NOR a decline, stalling the
   whole n-of-n cohort (forever, absent phase timeouts). So `classifyCohortFit`
   (`'append' | 'exit-ramp' | 'mismatch'`, decided on service type + endpoint,
   never fragment ids) drives the participant: on `'mismatch'` it returns `null`
   (the protocol's cooperative non-inclusion), records a reason
   (`getDeclineReason`), and everyone else's round completes. `buildSignedUpdate`
   still throws on `'mismatch'` as a direct-caller guard.

6. **A baked member's update appends a `#beacon-singleton` exit ramp.** The
   aggregate beacon is already in the genesis; re-appending it would duplicate
   the service (the library's JSON Patch `add /service/-` does not reject
   duplicate ids - verified). Instead the update appends a SingletonBeacon at the
   key's genesis P2TR address (on the DID's own decoded network): the
   controller's sovereign path for later updates once the ephemeral cohort
   disbands. Exactly the inverse of the classic flow, where the singleton is in
   the genesis and the update appends the aggregate.

7. **Genesis persistence is staged at bootstrap-auth, promoted at ACCEPTANCE.**
   An `x1` genesis crosses the coordinator exactly once per DID per process
   lifetime - on the bootstrap opt-in, at a seam that runs BEFORE the envelope
   signature, nonce, and rate-limit gates (and is never re-fed once the peer
   registers). Persisting there would let unauthenticated spam write to the
   durable store; waiting for `signing-complete` would let the same spam evict a
   legitimate staging entry minutes before it is read. So: a BOUNDED staging
   cache (`GenesisStagingCache`) captures baked geneses at auth, and the runner's
   `participant-accepted` event - operator-gated, bounded per cohort - promotes
   the member's genesis into the store via `persistMemberGenesis`, which
   RE-VERIFIES that the content hashes to the DID's commitment before writing
   (a content-addressed store never trusts a key it did not recompute).

8. **Only BAKED-shape geneses are auto-persisted (the privacy line).** A classic
   `x1` genesis maps its DID to the controller's PERSONAL funding address; with
   the CAS announcement already enumerating member DIDs publicly, auto-serving it
   would complete a deanonymization chain the controller never consented to - and
   would void the privacy stance of SMT cohorts specifically chosen to disclose
   only one's own leaf. A baked genesis is operator-authored for aggregator-served
   resolution and names only the SHARED cohort address. So the staging cache
   admits only geneses with an aggregate-type beacon service
   (`hasBakedAggregateBeacon`); classic `x1` resolution stays on the
   controller-supplied `POST /resolve/:did` sidecar path. Pinned by e2e: an
   accepted classic `x1` member's genesis is NOT in the store after its cohort.

9. **`POST /resolve/:did` still persists nothing.** A resolve body is
   self-verifying but unauthenticated and membership-free; persisting it would be
   an open, spammable write path (mint-a-DID, POST, repeat). Read-only it stays.

10. **No new HTTP routes.** `GET /cas/genesis/:hash` and the resolve driver's
    store fallback existed since M3b/M3d; this slice supplied the writer. The
    consequence: an accepted baked member's `x1` DID now resolves via plain,
    sidecar-less `GET /resolve/:did`, and its FIRST update is discovered at the
    baked aggregate beacon with no registration transaction - versionId 2 from a
    cold GET, proven over real HTTP in `e2e/baked-cohort.ts` for CAS and SMT.

## Consequences

- The onboarding matrix from the M3 plan is complete: KEY (self-bootstrap via
  funded singleton registration, ADR 0008), EXTERNAL-sidecar (ADR 0009), and
  EXTERNAL-genesis-baked (this ADR) all co-sign and all resolve.
- Non-member semantics differ by beacon type and are pinned in the e2e: a
  stranger baked at a live CAS address resolves (POST + sidecar) to version 1 -
  its DID is simply absent from the announcement; at an SMT address resolution
  fails closed (no proof exists for its leaf). The SMT cliff is inherent to
  store-backed proofs (only members' inclusion proofs are persisted).
- A declined baked member still co-signs (its key is in the roster the address
  commits to), but contributes no update; its genesis IS persisted (acceptance
  is the gate, not submission), so a later GET resolves it to version 1.
- The staging cache is deliberately lossy under adversarial flood (bounded); a
  missed promotion only degrades that member's `GET /resolve` to the sidecar
  POST path and logs loudly. The durable store grows only with ACCEPTED members,
  the same order as the existing per-cohort artifact growth.
- The gate grows to 16 checks (`e2e:baked`): fixed-roster CAS + SMT round-trips
  (parity, interloper rejection, persistence, cold-GET resolution, negatives)
  plus the mismatch-decline + privacy-line cohort.
