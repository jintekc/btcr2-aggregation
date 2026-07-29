---
phase: 05-operator-cohort-lifecycle-control
plan: 06
subsystem: operator-lifecycle
tags: [operator-console, draft-editing, per-cohort-timing, patch-route, react, zustand, vitest, e2e]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 01)
    provides: the per-service cohort INTENT registry declared before runner.stopCohort, whose window-expired member this plan is the first to use
  - phase: 05-operator-cohort-lifecycle-control (plan 04)
    provides: the runtime settings holder the draft defaults are seeded from, and the read-per-request discipline (D-16)
  - phase: 05-operator-cohort-lifecycle-control (plan 05)
    provides: the served-bit rendering posture and the store idiom for a gated action with its own error field
  - phase: 04-operator-monitoring-and-live-path
    provides: the funding clamp (computeFundingDeadline + FUNDING_SLACK_MS, D-38) a per-cohort window had to keep obeying, and the discriminated FetchResult vocabulary
provides:
  - updateDraft, sharing exactly ONE validateDraft with createDraft, refusing every non-draft id so the route answers 404
  - PATCH /v1/operator/cohorts/:id, the repository's first PATCH route, gated with the 4 KiB body limit
  - per-draft discoveryWindowMs and fundingWindowMs with the shorten-only ceiling refused at save with the real maximum named
  - the app-side discovery-window timer declaring window-expired BEFORE stopCohort, cleared on every settle path
  - a genuinely per-cohort funding window that still obeys the 04 D-38 clamp
  - lib/cohort-form, the ONE pure module both cohort forms delegate every rule and every string to
  - DraftEditForm and the shared Advanced timing expander, rendered by both forms
  - this service's current window defaults served additively on the gated list read, read per request
affects: [05-07 settings surface, 05-08 broadcast kill switch]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One validator, two verbs: create and edit share a single guard chain, and the parity test compares the two thrown messages rather than re-typing an expected literal"
    - "Declare the intent, THEN stop: an app-side timer that ends a cohort files its app-authored fate before the library call that emits nothing"
    - "An empty field is 'unset', never a zero: the wire key is omitted so the server reads it as use-the-default, and a 0 (no window at all) stays a different instruction"
    - "Never name a figure the service did not report: the help omits the default rather than inventing or borrowing a stale one"
    - "Read the settings holder PER REQUEST, never into the app closure (the D-16 service-name lesson generalized)"
    - "Client validation stops where the client's knowledge stops: the shorten-only ceiling depends on a TTL the browser is never told, so the server owns that refusal"

key-files:
  created:
    - packages/service/tests/draft-edit.spec.ts
    - packages/service/tests/discovery-window.spec.ts
    - packages/web/src/components/operator/DraftEditForm.tsx
    - packages/web/src/lib/cohort-form.ts
    - packages/web/tests/cohort-form.spec.ts
  modified:
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/src/index.ts
    - packages/service/src/runtime-settings.ts
    - packages/service/src/tx.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/CreateCohortForm.tsx
    - packages/web/src/components/operator/OperatorCohortList.tsx

key-decisions:
  - "updateDraft reuses validateDraft verbatim rather than growing a second guard chain, and the parity test drives the same invalid body through BOTH verbs and compares the thrown messages, because a re-typed expected literal would still pass against a subtly different second validator"
  - "The lookup runs BEFORE validation on the PATCH route, so a non-draft id is a 404 rather than a validation verdict about a cohort the caller may not edit"
  - "A per-draft discovery window can only SHORTEN: no timing value in aggregation@0.4.0 is per-cohort, so the window is enforced app-side and a value above the runner TTL is refused at save with the real maximum named, never silently truncated"
  - "The window timer DECLARES window-expired and only then calls stopCohort; that order is the whole contract, because stopCohort emits nothing and the fate is otherwise unrecoverable"
  - "The client does NOT judge the shorten-only ceiling: it depends on a runner TTL the browser is never told, so guessing it would either block a legal value or promise one the service cannot keep"
  - "An empty timing field omits the wire key entirely rather than sending 0 or null, because empty means use-the-default and 0 would mean no-window-at-all"
  - "The gated list read gained an additive defaults key so the create form's help can name a real number; a draft row's own captured defaults are the wrong source for a cohort that does not exist yet"
  - "The edit form reads the DRAFT's captured defaults, not the service's current ones, because a draft keeps the shape it was made with (D-13)"
  - "The edit-not-available reason renders on ADVERTISED rows only, where its present tense is literally true, rather than on every non-draft row where it would be a false statement about a canceled cohort"

requirements-completed: [SVC-04]

# Metrics
duration: ~35 min (across an interrupted and a resumed session)
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 06: In-Place Draft Editing and Honest Per-Cohort Timing Summary

**The operator now reshapes a draft in place under the SAME single validator the create path uses, and gives each draft its own discovery and funding windows: the funding window is genuinely per-cohort, the discovery window can only ever shorten a cohort's life, and asking for more is refused at save with this service's real maximum named rather than accepted as a promise the library would silently overrule.**

## Performance

- **Duration:** ~35 min of execution across two sessions (the first was interrupted mid-Task-3)
- **Completed:** 2026-07-29
- **Tasks:** 3 (tasks 1 and 2 TDD, so each has a RED then a GREEN commit)
- **Files modified:** 14 (5 created, 9 modified)

## Accomplishments

- **One validator, two verbs, proven by comparison rather than by a literal.** `updateDraft` reuses `validateDraft` verbatim and rebuilds the config through the same `buildCohortConfig` call `createDraft` uses, including the pinned `maxParticipants` and the explicit fallback-threshold argument. `grep -c 'function validateDraft'` is 1. The parity tests drive the SAME invalid body through both verbs and compare the two thrown messages for equality, which matters more than it looks: a re-typed expected string would still pass if the edit path had quietly grown a second, subtly different validator, and that drift is exactly the thing under test.
- **The lookup runs before the validation.** A non-draft id earns a 404 without the body ever being judged, so the route never returns a validation verdict about a cohort the caller is not allowed to edit in the first place. Next-cohort-only is therefore enforced rather than merely stated: an advertised, in-flight, or terminal cohort returns `undefined` and its served shape is asserted unchanged after the refusal.
- **The repository's first PATCH route, mounted with the shape the create POST already established.** Inside the gated block, so `requireSameOrigin` and `requireOperator` reject an anonymous caller with 401 BEFORE any lookup (T-05-06-01); the same 4 KiB `bodyLimit` with its 413 handler (T-05-06-03); the `:id` shape guard before the lookup; a thrown validation `Error` mapped to a 400 carrying its message verbatim, which is app-authored UI-SPEC copy and never a raw library string (T-05-06-02).
- **The honest ceiling, which is the heart of this plan.** No timing value in `aggregation@0.4.0` is per-cohort: `cohortTtlMs`, `phaseTimeoutMs` and `advertRepeatIntervalMs` are per-RUNNER constructor options and `advertTtlMs` is per-transport. The library arms its own TTL at advertise and never resets it, so a per-draft discovery window longer than that TTL is a promise this service cannot keep. It is refused at save time with the real service maximum named in minutes, rather than accepted and silently overruled by a timer the operator cannot see. Only a SUPPLIED window is measured against the ceiling: the service's own default is by construction something the service can honor, and refusing every create on a service whose default drifted above its TTL would punish the operator for a setting the cohort form does not own.
- **Declare, then stop. That order is the contract.** `runner.stopCohort` emits nothing at all, so a cohort ended by its window would otherwise be indistinguishable from one the operator canceled. The timer declares `window-expired` into the 05-01 intent registry and only then calls `stopCohort`, and `settleCompletion` maps that intent to the `expired` fate with an app-authored reason. This is the first consumer of the `window-expired` member 05-01 declared but left unused, which is why that seam existed.
- **The timer cannot outlive or misattribute its cohort.** One timer per advertised cohort, held in a bounded per-cohort map, `unref`'d so it never holds the process open, aborted on the stop controller, and cleared from every settle path (both `settleCompletion` branches and `cancelCohort`). The spec asserts the map is empty after a cohort settles by success, by failure, and by cancel, because a stray timer firing against a reused id would file the wrong fate for a different cohort (T-05-06-05).
- **The funding window is genuinely per-cohort, and the 04 clamp still holds.** `LiveTxConfig` gained a per-cohort lookup that takes precedence over the service default and enables the wait on its own, leaving `computeFundingDeadline` and `FUNDING_SLACK_MS` untouched. The deadline still equals the minimum of the window and the remaining cohort TTL less the slack, and it still throws its specific reason before either library timer. The shipped funding specs stay green.
- **`lib/cohort-form`: the ONE module both forms delegate to.** Every rule and every string the create form and the draft-edit form share lives there exactly once, and both forms import it. That is not tidiness. The plan's load-bearing truth is that a validation rule can never be enforced on one path and not the other, and two copies of a rule is precisely how that drift happens. It is pure and React-free, so the copy contract and the minute-to-millisecond conversions are asserted by 23 unit tests rather than by looking at a screen (the 05-05 `serviceControlsView` precedent).
- **An empty timing field is `unset`, never a zero.** The wire key is omitted entirely so the server seeds the draft from its own default. Sending a `0` would mean "no window at all", a completely different instruction and one this service would refuse anyway. The round trip holds in both directions: an absent served window renders as an empty box, which is what keeps "empty means default" consistent.
- **The client validation stops exactly where the client's knowledge stops.** Size, threshold and both window formats are mirrored byte-identically. The shorten-only ceiling is deliberately NOT judged client-side, because it depends on the runner-level cohort TTL the browser is never told: guessing it would either block a legal value or promise one the service cannot keep. The server refuses it and that message renders verbatim in the same inline slot, as a backstop rather than as the primary path.
- **The edit form always opens pre-filled, and from the right defaults.** The component takes the draft itself, so every required field has a value before the first render and there is no blank-form path that could exist. It reads the DRAFT's own captured defaults rather than the service's current ones, because a draft keeps the shape it was made with (D-13): a service default changed later must not silently reshape a draft the operator already reviewed.
- **`Cancel edit` closes the form and nothing else.** Discarding stays the shipped `Discard draft` danger action on the row. A button reading `Cancel` must never destroy anything, and conflating the two would put a destructive outcome behind the gentler word.

## Task Commits

Tasks 1 and 2 are TDD, so each has a RED then a GREEN commit:

1. **Task 1 (RED): failing spec for in-place draft editing** - `36bb540` (test)
2. **Task 1 (GREEN): updateDraft with create-identical validation and a gated PATCH route** - `42f6126` (feat)
3. **Task 2 (RED): failing spec for per-draft timing windows** - `a60b221` (test)
4. **Task 2 (GREEN): per-draft discovery and funding windows with an honest ceiling** - `de9d508` (feat)
5. **Task 3: the in-place draft edit form and the shared Advanced timing expander** - `4cd8f6b` (feat)

## Files Created/Modified

- `packages/service/src/operator-cohorts.ts` - `updateDraft`; both optional window fields on `DraftInput` and the drafts-map entry; the `DraftWindows` split (`explicit` vs `defaults`) so an empty console field stays empty on the way back out instead of being reconstructed by comparison; the two window validation strings and the ceiling guard inside the one `validateDraft`; `armWindowTimer` plus the bounded timer map; the `window-expired` branch in `settleCompletion`.
- `packages/service/src/hono-adapter.ts` - `PATCH /v1/operator/cohorts/:id`, and the additive `defaults` key on the gated list read.
- `packages/service/src/index.ts` - the window threading and the stop-signal wiring for the timer.
- `packages/service/src/runtime-settings.ts` / `packages/service/src/tx.ts` - the default-window seeds, and the per-cohort funding lookup that takes precedence over the service default.
- `packages/service/tests/draft-edit.spec.ts` (new, 23 tests) - validation parity by comparison, the next-cohort-only refusals with the served shape asserted unchanged, the full route matrix (401/400/404/413/200), and the served-defaults block including a per-request read proven by mutating the holder BETWEEN two reads.
- `packages/service/tests/discovery-window.spec.ts` (new) - the shorten-only ceiling, omitted-means-default, the declare-before-stop ordering asserted by an interleaved call log, the timer cleared on all three settle paths, and the per-cohort funding clamp.
- `packages/web/src/lib/cohort-form.ts` (new) - `WindowValue`, `parseWindow`, `msToMinutesText`, `effectiveMs`, the four validation constants, `validateCohortForm`, `windowKeys`, and the three copy builders (`discoveryWindowHelp`, `fundingWindowHelp`, `clampDisclosure`).
- `packages/web/tests/cohort-form.spec.ts` (new, 23 tests) - parsing and unit conversion, the omitted-key wire shape, first-problem-in-render-order, the explicit no-client-ceiling property, both help variants, the clamp disclosure, and a long-dash guard.
- `packages/web/src/components/operator/DraftEditForm.tsx` (new) - the shared `AdvancedTiming` expander (used by both forms) and the pre-filled edit form.
- `packages/web/src/lib/operator.ts` - the four optional window keys on `OperatorCohortDTO`, the two on `DraftInput`, `CohortDefaultsDTO`, the `defaults` key on `OperatorCohortsDTO`, and `updateDraft` with its three-member `UpdateDraftResult`.
- `packages/web/src/stores/operator.ts` - `editingDraftId` / `editStatus` / `editError`, `beginEdit` / `cancelEdit` / `saveDraftEdit`, the `defaults` slice, the two contract strings, and every new field cleared in both `signOut` and `expireSession`.
- `packages/web/src/components/operator/CreateCohortForm.tsx` - now delegates to the shared validator and constants, and renders the same `Advanced timing` expander.
- `packages/web/src/components/operator/OperatorCohortList.tsx` - the `Edit draft` ghost action, the inline form mount, and the edit-not-available reason.

## Decisions Made

- **The lookup precedes the validation on the PATCH route.** Validating first would leak a verdict about a body the caller was never entitled to submit for that cohort.
- **The ceiling is judged server-side only.** Stated above; the browser is never told the runner TTL, so it must not pretend to know it.
- **The edit form uses the draft's captured defaults; the create form uses the service's current ones.** These are genuinely different questions ("what will THIS draft use" vs "what would a new draft inherit"), and answering one with the other's number would be wrong in both directions.
- **The edit-not-available reason renders on advertised rows only.** See the deviation below.
- **`Edit draft` stays enabled while advertising is paused.** Pause is drain mode and gates advertising only (05-04 D-06). Reshaping a draft that is not being offered to anyone is the one moment when editing is unambiguously safe.
- **The row's action group is replaced while editing.** The operator cannot advertise or discard the very draft they are midway through reshaping, and the row's chip, seats and id stay on screen so they can see what they are changing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] The create form had no honest source for the default figure its help interpolates**

- **Found during:** Task 3
- **Issue:** The UI-SPEC contract copy for BOTH forms is `Leave it empty to use this service's default of {n} min.` The edit form can interpolate `{n}` from the draft row's captured defaults, but a cohort that does not exist yet has no row. Nothing on the wire told the browser this service's current window defaults: they live in the 05-04 runtime settings holder, which has no gated read until 05-07. The two available workarounds were both dishonest. Inventing a plausible figure would tell an operator their service does something it may not, and borrowing another draft's captured default would name a value that draft froze at creation and that may no longer apply.
- **Fix:** The gated `GET /v1/operator/cohorts` read gained an additive `defaults` key carrying this service's current window defaults, read from the holder PER REQUEST rather than captured into the app closure (the D-16 service-name lesson, which 05-07 makes load-bearing by letting the operator edit these at runtime). Both keys are spread so an unset default is an ABSENT key, letting the client tell "no default" apart from "a default of nothing"; when absent, the help omits the figure entirely rather than naming one. All three files touched are in the plan's own `files_modified` list.
- **Files modified:** packages/service/src/hono-adapter.ts, packages/web/src/lib/operator.ts, packages/web/src/stores/operator.ts
- **Verification:** three new tests in `draft-edit.spec.ts`, including the per-request property proven by mutating the holder between two reads (a single read would pass just as happily against a boot-time capture, which is the bug under test).
- **Committed in:** `4cd8f6b`

**2. [Rule 1 - Bug] The edit-not-available reason would have been a false statement on a canceled row**

- **Found during:** Task 3
- **Issue:** The plan says to render `Only a draft can be edited. This cohort is already advertised.` on "a non-draft row". Rendered literally on every non-draft row, that sentence appears in the present tense on expired and canceled rows, where it is simply untrue: a canceled cohort is not "already advertised", it was advertised and then ended. Shipping a false sentence to avoid a silent omission trades one honesty failure for a worse one.
- **Fix:** The reason renders on ADVERTISED rows only, where its present tense is literally true and where an operator would actually look for the control and not find it. Terminal rows already carry their own status chip and reason line stating why they are settled, so nothing is silently omitted there either.
- **Files modified:** packages/web/src/components/operator/OperatorCohortList.tsx
- **Verification:** web build, lint and typecheck green; the string is the UI-SPEC copy verbatim.
- **Committed in:** `4cd8f6b`

**3. [Rule 2 - Missing Critical] The shared form copy was assembled inline in JSX, so nothing could assert it**

- **Found during:** Task 3 (reviewing the interrupted session's work)
- **Issue:** The in-progress `AdvancedTiming` built each help caption from a JSX text node plus a conditional string fragment. That is copy nothing can test, and it had already drifted: the same word rendered with a curly apostrophe in one branch (`service’s`) and a straight one in the other (`service's`), within a single caption. This is the generalized form of the lesson this project already learned about em-dashes propagating from authored copy into shipped UI strings.
- **Fix:** Every shared string moved into `lib/cohort-form.ts` as a pure builder, normalized on the UI-SPEC's straight apostrophe, and pinned by unit tests including a long-dash guard. The pure helpers moved with them, following the repo's established convention that pure helpers get their own `lib/` module (`lifecycle.ts`, `operator-rows.ts`, `directory.ts`). This adds one file beyond the plan's `files_modified` list.
- **Files modified:** packages/web/src/lib/cohort-form.ts (new), packages/web/tests/cohort-form.spec.ts (new), packages/web/src/components/operator/DraftEditForm.tsx, packages/web/src/components/operator/CreateCohortForm.tsx
- **Verification:** 23 unit tests; `grep -rlP '\x{2014}'` over both `src` trees returns no files.
- **Committed in:** `4cd8f6b`

---

**Total deviations:** 3 auto-fixed (1 bug, 2 missing critical)
**Impact on plan:** All three serve the plan's stated truths more faithfully than the literal instruction would have. One file was added beyond `files_modified` (`lib/cohort-form.ts`), following existing repo convention. No scope creep and no interface departure that a later plan references.

## Issues Encountered

- **This plan was executed across two sessions.** The first was interrupted partway through Task 3, leaving three committed task commits plus uncommitted web work (the lib client, the store slice, and a first `DraftEditForm`). The resumed session verified the three commits against the plan tasks (tasks 1 and 2 complete, 40 tests passing), reviewed the uncommitted work rather than trusting it, kept the parts that were correct (the client, the store actions, the form structure and its docstrings, all of which were sound), and fixed the copy-assembly problem recorded as deviation 3 before finishing the remaining wiring.
- **No unit test covers the rendered composition of the two forms**, only their pure shared half. The `Edit draft` action, the inline mount, the in-flight disabling and the expander's mode gating are code-verified and exercised by the web build, but whether the edit form reads correctly in place inside a row at a real viewport belongs to the phase's console walkthrough at the end-of-phase gate.

## Known Stubs

None. Every surface added here is wired end to end: `updateDraft` reaches the live gated PATCH route, both timing windows reach real server-side enforcement (the discovery window through an armed timer that genuinely ends cohorts, the funding window through the shipped 04 clamp), the served `defaults` key has a real consumer in the create form's help, and the edit form's every field is pre-filled from served values. Nothing renders a control over a capability that is not behind it, and no placeholder was added for 05-07's settings surface.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/service/tests/draft-edit.spec.ts packages/service/tests/discovery-window.spec.ts` | 43 tests pass |
| `pnpm vitest run packages/web/tests/cohort-form.spec.ts` | 23 tests pass |
| `pnpm test` (full suite, `tsc -b` gated) | 49 files, 719 tests pass |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | clean |
| `pnpm --filter @btcr2-aggregation/web build` | clean |
| `pnpm e2e:operator` | pass (full extended suite: auth, expiry, monitoring, cancel, pause legs) |
| `pnpm e2e:cancel` | pass |
| `pnpm e2e:pause` | pass |
| `pnpm e2e:live:mock` | pass (the D-38 funding wait still advances awaiting-funding to funded for both CAS and SMT) |
| `grep -rlP '\x{2014}' packages/service/src packages/web/src` | no files |
| `grep -c 'function validateDraft' packages/service/src/operator-cohorts.ts` | 1 |
| `grep -rn 'window-expired' packages/service/src` | the declaration site immediately precedes the `stopCohort` call |

## User Setup Required

None. No external service configuration is required. Draft editing and the timing expander render only inside the authenticated console, which exists only on a service booted with `OPERATOR_PASSWORD`. Both timing windows are optional: an operator who never opens the `Advanced timing` expander creates exactly the cohort they always did, seeded from this service's existing env-driven defaults.

## Next Phase Readiness

- **05-07's settings surface has its server half already in place.** The runtime settings holder declares the full field set (05-04), and this plan added the first read path that serves two of its values to the browser. The settings surface should serve the rest through its own gated read rather than widening the cohort-list read further, but the `defaults` key establishes the per-request discipline it must follow.
- **The `lib/cohort-form` module is where any future cohort-shaping field belongs.** The settings surface renders the SAME default beacon type, size and threshold fields the create form does, so it should delegate to this module rather than growing a third copy of those rules, which is the drift this plan exists to prevent.
- **The `window-expired` intent is no longer theoretical**, so any later lifecycle verb that ends a cohort out of band has both a working precedent and a spec proving the declare-before-stop ordering.
- **Carried concern, unchanged from 05-02, 05-04 and 05-05:** a settled cohort (expired, canceled, finalized-then-anchored) still cannot be re-opened from the operator list, because `canOpen` is `isAdvertised || cohort === undefined`. This plan did not touch the ended group, so it remains open; the ended-record dismissal work is its natural home.
- **Carried upstream limit:** the shorten-only ceiling exists only because no timing value in `aggregation@0.4.0` is per-cohort. If a future upstream release makes `cohortTtlMs` per-advertise, the ceiling guard becomes unnecessary and a lengthening window becomes possible; the guard is localized to `validateDraft` so that change would be small.

## Self-Check: PASSED

- Created files verified present on disk: `packages/service/tests/draft-edit.spec.ts`, `packages/service/tests/discovery-window.spec.ts`, `packages/web/src/components/operator/DraftEditForm.tsx`, `packages/web/src/lib/cohort-form.ts`, `packages/web/tests/cohort-form.spec.ts`.
- Commits verified in git history: `36bb540`, `42f6126`, `a60b221`, `de9d508`, `4cd8f6b`.
- Every task acceptance criterion re-run in this session, and the plan-level `<verification>` block re-run in full and green.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*


