---
phase: 05-operator-cohort-lifecycle-control
plan: 40
subsystem: web
tags: [operator-console, session-identity, gap-closure, wr-12, in-09, in-10]
status: complete
requires:
  - "05-39 (GATED_SLICE_RESET, expireSession and liveSessionRound, whose expiry paths this plan routes fifteen call sites through)"
  - "05-36 (the four gated reads' session guards, whose composition this plan lifts into helpers and makes uniform)"
  - "05-34 (sessionRound itself, the identity every guard in this file compares)"
provides:
  - "AdvertiseActionResult and ReadvertiseActionResult: discriminated, never-throwing results carrying the service's own 409 reason"
  - "askingRound / stillAsking / expireIfStillAsking: the session-identity rule in one place, used by every gated call"
  - "advertise and readvertise failures rendered in the one-shot action-error field the cohort list shows"
  - "one composition of the session comparison across all four gated reads"
  - "a mutation that turns a read's ABA row and an action's ABA row red together, which a per-site fix could not produce"
affects:
  - packages/web/src/lib/operator.ts
  - packages/web/src/stores/operator.ts
  - packages/web/tests/operator.spec.ts
tech-stack:
  added: []
  patterns:
    - "when a fix is a per-call-site edit, buy the shared implementation and let ONE revert turn two different families of row red together; a fence that survives two review rounds is a fix that has not been written yet"
    - "a discriminated result keeps a service that answered no apart from a service that could not be reached, because those are two different things for the operator to go and check"
    - "a one-shot action's failure belongs in the field rendered on the surface that carries its button, not in the nearest existing error slot"
key-files:
  created: []
  modified:
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/tests/operator.spec.ts
decisions:
  - "advertise and readvertise return discriminated results with TWO extra members beyond the shared FetchResult vocabulary, not one: `refused` carries the service's app-authored 409 reason (the paused-advertising gate, D-06), and `declined` is any other non-ok answer. Folding `declined` into `unreachable` would tell an operator whose service refused to go and check whether their service is running."
  - "Both verbs' failure messages moved from `formError` to `actionError`. `formError` is the create form's validation slot and `CreateCohortForm` renders only while the New cohort form is open, so an advertise failure written there was invisible on the surface the button lives on; `actionError` renders at the top of OperatorCohortList beside the advertise confirmation and directly above the rows whose buttons raise it. No new field and no new surface: this is a choice between two shipped slots."
  - "The two verb-specific sentences are preserved byte-identically and merely NAMED (ADVERTISE_FAILED / READVERTISE_FAILED, following the shipped DISCARD_FAILED and EXPORT_FAILED precedent) so a row can pin each without re-typing a literal. They beat the shared action line because they name the verb, and the cohort list carries several one-shot actions raising into one slot."
  - "IN-09 was closed by the review's FIRST option (a shared implementation) rather than its second (state the exemption in the docstring). 05-36 already fenced these paths on the record once and the fence has now been re-observed as a finding, which is what a fence that should have been a fix looks like."
  - "The status clause was DROPPED from refreshCohorts rather than ADDED to the other three reads. Both are uniform; the round comparison already proves the session did not end (every ending path bumps it, the probe included since 05-39), so the clause only refused an ok answer landing while a probe was in flight, and adding it everywhere would defer a genuine expiry to the next tick for no benefit. That is the argument the store's own 401 branch already recorded, and the two comments now agree instead of making opposite cases about one clause in one method."
  - "probe's session-ended branches stay exactly as 05-39 landed them and are named in the helper trio's docstring as the ONE documented exception, with the reason stated: no round asked the probe's question, because the probe is the path that discovers a session ended WITHOUT a 401."
metrics:
  duration: 11 min
  completed: 2026-08-04
actuals:
  tokens: 66300
  tasks: 3
  commits: 3
---

# Phase 05 Plan 40: One Vocabulary, One Comparison Summary

The console's two most-used buttons now answer an expired session and a service refusal the way every other gated verb does, and one shared comparison decides whether an answer still belongs to the session that asked, at all fifteen gated call sites.

## What Was Built

### Task 1: a 401 on Advertise takes the operator to one honest re-login (WR-12) - `3c1da16`

`packages/web/src/lib/operator.ts` gained `AdvertiseActionResult` and `ReadvertiseActionResult`, built on the shared `FetchResult` vocabulary the way `FinalizeResult` is, with a shared `refusalReason` reader that parses a 409 body defensively (a body carrying no reason still refuses, just without one). Neither helper can throw any more: a thrown fetch is `unreachable`, a 401 is `unauthorized`, a 409 is `refused` with the service's sentence, and any other non-ok answer (chiefly the 404 for a draft this service does not hold) is `declined`. A 200 that names no live cohort is `declined` too, because there is no id to open.

The names are deliberately not the bare word the service package already uses for its own advertise verdict.

Both store actions now branch on that result, following `finalizeCohort`'s shape: `unauthorized` takes the one shared session-expiry path, `refused` renders the service's reason through the shipped `actionFailedWith` helper, `declined` keeps the verb-specific sentence, and `unreachable` keeps the shared unreachable copy. Every branch clears both in-flight advertise fields, so no row is left claiming to be mid-advertise. The failure messages moved to `actionError`, which each verb now clears on entry; `formError` is left alone entirely, with the reason stated in a comment.

Nine rows landed, the two verbs pinned independently at every crossing: the 401 pair, the 409 pair (asserting the service's own `advertising is paused on this service` reaches the operator and that `formError` stays undefined), the two preserved-sentence pins, the unreachable row asserting the two failure causes stay distinguishable, and two success rows. The advertise success row pins a shipped property that had no row until now: the drill-down opens on the id the RESPONSE carried, never the stale draft id.

### Task 2: one comparison decides whether an answer still belongs (IN-09) - `90628a4`

Three module-scope helpers in `packages/web/src/stores/operator.ts`, following the shipped `runAdvertisingToggle` shape (a module function taking the store's getter), under one docstring holding the whole rule: `askingRound` captures before the await, `stillAsking` answers whether the capture is still the live session, and `expireIfStillAsking` ends the session only when it is.

They are used at every gated call site that can end a session. Enumerated and counted against the review's own list:

| Family | Call sites |
|--------|-----------|
| Gated reads (4) | `refreshCohorts`, `pollDetail`, `loadSettings`, `saveSettings` |
| Service toggles (3) | `runAdvertisingToggle` (shared by `pauseAdvertising` and `resumeAdvertising`), `disableBroadcast` |
| One-shot cohort actions (6) | `discard`, `exportCohort`, `cancelCohort`, `finalizeCohort`, `addTestPeers`, `dismissEnded` |
| Form verbs (1) | `saveDraftEdit` |
| Advertise verbs (2) | `advertise`, `readvertise` (added by task 1) |

Fifteen in total: four reads plus eleven action verbs, matching the plan. Each captures before its await and expires only on a match, and every verb's own error posture is untouched, so the sweep changes when the shared expiry path runs and never what a refusal or a fault writes. `saveSettings` keeps its single computation read by four branches, now reading `stillAsking` once (renamed to `asking` at the call site so the local and the helper are not one word with two meanings).

`probe`'s session-ended branches are unedited from 05-39 and are named in the trio's docstring as the one documented exception, with the reason stated. The `sessionRound` docstring's general-law sentence now records that it is true of every gated call site and cites review IN-09.

Nine rows landed: an ABA row plus its anti-vacuity control for each of the four verb families (cancel, the advertising toggle, saveDraftEdit, advertise), and the absent-capture row proving a 401 landing into a console that held no live session when it asked ends nothing. Each ABA row asserts session B's whole gated slice field by field, because `expireSession` clears the lot on its way out and a row checking only `auth` would pass against a guard that logged the operator back in while throwing away the list, the served mode and the metrics.

### Task 3: four gated reads compare one thing, composed one way (IN-10) - `26f87db`

`refreshCohorts`'s guard dropped its auth-status clause, leaving the capture and the round comparison, matching `pollDetail`, `loadSettings` and `saveSettings`. The closing paragraph of the guard's comment now enumerates exactly what the landed guard rejects (two things, not three) and says what happened to the third, and it agrees with the 401 branch's comment directly above rather than contradicting it. The other three reads are unchanged: no clause was added anywhere.

One row landed, and one shipped comment was corrected. The new row starts a list read, leaves a probe IN FLIGHT so the console is mid-`checking`, settles the read and asserts it wrote everything a live-session read writes, then settles the probe and asserts the same session. The shipped `lets a list read started before a CONFIRMING probe still write when it lands` row keeps its assertions byte-identical; only its recorded caveat changed, and it says what happened to the status check rather than deleting the observation.

## Mutation Evidence (all three reverted and restored)

**Task 1, collapsing ONE verb's 401 branch into its generic failure branch.** Re-advertise's `unauthorized` branch was rewritten to write `READVERTISE_FAILED`. Exactly that verb's 401 row went red; the advertise verb's rows stayed green, which is the property that proves the two call sites are independently covered:

```
FAIL > operator store advertise and readvertise (review WR-12) > takes an EXPIRED session to the one honest re-login on RE-ADVERTISE too
AssertionError: expected 'logged-in' to be 'logged-out'
      Tests  1 failed | 86 passed (87)
```

Restored: 87 passed.

**Task 2, removing the round comparison from inside the shared helper.** `stillAsking` was reduced to the capture check alone. A read's ABA rows and an action's ABA rows went red TOGETHER (fifteen rows across three describe blocks), while every anti-vacuity row stayed green:

```
× refreshCohorts concurrency > discards a list answer from a session that ENDED even though a NEW session is now signed in
× refreshCohorts concurrency > discards a 401 issued by a session that ENDED rather than signing the NEW session out (review WR-08)
× session identity across every gated read > pollDetail discards a 401 issued by an ENDED session rather than signing the NEW session out
× session identity across every gated read > loadSettings discards a 401 issued by an ENDED session
× session identity across every gated read > saveSettings discards a 401 issued by an ENDED session
× session identity across every gated ACTION (review IN-09) > cancelCohort discards a 401 issued by an ENDED session rather than signing the NEW session out
× session identity across every gated ACTION (review IN-09) > the advertising toggle discards a 401 issued by an ENDED session
× session identity across every gated ACTION (review IN-09) > saveDraftEdit discards a 401 issued by an ENDED session
× session identity across every gated ACTION (review IN-09) > advertise discards a 401 issued by an ENDED session
⎯⎯ Failed Tests 15 ⎯⎯
```

Restored: 125 passed (with `settings.spec.ts`).

**A per-site fix could not have produced that pairing**, which is the whole argument for the helper. Eleven separate `if (asked !== undefined && ...)` clauses would each need their own revert to turn their own row red; here one revert of one expression turns four gated reads and four gated action families red at the same time, so a future edit that quietly weakens the rule cannot weaken it for only one family without the suite noticing.

**Task 3, restoring the auth-status clause.** Exactly the new row went red, every other row in the list-read concurrency block green:

```
FAIL > operator store refreshCohorts concurrency (W5: a list answer belongs to ONE session) > writes an ok list answer that lands INSIDE a confirming probe's checking window (review IN-10)
AssertionError: expected [] to deeply equal [ { draftId: 'draft-1', …(6) } ]
      Tests  1 failed | 96 passed (97)
```

Restored: 97 passed.

## Verification

| Gate | Result |
|------|--------|
| `pnpm test` | 68 files, **1339 tests**, green (round baseline 68 files / 1304 tests; 05-39 left it at 1320, so +19 rows here and nothing removed) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm typecheck` (`tsc -b`) | green |
| `packages/web/tests/operator.spec.ts` | 78 rows before, 97 after; every shipped row green with no assertion edited |
| `git diff --stat packages/service` | empty |
| `git diff --stat pnpm-lock.yaml` | empty |
| em-dash scan over all three touched files | none |

`pnpm e2e:gate` was NOT run by this plan, and the reasoning is stated rather than the step skipped silently: the plan assigns the round's single gate run to 05-41, which is serialized AFTER this plan and therefore covers these web changes, and 05-41 is the only plan in the round that edits `packages/service` (including boot-warning strings a booting service actually emits). Nothing here reaches an e2e leg in any case: no e2e leg exercises the browser store.

**05-UI-SPEC check, recorded because the plan asked for it either way:** `05-UI-SPEC.md` contains NO line specifying advertise failure copy or the surface it renders on. It specifies the advertise CONTROLS (`Advertise cohort` / `Re-advertise` as the single primary action per surface, and their disabled-while-paused reason `Advertising is paused.`), none of which this plan touches. So nothing there was falsified and nothing needed amending.

## Deviations from Plan

**1. [Rule 3 - Blocking] Two shipped copy constants and one shared line had to be exported to be pinned without re-typing.**
- **Found during:** Task 1, writing the preserved-sentence pins.
- **Issue:** The two verb sentences were inline string literals inside the store's failure branches, and `ADVERTISED_OK`, `READVERTISED_OK` and `UNREACHABLE` were module-private. A row pinning them would have had to re-type each literal, which is the exact anti-pattern this repo's own comments warn about (a re-typed string passes against a subtly different second definition).
- **Fix:** The two sentences are now named constants `ADVERTISE_FAILED` and `READVERTISE_FAILED` with byte-identical values, exported alongside the shipped `DISCARD_FAILED` / `EXPORT_FAILED` precedent; `ADVERTISED_OK`, `READVERTISED_OK` and `UNREACHABLE` gained an `export` keyword and nothing else. No value changed, no store field was added, and the byte-identity is itself pinned by a row (`expect(ADVERTISE_FAILED).toBe('Could not advertise the draft. Try again.')`).
- **Files modified:** `packages/web/src/stores/operator.ts`
- **Commit:** `3c1da16`

**2. [Rule 3 - Blocking] `saveSettings`'s local comparison had to be renamed.**
- **Found during:** Task 2.
- **Issue:** `saveSettings` held a local `const stillAsking`, which the new module-scope helper of the same name would have shadowed, leaving one word meaning two things four lines apart.
- **Fix:** The local is `asking`, computed from the helper once and read by all four branches exactly as before. Every branch's behavior and every assertion in the shipped rows is unchanged.
- **Files modified:** `packages/web/src/stores/operator.ts`
- **Commit:** `90628a4`

**3. [Not a deviation, recorded because the plan anticipated one] No shipped row needed a staging reshape.**
- **Found during:** Task 2, checking the staging of every shipped action-verb 401 row as the plan instructs.
- **Detail:** The plan permits reshaping any shipped row that drives a gated action from a console the store does not hold at logged-in. None needed it. Every action-verb row in `operator.spec.ts` runs under `resetStore`, which 05-39 already corrected to seed a live session, and the `settings.spec.ts` save block was already reshaped by 05-36 to seed `auth: 'logged-in'`. So the permitted reshape was not used and no shipped assertion was edited anywhere in this plan.

## Deliberately Not Done

The two verb-specific failure sentences are preserved rather than improved: no finding asks for new copy. The create form's validation field keeps its own meaning and is not otherwise touched. No abort controller and no request cancellation: the guard makes a late answer harmless rather than preventing it, which is what both shipped precedents do. No status clause was added to the other three gated reads. `probe`, `signIn`, `signOut`, `expireSession`, `GATED_SLICE_RESET` and `liveSessionRound` are exactly as 05-39 landed them, and the rows 05-39 added are unedited.

Out of scope by owner decision and untouched: review WR-03 (`validateDraft`'s per-draft window rule), WR-04 (the `LifecycleActions` provenance barrier), WR-05 (the two freshness facts on `lastUpdated`), IN-01 (`numericKnob`'s coercion) and IN-02 (`parseWindow`); the earlier carried findings (the endpoint verdict cache never cleared, `tx-client.ts`'s missing `AbortSignal.timeout`, the unbounded `verdictCache` module singleton, the `/cas` prototype-pollution 500, the test-peer seat cap); and the deferred advert-slot-on-fill item, which stays with Phase 6 and `deferred-items.md`. `.planning/REQUIREMENTS.md` is untouched, and no claim is made about the 16 pending human items in `05-UAT.md`, which are the owner's walk rather than build work.

## Known Stubs

None. No placeholder value, no unwired surface, and no skipped or `todo` row was added.

## Backstop Left for a Human

One `must_haves` truth is marked `verification: backstop` and remains for the owner's browser pass: in a real browser, clicking `Advertise` on a draft after the operator session has expired server-side should drop to the login screen with the session-ended copy rather than an invitation to try again, and clicking it in the moment between a pause landing and the list poll disabling the button should show the service's own paused sentence at the top of the cohort list. The store-level evidence for both halves is pinned above.

## Self-Check: PASSED

- `packages/web/src/lib/operator.ts` FOUND, contains `AdvertiseActionResult` and `ReadvertiseActionResult`.
- `packages/web/src/stores/operator.ts` FOUND, contains `expireIfStillAsking`, `askingRound` and `stillAsking`.
- `packages/web/tests/operator.spec.ts` FOUND, contains `AdvertiseActionResult`-driven rows and the IN-09 / IN-10 blocks; 97 rows green.
- `3c1da16` FOUND, `90628a4` FOUND, `26f87db` FOUND.
</content>
</invoke>
