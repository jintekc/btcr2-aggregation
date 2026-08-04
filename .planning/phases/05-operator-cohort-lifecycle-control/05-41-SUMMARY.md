---
phase: 05-operator-cohort-lifecycle-control
plan: 41
subsystem: service
tags: [runtime-settings, refused-seeds, settings-body-budget, gap-closure, in-12, in-13, in-14]
status: complete
requires:
  - "05-37 (the corrected console caption REFUSED_SEEDS, which is the fixed point these boot warnings move toward)"
  - "05-38 (the cap-pair derivation settingsBodyLimitBytes, whose two descriptions this plan brings up to date)"
  - "05-35 (droppedSeeds, the served record of a refusal the caption reads)"
provides:
  - "two textKnob consequence clauses stating the cost, then the in-session repair, then the environment edit, in the console caption's own order"
  - "ordering rows per refused field asserting the repair order by position rather than by sentence"
  - "two DEPLOY.md environment rows carrying the same split, so all three statements of one fact agree"
  - "a settings-route comment naming settingsBodyLimitBytes and BOTH string caps"
  - "a settingsBodyLimitBytes docstring stating which length the budget charges, with the alternative not taken named"
  - "three rows measuring the documented trimmed-versus-transmitted gap"
affects:
  - packages/service/src/runtime-settings.ts
  - packages/service/tests/runtime-settings.spec.ts
  - packages/service/src/hono-adapter.ts
  - docs/DEPLOY.md
tech-stack:
  added: []
  patterns:
    - "when a plan corrects a statement of fact, the first question is how many statements of that fact exist; a repo-wide search for the corrected claim costs one command and is the difference between fixing a sentence and fixing a fact"
    - "a comment that enumerates a derivation's inputs goes stale the moment the derivation grows a term, because nothing links them; name the derivation function as well as its parts"
    - "a documented exception to a module's own stated rule needs a measurement, not a rationale: a row that fails when the gap closes is what makes the docstring's claim checkable"
key-files:
  created: []
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/tests/runtime-settings.spec.ts
    - packages/service/src/hono-adapter.ts
    - docs/DEPLOY.md
decisions:
  - "The console caption was the fixed point and the boot warnings moved to it, not the reverse. The caption is the statement round 6 corrected against the finding, so re-opening it would have re-litigated a decision already taken; SettingsView.tsx is unedited and that is an acceptance criterion, not an omission."
  - "The two consequence clauses stay DIFFERENT sentences and the two remedies stay different, exactly as REFUSED_SEEDS keeps them. Dropping the display name loses a label; dropping the participation terms turns the SVC-05 acceptance gate off, so borrowing either wording would overstate one loss or hide the one that matters. A row pins the difference so a later edit cannot quietly fuse them."
  - "The ordering rows assert by POSITION inside the composed warning (indexOf the in-session repair versus indexOf the environment edit), never by matching a whole sentence. A later rewording that preserves the order stays green; one that demotes or drops the in-session repair does not. The rows also check both positions are found at all, because an ordering comparison between two -1s is vacuously true."
  - "The boot warnings say 'in the operator settings surface' where the caption says 'below'. The caption sits under the field it names; boot output has no such context, so the same repair needs a name the reader can act on rather than a direction."
  - "IN-14 is CLOSED AS DOCUMENTED, not fixed. The budget charges the STORED (trimmed) length while the route enforces the transmitted body, so a value padded with enough whitespace is legal to the holder and refused 413. The alternative (bound the JSON string field before trimming) is named in the docstring and rejected as disproportionate: the console cannot produce such a body, every previous budget had the property including the 4 KiB one, it fails closed, and charging the untrimmed length would stop the budget being a function of the caps alone."
  - "The DEPLOY.md SERVICE_NAME row's runtime-editable sentence was folded INTO the repair rather than left trailing after it. Both rows already ended by saying the value is runtime-editable, which is why they were incomplete rather than false; appending a second clause after a sentence that has already said something narrower would have left the narrower claim standing."
  - "`.planning/REQUIREMENTS.md` was deliberately not touched: all four Phase 5 rows already read `Gaps Found`, which is the status this round leaves them in, and the owner scoped traceability edits out of the round."
metrics:
  duration: 14 min
  completed: 2026-08-04
actuals:
  tokens: 58000
  tasks: 2
  commits: 2
---

# Phase 05 Plan 41: One Fact, Three Statements Summary

Every statement this service makes about a refused boot seed now names the in-session repair before the environment edit, and both descriptions of the settings body budget describe the budget that actually shipped.

## What Was Built

### Task 1: a refused boot seed reads the same way in three places (IN-13) - `65a05f4`

The two `consequence` clauses passed to `textKnob` in `packages/service/src/runtime-settings.ts` were rewritten to state the cost and then BOTH repairs, in the order `REFUSED_SEEDS` already uses on the console caption: the in-session repair first, because it is what the operator can do while reading, and the environment edit second, because it is what stops the refusal happening again at the next boot.

The two composed boot lines now read:

```
ignoring SERVICE_NAME: 5000 characters exceeds the 200 character maximum this service stores;
the display name stays unset. Set the service name in the operator settings surface to restore
it for this session, and shorten SERVICE_NAME so a restart keeps it
```

```
ignoring TERMS_TEXT: 100000 characters exceeds the 20000 character maximum this service stores;
the join flow has no terms step at all, so this service refuses every acceptance. Set the
participation terms in the operator settings surface to restore the acceptance step for this
session, and shorten TERMS_TEXT so a restart keeps it
```

Each clause composes with `textKnob`'s existing prefix rather than repeating it: the prefix already names the variable, the supplied length and the stored ceiling, so the consequence does not re-explain the measurement. A comment beside the two call sites links these clauses to the console caption and cites review IN-13 and WR-10, so the next reader finds the two statements linked rather than discovering their divergence a third time.

`docs/DEPLOY.md` lines 510 and 516 carry the same split. Both rows previously ended by saying the value is runtime-editable, which is why they were incomplete rather than false; the repair is now stated where the sentence used to claim shortening was what brought the value back.

Six rows landed in `packages/service/tests/runtime-settings.spec.ts`, extending the shipped refused-seed block: an ordering row per field (asserting the in-session repair's position is before the environment edit's, with both required to be found), a measurement-preserved row per field (the variable, the supplied length and the ceiling all still present), the different-sentences row (the terms line names the acceptance gate, the name line does not), and the within-cap control (no warning at all and no dropped name).

`packages/web/src/components/operator/SettingsView.tsx` is unedited: `git diff --stat` on it is empty.

### Task 2: the budget's two descriptions describe the budget that shipped (IN-12, IN-14) - `c17cc3d`

The settings route's comment in `packages/service/src/hono-adapter.ts` no longer says the budget "is computed from `MAX_TERMS_CHARS`". It now names `settingsBodyLimitBytes` and BOTH string caps it carries, with the reason stated: the console posts the whole form on every save (D-12), so the largest legal body carries both fields at their cap, and a budget naming only one of them stops bounding the other the moment its cap moves. Every other sentence survives, in particular the measured account of the wedge the derived budget closed and the statement that the bound moved rather than being removed. The `bodyLimit` call is untouched: `git diff packages/service/src/hono-adapter.ts` filtered to non-comment lines is empty.

`settingsBodyLimitBytes`'s docstring gained two paragraphs. The first states which length the budget charges (the STORED length, what `applySettings` keeps once `trimToUndefined` has run) against what the route enforces (the TRANSMITTED body, during streaming), says the two differ only for a value padded with enough surrounding whitespace, and names the row that measures it. The second names the alternative not taken (bound the JSON string field before trimming) and why the decision is proportionate: the console cannot produce such a body, every previous budget had the same property including the 4 KiB one, the failure is a 413 rather than a wrong stored value so it fails closed, and charging the untrimmed length would stop the budget being a function of the caps alone.

Three rows landed in the measurement block, reusing its `encodedBodyBytes` helper: the holder accepts a value at the cap padded with 200000 spaces on each side and stores it at exactly the cap with no warning; that same value's transmitted body exceeds the budget; and the unpadded control sits well inside it.

## Verification

| Check | Result |
|---|---|
| `pnpm test` | 68 files, **1348 tests**, green (round baseline 68 files / 1304 tests; 05-39 left it at 1320, 05-40 at 1339, so +9 rows here and nothing removed) |
| `pnpm lint` | green |
| `pnpm typecheck` | green (`tsc -b`) |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:gate` | green, exit 0, all **13** hermetic legs passed |
| `git diff --stat pnpm-lock.yaml` | empty |
| `packages/web/src/components/operator/SettingsView.tsx` | unedited |
| `.planning/REQUIREMENTS.md`, `05-UAT.md` | unedited |
| em-dash sweep over all four touched files | no files listed |

### Mutation 1 (Task 1): restore one consequence to its shipped wording

Restoring `serviceName`'s clause to `'the display name is left unset until the value is shortened'`:

```
× names the in-session repair BEFORE the environment edit for a refused SERVICE_NAME
FAIL ... AssertionError: expected -1 to be greater than -1
      Tests  1 failed | 106 passed (107)
```

Exactly one row red, and it is the SERVICE_NAME ordering row: the TERMS_TEXT ordering row stayed green, which is what proves the two fields are pinned independently. Restored, re-run green at 107 passed.

### Mutation 2 (Task 2): shrink the padding until the body fits

Reducing `PADDING` from 200000 spaces to 100:

```
FAIL ... the budget charges the trimmed length ... > and a body the ROUTE refuses:
the transmitted form exceeds the budget
AssertionError: expected 20369 to be greater than 122224
      Tests  1 failed | 109 passed (110)
```

The row measures the gap rather than restating the arithmetic: with the padding gone, the trimmed and transmitted lengths agree and the body fits. Restored, re-run green at 110 passed.

### Which row was red before its change, and which only became load-bearing after

The Task 1 ordering rows were **RED before the implementation** (both, plus the different-sentences row's acceptance clause: 3 failed / 104 passed). They are the rows that closed IN-13.

The Task 1 measurement-preserved rows were **GREEN when written**, because they pin the prefix, which this plan does not change. They exist as regression guards on what the split must not cost.

The Task 2 rows were **GREEN when written, before the docstring changed**, and this was expected and recorded rather than treated as a pass: IN-14 documents a gap that already exists, so the row's job is to pin it, not to close it. The docstring is what made the gap a decision; the row is what makes the docstring's claim checkable. Its load-bearing character is proven by mutation 2 rather than by an initial RED.

## Deviations from Plan

None. The plan executed exactly as written.

## Round close-out

**The nine review findings this seventh gap round closed, by id**, for the next verification pass to check off against `05-REVIEW.md` directly:

| Finding | Severity | Closed by |
|---|---|---|
| CR-03 | critical | 05-39 |
| WR-11 | warning | 05-39 |
| IN-11 | info | 05-39 |
| WR-12 | warning | 05-40 |
| IN-09 | info | 05-40 |
| IN-10 | info | 05-40 |
| IN-12 | info | 05-41 |
| IN-13 | info | 05-41 |
| IN-14 | info | 05-41 (documented and measured, not closed by a code change; see the decision above) |

**Human items:** the 16 pending items in `05-UAT.md` are unchanged in count by this round. None was added and none was closed. The file is unedited.

**Traceability:** `.planning/REQUIREMENTS.md` was deliberately not touched. All four Phase 5 rows (SVC-04, SVC-05, PART-05, PART-06) already read `Gaps Found`, which is correct while this round is open and is the status this round leaves them in. The owner scoped traceability edits out of the round, and this is the fourth round in which prematurely marking those rows Complete was the failure to avoid.

**Still outstanding for the phase:** the owner's `05-UAT.md` walk (16 items) and `/gsd-secure-phase 5`.

## Deliberately not done

No cap moved, no arithmetic changed, no refusal string changed, no validation branch changed. The `bodyLimit` call is unedited. `numericKnob`'s bare coercion (review IN-01) sits in this plan's own file and stays untouched by owner decision. Review WR-03, WR-04, WR-05 and IN-02 stay recorded and out of scope, as do the earlier carried findings (the endpoint verdict cache never cleared, `tx-client.ts`'s missing `AbortSignal.timeout`, the unbounded `verdictCache` module singleton, the `/cas` prototype-pollution 500, the test-peer seat cap) and the deferred advert-slot-on-fill item, which stays with Phase 6 and `deferred-items.md`. No package was added.

## Self-Check: PASSED

- `packages/service/src/runtime-settings.ts` FOUND, both consequence clauses carry the in-session repair before the environment edit, `settingsBodyLimitBytes` docstring carries the charged-length decision.
- `packages/service/tests/runtime-settings.spec.ts` FOUND, 110 rows green, contains the `REFUSED_SEED_LINES` ordering table and the `the budget charges the trimmed length` block.
- `packages/service/src/hono-adapter.ts` FOUND, comment names `settingsBodyLimitBytes` and both caps; non-comment diff empty.
- `docs/DEPLOY.md` FOUND, both environment rows carry the split.
- Commit `65a05f4` FOUND.
- Commit `c17cc3d` FOUND.
