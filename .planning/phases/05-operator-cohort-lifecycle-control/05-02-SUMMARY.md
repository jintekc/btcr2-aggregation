---
phase: 05-operator-cohort-lifecycle-control
plan: 02
subsystem: ui
tags: [operator-console, cohort-lifecycle, react, zustand, tailwind, confirmation-ceremony, vitest]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 01)
    provides: the gated cancel route, the distinct server-side canceled fate on the operator DTO and the monitoring chip, and the advert-slot repair that keeps a cancel from un-advertising its siblings
  - phase: 04-operator-monitoring-and-live-path
    provides: the polled drill-down detail read (members / anchor / funding view), the discriminated FetchResult vocabulary with its single expireSession path, and the shipped inline danger-confirm block this plan generalizes
provides:
  - ConfirmPanel, the inline (never modal) laddered confirmation primitive every later Phase 5 destructive action composes
  - pure, unit-tested cancel availability and ceremony-rung predicates over the polled detail DTO
  - the drill-down Lifecycle section - Cancel cohort with its rung-3 and rung-4 ceremonies and the post-broadcast replacement line
  - a discriminated cancelCohort client plus store action whose 401 takes the one shared session-expiry path and whose failure changes nothing on screen
  - the neutral Canceled chip in the Ended group with its exact ended-row line, driven by a new server event-time stamp
affects: [05-03 finalize-now, 05-05 ended-record dismissal, 05-07 pause drain mode, 05-09 broadcast kill switch, 05-11 test peers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ceremony as a primitive: one inline ConfirmPanel with a tone ladder and an optional exact type-to-confirm gate, so friction is chosen per action instead of re-implemented per surface"
    - "Availability and rung selection are pure predicates over the polled DTO (the terminalReason precedent), never inline component logic"
    - "A destructive action never paints its own outcome: the fate chip arrives only from the served projection"

key-files:
  created:
    - packages/web/src/lib/lifecycle.ts
    - packages/web/src/components/operator/LifecycleActions.tsx
    - packages/web/tests/lifecycle.spec.ts
  modified:
    - packages/web/src/ui/primitives.tsx
    - packages/web/src/lib/operator.ts
    - packages/web/src/lib/operator-rows.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/CohortDetail.tsx
    - packages/web/src/components/operator/OperatorCohortList.tsx
    - packages/web/tests/operator-rows.spec.ts
    - packages/service/src/monitor.ts

key-decisions:
  - "Cancel is HIDDEN after the beacon transaction broadcasts, never disabled: a disabled button implies the act is possible under some condition, and after broadcast it never is (D-04)"
  - "A FAILED anchor is read through its txid, not its state name: a broadcast that later failed to confirm still put a transaction on the wire (nothing left to cancel), while a send that never reached the network leaves the cohort genuinely cancelable"
  - "A dead-end funding state takes the TOP rung alongside funded and awaiting-confirmation: money has already arrived at the address (below the usable minimum), so a cancel makes the loss permanent - it is the last state that should get the cheap ceremony"
  - "The type-to-confirm instruction renders as Body-size label text, NOT through Field, whose micro-label is uppercased: an uppercased instruction would tell the operator to type a value the case-sensitive match then rejects"
  - "The rung-4 type-to-confirm value is a plain 8-character id prefix with no truncation glyph, because the drill-down heading's own shortId ends in an ellipsis no one can type"
  - "The monitor now stamps every retained ended record at event time and serves it, so the Canceled row names a real server wall-clock time instead of the browser substituting its own first-observation time"

patterns-established:
  - "Pattern: promote a shipped inline block into ui/primitives.tsx with a docstring stating WHAT it enforces (the Expander precedent), here that tone is never the only carrier of meaning and that a confirm is inline, never a modal"
  - "Pattern: a one-shot actionError belongs to the surface that raised it, so opening a drill-down clears it"

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "Cancel is offered only while a cohort is genuinely cancelable: unavailable before the first detail read and for a settled cohort, available from Advertised through the signing arc, and replaced (not disabled) by the honest post-broadcast line once the beacon transaction is out"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is unavailable before the first detail read lands, so no control appears then vanishes"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is available through the signing arc, right up to the broadcast"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#reads broadcast once the anchor projection reports a broadcast or confirmed transaction"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#reads broadcast for a FAILED anchor that still carries a txid (the tx is out on the network)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The confirmation rung matches the stakes: an ordinary cohort takes one explicit confirm, and a cohort whose beacon address has received funds takes the top rung"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is rung 4 once funds are observed at the beacon address"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is rung 4 for a dead-end address, where funds arrived below the usable minimum"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is rung 3 for a hermetic cohort with no funding view at all"
        status: pass
    human_judgment: false
  - id: D3
    description: "The rung-4 type-to-confirm is an exact, case-sensitive gate, so no partial or near-miss input can arm the confirm button"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#refuses a prefix, a superstring, and a case difference"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#never matches an empty input"
        status: pass
      - kind: unit
        ref: "packages/web/tests/lifecycle.spec.ts#is the plain first 8 characters, with no ellipsis to type"
        status: pass
    human_judgment: false
  - id: D4
    description: "A canceled cohort renders the neutral Canceled chip in the settled Ended group with its exact ended-row line, never a bad-tone failure chip and never in Needs attention"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator-rows.spec.ts#maps an operator-canceled cohort to the canceled chip"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator-rows.spec.ts#places the canceled chip in the settled Ended group, never in Needs attention"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator-rows.spec.ts#renders the exact ended-row line from a server wall-clock stamp"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:cancel"
        status: pass
    human_judgment: false
  - id: D5
    description: "ConfirmPanel is an inline panel with no portal and no modal overlay, whose confirm button disables while an action is in flight and renders its in-flight label"
    requirement: SVC-04
    verification:
      - kind: other
        ref: "grep -c 'createPortal' packages/web/src/ui/primitives.tsx == 0 and grep -c 'fixed inset-0' == 0"
        status: pass
      - kind: other
        ref: "pnpm --filter @btcr2-aggregation/web build"
        status: pass
    human_judgment: false
  - id: D6
    description: "A 401 on the cancel action routes through the single shared session-expiry path, and a failed cancel renders the action-error line while leaving every cohort fact untouched (no optimistic Canceled chip)"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "The wiring is code-verified (the store's unauthorized branch calls the same expireSession every gated read uses, and neither failure branch writes cohort state) but there is no store-level harness in this package: web state is proven today through the browser capstone, not unit tests. Driving a real 401 and a real 502 mid-ceremony belongs in the operator browser walkthrough."
  - id: D7
    description: "The cancel ceremony reads correctly to an operator: the rung-3 body names the seated count, the rung-4 body names the recovery-key situation before the confirm arms, and the post-broadcast line explains itself"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "Whether the friction feels proportionate and the wording lands is exactly the judgment a human gate exists for. The copy is contract-fixed and the predicates are proven, but the rendered ceremony has no automated visual check in this plan (the phase runs its console walkthrough at the end-of-phase gate)."

# Metrics
duration: 22 min
completed: 2026-07-28
status: complete
---

# Phase 5 Plan 02: Cancel UI and the Confirmation Ceremony Summary

**The operator can cancel a cohort from its drill-down through a ceremony whose friction matches the stakes, built on a new inline ConfirmPanel primitive and pure availability/rung predicates, with the canceled fate rendering as a neutral Ended chip stamped with a real server time.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-28T18:55:00Z
- **Completed:** 2026-07-28T19:17:00Z
- **Tasks:** 2 (task 1 TDD: RED then GREEN)
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments

- `ConfirmPanel`: the laddered confirmation primitive, promoted from the shipped `Discard draft` inline block exactly as `Expander` was promoted in Phase 4. It renders inline (no portal, no overlay, no focus trap to get wrong), carries the three tones, disables both buttons behind an in-flight label, and arms its confirm button only on an exact type-to-confirm match. Its docstring states the rule it exists to enforce: tone is never the only carrier of meaning, so the body must name the irreversible outcome in words.
- `lib/lifecycle.ts`: every lifecycle decision as a pure, DOM-free function. `cancelAvailability` hides the control after the beacon transaction broadcasts (D-04) and renders nothing at all before the first detail read; `cancelRung` picks the ceremony from whether funds have been observed at the beacon address; `typeToConfirmMatches` is the exact gate; `cohortShortId` is a typeable id prefix.
- `LifecycleActions`: the drill-down `Lifecycle` section. The danger `Cancel cohort` button plus its availability note while cancelable, the honest replacement line once broadcast, and the two ceremonies: rung 3 names the cohort and its seated count (with a genuinely different zero-seat sentence, not a pluralization patch), rung 4 adds the funded-on line, the operator-held versus throwaway recovery-key disclosure, and a typed cohort id.
- `cancelCohort` client plus store action: discriminated like every other gated call, so a 401 takes the ONE shared `expireSession` path and a fault raises the action-error copy with nothing about the cohort changed. On success the drill-down closes and the list is re-read, so the Canceled chip arrives from the SERVED projection and a failed cancel can never make the console claim a cohort ended (T-05-02-02).
- The `canceled` fate mirrored client-side end to end: the widened DTO unions, the neutral `Canceled` chip in the settled `Ended` group (never bad-tone, never `Needs attention`), and its exact ended-row line.
- A new event-time stamp on every retained ended record, served on the monitoring row, so `Canceled by the operator at {time}.` states a real server wall-clock time instead of the browser inventing one.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing specs for the lifecycle predicates and the canceled fate** - `4592e21` (test)
2. **Task 1 (GREEN): ConfirmPanel, the canceled chip, and the pure lifecycle predicates** - `47960c0` (feat)
3. **Task 2: the Lifecycle section with the rung-3 and rung-4 cancel ceremonies** - `e691d2e` (feat)

## Files Created/Modified

- `packages/web/src/lib/lifecycle.ts` (new) - `CancelAvailability`, `cancelAvailability`, `cancelRung`, `typeToConfirmMatches`, `cohortShortId`, each with the rationale for its branches.
- `packages/web/src/components/operator/LifecycleActions.tsx` (new) - the `Lifecycle` section and both confirmation rungs, with the exact 05-UI-SPEC copy as named module constants.
- `packages/web/tests/lifecycle.spec.ts` (new, 16 tests) - availability across the whole arc (including the failed-anchor-with-txid case), rung selection, the exact-match gate, and the typeable short id.
- `packages/web/src/ui/primitives.tsx` - `ConfirmPanel` plus its tone map.
- `packages/web/src/lib/operator.ts` - the `canceled` state and chip mirrors, the optional ended-row `at` stamp, and the discriminated `cancelCohort` client.
- `packages/web/src/lib/operator-rows.ts` - the `canceled` branch in `chipForCohort`, the pinned Ended grouping, and `canceledEndedLine`.
- `packages/web/src/stores/operator.ts` - the `cancelling` marker, the exact action-error copy plus its reason variant, `CANCEL_BUSY`, the `cancelCohort` action, and the `actionError` clear on drill-down open.
- `packages/web/src/components/operator/CohortDetail.tsx` - mounts `LifecycleActions` under the stage timeline, above Members.
- `packages/web/src/components/operator/OperatorCohortList.tsx` - the neutral `Canceled` chip row and the exact ended-row line.
- `packages/web/tests/operator-rows.spec.ts` - the canceled chip, group, and line assertions.
- `packages/service/src/monitor.ts` - event-time `at` on every ended record, served on the summary row.

## Decisions Made

- **Cancel is hidden, not disabled, after broadcast.** A disabled control implies the act is possible under some condition; after the beacon transaction is out it never is, so the control is replaced by the line that says so.
- **A `failed` anchor is judged by its txid, not its state name.** A broadcast that later failed to confirm still reached the network, so there is nothing to cancel; a send that never reached it carries no txid and leaves the cohort cancelable. Keying on the state name alone would have made a failed send permanently uncancelable.
- **`dead-end` funding takes the top rung.** The plan named `awaiting-confirmation` and `funded`; `dead-end` means money already arrived below the usable minimum, so a cancel makes that loss permanent. It would have been the one case where the ceremony was cheapest exactly when the loss was certain.
- **The type-to-confirm instruction is not a `Field` label.** `Field`'s micro-label is uppercased, which would have instructed the operator to type an uppercase value that the case-sensitive match then rejects, leaving the confirm button permanently disabled.
- **The short id is a plain 8-character prefix.** The drill-down heading's own `shortId` appends a horizontal ellipsis, which is unusable as something to type.
- **No `Re-advertise` action was added to a canceled row.** The server accepts it, but adding the control was not in this plan's scope; a canceled row is currently as settled in the console as an expired one is (see Next Phase Readiness).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Event-time `at` stamp on the monitoring ended row**
- **Found during:** Task 1
- **Issue:** The plan's truth requires the canceled ended row to render `Canceled by the operator at {time}.`, but nothing on the wire carried a time: the monitor's ended record held only chip/seats/capacity/reason. The honest options were to render no time (breaking the exact copy) or to substitute the browser's own first-observation time, which is not when the operator canceled.
- **Fix:** `rememberEnded` now stamps `Date.now()` inside the function (so no call site can forget one, and every fate is stamped at event time per 04 D-22), and `summary()` serves it as an optional `at` on ended rows. The client DTO mirrors it as optional, and a row without one renders no time rather than inventing one.
- **Files modified:** packages/service/src/monitor.ts, packages/web/src/lib/operator.ts, packages/web/src/lib/operator-rows.ts, packages/web/src/components/operator/OperatorCohortList.tsx
- **Verification:** Full 560-test suite green (no shape pins broke, the ended-row assertions are all `find`-then-field, never full equality); `pnpm e2e:cancel` green; the new `canceledEndedLine` spec pins the exact copy.
- **Committed in:** `47960c0`

**2. [Rule 1 - Bug] The type-to-confirm instruction renders as a Body-size label, not a `Field` micro-label**
- **Found during:** Task 1
- **Issue:** The plan specifies a `Field`-wrapped `Input`. `Field`'s label class is `uppercase`, so `Type abc12345 to confirm.` would have rendered as `TYPE ABC12345 TO CONFIRM.` while `typeToConfirmMatches` is deliberately case-sensitive. An operator typing exactly what the screen showed would never arm the confirm button, and nothing on screen would explain why.
- **Fix:** `ConfirmPanel` renders the instruction as a Body-size `<label htmlFor>` (still a real, associated label) with the value in `Mono`, and the input carries `font-mono`. The exact UI-SPEC string is preserved.
- **Files modified:** packages/web/src/ui/primitives.tsx
- **Verification:** Reasoned against `Field`'s shipped class string (`uppercase tracking-[0.14em]`) and the case-sensitivity spec, which is itself pinned by `typeToConfirmMatches('ABC12', 'abc12') === false`.
- **Committed in:** `47960c0`

**3. [Rule 2 - Missing Critical] `dead-end` funding promoted to the top ceremony rung**
- **Found during:** Task 1
- **Issue:** The plan scopes rung 4 to `awaiting-confirmation` and `funded`. A `dead-end` cohort HAS received funds (below the spendable minimum, so the address is permanently unusable). Canceling it strands that money for good, yet it would have taken the cheap rung with no recovery-key disclosure.
- **Fix:** `cancelRung` returns 4 for `awaiting-confirmation`, `funded`, and `dead-end`, matching the plan truth's own wording ("a cohort whose beacon address has received funds"). The plan's asserted cases are unchanged.
- **Files modified:** packages/web/src/lib/lifecycle.ts
- **Verification:** `packages/web/tests/lifecycle.spec.ts#is rung 4 for a dead-end address, where funds arrived below the usable minimum`.
- **Committed in:** `47960c0`

**4. [Rule 3 - Blocking] The `Canceled` chip entry on the list tone map**
- **Found during:** Task 1
- **Issue:** `OperatorCohortList`'s `CHIP` map is typed `Record<ChipKey, ...>`, so widening `ChipKey` with `canceled` broke `tsc --noEmit` in a file outside the task's declared set.
- **Fix:** Added the neutral, non-pulsing `Canceled` row to the map (the 05-UI-SPEC tone map value) and the ended-row line render beside it.
- **Files modified:** packages/web/src/components/operator/OperatorCohortList.tsx
- **Verification:** `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` clean; web build green.
- **Committed in:** `47960c0`

**5. [Rule 1 - Bug] `actionError` cleared when a drill-down opens**
- **Found during:** Task 2
- **Issue:** The shared one-shot `actionError` outlives the surface that raised it, so a failed discard on the LIST followed the operator into a cohort drill-down it never touched, and would have rendered inside the new Lifecycle block as though the cancel had failed.
- **Fix:** `openCohort` clears `actionError` alongside the detail slice it already resets.
- **Files modified:** packages/web/src/stores/operator.ts
- **Verification:** Full suite + lint green; the clear sits in the same `set` as the existing documented drill-down reset.
- **Committed in:** `e691d2e`

---

**Total deviations:** 5 auto-fixed (2 missing critical, 2 bugs, 1 blocking)
**Impact on plan:** All five were required for the plan's own stated truths to hold honestly (a real time on the canceled row, a confirm button that can actually arm, the top rung where money is certainly lost, a compiling tone map, and an error that belongs to its own surface). The only interface departure is `ConfirmPanel` rendering its type-to-confirm instruction as a label rather than through `Field`; no later plan references that internal. No scope creep.

## Issues Encountered

- **A canceled cohort's row has no `Open` action.** `canOpen` is `isAdvertised || cohort === undefined`, so a terminal record the operator list still carries (expired, and now canceled) cannot be drilled into, while a monitoring-only ended row can. This is pre-existing behavior inherited from the expired case, not introduced here, and out of scope for this plan; it is the natural thing for 05-05 (ended-record dismissal) to settle, since that plan already works the ended group.

## Known Stubs

None. Every surface added here is wired end to end: the predicates have a real consumer, the ConfirmPanel is rendered by both rungs, the client action reaches the live gated route proven by `pnpm e2e:cancel`, and the chip is driven by the served projection. `actionFailedWith`'s reason variant is exported and used (called with no reason today, because the cancel route's 404 body is deliberately opaque); it is the shared copy helper 05-03's finalize action will call with a real reason, not an unwired placeholder.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/web/tests/lifecycle.spec.ts packages/web/tests/operator-rows.spec.ts` | 27 tests pass |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | clean |
| `pnpm --filter @btcr2-aggregation/web build` | clean |
| `pnpm test` (full suite, `tsc -b` gated) | 42 files, 560 tests pass |
| `pnpm lint` | clean |
| `pnpm e2e:cancel` | pass (no regression from the served `at` field) |
| No em-dash in any touched file | confirmed |
| `grep -c 'createPortal'` / `'fixed inset-0'` in primitives.tsx | 0 / 0 (inline, never a modal) |
| `expireSession` occurrences in the operator store | 6 before, 8 after (the cancel action joins the shared 401 path) |

## User Setup Required

None - no external service configuration required. The Lifecycle section renders only inside the authenticated console, which exists only on a service booted with `OPERATOR_PASSWORD`.

## Next Phase Readiness

- `ConfirmPanel` is the composition point every later Phase 5 destructive action was planned to reuse: 05-03 finalize (rung 2, warn), 05-05 dismissal (rung 1, neutral), and 05-09 the broadcast kill switch (rung 3, bad) all now compose it rather than writing another inline confirm.
- `lib/lifecycle.ts` is the home for the next availability predicate: 05-03's finalize availability (available only once the signing round starts, hidden after the fallback commits) belongs beside `cancelAvailability` and should be unit-tested the same way.
- The store's `cancelling` marker, `CANCEL_BUSY`, and `actionFailedWith` are the shape the finalize action should copy exactly.
- Carried concern: a canceled or expired cohort the operator list still holds cannot be opened from the list. Pre-existing; the natural home is 05-05.

## Self-Check: PASSED

- Created files verified present on disk: `packages/web/src/lib/lifecycle.ts`, `packages/web/src/components/operator/LifecycleActions.tsx`, `packages/web/tests/lifecycle.spec.ts`.
- Commits verified in git history: `4592e21`, `47960c0`, `e691d2e`.
- Every task acceptance criterion re-run and passing; the plan-level verification block re-run and green (the manual console walkthrough is carried to the end-of-phase human gate, recorded as coverage D6/D7).

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-28*
