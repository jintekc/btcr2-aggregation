# ADR 0016: Polled monitoring read model - a server-side event fold behind gated snapshot reads

- Status: Accepted
- Date: 2026-07-24
- Milestone: v1 Phase 4 (Operator Cohort Monitoring; SVC-03)
- Supersedes: ADR 0004 (the read-only dashboard SSE telemetry channel)
- Amends: ADR 0015 (the SSE-gating rationale for the operator session; see below)

## Context

Phase 4 delivers the operator monitoring surface (SVC-03): a per-cohort drill-down where the
authenticated operator watches members join, submissions arrive, the MuSig2 co-sign round
progress, and the beacon anchor confirm, plus a list-first console with live status chips and a
service-metrics row.

The M2 design (ADR 0004) fed the operator "Coordinator" view from a read-only Server-Sent-Events
channel, `GET /dashboard/events`: `bridgeRunnerToSse` registered one listener per runner event and
streamed serialized frames, and the browser `stores/dashboard.ts` reduced them with an
`EventSource` into a bounded cohorts map. Phase 1 (ADR 0015) then gated that feed behind the
operator session, and its central technical argument for an httpOnly cookie was precisely that
`EventSource` cannot set an `Authorization` header: only a same-origin cookie could gate the SSE
stream without rewriting the transport.

That channel has two structural problems for a real monitoring surface:

1. **No fresh-load truth.** SSE carries no replay (no `Last-Event-ID` resume). A fresh page load,
   a reconnect, or a single missed terminal event leaves a cohort visually stuck: the client must
   treat every reconnect as a resync and hope the live emitter re-emits enough to rebuild state.
   For a monitoring console the operator reloads at will, that is a persistent lie surface.
2. **Two data paths.** The SSE stream plus a client-side reducer was a second, parallel state
   machine living beside the operator's already-polled cohort list read. Two paths that can
   disagree is exactly the drift a monitoring surface must not have.

The `AggregationServiceRunner` already emits a typed event for every lifecycle milestone
server-side, and this repo already proved the bounded per-service event-fold pattern in
`anchor-state.ts`. So the honest read model is available without the SSE channel at all.

## Decision

**Retire the dashboard SSE channel and serve monitoring from a server-side event fold behind
gated, polled snapshot reads. One data path, always fresh on load.**

1. **A per-service monitoring fold (`packages/service/src/monitor.ts`).** `createCohortMonitor`
   subscribes ONCE to every runner event (all 14) plus the broadcaster frames, and folds them into
   two bounded per-cohort structures: a live `entries` fold (members pending vs seated, who
   submitted with a server wall-clock stamp, honest co-sign nonce progress, the funding view on
   the live path) and a retained `ended` set (the terminal fate: anchored, fallback, or failed).
   It captures ended-record facts AT EVENT TIME, because the runner GCs a cohort's session state
   on completion, so a fold that read the session lazily would find nothing. The activity log is a
   bounded per-cohort ring buffer (mirroring the anchor-state cap), delivered inside the detail
   DTO so it survives a fresh page load.

2. **Gated, polled snapshot reads.** Two reads mount inside the existing `operatorAuth` block: a
   summary list read (`GET /v1/operator/cohorts`, the Phase 1 operator list widened with an
   ADDITIVE `monitoring` sibling carrying the chip rows + service metrics) and a per-cohort detail
   read (`GET /v1/operator/cohorts/:id`, plus a sibling `:id/export` JSON download). The console
   polls the summary while the list is mounted and the detail only while its drill-down is open, a
   few seconds apart. Every read is an ordinary same-origin `fetch` carrying the session cookie; a
   401 routes to a re-login, a network or 5xx failure freezes the last-known view honestly behind a
   "can't reach this service" banner with quiet retry, and the health strip carries a freshness
   indicator.

3. **The SSE channel and its client are deleted.** `dashboard-sse.ts`, the `/dashboard/events`
   mount, the `bridgeRunnerToSse` re-export, the browser `stores/dashboard.ts`, and the
   `DashboardView` are removed. The 404/401 negative-auth pins that guarded `/dashboard/events`
   migrate onto the new gated snapshot reads, which are the security evidence's new home.

4. **Public surfaces stay byte-untouched.** The public `DirectoryCohortDTO`, `GET /v1/status`, and
   the public anchor read `GET /v1/anchor/:cohortId` are unchanged. All monitoring detail is
   operator-gated only; the mid-round participant funding signal rides a NEW additive sibling read
   (`GET /v1/funding/:cohortId`), never the frozen anchor read.

## Consequences

- **Fresh-load truth by construction.** The server holds the authoritative fold; the console
  renders whatever the latest poll returned, so a reload or a reconnect is always current, and a
  missed frame cannot strand a cohort. Restart honesty is explicit: the fold is in-memory
  (single-box, ADR 0014), so a process restart clears it and the console says so plainly.
- **One data path.** The operator list read and the monitoring reads are the same polled surface;
  there is no second client reducer to drift.
- **DoS-bounded.** The activity ring and the ended-record set are capped and evict oldest-first,
  reusing the proven `remember`/evict idiom, so a long-lived service cannot grow monitoring memory
  without bound.
- **This ADR supersedes ADR 0004.** The read-only public telemetry channel of M2 no longer exists
  in any form; ADR 0015 had already moved it operator-only, and this ADR removes the channel
  itself.

## Amendment to ADR 0015 (the operator session)

ADR 0015's most consequential stated constraint was that `EventSource` cannot send an
`Authorization` header, so only a same-origin httpOnly cookie could gate `GET /dashboard/events`.
That feed is now retired, so that specific constraint is no longer a live driver of the scheme.

**The httpOnly opaque session cookie survives unchanged, on its own independent merits**, and this
ADR makes NO change to the auth scheme:

- Server-tracked opaque ids let logout truly invalidate a session server-side, which a stateless
  JWT could not without a denylist.
- A CSPRNG server-issued id makes session fixation impossible.
- `SameSite=Strict` plus a same-origin Origin/Referer check on mutating routes gives CSRF defense
  in depth, and httpOnly keeps the id out of reach of any script.

The gated monitoring reads are ordinary same-origin `fetch` calls that carry the cookie the same
way, so nothing about the credential, the login flow, the throttle, or the negative tests changes;
only the transport those tests pin moved from the SSE feed onto the polled snapshot reads.

## Alternatives considered

- **Keep or extend the dashboard SSE.** Rejected (D-19): SSE has no fresh-load truth, it is a
  second data path beside the polled operator list, and gating it forced the EventSource-header
  contortion in the first place. A monitoring console reloads constantly; a snapshot read is the
  honest fit.
- **A WebSocket monitoring channel.** Rejected for the same fresh-load and second-path reasons,
  plus it adds a stateful transport a single-box self-host does not need.
- **Fold the monitoring state into `anchor-state.ts` or `operator-cohorts.ts`.** Rejected: an
  independent `monitor.ts` subscribes to the same emitters without entangling the frozen public
  anchor read or the advertise-lifecycle store; the merged summary read composes the operator list
  and the monitor at the DTO layer, and the three bounded 24-cap stores stay independent.
