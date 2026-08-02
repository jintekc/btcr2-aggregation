---
phase: 05-operator-cohort-lifecycle-control
plan: 30
subsystem: infra
tags: [runtime-settings, validation, boot-config, operator-console, robustness]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "createRuntimeSettings (05-04), the applySettings save-as-a-set contract (05-07), the shorten-only discovery-window ceiling and its boot clamp (05-06, 05-18)"
provides:
  - "An opt-in integrality check on numericKnob, requested by the five seeds whose consumers demand whole numbers"
  - "A whole-minute quantizer at the one choke point every window seed passes through"
  - "validateWindow enforcing the whole-minute rule its own message has always claimed"
  - "The hostile-seed invariant table: every accepted seed proven to be a value the holder would still accept"
  - "Runbook rows naming the whole-minute rule and the previously undocumented derived seeds"
affects: [runtime settings, operator settings surface, draft creation, deploy runbook]

tech-stack:
  added: []
  patterns:
    - "Guard-against-guard testing: take a value one guard ACCEPTED and ask whether a second guard would still accept it"
    - "Opt-in validation parameters defaulting to off, so existing call sites resolve byte-identically"

key-files:
  created: []
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/tests/runtime-settings.spec.ts
    - packages/web/tests/cohort-form.spec.ts
    - docs/DEPLOY.md

key-decisions:
  - "Close the wedge at the HOLDER, not at each env read: it is the one place every seed path meets, including the derived ones, and a guard per env read is several rules that can drift instead of one that cannot"
  - "The integrality check is OPT-IN and defaults off, so the eleven existing numericKnob call sites (including PORT with a minimum of 0) resolve byte-identically"
  - "A non-whole-minute window is FLOORED, never rounded up and never refused: flooring only ever shortens a window, which is the same safe direction the ceiling clamp already moves in"
  - "The ceiling is quantized BEFORE it is used as a clamp target, because a fractional clamp target writes itself into the stored window"
  - "The quantizer runs AFTER the ceiling clamp on the discovery window: a value clamped to a quantized ceiling is already whole, and a value never clamped still needs its own floor"
  - "A malformed or unrepresentable seed still BOOTS, warning and falling back or quantizing, matching every other malformed knob in the module"

patterns-established:
  - "Hostile-seed table: each row carries a seed, what it must store, and a shared invariant predicate plus a rename-only save, so rows cannot drift apart as seeds are added"
  - "The browser half of a server rule is pinned in the browser package as the REASON for the server rule, with the invalid row named for what it proves"

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "numericKnob gains an opt-in integrality check, folded into the existing malformed branch, leaving every existing call site byte-identical"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#numericKnob: the integrality check is OPT-IN (existing call sites unchanged)"
        status: pass
      - kind: other
        ref: "git diff packages/service/src/demo-server.ts (empty)"
        status: pass
    human_judgment: false
  - id: D2
    description: "No seed the holder accepts is a value applySettings would refuse: the hostile-seed table, each row proving what got stored AND that a rename-only save then succeeds"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#no seed the holder ACCEPTS is a value it would REFUSE (W3, review WR-2 and WR-3)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The DERIVED boot paths are closed too, proven through a real createService with a fractional minParticipants, a non-whole-minute cohortTtlMs and a non-whole-minute fundingWindowMs"
    requirement: SVC-04
    verification:
      - kind: integration
        ref: "packages/service/tests/runtime-settings.spec.ts#the DERIVED boot seeds reach the same defect, and the holder-level fix closes them (W3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every window the holder stores is a whole number of minutes, quantized down with a warning naming both numbers, including through the clamp target"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#every window this holder will serve is a whole number of minutes (review WR-3)"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#stores only WHOLE-MINUTE windows across the entire table, asserted as a property"
        status: pass
    human_judgment: false
  - id: D5
    description: "The browser round trip is total over whole-minute values and invalid otherwise, which is why the service must never store a non-whole-minute window"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/cohort-form.spec.ts#the served-window round trip, which is WHY the service stores only whole minutes (WR-3)"
        status: pass
      - kind: other
        ref: "git diff packages/web/src/lib/cohort-form.ts (empty)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A direct POST cannot re-wedge the console: validateWindow refuses an integral but non-whole-minute window at SAVE, behind the byte-unchanged message"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#refuses a SAVE of a window that is integral but not a whole number of minutes"
        status: pass
    human_judgment: false
  - id: D7
    description: "The runbook states the whole-minute rule on the four DEFAULT_* rows and documents the derived seeding on COHORT_TTL_MS, FUNDING_WINDOW_MS and MIN_PARTICIPANTS"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "Documentation accuracy against an operator's mental model is a reading judgment; no test asserts that a runbook row is the right thing to say."

duration: 15 min
completed: 2026-08-02
status: complete
---

# Phase 05 Plan 30: Boot Seeds That Cannot Wedge The Settings Surface Summary

**An opt-in integrality check plus a whole-minute quantizer at the one holder every boot seed passes through, so no value this service accepts without complaint can lock the operator out of their own settings surface until restart.**

## Performance

- **Duration:** 15 min
- **Tasks:** 2
- **Files modified:** 4
- **Tests:** 1188 baseline (round start 1169) to 1215, all green

## Accomplishments

- **The invariant is now enforced rather than assumed.** `numericKnob` gained an opt-in integrality check, requested by the five seeds whose consumers demand whole numbers (size, threshold, both windows, and the discovery-window ceiling). A fractional seed now takes the same warn-and-fall-back branch a NaN always took, so it can no longer pass boot silently and then fail every later save as a set.
- **Every window the holder will serve is a whole number of minutes.** A new `floorToWholeMinute` helper is applied at three points: the resolved ceiling before it is used as a clamp target or a save refusal threshold, the discovery window after the clamp, and the funding window, which has no ceiling and needed its own call. It warns naming both numbers, mirroring the clamp's existing disclosure discipline.
- **The DERIVED boot paths are closed, which is the half both source accounts understated.** `createService` fills the size seed from `minParticipants`, the discovery-window seed from `cohortTtlMs` and the funding-window seed from `fundingWindowMs`, so `COHORT_TTL_MS=90000` or `MIN_PARTICIPANTS=2.5` reached the same defect with no malformed `DEFAULT_*` value anywhere. Those rows are proven through a real `createService` boot, because a bare holder call cannot show a derivation that lives in `createService`.
- **A direct POST cannot re-wedge the console either.** `validateWindow` now enforces the whole-minute rule its own message has always claimed, so the shipped sentence became true rather than being rewritten.
- **The runbook stops inviting the defect.** The four `DEFAULT_*` rows state the whole-minute rule, and `COHORT_TTL_MS`, `FUNDING_WINDOW_MS` and `MIN_PARTICIPANTS` now document the seeding relationship that was the undocumented way in.

## Task Commits

1. **Task 1: a seed the holder accepts can no longer be one it would refuse** - `dcc26b1` (fix)
2. **Task 2: every window this service serves is a whole number of minutes** - `14342ec` (fix)

## Files Created/Modified

- `packages/service/src/runtime-settings.ts` - `numericKnob` gained the opt-in `requireInteger` parameter and the invariant paragraph in its docstring; the five seeds request it; a new `floorToWholeMinute` closure helper is applied at three named quantizer points; `validateWindow` gained the whole-minute modulo.
- `packages/service/tests/runtime-settings.spec.ts` - the hostile-seed table with its shared `expectHolderInvariants` predicate and rename-only save, the whole-table whole-minute property, the derived-boot block over a real `createService`, the observed boot warnings, the `createDraft` unwedge, the quantizer block, and the opt-in call-site pins.
- `packages/web/tests/cohort-form.spec.ts` - the browser half of the invariant: `msToMinutesText` into `parseWindow` is total over whole-minute ms and invalid for a non-whole-minute one, named for what it proves.
- `docs/DEPLOY.md` - seven env table rows amended (four `DEFAULT_*`, plus `COHORT_TTL_MS`, `FUNDING_WINDOW_MS` and `MIN_PARTICIPANTS`).

## Decisions Made

- **Fix at the HOLDER, nowhere else.** It is the one place every seed path meets, direct and derived, and a guard added at each env read would be several rules that can drift instead of one that cannot. This matches the precedent already in the file, where the ceiling clamp was deliberately placed at the holder rather than as a boot check in `demo-server.ts`, for the same stated reason.
- **The integrality check is OPT-IN and defaults off.** `PORT` passes a minimum of 0 and must keep accepting an ephemeral-port request; the runner ms knobs are free to be any finite value. `git diff packages/service/src/demo-server.ts` is empty.
- **Floor, not round and not refuse.** Flooring preserves the operator's intent as closely as a representable value allows, can only ever shorten a window (the same safe direction the ceiling clamp already moves in), and refusing would drop a window the operator did choose or abort a boot over a value that is only unrepresentable in the console's units.
- **The quantizer runs after the clamp on the discovery window, and before it on the ceiling.** A value clamped to an already-quantized ceiling is whole by construction; a value never clamped still needs its own floor; and a fractional clamp TARGET would write itself straight into the stored window.
- **A malformed or unrepresentable seed still BOOTS.** Warn and carry on, matching every other malformed knob in the module, because one typo in a stranger's env file must not become a crash loop on the path this product's core value depends on.

## Mutation Evidence (both guards proven load-bearing)

**Task 1, the integrality check removed** (`|| (requireInteger && !Number.isInteger(n))` deleted from `numericKnob`):

```
Tests  9 failed | 46 passed (55)
FAIL > stores a self-consistent value for a fractional cohort size, and a rename-only save still succeeds
FAIL > stores a self-consistent value for a fractional signing threshold, ...
FAIL > stores a self-consistent value for a fractional discovery window, ...
FAIL > stores a self-consistent value for a fractional funding window, ...
FAIL > warns on a malformed seed rather than storing it, naming the value it ignored
FAIL > unwedges createDraft too: the shipped draft path succeeds under a fractional size seed
  at validateDraft packages/service/src/operator-cohorts.ts:701:11
FAIL > closes a fractional MIN_PARTICIPANTS with no DEFAULT_SIZE anywhere
FAIL > warns LOUDLY on the real console, naming the malformed value it ignored
FAIL > takes the SAME warn-and-fall-back path as a NaN when integrality IS requested
```

The `createDraft` row failing inside the shipped `validateDraft` is the defect itself reproducing: the fractional default reaches the real draft validator and throws.

**Task 2, the quantizer removed** (`Math.floor(ms / ONE_MINUTE_MS) * ONE_MINUTE_MS` replaced by `ms`):

```
Tests  10 failed | 56 passed (66)
FAIL > stores a self-consistent value for a non-whole-minute discovery window, ...
FAIL > stores a self-consistent value for a non-whole-minute funding window, ...
FAIL > stores a self-consistent value for a non-whole-minute CEILING with a seed above it, ...
FAIL > stores only WHOLE-MINUTE windows across the entire table, asserted as a property
FAIL > closes a non-whole-minute COHORT_TTL_MS with no DEFAULT_DISCOVERY_WINDOW_MS anywhere
FAIL > closes a non-whole-minute FUNDING_WINDOW_MS with no DEFAULT_FUNDING_WINDOW_MS anywhere
FAIL > quantizes a non-whole-minute discovery seed DOWN, warning with BOTH numbers
FAIL > quantizes the funding seed by the same rule, on its own call
FAIL > never quantizes BELOW one minute, because the knob refused anything under it first
FAIL > quantizes the CEILING too, so the clamp cannot write a fractional-minute value
```

Both mutations were restored immediately and the suite re-run green.

## Verification

- `pnpm test`: **1215 passed** (68 files), against the 1188 round floor and the 1169 round-start baseline. Nothing weakened, nothing skipped.
- `pnpm lint`: green.
- `pnpm --filter @btcr2-aggregation/web build`: green.
- `pnpm e2e:gate`: all thirteen hermetic legs green. This plan changes a module every `createService` boot resolves its settings through, so the legs were re-run rather than assumed.
- `git diff --stat pnpm-lock.yaml`: empty. No package added.
- `git diff packages/service/src/demo-server.ts`: empty. Every existing `numericKnob` call site unchanged.
- `git diff packages/web/src/lib/cohort-form.ts`: empty. `parseWindow` and `msToMinutesText` untouched (review IN-2 remains recorded and out of scope).
- `git diff packages/service/src/operator-cohorts.ts`: empty. `SIZE_ERROR`, `THRESHOLD_ERROR`, `DISCOVERY_WINDOW_ERROR`, `FUNDING_WINDOW_ERROR` and the ceiling message are byte-identical; this plan makes them true more often, it does not reword them.
- Em-dash scan over all four touched files: no files listed.

## Prohibitions Held

| Prohibition | Held by |
|---|---|
| No change to `numericKnob` behavior for any existing caller | Opt-in trailing parameter defaulting to off; empty `demo-server.ts` diff; two call-site pins including the `PORT`-shaped minimum of 0 |
| Must not refuse to boot on a malformed seed | Every hostile seed constructs a working holder; the derived rows boot a real `createService`; the warn-and-fall-back branch is shared with the NaN path |
| No persistence, config file, or new env var | Source-level absence pin in the existing block still green; no new key in `RuntimeSettingsSeed`; DEPLOY documents no new variable |
| No change to `parseWindow` or `msToMinutesText` | `git diff packages/web/src/lib/cohort-form.ts` empty; the web change is test-only |
| Must not loosen `applySettings` to accept what the holder stores | `validateWindow` got STRICTER (the modulo); the holder moved to the validator's standard |
| No operator-facing error string changed | `git diff packages/service/src/operator-cohorts.ts` empty; the two window constants are asserted against in the new save-refusal row |
| No package added | `git diff --stat pnpm-lock.yaml` empty |

## Deviations from Plan

None - plan executed exactly as written. The action's contingency ("check whether any existing row saves a non-whole-minute window and expects success") was checked: no row anywhere in the repo saved or seeded a non-whole-minute window, so no existing assertion needed updating and no such change is folded into the diff.

## Issues Encountered

None.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required. Operators who currently set `COHORT_TTL_MS`, `FUNDING_WINDOW_MS` or `MIN_PARTICIPANTS` to a non-whole-minute or fractional value will now see a boot warning naming both numbers where previously the value passed silently and wedged the settings surface; no action is required beyond reading it, and the documented compose defaults are unaffected.

## Self-Check: PASSED

- `packages/service/src/runtime-settings.ts` - FOUND
- `packages/service/tests/runtime-settings.spec.ts` - FOUND
- `packages/web/tests/cohort-form.spec.ts` - FOUND
- `docs/DEPLOY.md` - FOUND
- Commit `dcc26b1` - FOUND
- Commit `14342ec` - FOUND
- All plan `<verification>` commands re-run: `pnpm test` 1215 green, `pnpm lint` green, web build green, `e2e:gate` thirteen legs green, all three must-be-empty diffs empty.

## Next Phase Readiness

Plan 30 of 30 complete. This closes the third gap-closure round (05-28, 05-29, 05-30) and the last outstanding item from `05-VERIFICATION.md`. Phase 05 is ready for re-verification.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-02*
