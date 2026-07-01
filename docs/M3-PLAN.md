# M3 Plan: Live, resolvable aggregation (both beacons) - btcr2-aggregation

> Read [PROJECT-CONTEXT.md](./PROJECT-CONTEXT.md) and [SCAFFOLD-PLAN.md](./SCAFFOLD-PLAN.md)
> first. This document is the executable spec for Milestone 3. It is grounded in
> two research passes (11 agents) read against the installed `@did-btcr2/*` types in
> `node_modules`; verify every exact signature against
> `node_modules/.pnpm/@did-btcr2+*/.../dist/types` (and `src` where shipped) as you
> build, and do not guess a property: check the type.

## What this project is (read this first)

btcr2-aggregation is the canonical, production-grade **reference application** of the
full `@did-btcr2/aggregation` stack over the HTTP/REST transport: anyone can
self-host it and run a **real** aggregator service (and join as a participant) over
the public internet. It is **not** a conference/booth/event demo. Every M3 decision
is made for a faithful, self-hostable, correct aggregator, not a throwaway showcase.

## Goal of Milestone 3

Turn the M1/M2 fixture flow into a faithful, live, **resolvable** aggregator:

- A cohort goes from join through n-of-n MuSig2 co-signing to a **real beacon
  transaction broadcast and confirmed** on a configurable Bitcoin network.
- It works for **both** `CASBeacon` and `SMTBeacon` cohorts.
- The off-chain resolution artifacts are published so that **any third party** can
  run `DidBtcr2.resolve(did)` and reconstruct the participant's updated DID
  document, for both beacon types.
- The existing 8/8 hermetic gate (typecheck, lint, vitest, M1 e2e, M2 dev+prod
  browser e2e) stays green throughout: all live wiring is opt-in; the fixture path
  remains the zero-chain default.

## Locked decisions (2026-06-30)

1. **Beacon types**: support **both** `CASBeacon` and `SMTBeacon`, chosen per cohort
   via `CohortConfig.beaconType`. SMT's payoff is **privacy** (a CAS announcement
   discloses every cohort member's DID + update hash to any resolver; an SMT proof
   discloses only the resolved DID's own leaf).
2. **Resolution artifact storage**: **participant opt-in** publishing to **IPFS
   (Helia)**, **sidecar-export** (downloadable JSON), or **both**. The DID
   controller decides where their resolution data lives. The aggregator may run an
   IPFS node to pin opt-in content as a convenience, but is not the sole host. The
   resolver's `provide()` is hash-guarded, so any retrieval source is
   untrusted-safe.
3. **Onboarding**: **both first-class**. KEY-DID self-bootstrap is the default
   (one on-chain hop: the first aggregated update both adds the beacon service and
   is announced). EXTERNAL-genesis-baked is offered for bring-your-own /
   pre-provisioned DIDs (the aggregate beacon is in genesis; resolution carries a
   sidecar `genesisDocument`).
4. **Network**: full config-driven matrix - **regtest** (hermetic CI live-path),
   **mutinynet** (public default), **mainnet** (first-class, guarded). The
   **fixture** path stays the zero-chain CI default; live wiring is opt-in behind a
   `LIVE` flag + an injected `BitcoinConnection`. The cohort beacon UTXO is
   **operator-funded** (the public mutinynet faucet cannot be scripted: it is
   GitHub-OAuth-gated with a 1M-sat/request cap, so the operator pre-funds a wallet
   out-of-band).
5. **No protocol-code changes.** Everything is wiring against shipped APIs.

## Grounded facts the build relies on

The three findings that make resolvable + both-beacon support tractable:

1. **Beacon type is one switch.** `CohortConfig.beaconType: 'CASBeacon' | 'SMTBeacon'`
   (`KNOWN_BEACON_TYPES`, `conditions.d.ts:19`; field typed `string`). The same
   `AggregationServiceRunner`, `AggregationParticipantRunner`, `onProvideTxData`, and
   `buildAggregationBeaconTx` drive both. `buildAggregationBeaconTx` is
   beacon-agnostic: it takes only a 32-byte `signalBytes` and never inspects the
   beacon type. The cohort builds the CAS announcement map (`buildCASAnnouncement()`,
   `signalBytes = sha256(canonicalize(map))`) or the SMT tree (`buildSMTTree()`,
   `signalBytes = BTCR2MerkleTree root`) **internally** via `@did-btcr2/smt`. The app
   builds neither.
2. **KEY-DID resolvable update is one on-chain hop.** `Updater.construct` imposes no
   beacon-pre-existence check, so a fresh `k1` DID's first aggregated update both
   adds the CAS/SMT beacon service (`add /service/-`) and is announced in that single
   aggregate tx; the resolver re-discovers the newly added beacon in a later round
   (`maxDiscoveryRounds=10`). No mandatory per-participant singleton bootstrap.
3. **Resolution artifacts come from the cohort accessor, not the result.**
   `AggregationResult` (the `signing-complete` payload: `{ cohortId, signature,
   signedTx, path? }`) does **not** carry the announcement/proof. They live on
   `runner.session.getCohort(cohortId)`. **This is the highest-risk gotcha: a naive
   `signing-complete` handler persists nothing and resolution silently fails.**

**Harvest spike result (RESOLVED 2026-06-30, hermetic - `runner.session.getCohort`
introspected after a completed fixture CAS cohort).** Confirmed accessors on the
`AggregationCohort`:
   - `cohort.pendingUpdates: Map<DID, SignedBTCR2Update>` - the per-member signed
     update bodies for `updateMap` / `NeedSignedUpdate`. Each value is
     `{ '@context', patch, targetHash, targetVersionId, sourceHash, proof }`. (Despite
     the name, these persist post-completion.)
   - `cohort.casAnnouncement: Record<DID, base64url updateHash>` (CAS cohorts).
   - `cohort.smtProofs: Map<DID, SerializedSMTProof>` (undefined for CAS; populated by
     `buildSMTTree()` for SMT cohorts).
   - `cohort.signalBytes: Uint8Array(32)` (the OP_RETURN signal / store key seed).
   - `cohort.internalKey: Uint8Array(32)` - the x-only aggregate; pass this straight
     to `buildAggregationBeaconTx` as `internalPubkey` (no recompute from
     `cohortKeys` needed). `cohort.tapTweak`, `cohort.tapMerkleRoot`,
     `cohort.beaconAddress` (already `tb1p…`), `cohort.recoveryKey`,
     `cohort.recoverySequence`, and `cohort.fundingModel` ("operator-funded") are also
     present.
   - Encoding bridge to pin: `casAnnouncement` values are base64urlnopad update
     hashes, but the resolver's `NeedSignedUpdate.updateHash` and the store keys are
     **hex**. Key `updateMap` by `hex(decodeBase64UrlNoPad(casAnnouncement[did]))`;
     key `casMap`/`smtMap` by `hex(signalBytes)`.

Supporting API facts (verbatim signatures to verify against `node_modules`):

- `participant events.d.ts:10-20`: `interface CohortCompleteInfo { cohortId: string;
  beaconAddress: string; beaconType: string; included: boolean;
  casAnnouncement?: Record<string,string>; smtProof?: SerializedSMTProof }` (the two
  optionals are mutually exclusive, discriminated by `beaconType`). Emitted as
  `'cohort-complete': [CohortCompleteInfo]`.
- `method beacon.d.ts:153-176`: `buildAggregationBeaconTx(opts: { beaconAddress:
  string; internalPubkey: Uint8Array /*32 x-only*/; signalBytes: Uint8Array /*32*/;
  bitcoin: BitcoinConnection; network: BTCNetwork; feeEstimator?: FeeEstimator;
  changeAddress?: string }): Promise<BeaconTxPlan>`, where `BeaconTxPlan` is a
  structural superset of `SigningTxData { tx, prevOutScripts, prevOutValues }`.
- `service-runner.d.ts:20-30`: `OnProvideTxData = (info: { cohortId; beaconAddress;
  signalBytes; feeEstimator }) => Promise<SigningTxData>` (async: can await funding +
  confirmation). `internalPubkey` is not in the info, derive it from
  `getRunner().session.getCohort(cohortId)` (the aggregate x-only key /
  `cohort.internalKey`), mirroring how the fixture reads `cohort.cohortKeys`.
- `@did-btcr2/bitcoin@0.8.0`: `new BitcoinConnection({ network: NetworkName, rest: {
  host: string } })` then `conn.rest.address.getUtxos(addr): Promise<AddressUtxo[]>`,
  `conn.rest.transaction.send(rawHex): Promise<txid>` (POST /tx, hex not bytes),
  `conn.rest.transaction.isConfirmed(txid): Promise<boolean>`, `conn.rest.block.count():
  Promise<number>`. `getNetwork('mutinynet') -> TEST_NETWORK` (tb1p). No
  `/fee-estimates` client exists; only `StaticFeeEstimator(satsPerVbyte=5)`.
- `method resolver.d.ts:27-63,179-183`: `DidBtcr2.resolve(did, { sidecar?, versionId?,
  versionTime?, maxDiscoveryRounds? })` returns a sans-I/O `Resolver`; loop
  `resolve()`/`provide()`. `DataNeed = NeedGenesisDocument | NeedBeaconSignals |
  NeedCASAnnouncement{announcementHash} | NeedSignedUpdate{updateHash} |
  NeedSMTProof{smtRootHash}` (hashes are hex). `provide()` overloads validate the
  payload hash against the on-chain signal. `BeaconSignalDiscovery.indexer(services,
  BitcoinConnection)` fetches the on-chain signals over esplora.
- `method core/types.d.ts`: `SidecarData = { updateMap: Map<hex, SignedBTCR2Update>;
  casMap: Map<hex, CASAnnouncement>; smtMap: Map<hex, SMTProof> }`; `Sidecar` (input)
  `= { genesisDocument?, updates?, casUpdates?, smtProofs? }`.
- `@did-btcr2/smt`: exports `BTCR2MerkleTree`, `verifySerializedProof`, `didToIndex`,
  `SerializedSMTProof` (id = root, `nonce` REQUIRED, `updateId`, `collapsed`,
  `hashes`). The on-chain SMT root **is** `proof.id`.
- `@did-btcr2/api` is **not** installed: there is no off-the-shelf CAS host; the
  reference implements its own publish/retrieve (Helia + sidecar).

## CAS vs SMT: the only differences the app handles

Byte-identical across types: MuSig2 key aggregation, `beaconAddress`,
`internalPubkey`, `buildAggregationBeaconTx`, `onProvideTxData` wiring, broadcast, and
the `recoveryKey`/`recoverySequence`/`network`/`minParticipants` config. The cohort
builds the artifact internally for either type. The differences:

| Step | CASBeacon | SMTBeacon |
| --- | --- | --- |
| `signalBytes` | `sha256(canonicalize(announcement map))` | `BTCR2MerkleTree` root |
| Service accessor after `signing-complete` | `cohort.casAnnouncement` | `cohort.smtProofs` |
| Participant `cohort-complete` artifact | `info.casAnnouncement` (full map) | `info.smtProof` (this DID's `SerializedSMTProof`, incl. required `nonce`) |
| Submitted-update service `type`/id | `CASBeacon` / `#beacon-cas` | `SMTBeacon` / `#beacon-smt` |
| Store value keyed by hex `signalBytes` | the `CASAnnouncement` | the `SMTProof` (verbatim) |
| Resolve verification | structural `casMap[hash]` hit, decode base64url updateHash | full `verifySerializedProof(proof, didToIndex(did), candidateHash)` against the on-chain root |
| Non-inclusion (decliner) | absence from the map | explicit non-inclusion leaf `sha256(sha256(nonce))` |
| Disclosure | all cohort DIDs + update hashes | only the resolved DID's leaf (privacy) |

Both also emit `NeedSignedUpdate` after the announcement/proof, so `updateMap`
entries (the signed update bodies, keyed by hex canonical update hash) must be
persisted for **both** types.

## Integration delta (dependency-ordered, file by file)

Keep `buildFixtureTxData` and the fixture `makeProvideTxData` as the default. All new
behavior is opt-in.

1. `packages/shared/src/index.ts` - `buildCohortConfig(participants, beaconType =
   'CASBeacon')`: set `beaconType` on the returned config instead of the hardcoded
   literal (line 69). Foundational; do first.
2. `packages/shared/src/index.ts` - `buildSignedUpdate(..., beaconType)`: append a
   service `{ type: beaconType, id: \`${did}#beacon-${slug}\` }` (slug `cas`|`smt`)
   instead of the hardcoded `CASBeacon`/`#beacon-cas` (lines 99-101). Distinct
   fragment ids so a doc that ever rides both cohorts never collides on `/service/-`.
3. `packages/shared/src/index.ts` - new `buildBeaconTxData({ internalPubkey,
   signalBytes, beaconAddress, bitcoin, network, feeEstimator, changeAddress? })` that
   calls `buildAggregationBeaconTx` (not the fixture). `internalPubkey =
   musig2.keyAggExport(musig2.keyAggregate(cohortKeys))`. Leave `buildFixtureTxData`
   untouched.
4. `packages/shared/src/networks.ts` (new) - a `NetworkName ->
   { esploraHost, scureNetwork }` registry for `regtest | mutinynet | mainnet`
   (extensible to signet/testnet). Replaces the bare `NETWORK` const with a
   config-driven selector; `getNetwork(name)` from `@did-btcr2/bitcoin` resolves the
   `@scure/btc-signer` params. mainnet entries are guarded with explicit
   warnings/opt-in.
5. `packages/service/src/tx.ts` - `makeProvideTxData`: forward `feeEstimator` (today
   dropped) and branch live vs fixture; when live, compute `internalPubkey` from
   `cohort.cohortKeys` and return `buildBeaconTxData(...)`. Pre-flight
   `bitcoin.rest.address.getUtxos(beaconAddress)` and throw a clear surfaced error if
   empty.
6. `packages/service/src/index.ts` - widen `CreateServiceOptions` with optional
   `bitcoin?: BitcoinConnection`, `feeEstimator?`, `live?: boolean` (default false),
   `broadcast?: boolean`, `store?`. Forward `feeEstimator` into the runner (currently
   never passed); select live vs fixture in the `makeProvideTxData` call. All
   optional so headless M1 is unaffected.
7. `packages/service/src/store.ts` (new) - content-addressed artifact store. `put`/`get`
   keyed by hex hash: `casMap[announcementHash]`, `smtMap[rootHash]`,
   `updateMap[updateHash]` (+ `genesisMap[genesisHash]` for EXTERNAL). Backends:
   filesystem (default) + Helia/IPFS publish + sidecar-export serializer. The
   participant chooses publish targets (IPFS / sidecar / both) per update; the
   aggregator pins opt-in IPFS content. Spike the on-chain-hex-hash to IPFS-CID
   mapping (sha2-256 multihash) so a resolver can fetch by content hash.
8. `packages/service/src/broadcast.ts` (new) + `index.ts` wiring - on
   `runner.on('signing-complete', result)`, when live+broadcast:
   `conn.rest.transaction.send(result.signedTx.hex)`, poll `isConfirmed(txid)`; then
   read `runner.session.getCohort(result.cohortId).{casAnnouncement | smtProofs |
   signalBytes}` and the per-member signed updates, and persist to the store.
   **Artifacts come from the cohort accessor, not `AggregationResult`.** Broadcast
   keys off `result.signedTx.hex`, not `result.signature` (script-path/k-of-n
   fallback has an empty signature but a full signed tx).
9. `packages/service/src/hono-adapter.ts` - mount read-only `GET
   /cas/{announcement,proof,update,genesis}/:hash` returning stored JSON by hex key,
   before the trailing SPA `app.get('*')` and after `/v1` + `/dashboard`.
10. `packages/service/src/resolve.ts` (new) - `resolveBtcr2(did, { bitcoin, store,
    sidecar? })` driver loop around `DidBtcr2.resolve`: `NeedBeaconSignals ->
    BeaconSignalDiscovery.indexer`; `NeedCASAnnouncement/NeedSMTProof/NeedSignedUpdate
    -> store.get / sidecar / IPFS by hash -> provide()`; `NeedGenesisDocument ->`
    EXTERNAL only. Expose `GET /resolve/:did` so the browser does one fetch.
11. `packages/service/src/dashboard-sse.ts` - extend the `signing-complete` serializer
    (or add a `beacon-anchored` frame) with the broadcast txid + a `persisted` flag so
    the dashboard shows "anchored on-chain" + an explorer link.
12. `packages/participant/src/index.ts` - thread `beaconType` to `buildSignedUpdate` in
    `onProvideUpdate`. No protocol change.
13. `packages/web/src/stores/participant.ts` - capture **both** `info.casAnnouncement`
    and `info.smtProof` into a durable per-DID sidecar (today only counts
    `casAnnouncement`, line 244); add the publish-target opt-in (IPFS / sidecar /
    both).
14. `packages/web/src/lib/resolve.ts` (new) + `ResolvePanel` - a "Resolve this DID"
    action, server-driven via `GET /resolve/:did` first (avoids dragging
    `level/classic-level` into the browser bundle); render the reconstructed document.
15. `e2e/headless-cohort.ts` + `.spec.ts` + `package.json` - parameterize
    `beaconType`; add an SMT variant asserting `cohort-complete` carries `smtProof`.
    Keep the CAS run as the default `pnpm e2e`; add `e2e:smt`.
16. `e2e/resolve-cohort.ts` (new) - run a cohort (CAS and SMT), capture sidecar, drive
    `resolveBtcr2`, assert the resolved doc contains the appended beacon service. The
    real-broadcast variant is gated behind `LIVE=1` + a `BitcoinConnection` (regtest in
    CI, mutinynet manual). **This is the milestone definition of done.**

## Phasing

- **M3a - beaconType parameterization (no chain). DONE & VERIFIED 2026-06-30.** Items 1,
  2, 12, 15 + the network registry skeleton (4). Default CAS, fixture unchanged, pure
  wiring, zero new runtime deps. Shipped: `packages/shared/src/networks.ts` (a
  `NetworkName -> NetworkConfig` registry for bitcoin/mutinynet/signet/testnet3/testnet4/
  regtest built on `@scure/btc-signer/utils` `NETWORK`/`TEST_NETWORK` - NOT the
  `@did-btcr2/bitcoin` barrel, so the web bundle stays browser-clean - plus
  `resolveNetwork`, `isNetworkName`, and an `assertNetworkAllowed` mainnet guard;
  `DEFAULT_NETWORK='mutinynet'`, and `NETWORK` now aliases it); a `BeaconType =
  'CASBeacon'|'SMTBeacon'` union; `buildCohortConfig(n, beaconType='CASBeacon')` and
  `buildSignedUpdate(..., beaconType='CASBeacon')` with DISTINCT `#beacon-cas` vs
  `#beacon-smt` service fragments. The participant derives the beacon type from the
  JOINED ADVERT (the only correct source: `OnProvideUpdate` info is just
  `{cohortId,beaconAddress}` with no type, but `shouldJoin` sees the full
  `CohortAdvert.beaconType`, captured into a `cohortId->type` map), with the
  `CreateParticipantOptions.beaconType` option as a defensive fallback default. The
  headless e2e is parameterized (`runHeadlessCohort({beaconType})`, a `--smt` flag, and
  it now captures each `cohort-complete` payload and asserts the artifact - `cas` vs
  `smt` - matches the configured type); added `e2e:smt` (root + e2e package.json) and a
  second SMT vitest spec. **Empirical proof both beacon types complete in the
  zero-chain fixture path: an SMT cohort reaches a 64-byte aggregated Taproot signature
  and every participant receives a real `smtProof` (the cohort builds the SMT tree
  internally via `@did-btcr2/smt`).** Full gate now 7 checks, all green (typecheck,
  lint, vitest CAS+SMT, e2e CAS, e2e:smt SMT, e2e:browser dev, e2e:browser:prod). An
  adversarial review workflow (4 dimensions x find->2-skeptic-verify) confirmed zero
  real defects. The **hermetic harvest spike** (below) was already done.
- **M3b - durable store + publish/retrieve (no chain).** Items 7, 9. Filesystem +
  sidecar-export first, then Helia/IPFS publish + the CID mapping spike. Testable with
  synthetic blobs.
- **M3c - live beacon tx + broadcast + persist (opt-in chain).** Items 3, 5, 6, 8, 11.
  Requires an operator-funded wallet. Behind the `LIVE` flag; fixture remains default.
- **M3d - resolve round-trip (opt-in chain).** Items 10, 16. `GET /resolve/:did` +
  `BeaconSignalDiscovery` + the e2e asserting both CAS and SMT resolve. DoD.
- **M3e - web resolve UX + first-update registration + dashboard anchor state. DONE
  & VERIFIED 2026-07-01.** Items 13, 14, dashboard polish, plus the KEY self-bootstrap
  registration flow (the piece ADR 0007 identified as required for a KEY DID's first
  update to be resolvable, pulled forward from M3f per the controller's model: the
  first aggregation update adds the aggregate beacon; each controller then announces
  it through their own genesis SingletonBeacon, after which further updates ride the
  aggregate beacon). Shipped: browser-safe `genesisP2trBeaconAddress`,
  `updateHashHex/Bytes`, `base64UrlHashToHex`, and `buildSingletonRegistrationTx`
  (P2TR key-path spend, OP_RETURN last, in `packages/shared`); `packages/participant`
  captures the controller's own submitted update body (`getSubmittedUpdate`, since
  BIP340 signing is non-deterministic); a same-origin Bitcoin tx proxy
  (`GET /v1/tx/utxos/:address`, `POST /v1/tx/broadcast` with `bodyLimit`) so the key
  is signed in-browser and only the raw tx is relayed; `createOfflineBitcoinConnection`
  + `demo-server` wiring a store + offline (or `LIVE=1` esplora) connection so
  `/resolve`, `/cas/*`, `/v1/tx/*` are live in every deployment while the cohort stays
  on the fixture path; web `RegisterPanel` (live-only), `ResolvePanel` (server-driven
  `/resolve/:did`, honest genesis-doc framing), `ResultCard` sidecar download, and
  dashboard anchor state (txid/confirmed/explorer via the M3c broadcast frames). Gate
  10/10 green + web tsc + vite build clean + bundle clean; +18 tests (93 total).
  Adversarial review (4 dims x find -> 2-skeptic) fixed 5 confirmed findings (dashboard
  resync-on-tab-switch, register re-entrancy, phantom-cohort resurrection, unbounded
  broadcast body, and a loud warning for the still-build-time browser network). ADR
  0008 records the decisions; the browser network matrix (runtime injection) stays
  M3f. Registration's real broadcast is `LIVE=1` + operator-funded; the hermetic gate
  covers the offline resolve path, tx-proxy validation, registration-tx construction,
  and the browser resolve UX.
- **M3f - EXTERNAL-genesis path + network matrix completion + ADRs.**
  `GenesisDocument.create` baked-beacon path + genesis store route; regtest CI node +
  mainnet guard rails; ADRs 0007+ (live beacon tx, durable store + IPFS/sidecar,
  resolve driver, onboarding models, network matrix).

## Spikes required before/within M3c (do not skip)

1. ~~**Hermetic, no chain (do first, in M3a):** confirm the per-member
   `SignedBTCR2Update` accessor.~~ **DONE 2026-06-30.** Source =
   `cohort.pendingUpdates: Map<DID, SignedBTCR2Update>`; `internalPubkey =
   cohort.internalKey`; key `updateMap` by hex(decoded base64url update hash), and
   `casMap`/`smtMap` by hex(`signalBytes`). See the Harvest spike result above.
2. **Live mutinynet round-trip:** fund a cohort `beaconAddress`, broadcast a real CAS
   **and** a real SMT aggregate tx, then `DidBtcr2.resolve` via
   `BeaconSignalDiscovery.indexer` and assert the appended beacon resolves. Pins: the
   esplora host + `NetworkName`, mutinynet's OP_RETURN/datacarrier policy, first
   confirmation latency (sizes `phaseTimeoutMs`/`cohortTtlMs`), the hex-vs-base64url
   store encoding, and the on-chain-hash to IPFS-CID mapping. Needs the operator wallet.
3. **In-browser resolve bundle cleanliness:** confirm a client-side
   `DidBtcr2.resolve` driver stays within `dist/browser.mjs` under the existing vite
   `resolve.conditions` + `optimizeDeps.exclude`; otherwise commit to the server-driven
   `GET /resolve/:did`.

## Risk register (top items)

- **HIGH - persist the wrong source.** `AggregationResult` lacks the announcement/proof;
  read the cohort accessor. Mitigation: the M3d resolve e2e is the only real proof the
  round-trip works; write it.
- **HIGH - drop the SMT `nonce`.** `SerializedSMTProof.nonce` is required for
  verification; persist the whole proof verbatim. Assert a 43-char base64url nonce
  before write.
- **HIGH - forget the signed-update bodies.** Both beacon types emit `NeedSignedUpdate`;
  persist `updateMap` for every member.
- **HIGH - live funding fails silently.** `buildAggregationBeaconTx` needs real UTXOs at
  `beaconAddress`; pre-flight `getUtxos` and surface a clear error; keep fixture default
  so a funding gap never breaks CI.
- **MED - beaconType/buildSignedUpdate mismatch.** Flipping to SMT without updating the
  appended service type leaves a CAS service advertised. Parameterize both together with
  distinct fragment ids.
- **MED - hex vs base64url at the store boundary.** Keys are hex (`signalBytes` hex);
  CAS/SMT values are base64urlnopad. Key routes by hex, store values verbatim; pin with a
  store -> retrieve -> provide -> resolved round-trip test.
- **MED - IPFS availability/pinning.** Opt-in IPFS content needs a pin to stay
  resolvable; the aggregator pins opt-in content and sidecar-export is the offline
  fallback. Document the trade-off.
- **MED - in-browser resolve pulls `level/classic-level`.** Prefer server-driven
  `/resolve/:did`; gate client-side resolve behind the verified browser bundle.
- **MED - mutinynet liveness/faucet variability.** Keep live paths behind `LIVE=1`; the
  default gate stays fixture-only and hermetic; regtest provides the automated live-path
  CI option.
- **HIGH (mainnet) - real-money funding/recovery.** mainnet is guarded: explicit opt-in
  config + warnings, dust-aware outputs, documented `recoveryKey`/`recoverySequence` and
  change handling. Default away from mainnet.

## Definition of done

`pnpm e2e:resolve` (and its SMT variant) runs a real cohort, broadcasts a real beacon
tx (regtest in CI; mutinynet manually), persists the artifacts via the chosen publish
target(s), and `DidBtcr2.resolve(participantDid)` reconstructs a DID document that
contains the appended `CASBeacon`/`SMTBeacon` service - for both beacon types and both
onboarding models. The original 8/8 hermetic gate is still green. ADRs 0007+ record the
live beacon tx, the IPFS/sidecar store, the resolve driver, the onboarding models, and
the network matrix.
