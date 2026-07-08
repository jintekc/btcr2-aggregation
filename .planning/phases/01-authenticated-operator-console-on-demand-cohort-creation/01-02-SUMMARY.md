---
phase: 01-authenticated-operator-console-on-demand-cohort-creation
plan: 02
subsystem: operator-cohorts
status: complete
tags: [operator, cohorts, drafts, svc-01, hono, react, validation]
requires:
  - "Wave 1 (01-01): operator-auth.ts requireOperator/requireSameOrigin guards + operatorAuth mount (gated /v1/operator/* prefix)"
  - "@btcr2-aggregation/shared buildCohortConfig(threshold, beaconType, network, recoveryKey) + BeaconType/NetworkName"
  - "@did-btcr2/aggregation CohortConfig (maxParticipants optional ceiling)"
  - "node:crypto randomUUID"
provides:
  - "operator-cohorts.ts: createOperatorCohorts({activeNetwork, recoveryKey}) -> createDraft/discardDraft/listCohorts over a per-service drafts Map"
  - "gated POST/GET/DELETE /v1/operator/cohorts routes (create 201 / validation 400 / discard 200|404 / no-session 401)"
  - "web lib/operator createDraft/listCohorts/discardDraft + OperatorCohortDTO; store cohorts/createStatus/formError + submitDraft/discard/refreshCohorts"
  - "CreateCohortForm (CAS/SMT, threshold, capacity, active-network read-only Badge) + OperatorCohortList (Draft rows, discard-with-confirm)"
affects:
  - "packages/service/src/hono-adapter.ts, index.ts (operatorCohorts option threaded fail-closed)"
  - "packages/web/src/components/operator/OperatorConsole.tsx (placeholder replaced with form + list)"
tech-stack:
  added: []
  patterns:
    - "per-createService drafts closure Map (no module singleton; mirrors seatedRosterKeys/genesisStaging)"
    - "app-side capacity ceiling: buildCohortConfig then config.maxParticipants = capacity (D-11/D-19)"
    - "server + client share the exact UI-SPEC validation copy; client validates first, server 400 is the backstop"
    - "cohort routes registered inside the operatorAuth block, after the prefix guards, so they always inherit session + CSRF gating"
key-files:
  created:
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/operator-cohorts.spec.ts
    - packages/web/src/components/operator/CreateCohortForm.tsx
    - packages/web/src/components/operator/OperatorCohortList.tsx
  modified:
    - packages/service/src/hono-adapter.ts
    - packages/service/src/index.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/OperatorConsole.tsx
decisions:
  - "A draft is app-level config only; nothing touches the runner until advertise (plan 03), so a draft has zero protocol side effects (D-12)"
  - "The active Bitcoin network is the service's single resolved network, never a form value (D-10); the create form shows it as a read-only Badge"
  - "The two numeric validation messages are the exact UI-SPEC strings, returned identically by server 400 and client-side check, so the operator sees one copy"
  - "operatorCohorts is constructed fail-closed alongside operatorAuth: no OPERATOR_PASSWORD => no cohort routes"
metrics:
  duration: ~6 min
  completed: 2026-07-08
  tasks: 2
  files_created: 4
  files_modified: 5
---

# Phase 1 Plan 02: On-Demand Cohort Creation (create/configure/discard) Summary

An authenticated operator now creates and configures a cohort draft on demand (beacon type CAS/SMT, n-of-n co-sign threshold, seat capacity) on the service's active network - without editing env vars or restarting - reviews it as a neutral `Draft` in their own cohort list, and can discard an un-advertised draft. Delivered as a vertical slice on the Wave-1 auth foundation: gated create/list/discard routes that build and store the draft app-side (never touching the runner), validation with the exact UI-SPEC copy, and the web create form + cohort list that drive them (SVC-01).

## What Shipped

**Task 1 - `operator-cohorts.ts` drafts + gated routes + index wiring (test-first, TDD):** `createOperatorCohorts({ activeNetwork, recoveryKey })` returns `createDraft/discardDraft/listCohorts` over a per-`createService` `drafts` Map (closure state, never a module singleton). `createDraft` guard-clause-validates (beacon type set-membership; integer threshold >= 1; capacity >= threshold), builds the config via `buildCohortConfig(threshold, beaconType, activeNetwork, recoveryKey)` on the SERVICE active network (D-10), sets `config.maxParticipants = capacity` (the app-side seat ceiling, D-11/D-19), and stores `{ config, dto }` keyed by a `randomUUID()`. The DTO exposes only operator-safe fields (draftId/beaconType/network/threshold/capacity/state) - no keys, no recovery key (T-02-04). Routes mounted inside the plan-01 `if (operatorAuth)` block, AFTER the `requireSameOrigin` + `requireOperator` prefix guards, so all three inherit the session gate (T-02-01) and CSRF check (T-02-03): `POST /v1/operator/cohorts` (4 KiB body limit -> validate -> 201 DTO / 400 specific message, T-02-02), `GET /v1/operator/cohorts` (`{ cohorts: [...] }`), `DELETE /v1/operator/cohorts/:id` (200 / 404 unknown). `index.ts` constructs `operatorCohorts` fail-closed alongside `operatorAuth` (no password => no cohort routes) and threads it into `createHonoApp`. RED commit (spec + unimplemented stub, routes unwired -> 8 failing) then GREEN commit (full factory + routes + wiring -> 12/12 green).

**Task 2 - web create form + operator cohort list:** `lib/operator.ts` gained same-origin `createDraft` (discriminated `{ ok } | { ok:false, error }` surfacing a 400's specific message), `listCohorts`, `discardDraft`, and the `OperatorCohortDTO`/`DraftInput` types (web-local, no service dep). The `useOperator` store gained `cohorts`/`createStatus`/`formError` plus `submitDraft` (client path clears + refreshes on success, sets `formError` on a server 400), `discard`, and `refreshCohorts` (called after a successful login/probe so a returning operator sees existing drafts; sign-out clears them). `CreateCohortForm` is a `Card p-5` with a `Field`+`Select` beacon type (`CAS`->CASBeacon / `SMT`->SMTBeacon), numeric threshold + capacity `Input`s, the active network as a read-only `Badge` (`Network: {activeNetwork}`, D-10 - no editable network control), client validation using the exact UI-SPEC strings, a server `formError` banner backstop, and a ghost `Create draft` button (`Creating…` while creating - accent stays reserved for Advertise). `OperatorCohortList` renders `Your cohorts` with the exact `No cohorts yet` empty state, and per-draft rows (neutral `Draft` badge, network, beacon type, `0/{capacity}` seats, copyable draft id, danger `Discard draft` with an inline confirm using the exact UI-SPEC discard copy + `Keep draft` cancel). `OperatorConsole` now mounts both in the logged-in region (the Wave-1 placeholder removed).

## Verification

- `pnpm vitest run packages/service/src/operator-cohorts.spec.ts` - 12 passed (create/validate/discard/list + gated-401).
- `pnpm vitest run packages/service` - 171 passed (14 files).
- `pnpm test` (root `tsc -b && vitest run`) - 236 passed (23 files).
- `pnpm typecheck` (project references) - exit 0.
- `pnpm lint` (`eslint .`) - exit 0.
- `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` + `build` - exit 0.
- Acceptance greps: `buildCohortConfig(` x1 and `maxParticipants` present in operator-cohorts.ts; `process.env.NETWORK` x0 and no hardcoded network literal (active network from config, D-10); `CASBeacon`+`SMTBeacon` both in the create form; `font-medium` x0 in the two new components (no 500-weight creep); network is a read-only Badge (the only Select is beacon type).
- Threat register: T-02-01 (EoP) mitigated + test-backed (401 on all three routes without a session); T-02-02 (body-limit + validation) mitigated; T-02-03 (CSRF) inherited from the plan-01 `requireSameOrigin` prefix guard; T-02-04 (DTO field minimization) mitigated. No high threat left unmitigated. Zero new packages (T-02-SC).

## Deviations from Plan

**None that changed scope.** Minor in-spirit refinements:

1. **[Rule 3 - blocking] Local beacon-type set instead of a shared export.** The plan sketched validating against a beacon-type set; there is no `KNOWN_BEACON_TYPES_SET` export in `@btcr2-aggregation/shared`, so `operator-cohorts.ts` defines a local `new Set(['CASBeacon','SMTBeacon'])` (the two aggregation beacon types; singleton is single-party). No behavior change.
2. **[Rule 2 - forward-compat] `runner` dropped from the factory options.** The plan's artifact sketch listed `createOperatorCohorts({ runner, activeNetwork, recoveryKey })`, but a draft never touches the runner in this plan (advertise is plan 03), so `OperatorCohortsOptions` omits `runner` to avoid an unused binding. Plan 03 adds the runner (and the advertise/directory/status surface) when it actually needs it - the factory's return type already reserves room for those methods.
3. **[Rule 2 - UX] Inline confirm (not `window.confirm`) for discard**, so the confirmation renders the exact UI-SPEC copy with `Discard draft`/`Keep draft` buttons (a native `confirm()` cannot show the specified button labels).

## Notes for Downstream Plans (03/04)

- Each stored draft keeps its built `CohortConfig` alongside the DTO (`drafts: Map<id, { config, dto }>`), so plan 03's `advertiseDraft` can hand `config` straight to the runner without rebuilding it.
- `GET /v1/operator/cohorts` returns `{ cohorts: OperatorCohortDTO[] }`; plan 03 extends the DTO with advertised state (accent badge) and a joined count, and adds `POST /v1/operator/cohorts/:id/advertise` + the public `/v1/directory` + `/v1/status`.
- The web `OperatorCohortList` row already reserves a spot for the Advertise button; advertised rows switch the badge to `accent` tone.
- The e2e (`e2e/operator-cohort.ts`, plan 04) drives login -> create -> (advertise) with `OPERATOR_COOKIE_SECURE=0` and a manual `Set-Cookie` echo (Node fetch has no cookie jar).

## Known Stubs

- None. The create/configure/discard slice is fully wired end to end (form -> gated route -> in-memory draft -> list). The list shows a fixed `0/{capacity}` joined count because a draft has no members yet; the real joined count arrives with advertised cohorts in plan 03 (documented, not a goal-blocking stub).

## Self-Check: PASSED
