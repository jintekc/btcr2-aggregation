---
phase: 05-operator-cohort-lifecycle-control
plan: 20
subsystem: operator-console-monitoring
tags: [honesty, chip-taxonomy, metrics, gap-closure, audit-defect-7]
requires:
  - "05-19 (OperatorCohorts.forgetTerminal, dismissDropsReadvertise, ConfirmPanel type-to-confirm)"
  - "05-16 (Service.monitor handle, cohortUsesLivePath funding guard)"
provides:
  - "CohortChip members 'co-signed' and 'co-signed-fallback' (service + web mirror)"
  - "EndedRecord.viaFallback: the script-path tag retained on the ended record"
  - "confirmation-gated promotion inside the beacon-anchored handler"
  - "explicit per-chip classification in serviceMetrics"
  - "CHIP_PRESENTATION, CHIP_KEYS, chipPresentation, ChipPresentation (exported chip presentation)"
affects:
  - "the operator cohort list chips and the metrics row"
  - "e2e/operator-cohort.ts monitoring + test-peers legs"
  - "05-UAT-CHECKLIST.md criterion 1"
tech-stack:
  added: []
  patterns:
    - "exported-presentation-accessor (moves a module-private const into a lib module a spec can read)"
    - "explicit exhaustive switch classification instead of a failed-check plus everything-else branch"
key-files:
  created: []
  modified:
    - packages/service/src/monitor.ts
    - packages/service/tests/monitor.spec.ts
    - packages/service/tests/kill-switch.spec.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/lib/operator-rows.ts
    - packages/web/src/components/operator/OperatorCohortList.tsx
    - packages/web/tests/operator-rows.spec.ts
    - e2e/operator-cohort.ts
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md
decisions:
  - "Two unconfirmed terminals, not one: co-signed for a key-path co-sign and co-signed-fallback for a script-path one, so honest labelling costs no list-level product signal."
  - "The chip presentation moves into packages/web/src/lib/operator-rows.ts as an exported record plus accessor, because a module-private map makes tone and label unassertable in a package with no DOM harness."
  - "No new metrics column in this plan: both new fates count in neither, following the canceled precedent. Widening the metrics row is a 04-UI-SPEC contract change, recorded as a follow-up."
  - "The Phase 4 UI-SPEC tone map is deliberately NOT amended (closed-phase artifact); CHIP_PRESENTATION is now the single live definition."
metrics:
  duration: ~50m
  completed: 2026-07-30
status: complete
---

# Phase 5 Plan 20: Reserve the anchored chip for confirmed anchors Summary

The operator console stopped claiming an on-chain anchor for a co-sign that was never confirmed: two honest unconfirmed terminals (`co-signed` and `co-signed-fallback`) now stand until a CONFIRMED `beacon-anchored` frame promotes them, the anchored counter reports confirmed anchors only, and the chip's tone, label and pulse moved into an exported accessor a spec can actually read.

## What changed

**Gap source:** audit defect 7 (`05-AUDIT.md` entry 9, MEDIUM, honesty), filed as
`.planning/todos/pending/2026-07-29-reserve-the-anchored-chip-for-confirmed-anchors.md`.

`signing-complete` minted an `anchored` chip and an incremented anchored counter in EVERY mode,
because confirmation was never a precondition for either. Three distinct situations read as a
good-tone `Anchored` badge with nothing confirmed behind it:

1. a cohort stood down under the broadcast kill switch (the finder's framing),
2. a beacon tx broadcast on the mainline live path that never confirmed inside the confirm window
   (skeptic 2's broader case, with no health-strip cue at all),
3. every completed cohort on the default hermetic path, where nothing on-chain exists at all.

The drill-down stage timeline already obeyed the rule and says so in its own source; the list chip
and the metrics row did not.

### The completion taxonomy is now a two-by-two

|                    | key path                          | k-of-n script path                             |
|--------------------|-----------------------------------|------------------------------------------------|
| confirmed on-chain | `anchored` (good, counts anchored)| `fallback` (warn, counts anchored)             |
| NOT confirmed      | `co-signed` (neutral, Ended)      | `co-signed-fallback` (warn, Needs attention)   |

Confirmation decides the word, the script path decides the bucket. Only the confirmed pair counts
toward the anchored metric.

### Task 1: the service records what actually happened

- `CohortChip` and the retained ended-chip union gained both members.
- `EndedRecord.viaFallback` carries the script-path fact ON THE RECORD, so a confirmation arriving
  later can read it without depending on the fold entry still being present. Its docstring holds
  the taxonomy table and states plainly why minting `'fallback'` at co-sign time is not the
  shortcut it looks like (`'fallback'` is itself an anchored claim) and why collapsing both
  unconfirmed chips into one is not acceptable either.
- The `signing-complete` handler derives the chip from the SAME tag it stores: one source of truth,
  two values read off it.
- The unconfirmed early return in the `beacon-anchored` handler is unchanged in behavior but is now
  documented as load-bearing rather than merely conservative: it is the only thing deciding which
  ROW of the two-by-two a record sits in.
- `serviceMetrics` classifies every chip in an explicit `switch` rather than a failed-check plus an
  everything-else branch, so a future terminal fate cannot fall into a column by default. That
  default branch is exactly how this defect arose.
- The `detail` projection's `fallback.used` derivation and the broadcast-failed override are
  untouched.

### Task 2: the presentation became assertable, and every pin migrated

- `packages/web/src/lib/operator.ts` mirrors both new keys.
- The tone map MOVED out of the module-private `CHIP` const in `OperatorCohortList.tsx` into an
  exported `CHIP_PRESENTATION` (a `Record<ChipKey, ChipPresentation>`), `CHIP_KEYS` derived from
  that record's own keys, and a `chipPresentation(chip)` accessor that `StatusChip` consumes.
  Existing entries moved byte-for-byte with their comments; the private map is gone rather than
  shadowed, so exactly one definition exists in the package.
- `'co-signed'` renders neutral, non-pulsing, labelled `Signed` (the word the participant surface
  already uses for this state: its anchor lifecycle runs Signed -> Broadcast -> Confirmed). The
  label is deliberately NOT `Co-signed`, which sits one character from the live `Co-signing` chip.
- `'co-signed-fallback'` renders warn-toned, non-pulsing, labelled `Signed via fallback`, and is
  added EXPLICITLY to the attention branch of `groupForChip`, because the fall-through would send
  it to Ended.
- Both hermetic e2e legs poll for `co-signed` and assert the anchored counter is zero, with a
  failure message naming the honesty invariant.
- `05-UAT-CHECKLIST.md` criterion 1 was corrected in place.

## The ONE user-visible consequence, stated plainly

**On the default hermetic path the anchored counter now reads zero permanently, and every completed
key-path cohort appears as a `Signed` row in the Ended group.** That is the honest reading: a
hermetic service co-signs a fixture transaction and anchors nothing. Completions are counted by the
Ended group, not by that column. The metrics row gains no replacement column in this plan (see the
follow-up below).

## What did NOT change, which matters just as much

**A k-of-n script-path cohort keeps its list-level distinction and its Needs-attention bucketing.**
An earlier draft of this plan gave that up on every unconfirmed path (including the shipped
hermetic default) and documented it as an accepted loss. A reviewer pushed back, and the trade was
ENGINEERED AWAY rather than accepted: a second unconfirmed chip costs one more entry in a record
the type checker already forces to be exhaustive, one more `groupForChip` answer and one more spec
row, with no served-DTO widening and no consumer signature change. A later reader of the audit
trail should not go looking for a regression that was not shipped.

The script-path fact also stays reachable per cohort: `detail(id).fallback.used` is untouched and
still true for a hermetic script-path cohort.

## The Phase 4 UI-SPEC tone map is deliberately NOT amended

`04-UI-SPEC.md` is a closed-phase artifact. After this plan the exported `CHIP_PRESENTATION` in
`packages/web/src/lib/operator-rows.ts` is the single LIVE definition of every chip's tone, label
and pulse, which is a better home for it than a historical spec. The unamended Phase 4 spec is
therefore not drift.

The chip set grows from 9 rendered keys to 11. That is more surface for a reader to learn, and it
is why the label-distinctness row runs over the WHOLE set rather than over the new entries only.

## Red-before-green, recorded

**Task 1 (11 rows red against the shipped code):**

| Row | Pre-fix chip | Pre-fix metric |
|-----|--------------|----------------|
| unconfirmed `beacon-anchored` frame (the mainline live case) | `anchored` | `anchored: 1` |
| unconfirmed SCRIPT-PATH co-sign | `fallback` | `anchored: 1` |
| hermetic key-path co-sign | `anchored` | `anchored: 1` |
| stood-down cohort (kill switch, `kill-switch.spec.ts`) | `anchored` | n/a |
| strict-equality metrics row (one key-path + one script-path co-sign, neither published) | n/a | `{ open: 0, inFlight: 0, anchored: 2, failed: 1 }` where the honest value is `anchored: 0` |

**Task 2 (three reds demonstrated by deliberate perturbation, then restored):**

| Perturbation | Row that went red | Observed |
|--------------|-------------------|----------|
| `'co-signed': { tone: 'good', pulse: true }` | the tone row | `Expected: "neutral" / Received: "good"` |
| `'co-signed'` labelled `'Co-signing'` | the whole-set label-distinctness row | `new Set(labels).size` fell below `CHIP_KEYS.length` |
| `co-signed-fallback` removed from the attention branch | the four-way grouping row | `Expected: "attention" / Received: "ended"` |

## The intermediate red this plan knowingly carried

**No commit inside this plan is independently green, and nobody should bisect to one and conclude
the migration broke the gate.** At Task 1's commit boundary (`b5856b1`) the service had stopped
minting `anchored` for an unconfirmed co-sign while the web mirror and the `e2e/operator-cohort.ts`
chip union were still on the old taxonomy, so `pnpm e2e:operator` would have polled for a state
that never arrives. Task 1's automated chain deliberately ran the service specs plus `pnpm
typecheck` only. Task 2 (`1589900`) closed it, and the full `pnpm e2e:gate` ran green there.

## Residual exposure of the presentation pins

Same ceiling `05-19-PLAN.md` records for its source reads. `grep -c '^const CHIP'` returning 0 plus
two `chipPresentation` references in the component is as strong as this repo gets without a DOM
harness. What IS verified: exactly one definition exists, it is exported, its values are asserted,
and the component reads it. What is NOT verified: that the rendered badge uses the returned tone. A
`StatusChip` that called `chipPresentation(chip)` and then hard-coded a tone on `Badge` would still
pass. This must not be reported as "the rendered tone is verified".

### Correction, 2026-07-30 (05-23, from `05-AUDIT-2.md` entry 15)

**"Its values are asserted" above, and `05-20-PLAN.md:33`'s stronger claim that the tone, pulse AND
label of every chip are "ASSERTED, not eyeballed", were both too broad about the LABEL.** What this
plan actually shipped:

- **Tone and pulse: asserted per chip**, by exact equality, on the chips this plan touched plus the
  moved-unchanged row. That half of the claim stands.
- **Labels: pinned only as a distinct SET**, plus truthiness and a long-dash guard
  (`packages/web/tests/operator-rows.spec.ts`, the `gives every chip its OWN label` row). No row
  asserted what any chip SAYS.

The consequence is the exact defect this plan was written to close. Relabelling `co-signed` from
`Signed` to `Anchored (co-signed)` keeps the set distinct, keeps the tone neutral, keeps the dot
still and carries no long dash, so it shipped green: an unconfirmed co-sign could still claim an
on-chain anchor. `05-20-PLAN.md:257`'s "the labels are pinned distinct" is accurate; line 33's
"label ... ASSERTED" is what overstated it.

**Closed in 05-23**, which adds an exact per-chip label table (retyped literals, typed as
`Record<ChipKey, string>` so a new chip without an expected label is a compile error) plus an
independent anchor-wording guard on the three unconfirmed or in-flight chips and a positive
assertion on `anchored`. The original text above and in `05-20-PLAN.md` is left as written; this
note is the correction.

## Bounding assertions, each identified as a non-regression guard rather than defect coverage

- `monitor.detail(id).fallback.used` is still true for a hermetic script-path cohort. This half was
  true before AND after the change; the test comment says so, so nobody later mistakes it for
  defect coverage. Its job is to guard the untouched drill-down derivation.
- ONE `operator-rows.spec.ts` row pins all four terminal groupings together, so the tempting
  "simplify the two unconfirmed chips into one" refactor turns it red.
- The shipped k-of-n monitor row was migrated IN PLACE to `co-signed-fallback` with `anchored: 0`,
  never to plain `co-signed`. That migration target was fixed by prohibition because migrating it
  to `co-signed` is the one edit that would erase the operator's list-level fallback signal while
  leaving the suite green.

## Verification

| Gate | Result |
|------|--------|
| `pnpm vitest run` (monitor, kill-switch, lifecycle-routes) | 143 passed |
| `pnpm vitest run` (operator-rows, operator) | 39 passed |
| `pnpm test` | 61 files, 1049 tests passed |
| `pnpm typecheck` | green |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:monitor` | passed, settles on `co-signed` |
| `pnpm e2e:testpeers` | passed, settles on `co-signed` |
| `pnpm e2e:gate` (full, incl. `e2e:fallback` and `e2e:fallback:operator`) | exit 0 |
| `grep -rlP '\x{2014}'` over `packages/web/src`, `e2e`, the checklist | no files |

Acceptance greps: `'co-signed'` 4 and `'co-signed-fallback'` 4 in `monitor.ts` (both >= 3);
`co-signed` present in all three web/e2e files; `chipPresentation` 2 in `operator-rows.ts` and 2 in
`OperatorCohortList.tsx`; `grep -c '^const CHIP' OperatorCohortList.tsx` returns 0.

**Verified rather than assumed:** `e2e/fallback-cohort.ts` asserts no chip and no metric (a single
`anchored` hit, in a narration string), which is why the hermetic script-path leg needed no
migration. `git diff --numstat packages/service/tests/kill-switch.spec.ts` showed 38 insertions and
0 deletions, so 05-16's funding rows, its esplora health-bit disclosure row and the shipped
mode-equality row are all unedited. 05-19's pinned shapes in `OperatorCohortList.tsx` (the guarded
`DISMISS_READVERTISE_LINE` conditional, the verbatim `dismissDropsReadvertise(cohort)` call, the
`ConfirmPanel` element and the discard-draft confirm after it) are untouched, and 05-19's source-read
rows pass.

## Deviations from Plan

None. The plan executed exactly as written, including both prohibited migration targets being
avoided and all five reds (two service, three presentation) demonstrated rather than assumed.

One observation deliberately NOT acted on, because the file is outside `files_modified` and the
round-wide rule in `05-15-PLAN.md` says to stop rather than widen: `e2e/fallback-cohort.ts` line
558 carries a narration string reading "the cohort anchored on the ADR 042 script path". That leg
is hermetic, so the word is now imprecise in the same way the chip was. It is a `console.log`
summary with no assertion behind it, so nothing is certified by it and the gate is unaffected.
Worth a one-line copy fix in a later pass.

## Known Stubs

None. No placeholder values, no unwired data sources, no skipped tests, and no unrun `<verify>`
chain in this plan.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no schema change
at a trust boundary. Every threat in the plan's register (T-05-20-01 through T-05-20-05) is a
spoofing/tampering concern about the console asserting facts it does not have, and each is mitigated
as planned; `T-05-20-SC` is inapplicable (no package install).

## Deliberate follow-up, raised rather than rediscovered

The metrics row now has no column that counts a completed co-sign, so on a hermetic service
completions are visible in the Ended group and nowhere else. Adding a `co-signed` counter alongside
the anchored and failed columns is the natural next step, and both audit skeptics' minimal shape
deliberately did not include one. It is a widening of the `04-UI-SPEC` metrics-row contract plus a
served-DTO addition, which is a product decision rather than a defect fix.

**Raise it with the owner when the next phase is scoped, together with the DOM-harness decision
recorded in `05-19-PLAN.md`.**

A second follow-up that earlier drafts of this plan carried is CLOSED IN THIS PLAN rather than
deferred: restoring the list-level script-path signal on the unconfirmed paths. Do not re-file it.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | `b5856b1` | `fix(05-20): reserve the anchored fate for a confirmed beacon transaction` |
| 2 | `1589900` | `feat(05-20): give the honest co-sign fates an assertable tone and label` |

## Self-Check: PASSED

Every file claimed above exists on disk, and both commit hashes resolve in `git log`.

