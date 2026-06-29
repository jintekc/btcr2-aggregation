# ADR 0001: M1 service framework (Hono) and fixture beacon transaction

- Status: Accepted
- Date: 2026-06-29
- Milestone: M1 (headless real-HTTP E2E)

## Context

Milestone 1 delivers a headless, real-HTTP end-to-end run: one aggregation
service on a real local port and N participants over `HttpClientTransport`,
driving a full CAS cohort to a 64-byte aggregated Taproot signature. Two
app-level decisions were open and are recorded here.

1. **How to host the sans-I/O `HttpServerTransport`.** The transport exposes
   `handleRequest(req)` and `handleSse(req, stream)` and leaves the actual HTTP
   I/O to the caller. We needed to pick a framework and an SSE bridge.
2. **What transaction the service signs.** `onProvideTxData` must return a real
   `{ tx, prevOutScripts, prevOutValues }`. In M1 there is no Bitcoin node and no
   broadcast, so the tx is a fixture.

## Decision

### Service framework: Hono + @hono/node-server

We mount the transport under Hono (`packages/service/src/hono-adapter.ts`):

- Non-SSE routes (`POST /v1/messages`, `POST /v1/adverts`,
  `GET /v1/.well-known/aggregation`) call `transport.handleRequest()` and return a
  standard `Response`, sidestepping Hono's `StatusCode` typing.
- SSE GETs (`GET /v1/adverts`, `GET /v1/actors/:did/inbox`) hijack the raw Node
  `ServerResponse` exposed on `c.env.outgoing` by `@hono/node-server`, write
  `event:/data:/id:` and comment frames via the library's own `formatSseEvent` /
  `formatSseComment` (so the wire format matches the client's parser exactly), and
  return the `RESPONSE_ALREADY_SENT` sentinel.

The Node-`http` fallback the scaffold plan allowed was not needed: the raw-response
bridge works cleanly. We keep Hono so M2 can add the web UI and dashboard on the
same server.

### Fixture beacon transaction

`buildFixtureTxData(cohortKeys, signalBytes)` (in `@btcr2-aggregation/shared`)
builds a v2 Taproot key-path spend of a dummy prevout (`txid = 00..00`, vout 0)
locked to `p2tr(musig2.keyAggExport(musig2.keyAggregate(cohortKeys)))`, with two
outputs: the same script (less a flat 500 sat fee) and an `OP_RETURN` carrying the
committed `signalBytes`. The service reads the sorted `cohortKeys` from the
finalized cohort (`runner.session.getCohort(cohortId)`) and the `signalBytes` from
the `onProvideTxData` callback argument.

The prevout is a fixture, so on-chain validity is out of scope for M1; what matters
is that every signer computes the same taproot sighash from identical
`SigningTxData`, which makes the MuSig2 partial signatures consistent and yields a
valid 64-byte aggregate. The `OP_RETURN` is required because the signing approval
binds to the validated cohort signal.

## Consequences

- The service is genuinely exercised over HTTP/SSE on a real port; M2 reuses the
  same adapter and adds UI routes.
- M3 replaces `buildFixtureTxData` with a real `@did-btcr2/bitcoin` connection on
  mutinynet (fund + broadcast a real beacon tx); the runner wiring is unchanged.

## Notes / gotchas discovered during M1

- **`AggregationParticipantRunner.start()` does not start the transport.** It only
  registers message handlers. The client transport's SSE subscriptions (broadcast
  adverts + per-actor inbox) are opened by `HttpClientTransport.start()`, which the
  caller must invoke. `createParticipant().start()` therefore calls
  `runner.start()` then `transport.start()` (handlers first so no inbound event is
  missed). The service side calls `transport.start()` in `service.start()`.
- **Participant `cohort-complete` lags the service `signing-complete`.** The
  service runner's `run()` resolves at its own `signing-complete`, but each
  participant receives its final `cohort-complete` over its inbox SSE a beat later.
  The E2E harness arms a per-participant completion promise and awaits all of them
  after `run()` before snapshotting milestones.
- **`CohortConfig` requires `recoveryKey` (64-hex x-only) and `recoverySequence`
  (>= 1).** Both are easy to miss and throw at advertise time; `buildCohortConfig`
  sets them (ADR 042 recovery leaf in the library).
