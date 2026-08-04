---
phase: 05-operator-cohort-lifecycle-control
plan: 44
subsystem: infra
tags: [runtime-settings, boot-warnings, fail-closed, documentation, vitest]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "05-42's every-branch round guards and gatedSliceReset(), and 05-43's 401-only session expiry with the probe's unreachable answer, both serialized ahead of this plan so the round's gate runs over a settled tree"
  - phase: 05-operator-cohort-lifecycle-control
    provides: "round 7's corrected consequence ordering (cost, in-session repair, environment edit) and the REFUSED_SEEDS console caption that is its fixed point"
provides:
  - "operatorSurfaceMounted, a boot seed key recording whether this service mounts an operator surface, defaulting to the fail-closed reading"
  - "two variants of each refusal consequence, differing only in the in-session clause"
  - "one operatorPassword binding in createService read twice, so the warning and the mounted surface cannot disagree"
  - "a row that asserts the sentence and the absent settings route together on one real boot"
  - "one account of the refused-terms fact in every place docs/DEPLOY.md states it, with the count of in-session-repair statements pinned"
affects: [operator-console, deploy-runbook, future-gap-rounds]

actuals:
  tokens: 8600
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "a module that emits operator-facing copy about another module's surface takes that surface's existence as an INPUT, never as an assumption"
    - "the fail-closed reading is the DEFAULT of a disclosure bit, so a caller that forgets the key under-promises rather than over-promises"
    - "one binding read twice beats two expressions testing the same option, because a future change to the condition then has one place to move"
    - "when a plan corrects a statement of fact, count the statements before editing any of them"

key-files:
  created: []
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/src/index.ts
    - packages/service/tests/runtime-settings.spec.ts
    - docs/DEPLOY.md

key-decisions:
  - "operatorSurfaceMounted defaults to the fail-closed reading (absent means no in-session promise), because a default that promised a surface would make every directly constructed holder claim one, which is the class of unearned claim the finding is about."
  - "createService derives the bit from a single operatorPassword binding that also builds operatorAuth, rather than each site testing opts.operatorPassword for itself, so the two readings of one fact share one expression."
  - "The unmounted variant joins the cost to the environment edit with a colon rather than dropping a sentence out of the middle, which keeps both halves byte-identical across the two variants."
  - "The two DEPLOY.md environment rows were QUALIFIED rather than left unqualified, with the reasoning recorded below, and the count of qualified statements is pinned at three."
  - "A documentation pin was added in the shipped source-walk style (readFileSync + claim regex) rather than a new documentation harness, because this file already reads its own source that way."

patterns-established:
  - "A disclosure exists to make somebody act, so it may only name repairs that exist for the reader it is printed to."
  - "Search for the CLAIM in more than one phrasing and write the count down BEFORE editing, rather than correcting the copies you happen to find."

requirements-completed: [SVC-04, SVC-05]

coverage:
  - id: D1
    description: "A service booted with no operator password prints a refusal warning that makes no in-session promise, and really serves no settings route (review IN-17)."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#promises no in-session repair on a fail-closed boot, and really serves no settings route"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#makes NO in-session promise for a refused TERMS_TEXT when this service mounts no operator surface"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#makes NO in-session promise for a refused SERVICE_NAME when this service mounts no operator surface"
        status: pass
    human_judgment: false
  - id: D2
    description: "A service booted WITH an operator password still makes the promise and really serves the route it names, so the fix did not drop the clause unconditionally."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#DOES promise it on a boot with an operator password, and really serves the route it names"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#names the in-session repair BEFORE the environment edit for a refused TERMS_TEXT"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#names the in-session repair BEFORE the environment edit for a refused SERVICE_NAME"
        status: pass
    human_judgment: false
  - id: D3
    description: "A holder told nothing takes the fail-closed reading, so a caller that forgets the key never claims a surface."
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#takes the fail-closed reading for a refused TERMS_TEXT when the holder is told NOTHING"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#takes the fail-closed reading for a refused SERVICE_NAME when the holder is told NOTHING"
        status: pass
    human_judgment: false
  - id: D4
    description: "The split cost the refusal nothing: every line still names the variable, the supplied length and the ceiling, the cost and environment halves are identical across both variants, the two clauses stay different sentences, and a within-cap seed still warns about nothing."
    requirement: SVC-05
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#keeps the cost and the environment edit identical across BOTH variants for a refused TERMS_TEXT"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#still names the variable, the supplied length and the ceiling for a refused SERVICE_NAME"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#keeps the two consequences DIFFERENT sentences, so neither loss is dressed in the other words"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#says none of this for a seed within the cap: no warning at all, and no dropped name"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/DEPLOY.md states the refused-terms fact once, in the section prose as well as the environment table, and every in-session repair it offers names its precondition (review IN-16)."
    requirement: SVC-05
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#leaves no statement in docs/DEPLOY.md naming shortening as the ONLY repair (review IN-16)"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#qualifies EVERY in-session repair the runbook offers, all three of them (review IN-17)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The round's whole gate is green over the settled tree: 1392 unit tests, lint, the web build, and all thirteen hermetic e2e legs."
    verification:
      - kind: integration
        ref: "pnpm test (68 files, 1392 tests)"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:gate (13 legs)"
        status: pass
      - kind: other
        ref: "pnpm lint; pnpm --filter @btcr2-aggregation/web build"
        status: pass
    human_judgment: false
  - id: D7
    description: "An operator following docs/DEPLOY.md from a clean machine reads one consistent account of what a refused TERMS_TEXT costs and what repairs it, and finds the boot output agreeing with it."
    verification: []
    human_judgment: true
    rationale: "The clean-machine DEPLOY walk is Environment 1 of the owner's 05-UAT.md and stays the owner's. This plan makes the document that walk reads more accurate; whether it reads as one account to a human standing the service up is exactly the judgment the walk exists for."

duration: 12 min
completed: 2026-08-04
status: complete
---

# Phase 05 Plan 44: A boot only offers repairs that exist for the operator reading it

**A fail-closed boot no longer prints an instruction to repair a refused participation-terms seed in a settings surface it never mounts, and the deploy runbook's prose sentence stopped contradicting its own section by naming a restart as the only way back.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-04T17:32:00Z
- **Completed:** 2026-08-04T17:44:03Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `RuntimeSettingsSeed` carries `operatorSurfaceMounted`, and both refusal consequences have a mounted and an unmounted variant. The cost half and the environment-edit half are the same bytes in both; only the in-session clause moves.
- `createService` derives that bit from a single `operatorPassword` binding that also builds `operatorAuth`, which is what mounts the whole gated block (settings routes included). The warning and the mounted surface are now two readings of one binding rather than two independent tests of one option.
- One row boots a real service on an ephemeral port, reads the warning it printed AND asks its own HTTP surface for `GET /v1/operator/settings`, asserting both together: no in-session promise and a 404. The control boots with a password and asserts the promise and a 401.
- `docs/DEPLOY.md`'s participation-terms prose sentence names the cost, the in-session repair and the environment edit in that order, and no longer says the join flow has no terms step "until you shorten it".
- Both environment rows qualify the in-session repair with its `OPERATOR_PASSWORD` precondition, in one short parenthetical, and the count of qualified statements is pinned at three so a fourth cannot be added unqualified.

## Task Commits

1. **Task 1: a boot with no operator surface promises no in-session repair (IN-17)** - `503ddcb` (fix)
2. **Task 2: one account of the refused-terms fact, then the round's gate (IN-16)** - `dc65836` (docs)

## Files Created/Modified

- `packages/service/src/runtime-settings.ts` - the `operatorSurfaceMounted` seed key with its docstring, the `consequenceFor` composer, both `textKnob` call sites rebuilt on it, and the extended comment above them naming where the surface is mounted.
- `packages/service/src/index.ts` - the `operatorPassword` binding, `operatorSurfaceMounted` derived from it and passed to the holder, and `operatorAuth` built from the same binding.
- `packages/service/tests/runtime-settings.spec.ts` - the two table seeds carrying their own precondition, three unmounted rows per seed, the `withBootedRefusal` helper and its two real-boot rows, and the two `docs/DEPLOY.md` claim pins.
- `docs/DEPLOY.md` - the corrected participation-terms prose sentence and the two qualified environment rows.

## The inventory, taken BEFORE any documentation edit

The reason this finding exists is that round 7 corrected two statements of four. So the count was taken first, with a search for the CLAIM in several phrasings (`truncat`, `no terms step`, `shorten`, `IGNORED at boot`) across `docs/`, `docker-compose.yml`, `packages/service/src`, `packages/web/src` and `README.md`.

| # | Statement | Where | Disposition |
|---|---|---|---|
| 1 | `REFUSED_SEEDS`, the console caption: cost, in-session repair, environment edit | `packages/web/src/components/operator/SettingsView.tsx:97-113` | **Unedited, deliberately.** It is the fixed point every other statement follows. It is also the one statement IN-17 cannot reach: this caption renders only inside the console, which exists only where the surface is mounted, so its in-session promise is unconditionally true to its reader. |
| 2 | The two boot warnings emitted by `textKnob` | `packages/service/src/runtime-settings.ts:864-895` | **Corrected in Task 1** (mounted and unmounted variants). |
| 3 | The `SERVICE_NAME` environment row | `docs/DEPLOY.md:510` | **Qualified in Task 2** (see the decision below). |
| 4 | The `TERMS_TEXT` environment row | `docs/DEPLOY.md:516` | **Qualified in Task 2.** |
| 5 | The participation-terms prose sentence | `docs/DEPLOY.md:357-358` | **Corrected in Task 2.** This is IN-16 itself: the fourth statement, fourteen lines above rows 3 and 4. |
| 6 | The `SERVICE_NAME` compose comment | `docker-compose.yml:42-47` | **No correction needed.** It states the runtime-editable and restart semantics and never mentions the character cap or a refusal, so it names no repair that could be wrong. |
| 7 | The `TERMS_TEXT` compose comment | `docker-compose.yml:67-73` | **No correction needed**, for the same reason: set/empty semantics and the app-level enforcement limit, no cap and no refusal. |
| 8 | The `/v1/config` additivity paragraph naming `SERVICE_NAME` and the settings surface | `docs/DEPLOY.md:489` | **No correction needed.** It is about which keys the config read serves, not about a refusal or its repair. |
| 9 | The section's opening sentence ("Set `TERMS_TEXT` at boot, or the participation terms field in the settings surface at runtime") | `docs/DEPLOY.md:345` | **No correction needed.** It is the sentence statement 5 was contradicting, and it is true. |
| 10 | `README.md` | whole file | **No statement of this fact exists.** Neither variable is mentioned. |
| 11 | ADR 0017's shorten-only discovery-window decision | `docs/adr/0017-runtime-lifecycle-control.md:163,246` | **Not this fact.** That is the numeric clamp on a window, a different rule with a different resolution (clamp, not refuse). |

Four statements of the refusal fact exist that name a repair (1, 2, 3-4, 5). Round 7 corrected 1 (round 6, actually) and 3-4; this round corrected 2 and 5, and qualified 3-4.

## The decision about the two environment rows, and why

The plan required this decided explicitly and in writing rather than left open, because leaving it undecided is the exact failure IN-16 is.

**They were QUALIFIED**, with a six-word parenthetical and no new paragraph: `settings surface (present when \`OPERATOR_PASSWORD\` is set)`.

The reason is about the reader. An environment table is read while configuring a service, by somebody who has not yet decided whether to set `OPERATOR_PASSWORD` at all: the `OPERATOR_PASSWORD` row sits six rows below `TERMS_TEXT` in the same table and already says an unset password disables the operator surface. So the qualifying fact IS available to that reader, which is the case for leaving the rows alone. But it is available only as an inference the reader has to make, at the moment they are deciding whether a long terms document costs them a restart, and after Task 1 the boot output no longer makes the promise on that service. A document that promises what the running service does not is the same defect one level up. Six words removes the inference; the row keeps its shape and the table keeps its length.

The same qualifier was carried into the corrected prose sentence, so all three statements of the in-session repair in the runbook read identically, and the count of three is pinned by a row.

## Mutation checks, with the observed output

Each change was proven load-bearing by reverting it, observing the named rows RED, and restoring.

**Task 1: `consequenceFor` made to ignore the bit and always promise the surface.**

```
FAIL > makes NO in-session promise for a refused SERVICE_NAME when this service mounts no operator surface
FAIL > keeps the cost and the environment edit identical across BOTH variants for a refused SERVICE_NAME
FAIL > makes NO in-session promise for a refused TERMS_TEXT when this service mounts no operator surface
FAIL > keeps the cost and the environment edit identical across BOTH variants for a refused TERMS_TEXT
FAIL > promises no in-session repair on a fail-closed boot, and really serves no settings route
      Tests  5 failed | 113 passed (118)
```

The mounted rows stayed GREEN under the same mutation, run alone to make the attribution explicit rather than inferred from an absence in a failure list:

```
✓ DOES promise it on a boot with an operator password, and really serves the route it names
      Tests  1 passed | 117 skipped (118)

(the two shipped ordering rows)
      Tests  2 passed | 116 skipped (118)
```

That pairing is what proves the fix reads the bit rather than dropping the clause for everybody. Before the fix, against the shipped holder, the same five rows failed with the harm stated literally on the real boot:

```
AssertionError: expected '[settings] ignoring TERMS_TEXT: 10000…' not to contain 'Set the participation terms in the op…'
Received: "[settings] ignoring TERMS_TEXT: 100000 characters exceeds the 20000 character maximum this
service stores; the join flow has no terms step at all, so this service refuses every acceptance.
Set the participation terms in the operator settings surface to restore the acceptance step for this
session, and shorten TERMS_TEXT so a restart keeps it"
```

That is the sentence printed by a service whose own `GET /v1/operator/settings` answers 404. Restored:

```
      Tests  118 passed (118)
```

**Task 2: `docs/DEPLOY.md` reverted to its shipped text.**

```
FAIL > leaves no statement in docs/DEPLOY.md naming shortening as the ONLY repair (review IN-16)
AssertionError: expected '# Deploying a did:btcr2 aggregation c…' not to match /until you shorten it, the join flow h…/
FAIL > qualifies EVERY in-session repair the runbook offers, all three of them (review IN-17)
AssertionError: expected [] to have a length of 3 but got +0
      Tests  2 failed | 118 passed (120)
```

Both pins are therefore about the document rather than about themselves. Restored:

```
      Tests  120 passed (120)
```

## Verification

| Check | Result |
|---|---|
| `pnpm test` | 68 files, **1392 tests**, green |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm typecheck` (`tsc -b`) | clean |
| `pnpm e2e:gate` | green, all thirteen legs |
| `git diff --stat packages/web` | empty |
| `git diff --stat packages/service/src/hono-adapter.ts` | empty |
| `git diff --stat pnpm-lock.yaml` | empty |
| `git diff --stat .planning/REQUIREMENTS.md` | empty |
| `grep -rlP '\x{2014}'` over all four touched files | no files |

### The round's arithmetic, in one place

| Point | Files | Tests |
|---|---|---|
| Round 8 baseline (after round 7) | 68 | 1348 |
| After 05-42 | 68 | 1371 (+23) |
| After 05-43 | 68 | 1382 (+11) |
| After 05-44 (this plan) | 68 | **1392** (+10) |

Nothing was lowered at any point, and no existing assertion was edited. The one allowed RESHAPE was taken as a reshape: the two shipped ordering rows' seeds gained `operatorSurfaceMounted: true` so each row states its own precondition, with every assertion inside them byte-identical.

### The thirteen e2e legs, each named

`e2e:operator`, `e2e:monitor`, `e2e:cancel`, `e2e:pause`, `e2e:testpeers`, `e2e:fallback`, `e2e:fallback:operator`, `e2e:browse`, `e2e:kofn`, `e2e:live:mock`, `e2e:resolve`, `e2e:config`, `e2e:persist`. All thirteen PASSED. They run here rather than in 05-42 or 05-43 because this is the round's only `packages/service` change and it changes boot output: the legs boot real services in-process, so they are the cheapest proof that a service still boots and runs a cohort end to end after the holder's construction grew a parameter.

## Prohibitions held

- No route added, moved or removed. `git diff --stat packages/service/src/hono-adapter.ts` is empty, and the fail-closed posture is asserted in the positive direction: the passwordless boot's settings route answers 404 in the same row that reads its warning.
- No over-long free-text seed is truncated in any branch. The measurement half of every warning (variable, supplied length, ceiling) is preserved and pinned in both variants.
- `packages/web/src/components/operator/SettingsView.tsx` is unedited; `git diff --stat packages/web` is empty.
- The two consequence clauses stay different sentences, pinned by the shipped row requiring the terms line to mention the acceptance gate and the name line not to.
- No persistence of any kind was added to the settings holder; the source pin on that absence stays green.
- No served DTO, route, status code or public copy changed. The settings snapshot's serialized shape is unchanged (the `lifecycle-routes.spec.ts` sorted-key row is green).
- No package added; the lockfile diff is empty.
- No test deleted or loosened, and no shipped assertion edited.
- WR-03, WR-04, WR-05, IN-01, IN-02, the endpoint verdict cache, `tx-client.ts`'s missing timeout, the unbounded `verdictCache` singleton, the `/cas` prototype-pollution 500, the test-peer seat cap and seat reclaim are all untouched.
- `.planning/REQUIREMENTS.md` is untouched, and no claim is made against the 16 pending human items in `05-UAT.md`. Environment 1, the clean-machine DEPLOY walk, remains the owner's; this plan makes the document that walk reads more accurate and closes none of it.

## Decisions Made

Recorded in full in the frontmatter and in "The decision about the two environment rows" above. In brief:

- **The fail-closed default.** `operatorSurfaceMounted` absent means no in-session promise. The other direction would make every directly constructed holder claim a console, which is the unearned claim the finding is about, and it would leave the two shipped ordering rows silently asserting the wrong variant.
- **One binding, two readings.** `createService` binds `operatorPassword` once; `operatorSurfaceMounted` is derived from it and `operatorAuth` is built from it. Two independent tests of `opts.operatorPassword` would have been two places to move when the mounting condition next changes, which is exactly how the sentence and the surface drifted apart in the first place.
- **A colon, not a dropped sentence.** The unmounted variant joins the cost to the environment edit with a colon, so the remedy stays a remedy rather than a fragment and both halves stay the same bytes.
- **A claim pin, not a prose pin.** The two documentation rows assert the CLAIM (the overclaim is absent; the qualifier appears exactly three times), so a rewrite that keeps one account of the refusal stays green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The destructured discard tripped `@typescript-eslint/no-unused-vars`**

- **Found during:** Task 2 (the gate's `pnpm lint` leg)
- **Issue:** the fail-closed-default row built its bare seed with `const { operatorSurfaceMounted: _statedInTheRow, ...bare } = row.seed;`. This repo's flat config takes `typescript-eslint` recommended with no `varsIgnorePattern` and no `ignoreRestSiblings` relaxation, so the underscore-prefixed discard is an error rather than a convention.
- **Fix:** built the bare seed explicitly instead, which also reads more plainly as "the same seed with the key removed": `const bare: RuntimeSettingsSeed = { ...row.seed }; delete bare.operatorSurfaceMounted;`
- **Files modified:** `packages/service/tests/runtime-settings.spec.ts`
- **Verification:** `pnpm lint` green; the row still passes and is still the one that goes RED under the Task 1 mutation.
- **Committed in:** `dc65836`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** none. A test-local expression changed shape; no assertion, no source behavior and no scope moved.

## Issues Encountered

One shaping problem, solved inside the task rather than as a deviation. The plan asked the real-boot row to follow `withBootedService`, the shipped helper in the same block, but that helper deliberately binds no port and the `Service` handle exposes no Hono app: the surface half of the claim is an HTTP fact and cannot be read through it. So a second helper, `withBootedRefusal`, boots on an ephemeral port and reads both halves, following `packages/service/tests/operator-auth-secure.spec.ts`, which boots the same way for the same reason (its rule also spans `index.ts` deciding a value and another module acting on it). Its docstring says why it binds a port where its neighbour does not, so the two helpers do not read as an accident.

## Known Stubs

None. This plan added one optional seed key, one string composer, one call-site argument, test rows and a documentation correction; nothing was placeholdered.

## User Setup Required

None - no external service configuration required.

## The round's closing note

**All seven round-7 findings are now closed at code level:** WR-13 and IN-18 in 05-42, WR-14, WR-15 and IN-15 in 05-43, IN-17 and IN-16 here. The round's gate is green end to end over the settled tree: 68 files / 1392 tests, lint, the web build, and all thirteen hermetic e2e legs.

**Still carried by owner decision**, unchanged and untouched by this round: WR-03, WR-04, WR-05, IN-01, IN-02, the endpoint verdict cache, `tx-client.ts`'s missing timeout, the unbounded `verdictCache` singleton, the `/cas` prototype-pollution 500, the test-peer seat cap, seat reclaim, and the deferred advert-slot-on-fill item. WR-01 (the proxy-aware login throttle) and WR-02 (the NaN TTL) remain flagged for before a public deploy, and the two red browser e2e CI jobs remain Phase 6 debt.

**Worth stating plainly rather than leaving the owner to notice:** this is the FOURTH consecutive round to touch the session-identity subsystem in `packages/web/src/stores/operator.ts`. Rounds 5, 6, 7 and 8 each closed real findings there and each surfaced fresh residuals in the same place. Round 7 was the first with zero new critical findings, and round 8 closed its three warnings, but the pattern is a subsystem that keeps yielding on re-read rather than one that has settled. If a fifth round produces the same shape again, the honest reading is that the store's session identity wants a design pass rather than another sweep.

**Recommended next:** `/gsd-verify-work 5`. The 16 pending human items in `05-UAT.md` are the phase's remaining gate, and Environment 1 (the clean-machine DEPLOY walk) now reads a runbook this round made accurate, so it is the walk most likely to pay. `/gsd-secure-phase 5` is the alternative if the owner would rather take the security pass first: the hook is active and no `05-SECURITY.md` exists yet.

## Next Phase Readiness

Round 8 is complete: 44 of 44 plans in phase 05 executed. Nothing in this plan blocks anything. The phase's remaining work is human: the 16 `05-UAT.md` items, and the owner's choice between verification and the security pass.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-04*

## Self-Check: PASSED

- `packages/service/src/runtime-settings.ts` present on disk (modified, not created).
- `packages/service/src/index.ts` present on disk (modified, not created).
- `packages/service/tests/runtime-settings.spec.ts` present on disk (modified, not created).
- `docs/DEPLOY.md` present on disk (modified, not created).
- Commits verified present: `503ddcb`, `dc65836`.
- All task `<acceptance_criteria>` re-run and passing; the plan-level `<verification>` commands re-run and recorded in the Verification table above.
