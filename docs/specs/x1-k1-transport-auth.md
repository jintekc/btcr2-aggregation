# SPEC: EXTERNAL (`x1`) and KEY (`k1`) DIDs must both authenticate on every aggregation transport

- Status: **Design LOCKED** (2026-07-02) - handoff for a CC session in the `did-btcr2-js` monorepo: `@did-btcr2/{aggregation,method}`
- Author: btcr2-aggregation (reference app) session, 2026-07-01
- Target packages: `@did-btcr2/aggregation` (HTTP transport + runners), `@did-btcr2/method` (sender resolver)
- Verified against: `@did-btcr2/aggregation@0.3.0`, `@did-btcr2/method@0.45.0` (compiled `dist/esm` read directly)

> This document is written for a coding session inside the **library monorepo**, not the
> reference app. Paths below are given as compiled `dist/esm/...` (what I read) plus the
> likely `src/...` source path; confirm the source path before editing.

## Locked decisions (2026-07-02)

The four design decisions are settled. Implement exactly these; the "Recommendation"
notes later in the doc reflect these outcomes, and the considered-but-rejected
alternatives are kept only for rationale.

- **C - Delivery mechanism: Approach A.** Carry the `x1` controller's genesis document
  **on the opt-in** (optional `genesisDocument` field on `CohortOptInBody`), verified by
  the server as a bootstrap for a not-yet-registered sender. No dedicated `/v1/register`
  endpoint. (§4.2)
- **D - Trust model: trustless only.** The genesis is self-verifying against the `x1`
  DID (hash commitment), so the comm key is extracted with zero trust. **No trust-on-
  first-use.** (§5)
- **B - Communication key = `capabilityInvocation[0]`.** The aggregation communication key
  for an `x1` DID is the verification method referenced by `capabilityInvocation[0]`,
  resolved to its public key. **No `verificationMethod[0]` fallback** - reject the `x1`
  participant if `capabilityInvocation` is absent (such a DID cannot be updated anyway).
  This reuses the exact relationship the method already enforces for update authorization,
  giving the invariant *transport-authenticated ⟹ authorized-to-update*. (§4.4)
- **A - Synchronous resolver.** The genesis-aware `resolveBtcr2SenderPk` stays synchronous
  (genesis handed in-band via the opt-in). An async, genesis-*fetching* resolver is
  deferred. (§4.1)

## 1. Functional requirement (non-negotiable)

**Both `did:btcr2:k1...` (KEY) and `did:btcr2:x1...` (EXTERNAL) identifiers MUST be able to
participate as first-class members of an aggregation cohort over EVERY transport
(`http`, `nostr`, `in-memory`, and any future transport).** Today only `k1` works over the
HTTP/REST transport; an `x1` participant is rejected before it can opt in.

## 2. Root cause (empirically confirmed)

Every authenticated HTTP request carries a `SignedEnvelope` (BIP340 over the JCS hash of the
envelope). The server verifies it against a **sender communication public key it resolves from
the DID** *before* the message body is trusted or dispatched:

- `dist/esm/service/http-server.js` `#handleMessagesPost` (~L193): `const senderPk = this.#resolveSenderPk(envelope.from); if (!senderPk) return 401 unknown_sender;` then `verifyEnvelope(...)`.
- `#resolveSenderPk(did)` (~L362): tries the **registered-peer registry** first (`this.#peers.get(did)`), then falls back to the injected `this.#resolveSenderPkFn` = `@did-btcr2/method`'s `resolveBtcr2SenderPk`.

`resolveBtcr2SenderPk` (`@did-btcr2/method` `dist/esm/core/did-sender-resolver.js`) only works for
KEY DIDs:

```js
const components = Identifier.decode(did);
if (components.idType === 'KEY') {
  return new CompressedSecp256k1PublicKey(components.genesisBytes); // k1: DID *is* the key
}
return undefined; // x1: genesisBytes are the HASH of a genesis document, not a key
```

For an `x1` DID, `Identifier.decode` succeeds but `genesisBytes` is the **hash of the genesis
document**, not a public key, so there is no key to return.

The service *does* already learn the participant's communication key from the opt-in and register
it: `dist/esm/service/service-runner.js` (~L477) `if (optIn.communicationPk) this.#transport.registerPeer(msg.from, optIn.communicationPk);`. **But that code never runs for an
`x1` sender**, because the opt-in envelope is rejected `401` at `#resolveSenderPk` *before* the
runner's opt-in handler executes. Chicken-and-egg: the registry is populated from the opt-in, but
the opt-in can't be verified until the registry is populated.

### Why Nostr does not hit this

`NostrTransport` (`dist/esm/core/transport/nostr.js`) never resolves `did -> pk` to *authenticate*
inbound messages. Each message is a self-signed Nostr event (`finalizeEvent(..., senderKeys.secretKey.bytes)`); authenticity rides the event signature (verified by nostr-tools / relays), and
the DID is merely asserted in the content/tags. Its `#peerRegistry` (`registerPeer`/`getPeerPk`) is
used only to **encrypt/route outbound** messages (NIP-44 conversation key + recipient `p`-tag), so
the population timing is irrelevant to auth. The HTTP transport made the opposite choice (verify a
detached envelope against a resolved key), which is why the gap is HTTP-specific. The
`did -> communication pubkey` mapping the maintainer referred to is the `registerPeer`/`getPeerPk`
registry that already exists on every transport; the fix is **how and when it is populated (and
trusted) for `x1` senders on transports that authenticate inbound.**

## 3. The insight that makes a trustless fix possible

An `x1` DID is `bech32m('x', [versionNetworkByte, ...sha256(canonical genesis document)])`
(`Identifier.encode`, EXTERNAL branch). It is a **cryptographic commitment to its genesis
document**. Therefore a genesis document supplied by an untrusted party is **self-verifying**:
recompute `GenesisDocument.toGenesisBytes(genesis)` and re-encode (or compare to
`Identifier.decode(did).genesisBytes`); if it matches the DID, the document is authentic. The
genesis document declares the DID's verification methods, so the **authoritative communication key
can be extracted from it with zero trust**, exactly as `k1`'s key is extracted from the DID string
with zero trust.

This means we do **not** need trust-on-first-use. We need to (a) get the `x1` controller's genesis
document to the verifier, and (b) define which verification method in it is the aggregation
communication key.

## 4. Design

Keep `k1` behavior byte-identical. Add an `x1` path that is trustless and backward-compatible.

### 4.1 `@did-btcr2/method`: make sender-pk resolution genesis-aware

`dist/esm/core/did-sender-resolver.js` (src likely `src/core/did-sender-resolver.ts`).

Add an overload/companion that accepts an optional genesis document and handles `x1`:

```ts
export function resolveBtcr2SenderPk(
  did: string,
  opts?: { genesisDocument?: object },
): CompressedSecp256k1PublicKey | undefined;
```

- `k1`: unchanged (decode -> key; ignore `genesisDocument`).
- `x1`: if `opts.genesisDocument` is present AND `Identifier`-re-encoding its
  `GenesisDocument.toGenesisBytes(...)` equals `did` (network + version + hash all match), return
  the **designated communication verification method's** public key (see §4.4). Otherwise
  `undefined` (unchanged behavior when no genesis is supplied).

Rationale for keeping it in `method`: DID parsing, genesis hashing, and VM extraction are
did:btcr2 concerns; the aggregation transport must stay method-agnostic and only consume an
injected resolver.

**Decision A (LOCKED): synchronous, genesis-in-hand.** The genesis is always carried in-band on the
opt-in (Decision C), so the resolver is handed the bytes and stays synchronous - no change to the
existing sync `#resolveSenderPk` call sites. An async, genesis-*fetching* resolver (store / DID
resolution) is deferred.

### 4.2 `@did-btcr2/aggregation`: deliver the `x1` genesis to the verifier

**Decision C (LOCKED): Approach A (carry the genesis on the opt-in).** Least protocol churn,
symmetric with how the service already learns `communicationPk` from the opt-in. Approach B is kept
below only as considered-and-rejected rationale.

**Approach A - carry the genesis in the opt-in (CHOSEN).**
- Extend `CohortOptInBody` (`dist/esm/core/messages/bodies.js`, `core/messages/factories.js`,
  `core/messages/guards.js`) with an OPTIONAL `genesisDocument?: object`. Required when `from` is an
  `x1` DID; omitted for `k1`.
- In `HttpServerTransport.#handleMessagesPost`, when `#resolveSenderPk(envelope.from)` returns
  `undefined` (i.e. not a registered peer and not a `k1`), attempt a **bootstrap**: parse the
  (still-untrusted) envelope body; if it is a `COHORT_OPT_IN` carrying a `genesisDocument`, call the
  genesis-aware resolver `resolveBtcr2SenderPk(from, { genesisDocument })`. If it returns a key,
  `verifyEnvelope(envelope, key)` - success proves the sender controls the designated key AND the
  genesis hashes to the DID, so it is safe to `registerPeer(from, key)` and proceed. This is a
  contained, safe exception because the genesis is self-verifying; it does not make the transport
  protocol-aware beyond "an injected resolver may consume a `genesisDocument` hint from a bootstrap
  opt-in."
- Cross-check: the opt-in's `communicationPk` MUST equal the genesis-derived key; reject on
  mismatch (prevents a controller from advertising a different signing key than it authenticates
  with).

**Approach B - dedicated registration step (CONSIDERED, REJECTED: cleaner layering, one extra round-trip).**
- Add `POST /v1/register` (or a `PEER_HELLO` envelope) carrying `{ did, genesisDocument }`,
  self-signed with the communication key. The server verifies genesis-hash == did, extracts the
  key, verifies the self-signature, `registerPeer`, returns 200. The normal opt-in then flows
  through the now-populated registry with no change to `CohortOptInBody`.
- Keeps `HttpServerTransport` fully generic and the aggregation message set unchanged, at the cost
  of a route + an onboarding round-trip.

Either way, `service-runner.js`'s existing `registerPeer(msg.from, optIn.communicationPk)` should be
reconciled so the **registered key is the genesis-derived key for `x1`** (not the self-declared
`communicationPk`), and should reject an `x1` opt-in whose `communicationPk` disagrees.

### 4.3 `@did-btcr2/aggregation`: participant side

- `AggregationParticipant.joinCohort` (`dist/esm/participant/participant.js` ~L150) builds the
  opt-in. For an `x1` identity, include `genesisDocument` (Approach A) or perform the register step
  (Approach B). The participant already signs envelopes with `actor.keys` and declares
  `communicationPk: this.publicKey`; for `x1`, `actor.keys` MUST be the key of the designated
  communication VM in the genesis (see §4.4), so the self-declared `communicationPk` matches the
  genesis-derived key.
- The runner (`participant-runner.js`) needs the genesis document available to the participant. It
  should accept the genesis (and the comm-key selection) at construction for `x1` identities.

### 4.4 Which verification method is the communication key?

**Decision B (LOCKED): the aggregation communication key = the VM referenced by
`capabilityInvocation[0]`, resolved to its public key.** For `k1`, the deterministic document's
single key is already in `capabilityInvocation` (`did-document.js:145-148`), so this is a no-op for
KEY DIDs. For `x1`, resolve `genesis.capabilityInvocation[0]` (a string reference into
`verificationMethod`, or an embedded VM) and decode its `publicKeyMultibase` (`zQ3s...`).

**No `verificationMethod[0]` fallback:** if `capabilityInvocation` is absent, **reject** the `x1`
participant. A document without `capabilityInvocation` cannot be updated at all (the update path
requires it: `did-btcr2.js:115-117`), so it is useless for aggregation, and any other VM would break
the invariant below.

Why `capabilityInvocation` and not `authentication`: it is the exact relationship the method already
enforces for DID updates - construct/sign checks the signing VM is in `capabilityInvocation`
(`did-btcr2.js:115-117`), the proof is built with `proofPurpose: 'capabilityInvocation'`
(`updater.js:154`), and resolve verifies it with `verifyProof(..., 'capabilityInvocation')`
(`resolver.js:359`). Binding the transport comm key to that same relationship yields the invariant
**transport-authenticated as D ⟹ controls a `capabilityInvocation` key of D ⟹ authorized to update
D**, so an impostor who can't update D is rejected at opt-in rather than at update-submit.
`authentication[0]` was considered (DID-core-orthodox for sender auth, and it would permit a
separate cold update key) and **rejected** in favor of the stronger binding + k1 consistency.

This is a new normative rule; it MUST be identical on the participant (the key it signs envelopes
with, and declares as `communicationPk`), the resolver (the key `resolveBtcr2SenderPk` returns), and
the service/validator (which cross-checks `communicationPk` against it).

### 4.5 Symmetry across transports

- `in-memory` (`dist/esm/core/transport/in-memory.js`): already a no-op peer registry; ensure the
  runners populate it for `x1` the same way (they call `registerPeer` from opt-in). No auth is
  enforced in-memory, so `x1` should already work end-to-end there - add a test to prove it.
- `nostr`: authenticity is the event signature; `x1` already "works" in the sense that it is not
  rejected. But confirm the DID-asserted-in-content is acceptable, and that `registerPeer` for the
  peer's comm key (for NIP-44 outbound) is populated for `x1` too. Add a test.
- `didcomm` (`dist/esm/core/transport/didcomm.js`): currently a stub (`registerPeer`/`getPeerPk` are
  no-ops). Note the same requirement for when it is implemented.

## 5. Security analysis

- **Trustless binding (no TOFU).** Because `x1 = commit(hash(genesis))`, a supplied genesis that
  hashes to the DID authenticates the DID's key set with zero trust - equivalent to `k1`'s
  decode-the-key. An attacker cannot register `x1:Victim -> attackerKey`: they would need a genesis
  that hashes to `x1:Victim` yet authorizes `attackerKey`, i.e. a second preimage of the victim's
  genesis. So `x1` becomes exactly as squat-resistant as `k1`.
- **Why not TOFU.** Verifying the opt-in against the self-declared `communicationPk` (no genesis)
  would let anyone occupy a cohort slot as any `x1` DID (they still can't produce a valid signed
  update, but they can grief/DoS a cohort). Rejected for a public, self-hostable, trustless
  aggregator. (If a deployment ever wants it, gate it behind an explicit opt-in flag; default off.)
- **Replay / rate-limit / nonce** paths are unchanged: bootstrap only supplies the key used by the
  existing `verifyEnvelope` + `nonceCache` + `rateLimiter` pipeline.
- **DoS surface of bootstrap.** Genesis verification is a hash + a few field checks; cap the opt-in
  body size (the reference server already applies `bodyLimit` on its own POST proxy; the library's
  `#handleMessagesPost` should bound the parsed body) so a huge fake genesis cannot be used to
  exhaust memory before the hash check.

## 6. Backward compatibility

- `resolveBtcr2SenderPk(did)` with no second argument behaves exactly as today (k1 -> key, x1 ->
  undefined). Existing call sites compile and behave identically.
- `CohortOptInBody.genesisDocument` is optional; existing `k1` opt-ins and older participants are
  unaffected.
- No change to MuSig2, cohort finalization, beacon-tx construction, or resolution.

## 7. Test plan (add to the monorepo's suites)

Unit:
- `resolveBtcr2SenderPk`: `k1` -> key (unchanged); `x1` + correct genesis -> designated key; `x1` +
  wrong/mismatched genesis -> undefined; `x1` + no genesis -> undefined.
- Genesis hash round-trip: `Identifier.encode(toGenesisBytes(g), {idType:'EXTERNAL',network,version})`
  equals the DID for a freshly built `x1`.
- Comm-key selection resolves the same key on participant and resolver.

Integration / e2e (the important ones - prove the whole handshake):
- HTTP: a **real `x1` participant** joins a cohort against `HttpServerTransport` and reaches
  `cohort-complete` (mirror of the existing `k1` e2e). Assert the opt-in is `202` (not `401`) and
  the peer is registered with the genesis-derived key.
- HTTP mixed cohort: `k1` + `x1` members complete the same cohort; the aggregate signature is valid.
- `in-memory` and `nostr`: an `x1` participant completes a cohort (symmetry).
- Negative: an `x1` opt-in with a genesis that does not hash to the DID is rejected `401`; an `x1`
  opt-in whose `communicationPk` disagrees with the genesis-derived key is rejected.

## 8. File-by-file change list (verify src paths)

`@did-btcr2/method`:
- `src/core/did-sender-resolver.ts` - genesis-aware overload (§4.1).
- `src/utils/did-document.ts` (or wherever VM/relationship helpers live) - a `getAggregationCommunicationKey(doc)` helper implementing §4.4.
- exports / `index.ts` - export the helper if the transport or app needs it.

`@did-btcr2/aggregation`:
- `src/core/messages/bodies.ts`, `factories.ts`, `guards.ts` - optional `genesisDocument` on the
  opt-in (Approach A), or a new `PEER_HELLO` message + `/v1/register` route (Approach B).
- `src/service/http-server.ts` - bootstrap branch in `#handleMessagesPost` (Approach A) or the
  register route (Approach B); reconcile `#resolveSenderPk` to accept the injected genesis-aware
  resolver.
- `src/participant/http-client.ts` - no change for Approach A beyond sending the enriched opt-in;
  new register call for Approach B.
- `src/service/service-runner.ts` - register the genesis-derived key for `x1`; reject mismatched
  `communicationPk`.
- `src/participant/participant.ts` + `participant-runner.ts` - carry/emit the genesis for `x1`
  identities; ensure the signing key is the designated comm VM key.
- `src/core/transport/{in-memory,nostr,didcomm}.ts` - confirm/adjust `registerPeer` population for
  `x1`; add symmetry tests.

## 9. Acceptance criteria

1. An `x1` participant completes a cohort over **HTTP**, **in-memory**, and **nostr** (e2e).
2. A mixed `k1`+`x1` cohort produces a valid aggregate signature.
3. `x1` binding is trustless: a genesis not committing to the DID is rejected; no TOFU by default.
4. All existing `k1` tests pass unchanged; `resolveBtcr2SenderPk(did)` (1-arg) is unchanged.
5. The comm-key selection rule (§4.4) is documented and identical across participant, resolver, and
   any validator.

## 10. Decisions - all LOCKED (2026-07-02)

See the "Locked decisions" block near the top. Summary:

- **A. Sender resolver:** synchronous, genesis-in-hand (§4.1).
- **B. Comm-key rule:** `capabilityInvocation[0]`, resolved to its VM key; **no** fallback; reject if
  absent (§4.4).
- **C. Delivery:** Approach A - genesis carried on the opt-in (§4.2).
- **D. Trust model:** trustless (genesis-verified) only; no TOFU (§5).

## Appendix: exact evidence (compiled sources read)

- `@did-btcr2/method` `dist/esm/core/did-sender-resolver.js` - `resolveBtcr2SenderPk` KEY-only.
- `@did-btcr2/method` `dist/esm/core/identifier.js` - `encode`/`decode`: `x1` = `bech32m('x',[verNetByte, ...genesisBytesHash])`.
- `@did-btcr2/aggregation` `dist/esm/service/http-server.js` - `#handleMessagesPost` 401 path; `#resolveSenderPk` (peers -> injected fn).
- `@did-btcr2/aggregation` `dist/esm/service/service-runner.js` ~L477 - `registerPeer(msg.from, optIn.communicationPk)`.
- `@did-btcr2/aggregation` `dist/esm/participant/http-client.js` - `sendMessage` signs with `actor.keys`; `#resolveSenderPk` (peers -> injected fn).
- `@did-btcr2/aggregation` `dist/esm/participant/participant.js` ~L150 - opt-in sets `communicationPk: this.publicKey`.
- `@did-btcr2/aggregation` `dist/esm/core/transport/nostr.js` - self-signed events; `#peerRegistry` used only for NIP-44 outbound.
- Empirical: an `x1` opt-in `POST /v1/messages` returns `401 unknown_sender` while a `k1` opt-in returns `202` and completes a cohort (reference-app spike, 2026-07-01).
