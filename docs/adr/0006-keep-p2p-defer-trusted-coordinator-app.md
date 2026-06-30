# ADR 0006: Keep btcr2-aggregation p2p; defer a separate trusted-coordinator app

- Status: Accepted
- Date: 2026-06-30
- Milestone: M2 (stay-online co-signing web UI)

## Context

During M2 a "sign your update, pay, and walk away" model was explored, where a
trusted service would finalize the beacon on a participant's behalf so attendees
need not stay online through signing. We checked whether this could be a mode of
THIS app (or the `@did-btcr2/aggregation` library).

Two findings from reading the shipped library source settled it:

1. **The cohort key must be the DID key for KEY DIDs.** `service.js`
   `#verifySubmittedUpdate` verifies a submitted update against the participant's
   cohort key (`optIn.participantPk`) AND requires the update's DID to equal the
   participant DID (`if (vmDid !== sender) return false`). So for a `did:btcr2:k1...`
   (KEY) DID, the cohort signing key MUST be the DID key. Participants are
   necessarily REAL co-signers; "the service signs the beacon for you with a
   different key" is impossible.
2. **Optimistic n-of-n MuSig2 needs everyone online.** Partial signatures cannot be
   precomputed (`generatePartialSignature` throws `MISSING_AGGREGATED_NONCE`), so
   all members must be present through both the nonce round and the partial-sig
   round. The k-of-n script-path fallback (`autoFallbackOnStall` + `phaseTimeoutMs`)
   is the only fewer-than-n liveness path, and it is still real co-signers.

## Decision

1. Keep this repo, `btcr2-aggregation`, as the reference app for **p2p / MuSig2 /
   sovereign** aggregation over the HTTP/REST transport. Aggregation is trustless
   by design; the coordinator only routes messages and aggregates public nonces,
   it never holds a signing key.
2. DEFER a separate future repo, `btcr2-aggregation-{managed|coordinator}` (name
   TBD), for the trusted "sign + pay + walk away" web app (accounts, state, DB,
   payment; a CAS/SMT beacon operated by the service via `@did-btcr2/method` beacon
   primitives, NOT by a cohort).
3. Do NOT redesign `@did-btcr2/aggregation` to add a non-MuSig2 mode. A trusted
   aggregator needs none of the coordination protocol; the only shared piece is
   CAS/SMT announcement + signal, which belongs in `@did-btcr2/method`, not in the
   aggregation library.

## Consequences

- M2's UX is honest about the model: every signer is a separate attendee who stays
  online; the dashboard states plainly that the coordinator holds no key.
- The trusted variant is a clean-slate future project, not a flag on this one,
  avoiding a category error in both the app and the library.
- Beacon bootstrap fact recorded for both projects: a fresh KEY DID's deterministic
  document already has three SingletonBeacons (`#initialP2PKH/P2WPKH/P2TR`); the
  FIRST update must ADD the CAS/SMT beacon via a self-published Singleton tx, and
  only subsequent updates ride the aggregate beacon (an EXTERNAL did:btcr2 with the
  beacon baked into genesis can skip that bootstrap).
