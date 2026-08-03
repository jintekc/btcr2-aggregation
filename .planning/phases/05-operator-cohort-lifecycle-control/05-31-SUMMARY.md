---
phase: 05-operator-cohort-lifecycle-control
plan: 31
subsystem: infra
tags: [runtime-settings, boot-seeds, validation, operator-console, warnings, gap-closure]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "createRuntimeSettings (05-04), the shorten-only discovery-window ceiling (05-06/05-07), the seed clamp and whole-minute quantizer (05-30)"
provides:
  - "textKnob: a bounded, warn-and-drop free-text boot seed applied to SERVICE_NAME and TERMS_TEXT, closing the SC3 string-seed wedge"
  - "the holder invariant restated and CHECKED for every field the holder stores, not only its numeric half"
  - "a discovery-window quantizer that runs on the seed, so the clamp warning is true whenever it prints"
  - "boot warnings that name the environment variables an operator can act on, never a bare internal field"
affects: [phase-06, operator-settings-surface, deploy-runbook]

actuals:
  tokens: 11400
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "String boot seeds take the same warn-and-fall-back posture the numeric ones already had, at the same holder"
    - "A boot warning names the environment variable that produced the value, not the internal field it lands in"
    - "An invariant predicate names its subject (every field this holder stores) rather than the fields somebody thought of"

key-files:
  created: []
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/tests/runtime-settings.spec.ts
    - packages/service/src/demo-server.ts
    - docs/DEPLOY.md

key-decisions:
  - "An over-long free-text seed is DROPPED whole, never truncated: the SVC-05 acceptance record binds the hash of the exact text shown, so a truncated terms document is one participants would DID-sign in mutilated form."
  - "The terms warning states the CONSEQUENCE in words (with no terms stored the join flow has no terms step at all), which is why textKnob takes a per-field consequence clause rather than one generic sentence."
  - "The bound lives at the holder only, never a second time in demo-server.ts: one rule at the one place every seed path meets, the precedent 05-30 set for the ceiling clamp."
  - "The discovery-window ceiling now floors SILENTLY. It is derived from COHORT_TTL_MS and every truncation it causes is disclosed by the window's own line, so warning there too printed a second line saying the same thing under a name no environment reference contains."
  - "The quantizer reordering is value-preserving by monotonicity (flooring is monotone and the ceiling is quantized first), asserted as a property over the whole hostile-seed table rather than row by row."

patterns-established:
  - "Mutation proof per guard: write the row, observe RED, land the fix, observe GREEN, revert the fix once, observe RED again, restore, and quote the observed output."
  - "A predicate-only property row beside the per-row table, because a row's own expectation fires first and masks a predicate that stopped covering a field."

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "A realistic over-long TERMS_TEXT no longer wedges the settings surface: a real createService boot stores no terms, warns naming both lengths and the consequence, and a rename-only save then succeeds."
    requirement: "SVC-04"
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#drops an over-long TERMS_TEXT at a real boot, warns, and leaves the settings surface usable"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#stores a terms document AT the ceiling exactly, unchanged and silently"
        status: pass
    human_judgment: false
  - id: D2
    description: "The holder invariant covers every field it stores: two new hostile-seed rows plus the string half of expectHolderInvariants, each proven load-bearing by an independent revert."
    requirement: "SVC-04"
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#satisfies the holder invariant for EVERY field across the whole table, as a property"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#stores a self-consistent value for an over-long participation-terms document, and a rename-only save still succeeds"
        status: pass
    human_judgment: false
  - id: D3
    description: "A single COHORT_TTL_MS=90000 boot prints exactly one settings warning, it is the true whole-minute line, and it names COHORT_TTL_MS rather than an internal field."
    requirement: "SVC-04"
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#closes a non-whole-minute COHORT_TTL_MS with no DEFAULT_DISCOVERY_WINDOW_MS anywhere"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#prints the whole-minute line THEN the clamp line for a seed above a non-whole-minute ceiling"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#names an environment variable in every window warning it prints, never a bare internal field"
        status: pass
    human_judgment: false
  - id: D4
    description: "The runbook states both character ceilings and the corrected COHORT_TTL_MS warning behavior before an operator boots into either."
    requirement: "SVC-04"
    verification:
      - kind: manual_procedural
        ref: "grep -n '200 characters|20000 characters' docs/DEPLOY.md (SERVICE_NAME row, TERMS_TEXT row, participation-terms prose)"
        status: pass
    human_judgment: true
    rationale: "Runbook accuracy for a self-hosting stranger is a reading judgment; the greps prove the bounds are stated, not that the surrounding prose reads correctly to an operator."

duration: 47 min
completed: 2026-08-03
status: complete
---

# Phase 05 Plan 31: String-seed wedge and warning accuracy Summary

**A bounded free-text boot seed (`textKnob`) that drops an over-long `SERVICE_NAME` or `TERMS_TEXT` with a warning naming the length, the ceiling and what the drop costs, plus a reordered discovery-window quantizer so one variable set wrongly produces one warning that is true.**

## Performance

- **Duration:** 47 min
- **Started:** 2026-08-03T15:47:00Z
- **Completed:** 2026-08-03T16:34:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Closed SC3 (05-VERIFICATION.md Gap 1, review CR-01): a realistic participation-terms document longer than 20000 characters no longer silently disables the operator's entire settings surface until restart. It is refused at the seed, loudly, and every later save of capacity, threshold, beacon type and name keeps working.
- Closed W6 (review WR-02): a single `COHORT_TTL_MS=90000` boot printed two lines of which the second was false ("a 90000 ms window exceeds this service's cohort TTL" of 90000 ms) and named `discoveryWindowCeilingMs`, a knob that exists in no environment reference, no compose file and no ADR. It now prints one true line naming `COHORT_TTL_MS`.
- Made the invariant predicate non-vacuous: `expectHolderInvariants` asserts the two free-text fields against their ceilings, so a field added later without a bound fails the table rather than passing it.
- Found and fixed a second, unlisted honesty defect while reordering: under the old order an over-ceiling seed that was ALSO not a whole minute was clamped and the operator was never told their own value had been floored. The new order discloses both truncations, in the order they were applied.

## Task Commits

1. **Task 1 (tracer, TDD): bound the two free-text boot seeds at the holder** - `f29a3df` (fix)
2. **Task 2 (TDD): invariant covers every field, runbook states both ceilings** - `3c43c03` (test)
3. **Task 3 (TDD): every window warning is true and names a settable variable** - `93cd87f` (fix)

## Files Created/Modified

- `packages/service/src/runtime-settings.ts` - added module-local `textKnob` (bounded, warn-and-drop string seed) and `wholeMinutesAtOrBelow` (the silent arithmetic both floor paths share); applied `textKnob` at the `serviceName` and `termsText` seed sites; restated the invariant paragraph in `numericKnob`'s docstring as the holder's rule over every stored field; moved the discovery-window quantizer onto the seed, ahead of the ceiling comparison; made the ceiling's own quantization silent; added `DISCOVERY_WINDOW_SOURCES` / `FUNDING_WINDOW_SOURCES` so every window warning names settable variables; kept the post-clamp floor as the documented last-write guard.
- `packages/service/tests/runtime-settings.spec.ts` - new SC3 describe block (real-boot over-long terms row, two at-ceiling anti-vacuity controls, the both-seeds two-warning row, the trim-still-collapses control); two new `HOSTILE_SEEDS` rows; the string half of `expectHolderInvariants` plus a predicate-only property row; the `COHORT_TTL_MS=90000` row extended with warning-count and naming assertions (its stored assertions untouched); new W6 describe block (two-line ordering, clamp-still-true control, env-var naming property, stored-value property over the table).
- `packages/service/src/demo-server.ts` - comment text only: the seed comment now says where the trim happens and where the length bound is enforced, replacing the claim that was false for these two fields.
- `docs/DEPLOY.md` - `SERVICE_NAME` (200), `TERMS_TEXT` (20000), participation-terms prose, `DEFAULT_DISCOVERY_WINDOW_MS` and `COHORT_TTL_MS` rows.

## Mutation Checks (observed output, quoted)

Every guard was proven load-bearing by reverting it, observing RED, and restoring. All four runs are `pnpm vitest run packages/service/tests/runtime-settings.spec.ts`.

**Task 1, before the fix existed** (the new rows against the shipped module):

```
Tests  2 failed | 69 passed (71)
FAIL > drops an over-long TERMS_TEXT at a real boot, warns, and leaves the settings surface usable
AssertionError: expected 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' to be undefined
FAIL > warns about BOTH over-long seeds separately, so an operator who set both is told about both
AssertionError: expected [] to have a length of 2 but got +0
```

**Mutation A, terms bound reverted to a bare `trimToUndefined`** (restored afterwards):

```
Tests  4 failed | 70 passed (74)
FAIL > stores a self-consistent value for an over-long participation-terms document, and a rename-only save still succeeds
AssertionError: expected 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' to be undefined
FAIL > satisfies the holder invariant for EVERY field across the whole table, as a property
AssertionError: expected 100000 to be less than or equal to 20000
FAIL > drops an over-long TERMS_TEXT at a real boot, warns, and leaves the settings surface usable
AssertionError: expected 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' to be undefined
FAIL > warns about BOTH over-long seeds separately, so an operator who set both is told about both
AssertionError: expected [ Array(1) ] to have a length of 2 but got 1
```

**Mutation B, service-name bound reverted ALONE** (restored afterwards). The terms rows stayed green, which is the evidence the two seeds are bounded independently rather than by one accidental shared path:

```
Tests  3 failed | 71 passed (74)
FAIL > stores a self-consistent value for an over-long service name, and a rename-only save still succeeds
AssertionError: expected 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…' to be undefined
FAIL > satisfies the holder invariant for EVERY field across the whole table, as a property
AssertionError: expected 5000 to be less than or equal to 200
FAIL > warns about BOTH over-long seeds separately, so an operator who set both is told about both
AssertionError: expected [ Array(1) ] to have a length of 2 but got 1
```

**Mutation C, quantize-after-clamp ordering restored** (restored afterwards):

```
Tests  2 failed | 76 passed (78)
FAIL > closes a non-whole-minute COHORT_TTL_MS with no DEFAULT_DISCOVERY_WINDOW_MS anywhere
AssertionError: expected [ …(2) ] to have a length of 1 but got 2
FAIL > prints the whole-minute line THEN the clamp line for a seed above a non-whole-minute ceiling
AssertionError: expected [ Array(1) ] to have a length of 2 but got 1
```

Task 3's first RED run, before the source change, additionally showed the naming half failing against the shipped label:

```
AssertionError: expected 'defaultDiscoveryWindowMs=90000 is not…' to match /COHORT_TTL_MS|DEFAULT_DISCOVERY_WINDO…/
```

## Observed Boot Output (after the fix)

Run against the shipped module, not transcribed from the tests:

```
--- COHORT_TTL_MS=90000 boot (window and ceiling from the same 90000) ---
[settings] defaultDiscoveryWindowMs=90000 is not a whole number of minutes; using 60000 instead, the longest whole-minute window at or below it. Set it with DEFAULT_DISCOVERY_WINDOW_MS, or COHORT_TTL_MS when that is unset.
--- over-ceiling, non-whole-minute seed ---
[settings] defaultDiscoveryWindowMs=2500000 is not a whole number of minutes; using 2460000 instead, the longest whole-minute window at or below it. Set it with DEFAULT_DISCOVERY_WINDOW_MS, or COHORT_TTL_MS when that is unset.
[settings] defaultDiscoveryWindowMs=2460000 exceeds this service's cohort TTL; using 1800000 instead, the longest discovery window this service can enforce. Set it with DEFAULT_DISCOVERY_WINDOW_MS, or COHORT_TTL_MS when that is unset; the maximum comes from COHORT_TTL_MS.
--- over-long TERMS_TEXT + SERVICE_NAME ---
[settings] ignoring SERVICE_NAME: 5000 characters exceeds the 200 character maximum this service stores; the display name is left unset until the value is shortened
[settings] ignoring TERMS_TEXT: 100000 characters exceeds the 20000 character maximum this service stores; the terms are left unset, so the join flow has no terms step at all until the value is shortened
```

## Decisions Made

See `key-decisions` above. The one worth restating: the ceiling's quantization went SILENT rather than being relabeled, because after the reordering the ceiling and the window are floored from the same `COHORT_TTL_MS` value, so a labeled ceiling warning is a second line saying the same thing about the same variable. Silence there is what makes "one variable set, one warning" true.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `textKnob` takes a fifth `consequence` parameter**
- **Found during:** Task 1
- **Issue:** The plan enumerated four parameters (name, raw, maximum, warn), but its own behavior requirement is that the TERMS warning names what the fallback costs ("with no terms stored, the join flow has no terms step at all") while the name warning cannot say that. One generic sentence cannot carry both.
- **Fix:** A per-field `consequence` clause supplied at each call site, with the reason documented in the helper's docstring.
- **Files modified:** packages/service/src/runtime-settings.ts
- **Verification:** the real-boot row asserts on the consequence wording, not only on the two numbers.
- **Committed in:** f29a3df

**2. [Rule 1 - Bug] The ceiling's quantization warning was removed rather than relabeled**
- **Found during:** Task 3
- **Issue:** The plan's action text says to pass the ceiling a `COHORT_TTL_MS` label; its acceptance criterion requires EXACTLY ONE settings warning from a `COHORT_TTL_MS=90000` boot. Both cannot hold after the reordering, because the ceiling and the window are then floored from the same number and both would warn. A labelled ceiling line is the second, duplicate line that W6 exists to remove.
- **Fix:** the ceiling floors through a new silent `wholeMinutesAtOrBelow`; the operator-facing disclosure is the window's own line, which names the same variable. The reasoning is recorded at the call site so a future reader does not re-add the warning.
- **Files modified:** packages/service/src/runtime-settings.ts
- **Verification:** the single-warning row and the env-var naming property; mutation C proves both are load-bearing.
- **Committed in:** 93cd87f

**3. [Rule 2 - Missing Critical] A predicate-only property row was added beside the per-row table**
- **Found during:** Task 2
- **Issue:** Inside the per-row test, a row's own `stored` assertion runs BEFORE `expectHolderInvariants`, so mutation A failed at the row assertion and never exercised the predicate. The string half of the predicate would have looked load-bearing without being tested as such, which is the same vacuity the plan is closing.
- **Fix:** a row that runs the predicate over the whole table with nothing in front of it.
- **Files modified:** packages/service/tests/runtime-settings.spec.ts
- **Verification:** mutations A and B both show that row RED with a specific length assertion (`expected 100000 to be less than or equal to 20000`, `expected 5000 to be less than or equal to 200`).
- **Committed in:** 3c43c03

**4. [Rule 2 - Missing Critical] Extracted `wholeMinutesAtOrBelow`**
- **Found during:** Task 3
- **Issue:** Two callers now need the floor arithmetic with different disclosure postures; duplicating `Math.floor(ms / ONE_MINUTE_MS) * ONE_MINUTE_MS` would make the monotonicity argument checkable in one place and copied in another.
- **Fix:** one module-local helper, not exported.
- **Files modified:** packages/service/src/runtime-settings.ts
- **Verification:** full suite green; module surface unchanged.
- **Committed in:** 93cd87f

---

**Total deviations:** 4 auto-fixed (3 missing-critical, 1 bug). **Impact:** all four serve the plan's own stated truths and acceptance criteria. No scope creep: nothing outside `runtime-settings.ts`, its spec, one comment block in `demo-server.ts` and five `docs/DEPLOY.md` edits was touched.

## Prohibitions Verified

| Prohibition | Evidence |
|---|---|
| No loosening of `applySettings` | `MAX_SERVICE_NAME_CHARS` still 200, `MAX_TERMS_CHARS` still 20000; both refusal strings byte-identical (no diff line touches them) |
| No operator-facing REFUSAL string changed | `git diff packages/service/src/runtime-settings.ts` shows no added/removed line containing a refusal sentence; `git diff packages/service/src/operator-cohorts.ts` empty |
| Never refuses to boot on an over-long or unrepresentable seed | every affected path warns and falls back; the real-boot rows complete and go on to save |
| No truncation of the participation terms | the seed is dropped whole; the terms row asserts `undefined`, never a prefix |
| No second length bound in `demo-server.ts` | the only diff in that file is comment text (verified: every changed line begins with `//`) |
| No executable change in `demo-server.ts` | same check, `git diff -U0` filtered to non-comment lines is empty |
| No export of the two caps or of `textKnob` | `grep -c "export function textKnob"` = 0, `grep -c "export const MAX_"` = 0 |
| `validateDraft` untouched | `git diff packages/service/src/operator-cohorts.ts` empty |
| `packages/web/src/lib/cohort-form.ts` untouched | not in the change set |
| No persistence, config file or new env var | no new `process.env` read; the no-persistence source pin still green |
| No package added | `git diff --stat pnpm-lock.yaml` empty |
| No test count lowered, no assertion deleted or loosened | 1215 to **1227** tests, 68 files, all additions; the pre-existing clamp rows (396-465) and quantizer rows are unedited (diff hunks touch only line 933 onward and the appended block) |
| No em-dash | `grep -rlP '\x{2014}'` over all four touched files lists nothing |

## Verification

| Gate | Result |
|---|---|
| `pnpm test` | **1227 passed (68 files)**, up from the 1215 baseline (+12) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:gate` | green, all 13 hermetic legs (chain runs to `e2e:persist`, which printed PERSIST E2E PASSED) |
| `pnpm typecheck` (`tsc -b`) | green |

## Issues Encountered

None. The only friction was the conflict between the plan's ceiling-label instruction and its single-warning acceptance criterion, resolved in favor of the criterion and recorded as deviation 2.

## Notes on Workflow

The plan's Task 1 is a `type="tracer"`. Auto-mode flags read false (`workflow.auto_advance`, `workflow._auto_chain_active`), but `mode` is `yolo` and the plan is `autonomous: true` with no checkpoint tasks, so the tracer feedback gate was run as the autonomous variant: the tracer's `<verify>` was re-run end to end after its commit (71 passed, green) before any expansion task began. No human checkpoint was returned.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 05-32 (W5, the `refreshCohorts` list poll with no session round guard) is the remaining plan in this gap round and is unblocked: it touches `packages/web` only, disjoint from every file here.
- After 05-32: re-verify the phase, then the 16 pending human items in `05-UAT.md`.
- Nothing in this plan changes a wire format, a stored artifact or a refusal string, so no migration or re-pin is owed to any earlier phase.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-03*
