# ADR 0007: Server-driven resolve driver, and how a first aggregated update is discovered

- Status: Accepted
- Date: 2026-07-01
- Milestone: M3d (resolve round-trip - the milestone Definition of Done)

## Context

M3d closes the loop: after a cohort co-signs and (optionally) broadcasts an
aggregate beacon transaction, a third party must be able to run
`DidBtcr2.resolve(participantDid)` and reconstruct the participant's updated DID
document, containing the appended `CASBeacon` / `SMTBeacon` service.

`@did-btcr2/method`'s `Resolver` is a sans-I/O state machine: the caller loops
`resolve()` / `provide()`, satisfying `DataNeed`s (`NeedBeaconSignals`,
`NeedCASAnnouncement`, `NeedSignedUpdate`, `NeedSMTProof`, `NeedGenesisDocument`).
We need a driver that wires those needs to the on-chain indexer and our
content-addressed artifact store, plus an HTTP entry point.

While building it we read the resolver's compiled source and ran a hermetic spike
against a real cohort. That spike overturned an assumption carried in the M3 plan
("a KEY DID's first aggregated update is one on-chain hop; the resolver re-discovers
the newly added beacon"). It is not. The finding is important enough to record here.

### The first-update discovery finding (empirically verified)

`Resolver` discovers beacon signals **only for beacon services already present in the
document under resolution** (`BeaconDiscovery` reads
`BeaconUtils.getBeaconServices(currentDocument)`; the live path passes exactly those
services to `BeaconSignalDiscovery.indexer`, which queries each beacon **address's**
transaction history for a trailing `OP_RETURN OP_PUSHBYTES_32 <hash>`).

- A KEY (`k1...`) DID's deterministic genesis document contains only the
  participant's own three **SingletonBeacons** (at their key's p2pkh / p2wpkh / p2tr
  addresses). It does **not** contain the cohort's aggregate CAS/SMT beacon.
- The aggregate beacon is **added by the very update we want to resolve**, and the
  aggregated update's on-chain signal lives at the **cohort** beacon address.
- Therefore the resolver never queries the cohort beacon address for a first update:
  the aggregate-announced first update is **undiscoverable**. Chicken-and-egg.

Spike results (real fixture cohort, faithful indexer emulation over a mock chain),
identical for CAS and SMT:

| On-chain signal placement | resolves the appended beacon? |
| --- | --- |
| Aggregate beacon address only | **No** (genesis doc only; beacon never added) |
| Genesis SingletonBeacon carries the update hash | **Yes** (update fetched from store, applied) |
| Both | **Error** (`sourceHash !== currentDocumentHash`: the genesis-anchored update cannot be discovered and applied twice) |

The faithful, spec-compliant way to make a controller's **first** update discoverable
is to publish it through a beacon that is already in the genesis document: a
`SingletonBeacon` signal (`OP_RETURN = sha256(canonical signed update)`) at one of the
controller's own genesis addresses. That first update adds the aggregate beacon;
**subsequent** updates ride it. The cohort's aggregate beacon transaction is what
enables those later aggregated updates - it is not what makes the first one
resolvable.

## Decision

1. **Add a server-driven resolve driver** `resolveBtcr2(did, { bitcoin, store,
   sidecar? })` (`packages/service/src/resolve.ts`). It constructs the resolver and
   drives it to completion, satisfying each need:
   - `NeedBeaconSignals` -> `BeaconSignalDiscovery.indexer(services, bitcoin)`.
   - `NeedCASAnnouncement` / `NeedSignedUpdate` / `NeedGenesisDocument` -> `store.get`
     by hex hash.
   - `NeedSMTProof` -> `selectSmtProof`: SMT proofs are stored per-DID (all proofs in
     a cohort share one root), so the driver scans the proofs at that root and returns
     the one that verifies for the resolved DID's leaf index - the same check
     `SMTBeacon.processSignals` runs, done first so `provide()` gets a proof that
     passes rather than one that throws.
   The loop is factored as `driveResolution(resolverLike, did, opts)` for direct unit
   testing with a scripted resolver, and has an iteration cap. `provide()` is
   hash-guarded by the resolver, so an untrusted store is safe.
2. **Expose `GET /resolve/:did`** (server-driven). Resolution pulls in
   `@did-btcr2/method`'s `@web5/dids -> level/classic-level` dependency chain, which
   must stay out of the browser bundle; the browser does one fetch and the server
   resolves. Mounted only when both a Bitcoin connection and a store are configured,
   before the SPA catch-all.
3. **Model first-update discovery through the genesis SingletonBeacon** in the DoD
   e2e (`e2e/resolve-cohort.ts`): run a real CAS and a real SMT cohort, persist the
   real artifacts, place the participant's real signed-update hash at their genesis
   P2TR SingletonBeacon on a mock chain, then assert the resolved document contains
   the appended aggregate beacon at the real cohort address - reconstructed from the
   persisted store. Hermetic (in the gate); a `LIVE=1` variant broadcasts and resolves
   over real esplora (operator-funded, manual).

## Consequences

- The resolve wiring (store keys, encodings, sidecar round-trip) is proven end to end
  for both beacon types; M3d's DoD is met honestly.
- The aggregate-beacon resolution path (`NeedCASAnnouncement` / `NeedSMTProof`) is
  covered by unit tests but is **not** exercised by a first-update round-trip, because
  it is not reachable for a first update (see the finding). It becomes reachable once
  the aggregate beacon is already in the document: either **EXTERNAL** onboarding (the
  beacon baked into genesis) or a **second** aggregated update after a first update
  registered the beacon. Both are M3f (onboarding models).
- Corrects the M3 plan's grounded fact #2. The `@did-btcr2/aggregation` protocol is
  unchanged; this is purely how a resolvable first update must be published.
- `selectSmtProof` pulls `@did-btcr2/smt` into the service as a direct dependency
  (already transitively present via `@did-btcr2/method`); the service is Node-only, so
  no browser-bundle impact.
