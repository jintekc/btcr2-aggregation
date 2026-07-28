---
phase: 05-operator-cohort-lifecycle-control
plan: 03
subsystem: api
tags: [aggregation, cohort-lifecycle, operator-console, kofn-fallback, hono, react, vitest, e2e]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 01)
    provides: the gated operator lifecycle route block, the cohort intent registry, and the monitor push-seam idiom the finalize action's activity record copies
  - phase: 05-operator-cohort-lifecycle-control (plan 02)
    provides: ConfirmPanel, the pure lifecycle-predicate module, the discriminated action-client + store idiom, and the actionFailedWith reason variant this plan is the first caller of
  - phase: 04-operator-monitoring-and-live-path
    provides: the polled drill-down detail read, the operator stage timeline, and the shared phase sets (whose deliberate widening is the exact hazard this plan guards against)
provides:
  - FINALIZABLE_PHASES, one cross-package mirror of the library's own three signing phases, with the IN_FLIGHT_PHASES drift hazard documented at the source
  - a pre-guarded finalizeCohort wrapping runner.triggerFallback, whose refusals are app-authored 409s rather than library throws
  - a gated POST /v1/operator/cohorts/:id/finalize with the full 401 / 400 / 404 / 409 / 200 matrix
  - noteOperatorAction, the actor-attribution push seam (fallback-started fires for the stall timer too)
  - the Finalize now control with its warn-tone rung-2 ceremony, disabled reason, and post-commit replacement line
  - the automatic Closed stage narration and the terminal Canceled marker on the operator stage timeline, both read-only
  - the honest seat-reclaim workaround line under Members
  - e2e:fallback:operator, an operator-driven k-of-n fallback proven end to end with the stall timer 60s away
affects: [05-05 ended-record dismissal, 05-07 pause drain mode, 05-09 broadcast kill switch, 05-11 test peers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Availability is a phase predicate checked on BOTH sides, never a try/catch: the same shared set gates the browser control and guards the server route"
    - "Refusal verdicts are a closed union mapped to app-authored copy, so a library throw can never become an HTTP body (the validateDraft discipline, extended to an async verb)"
    - "Actor attribution as a push seam: when the library emits the same event for an operator action and an automatic timer, only an out-of-band record can tell them apart"
    - "A capability with no primitive is NARRATED, never faked: closing is a timeline stage and seat reclaim is a sentence, because neither has a library verb behind it"

key-files:
  created:
    - packages/service/tests/lifecycle-routes.spec.ts
  modified:
    - packages/shared/src/phases.ts
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/monitor.ts
    - packages/service/src/index.ts
    - packages/service/src/hono-adapter.ts
    - e2e/fallback-cohort.ts
    - package.json
    - packages/web/src/lib/lifecycle.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/LifecycleActions.tsx
    - packages/web/src/components/operator/OperatorStageTimeline.tsx
    - packages/web/src/components/operator/CohortDetail.tsx
    - packages/web/tests/lifecycle.spec.ts
    - packages/web/tests/operator-stage.spec.ts

key-decisions:
  - "FINALIZABLE_PHASES is a THIRD phase set rather than a reuse of IN_FLIGHT_PHASES: the two answer different questions (what may be finalized vs what stays listed), and 04-08 deliberately widened the latter with the four funding-wait phases, where the library call throws"
  - "Finalize renders DISABLED with a reason outside the signing round, where cancel-after-broadcast renders HIDDEN: the difference is whether the act will ever become possible, and finalize genuinely will"
  - "A refused finalize preserves the server's reason in the action-error line (cancel's 404 stays reasonless): the usual cause is a phase race the operator could not have seen, so the reason is the only thing that explains the refusal"
  - "The drill-down STAYS OPEN after a successful finalize, unlike a cancel: the cohort is still alive and about to anchor, so the operator wants to watch it, and the committed state arrives from the next poll"
  - "The terminal Canceled marker is APPENDED after the stage the cohort actually reached, never made the active stage: promoting it would repaint every earlier stage as complete and imply the cohort reached anchoring"
  - "The finalize confirm is warn tone, not danger: nothing is destroyed, the round was already stalled, and the fallback is the path that still anchors it"

patterns-established:
  - "Pattern 2 (RESEARCH): finalize-now availability is a phase predicate, mirrored into one shared set and read by both the client predicate and the server guard"
  - "Pitfall 4 (RESEARCH) closed on both sides: the client never offers a throwing control, and the server answers 409 with app-authored copy"
  - "A unit spec pins the GUARD with the library call stubbed; the e2e leg pins the real library path. Neither could do the other's job here, because a hermetic cohort crosses the signing phases in milliseconds"

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "The operator can finalize a stalled signing round from the console and the cohort anchors on the k-of-n fallback path without a restart"
    requirement: SVC-04
    verification:
      - kind: e2e
        ref: "pnpm e2e:fallback:operator"
        status: pass
      - kind: unit
        ref: "packages/service/tests/lifecycle-routes.spec.ts#returns \"ok\" and commits the fallback path for a cohort in a signing phase"
        status: pass
    human_judgment: false
  - id: D2
    description: "Finalize now is offered only while the cohort is in one of the library's three signing phases; outside them it renders disabled with the documented reason rather than throwing"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is available in every one of the library three signing phases"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is not-signing while a cohort is still filling or collecting updates"
        status: pass
    human_judgment: false
  - id: D3
    description: "The finalize availability predicate mirrors the library's own signing-phase set and never reuses IN_FLIGHT_PHASES, which is wider and would offer a button that throws"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/lifecycle-routes.spec.ts#excludes the four funding-wait phases, which IN_FLIGHT_PHASES deliberately includes"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is not-signing in the four FUNDING-WAIT phases, proving the wider in-flight set is not reused"
        status: pass
      - kind: unit
        ref: "packages/service/tests/lifecycle-routes.spec.ts#returns \"not-signing\" for the funding-wait phases (the wider in-flight set is not reused)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Calling finalize outside the signing phases is answered 409 with the console's action-error copy, never a 500 and never a raw library message as the response body"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/lifecycle-routes.spec.ts#409s a pre-signing cohort with the app-authored reason, never a 500 or a library string"
        status: pass
      - kind: unit
        ref: "packages/service/tests/lifecycle-routes.spec.ts#returns \"not-signing\" for a filling, pre-signing cohort and NEVER calls the library"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:fallback:operator"
        status: pass
    human_judgment: false
  - id: D5
    description: "Finalize is idempotent: a repeated call on an already-committed cohort resolves as success and changes nothing, and the console copy matches that reading"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/lifecycle-routes.spec.ts#is idempotent: a second finalize resolves \"ok\" and appends no duplicate activity entry"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is committed once the served projection reports the fallback was used"
        status: pass
    human_judgment: false
  - id: D6
    description: "The rung-2 confirm states the real k-of-n consequence before it happens, including that unsigned signers are excluded and that fewer than k signatures cannot anchor"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "The copy is contract-fixed and its k/n interpolation is code-verified to come from the served projection, but whether the warn-tone ceremony reads as proportionate to an operator is exactly the judgment the end-of-phase console walkthrough exists for. There is no DOM harness in this package."
  - id: D7
    description: "Closing is narrated as an automatic lifecycle stage when the nth seat fills, and is never rendered as a button"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator-stage.spec.ts#is reached the moment the nth seat fills, with no server flag and no phase change"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator-stage.spec.ts#carries the exact UI-SPEC label and caption, and is the only captioned stage"
        status: pass
      - kind: other
        ref: "grep -c '<Button' packages/web/src/components/operator/OperatorStageTimeline.tsx == 0"
        status: pass
    human_judgment: false
  - id: D8
    description: "A canceled cohort renders a terminal Canceled state on the operator stage timeline; the timeline stays a read surface and gains no control"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator-stage.spec.ts#is read straight off the served fate, never inferred from a phase or an error"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator-stage.spec.ts#does not repaint the stage the cohort actually reached"
        status: pass
    human_judgment: false
  - id: D9
    description: "While a cohort is filling, the drill-down states the honest seat-reclaim workaround in words"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#shows while a cohort is advertised with seats still open"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#hides once the nth seat fills, because there is no abandoned seat left to reclaim"
        status: pass
    human_judgment: false
  - id: D10
    description: "POST /v1/operator/cohorts/:id/finalize is reachable only with a valid operator session; an anonymous request returns 401 before any cohort-id lookup"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/lifecycle-routes.spec.ts#401s with no session cookie, BEFORE any cohort-id lookup"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:fallback:operator"
        status: pass
    human_judgment: false
  - id: D11
    description: "While a finalize is in flight the confirm button renders its in-flight label and both buttons disable; a failed finalize renders the action-error line and leaves the cohort unchanged"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "The in-flight treatment is ConfirmPanel's, already covered by 05-02's primitive, and the store's failure branches are code-verified to write only actionError. But there is no store-level or DOM harness in this package: driving a real 409 and a real 502 mid-ceremony belongs in the operator browser walkthrough."
  - id: D12
    description: "The worst-case lifecycle block, with cancel availability, finalize availability, and the seat-reclaim note rendered at once above the funding disclosures, stays readable without overflow"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "A layout backstop by design (the plan marks it verification: backstop). The confirmation bodies are short stacked paragraphs inside a Card that wraps, and the only interpolated values are small integers and an 8-character id, but whether the stacked block reads well at the busiest moment is a visual judgment for the end-of-phase walkthrough."

# Metrics
duration: 20 min
completed: 2026-07-28
status: complete
---

# Phase 5 Plan 03: Finalize Now and the Honest Close Summary

**The operator can finalize a stalled signing round from the console and watch it anchor on the k-of-n fallback path, behind a phase pre-guard shared byte-for-byte by the browser predicate and the server route, so a refusal is a 409 with human copy instead of a 500 with a library string; and the close half of the ROADMAP's sentence lands honestly, as an automatic timeline stage rather than a faked button.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-28T23:08:00Z
- **Completed:** 2026-07-28T23:28:00Z
- **Tasks:** 2 (task 1 TDD: RED then GREEN)
- **Files modified:** 16 (1 created, 15 modified)

## Accomplishments

- `FINALIZABLE_PHASES` in `packages/shared/src/phases.ts`: a mirror of the library's own private `#SIGNING_PHASES`, the set its automatic stall timer keys on. Its doc comment states the drift hazard in plain words, because the hazard is subtle and expensive: `IN_FLIGHT_PHASES` is WIDER (04-08 added the four funding-wait phases so a funding cohort stays listed in the public directory), so reusing it here would offer the operator a button whose library call throws. The two sets answer different questions and must never be substituted.
- `finalizeCohort`: an honest operator verb around `runner.triggerFallback`, guarding on the phase BEFORE the library call exactly as `validateDraft` guards before `buildCohortConfig`. It returns a closed verdict union (`ok` / `unknown` / `not-signing`), so no library throw can become an HTTP body, and a LATE rejection (the phase moved between the guard and the call) maps to the refusal verdict rather than escaping.
- A gated `POST /v1/operator/cohorts/:id/finalize` answering the full matrix: 401 anonymously before any lookup, 400 for a malformed id, one opaque 404 for unknown / never-advertised / already-settled, 409 with the app-authored `NOT_SIGNING_REASON`, and 200 for the happy path. Never a 500 for a refusal.
- `monitor.noteOperatorAction`: the actor-attribution push seam. `'fallback-started'` fires identically for the operator's Finalize now and for the automatic stall timer, so without this the operator could not tell their own decision from the service's. It de-duplicates consecutive identical text, so a double-click on an idempotent verb cannot make the record claim the action happened twice, and `noteCanceled` now routes its own line through it.
- The `Finalize now` control with its warn-tone rung-2 ceremony: disabled with `Available once this cohort's signing round starts.` outside the signing round, replaced entirely by the committed line after the fallback lands, and a confirm body that names the k-of-n consequence, who is left out of it, and the one way it can still fail to anchor, with k and n interpolated from the served projection.
- The automatic `Closed` stage on `OperatorStageTimeline`, with the caption explaining that every seat filled so the cohort locked. It is derived from the served seat counts, needs no server flag, and gains no control, which is the honest answer to the ROADMAP's "close": there is no close primitive, because a partially filled n-of-n cohort that stopped accepting joins could never proceed.
- The terminal `Canceled` marker, appended after the stage the cohort actually reached (never promoted to the active stage, which would repaint every earlier stage as complete and imply the cohort got as far as anchoring), rendered in neutral tone with the pulse suppressed.
- The honest seat-reclaim line under Members while a cohort is filling, stating the real workaround in words because `@did-btcr2/aggregation@0.4.0` has no seat-release API at all.
- `e2e:fallback:operator`: a third leg on the fallback capstone that drives a real signing stall, then finalizes it through the gated route with the automatic stall timer 60 seconds away, so the cohort can only have anchored because the operator's call salvaged it. It also pins the refusals against a live service (401 anonymous, 409 pre-signing with no library string in the body) and the single attributed activity entry.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing lifecycle-route matrix for the finalize verb** - `f894109` (test)
2. **Task 1 (GREEN): FINALIZABLE_PHASES, the pre-guarded finalize verb, and 409 route semantics** - `40c19b9` (feat)
3. **Task 2: finalize control, rung-2 ceremony, automatic Closed stage, seat-reclaim note** - `a695f3f` (feat)

## Files Created/Modified

- `packages/service/tests/lifecycle-routes.spec.ts` (new, 20 tests) - the single home for the route-semantics matrix of every gated lifecycle route this phase adds, covering both `/cancel` and `/finalize`, plus the `finalizeCohort` verdict semantics and the FINALIZABLE_PHASES membership pins.
- `packages/shared/src/phases.ts` - `FINALIZABLE_PHASES` plus the two new consumers added to the module docstring's list.
- `packages/service/src/operator-cohorts.ts` - `NOT_SIGNING_REASON` (exported, so the route and the spec share one string), the `onFinalize` option, and the pre-guarded `finalizeCohort`.
- `packages/service/src/monitor.ts` - `noteOperatorAction` plus the shared `recordOperatorAction` body, `OPERATOR_FINALIZED_TEXT`, and the optional `fate` on the detail projection.
- `packages/service/src/index.ts` - the `onFinalize` wiring, deliberately releasing nothing (unlike cancel, a finalized cohort is still alive and about to anchor).
- `packages/service/src/hono-adapter.ts` - the gated finalize route.
- `e2e/fallback-cohort.ts` - Leg C (`runOperatorFinalizeLeg`) and the `--operator` dispatch; `package.json` gained `e2e:fallback:operator`.
- `packages/web/src/lib/lifecycle.ts` - `FinalizeAvailability`, `finalizeAvailability`, `closedAtNthSeat`, `seatReclaimNoteVisible`.
- `packages/web/src/lib/operator.ts` - the `fate` mirror and the discriminated `finalizeCohort` client with its `refused` member.
- `packages/web/src/stores/operator.ts` - the `finalizing` marker, `FINALIZE_BUSY`, and the `finalizeCohort` action.
- `packages/web/src/components/operator/LifecycleActions.tsx` - the finalize block and the rung-2 confirm, rendered independently of the cancel block.
- `packages/web/src/components/operator/OperatorStageTimeline.tsx` - the `closed` stage, `STAGE_CAPTION`, `terminalCanceled`, and the appended Canceled row.
- `packages/web/src/components/operator/CohortDetail.tsx` - the seat-reclaim note under Members.
- `packages/web/tests/lifecycle.spec.ts` (+11 tests), `packages/web/tests/operator-stage.spec.ts` (+8 tests).

## Decisions Made

- **`FINALIZABLE_PHASES` is a third set, not a reuse.** The temptation was to read `IN_FLIGHT_PHASES`, which already means "mid-signing". It is wider on purpose, and the four extra phases are exactly the ones where `startFallbackSigning` throws.
- **Finalize is DISABLED with a reason; cancel-after-broadcast is HIDDEN.** The rule behind both: hide a control when the act will never become possible, disable it with an explanation when it will. A finalize outside the signing round genuinely is about to become available.
- **A refused finalize preserves the server's reason; a failed cancel does not.** Cancel's 404 body is deliberately opaque (an anti-oracle answer), so there is nothing honest to pass through. Finalize's 409 is an app-authored explanation of a phase race the operator could not have seen from a 4-second poll, so withholding it would leave them guessing.
- **The drill-down stays open after a successful finalize.** A cancel closes it because the cohort is gone; a finalize does not, because the cohort is now anchoring and that is precisely what the operator wants to watch.
- **The Canceled marker is appended, not promoted.** Making it the active stage would have marked every earlier stage complete, so a cohort canceled while still filling would have rendered a timeline claiming it reached anchoring.
- **The finalize confirm is warn, not danger.** Nothing is destroyed: the round was already stalled and the fallback is the path that still anchors it. Reserving danger tone for acts that lose something keeps the ladder meaningful.
- **The guard is unit-proven with the library call stubbed; the library path is e2e-proven.** A hermetic cohort crosses the three signing phases in milliseconds, so a unit spec can never hold one there without racing. Splitting the proof this way is what makes both halves non-vacuous.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] An optional `fate` field on the monitoring detail projection**
- **Found during:** Task 2
- **Issue:** The plan requires the stage timeline to render "a terminal `Canceled` rendering for a cohort whose served fate is canceled", but nothing on the detail DTO carried a fate. `CohortDetailDTO` had `exists`, seats, phase, submissions, co-sign, anchor, fallback, activity, and funding. A canceled cohort's detail projects `phase: 'unknown'` with an anchor that never fired, which is indistinguishable from an expiry, so the timeline had no honest way to say "canceled".
- **Fix:** `monitor.buildDetail` now emits `fate: 'canceled'` when the cohort holds a `canceled` ended record, read from the SAME retained record the summary chip reads so the drill-down and the list can never disagree. Additive and deliberately narrow: only `'canceled'`, because every other ending is already narrated by `anchor`, and widening it would create a second drift-prone way to say the same thing.
- **Files modified:** packages/service/src/monitor.ts, packages/web/src/lib/operator.ts
- **Verification:** Full 599-test suite green (no shape pin broke); `packages/web/tests/operator-stage.spec.ts#is read straight off the served fate, never inferred from a phase or an error`.
- **Committed in:** `40c19b9` (service) and `a695f3f` (client mirror)

**2. [Rule 2 - Missing Critical] `seatReclaimNoteVisible` as a pure predicate rather than inline component logic**
- **Found during:** Task 2
- **Issue:** The plan specifies the seat-reclaim note renders "only while the cohort is still filling" without naming a predicate, which invites the condition being written inline in `CohortDetail.tsx`. That is the exact drift `lib/lifecycle.ts` exists to prevent: the module's own docstring states that a rule deciding what a human is told is a rule worth testing without a DOM.
- **Fix:** Added `seatReclaimNoteVisible(detail)` beside the other predicates, defined as joinable-by-phase AND not yet at the nth seat (so the note disappears the moment there is no abandoned seat left to reclaim), with three spec cases.
- **Files modified:** packages/web/src/lib/lifecycle.ts, packages/web/src/components/operator/CohortDetail.tsx, packages/web/tests/lifecycle.spec.ts
- **Verification:** `packages/web/tests/lifecycle.spec.ts#seatReclaimNoteVisible` block, 3 tests.
- **Committed in:** `a695f3f`

**3. [Rule 3 - Blocking] The `operator-stage.spec.ts` base fixture moved from a full cohort to a partially filled one**
- **Found during:** Task 2
- **Issue:** The existing fixture was `seatsJoined: 2, capacity: 2`. Once the timeline narrates the automatic nth-seat close, every phase-only assertion in that spec reads `closed`, and the shipped assertion `deriveOperatorStage(detail({ phase: 'Advertised' }), order) === 'filling'` failed. The derivation is correct (a cohort with every seat filled HAS closed); the fixture was the thing that stopped testing what it claimed to.
- **Fix:** The base fixture is now `seatsJoined: 1, capacity: 2`, with a comment stating why, so the phase-driven assertions stay phase-driven. The close behavior gets its own explicit block, including the case that a filled cohort at a later phase still ratchets past `closed`.
- **Files modified:** packages/web/tests/operator-stage.spec.ts
- **Verification:** 11 tests green in that file; the WR-05 in-flight-set assertions are untouched and still pass.
- **Committed in:** `a695f3f`

**4. [Rule 1 - Bug] `LifecycleActions` renders its two blocks independently**
- **Found during:** Task 2
- **Issue:** The shipped component returned `null` whenever `cancelAvailability` was `'unavailable'`, and rendered the post-broadcast line as the whole body otherwise. Adding finalize under that structure would have hidden the `This cohort already finalized on the k-of-n fallback path.` line for exactly the cohorts that need it: a finalized cohort broadcasts, at which point cancel reads `'broadcast'` and then `'unavailable'`.
- **Fix:** The two blocks now render independently and the section returns `null` only when BOTH are unavailable, so each control (or its explanatory line) appears exactly when its own predicate says it should.
- **Files modified:** packages/web/src/components/operator/LifecycleActions.tsx
- **Verification:** Reasoned against the two predicates' branches; web build green; the cancel-availability spec is unchanged and still passes.
- **Committed in:** `a695f3f`

---

**Total deviations:** 4 auto-fixed (2 missing critical, 1 blocking, 1 bug)
**Impact on plan:** All four were required for the plan's own stated truths to hold. The only interface departures are the additive `fate` field on the detail projection and the extra `seatReclaimNoteVisible` export; no later plan in this phase references either as a fixed shape. No scope creep.

## Issues Encountered

- **A finalized cohort still cannot be re-opened from the operator list once it settles.** This is the same carried concern 05-02 recorded for canceled and expired rows (`canOpen` is `isAdvertised || cohort === undefined`), not something this plan introduced. It matters slightly more now, because the `This cohort already finalized on the k-of-n fallback path.` line lives in the drill-down: an operator who leaves the page after finalizing cannot navigate back to read it. 05-05 (ended-record dismissal) is still the natural home.

## Known Stubs

None. Every surface added here is wired end to end: the shared phase set has two real consumers that are pinned equal by spec, the finalize verb reaches the real library primitive (proven by `pnpm e2e:fallback:operator`, which anchors a genuine 2-of-3 script-path fallback), the 409 reason is rendered by a real store branch, the `fate` field has a real producer and a real consumer, and the Closed stage and seat-reclaim note are both derived from facts already on the wire. The `refused` member of `FinalizeResult` is exercised by the e2e leg's pre-signing assertion.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/service/tests/lifecycle-routes.spec.ts packages/web/tests/lifecycle.spec.ts packages/web/tests/operator-stage.spec.ts` | 58 tests pass |
| `pnpm e2e:fallback:operator` | pass (operator-driven 2-of-3 script-path fallback, stall timer 60s away) |
| `pnpm e2e:fallback` | pass (all three legs) |
| `pnpm test` (full suite, `tsc -b` gated) | 43 files, 599 tests pass |
| `pnpm lint` | clean |
| `pnpm --filter @btcr2-aggregation/web build` | clean |
| `pnpm e2e:cancel` | pass (no regression) |
| `pnpm e2e:monitor` | pass (no regression) |
| `grep -rlP '\x{2014}'` over service, shared, web, e2e | no files |
| `grep -c '<Button' OperatorStageTimeline.tsx` | 0 (the timeline gained no control) |

## User Setup Required

None - no external service configuration required. The finalize route mounts inside the existing operator block, so it appears only on a service booted with `OPERATOR_PASSWORD` (fail-closed, unchanged), and the k-of-n fallback it drives requires `AUTO_FALLBACK` to be on, which is the demo-server default.

## Next Phase Readiness

- The ROADMAP's "open, close, finalize" sentence is now honestly closed for SVC-04: open and finalize are real operator verbs over real library primitives, and close is narrated as the automatic nth-seat lock.
- `packages/service/tests/lifecycle-routes.spec.ts` is the home every later gated lifecycle route should join: 05-07's pause, 05-09's broadcast kill switch, and 05-05's dismissal each need the same 401 / 400 / 404 / 200 matrix, and the harness's two override seams (staged phase, counted library call) generalize.
- `monitor.noteOperatorAction` is the seam for every later operator action that needs an activity record, and the 05-CONTEXT operator-actions log (E13) can read straight off the ring it writes to.
- `ConfirmPanel` now has three of its four planned rungs in use (2 warn, 3 and 4 bad); 05-05's rung-1 neutral dismissal is the remaining one.
- Carried concern, unchanged: a settled cohort (expired, canceled, and now finalized-then-anchored) cannot be re-opened from the operator list. Natural home is 05-05.

## Self-Check: PASSED

- Created files verified present on disk: `packages/service/tests/lifecycle-routes.spec.ts`; modified key files verified present: `packages/shared/src/phases.ts`, `packages/service/src/operator-cohorts.ts`, `packages/web/src/lib/lifecycle.ts`, `packages/web/src/components/operator/OperatorStageTimeline.tsx`.
- Commits verified in git history: `f894109`, `40c19b9`, `a695f3f`.
- Every task acceptance criterion re-run and passing; the plan-level verification block re-run and green (the two judgment-dependent deliverables are carried to the end-of-phase human gate, recorded as coverage D6/D11/D12).

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-28*
