---
phase: 05-operator-cohort-lifecycle-control
reviewed: 2026-08-03T21:00:00Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - packages/web/src/stores/operator.ts
  - packages/web/src/lib/operator.ts
  - packages/web/tests/operator.spec.ts
  - packages/service/src/runtime-settings.ts
  - packages/service/src/hono-adapter.ts
  - packages/service/tests/runtime-settings.spec.ts
  - docs/DEPLOY.md
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 5: Code Review Report (re-review after gap-closure round 7)

**Reviewed:** 2026-08-03
**Depth:** deep (cross-file: the whole operator session lifecycle from `probe` / `signIn` / `signOut` / `expireSession` through all four gated reads and all eleven gated action verbs into the components that render the slice; the boot-seed refusal fact traced through `textKnob`, the served DTO, the console caption, the settings route and `docs/DEPLOY.md`)
**Files Reviewed:** 7 (the round-7 delta `31baed2..HEAD`, traced into `packages/web/src/components/operator/OperatorConsole.tsx`, `OperatorCohortList.tsx`, `CreateCohortForm.tsx`, `CohortDetail.tsx`, `LifecycleActions.tsx`, `SettingsView.tsx`, `packages/service/src/operator-auth.ts`)
**Status:** issues_found

## Summary

Baseline reproduced locally: `vitest run packages/web/tests/operator.spec.ts packages/service/tests/runtime-settings.spec.ts` is 2 files / 207 tests green with no source modified. Every claim below that concerns behavior was executed against the shipped store through `bun`, not argued from the source.

**All nine round-7 targets are genuinely closed, and the critical one is closed at the mechanism rather than at the symptom.** CR-03 was reproduced closed: a probe that finds the cookie dead now retires the round and clears the whole gated slice, and the next sign-in computes the console shell's own latch condition (`auth === 'logged-in' && settings === undefined`) as true, so the create form re-reads instead of running on a dead session's defaults. WR-11 is closed by a stored `liveSessionRound` fact rather than by a pre-await status snapshot, and two overlapping probes on a live session now leave the round untouched. IN-11 is closed by one `GATED_SLICE_RESET` spread by both ending paths, and the constant covers all thirty-five non-deliberate fields (checked field by field against `OperatorState`). WR-12 is closed with a discriminated result whose four crossings were each executed: a 401 lands on the honest re-login, a 409 carries the service's own paused sentence into `actionError` on the surface the button lives on, a 404 keeps the verb-specific sentence, and an unreachable service stays distinguishable from one that said no. IN-09's trio is used at exactly the fifteen call sites the plan enumerates. IN-10's status clause is gone from `refreshCohorts`. IN-12, IN-13 and IN-14 are real: the route comment now names `settingsBodyLimitBytes` and both caps, the two boot consequence clauses and both `DEPLOY.md` env rows put the in-session repair before the environment edit, and the in-session repair is a true promise (the acceptance route and `GET /v1/config` both read `runtimeSettings.termsText.value` per request, so setting terms at runtime really does turn the acceptance gate back on).

**The round nevertheless leaves the session-identity law half-held, and the two halves it did not reach are both in code this round rewrote.** The sweep guards the `401` branch of the eleven action verbs and no other branch, so a dead session's SUCCESS or FAILURE still writes into whichever session is live when it lands: reproduced, an advertise issued by session A navigates session B out of the cohort B was looking at and into A's, carrying A's confirmation with it (WR-13). And `submitDraft` is a sixteenth gated call site that the enumeration does not contain: reproduced, a 401 on create renders the service's raw `operator authentication required` string as create-form validation copy and ends no session (WR-14).

Third, the CR-03 fix gave the probe's coarsest branch teeth it did not have. `sessionProbe` folds every non-200/non-404 status into `logged-out`, so a 502 or a 500 on `GET /v1/operator/session` now narrates "Your operator session ended" and discards the console's whole last-known state, four lines above a `catch` branch whose own comment says a transport fault is not evidence a session ended (WR-15). Reproduced.

Non-finding note, outside the reviewed source set: `.planning/phases/05-operator-cohort-lifecycle-control/05-40-SUMMARY.md` ends with two stray tool-markup lines (`</content>`, `</invoke>`) after its self-check block.

## Narrative Findings (AI reviewer)

## Critical Issues

None. No round-7 target regressed, and nothing found in this pass breaks the phase goal or loses data.

## Warnings

### WR-13 (WARNING, NEW): The session-identity sweep guards only the 401 branch of the eleven action verbs, so a dead session's success or failure still writes into the session that replaced it

**File:** `packages/web/src/stores/operator.ts:1283-1292` (`advertise` success), `:1290` (the last `auth`-as-identity comparison in the file), `:1383-1390` (`cancelCohort` unreachable), `:915-919` (`runAdvertisingToggle` success), and the same shape at `:1267-1281`, `:1315-1328`, `:1350-1354`, `:1366-1368`, `:1409-1423`, `:1437-1451`, `:1473-1483`, `:1495-1504`, against the rule stated at `:828-859` and `:361-405`

**Issue:**

The trio's docstring states the rule without qualification: "an answer is evidence about the session that ASKED, never about whichever session happens to be live when it lands". The four gated reads hold it on every branch (`refreshCohorts:1161`, `pollDetail:1679`, `loadSettings:1543`, `saveSettings:1567`). The eleven action verbs hold it on the `unauthorized` branch only. Every other branch writes unconditionally, which means an answer to session A's question lands in session B's console.

Reproduced against the shipped store, no source modified:

```
$ bun /tmp/aba-action.ts
session B round 12 now 12
B view            : {"kind":"detail","cohortId":"A-LIVE-COHORT"}
B advertiseMessage: "Advertised. Now joinable in the directory."
B actionError     : "That action didn't go through. Nothing about this cohort changed."
```

Session B had opened `B-COHORT`. Session A's advertise landed afterwards, wrote A's green confirmation, re-read the list, and then navigated B into A's freshly minted cohort. The last hop is the store's one remaining status-as-identity comparison:

```ts
// operator.ts:1290
if (get().auth === 'logged-in') {
  get().openCohort(result.value);
}
```

`auth === 'logged-in'` is exactly the comparison `sessionRound` exists to replace, in the one place the round left it. The second line of the repro is the failure half: session A's cancel came back 500 and painted `ACTION_FAILED` into a console that canceled nothing, on a surface (`OperatorCohortList.tsx:357`, `LifecycleActions.tsx:226`, `CohortDetail.tsx:507`) that renders it in bad tone.

The window is one click plus one round trip, and it needs a session boundary inside it, so this is narrower than the read paths WR-08 was filed about. It is not cosmetic: the navigation persists until the operator navigates back, and the wrong bad-tone sentence tells them an action they never took did not go through.

**Fix:** the capture already exists at every one of these call sites. Read `stillAsking(get, askedInRound)` once after the await, as `saveSettings:1567` already does, and let all branches read it:

```ts
const result = await apiAdvertise(baseUrl, id);
if (result.kind === 'unauthorized') {
  expireIfStillAsking(get, askedInRound);
  return;
}
// Nothing below this point is evidence about the session that is live now.
if (!stillAsking(get, askedInRound)) {
  return;
}
```

and replace `:1290`'s `get().auth === 'logged-in'` with the same comparison, so the file holds no status-as-identity check at all. Pin it with the ABA shape the round already wrote for the 401 paths, inverted: an `ok` and an `unreachable` answer from an ended session must leave session B's `view`, `advertiseMessage` and `actionError` exactly as B left them, each row paired with a same-session control that still writes.

### WR-14 (WARNING, NEW): `submitDraft` is a sixteenth gated call site the sweep does not contain, and it renders the service's raw 401 body as create-form validation copy

**File:** `packages/web/src/stores/operator.ts:1191-1204`, over `packages/web/src/lib/operator.ts:168` (`CreateDraftResult`) and `:175-196` (`createDraft`), against `packages/service/src/operator-auth.ts:169`, rendered at `packages/web/src/components/operator/CreateCohortForm.tsx:123`

**Issue:**

`UpdateDraftResult` (`lib/operator.ts:208-211`) carries an `unauthorized` member and its docstring says why: "an edit is reachable from a console the operator may have left open past their session, so a 401 must take the one honest re-login path rather than being rendered as a validation failure." Every word of that is equally true of create, and `CreateDraftResult` has no such member. `createDraft` treats a 401 like a 400 and lifts `body.error` verbatim.

Reproduced:

```
$ bun /tmp/create-401.ts
auth = logged-in | createStatus = error | formError = "operator authentication required" | round 3
```

`operator authentication required` is `requireOperator`'s generic denial string (`operator-auth.ts:169`). It is not UI-SPEC copy, it names no field, and it appears in the slot that otherwise holds "Cohort size must be at least 1 signer." The session is not ended and the round is not retired, so the store's own D-16 rule ("a 401 never means two different things") does not hold for the create verb.

The blast radius is bounded by the list poll: the create form only renders on the list view, where `OperatorConsole.tsx:51-57` polls every 4000 ms, so `refreshCohorts` expires the session within a tick and `GATED_SLICE_RESET` now clears `formError` with it. What remains is up to one poll interval of an internal auth string presented as form validation, and one gated call site that the IN-09 enumeration (four reads plus eleven verbs) silently excludes, so a reader checking the claim against the file cannot tell the omission from a decision.

**Fix:** give `CreateDraftResult` the same third member `UpdateDraftResult` has, return it on `res.status === 401`, and branch in `submitDraft` exactly as `saveDraftEdit:1230-1234` already does:

```ts
if ('unauthorized' in result) {
  expireIfStillAsking(get, askedInRound);
  return;
}
```

Then either add `submitDraft` to the trio docstring's enumeration or state why it is exempt. Pin with the row shape `saveDraftEdit` already has: a 401 create leaves `auth === 'logged-out'` with `SESSION_EXPIRED` and `formError` undefined.

### WR-15 (WARNING, NEW, given teeth by this round): A 5xx on the session probe now narrates an expiry that never happened and throws away the console's last-known state

**File:** `packages/web/src/stores/operator.ts:996-1011` (the ended branch this round added), over `packages/web/src/lib/operator.ts:50-63` (`sessionProbe`), against the sibling branch at `:1019-1029` and the shipped rule at `packages/web/src/lib/operator.ts:564-568`

**Issue:**

`sessionProbe` maps 200 to `logged-in`, 404 to `disabled`, and **everything else** to `logged-out`. A 500, a 502 from a reverse proxy mid-reload, or a 503 from a load balancer is therefore indistinguishable from a 401 by the time the store sees it. Before this round that mattered little: the branch set a status. Now it calls `expireSession()`, which retires the round, writes the SESSION_EXPIRED sentence and clears the entire gated slice.

Reproduced:

```
$ bun /tmp/probe-5xx.ts
after a 502 probe: auth = logged-out | error = "Your operator session ended. Sign in again to keep monitoring. ..."
  cohorts [] health undefined settings undefined view {"kind":"list"} round 2
```

The service never said the session ended. Four lines below, the `catch` branch makes precisely the opposite decision on the same class of event, and says so: "A transport fault is NOT evidence that a session ended, so this path claims no expiry (the copy below stays the unreachable line)." A 502 is as much a transport fault as a thrown fetch; it differs only in having reached a proxy. Every other read in this codebase already draws that line at the right place, in the words of `fetchCohortDetail`: "A non-401 non-ok (e.g. 500/502) is a transient fault, not a session change: freeze the last-known view rather than logging the operator out (D-25)."

The harm is a false claim in the console's most load-bearing sentence plus the loss of the frozen last-known state D-25 exists to preserve, on the one path an operator meets after a service hiccup.

**Fix:** widen `SessionState` so the probe can tell the two apart, and keep `expireSession` for the answer that proves an expiry:

```ts
export type SessionState = 'logged-in' | 'logged-out' | 'disabled' | 'unreachable';
// sessionProbe: 200 -> logged-in, 404 -> disabled, 401 -> logged-out, anything else -> unreachable
```

then route `unreachable` into the same branch the `catch` already takes (clear the slice, no expiry claim, the UNREACHABLE line). Pin with a row per status: a 401 probe on a live console expires with the session-expired copy, a 502 probe on the same console leaves the unreachable copy and makes no expiry claim.

## Info

### IN-15 (INFO, NEW): `probe`'s session-START branch takes no capture, so a probe answer landing after an expiry re-establishes a phantom session

**File:** `packages/web/src/stores/operator.ts:976-995`, against the documented exception at `:846-854`

**Issue:** the trio's docstring names "`probe`'s session-ended branches" as the ONE documented exception. The session-STARTED branch is exempt too, and is not named: it decides only from `liveSessionRound === undefined` read at landing time, which cannot distinguish "nobody was ever signed in" from "a session ended one millisecond ago".

Reproduced with a list read and a probe in flight together, the read answering 401 first:

```
$ bun /tmp/probe-resurrect.ts
after the 401 : auth= logged-out round= 6 live= undefined error= "Your operator session ended. S"
after the probe: auth= logged-in round= 7 live= 7 error= "Your operator session ended. ..." cohorts= []
```

The console leaves the honest re-login screen and re-enters a signed-in shell for a cookie the service has already refused, still carrying the expiry copy in `error`. It self-heals on the phantom session's own first read (another 401, another expiry), so the visible cost is a flicker, and the interleaving needed to reach it is narrow (an action or read cannot be started during the probe's own `checking` window, so the 401 must come from a request issued before the probe). Recorded because the exemption taken is wider than the exemption written down, which is the exact complaint IN-09 filed against the previous arrangement.

**Fix:** capture the round in `probe` as well, and start a session only when the console has not crossed a boundary since the question was asked, or state this second exemption in the docstring beside the first.

### IN-16 (INFO, NEW): The fourth statement of the refused-seed fact still names shortening as the only repair, in the file this round edited

**File:** `docs/DEPLOY.md:358`, against `:510` and `:516` (both corrected by this round) and `packages/service/src/runtime-settings.ts:833-844`

**Issue:** 05-41's own recorded pattern is "when a plan corrects a statement of fact, the first question is how many statements of that fact exist; a repo-wide search for the corrected claim costs one command". The search found the two env-table rows and missed the prose section fourteen lines earlier:

> A boot value above it is ignored with a warning and is never truncated to fit, because a truncated document is one participants would DID-sign in mutilated form; **until you shorten it, the join flow has no terms step at all.**

That is the WR-10/IN-13 overclaim verbatim, and it contradicts the same section's own opening sentence ("Set `TERMS_TEXT` at boot, or the participation terms field in the settings surface at runtime"), three paragraphs apart.

**Fix:** carry the same split into that sentence ("the join flow has no terms step until you set the participation terms in the settings surface, and shortening `TERMS_TEXT` is what makes a restart keep them").

### IN-17 (INFO, NEW): Both new consequence clauses promise a settings surface that a fail-closed boot does not mount

**File:** `packages/service/src/runtime-settings.ts:823-824` and `:839-841`, against `packages/service/src/hono-adapter.ts:828` and `:903`

**Issue:** the settings routes are registered inside `if (operatorAuth)`, so a service booted with no `OPERATOR_PASSWORD` (the documented fail-closed posture, D-07) has no `GET`/`PUT /v1/operator/settings` and no console to reach them from. The refusal warnings are emitted by the holder either way, so that boot prints "Set the participation terms in the operator settings surface to restore the acceptance step for this session" to an operator who has no such surface. The environment half of each sentence is still true, so the line is misleading rather than wrong, and the same boot already prints a loud no-operator-password warning next to it.

**Fix:** either pass the holder a bit saying whether the operator surface is mounted and drop the in-session clause when it is not, or leave it and note the dependency in the clause ("in the operator settings surface, when this service has an operator password set").

### IN-18 (INFO, NEW): `GATED_SLICE_RESET`'s nested values are shared instances written into state on every session end

**File:** `packages/web/src/stores/operator.ts:786-826` (`cohorts: []`, `rows: []`, `operatorActions: []`, `view: { kind: 'list' }`)

**Issue:** the constant is spread, so its top-level keys are copied, but the four nested values are the SAME objects on every `signOut` and every `expireSession`, and they land in live store state. Nothing mutates them today (checked: no `sort`, `reverse`, `splice` or `push` against a store array in `packages/web/src/components/operator/*` or `lib/operator-rows.ts`, which builds a fresh grouped structure). The hazard is that the first in-place mutation anywhere, an in-place sort of `rows` in a future list surface being the obvious one, would corrupt the constant itself and every later reset would carry the corruption, with the bug appearing in a session that never ran the mutating code.

**Fix:** make it a factory (`function gatedSliceReset(): Partial<OperatorState>`) so each reset gets fresh instances, or deep-freeze the constant in development. Either keeps the one-list property IN-11 bought.

## Known-deferred (owner scoped OUT, re-observed, NOT findings)

Re-checked against the shipped tree and unchanged. Listed for the planning record only, per the round's own prohibitions:

- Review WR-03 (`validateDraft` accepts a non-whole-minute window), WR-04 (the provenance barrier stops at `LifecycleActions`), WR-05 (`lastUpdated` carries two freshness facts).
- Review IN-01 (`numericKnob`'s bare `Number()` coercion), IN-02 (`parseWindow` has no upper bound).
- The endpoint verdict cache never cleared in shipped code, `tx-client.ts`'s missing `AbortSignal.timeout`, the unbounded `verdictCache` module singleton, the `/cas` prototype-pollution 500, the test-peer seat cap.
- Seat reclaim (upstream), the 16 pending human items in `05-UAT.md`, and `.planning/REQUIREMENTS.md` row states.

## Verification of the round-7 fixes

Each one checked in the shipped code and, where behavior was claimed, executed.

- **CR-03: FIXED, and at the mechanism.** `probe`'s three non-live outcomes route through `expireSession()` whenever `liveSessionRound` is set (`operator.ts:996-1011`, `:1019-1025`), and the 404 branch lands the disabled notice AFTER the clear so the fail-closed message survives. Executed the round-6 repro: after the probe, `cohorts []`, `health undefined`, `settings undefined`, `detail undefined`, `view {"kind":"list"}`, `operatorActions []`, `lastUpdated undefined`, round retired; after the next `signIn`, the shell's own latch condition computes true, so the create form re-reads. The eight rows at `operator.spec.ts:1858-2127` stage a populated console through the shipped paths first and assert the clear field by field, with three anti-vacuity controls beside them (a confirming probe clears nothing, a probe on a console holding no session ends nothing, a returning session still takes a fresh round).
- **WR-11: FIXED with a stored fact, not a snapshot.** `liveSessionRound` (`:406-426`) is set beside every session start (`signIn:1042-1043`, `probe:985-986`), cleared by `GATED_SLICE_RESET:790` so both ending paths drop it, and cleared by `signIn`'s three non-200 branches so the status and the fact cannot disagree in a state a test can construct. Executed: two overlapping confirming probes leave the round at 40 and the session live. The `wasLive` pre-await capture is gone from the file.
- **IN-11: FIXED, and the list is complete.** `GATED_SLICE_RESET:786-826` holds thirty-five fields; I enumerated `OperatorState` against it and the only omissions are the three deliberate ones (`auth`, `sessionRound`, `error`), each named in the constant's docstring with its reason. The parity row (`operator.spec.ts:479-490`) compares the WHOLE state after each ending path with those three excluded BY NAME through a `keyof OperatorState`-checked list, so a field added to one path shows up as a difference. The five fields the expiry path used to miss are pinned by two further rows driving real advertise and create failures through the shipped paths first.
- **WR-12: FIXED, all four crossings executed.** `AdvertiseActionResult` / `ReadvertiseActionResult` (`lib/operator.ts:1119-1133`) add `refused` and `declined` to the shared vocabulary, and neither helper can throw. Executed: 401 leaves `auth: logged-out` with `SESSION_EXPIRED` and `formError` undefined; 409 renders `That action didn't go through: advertising is paused on this service. Nothing about this cohort changed.` on both verbs; 404 keeps `Could not advertise the draft. Try again.`; a thrown fetch keeps the unreachable line, so a service that refused stays distinguishable from one that could not be reached. The failures land in `actionError`, which `OperatorCohortList.tsx:357` renders above the rows whose buttons raise it; `formError` is untouched in both directions. The two preserved sentences are byte-identical named constants rather than re-typed literals.
- **IN-09: FIXED by the shared implementation rather than by a docstring.** `askingRound` / `stillAsking` / `expireIfStillAsking` (`:860-878`) are used at exactly fifteen sites; I counted the captures in the file (`:901, 1104, 1219, 1253, 1307, 1342, 1360, 1374, 1401, 1429, 1465, 1489, 1528, 1560, 1649`) and they match the plan's enumeration. The one documented exception is stated in the trio's docstring with its reason. Two residual gaps are filed above: the sweep covers only the `401` branch of the action verbs (WR-13), and the enumeration omits `submitDraft` (WR-14).
- **IN-10: FIXED, and the two comments now agree.** `refreshCohorts:1161` compares the round alone, matching `pollDetail`, `loadSettings` and `saveSettings`; the guard's closing paragraph enumerates the two things it rejects and says what happened to the third, instead of contradicting the 401 branch above it.
- **IN-12: FIXED.** The route comment (`hono-adapter.ts:905-920`) names `settingsBodyLimitBytes` and both caps, with the reason (the console posts the whole form, so the largest legal body carries both fields at their cap). The `bodyLimit` call itself is unchanged, and the non-comment diff on that file is empty.
- **IN-13: FIXED in all three statements, and the promise is true.** Both `consequence` clauses (`runtime-settings.ts:823-824`, `:839-841`) state the cost, then the in-session repair, then the environment edit, in the caption's order; `DEPLOY.md:510` and `:516` carry the same split. I verified the in-session repair is a real remedy rather than a nicer sentence: `hono-adapter.ts:807` passes `runtimeSettings?.termsText.value` to the acceptance route per request and `:636` serves it on `GET /v1/config` per request, so a runtime save genuinely turns the SVC-05 acceptance gate back on without a restart. The ordering rows (`runtime-settings.spec.ts:1275`) compare positions inside the composed line and require both to be found, so a comparison between two absent substrings cannot pass; the within-cap control (`:1310`) keeps them about the refusal path. One statement of the fact was missed (IN-16).
- **IN-14: CLOSED AS DOCUMENTED, and the documentation is checkable.** `settingsBodyLimitBytes`'s docstring (`:416-435`) states which length the budget charges, names the alternative not taken and why it is disproportionate, and points at the rows that measure the gap. The three rows (`runtime-settings.spec.ts:1533-1560`) prove both halves (the holder accepts the padded value and stores it at the cap with no warning; the transmitted body exceeds the budget) plus the unpadded control, so the exception is a measured fact rather than a rationale.

---

_Reviewed: 2026-08-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
