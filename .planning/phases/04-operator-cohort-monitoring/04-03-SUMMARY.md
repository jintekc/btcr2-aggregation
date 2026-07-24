---
phase: 04-operator-cohort-monitoring
plan: 03
subsystem: web
tags: [monitoring, operator-console, list-first, status-chips, service-metrics, health-strip, service-name, expander-primitive, freshness]

# Dependency graph
requires:
  - phase: 04-operator-cohort-monitoring
    plan: 01
    provides: "discriminated FetchResult<T> + fetchCohortDetail, the SPA-internal drill-down view state, and the store 401-vs-unreachable poll branching (D-16/D-25) the list read now reuses"
  - phase: 04-operator-cohort-monitoring
    plan: 02
    provides: "the monitoring sibling key { rows, metrics } merged into GET /v1/operator/cohorts (status-chip rows + bounded service metrics) that the console list surface renders"
provides:
  - "List-first operator console (D-07): the service-metrics row + grouped cohort list are the default signed-in view, the create form hides behind a New cohort button (Cancel dismiss), and advertising a draft lands the operator in that cohort's drill-down (D-13)"
  - "Grouped cohort rows under Needs attention / Active / Drafts / Ended (single membership, headings render only when non-empty) with the fixed status-chip tone map (Draft/Filling/Co-signing/Needs funding/Fallback/Anchored/Failed/Expired) + joined/capacity seats (D-04/D-08/D-09)"
  - "Discriminated fetchOperatorCohorts + client monitoring DTO mirrors (CohortChip/CohortSummaryDTO/ServiceMetricsDTO); the store holds the monitoring rows/metrics + a listStale freeze flag and routes the list read's 401/unreachable exactly like the drill-down poll (D-16/D-25)"
  - "HealthStrip: an always-visible compact chip row (mode / network / esplora live-only / IPFS / freshness) with SERVICE_NAME beside the mode chip; freshness derives from the store lastUpdated and freezes the {n}s-ago label on a stale read (D-17/D-25)"
  - "SERVICE_NAME boot-time env carrier threaded demo-server -> createService -> createHonoApp, returned ADDITIVELY on GET /v1/config, surfaced on BOTH the console health strip and the public directory header with no edit surface (D-51)"
  - "Expander promoted from CompletionSummary into ui/primitives as a shared primitive (D-12 reuse map)"
affects: [04-04-drill-down-submissions, 04-06-funding-stage-live-mode, 04-08-live-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive public-DTO extension: GET /v1/config gains an OPTIONAL serviceName only when set, so the frozen network fields (network/label/isMainnet) stay byte-identical and the config.spec key-set pin never moves (D-26/D-51)"
    - "Frozen-on-stale freshness: a 1s tick advances the {n}s-ago label ONLY while not stale; an unreachable read stops the tick so the number freezes honestly instead of climbing past a real time (D-25)"
    - "Single-membership grouping: each cohort is bucketed into exactly one of Needs attention / Active / Drafts / Ended by a priority over its derived chip, resolving the plan's descriptive per-chip overlap so no cohort double-renders and the Needs-attention count is unambiguous (D-11)"
    - "Discriminated list read mirrors the drill-down poll: one FetchResult union tells a 401 (session expiry, honest re-login) apart from a network/5xx fault (freeze the last-known list + banner), instead of the status-blind throwing fetch (D-16/D-25)"

key-files:
  created:
    - packages/web/src/components/operator/HealthStrip.tsx
  modified:
    - packages/web/src/ui/primitives.tsx
    - packages/web/src/components/cohort/CompletionSummary.tsx
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/OperatorCohortList.tsx
    - packages/web/src/components/operator/OperatorConsole.tsx
    - packages/web/src/lib/config.ts
    - packages/web/src/stores/participant.ts
    - packages/web/src/components/browse/ServiceIdentityHeader.tsx
    - packages/service/src/hono-adapter.ts
    - packages/service/src/index.ts
    - packages/service/src/demo-server.ts
    - packages/service/src/config.spec.ts
  deleted: []

key-decisions:
  - "Single-membership group assignment resolves the plan's overlapping group lists (failed listed under both Needs attention and Ended; anchored under both Active and Ended): a priority (attention > active > drafts > ended) buckets each cohort exactly once, so failed/fallback/needs-funding surface as attention, filling/co-signing as active, anchored/expired as ended, and no row double-renders. The fixed tone map still colors each chip identically wherever it renders."
  - "SERVICE_NAME is surfaced on the public directory header via the participant store, not a second fetch: the plan said 'the same /v1/config read the public surface already fetches', but the public header (ServiceIdentityHeader) fetches /v1/status, and the /v1/config read lives in App -> the participant store. Adopting serviceName in loadConfig and reading it from the store in BOTH HealthStrip and ServiceIdentityHeader is the least-fetch, most-consistent path (CreateCohortForm already reads network from the participant store)."
  - "The list read replaced the throwing listCohorts with a discriminated fetchOperatorCohorts so refreshCohorts (called by probe/signIn/submit/advertise/discard AND a new interval poll) branches 401 -> re-login / unreachable -> freeze+banner / ok -> update + lastUpdated, giving the list surface the same honesty the drill-down already had (D-16/D-25)."
  - "ADVERTISED_OK updated to the UI-SPEC verbatim 'Advertised. Now joinable in the directory.' (was the spaced-hyphen 'Advertised - now...'); READVERTISED_OK made period-form for consistency. Both em-dash-free."

patterns-established:
  - "Health strip mode is a reserved default (Hermetic) with a typed ServiceMode union + live-mode gate on the esplora chip, so the live-path plan 04-06 flips mode + reveals the esplora chip without a rewrite (mirrors 04-02's reserved needs-funding chip)."
  - "A list poll runs ONLY on the list view; the drill-down runs its own detail poll. Both stamp the store lastUpdated, so the always-visible health strip freshness is correct in either view."

requirements-completed: []
requirements-advanced: [SVC-03]

coverage:
  - id: T1
    description: "The signed-in console is list-first (D-07): the service-metrics row + grouped list render by default, the create form hides behind New cohort (Cancel dismiss), and advertising a draft lands the operator in that cohort's drill-down (D-13, via the store advertise action)."
    requirement: SVC-03
    verification:
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web build (tsc --noEmit + vite) -> green (694 modules)"
        status: pass
      - kind: manual_procedural
        ref: "OperatorConsole renders HealthStrip + metrics + grouped OperatorCohortList by default; New cohort toggles CreateCohortForm; store advertise() calls openCohort(id) on success"
        status: pass
    human_judgment: false
  - id: T2
    description: "Cohort rows group under Needs attention / Active / Drafts / Ended (single membership; a heading renders only when its group is non-empty); each advertised row shows the fixed-tone status chip (pulse on Filling/Co-signing) + joined/capacity seats; the metrics row shows four tabular-nums count-neutral counters, all 0 at zero cohorts with the No cohorts yet empty state (D-04/D-06/D-08/D-24)."
    requirement: SVC-03
    verification:
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web exec tsc --noEmit -> clean"
        status: pass
      - kind: manual_procedural
        ref: "OperatorCohortList: CHIP tone map + groupForChip single-membership + ServiceMetricsRow (metrics ?? all-zero) + empty-state Card carrying the in-memory-clears-on-restart body"
        status: pass
    human_judgment: false
  - id: T3
    description: "The health strip is always-visible above both views and discloses mode (Hermetic default) / network (mainnet REAL FUNDS variant preserved) / IPFS on-off / freshness; the freshness dot goes warn and the {n}s-ago label FREEZES on a stale read; SERVICE_NAME shows beside the mode chip when set (D-17/D-25/D-51)."
    requirement: SVC-03
    verification:
      - kind: build
        ref: "web build green; HealthStrip mounted in both the detail and list returns of OperatorConsole"
        status: pass
      - kind: manual_procedural
        ref: "HealthStrip: freshness tick advances only while !stale; freshTone warn on listStale||detailStale; serviceName rendered as plain React text (T-04-03-01)"
        status: pass
    human_judgment: false
  - id: T4
    description: "SERVICE_NAME is a boot-time env carrier: threaded demo-server (SERVICE_NAME, trimmed) -> createService -> createHonoApp, returned ADDITIVELY on GET /v1/config only when set (frozen network fields byte-identical), surfaced on BOTH the console health strip and the public directory header with no edit surface (D-51/D-26)."
    requirement: SVC-03
    verification:
      - kind: unit
        ref: "packages/service/src/config.spec.ts#includes the optional serviceName ADDITIVELY when SERVICE_NAME is set (D-51) + the existing key-set pin (no serviceName) stays green"
        status: pass
      - kind: manual_procedural
        ref: "participant store loadConfig adopts dto.serviceName; HealthStrip + ServiceIdentityHeader both read useParticipant(s => s.serviceName)"
        status: pass
    human_judgment: false
  - id: T5
    description: "The list read is discriminated (D-16/D-25): a 401 routes to the session-expired re-login copy at the login panel and clears the drill-down; a network/5xx freezes the last-known list, raises the unreachable banner, and does NOT redirect. The drill-down 401/unreachable pins stay green."
    requirement: SVC-03
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts (8 tests, fetchCohortDetail + pollDetail branching) -> pass, unchanged"
        status: pass
      - kind: manual_procedural
        ref: "store.refreshCohorts: unauthorized -> logged-out + SESSION_EXPIRED + view:list; unreachable -> listStale:true; ok -> cohorts/rows/metrics + lastUpdated. OperatorConsole renders the UNREACHABLE_BANNER on listStale."
        status: pass
    human_judgment: false

# Metrics
duration: 18min
completed: 2026-07-24
status: complete
---

# Phase 4 Plan 03: List-First Operator Console + Health Strip + SERVICE_NAME Summary

**Reworked the authenticated operator console from a two-step create form into the list-first monitoring surface (D-07): a compact honest service-metrics row + status-chip rows grouped under Needs attention / Active / Drafts / Ended, an always-visible health strip disclosing mode/network/IPFS/freshness, and a SERVICE_NAME boot constant threaded additively through GET /v1/config onto both the console strip and the public directory header. The list read now discriminates 401 (honest re-login) from unreachable (freeze + banner), and the Expander was promoted to a shared primitive.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 2
- **Files:** 1 created, 12 modified

## Accomplishments
- Made the signed-in console list-first (D-07/D-13): the service-metrics row + grouped `OperatorCohortList` render by default, the create form hides behind a `New cohort` button with a `Cancel` dismiss, and the store's `advertise()` now calls `openCohort(id)` on success so the operator lands in the freshly-advertised cohort's drill-down.
- Grouped cohort rows under `Needs attention` / `Active` / `Drafts` / `Ended` with single-membership bucketing (headings render only when non-empty) and the fixed UI-SPEC status-chip tone map (Draft neutral / Filling + Co-signing accent-pulse / Needs funding + Fallback warn / Anchored good / Failed + Expired bad), each advertised row showing `{joined}/{capacity}` seats derived from the live monitoring row.
- Rendered the compact service-metrics row: four `tabular-nums` count-neutral counters (`{n} open` / `in flight` / `anchored` / `failed`) that read 0 at zero cohorts above the honest `No cohorts yet` empty state carrying the in-memory-clears-on-restart line (D-06/D-24).
- Added `HealthStrip`, an always-visible compact chip row above both the list and drill-down views: mode (Hermetic default, ready for 04-06's live mode), the network chip (mainnet `· REAL FUNDS` variant preserved), an esplora chip gated on live mode, an IPFS on/off chip, a `Updated {n}s ago` freshness indicator that freezes on a stale read, and SERVICE_NAME beside the mode chip when set (D-17/D-25/D-51).
- Threaded SERVICE_NAME as a boot-time env carrier through `demo-server` (trimmed) -> `createService` -> `createHonoApp`, returned ADDITIVELY on `GET /v1/config` only when set (frozen network fields byte-identical, additive `config.spec` pin), and surfaced it on BOTH the console health strip and the public directory header (`ServiceIdentityHeader`) with no edit surface, rendered as plain auto-escaped React text (T-04-03-01).
- Swapped the throwing `listCohorts` for a discriminated `fetchOperatorCohorts` + client DTO mirrors and rewrote `refreshCohorts` so the list read routes 401 -> honest re-login, unreachable -> freeze the last-known list + `listStale` banner, ok -> update rows/metrics + `lastUpdated`; added a list-view interval poll so chips/metrics/freshness stay live (D-16/D-25).
- Promoted the local `Expander` (collapsed-by-default, `max-h-80 overflow-auto`) from `CompletionSummary` into `ui/primitives` and re-pointed the participant surface at it, no behavior change (D-12 reuse map).
- SVC-03's operator-facing surface (criteria 1-4) advanced from 04-02's read model to a real list-first console rendering the chips + metrics + health disclosure.

## Task Commits

Each task was committed atomically (unsigned per project convention):

1. **Task 1: List-first console shell + grouped rows + status chips + service-metrics row + Expander promote** - `4e128f5` (feat)
2. **Task 2: Health strip (mode/network/esplora/IPFS/freshness) + SERVICE_NAME carrier end to end** - `95a26ec` (feat)

## Files Created/Modified
- `packages/web/src/components/operator/HealthStrip.tsx` (created) - the always-visible mode/network/esplora/IPFS/freshness + SERVICE_NAME strip; typed `ServiceMode` union with a live-mode gate on the esplora chip; frozen-on-stale freshness tick.
- `packages/web/src/ui/primitives.tsx` - added the shared `Expander` primitive (lifted verbatim from CompletionSummary).
- `packages/web/src/components/cohort/CompletionSummary.tsx` - imports the shared `Expander`, local copy removed (no behavior change).
- `packages/web/src/lib/operator.ts` - added `CohortChip`/`CohortSummaryDTO`/`ServiceMetricsDTO`/`OperatorCohortsDTO` mirrors + the discriminated `fetchOperatorCohorts`; removed the superseded throwing `listCohorts`.
- `packages/web/src/stores/operator.ts` - added `rows`/`metrics`/`listStale` state; rewrote `refreshCohorts` to the discriminated 401/unreachable/ok branching; `advertise()` lands in the drill-down; ADVERTISED_OK/READVERTISED_OK copy fixed to UI-SPEC.
- `packages/web/src/components/operator/OperatorCohortList.tsx` - the fixed chip tone map, single-membership grouping, `StatusChip`, `ServiceMetricsRow`, and the restart-honest empty state.
- `packages/web/src/components/operator/OperatorConsole.tsx` - list-first shell, New-cohort toggle, view-as-participant link, the list interval poll, the always-visible HealthStrip mount, and the unreachable freeze banner.
- `packages/web/src/lib/config.ts` - widened the fetch type to `RuntimeConfigDTO` with optional `serviceName`.
- `packages/web/src/stores/participant.ts` - `serviceName` store field adopted in `loadConfig`.
- `packages/web/src/components/browse/ServiceIdentityHeader.tsx` - renders SERVICE_NAME beside the origin.
- `packages/service/src/hono-adapter.ts` - `serviceName?` HonoAppOption; `GET /v1/config` returns it additively when set.
- `packages/service/src/index.ts` - `serviceName?` CreateServiceOption threaded into `createHonoApp`.
- `packages/service/src/demo-server.ts` - `serviceName?` DemoServerOption resolved from `SERVICE_NAME` (trimmed) and passed to `createService`.
- `packages/service/src/config.spec.ts` - additive `serviceName` pin (+ the existing key-set pin held).

## Decisions Made
- **Single-membership grouping resolves the plan's overlapping group lists.** The plan described `failed` under both Needs attention and Ended, and `anchored` under both Active and Ended. Rendering a cohort in two groups would double-render it, so each cohort is bucketed into exactly one group by a priority (attention > active > drafts > ended): `needs-funding`/`fallback`/`failed` -> Needs attention (also backing the D-11 cross-cohort attention count), `filling`/`co-signing` -> Active, `draft` -> Drafts, `anchored`/`expired` -> Ended. The fixed tone map still colors each chip identically wherever it renders.
- **SERVICE_NAME reaches the public header via the participant store, not a second fetch.** The plan claimed the public surface already fetches `/v1/config`; it actually fetches `/v1/status`, and the `/v1/config` read lives in `App` -> the participant store. Adopting `serviceName` in `loadConfig` and reading it from the store in both `HealthStrip` and `ServiceIdentityHeader` is the least-fetch, most-consistent path (CreateCohortForm already reads `network` from the participant store the same way).
- **The list read was made discriminated (D-16/D-25).** Replacing the throwing `listCohorts` with `fetchOperatorCohorts` gave `refreshCohorts` (used by probe/signIn/submit/advertise/discard AND the new interval poll) the same 401-vs-unreachable honesty the drill-down already had: a 401 is a session expiry (honest re-login), a network/5xx freezes the last-known list and raises the banner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Surfaced SERVICE_NAME on the public header via the participant store + ServiceIdentityHeader (files outside Task 2's `<files>` list)**
- **Found during:** Task 2 (SERVICE_NAME on both surfaces)
- **Issue:** The plan's Task-2 action said to thread SERVICE_NAME onto the public directory header "from the same /v1/config read the public surface already fetches", but the public header (`ServiceIdentityHeader`) fetches `/v1/status`, not `/v1/config`; the only `/v1/config` read is in `App` -> the participant store. With no store field there was no path to the header, so the D-51 acceptance criterion (SERVICE_NAME on BOTH surfaces) could not be met.
- **Fix:** Added a `serviceName: string | null` field to the participant store, adopted in `loadConfig` from the widened config DTO, and read it from the store in both `HealthStrip` and `ServiceIdentityHeader`. This mirrors the existing pattern (CreateCohortForm reads `network` from the participant store) and avoids a redundant fetch.
- **Files modified (beyond Task 2 `<files>`):** `packages/web/src/stores/participant.ts`, `packages/web/src/components/browse/ServiceIdentityHeader.tsx`
- **Committed in:** `95a26ec` (Task 2 commit)

**2. [Rule 3 - Blocking] Removed the superseded throwing `listCohorts` and switched its single consumer**
- **Found during:** Task 1 (extending the list read consumption)
- **Issue:** The plan required the list read to be discriminated (401/unreachable/ok), but `listCohorts` threw on any non-ok and dropped the `monitoring` sibling. Keeping it as dead code alongside the new discriminated fetch would be misleading.
- **Fix:** Added `fetchOperatorCohorts` (discriminated, returns the full `{ cohorts, monitoring }` DTO) and removed `listCohorts`; its only consumer was the store's `refreshCohorts`, now rewritten onto the new fetch.
- **Committed in:** `4e128f5` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both blocking-issue consequences of meeting the D-51 / discriminated-read requirements). No behavioral surprises; all other work matched the plan.

## Known Stubs
None that block the plan goal. The health-strip **mode chip is fixed to `Hermetic`** and the **esplora chip is gated on a live mode** (so it stays hidden this plan). This is an INTENTIONAL reserved default the plan directed ("default to Hermetic until then"): the live-path plan **04-06** threads the real mode through the monitoring payload, flipping the mode chip to `Live` / `Live (no broadcast)` and revealing the esplora reachability chip. The typed `ServiceMode` union + `LIVE_MODES` gate are already in place so 04-06 flips them without a rewrite. No invented data flows to the UI: a hermetic service honestly reads Hermetic. This mirrors 04-02's reserved `needs-funding` chip and is not a defect.

## Verification Evidence
- `pnpm test` (tsc -b + vitest, the committed CI gate) -> **393 passed** (29 files), no regressions (+1 vs 04-02's 392: the additive `config.spec` serviceName pin).
- `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` -> clean.
- `pnpm --filter @btcr2-aggregation/web build` (Vite + tsc) -> green (694 modules).
- `pnpm --filter @btcr2-aggregation/service exec tsc -b` -> exit 0 (all createService/createHonoApp/demo-server call sites compile with the new optional `serviceName`).
- `pnpm vitest run packages/service/src/config.spec.ts` -> **7 passed** (the additive serviceName pin + the byte-identical key-set pin both green).
- `pnpm vitest run packages/web/tests/operator.spec.ts` -> **8 passed** (the drill-down fetchCohortDetail + pollDetail 401/unreachable pins unchanged).
- `pnpm lint` (eslint on all changed files) -> clean.
- Em-dash scan over all created/modified files -> none.

## Threat Surface
No new network endpoints or auth paths. The `GET /v1/config` extension is additive and optional (frozen network fields byte-identical when SERVICE_NAME is unset, proven by the retained key-set pin), and `serviceName` is an operator boot constant, not participant input. Threat-register dispositions are covered: T-04-03-01 (XSS via SERVICE_NAME) is mitigated by rendering it as auto-escaped React text content on both surfaces (no `dangerouslySetInnerHTML`, no URL context); T-04-03-02 (mode/esplora chips) is accept (public operational facts, operator-gated regardless); T-04-03-03 (freshness spoofing) is mitigated by deriving freshness from the store's own `lastUpdated` and freezing the label on a stale read rather than showing a fresh time (D-25).

## Next Phase Readiness
- 04-04 renders the drill-down submissions / co-sign / anchor / activity concern sections on top of the drill-down shell this plan keeps.
- 04-06 (live funding stage) populates the health-strip live mode + esplora chip and the reserved `needs-funding` list chip.
- 04-08 (live UAT) exercises the full list-first console + health strip + SERVICE_NAME against Polar/regtest.

## Self-Check: PASSED

- `packages/web/src/components/operator/HealthStrip.tsx` -> FOUND
- `.planning/phases/04-operator-cohort-monitoring/04-03-SUMMARY.md` -> FOUND
- Task 1 commit `4e128f5` -> FOUND
- Task 2 commit `95a26ec` -> FOUND

---
*Phase: 04-operator-cohort-monitoring*
*Completed: 2026-07-24*
