---
phase: 05-operator-cohort-lifecycle-control
plan: 35
subsystem: api
tags: [runtime-settings, operator-console, provenance, honest-copy, boot-seeds]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the per-service runtime settings holder (05-04/05-07), textKnob's drop-not-truncate free-text seed bound (05-31), and the derived settings body budget plus the holder as the single name path (05-33)"
provides:
  - "droppedSeeds on SettingsSnapshot: the environment variable NAMES whose boot seeds this service refused, served only on the gated settings read, copied fresh per read"
  - "SettingsFieldKey, the structurally derived type naming the seven value-carrying snapshot members, so the settings labels and the operator-actions loop keep iterating exactly the settings"
  - "the third source caption on the settings surface: a bad-tone line naming the refused variable and what the refusal cost that field"
  - "the pin that a refused field can never render the environment-default caption again"
  - "an E8 design contract that names three caption formats, and a backstop for the rendered caption at a real viewport"
affects: [phase-06]

actuals:
  tokens: 96000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A caption is a fact the SERVICE reported: when the service refused something the environment supplied, refusing quietly and captioning the absence as the environment's own choice is a larger lie than getting the value wrong, because it removes the operator's reason to look"
    - "A disclosure added for honesty carries the variable NAME and never the refused value, so it cannot become a disclosure of something the operator did not mean to serve"
    - "A fallback that turns an ENFORCEMENT CONTROL off is a different kind of event from a fallback to a default value, and needs a disclosure sized to that difference"
    - "When a fix changes what a service STORES, the next question is what the surface that renders the stored value now says: a field that became undefined for a NEW reason renders identically to one that was always undefined"

key-files:
  created: []
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/tests/runtime-settings.spec.ts
    - packages/service/tests/lifecycle-routes.spec.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/components/operator/SettingsView.tsx
    - packages/web/tests/settings.spec.ts
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UI-SPEC.md

key-decisions:
  - "The refusal record carries environment variable NAMES only, asserted against the SERIALIZED snapshot rather than against the field, so a future carrier that stashed the refused text under some other key fails the row rather than passing a field-level check."
  - "It rides the gated GET /v1/operator/settings and nothing else. The anonymous GET /v1/config body is pinned byte-identical to a service that refused nothing, by an exact toEqual against a second real app rather than by a key-set check."
  - "The NUMERIC seeds deliberately do NOT join this disclosure in this round, and the reason is written at the collector: a malformed numeric seed falls back to a value the operator can SEE on the same screen and correct in the same form, where a refused terms seed falls back to an ABSENCE that turns the SVC-05 acceptance gate off; and numericKnob is also called for PORT and the runner knobs, which are not settings and have no place in a settings DTO."
  - "A refused seed is NOT filed in the operator-actions ring, pinned by a row asserting the log is empty after such a boot. That ring is session-scoped and signOut clears it, so a pre-session boot fact filed there would be misattributed to whoever signed in first and lost at their sign-out."
  - "Precedence against the changed bit: a field the operator has ALREADY changed this session takes the existing changed caption, because it holds a value they chose and the refusal is history about a boot value nothing on screen renders any more. Stated in the helper docstring and pinned by a row, because the opposite choice is defensible."
  - "The two cost clauses are different sentences. Dropping the display name loses a label; dropping the terms turns an enforcement control off, and the caption says so rather than borrowing the smaller field's wording."
  - "SettingsFieldKey is DERIVED structurally from the snapshot rather than listed, so a future SettingField member joins the label record automatically (and fails to compile until it is labeled) while a future non-field member does not."

patterns-established:
  - "Provenance-beside-value on a served snapshot: a member that is not a setting but a fact about how a setting got its value, typed apart from the settings so every consumer that walks 'the settings' keeps walking exactly those"
  - "Pin the CAPTION, not the data: where the defect was a surface saying a false thing about correct data, the assertion is taken against what the component renders"

requirements-completed: [SVC-05, SVC-04]

coverage:
  - id: D1
    description: "A boot seed this service refused is carried by NAME on the gated settings read, end to end from a real createService boot, with the field itself still honestly empty (review WR-07)"
    requirement: SVC-04
    verification:
      - kind: integration
        ref: "packages/service/tests/runtime-settings.spec.ts#carries the refused TERMS_TEXT by NAME on the snapshot of a real boot, with the field still unset"
        status: pass
      - kind: integration
        ref: "packages/service/tests/lifecycle-routes.spec.ts#carries the refused variable NAME on an authenticated operator read"
        status: pass
    human_judgment: false
  - id: D2
    description: "The record is a list of what happened rather than a flag for the last thing that happened, and it records nothing for a clean boot or for seeds exactly at their ceilings"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#records BOTH refused seeds, so the record is a list of what happened and not a last-one-wins flag"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#records nothing for a clean boot, and nothing for seeds sitting exactly AT their ceilings"
        status: pass
    human_judgment: false
  - id: D3
    description: "The disclosure carries NAMES only and stays behind the operator gate: no part of a refused seed appears in the served snapshot, and the anonymous config body is byte-identical to a service that refused nothing"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#carries NAMES only: no part of a refused seed appears anywhere in the served snapshot"
        status: pass
      - kind: integration
        ref: "packages/service/tests/lifecycle-routes.spec.ts#adds NOTHING to the anonymous GET /v1/config, key for key or byte for byte"
        status: pass
    human_judgment: false
  - id: D4
    description: "The served record is a fresh copy per read, so a caller cannot reshape this service's settings through a DTO it was handed"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#serves a FRESH copy of the record on every read, like every other member of this snapshot"
        status: pass
    human_judgment: false
  - id: D5
    description: "The settings-label type narrowing is a narrowing of a TYPE and not of BEHAVIOR: a boot refusal records no operator action, and a later save still records exactly the settings whose values moved"
    requirement: SVC-04
    verification:
      - kind: integration
        ref: "packages/service/tests/lifecycle-routes.spec.ts#records nothing in the operator-actions log, and a later save still records what moved"
        status: pass
      - kind: other
        ref: "pnpm typecheck with SETTING_LABELS and the recordSettingsChanges loop keyed on SettingsFieldKey"
        status: pass
    human_judgment: false
  - id: D6
    description: "A field whose seed was refused renders a caption naming the environment variable and what the refusal cost, and can never render the environment-default caption (the review's pin)"
    requirement: SVC-05
    verification:
      - kind: unit
        ref: "packages/web/tests/settings.spec.ts#THE PIN: a field whose seed was refused can never render the environment-default caption"
        status: pass
      - kind: unit
        ref: "packages/web/tests/settings.spec.ts#names the refused VARIABLE and what the refusal COST, for each of the two free-text fields"
        status: pass
    human_judgment: false
  - id: D7
    description: "The two existing caption formats are untouched: an unrefused field renders exactly what it renders today, a changed field keeps its changed caption, a service serving no list reads as none refused, and nothing renders before a snapshot lands"
    requirement: SVC-05
    verification:
      - kind: unit
        ref: "packages/web/tests/settings.spec.ts#leaves a field NOT in the refused list rendering exactly what it renders today"
        status: pass
      - kind: unit
        ref: "packages/web/tests/settings.spec.ts#gives a field the operator has CHANGED this session its changed caption, refusal or not"
        status: pass
      - kind: unit
        ref: "packages/web/tests/settings.spec.ts#reads a service that serves NO refused list as none refused, never as unknown"
        status: pass
      - kind: unit
        ref: "packages/web/tests/settings.spec.ts#still renders NOTHING before a snapshot has landed, refused list or not"
        status: pass
    human_judgment: false
  - id: D8
    description: "The E8 design contract names three caption formats and carries the rendered-caption backstop, with the resolved counts moved to match"
    requirement: SVC-05
    verification: []
    human_judgment: true
    rationale: "Whether the amended contract row describes the landed component usefully, and whether the bad-tone caption reads as a warning at a real viewport rather than as another grey caption, are both judgments no static render can make. The backstop is RECORDED here, not closed."

duration: 13 min
completed: 2026-08-03
status: complete
---

# Phase 05 Plan 35: Disclose the Boot Seeds This Service Refused Summary

**A free-text boot seed this service refuses as too long is now carried by NAME on the gated settings read and captioned on the field it cost, so the settings surface stops telling an operator that their environment set nothing when their environment set a hundred thousand characters of participation terms.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-03T18:50:16Z
- **Completed:** 2026-08-03T19:03:46Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- **WR-07 closed at the service.** `SettingsSnapshot` carries `droppedSeeds`, a readonly array of the environment variable NAMES whose seeds `textKnob` refused at boot, populated on the same branch that already warns so the boot line and the served record can never disagree. It is copied fresh on every read, exactly as `project` returns fresh field objects.
- **NAMES only, and behind the gate.** The refused VALUE is carried nowhere: the rule is stated in the docstring as a rule (citing `recordSettingsChanges`'s existing precedent for logging field names rather than values) and pinned by a row asserting against the SERIALIZED snapshot rather than the field. No route changed: the gated `GET /v1/operator/settings` already serves `snapshot()` whole from inside the same-origin plus operator block, and the anonymous `GET /v1/config` body is pinned byte-identical to a second real app that refused nothing.
- **The compile break was closed by naming the distinction.** `SettingsFieldKey` is derived structurally from the snapshot and names the seven value-carrying members; `SETTING_LABELS` and the `recordSettingsChanges` loop are keyed on it. Seven of these members are settings and one is provenance about how a setting got its value, and the type says so.
- **The console stopped telling the false fact.** `SettingsView.tsx` gained `REFUSED_SEEDS` (the two free-text fields, their variable, and what a refusal costs each), `droppedSeedCaption`, `droppedSeedFor`, and a bad-tone branch in `SourceCaption`. The terms cost states in words that the join flow has no terms step and every acceptance is refused; the display-name cost says only what it loses. Both existing formats keep their exact wording and conditions.
- **The precedence is on the record.** A field the operator has ALREADY changed this session takes the existing changed caption, because it holds a value they chose. Stated in the helper docstring and pinned by a row, because the opposite is defensible.
- **The design contract describes the surface again.** UI-SPEC E8's populated row names three formats and describes the third by what it DISCLOSES rather than by its wording, the backstops table gained the rendered caption at a real viewport, and the resolved counts moved with it.

## Task Commits

1. **Task 1 (tracer): the refusal record, served behind the gate** - `466516e` (feat)
2. **Task 2: the third source caption and its pin** - `19ad5a6` (feat)
3. **Task 3: the design contract, and the round's gate** - `907d248` (docs)

## Files Created/Modified

- `packages/service/src/runtime-settings.ts` - `droppedSeeds` on `SettingsSnapshot` with the names-only rule stated as a rule, the exported `SettingsFieldKey`, the collector parameter on `textKnob` with the reason `numericKnob` does not feed it, both seed sites wired, the fresh copy in `snapshot()`
- `packages/service/src/hono-adapter.ts` - `SETTING_LABELS` and the `recordSettingsChanges` loop keyed on `SettingsFieldKey`, with the reason in the docstring
- `packages/service/tests/runtime-settings.spec.ts` - five new rows in the 05-31 over-long-seed block, plus the reshaped `snapshot()` key-set row
- `packages/service/tests/lifecycle-routes.spec.ts` - the reshaped served-key-set row, an optional settings seed on `lifecycleApp`, and a three-row block covering the gated read, the untouched public config and the silent operator-actions log
- `packages/web/src/lib/operator.ts` - the optional additive `droppedSeeds` on `SettingsSnapshotDTO`, documenting that an absent list means none refused and never unknown
- `packages/web/src/components/operator/SettingsView.tsx` - `RefusedSeed`, `REFUSED_SEEDS`, `droppedSeedCaption`, `droppedSeedFor`, the exported `SourceCaption` with its bad-tone branch, and the two call sites that can carry a refusal
- `packages/web/tests/settings.spec.ts` - the reshaped describe title, six new rows, the em-dash guard converted to an escaped constant
- `.planning/phases/05-operator-cohort-lifecycle-control/05-UI-SPEC.md` - the E8 populated row, one new backstop, the counts sentence

## Decisions Made

See `key-decisions` in the frontmatter. The two the plan required be taken ON THE RECORD rather than left implicit:

- **The numeric seeds do not join this disclosure in this round.** A malformed numeric seed falls back to a value the operator can SEE rendered on the same screen and correct in the same form; a refused terms seed falls back to an ABSENCE indistinguishable from never having set one, and that absence turns the SVC-05 acceptance gate off. Mechanically, `numericKnob` is also called for `PORT` and the runner knobs, which are not settings and have no place in a settings DTO. Carried, with the reason written at the collector so a future reader does not have to find the plan.
- **A refused seed is not filed in the operator-actions log.** That ring is session-scoped and `signOut` clears it, so a pre-session boot fact filed there would be misattributed to whoever signed in first and lost at their sign-out. The served snapshot is read on every visit and survives every sign-out, which is what a boot fact needs. Pinned by a row asserting the log is empty after such a boot.

## Mutations Observed

**Test-first RED, task 1** (the five new holder rows, written and run before any source change):

```
 Test Files  1 failed (1)
      Tests  5 failed | 87 passed (92)
AssertionError: expected '{"serviceName":{"changed":false},"def…' to contain 'TERMS_TEXT'
TypeError: Cannot read properties of undefined (reading 'push')
```

**Mutation 1, task 1: stop populating the record from the terms seed** (`droppedSeeds` at the `TERMS_TEXT` site replaced with a throwaway `[]`). The end-to-end row went RED, and so did four siblings across both spec files:

```
 FAIL  packages/service/tests/runtime-settings.spec.ts > ... > carries the refused TERMS_TEXT by NAME on the snapshot of a real boot, with the field still unset
AssertionError: expected [] to deeply equal [ 'TERMS_TEXT' ]
 FAIL  packages/service/tests/runtime-settings.spec.ts > ... > records BOTH refused seeds, so the record is a list of what happened and not a last-one-wins flag
AssertionError: expected [ 'SERVICE_NAME' ] to deeply equal [ 'SERVICE_NAME', 'TERMS_TEXT' ]
 FAIL  packages/service/tests/lifecycle-routes.spec.ts > ... > carries the refused variable NAME on an authenticated operator read
AssertionError: expected [] to deeply equal [ 'TERMS_TEXT' ]
 Test Files  2 failed (2)
      Tests  5 failed | 147 passed (152)
```

Restored; 152 passed.

**Test-first RED, task 2** (the six new caption rows plus the widened copy row, run before the web source changed): 7 failed, 18 passed.

**Mutation 2, task 2: make the refused branch fall through to the environment-default caption** (`if (dropped && !field.changed)` neutered). The pin, and only the pin, went RED, which is the property it was written for:

```
 FAIL  packages/web/tests/settings.spec.ts > the per-setting source caption has exactly three formats (D-12, UI-SPEC E8) > THE PIN: a field whose seed was refused can never render the environment-default caption
AssertionError: expected '<p class="mt-1 text-xs uppercase trac…' not to contain 'env default'
 Test Files  1 failed (1)
      Tests  1 failed | 24 passed (25)
```

Restored; 25 passed.

## Gate

| Check | Result |
|---|---|
| `pnpm test` | 68 files, **1271 tests** passed (round baseline 68 files / 1234 tests; 05-33 took it to 1247, this plan adds 24) |
| `pnpm lint` | green |
| `pnpm typecheck` | green, with the settings labels and the operator-actions loop keyed on `SettingsFieldKey` |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:gate` | exit 0, 13 legs PASS (run once here for the round, per plan) |
| `git diff --stat pnpm-lock.yaml` | empty |
| em-dash scan over every touched file | none |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] A SECOND exact key-set row over `snapshot()` needed the same reshape**

- **Found during:** Task 1
- **Issue:** The plan named the served-key-set row in `lifecycle-routes.spec.ts` as the one reshape. `runtime-settings.spec.ts` carries a second row of exactly the same kind (`Object.keys(snap).sort()` compared exactly), and it also walks `Object.values(snap)` asserting every member has `envDefault` and `changed`. The new provenance member fails both halves.
- **Fix:** The expected key list gained `droppedSeeds` with a comment marking it a RESHAPE and not a loosening, the exact-equality discipline intact; the field walk now destructures the provenance member off and asserts it separately, so every existing assertion about the seven fields is unchanged and one is added.
- **Files modified:** `packages/service/tests/runtime-settings.spec.ts`
- **Commit:** `466516e`

**2. [Rule 3 - Blocker] `lifecycleApp` could not boot a service that refused a seed**

- **Issue:** The route rows need a real gated app whose holder refused a boot seed, and `lifecycleApp()` hard-codes its `createRuntimeSettings` seed.
- **Fix:** An optional `settingsSeed` parameter spread over the existing seed. Every existing caller passes nothing and gets byte-identically the holder it always got.
- **Files modified:** `packages/service/tests/lifecycle-routes.spec.ts`
- **Commit:** `466516e`

**3. [Rule 3 - Blocker] `packages/web/tests/settings.spec.ts` contained the character it forbids**

- **Found during:** Task 2
- **Issue:** Task 2's acceptance criterion requires the em-dash scan over that file to list nothing. The file's own house-style guard was written with the forbidden character pasted literally into its regex pattern, so the repo-wide scan flagged it. Pre-existing, and exactly the finding 05-22 recorded and fixed in `service-controls.spec.ts`.
- **Fix:** The 05-22 precedent applied verbatim: the character is spelled once as a `\u2014` escape in a documented constant and the guard compares with `toContain`. The comparison is byte-identical, so the assertion did not change meaning.
- **Files modified:** `packages/web/tests/settings.spec.ts`
- **Commit:** `19ad5a6`

**Total deviations:** 3 auto-fixed (3 blockers, 0 bugs, 0 missing-critical). **Impact:** none on behavior. Two are test-harness reshapes that preserve every existing assertion, and one converts a guard to the form the repo already standardized on.

### Tracer feedback gate

Task 1 is the tracer. Its `<verify>` was re-run end to end after its commit (`pnpm vitest run packages/service/tests/runtime-settings.spec.ts packages/service/tests/lifecycle-routes.spec.ts`, 152 passed) before any expansion task began. The plan declares `autonomous: true` and the project runs in yolo mode, so the verified tracer advanced rather than pausing for an interactive checkpoint.

## Issues Encountered

- The escaped-dash constant was first written with the literal character pasted in, which would have re-created the very defect it fixes. Caught by re-running the repo-wide scan immediately after the edit and rewritten as the escape. The scan over that file now returns nothing.

## Known Stubs

None. Nothing in this plan renders a placeholder, hardcodes an empty value, or leaves a surface unwired. The refused-seed caption renders from SERVED data at both call sites that can carry it.

## Threat Flags

None. No new route, no new env var, no new package, no persisted state. The one wire-visible change is an additive member on a read that already sits inside the operator-auth block, and the anonymous config body is pinned unchanged.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **The fifth gap-closure round is complete.** 05-33 (CR-02), 05-34 (WR-06) and 05-35 (WR-07) all landed, and this plan ran the round's `pnpm e2e:gate` as its last act: exit 0, 13 legs.
- **The 16 pending human items in `05-UAT.md` are unchanged by this round.** This plan closes none of them and ADDS one backstop of the same kind (the rendered refused-seed caption at a real viewport), so the next verification pass should count 16 pending UAT items plus 6 UI-SPEC backstops rather than infer a change.
- **Carried, on the record, not skipped:** the numeric seeds keep their existing `env default` caption when a malformed seed falls back (reason recorded at the collector and in the threat register as T-05-35-05).
- **Still out of scope by owner decision and still recorded:** review WR-03, WR-04, WR-05, IN-01, IN-02, the endpoint verdict cache that is never cleared, `tx-client.ts`'s missing `AbortSignal.timeout`, the unbounded `verdictCache` singleton, the `/cas` prototype-pollution 500, the test-peer seat cap, and the deferred advert-slot-on-fill item (Phase 6 / `deferred-items.md`).
- **Phase 5 still needs `/gsd-secure-phase 5`** before Phase 6: no `05-SECURITY.md` exists yet.

## Self-Check: PASSED

- `packages/service/src/runtime-settings.ts` FOUND, `grep -c droppedSeeds` returns 8 (criterion: at least 4)
- `packages/service/src/hono-adapter.ts`, `packages/web/src/lib/operator.ts`, `packages/web/src/components/operator/SettingsView.tsx` FOUND and modified
- `packages/service/tests/runtime-settings.spec.ts`, `packages/service/tests/lifecycle-routes.spec.ts`, `packages/web/tests/settings.spec.ts` FOUND and modified
- `.planning/phases/05-operator-cohort-lifecycle-control/05-UI-SPEC.md` FOUND, diff touches only the E8 populated row, the backstops table and the counts sentence
- Commits FOUND: `466516e`, `19ad5a6`, `907d248`
- Every acceptance criterion across the three tasks re-run and passing; both required mutations observed RED and restored

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-03*
