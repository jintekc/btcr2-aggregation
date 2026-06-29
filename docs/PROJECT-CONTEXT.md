# Project Context: did:btcr2 Aggregation Demo App

> Orientation document for this repository. Captures the goal, architecture, the
> upstream API this app builds on, and the implementation plan. Carried over from
> the `did-btcr2-js` library work that produced the aggregation subsystem.

## What this is

A public, deployable example application demonstrating **end-to-end web-based
did:btcr2 aggregation** over the HTTP/REST transport. It is a *consumer* of the
published `@did-btcr2/*` packages, not a fork of the
[`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) library monorepo.

did:btcr2 is a censorship-resistant DID method using Bitcoin as a verifiable data
registry. *Aggregation* lets many parties (a *cohort*) batch their DID-document
updates into a single on-chain *beacon* transaction, coordinated by a service via
MuSig2 (BIP-327) Taproot key-path signing.

## North star (hard deadline)

A fully working, deployed, public web demo, **demoable at a conference in October
2026**. Conference attendees visit a public URL in their browser and perform the
full aggregation update flow themselves:

> join a cohort → submit a DID update → contribute to MuSig2 signing → see the
> aggregated update anchored on-chain.

This implies:

- A **hosted aggregation service** (server process) that advertises cohorts,
  collects updates, aggregates them (CAS or SMT), and coordinates MuSig2 signing.
- An **in-browser participant client** (the attendee). Keys are generated
  client-side; the participant contributes its MuSig2 nonce and partial signature
  in-browser. The `HttpClientTransport` is browser-compatible (fetch + SSE).
- **Multi-user concurrency**: many attendees act as participants at once. The
  `HttpServerTransport` already ships a rate limiter, nonce cache, and inbox
  buffer for this.
- A **public, verifiable test network**: most likely **mutinynet** (a public
  signet with fast blocks and a faucet) so the beacon transaction is publicly
  verifiable without real-money mainnet cost.

## Upstream packages this app depends on

Consume from npm (versions current as of 2026-06-29; check npm for latest):

| Package | Version | Role here |
|---|---|---|
| `@did-btcr2/aggregation` | 0.3.0 | The aggregation subsystem. Use its subpath exports. |
| `@did-btcr2/method` | 0.45.0 | did:btcr2 create/resolve/update, beacons, DID documents. |
| `@did-btcr2/api` | 0.13.4 | High-level SDK facade (crypto, did, kms, btc, method, cas). |
| `@did-btcr2/bitcoin` | 0.8.0 | Bitcoin REST (Esplora) / RPC client for building the beacon tx. |
| `@did-btcr2/keypair` | 0.13.1 | secp256k1 / BIP340 Schnorr keys + signers. |

`@did-btcr2/aggregation` exposes role-scoped subpath exports:

- `@did-btcr2/aggregation/service` — `AggregationServiceRunner`, `HttpServerTransport`, plus server machinery (inbox buffer, nonce cache, rate limiter, SSE writer), service events.
- `@did-btcr2/aggregation/participant` — `AggregationParticipantRunner`, `HttpClientTransport`, participant events.
- `@did-btcr2/aggregation/core` — shared types, message factories/guards, the HTTP protocol layer, `TransportFactory`.

The HTTP transport is fully implemented on both sides. The server transport is
**sans-I/O**: `handleRequest(req)` / `handleSse(req, stream)` return descriptors
that you adapt to a real HTTP framework (Express / Hono / Fastify / Workers).

## API surface to build against

### Service (server)

```ts
new AggregationServiceRunner({
  transport,                 // HttpServerTransport (or TransportFactory.establish({type:'http', role:'server', ...}))
  did, keys,                 // service identity (SchnorrKeyPair)
  onProvideTxData,           // REQUIRED: ({cohortId, beaconAddress, signalBytes, feeEstimator}) => SigningTxData
  onOptInReceived?,          // accept/reject each participant opt-in
  onReadyToFinalize?,        // when to finalize keygen (defaults to minParticipants)
  feeEstimator?, cohortTtlMs?, phaseTimeoutMs?, ...
})
```

- `onProvideTxData` returns `{ tx, prevOutScripts, prevOutValues }` — this is where
  a Bitcoin connection builds the beacon transaction (network-agnostic:
  regtest / mutinynet / mainnet).
- Drive it with `advertiseCohort(config) -> { cohortId, completion }` (many cohorts
  per runner), or `run()` / `runAll()`. Recover a stalled cohort with
  `triggerFallback(cohortId)` (k-of-n fallback).
- Events for UI: `cohort-advertised`, `opt-in-received`, `keygen-complete`
  (beacon address ready), `update-received`, `data-distributed`,
  `signing-complete` (final signature + signed tx), `cohort-failed`.

### Participant (in-browser client)

```ts
new AggregationParticipantRunner({
  transport,                 // HttpClientTransport({ baseUrl, fetchImpl? })
  did, keys,
  onProvideUpdate,           // REQUIRED: ({cohortId, beaconAddress}) => SecuredDocument | null  (null = non-inclusion)
  shouldJoin?,               // filter discovered cohorts
  onValidateData?,           // approve/reject the aggregated data
  onApproveSigning?,         // approve/reject signing
})
```

- `start()` opens SSE subscriptions (broadcast adverts + per-actor inbox);
  `stop()` tears down. Convenience: `static joinFirst(...)`, `joinMatching(..., n)`.
- Events for UI: `cohort-discovered/joined/ready`, `update-submitted/declined`,
  `validation-requested`, `signing-requested`, `cohort-complete` (carries the CAS
  Announcement or SMT proof needed to later resolve the DID), `cohort-failed`.

### Transport wiring

`TransportFactory.establish(config)` with a discriminated union:

- server: `{ type: 'http', role: 'server', cors?, clockSkewSec?, inboxBufferSize?, advertTtlMs?, rateLimiter?, nonceCache?, heartbeatIntervalMs?, resolveSenderPk? }`
- client: `{ type: 'http', role: 'client', baseUrl, fetchImpl?, reconnectBackoff?, clockSkewSec?, resolveSenderPk? }`

Server HTTP routes: `POST /v1/messages`, `POST/GET /v1/adverts` (GET is SSE),
`GET /v1/actors/{did}/inbox` (SSE, auth), `GET /v1/.well-known/aggregation`.
All requests/SSE events are signed envelopes (BIP340 Schnorr over JCS-canonical
body) with a nonce + timestamp replay cache.

## Implementation plan (phased)

There is **no real-HTTP-transport end-to-end test in the library yet** — the
library's E2E runs over an in-memory `MockTransport`, and the HTTP client/server
are covered only in isolation. So the first slice here closes that gap before any
UI work.

1. **Headless real-HTTP E2E.** A service process + one or more participant
   processes wired through the *real* `HttpServerTransport` / `HttpClientTransport`
   (behind a minimal HTTP framework adapter), driving a full cohort to completion
   on regtest: cohort formation → update submission → MuSig2 signing → beacon tx.
   This proves the wiring and the framework adapter.
2. **Web UI.** A thin frontend (minimal stack, e.g. Vite) for the participant, and
   a service dashboard, visualizing the four protocol steps and live cohort state
   off the runner events.
3. **Live + deployed.** Move to mutinynet, fund/anchor real beacon txs, and deploy
   the service to a public server with the participant client served to attendees.

## Conventions

- TypeScript, ESM, Node ≥ 22. The participant client must be **browser-compatible**
  (no Node-only APIs); the service runs on Node.
- The [did:btcr2 specification](https://dcdpr.github.io/did-btcr2/) is the source of
  truth; when it is silent, decide deliberately and record it.
- Keep an **ADR log** in `docs/adr/` for app-level decisions (deployment topology,
  network choice, key custody in-browser, UI/UX of the flow). Library-level
  decisions already have ADRs in the `did-btcr2-js` repo — reference them rather
  than duplicating.
- No em-dash characters and no unicode arrows in prose, code, or docs (use commas,
  colons, parentheses, periods, or ASCII `->`).
