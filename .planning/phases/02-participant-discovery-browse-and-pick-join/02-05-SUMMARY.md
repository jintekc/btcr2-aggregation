---
phase: 02-participant-discovery-browse-and-pick-join
plan: 05
subsystem: api
tags: [operator, cohort, validation, hono, react, e2e]

# Dependency graph
requires:
  - phase: 02-participant-discovery-browse-and-pick-join
    provides: operator create/advertise draft flow + public directory (02-01..02-04)
provides:
  - "Single cohort-size model n (min == max == n) on the gated create surface (F1b)"
  - "Honest directory rows (n/n seats, Co-sign n-of-n) with no phantom unfillable seat (F1a)"
  - "Collapsed { beaconType, size } create body across server, web client, and e2e"
affects: [participant-join, operator-monitoring, cohort-lifecycle]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Un-representable-invalid-state: a capacity above the co-sign threshold cannot be encoded (no separate capacity field), so the invariant holds server-side, not just in the UI"
    - "Client validation copy is the byte-identical server 400 string (SIZE_ERROR mirrored)"

key-files:
  created: []
  modified:
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/operator-cohorts.spec.ts
    - packages/service/src/hono-adapter.ts
    - packages/web/src/components/operator/CreateCohortForm.tsx
    - packages/web/src/lib/operator.ts
    - e2e/operator-cohort.ts
    - e2e/browse-join-cohort.ts

key-decisions:
  - "Collapse threshold + capacity to one size n; DTOs keep threshold and capacity (both == n) so every display component is unchanged"
  - "Enforce min == max == n on BOTH the browser and the server; capacity > threshold is unrepresentable, not merely hidden"

patterns-established:
  - "Single-source cohort size: buildCohortConfig(n,...) sets minParticipants, createDraft pins maxParticipants = n"
  - "Directory faithfulness by construction: threshold === capacity means the public row can never advertise a seat that never fills"

requirements-completed: [PART-01]

coverage:
  - id: D1
    description: "Server accepts only { beaconType, size } and builds min == max == n; a seat ceiling above the co-sign threshold is unrepresentable (F1b, T-05-01)"
    requirement: PART-01
    verification:
      - kind: unit
        ref: "packages/service/src/operator-cohorts.spec.ts#creates a validated CAS size-2 draft with threshold === capacity === n on the active network"
        status: pass
      - kind: unit
        ref: "packages/service/src/operator-cohorts.spec.ts#rejects a size below 1 with the specific 400 message"
        status: pass
    human_judgment: false
  - id: D2
    description: "Advertise -> discover -> join -> co-sign loop stays green under the collapsed single-size create body"
    requirement: PART-01
    verification:
      - kind: e2e
        ref: "pnpm e2e:operator"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:browse"
        status: pass
    human_judgment: false
  - id: D3
    description: "Operator create form shows one Cohort size (n-of-n) field and the participant directory reads honest n/n seats / Co-sign n-of-n"
    requirement: PART-01
    verification:
      - kind: manual_procedural
        ref: "At /operator (signed in): single size field, no capacity input; anonymous directory row reads 2/2 seats (or 0/2, 2 open) and Co-sign: 2-of-2"
        status: unknown
    human_judgment: true
    rationale: "Visual fidelity of the create form and the directory row's truthfulness is a human judgment (non-blocking UAT re-verify of F1a/F1b)."

# Metrics
duration: 6min
completed: 2026-07-15
status: complete
---

# Phase 02 Plan 05: Collapse operator cohort size to a single n (F1a/F1b) Summary

**A cohort is shaped by one `Cohort size (n-of-n)` number that pins min == max == n on both the browser and the server, making the participant directory honest (no phantom open seat) by construction with zero display-code change.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-15T17:42:33Z
- **Completed:** 2026-07-15T17:48:36Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Collapsed the untrusted create body and validation to `{ beaconType, size }`; `createDraft` sets `minParticipants === maxParticipants === n`, so a capacity above the co-sign threshold is unrepresentable server-side (F1b, mitigates T-05-01).
- The public directory row is now truthful for free (F1a): `threshold === capacity === n`, so the existing CohortRow (`{joined}/{capacity} seats`, `Co-sign: {threshold}-of-{threshold}`) can never advertise a seat that never fills, with no change to any display component.
- Replaced the two threshold + capacity inputs with a single `Cohort size (n-of-n)` field and a plain-language help line; the client `SIZE_ERROR` mirrors the server's exact 400 copy.
- Proved the advertise -> discover -> join -> co-sign loop is unaffected: `e2e:operator` and `e2e:browse` both green under the collapsed create body; zero new packages, zero new routes.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): rework operator create-draft spec for single size n** - `25000be` (test)
2. **Task 1 (GREEN): collapse server cohort-size model to a single n** - `cd1cf72` (feat)
3. **Task 2: single Cohort size (n-of-n) field on the create form + DraftInput** - `5dc88eb` (feat)
4. **Task 3: switch the two hermetic e2e create bodies to { beaconType, size }** - `2707775` (test)

_Task 1 is TDD: a RED test commit precedes the GREEN implementation commit._

## Files Created/Modified
- `packages/service/src/operator-cohorts.ts` - `DraftInput { beaconType, size }`; `validateDraft` drops the capacity branch and throws `SIZE_ERROR`; `createDraft` pins `maxParticipants = size` and emits `threshold === capacity === n`.
- `packages/service/src/operator-cohorts.spec.ts` - reworked create-draft coverage: `{ beaconType, size }` yields `threshold === capacity === n`, plus the size-below-1 400.
- `packages/service/src/hono-adapter.ts` - create-body-shape 400 string names `{ beaconType, size }`.
- `packages/web/src/components/operator/CreateCohortForm.tsx` - one `Cohort size (n-of-n)` Field + help line; single client guard; `submitDraft(baseUrl, { beaconType, size })`.
- `packages/web/src/lib/operator.ts` - `DraftInput` becomes `{ beaconType, size }`; the DTOs keep `threshold`/`capacity` (both == n).
- `e2e/operator-cohort.ts` - create POST switches to `{ beaconType, size: THRESHOLD }`; THRESHOLD comment reframed as the single cohort size n.
- `e2e/browse-join-cohort.ts` - create helper POST switches to `{ beaconType, size: THRESHOLD }`; directory assertions unchanged (both bounds equal the size).

## Decisions Made
- Kept `threshold` and `capacity` on both DTOs (now always equal to n) rather than collapsing the wire DTOs too, so no display component or e2e directory assertion needed to change.
- Removed the now-redundant "threshold below 1" spec case: the single size floor is covered by the `size below 1` test.

## Deviations from Plan

None - plan executed exactly as written. (The web help line uses `text-faint`, the repo's established subtle-text token, since the plan's illustrative `text-fg/60` is not a defined theme token; this is a token-name correction, not a scope change.)

## Issues Encountered
None. RED confirmed 6 failing assertions before the source change; GREEN passed all 16; service `tsc -b`, web `tsc --noEmit` + `vite build`, and `pnpm lint` all clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- F1a/F1b are closed at the code level; the directory now represents the signing set honestly. Ready for the F2 (cohort lifetime + expiry, 02-06) and F1c (k-of-n fallback, 02-07) gap plans, then the deferred UAT Test 2 re-verify.

## Self-Check: PASSED

All modified files exist on disk; all 4 task commits (`25000be`, `cd1cf72`, `5dc88eb`, `2707775`) are present in git history.

---
*Phase: 02-participant-discovery-browse-and-pick-join*
*Completed: 2026-07-15*
