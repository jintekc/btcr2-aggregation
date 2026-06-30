# ADR 0004: Read-only dashboard SSE telemetry channel

- Status: Accepted
- Date: 2026-06-30
- Milestone: M2 (stay-online co-signing web UI)

## Context

The demo wants a coordinator view that shows cohort lifecycle, opt-ins, keygen,
signing progress, and the final aggregated signature in real time. The
`AggregationServiceRunner` already emits a typed event for every milestone, but
those events are server-side objects (Uint8Array keys, a `@scure` `Transaction`),
not browser-safe JSON, and the signed protocol surface (`/v1/*`) must stay exactly
what participants authenticate against.

## Decision

Add a SEPARATE, read-only Server-Sent-Events channel, `GET /dashboard/events`,
kept off the signed protocol surface.

- `packages/service/src/dashboard-sse.ts` `bridgeRunnerToSse(runner, stream)`
  registers one listener per runner event (all 14, typed as
  `keyof AggregationServiceEvents` so a renamed event fails to compile),
  serializes each to JSON (hex-encoding `participantPk`/`communicationPk`,
  summarizing the signed tx, guarding `tx.fee` which throws on a fixture prevout),
  sends a keepalive comment, and removes every listener on disconnect.
- It is mounted only when a `runner` is passed to `createHonoApp`, via the same
  raw-Node-response SSE bridge the protocol routes use (ADR 0001).
- The browser `stores/dashboard.ts` consumes it with an `EventSource`, reducing
  events into a bounded cohorts map (capped, oldest evicted), a metrics strip, and
  a service log. It reconnects a hard-closed `EventSource` and resyncs cohort
  state on reconnect (the runner is a live emitter with no replay, so a missed
  terminal event would otherwise leave a cohort visually stuck).

## Consequences

- The dashboard is pure telemetry: it never signs, never sends, and cannot affect
  a cohort. It can be shown on a projector without exposing anything signable.
- Because it carries no Last-Event-ID replay, the client treats reconnect as a
  resync rather than a resume; acceptable for an operator view.
- The participant store and the dashboard store are fully independent, matching
  the two-store split in ADR 0002.
