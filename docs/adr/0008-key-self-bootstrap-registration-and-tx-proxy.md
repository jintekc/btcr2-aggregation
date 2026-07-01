# ADR 0008: KEY-DID self-bootstrap registration (web) and the browser Bitcoin tx proxy

- Status: Accepted
- Date: 2026-07-01
- Milestone: M3e (web resolve UX + first-update registration + dashboard anchor state)

## Context

ADR 0007 established the finding that makes a KEY DID's first aggregated update
resolvable: the resolver only discovers beacon signals at beacons **already in the
document under resolution**, so a fresh KEY DID (whose genesis document carries only
its own three SingletonBeacons) cannot discover an update announced at the *cohort*
aggregate beacon. The faithful fix is to publish the first update through a beacon
already in genesis: a SingletonBeacon signal (`OP_RETURN = sha256(canonical signed
update)`) at one of the controller's own genesis addresses. That first update adds
the aggregate beacon service; subsequent updates ride the aggregate beacon.

M3e makes that flow real and self-service in the reference web app, and completes the
resolve UX and dashboard anchor state (M3-PLAN items 13, 14, dashboard polish).

The lifecycle, stated plainly (the controller's model): every participant joins the
cohort and runs MuSig2 to derive the aggregate beacon address; each one's first
update is prebuilt as "add this aggregate beacon service"; each controller then
announces that update through **their own** genesis SingletonBeacon (fund the
address, broadcast an `OP_RETURN` spend). After that, they make further aggregation
updates ad hoc.

## Decision

1. **Help the controller self-bootstrap in the browser.** A "Register first update"
   panel derives the controller's genesis **P2TR** SingletonBeacon address
   (`genesisP2trBeaconAddress`, pure `@scure/btc-signer`, byte-identical to
   `BeaconUtils` `#initialP2TR`), watches it for funds, then builds, signs, and
   broadcasts a Taproot key-path spend whose single `OP_RETURN` carries the 32-byte
   canonical hash of the controller's own submitted update
   (`buildSingletonRegistrationTx`, `packages/shared`). The **OP_RETURN is the last
   output** (change first) because the resolver's signal indexer reads only a
   transaction's final `vout`.

2. **Sign in the browser; broadcast + read UTXOs via a same-origin server proxy.**
   The controller's key never leaves the client (the tx is built and signed with
   `@scure/btc-signer` in-browser). Reading UTXOs and relaying the raw signed tx go
   through `GET /v1/tx/utxos/:address` and `POST /v1/tx/broadcast`
   (`packages/service/src/hono-adapter.ts`), so the browser stays same-origin and
   does not depend on an esplora host's CORS (which varies by network) or bundle a
   Bitcoin client. The proxy validates inputs (address charset/length, even-length
   bounded hex) and returns generic `502`s without leaking upstream detail.

3. **Capture the participant's own submitted update body.** BIP340 signing injects
   fresh randomness per call, so an update cannot be rebuilt to the same canonical
   hash later. `packages/participant` captures the exact body returned from
   `onProvideUpdate` and exposes `getSubmittedUpdate(cohortId)`; the web builds the
   OP_RETURN hash and the sovereign sidecar from it. The runner otherwise exposes
   only the update's hash, not its body.

4. **Server-driven resolve UX, honest about the discovery model.** The `ResolvePanel`
   calls `GET /resolve/:did` (server-driven; the browser never bundles the resolver's
   `level`/`classic-level` deps, per ADR 0007) and renders the reconstructed
   document. A fresh KEY DID resolves to its genesis document; the UI says so plainly
   and points to registration (or EXTERNAL onboarding, M3f). The appended aggregate
   beacon appears automatically once the registration confirms, with no UX rework.

5. **The reference server ships resolution on by default, hermetically.**
   `demo-server.ts` always wires a `MemoryArtifactStore` plus a Bitcoin connection
   that is **offline by default** (`createOfflineBitcoinConnection`: empty reads, no
   broadcast, zero network I/O) and a real esplora connection under `LIVE=1` /
   `NETWORK`. This mounts `GET /resolve/:did`, the read-only `/cas/*` routes, and the
   `/v1/tx/*` proxy in every deployment while keeping the 10/10 gate chain-free
   (resolution returns the genesis document; the funding check reports no funds). The
   cohort itself stays on the **fixture** beacon-tx path: the injected connection is
   not passed as `live`, so resolvability comes from each controller's singleton
   registration, not from broadcasting the aggregate tx (that is M3c, for later
   updates).

6. **No dedicated publish endpoint this slice.** The coordinator already persists a
   completed cohort's artifacts on `signing-complete` when it has a store, so
   `GET /resolve/:did` on the reference server serves them without a client write
   path. The controller's **downloadable sidecar** is their sovereign copy (usable as
   `DidBtcr2.resolve(did, { sidecar })` input, or to seed any aggregator). A signed
   `POST /cas/publish` for seeding a *different* aggregator is deferred (the store's
   read path is hash-guarded, so it is safe to add openly later).

7. **Dashboard anchor state.** The dashboard consumes the `beacon-broadcast` /
   `beacon-anchored` / `beacon-broadcast-failed` frames (already serialized by
   `dashboard-sse.ts` with an explorer URL) and renders each cohort's on-chain anchor
   status (broadcast / confirmed / failed) with a block-explorer link. Exercised
   under live broadcasting (M3c); inert in the hermetic fixture path.

## Consequences

- A KEY DID controller can, end to end and self-service, take their first aggregated
  update from co-signing to on-chain resolvability, using only their own funds and
  key, over the public HTTP/REST transport - the reference app's north star.
- Registration is inherently **live-only** (real funds; the mutinynet faucet is
  manual). The hermetic gate covers the offline resolve path, the tx proxy
  validation/relay, the registration tx construction, and the browser resolve UX
  (genesis document rendered, sidecar available, funding check → awaiting funds).
  The real broadcast + confirmed-resolve leg is a `LIVE=1`, operator-funded step.
- The `POST /v1/tx/broadcast` route is an open relay to the operator's esplora. On a
  public deployment an operator may want to rate-limit or authenticate it; the
  reference leaves it open (esplora already accepts anonymous `POST /tx`) and caps the
  request body with `bodyLimit` (512 kB, rejected during streaming) so the size guard
  is enforced before buffering, not after. The pre-existing protocol POSTs
  (`/v1/messages`, `/v1/adverts`) share the buffer-then-check pattern; fronting the
  server with a reverse proxy that caps request size is still recommended for a
  public deployment.
- **The browser derives its addresses/DIDs from a build-time network constant**
  (`DEFAULT_NETWORK`). The server is fully config-driven, but the web bundle is not
  yet: a deployment serving the SPA against a chain with different address params
  (mainnet `bc1p...`, regtest `bcrt1...`) would derive non-matching in-browser
  addresses, so first-update registration fails. mutinynet/signet/testnet share
  params, so the public default works. `demo-server` now warns loudly when it serves
  the SPA against a mismatched network; full runtime browser-network injection (a
  `GET /v1/config` the web reads at startup) is deferred to M3f (network matrix
  completion).
- The aggregate-beacon resolution path (`NeedCASAnnouncement` / `NeedSMTProof`)
  remains reachable only once the beacon is already in the document (a second update,
  or EXTERNAL genesis) - unchanged from ADR 0007; M3f.
