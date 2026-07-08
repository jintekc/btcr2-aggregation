---
phase: 01-authenticated-operator-console-on-demand-cohort-creation
plan: 03
subsystem: operator-cohorts
status: complete
tags: [operator, cohorts, advertise, directory, status, svc-02, hono, react, course-correction]
requires:
  - "Wave 1 (01-01): operator-auth.ts requireOperator/requireSameOrigin guards + the gated /v1/operator/* prefix"
  - "Wave 2 (01-02): operator-cohorts.ts drafts Map (each draft keeps its built CohortConfig) + createDraft/discardDraft/listCohorts"
  - "@did-btcr2/aggregation runner.advertiseCohort(config) + runner.session.cohorts / getCohortPhase (the live-set source)"
provides:
  - "operator-cohorts.ts: advertiseDraft (the SOLE runner.advertiseCohort caller) + directory() + status() derived from the live advertised set"
  - "gated POST /v1/operator/cohorts/:id/advertise; public GET /v1/directory + GET /v1/status (mounted unconditionally, empty-safe fallback)"
  - "demo-server.ts with the boot-time perpetual auto-advertise loop + boot-path fillers removed (on-demand operator-driven service)"
  - "web lib/operator advertise + fetchStatus + fetchDirectory (public, credentials omitted) + DirectoryCohortDTO/ServiceStatus; store advertise action + transient confirmation"
  - "OperatorCohortList Advertise cohort CTA + accent Advertised badge + live joined/capacity; PublicStatus anonymous card; App.tsx renders it"
affects:
  - "packages/service/src/hono-adapter.ts, index.ts (runner threaded into createOperatorCohorts)"
  - "packages/web/src/App.tsx (anonymous surface now renders PublicStatus)"
tech-stack:
  added: []
  patterns:
    - "advertiseDraft is the one and only runner.advertiseCohort call site (D-17); the perpetual while(running) loop is deleted"
    - "directory() = live runner.session.cohorts filtered to pre-signing OPEN_PHASES {Advertised, CohortSet, CollectingUpdates}, enriched from a per-cohort config Map (D-15)"
    - "enrichment Map pruned on completion.finally (+ .catch to swallow the failed-cohort rejection) so directory/status never outlive the live set (Pitfall 5)"
    - "status().openCohorts reuses directory().length so the public count and the directory are one source and cannot drift (D-09)"
    - "public directory/status mounted unconditionally like /v1/config, with an empty-safe fallback when no operator surface is configured"
key-files:
  created:
    - packages/web/src/components/operator/PublicStatus.tsx
  modified:
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/operator-cohorts.spec.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/src/index.ts
    - packages/service/src/demo-server.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/OperatorCohortList.tsx
    - packages/web/src/App.tsx
decisions:
  - "OPEN_PHASES = {Advertised, CohortSet, CollectingUpdates} (RESEARCH A1): pre-signing / still-joinable phases only; a signing or settled cohort is excluded from the open directory"
  - "The advertised enrichment Map is keyed by the LIVE cohort id and is enrichment-only; membership + openness always derive from runner.session.cohorts (D-15)"
  - "advertiseDraft returns undefined for an unknown draft id (route 404); an already-advertised id is gone from the drafts Map so it reads as unknown too"
  - "The fillers option is retained but INERT on the boot path (dev/test-only, D-18) so existing callers that pass fillers:0 still compile; boot spawns no in-process peers"
metrics:
  duration: ~13 min
  completed: 2026-07-08
  tasks: 3
  files_created: 1
  files_modified: 9
---

# Phase 1 Plan 03: On-Demand Advertise + Public Directory/Status Summary

This is the course-correction's pivotal wave. Advertising a cohort is now an explicit, authenticated operator action rather than a boot-time perpetual `while` loop: `advertiseDraft` in `operator-cohorts.ts` is the one and only caller of `runner.advertiseCohort`, a public `GET /v1/directory` lists the open cohorts derived straight from the live `runner.session.cohorts` (one source of truth, no parallel list), a public `GET /v1/status` reports up/network/open-count from that same source, and the boot-time auto-advertise loop plus its in-process fillers are gone. A fresh self-hosted service now advertises nothing until the operator acts, and an advertised draft shows up as an open joinable directory entry with a truthful anonymous open-cohort count (SVC-02, D-09/D-14/D-15/D-17/D-18) - directly proving ROADMAP success criterion 3.

## What Shipped

**Task 1 - advertise + directory + status (test-first, TDD):** RED first (commit `a7f73bd`): the `operator-cohorts.spec.ts` helper was rebuilt over a REAL `AggregationServiceRunner` and four new behaviors were asserted (advertise moves a draft into the directory as an open entry; `advertiseCohort` called exactly once; directory/status derive from the live set and drop the cohort after `completion` settles; advertise gated 401/404 while directory/status are public 200) - 3 failed as expected. GREEN (commit `abca42e`): `advertiseDraft(draftId)` looks up the draft, calls `runner.advertiseCohort(config)` once (the SOLE call site now, D-17), moves it into an `advertised: Map<cohortId, CohortConfig>` enrichment map, deletes the draft, and arms `void completion.finally(() => advertised.delete(cohortId)).catch(...)` so a settled (or failed/stalled) cohort is pruned without ever raising an unhandled rejection. `directory()` iterates `runner.session.cohorts`, keeps only those in the pre-signing `OPEN_PHASES` set `{Advertised, CohortSet, CollectingUpdates}` (RESEARCH A1) that still hold an enrichment config, and maps each to a minimal DTO (`cohortId/beaconType/network/threshold/capacity/joined/phase`). `status()` returns `{ up, network, openCohorts: directory().length }` so the count cannot drift (D-09). `listCohorts()` now returns drafts (state `draft`) plus advertised entries (state `advertised`). Routes: gated `POST /v1/operator/cohorts/:id/advertise` inside the plan-01 `if (operatorAuth)` block (inherits `requireSameOrigin` + `requireOperator`), and public `GET /v1/directory` + `GET /v1/status` mounted unconditionally like `/v1/config`, with an empty-safe fallback (`[]` / `openCohorts: 0`) when no operator surface is configured. `index.ts` threads the live `runner` into `createOperatorCohorts` and exports the new DTO types.

**Task 2 - remove the demo driver (commit `7ce0201`):** deleted the perpetual `while (running)` advertise loop, its `running` flag, and its fire-and-forget invocation from `demo-server.ts`; removed the boot-path in-process filler spawning and the `createParticipant`/`Participant` import; dropped the `FILLERS` env read + pass-through. Kept `createService(...)`, the listening log (reworded, and it now logs that the service is idle until the operator advertises), the `stop()` handle, and the SIGINT/SIGTERM graceful shutdown. Reframed the module/`stop()`/option docs as an on-demand operator-driven service (D-20) with no booth/attendee wording, and without writing the removed loop construct or the runner advertise API name verbatim in any comment (so the removal greps stay truthful).

**Task 3 - web advertise + public status (commit `44a47b0`):** `lib/operator.ts` gained `advertise` (same-origin POST), `fetchStatus`/`fetchDirectory` (public, `credentials: 'omit'`), the `DirectoryCohortDTO`/`ServiceStatus` types, and a widened `OperatorCohortDTO` (`joined` + `state: 'draft' | 'advertised'`). The `useOperator` store gained `advertiseStatus`/`advertisingId`/`advertiseMessage` and an `advertise` action (shows the transient good-tone confirmation, refreshes the list, self-clears after 4 s; reset on sign-out). `OperatorCohortList` renders a primary `Advertise cohort` CTA (`Advertising…` while in flight) + `Discard draft` on draft rows, and an accent `Advertised` badge with live `{joined}/{capacity}` seats on advertised rows (no actions - pause/cancel is Phase 5). `PublicStatus.tsx` is a new anonymous card (good-tone pulsing `StatusDot` + `Service online`, the active-network chip reusing the header treatment incl. the mainnet `· REAL FUNDS` variant, and `{n} open cohorts` / `No open cohorts right now`) polling `/v1/status` every 10 s. `App.tsx` renders `<PublicStatus />` above the participant flow on the anonymous surface; `/operator` is unchanged.

## Verification

- `pnpm vitest run packages/service/src/operator-cohorts.spec.ts` - 17 passed (12 create/validate/discard/list + gated-401 from plan 02, plus 5 new advertise/directory/status/drift/public cases).
- `pnpm vitest run packages/service` - 176 passed (14 files).
- `pnpm --filter @btcr2-aggregation/service exec tsc -b` - exit 0.
- `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` + `build` - exit 0 (bundle-size warning only, pre-existing).
- `pnpm lint` (`eslint .`) - exit 0.
- Removal greps: `grep -Fc 'while (running)' demo-server.ts` == 0; `grep -c 'advertiseCohort' demo-server.ts` == 0; `grep -c 'advertiseCohort(' operator-cohorts.ts` == 1 (the sole caller); `grep -c 'session.cohorts' operator-cohorts.ts` == 6; `grep -c 'completion.finally' operator-cohorts.ts` == 1; `grep -c 'SIGINT' demo-server.ts` == 1; `createService(` still present.
- Web greps: `Advertise cohort` x2 in OperatorCohortList; Advertised badge uses `accent` tone; `Service online` + `open cohorts` + `No open cohorts right now` present in PublicStatus; `font-medium` x0 in PublicStatus (no 500-weight creep); `PublicStatus` x2 in App.tsx; the status fetch omits credentials (helper uses `credentials: 'omit'`; the one `credentials` token in PublicStatus.tsx is a doc comment).

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed RED -> GREEN: a `test(01-03)` commit (`a7f73bd`, 3 failing) precedes the `feat(01-03)` implementation commit (`abca42e`, 17 green). No test passed unexpectedly during RED.

## Threat Mitigations (from the plan register)

- **T-03-01 (EoP, advertise route) - mitigated + test-backed:** registered inside the `if (operatorAuth)` block after `requireOperator`; spec asserts 401 without a session.
- **T-03-02 (Info disclosure, public DTOs) - mitigated:** `DirectoryCohortDTO`/`ServiceStatusDTO` expose only `cohortId/beaconType/network/threshold/capacity/joined/phase` and `up/network/openCohorts`; no keys, recovery key, or participant DIDs (only a count).
- **T-03-03 (CSRF on advertise) - mitigated:** inherits the plan-01 `requireSameOrigin` prefix guard (Origin/Referer) atop `SameSite=Strict`.
- **T-03-04 (directory drift) - mitigated:** membership from live `session.cohorts` + phase filter; enrichment pruned on `completion.finally` (verified by the drift test).
- **T-03-05 (second uncontrolled driver) - mitigated + grep-verified:** the perpetual loop is deleted; `while (running)` absent and demo-server no longer calls the runner advertise API; on-demand advertise is the only driver.
- **T-03-SC:** zero new packages this phase.

## Deviations from Plan

**None that changed scope.** Minor, in-spirit refinements:

1. **[House style] Advertise success copy uses a spaced hyphen, not an em-dash.** The UI-SPEC copy is `Advertised — now joinable in the directory.`; the repo's global writing rule forbids the em-dash character in anything authored, so the store uses `Advertised - now joinable in the directory.` (same words, spaced hyphen). No acceptance grep checks this exact string; the two grep-checked public-status strings are verbatim.
2. **[Rule 3 - blocking] The test runner must NOT set `advertRepeatIntervalMs: 0`.** The first GREEN run failed because a `0` advert-repeat makes the runner use `sendMessage` (which `HttpServerTransport` rejects with `MISSING_RECIPIENT`), failing the cohort within milliseconds and emptying the directory before the assertions ran. The spec helper uses the runner's default repeating broadcast and calls `runner.stop()` in each advertising test to clear the republish timer. Product code was correct; this was a test-harness fix.
3. **[Rule 2 - compat] The `fillers` DemoServerOptions field is retained but inert.** The plan said fillers become dev/test-only default-off; rather than delete the field (which would break existing e2e that pass `fillers: 0` at root typecheck), it is kept and documented as inert on the boot path. No in-process peers are spawned at boot.

## Notes for Downstream Plans (04)

- The e2e (`e2e/operator-cohort.ts`, plan 04) drives login -> create -> advertise -> co-sign -> resolve; `advertise` is `POST /v1/operator/cohorts/:id/advertise` and returns the advertised DTO (`state: 'advertised'`, `draftId` = the live cohort id).
- The advertised DTO's `draftId` holds the LIVE cohort id; the public directory keys on `cohortId`. Both refer to the same runner cohort.
- The existing browser e2e (`e2e/browser-cohort.ts`, `e2e/browser-prod-cohort.ts`) still assume the removed auto-advertise loop and will need rewiring to the operator advertise flow in plan 04 (they are outside this plan's gate, which is service vitest + service/web typecheck + web build). `e2e/config.ts:240` has a now-stale comment referencing a "background advertise loop" - a comment only, no behavior.
- `runner.advertiseCohort` must use the default repeating advert broadcast over `HttpServerTransport` (a fixed `advertRepeatIntervalMs: 0` fails the cohort instantly with MISSING_RECIPIENT).

## Known Stubs

- None. The advertise -> directory -> status loop is wired end to end and derived from the live set. `joined` reflects real accepted-participant counts once participants opt in (0 for a freshly advertised cohort with no members yet, which is correct, not a stub).

## Self-Check: PASSED

All created/modified files verified present; all four task commits (`a7f73bd`, `abca42e`, `7ce0201`, `44a47b0`) verified in git history.
