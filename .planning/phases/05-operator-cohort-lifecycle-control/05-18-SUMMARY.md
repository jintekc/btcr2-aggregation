---
phase: 05-operator-cohort-lifecycle-control
plan: 18
subsystem: service
tags: [gap-closure, settings, discovery-window, docs, deploy-runbook, svc-04]
status: complete
requires:
  - packages/service/src/operator-cohorts.ts (discoveryWindowCeilingError, the shared refusal string)
  - packages/service/src/index.ts (seeds defaultDiscoveryWindowMs and discoveryWindowCeilingMs from the same cohortTtlMs)
provides:
  - a seed-time discovery-window clamp in createRuntimeSettings, with a loud two-number warning
  - the restored invariant that this service's own discovery default is by construction honorable
  - a DEPLOY.md quick start that ends at a working operator console
  - AUTO_FALLBACK and SSE_DEBUG documented in BOTH the DEPLOY table and the compose file
affects:
  - GET /v1/operator/settings (the env-default caption now names an enforceable window)
  - PUT /v1/operator/settings (a save of an unrelated field can no longer be refused by a boot value)
  - every new draft's inherited discovery window
  - docs/DEPLOY.md, docker-compose.yml, docs/adr/0017-runtime-lifecycle-control.md
tech-stack:
  added: []
  patterns:
    - clamp-the-seed / refuse-the-save, the deliberate asymmetry between inherited and chosen config
    - warn-and-fall-back for every out-of-range boot value (the numericKnob, beacon-type, k-clamp precedent)
    - positional (awk-sliced) doc greps, so a file-wide match cannot certify a section-level defect
key-files:
  created: []
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/tests/runtime-settings.spec.ts
    - docs/DEPLOY.md
    - docker-compose.yml
    - docs/adr/0017-runtime-lifecycle-control.md
decisions:
  - Clamp the boot seed with a loud warning rather than refusing to boot, because every other out-of-range seed in this module warns and falls back, and a typo in a stranger's env file must not become a crash loop.
  - Keep the SAVE path refusing with the maximum named; the asymmetry is documented at the clamp and in ADR 0017 because a save is a value the operator chose and typed.
  - Put the clamp in runtime-settings.ts where the seed and the ceiling are both already resolved, NOT as a boot check in demo-server.ts, so there is one rule that cannot drift.
  - Document serviceDid as a CONDITIONAL key in the /v1/config sample, so correcting a stale sample does not ship a fresh unconditional-shape claim.
metrics:
  duration: ~25 min
  completed: 2026-07-30
  tasks: 2
  commits: 2
  files: 5
---

# Phase 5 Plan 18: Discovery-window seed clamp and runbook truth Summary

One promise about the discovery window, kept on both paths that can set it, plus a
runbook that describes the service that actually ships.

## What was built

Audit defects 5 and 6 (entries 7 and 8, both HIGH) closed as one job: the seed clamp
changes what the code does, and the documentation task then states the resulting rule
correctly in all three places that previously promised something else.

### Task 1: the seed-time ceiling clamp (`c77a219`)

`createRuntimeSettings` now applies `discoveryWindowCeilingMs` to the SEED as well as
to a save. The clamp sits immediately after both numbers are resolved and before the
`field()` calls that freeze `value` and `envDefault`, so an over-ceiling
`DEFAULT_DISCOVERY_WINDOW_MS` becomes the ceiling in both halves of the field rather
than being stored verbatim. It warns through the existing `warn` seam (so the message
rides the same `[settings]` prefix as every other seed warning) and names both the
requested value and the enforced maximum in the ms the operator supplied.

The asymmetry is deliberate and is documented at the clamp, in the seed's docstring,
in `docs/DEPLOY.md`, in the compose comment, and in ADR 0017:

- a runtime SAVE above the ceiling is REFUSED with the real maximum named, unchanged
  from what shipped, because it is an operator's explicit act on a value they typed;
- a boot SEED above the ceiling is CLAMPED with a warning, because boot config is
  often inherited rather than chosen, and every other out-of-range seed in the module
  (the `numericKnob` numerics, the unknown beacon type, the k > n threshold) warns and
  falls back rather than aborting.

Two consequences close by construction. The gated settings read now serves the value
actually in force, so the console's `env default` caption names an enforceable window.
And because `applySettings` re-reads the STORED value for every absent key, an
over-ceiling stored default used to refuse every save as a set, including saves of
fields the operator did touch; with no over-ceiling value storable, the save path has
nothing left to trip over.

No boot check was added to `demo-server.ts`. A second rule at the env layer is a second
rule that can drift from this one.

### Task 2: the runbook, the compose file, and ADR 0017 (`a44c9b9`)

`docs/DEPLOY.md`: the quick start now sets `OPERATOR_PASSWORD` FIRST (with the reason:
empty means fail-closed, and since this service advertises nothing on its own, no
password means no cohort can ever exist), then walks log in at `/operator`, create and
advertise a draft, join from a second tab, and rehearse alone with the test-peer
control under its real shipped label. The removed sentence promised that a lone browser
attendee completes a 2-of-2 cohort against an operator-run co-signer, against a knob no
code path reads. "What you are running" no longer says the coordinator advertises a
cohort, so the two sections stop telling different stories.

Environment reference: the retired filler row deleted; `MIN_PARTICIPANTS` corrected to
what it does now (a fallback seed for a new draft's seat count, overridable per draft,
shadowed by `DEFAULT_SIZE` which the compose file always sets);
`DEFAULT_DISCOVERY_WINDOW_MS` corrected to state the clamp-at-boot and refuse-at-save
rules distinctly; `AUTO_FALLBACK` (behavior-changing: off means a stalled signing round
no longer recovers on its own) and `SSE_DEBUG` added. The `/v1/config` health sample now
carries `serviceDid`, with prose stating that it and the other two additive keys are
spread only when the value exists, and that `serviceDid` is present on every path this
runbook documents. The proxy throttle guidance now names `POST /v1/terms/acceptance`
alongside the tx proxy and artifact routes, since it verifies a signature per request.

`docker-compose.yml`: filler variable deleted, cohort-sizing comment rewritten to
describe seat defaults rather than a completion rule, timing-window comment split into
the two rules, `AUTO_FALLBACK` and `SSE_DEBUG` added in the same commented-and-defaulted
style, and the operator-password comment now points at the quick start.

`docs/adr/0017-runtime-lifecycle-control.md`: the cited spec path corrected to
`packages/service/tests/runtime-settings.spec.ts`, and the ceiling consequence amended
to record both rules and why they differ. The kill-switch consequences that 05-16
amended a wave earlier (the health-strip esplora narrowing) were left exactly as that
plan left them.

## Red before green

### Task 1 (the code half)

Both plan-named rows were observed FAILING against the pre-fix tree, with the exact
pre-fix values the audit reproduced:

| Row | Pre-fix observation |
| --- | --- |
| stores the ceiling as BOTH the current value and the env default | `AssertionError: expected 3600000 to be 1800000` (the seed was stored verbatim) |
| warns loudly, naming both numbers | `expected [] to have a length of 1 but got +0` (no warning at all) |
| a save of an UNRELATED field now succeeds | `expected 'This service ends a cohort after 30 minutes, so the discovery window must be 30 minutes or less.' to be undefined` |

The third row is the one that proves the bricking consequence: the pre-fix refusal
message names the discovery window on a patch that supplied only `serviceName`.
3 failed / 33 passed before the clamp; 36 passed after.

### Task 2 (the documentation half)

The whole chain was run BEFORE the edits. Every clause was red:

- `! grep -rinq 'fillers' docs/ docker-compose.yml`: FAIL, the retired knob was present
  3 times in `docker-compose.yml` and 2 times in `docs/DEPLOY.md`.
- `AUTO_FALLBACK` and `SSE_DEBUG`, one `grep -q` per file: all four FAIL.
- `Fill remaining seats with test peers` in `docs/DEPLOY.md`: FAIL.
- `serviceDid` in `docs/DEPLOY.md`: FAIL.
- `packages/service/tests/runtime-settings.spec.ts` in ADR 0017: FAIL.

### The two POSITIONAL quick-start clauses (recorded separately)

These are the only mechanical guard on defect 6's core symptom, a stranger stranded at
the end of the quick start, and they replace a trap. The file-wide
`grep -q 'OPERATOR_PASSWORD' docs/DEPLOY.md` was ALREADY GREEN before this task ran
(2 occurrences: the `LIVE`/`BROADCAST` block at :70 and the env table at :457), so it
proved nothing about the quick start. Both awk-sliced clauses were red pre-edit:

- `awk '/^## Quick start/{f=1;next} /^## /{f=0} f' docs/DEPLOY.md | grep -q 'OPERATOR_PASSWORD'`: FAIL
- the same slice `| grep -q '/operator'`: FAIL

Both are green post-edit, and the section kept its `## Quick start` heading prefix so
the clauses keep measuring the right block.

## Verification

| Check | Result |
| --- | --- |
| `pnpm vitest run runtime-settings.spec.ts discovery-window.spec.ts draft-edit.spec.ts` | 79 passed |
| `pnpm typecheck` | green |
| the full Task 2 grep chain plus `pnpm lint` | green |
| `grep -rlP '\x{2014}' docs/ docker-compose.yml` (em-dash scan) | no files |
| `pnpm test` | 61 files / 1013 tests passed |
| `pnpm lint` | green |
| `pnpm e2e:operator` | PASSED |
| `pnpm e2e:pause` | PASSED |

`git diff` on the spec file removed exactly one line, the diff header itself, so the two
shipped `applySettings` ceiling rows are untouched and their staying green unedited is
the evidence that the save-path refusal did not move. `discovery-window.spec.ts` and
`draft-edit.spec.ts` were read-only regression runs and needed no expectation edits, so
neither was added to `files_modified`. Task 2's `git diff --stat` touched only the three
documentation files (no source change in a documentation task).

## Must-have truths

| Truth | Status |
| --- | --- |
| An over-ceiling `DEFAULT_DISCOVERY_WINDOW_MS` is clamped at seed time with a loud warning naming both numbers | met |
| A later save of an UNRELATED field succeeds, so the settings surface cannot be bricked for the session | met |
| The gated read reports the value actually in force | met (the clamp writes both `value` and `envDefault`) |
| A runtime SAVE above the ceiling is still refused with the real maximum named | met (the two shipped rows pass unedited) |
| The runbook describes the cohort model the service actually has, and the quick start names the operator password | met |
| Every environment variable the service reads appears in BOTH the DEPLOY table and the compose file | met for the two that were missing |
| Every control name, route sample, and file path the docs cite matches what ships | met, including the conditional-key prose on `serviceDid` |

## Prohibitions

| Prohibition | Held |
| --- | --- |
| MUST NOT refuse to boot on an over-ceiling seed | held: the clamp warns and continues; no throw was added on any path |
| MUST NOT relax the SAVE-path refusal into a clamp | held: the two shipped `applySettings` ceiling rows pass with zero lines edited |
| MUST NOT document the retired filler model or any knob no code path reads | held: `! grep -rinq 'fillers' docs/ docker-compose.yml` is green |
| MUST NOT change any source behavior in the documentation task | held: Task 2's `git diff --stat` lists only the three documentation files |

## Deviations from Plan

**1. [Rule 2 - Coherence] Amended one line of ADR 0017's "Alternatives considered"**

- **Found during:** Task 2
- **Issue:** The plan scoped the ADR edits to the spec path and the ceiling consequence.
  The alternatives list separately rejects "Silently truncate an over-long discovery
  window to the ceiling. Rejected... Refuse at save and name the real maximum." Left
  alone, a reader would see a rejected alternative that a reader could mistake for the
  behavior Task 1 just shipped, and a rule stated as save-only.
- **Fix:** Added one clause noting that a boot seed is clamped instead of refused, but
  LOUDLY, naming both numbers, which is what makes it not that alternative. The
  rejection itself is unchanged: silent truncation is still rejected.
- **Files modified:** `docs/adr/0017-runtime-lifecycle-control.md`
- **Commit:** `a44c9b9`

**2. [Rule 2 - Accuracy] Updated the `discoveryWindowCeilingMs` seed docstring**

- **Found during:** Task 1
- **Issue:** The docstring said supplying the ceiling "lets `applySettings` refuse such a
  value at save time", which after the clamp describes only half of what it does.
- **Fix:** Restated it as enforcing the ceiling on both paths, by the two rules the docs
  now state distinctly.
- **Files modified:** `packages/service/src/runtime-settings.ts`
- **Commit:** `c77a219`

No architectural changes, no auth gates, no package installs.

## Known Stubs

None. No placeholder, hardcoded-empty, or unwired-data path was introduced.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or trust-boundary schema
change: the source change is a bounds check on an in-memory boot value, and the rest is
prose.

## Self-Check: PASSED

- `packages/service/src/runtime-settings.ts` FOUND
- `packages/service/tests/runtime-settings.spec.ts` FOUND
- `docs/DEPLOY.md` FOUND
- `docker-compose.yml` FOUND
- `docs/adr/0017-runtime-lifecycle-control.md` FOUND
- commit `c77a219` FOUND
- commit `a44c9b9` FOUND



