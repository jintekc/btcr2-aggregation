---
phase: 05-operator-cohort-lifecycle-control
plan: 05
subsystem: ui
tags: [operator-console, drain-mode, pause, public-directory, react, zustand, vitest, e2e]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 04)
    provides: the runtime settings holder, the two-call-site advertise gate, the gated pause/resume routes, and the paused bit on both ServiceStatusDTO and ServiceHealthDTO
  - phase: 05-operator-cohort-lifecycle-control (plan 02)
    provides: the surface-ownership rule for a one-shot action error, and the reversible-actions rule that keeps pause out of the confirmation ladder
  - phase: 04-operator-monitoring-and-live-path
    provides: the polled list read the paused bit rides, the health strip's checking-mode posture this card mirrors, and the discriminated FetchResult vocabulary with its single expireSession path
provides:
  - ServiceControls, the Service controls card (state line, reversible toggle, restart-honesty line, full-quiesce guidance) with a pure serviceControlsView predicate
  - pauseAdvertising / resumeAdvertising clients returning the SERVED paused state, plus non-optimistic store actions
  - the warn-tone Advertising paused health-strip chip, rendered beside the served mode chip
  - Advertise cohort and Re-advertise disabled from the same served bit that gates the server, with their reason beside them
  - directoryNotice, the pure fail-closed public paused-notice variant selector
  - the participant store's public status slice (openCohorts + paused) as ONE anonymous read feeding both the identity header and the directory
  - e2e:pause, the hermetic drain-mode leg proving pause is a drain and not a kill switch
affects: [05-07 settings surface, 05-08 broadcast kill switch, 05-11 test peers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A rendered state is a pure function of the SERVED bit plus the in-flight marker, so the console's honesty is unit-testable without a DOM"
    - "Undefined means UNKNOWN, never false: an absent bit renders no claim at all, mirroring the health strip's checking-mode posture"
    - "Fail-closed notice selection: an unreachable read and an unread status both resolve to the inherited behavior, never to a claim"
    - "One anonymous read, two consumers: the identity header's open count and the directory's paused notice come from one snapshot, so they cannot disagree on screen"
    - "A one-shot action error belongs to the surface that raised it (05-02 rule), so two simultaneously-visible surfaces need two fields, not one shared one"

key-files:
  created:
    - packages/web/src/components/operator/ServiceControls.tsx
    - packages/web/tests/service-controls.spec.ts
  modified:
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/HealthStrip.tsx
    - packages/web/src/components/operator/OperatorConsole.tsx
    - packages/web/src/components/operator/OperatorCohortList.tsx
    - packages/web/src/lib/directory.ts
    - packages/web/src/stores/participant.ts
    - packages/web/src/components/browse/BrowseView.tsx
    - packages/web/src/components/browse/DirectoryList.tsx
    - packages/web/src/components/browse/ServiceIdentityHeader.tsx
    - packages/web/tests/directory-labels.spec.ts
    - e2e/operator-cohort.ts
    - package.json

key-decisions:
  - "The controls card renders through ONE pure predicate (serviceControlsView), so the E4 empty / loading / error / populated states are proven by unit tests rather than by looking at a screen"
  - "An absent paused bit is a third state (unknown), never a defaulted false: claiming a service is advertising normally when it may be draining is the exact spoofing failure T-05-05-01 names"
  - "Neither toggle ever writes a paused value locally; success re-reads the list so the state line, the health chip and the disabled advertise controls all move together from one served snapshot"
  - "The full-quiesce guidance is held back until a state has been served, because guidance about what pausing does not do reads as an implicit pause claim against an unknown state"
  - "Pause failures use their own pauseError field rather than the shared actionError, because the controls card and the cohort list are on screen simultaneously and one field would render the same failure twice"
  - "The public status poll moved from ServiceIdentityHeader into BrowseView via the store, so the open-cohort count and the paused notice are one snapshot rather than two that can disagree"
  - "directoryNotice takes unreachable as an explicit input even though the component branches on it earlier, so the never-claim-paused-from-stale-data property is pinned in the pure function rather than only in render order"

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "The operator pauses and resumes advertising from a Service controls card without restarting the process, and the console never claims a state the service has not reported"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#is unknown before the first read lands, so the card makes no pause claim"
        status: pass
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#is running when the service reports not paused, offering Pause advertising"
        status: pass
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#is paused when the service reports paused, offering Resume advertising"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:pause"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pause and resume disable while a toggle is in flight, and the state line does not flip until the service reports it; a failed toggle keeps the previous line"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#disables the control while a pause is in flight and keeps the SERVED running line"
        status: pass
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#disables the control while a resume is in flight and keeps the SERVED paused line"
        status: pass
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#stays unknown while busy, so a toggle can never manufacture a first claim"
        status: pass
    human_judgment: false
  - id: D3
    description: "The controls card states the restart-honesty line and the full-quiesce guidance in words, verbatim from the UI-SPEC contract copy"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#states the restart-honesty line in words"
        status: pass
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#states the full-quiesce guidance in words, because pause never retracts"
        status: pass
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#carries no long dash in any card string (house style, checker-blocked at the source)"
        status: pass
    human_judgment: false
  - id: D4
    description: "While paused, Advertise cohort and Re-advertise render disabled with their reason beside them, and every other console control keeps working"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/service-controls.spec.ts#states the running line and the disabled-advertise reason verbatim"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:pause (a new advertise is refused 409 and the draft survives, while discard/cancel/finalize/monitoring stay live)"
        status: pass
      - kind: other
        ref: "packages/web/src/components/operator/OperatorCohortList.tsx: both advertise verbs take `disabled={isAdvertising || advertisingPaused}`; Discard draft and Open take neither"
        status: pass
    human_judgment: false
  - id: D5
    description: "The public directory shows an honest paused notice a participant can act on, with the rows still rendering below it, and never suppresses the list"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/directory-labels.spec.ts#puts a notice ABOVE the list when a paused service still has open cohorts"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:pause (paused:true with openCohorts 1, and a fresh participant still seats)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A paused service with no open rows reads differently from an idle one, so a stranger can tell a deliberate pause from a dead service"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/directory-labels.spec.ts#uses the distinct paused empty state when a paused service has no open cohorts"
        status: pass
      - kind: unit
        ref: "packages/web/tests/directory-labels.spec.ts#keeps the inherited idle empty state for a running service with no cohorts"
        status: pass
    human_judgment: false
  - id: D7
    description: "No paused claim is ever rendered from missing or stale data: an unknown status renders nothing and an unreachable directory keeps its inherited card"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/directory-labels.spec.ts#renders NO notice while the status is unknown, even with rows on screen"
        status: pass
      - kind: unit
        ref: "packages/web/tests/directory-labels.spec.ts#renders NO notice while the status is unknown AND the list is empty"
        status: pass
      - kind: unit
        ref: "packages/web/tests/directory-labels.spec.ts#never renders a paused notice from stale data when the directory is unreachable"
        status: pass
      - kind: unit
        ref: "packages/web/tests/directory-labels.spec.ts#renders no notice at all for the ordinary running service with rows"
        status: pass
    human_judgment: false
  - id: D8
    description: "Pause is DRAIN MODE end to end over real HTTP: a paused service still lists, still counts, and still seats a freshly constructed participant into a pre-pause cohort, while a new advertise is refused 409 and resume restores advertising"
    requirement: SVC-04
    verification:
      - kind: e2e
        ref: "pnpm e2e:pause"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:operator (the pause leg joins the extended suite)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The rendered ceremony reads correctly to an operator: the controls row wraps at narrow widths, the paused chip sits beside the mode chip, and pause takes no confirmation"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "The layout rules are code-verified (the controls row is flex-wrap gap-2, the chip is an additional Badge in the strip's existing wrapping row, and grep 'ConfirmPanel' on ServiceControls.tsx is 0) but whether the card reads as proportionate friction at a real viewport has no automated visual check in this plan. It belongs to the phase's console walkthrough at the end-of-phase gate."

# Metrics
duration: 13 min
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 05: The Two Human Faces of Drain Mode Summary

**The pause built in 05-04 now has both of its human faces: an operator `Service controls` card whose every rendered fact passes through one pure predicate that treats an absent bit as UNKNOWN rather than defaulting to "running", and a public directory notice that lets a stranger tell a deliberate pause from a dead service while still joining whatever is already open, with a hermetic `e2e:pause` leg proving over real HTTP that a paused service still lists, still counts, and still seats.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-29T10:00:00Z
- **Completed:** 2026-07-29T10:13:00Z
- **Tasks:** 2 (task 1 TDD: RED then GREEN)
- **Files modified:** 15 (2 created, 13 modified)

## Accomplishments

- **`ServiceControls.tsx`: the whole card is one pure predicate plus markup.** `serviceControlsView({ paused, busy })` returns the state, the state line, the toggle label, the toggle action and the disabled flag, so every documented E4 state (empty / loading / error / populated / partial) is proven by unit tests with no DOM. The component reads store slices and renders what the predicate returned; it makes no decision of its own.
- **An absent bit is a THIRD state, not a defaulted false.** `paused === undefined` returns `unknown`: no state line, no toggle, and no pause claim of any kind, exactly mirroring the health strip's `Checking mode` posture. This is the load-bearing branch. A console that defaulted to "running" would tell a returning operator that new cohorts are being offered by a service that may in fact be draining, which is precisely the spoofing failure T-05-05-01 names, and it would do so silently.
- **Neither toggle ever paints its own outcome.** `pauseBusy` goes up first (the control disables), the served result comes back, and only then does `refreshCohorts` re-read so the state line, the health-strip chip and the disabled advertise controls all move together from ONE served snapshot. The client returns the resulting paused state the service reported rather than a bare success flag, and even that value is never written into local state. What makes a failed toggle safe is that nothing was painted optimistically, so there is nothing to roll back: the previous state line simply stays where it was, beside the action-error line.
- **Pause and resume take no confirmation, and are `ghost`.** Both are reversible, and spending confirmation friction on a reversible act would dilute the ladder that `Cancel cohort` depends on (05-UI-SPEC reversible-actions rule). `grep -c ConfirmPanel` on the file is 0, which is an acceptance criterion rather than an accident.
- **The two pieces of guidance that stop a pause from being misunderstood.** The restart-honesty line renders ALWAYS, including before the first read, because it is a fact about how this service stores runtime state rather than a claim about its current state. The full-quiesce guidance is held back until a state has been SERVED: it is guidance about what pausing does NOT do, and rendering it against an unknown state invites exactly the reading ("so this thing IS paused?") that the unknown state exists to prevent.
- **The `Advertising paused` chip rides BESIDE the mode chip, never instead of it.** Warn tone, in the strip's existing `flex-wrap gap-2` row so it wraps rather than pushing content off-screen. It reads `health?.paused === true` deliberately: an absent bit is not a paused claim.
- **`Advertise cohort` and `Re-advertise` disable from the SAME served bit that gates the server**, with `Advertising is paused.` rendered beside them. A disabled control with no reason is indistinguishable from a broken one, and the server would refuse the click with a 409 anyway (D-06), so the console states the fact up front rather than letting the operator discover it by being refused. `Discard draft`, `Open`, and every other row control stay enabled: pause gates advertising and nothing else.
- **`directoryNotice`: a fail-closed variant selector for the public side.** Five variants from three facts, with the two honesty branches first. An unreachable directory returns `unreachable` even while holding a paused bit from an earlier read (a notice drawn beside unreachable rows would be a claim about a service that is not answering), and an undefined `paused` returns `none` regardless of row count. That second branch is the whole reason 05-04 put a paused bit on the wire instead of letting the client infer one: a paused service and an idle service both show zero open cohorts, so an empty list can never be evidence of a pause.
- **The two participant-facing variants say genuinely different things.** With rows, a notice card sits above the `Open cohorts` heading and the list KEEPS rendering below it, because pausing does not retract what is already advertised and suppressing the rows would hide cohorts a stranger can still join. With no rows, the empty state keeps its inherited heading but takes a different body (`isn't offering new cohorts` vs the inherited `isn't advertising any cohorts`), which is the only thing distinguishing an operator's deliberate choice from a service that simply has nothing on.
- **One anonymous status read, two consumers.** The public status poll moved out of `ServiceIdentityHeader`'s local state into the participant store, driven by `BrowseView`, so the header's open-cohort count and the directory's paused notice come from one snapshot. Two independent polls of the same endpoint would be two snapshots that could disagree about the same service on the same screen. On failure the slice clears to `undefined` rather than keeping its last value, so an unreachable service cannot leave a paused notice on screen indefinitely.
- **`e2e:pause`: the drain-versus-kill distinction proven from the outside.** A pause that quietly took the public directory down with it would look identical from the gated side, so the leg asserts the participant-facing half: `GET /v1/status` reports `paused: true` while STILL reporting `openCohorts: 1` and still listing the cohort; a FRESHLY constructed participant (not one started before the pause, which would already hold the advert and seat regardless) still seats in it; a new advertise is refused 409 with an app-authored reason and the draft survives the refusal; and resume restores both the public bit and the ability to advertise the very same draft.

## Task Commits

Each task was committed atomically (task 1 is TDD, so it has a RED then a GREEN commit):

1. **Task 1 (RED): failing spec for the service-controls state predicate** - `53e7471` (test)
2. **Task 1 (GREEN): the Service controls card, paused chip, and honest disabled advertise** - `5b59fdc` (feat)
3. **Task 2: the public paused notice, both variants, proven by a hermetic pause e2e** - `15299bb` (feat)

## Files Created/Modified

- `packages/web/src/components/operator/ServiceControls.tsx` (new) - `PAUSE_LABEL`, `RESUME_LABEL`, `AdvertisingState`, `ServiceControlsView`, the pure `serviceControlsView` predicate, and the `ServiceControls` card. The docstring records why an absent bit is `unknown` and why an in-flight toggle must not move the state line.
- `packages/web/tests/service-controls.spec.ts` (new, 12 tests) - the three predicate properties (absent is unknown, served bit decides, busy disables without flipping) plus verbatim assertions on all five contract strings and a long-dash guard.
- `packages/web/src/lib/operator.ts` - `pauseAdvertising` / `resumeAdvertising` over a shared `advertisingToggle` body, discriminated like `discardDraft`, returning the SERVED resulting state and treating a body without a boolean as `unreachable` rather than coercing it.
- `packages/web/src/stores/operator.ts` - the seven exact copy constants, `pauseBusy` / `pauseMessage` / `pauseError`, the two actions over one shared `runAdvertisingToggle`, and the new slice cleared in both `signOut` and `expireSession`.
- `packages/web/src/components/operator/HealthStrip.tsx` - the warn-tone `Advertising paused` chip beside the served mode chip.
- `packages/web/src/components/operator/OperatorConsole.tsx` - `ServiceControls` mounted under the strip and above BOTH views (a service fact must not be reachable only from the list).
- `packages/web/src/components/operator/OperatorCohortList.tsx` - both advertise verbs disabled from the served bit with `ADVERTISE_DISABLED_REASON` beside them; the expired row's single button wrapped in the same `flex-wrap items-center gap-2` row so its reason has somewhere to sit.
- `packages/web/src/lib/directory.ts` - `DirectoryNotice` and the pure `directoryNotice` selector, whose docstring states which two branches fail closed and why.
- `packages/web/src/stores/participant.ts` - the `publicStatus` slice and `pollPublicStatus`, clearing to `undefined` on failure.
- `packages/web/src/components/browse/BrowseView.tsx` - the single public status poll, and `paused` threaded into both `DirectoryList` call sites.
- `packages/web/src/components/browse/DirectoryList.tsx` - the `paused` prop, the four notice strings as named constants, the notice card above the heading, and the two-body empty state.
- `packages/web/src/components/browse/ServiceIdentityHeader.tsx` - reads the store's public status instead of polling itself; the now-unused `baseUrl` prop removed.
- `packages/web/tests/directory-labels.spec.ts` - seven new tests covering every `directoryNotice` branch, including all three unreachable cases.
- `e2e/operator-cohort.ts` - `runPauseLeg`, the `--pause` flag, and the leg joined to the default extended suite.
- `package.json` - the `e2e:pause` script.

## Decisions Made

- **The card is a predicate plus markup.** Putting every rendered fact behind `serviceControlsView` is what makes the E4 empty/loading/error states assertable at all; a component that decided inline would have left "does the card claim anything before the first read" as a thing you can only check by looking.
- **`undefined` is unknown, never false.** Applied identically on both sides: the console's `unknown` state and the directory's `none` variant are the same decision made twice, because the same missing bit reaches both.
- **The full-quiesce guidance waits for a served state.** The plan and the UI-SPEC both say the card shows ONLY the restart-honesty line before the first ok read. Guidance about what pausing does not do is meaningful once the card can say whether the service is paused; against an unknown state it reads as an implicit claim.
- **A separate `pauseError` rather than the shared `actionError`.** See the deviation below: the controls card and the cohort list are visible at the same time, so one shared field renders one failure twice.
- **The public status poll belongs to `BrowseView`, not the header.** The header is a presentational card; the composition root owns the read, and the header became a pure reader of it. This also removed a duplicate poll of the same endpoint.
- **`directoryNotice` takes `unreachable` explicitly.** The component already returns early on the unreachable view, so the input is redundant at the call site, but pinning the property in the pure function means a future refactor of the render order cannot quietly reintroduce a paused notice over stale rows.
- **The e2e leg uses a FRESHLY constructed participant.** The same discipline the cancel leg established: a participant started before the pause already holds the advert and would seat regardless, so it would produce a false green for exactly the claim under test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A dedicated `pauseError` field instead of the shared `actionError`**
- **Found during:** Task 1
- **Issue:** The plan specifies that an `unreachable` toggle "sets `actionError`". But `actionError` is rendered by `OperatorCohortList`, and the `Service controls` card sits directly above that same list on the same screen. Setting the shared field would have rendered one failed toggle twice, in two places at once. This is the exact condition the 05-02 rule was written for ("a one-shot `actionError` belongs to the surface that raised it"), which was discovered there when a failed discard on the list followed the operator into an unrelated drill-down.
- **Fix:** Added `pauseError?: string` (and, for the same reason, `pauseMessage?: string` beside the existing `advertiseMessage`), rendered on the controls card only. The COPY is unchanged: `pauseError` carries the shared `ACTION_FAILED` constant, so the acceptance criterion ("a failed toggle renders the action-error line") holds verbatim.
- **Files modified:** packages/web/src/stores/operator.ts, packages/web/src/components/operator/ServiceControls.tsx
- **Verification:** `pnpm lint`, `pnpm typecheck`, web build green; the store clears both fields in `signOut` and `expireSession` alongside every other gated slice.
- **Committed in:** `5b59fdc`

**2. [Rule 2 - Missing Critical] The public status read consolidated into one poll**
- **Found during:** Task 2
- **Issue:** `ServiceIdentityHeader` polled `GET /v1/status` into its own local state every 10s. Adding a second poll for the paused bit would have put two independent snapshots of the same endpoint on the same screen: the header could render an open-cohort count from one read while the directory rendered a paused notice from another, and on a flapping service they would visibly disagree about the same service at the same moment. The plan's own prohibition is that a paused claim must never come from a stale snapshot, and two polls is a stale-snapshot generator.
- **Fix:** The poll moved into the participant store (`pollPublicStatus`), driven once by `BrowseView`, with `ServiceIdentityHeader` reading the store slice. Its render semantics are unchanged (nothing renders until the first successful read; a failure clears back to nothing). `ServiceIdentityHeader` is not in the plan's `files_modified` list, so this is an additive fix to a file the plan did not anticipate touching.
- **Files modified:** packages/web/src/components/browse/ServiceIdentityHeader.tsx, packages/web/src/components/browse/BrowseView.tsx, packages/web/src/stores/participant.ts
- **Verification:** `pnpm e2e:browse` green (no regression on the shipped directory landing, which renders the header on every branch); web build + lint + typecheck green.
- **Committed in:** `15299bb`

**3. [Rule 3 - Blocking] The now-unused `baseUrl` prop removed from `ServiceIdentityHeader`**
- **Found during:** Task 2
- **Issue:** Once the component stopped fetching, `baseUrl` was dead, and `@typescript-eslint/no-unused-vars` failed the lint gate. Silencing it with an underscore would have left a prop in the signature that five call sites keep passing for no reason.
- **Fix:** Dropped the prop entirely and updated all five `BrowseView` call sites.
- **Files modified:** packages/web/src/components/browse/ServiceIdentityHeader.tsx, packages/web/src/components/browse/BrowseView.tsx
- **Verification:** `pnpm lint` clean; `pnpm typecheck` clean; web build green.
- **Committed in:** `15299bb`

---

**Total deviations:** 3 auto-fixed (1 bug, 1 missing critical, 1 blocking)
**Impact on plan:** All three preserve the plan's stated truths more faithfully than the literal instruction would have. The only interface departure is the store field name for a failed toggle (`pauseError` rather than `actionError`); no later plan references it, and the rendered copy is identical. No scope creep.

## Issues Encountered

- **The plan's artifact block attributes the directory notice-variant coverage to `service-controls.spec.ts`, while its task 2 action text says to cover every branch in `directory-labels.spec.ts`.** The explicit task instruction won: the seven `directoryNotice` branch tests live in `packages/web/tests/directory-labels.spec.ts`, beside the other pure directory-helper assertions they belong with, and `service-controls.spec.ts` covers the controls predicate. Both files are green and every branch named in the plan is asserted; only the file placement differs from the artifact prose.

## Known Stubs

None. Every surface added here is wired end to end: the predicate has a real consumer, both toggles reach the live gated routes proven by `pnpm e2e:pause`, the health chip and the disabled advertise controls read the same served bit the server's gate enforces, and both directory variants render from the polled public status. The 05-08 broadcast kill switch is deliberately ABSENT rather than stubbed: no slot, no placeholder and no disabled control was added for it, so nothing on the card claims a capability that is not behind it.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/web/tests/service-controls.spec.ts packages/web/tests/directory-labels.spec.ts` | 21 tests pass |
| `pnpm test` (full suite, `tsc -b` gated) | 46 files, 653 tests pass |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm --filter @btcr2-aggregation/web build` | clean |
| `pnpm e2e:pause` | pass (paused:true with openCohorts 1, fresh seat while paused, 409 advertise with the draft intact, resume restores) |
| `pnpm e2e:operator` | pass (the full extended suite, now including the pause leg) |
| `pnpm e2e:browse` | pass (no regression on the shipped directory landing) |
| `grep -rlP '\x{2014}' packages/web/src` | no files |
| `grep -c 'ConfirmPanel' packages/web/src/components/operator/ServiceControls.tsx` | 0 (reversible actions take no confirmation) |
| `package.json` scripts contains `e2e:pause` | yes |

## User Setup Required

None - no external service configuration required. The `Service controls` card renders only inside the authenticated console, which exists only on a service booted with `OPERATOR_PASSWORD`. The public paused notice needs no configuration at all: it derives from the `paused` bit `GET /v1/status` already serves.

## Next Phase Readiness

- **The `Service controls` card is the composition point 05-08 was planned to land on.** The broadcast kill switch is a second control on this same card, and the layout already anticipates it: the controls row is `flex-wrap gap-2`, and the card's docstring records that the kill switch belongs there. It should compose `ConfirmPanel` at rung 3 (it is one-way, unlike pause) rather than following the no-confirmation treatment used here.
- **`serviceControlsView` is the shape the kill switch's own predicate should copy.** Paused and broadcast-off are independent facts read from the same status snapshot (UI-SPEC E4 partial), so the kill switch needs its OWN predicate over its own served bit rather than a widened composite state; `runtimeSettings.broadcastDisabled` is already declared and pinned to `false` at boot by 05-04.
- **The store's `pauseBusy` / `pauseMessage` / `pauseError` triple plus `runAdvertisingToggle` is the idiom for any later service-level toggle**, and the reason for the dedicated error field (two surfaces visible at once) applies to the kill switch identically.
- **The public status slice is now a store fact, not component state**, so 05-07's settings surface and any later participant-facing service claim can read `publicStatus` without adding another poll.
- **Carried concern, unchanged from 05-02 and 05-04:** a settled cohort (expired, canceled, finalized-then-anchored) still cannot be re-opened from the operator list, because `canOpen` is `isAdvertised || cohort === undefined`. This plan did not touch the ended group, so it remains open; the ended-record dismissal work is its natural home.

## Self-Check: PASSED

- Created files verified present on disk: `packages/web/src/components/operator/ServiceControls.tsx`, `packages/web/tests/service-controls.spec.ts`.
- Commits verified in git history: `53e7471`, `5b59fdc`, `15299bb`.
- Every task acceptance criterion re-run in this session and passing; the plan-level `<verification>` block re-run in full and green.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*
