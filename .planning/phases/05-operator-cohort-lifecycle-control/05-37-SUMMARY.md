---
phase: 05-operator-cohort-lifecycle-control
plan: 37
subsystem: web
tags: [operator-console, settings, copy, honesty, gap-closure]
status: complete
requires:
  - "05-35 (the refused-seed disclosure whose copy this plan corrects)"
  - "05-33 (SETTINGS_BODY_LIMIT_BYTES, which is what makes the in-session repair real)"
  - "05-36 (the session-identity sweep this plan lands on top of)"
provides:
  - "a refused-seed record carrying a REMEDY beside its variable and cost"
  - "refusedEnvDefaultText: the environment-default text a refused field supplies to the changed caption"
  - "the pin that neither cost sentence claims a restart is required"
  - "the pin that a changed refused field never claims the environment set nothing"
affects:
  - packages/web/src/components/operator/SettingsView.tsx
  - packages/web/tests/settings.spec.ts
  - .planning/phases/05-operator-cohort-lifecycle-control/05-UI-SPEC.md
tech-stack:
  added: []
  patterns:
    - "a copy constant that names a REMEDY is a claim about another part of the system, so it needs a pin asserted against that part"
    - "assert a no-X property over the narrow member that must not say X, never over the composed sentence whose other half legitimately says it"
    - "a negative assertion is only safe when the absence is itself the property worth holding"
key-files:
  created: []
  modified:
    - packages/web/src/components/operator/SettingsView.tsx
    - packages/web/tests/settings.spec.ts
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UI-SPEC.md
decisions:
  - "Precedence is KEPT and the parenthetical is repaired: a changed field still takes the changed caption, and that caption's environment-default slot now names the refusal. The review permitted either fix; this does the honest half of both."
  - "The cost and the remedy are SEPARATE record members rather than one longer sentence, because one sentence is what let two facts true at different times fuse, and a test over a composed string can only assert substrings."
  - "The remedy names the in-session repair FIRST and the environment edit SECOND: the first is what the operator can do while reading, the second is what stops them meeting the refusal again next boot."
  - "The no-restart pin is asserted over each cost MEMBER, not over the composed caption, whose remedy half legitimately names a restart."
metrics:
  duration: 12 min
  completed: 2026-08-03
actuals:
  tokens: 25800
  tasks: 2
  commits: 3
---

# Phase 05 Plan 37: Refused-Seed Caption Honesty Summary

The two captions this console shows about a boot seed it refused now say things that are true at the moment the operator reads them: each names what the refusal costs right now as one fact and what repairs it as a second fact naming both paths, and a field the operator has since edited no longer claims the environment set nothing.

## What Was Built

### Task 1: the refusal caption names the repair available now (WR-10) - `e1bf176`

`RefusedSeed` gained a third member. A refusal now carries its environment **variable**, what it **costs** while it stands, and what **repairs** it:

| field | cost (what is true right now) | remedy (what fixes it) |
|---|---|---|
| `SERVICE_NAME` | `the display name stays unset` | `Set the service name below to restore it for this session, and shorten SERVICE_NAME so a restart keeps it` |
| `TERMS_TEXT` | `the join flow has no terms step at all, and this service refuses every acceptance` | `Set the participation terms below to restore the acceptance step for this session, and shorten TERMS_TEXT so a restart keeps it` |

Both costs previously ended `until the value is shortened and this service restarts`, which named the slower of two available repairs and implied the faster one did not exist. It does exist: `applySettings` accepts a value up to the holder's own ceiling and, since `SETTINGS_BODY_LIMIT_BYTES` landed in round 5, the route carries it, so the operator can type into the very field the caption sits under, save, and have the setting back in the running session.

`droppedSeedCaption` composes the two as separate sentences, so they cannot fuse back into one clause. The record's docstring now states what the split is for and records the contradiction that made this findable: `SETTINGS_MODEL_LINE`, two cards above the caption on the same screen, tells the operator a restart returns every value to its environment default, so a caption claiming a restart is the remedy told them two opposite things at once.

`SourceCaption` was deliberately left alone in this task.

### Task 2: a changed refused field stops claiming the environment set nothing (IN-05) - `35e213f`

New exported helper beside the two existing environment-default text helpers:

```ts
export function refusedEnvDefaultText(seed: RefusedSeed): string {
  return `refused, see ${seed.variable}`;
}
```

`SourceCaption`'s changed path supplies it in place of the caller's text for a field carrying a refusal. A refused field the operator has edited now reads `changed this session (environment default: refused, see TERMS_TEXT)` instead of `changed this session (environment default: not set)`, which was the same affirmative claim WR-07 was filed about, in a second sentence.

The precedence decision is unchanged and its rationale is corrected. It previously claimed the refusal was history about a boot value nothing on screen rendered; the changed caption renders exactly that boot value, which is how this survived a nine-row spec block. The corrected paragraph states why precedence is kept (the field holds a value the operator chose, and the bad-tone sentence would shout about a value the field no longer carries) and that it is only honest because the slot now names the refusal. `sourceCaption`'s docstring records the widening as a change to what one slot can carry rather than a fourth format.

`05-UI-SPEC.md` amended in exactly two rows: the E8 populated consideration (still three formats, second format's slot documented by what it DISCLOSES rather than by its wording) and the E8 refused-seed backstop (now covering two sentences rather than one). The resolved-counts sentence is unchanged; no row was added.

## Mutation Evidence (both run explicitly, both restored)

**Task 1** - restored a restart-only remedy into the terms cost:

```
FAIL packages/web/tests/settings.spec.ts > ... > THE PIN: neither cost sentence claims a restart is required (review WR-10)
AssertionError: expected 'the join flow has no terms step at al…' not to match /restart/i
+ Received: "the join flow has no terms step at all, and this service refuses every acceptance, until the value is shortened and this service restarts"

 Test Files  1 failed (1)
      Tests  1 failed | 27 passed (28)
```

Only the pin went red. The `serviceName` half of every row stayed green, as did the remedy row, the acceptance-distinction row and the four pre-existing caption-format rows. Restored: `Tests 28 passed (28)`.

**Task 2** - made the changed path fall back to the plain environment-default text:

```
FAIL packages/web/tests/settings.spec.ts > ... > gives a CHANGED field the changed caption whose parenthetical NAMES the refusal (review IN-05)
AssertionError: expected '<p class="mt-1 text-xs uppercase trac…' to contain 'TERMS_TEXT'
Received: "<p class="mt-1 text-xs uppercase tracking-[0.14em] text-faint">changed this session (environment default: not set)</p>"

 Test Files  1 failed (1)
      Tests  1 failed | 28 passed (29)
```

The received string is the defect verbatim. Every other caption row stayed green, including the anti-vacuity control. Restored: `Tests 29 passed (29)`.

Task 1's own RED was observed before any source edit: `Tests 3 failed | 25 passed (28)`, the no-restart pin against the shipped copy plus the two remedy rows against a member that did not yet exist.

## Verification

| Gate | Result |
|---|---|
| `pnpm vitest run packages/web/tests/settings.spec.ts` | 29 passed (29) |
| `pnpm test` | 68 files, **1295 tests**, green (05-36 recorded 68 files / 1291 tests; round baseline 68 / 1271) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `grep -rlP '\x{2014}'` over the three files | no files |
| `git diff --stat packages/service` | empty |
| `git diff --stat pnpm-lock.yaml` | empty |
| `git diff --stat 05-UI-SPEC.md` | 2 insertions, 2 deletions (exactly the two named rows) |

`pnpm e2e:gate` was **not** run by this plan and was not skipped silently: no service file changed (the service diff is empty), and the round runs it once at the end of 05-38.

Four tests joined the file (28 -> 29 in the caption block plus the reshapes), so nothing was lowered. The three named reshapes all landed as reshapes: the cost row gained whole-member assertions, the precedence row flipped its refused-variable assertion from absent to present with a comment stating why it was flipped rather than deleted, and the two UI-SPEC rows were amended.

## Deviations from Plan

None. The plan executed as written.

One judgement worth recording rather than a deviation: the precedence-paragraph correction was written into the task-2 commit rather than task 1, even though the docstring it lives in is task 1's subject. The corrected sentence names `refusedEnvDefaultText`, which task 1 does not create, so writing it earlier would have shipped a `{@link}` to a function that did not exist and would have made task 1's commit describe behavior it did not yet have.

## Known Stubs

None.

## Threat Flags

None. No new surface: the change is client-side copy, one text helper, two docstring corrections, test rows and a design-contract amendment. T-05-37-03 (the refusal text must never carry the refused VALUE) holds by construction: both the caption and the new helper are built from the record's `variable`, `cost` and `remedy` members only, none of which is ever a served value. T-05-37-04 holds by the empty service diff.

## Self-Check

- `packages/web/src/components/operator/SettingsView.tsx` - FOUND
- `packages/web/tests/settings.spec.ts` - FOUND
- `.planning/phases/05-operator-cohort-lifecycle-control/05-UI-SPEC.md` - FOUND
- commit `e1bf176` - FOUND
- commit `35e213f` - FOUND

## Self-Check: PASSED
