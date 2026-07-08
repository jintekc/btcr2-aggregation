---
phase: 01-authenticated-operator-console-on-demand-cohort-creation
plan: 04
subsystem: e2e
status: complete
tags: [e2e, operator, auth, advertise, lifecycle, hermetic, host-01, svc-01, svc-02, course-correction]
requires:
  - "Wave 1 (01-01): operator-auth session cookie + requireOperator/requireSameOrigin guards; createService operatorPassword/operatorCookieSecure options; gated /dashboard/events"
  - "Wave 2 (01-02): gated POST/GET/DELETE /v1/operator/cohorts (create/list/discard drafts)"
  - "Wave 3 (01-03): gated POST /v1/operator/cohorts/:id/advertise (sole runner.advertiseCohort caller, D-17) + public GET /v1/directory + GET /v1/status; boot-time auto-advertise loop removed"
  - "@did-btcr2/aggregation runner.advertiseCohort self-drives a cohort to completion; signing-complete carries the 64-byte AggregationResult.signature; HttpServerTransport caches adverts (5-min TTL) for late SSE subscribers"
provides:
  - "e2e/operator-cohort.ts: hermetic capstone harness proving login -> create -> advertise -> headless join -> co-sign for an operator-advertised cohort (ROADMAP success criterion 4)"
  - "in-harness regression guards: session.cohorts.length === 0 at boot (T-04-02, D-17) + the signing cohort is the advertised one; wrong-password 401 no-cookie + no-cookie 401 on /v1/operator/cohorts AND /dashboard/events (T-04-01)"
  - "package.json e2e:operator script (tsc -b && tsx e2e/operator-cohort.ts), hermetic offline/fixture path, zero new dependency"
affects:
  - "package.json (new e2e:operator gate script)"
tech-stack:
  added: []
  patterns:
    - "operator flow driven over real HTTP with Node fetch: no cookie jar, so capture the operator_session Set-Cookie on login and echo name=value as the cookie header on every gated call (RESEARCH cookie recipe)"
    - "operatorCookieSecure:false so the session cookie round-trips over plain http on loopback (Pitfall 2); a real deploy leaves Secure on behind TLS"
    - "no runner.run(): advertiseCohort (via the operator route) self-drives; the harness observes the 64-byte signature off the service signing-complete event and each participant's cohort-complete"
    - "advertise BEFORE starting participants is safe because the transport advert cache replays the advert to late /v1/adverts subscribers (5-min TTL)"
    - "withTimeout wraps signing + participant-completion so a stall fails the gate instead of hanging"
key-files:
  created:
    - e2e/operator-cohort.ts
  modified:
    - package.json
decisions:
  - "Assert the SIGNED cohort id equals the operator-advertised cohort id (belt-and-suspenders on T-04-02: no phantom auto-advertised cohort exists to sign)"
  - "THRESHOLD=2 capacity=2 CAS cohort on the offline/fixture path (no store, no bitcoin, no LIVE) - the smallest real n-of-n that still produces a genuine aggregated signature"
  - "e2e:operator registered but deliberately NOT wired into CI in this plan (CI is a Phase-6 / separate concern per the plan)"
metrics:
  duration: ~8 min
  completed: 2026-07-08
  tasks: 1
  files_created: 1
  files_modified: 1
---

# Phase 1 Plan 04: Hermetic Operator-Advertise Lifecycle e2e Summary

The Phase-1 capstone: one hermetic tsx harness (`e2e/operator-cohort.ts`, script `e2e:operator`) that drives the whole slice together over the real HTTP surface and proves ROADMAP success criterion 4. An operator authenticates, creates a cohort draft, advertises it on demand, and two real headless `createParticipant` peers discover it through the public directory, join, submit signed updates, and co-sign the n-of-n MuSig2 beacon to a 64-byte aggregated Taproot signature - with the auth boundary and the on-demand-only driver both pinned as in-harness regression guards, on the offline/fixture (zero-chain) path with no new dependency.

## What Shipped

**Task 1 - `e2e/operator-cohort.ts` + the `e2e:operator` script.** The harness mirrors the `e2e/headless-cohort.ts` idiom (real `createService` on an ephemeral loopback port, in-process participants over `HttpClientTransport`, `withTimeout`, an `invokedDirectly` `main()` returning an exit code, `E2E PASSED` / `E2E FAILED` output) and runs these steps against one operator-enabled service booted with `operatorPassword` + `operatorCookieSecure: false`:

1. **Loop-removed assertion (D-17, T-04-02):** immediately after `start`, `service.runner.session.cohorts.length === 0` - a fresh self-hosted service advertises nothing until the operator acts.
2. **Negative auth (T-04-01):** a wrong-password `POST /v1/operator/login` is 401 with an empty `getSetCookie()`; a no-cookie `GET /v1/operator/cohorts` is 401; a no-cookie `GET /dashboard/events` is 401 (the guard runs before the SSE stream opens, so it returns a normal 401 body, not a hanging stream).
3. **Login:** `POST /v1/operator/login` with the correct password; capture the `operator_session` Set-Cookie and echo its `name=value` pair as the `cookie` header on every gated call (Node fetch has no cookie jar).
4. **Create:** authed `POST /v1/operator/cohorts` with `{ beaconType: 'CASBeacon', threshold: 2, capacity: 2 }` -> 201, state `draft`.
5. **Advertise:** authed `POST /v1/operator/cohorts/:draftId/advertise` -> 200, state `advertised`; the returned `draftId` is now the live cohort id.
6. **Public read surface:** no-cookie `GET /v1/directory` contains the advertised cohort as an open entry (matching beacon type + threshold), and `GET /v1/status` reports `up` with `openCohorts >= 1`.
7. **Lifecycle:** spawn `threshold` (2) headless participants; they discover the advertised cohort via the advert-cache replay on `/v1/adverts`, join, and co-sign. The harness observes `signing-complete` off the service runner (there is no `runner.run()` - the operator route's `advertiseCohort` self-drives) and asserts a 64-byte aggregated signature, that every participant reached `cohort-complete`, and that the cohort which signed is exactly the operator-advertised cohort id.
8. **Clean shutdown:** stop each participant, then `service.stop()` in a `finally`.

`package.json` gains `"e2e:operator": "tsc -b && tsx e2e/operator-cohort.ts"` alongside the existing `e2e:*` scripts.

## Verification

- `pnpm e2e:operator` - exit 0, prints `E2E PASSED`; the full log shows boot (0 cohorts), the three negative-auth denials, login, create, advertise, directory/status, both participants reaching `cohort-complete`, and the 64-byte aggregated signature for the operator-advertised cohort.
- Acceptance greps: `grep -c 'operator_session' e2e/operator-cohort.ts` = 6 (>= 1); `grep -c 'advertise' e2e/operator-cohort.ts` = 32 (>= 1); `grep -c 'e2e:operator' package.json` = 1 (>= 1).
- Hermetic: the only two `LIVE` matches in the file are doc comments (documenting the ABSENCE of a live path); no `LIVE` env, no esplora host, no `bitcoin` connection, no `store` - the offline/fixture beacon-tx path.
- `pnpm lint` (`eslint .`) - clean (the new file passes the flat config).
- House style: `grep -c '—' e2e/operator-cohort.ts` = 0 (no em-dash character).

## Threat Mitigations (from the plan register)

- **T-04-01 (EoP, gated routes regress open) - mitigated + asserted:** wrong-password 401 (no Set-Cookie) + no-cookie 401 on both `/v1/operator/cohorts` and `/dashboard/events`; a regression fails the gate.
- **T-04-02 (EoP, a fresh service auto-advertises) - mitigated + asserted:** `session.cohorts.length === 0` at boot, plus the extra guard that the signing cohort id equals the operator-advertised cohort id (no phantom auto-advertised cohort exists to sign).
- **T-04-03 (DoS, non-hermetic / flaky chain) - mitigated:** offline/fixture path only (no LIVE, no esplora); `withTimeout` bounds both the signing and participant-completion awaits; participants are the dev/test path (D-18).
- **T-04-SC (Tampering, npm installs) - accept:** zero new packages (tsx + the workspace packages already present).

## Deviations from Plan

**None that changed scope.** Two in-spirit implementation choices worth recording:

1. **[Rule 3 - mechanism] The harness never calls `runner.run()`.** The plan sketched adapting `runHeadlessCohort`, which awaits `service.runner.run()`. That convenience path advertises the runner's boot `config` cohort - which would both create a second, non-operator-driven cohort AND violate the loop-removed intent. Instead the harness lets the operator advertise route drive the cohort (`advertiseCohort` self-drives to completion per the library facade) and observes the 64-byte signature off the service `signing-complete` event and each participant's `cohort-complete`. Same real cohort, driven only by the operator's action.
2. **[Rule 2 - robustness] Participants are started AFTER advertise, relying on the advert cache.** The `HttpServerTransport` caches adverts (5-min TTL) and replays them to late `/v1/adverts` subscribers, so a participant that connects after the operator advertises still discovers the cohort deterministically. This keeps the harness narrative faithful (create -> advertise -> confirm directory -> participants join) without a race on the 60 s advert-republish interval.

## Notes for Downstream Phases

- `e2e:operator` is registered but NOT wired into the CI workflow (per the plan, CI is a Phase-6 / separate concern). A later phase that touches CI should add it to the hermetic gate alongside `e2e:resolve` etc.
- The legacy browser e2es (`e2e/browser-cohort.ts`, `e2e/browser-prod-cohort.ts`) still assume the removed auto-advertise loop and remain unwired to the operator advertise flow. They are outside this plan's declared files and were NOT touched; a future phase (or the Phase-6 booth-retirement sweep) should rewire them. They were not part of this plan's gate, so no `e2e:browser*` run was performed here.
- The harness is a reusable template for any future authed-operator scenario (the cookie-echo + `operatorCookieSecure: false` + observe-events-not-run() recipe).

## Known Stubs

- None. The harness exercises the real end-to-end path (real HTTP, real MuSig2 co-sign, real 64-byte aggregated signature) and every assertion reads live state.

## Self-Check: PASSED

`e2e/operator-cohort.ts` present; `package.json` `e2e:operator` present; commit `65e36e1` verified in git history; `pnpm e2e:operator` exits 0 with `E2E PASSED`.
