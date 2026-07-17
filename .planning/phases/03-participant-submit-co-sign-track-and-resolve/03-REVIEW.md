---
phase: 03-participant-submit-co-sign-track-and-resolve
reviewed: 2026-07-17T22:33:57Z
depth: deep
files_reviewed: 23
files_reviewed_list:
  - e2e/browser-participant-cohort.ts
  - packages/participant/src/index.spec.ts
  - packages/participant/src/index.ts
  - packages/service/src/anchor-state.spec.ts
  - packages/service/src/anchor-state.ts
  - packages/service/src/hono-adapter.ts
  - packages/service/src/index.ts
  - packages/service/src/operator-cohorts.spec.ts
  - packages/service/src/operator-cohorts.ts
  - packages/web/src/App.tsx
  - packages/web/src/components/browse/BrowseView.tsx
  - packages/web/src/components/browse/CohortRow.tsx
  - packages/web/src/components/browse/DirectoryList.tsx
  - packages/web/src/components/browse/JoinIdentityStep.tsx
  - packages/web/src/components/cohort/CohortPage.tsx
  - packages/web/src/components/cohort/CompletionSummary.tsx
  - packages/web/src/components/cohort/StageTimeline.tsx
  - packages/web/src/components/cohort/SubmitPanel.tsx
  - packages/web/src/lib/anchor.ts
  - packages/web/src/lib/directory.ts
  - packages/web/src/lib/types.ts
  - packages/web/src/stores/participant.spec.ts
  - packages/web/src/stores/participant.ts
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-17T22:33:57Z
**Depth:** deep
**Status:** issues_found

## Summary

This is a RE-REVIEW after gap-closure plan 03-07 landed the CR-01 (post-seat gone streak) and WR-01 (four-way anchor narration) fixes. Both prior findings verify as CLOSED under deep analysis:

- **CR-01 (post-seat poll-vs-SSE race) is closed.** `handlePostSeatSnapshot` now requires `POST_SEAT_GONE_CONFIRMATIONS` (2) consecutive gone reads before declaring a seated cohort dead (`participant.ts:1378-1402`), and `clearPostSeatPoll` (invoked by `teardownLive`, which every terminal path calls) resets both `postSeatGoneStreak` and `postSeatEpoch` (`:494-505`). A racing `cohort-complete` SSE tears the poll down and zeroes the streak before a second gone read can accumulate, so a completed cohort's normal directory-drop can no longer false-fail a genuine success or discard the sidecar. A present read resets the streak, so directory flapping never reaches the threshold. The `postSeatCohortGone` (absent-entirely) predicate stays correctly distinct from the pre-seat `pickedCohortClosed` (left-Advertised).
- **WR-01 (mode-dishonest completion copy) is closed at the source.** `anchorSummaryState` maps every read to `hermetic | anchored | broadcasting | broadcast-failed` (`participant.ts:686-699`), and `shouldAutoResolve` now returns true on `state === 'failed'` (`:711-719`) so a failed live broadcast still reaches a resolve outcome instead of freezing. `CompletionSummary` branches on all four states with honest copy (`CompletionSummary.tsx:94-110`), and the store specs pin every case.

The two closures hold. Deep cross-component tracing, however, shows the WR-01 fix did not fully propagate: `CompletionSummary`'s null-anchor default and `StageTimeline`'s enabled-only relabel still make the "no-broadcast" / premature-"Anchored" claim WR-01 was meant to eliminate, in adjacent render paths. Two findings from the pre-03-07 review that were OUT of the gap scope also remain open (operator draft has no size ceiling; a fast-path step regression). Security posture is unchanged and solid: the anonymous `/v1/anchor/:cohortId` read is guarded, non-oracle, chain-free, bounded, and mounted outside operator auth; the explicit-submit gate builds once and never rejects.

No `<structural_findings>` block was provided; all findings below are narrative.

## Warnings

### WR-01: CompletionSummary defaults a null anchor to the hermetic "does not publish to Bitcoin" narration (transient WR-01 reassertion on the live path)

**File:** `packages/web/src/components/cohort/CompletionSummary.tsx:76,105-110`, `packages/web/src/stores/participant.ts:686-699`
**Issue:** `anchorSummaryState(null)` returns `'hermetic'`, and `CompletionSummary` renders immediately on `status === 'complete'` while `anchor` is still `null` (the anchor poll is started by `trackAnchor` in the same `cohort-complete` handler, but its first `fetchAnchor` resolves asynchronously, so at least one render happens with `anchor === null`). For that window on a LIVE broadcasting service the summary asserts "Signed. This no-broadcast service does not publish to Bitcoin, so there is no on-chain anchor to show." and the round-trip card shows the `anchorEnabled === false` copy "Resolving to the genesis document...". That is exactly the false hermetic claim WR-01 set out to kill, reasserted for the pre-first-read window. The root cause is that `anchorSummaryState` collapses "not yet read" (`null`) and "read: not broadcasting" (`enabled: false`) into one `hermetic` state.
**Fix:** Give the null case its own neutral state instead of committing to hermetic, mirroring `SubmitPanel`'s `enabled === undefined` "Checking this service's broadcast mode" handling:
```ts
export function anchorSummaryState(
  anchor: AnchorDTO | null,
): 'checking' | 'anchored' | 'broadcasting' | 'broadcast-failed' | 'hermetic' {
  if (anchor === null) return 'checking';
  if (!anchor.enabled) return 'hermetic';
  // ...unchanged
}
```
Render a neutral "Confirming this service's broadcast mode" line for `'checking'` until the first anchor read lands.

### WR-02: StageTimeline relabels the final stage "Anchored" on any enabled service, including a still-broadcasting or FAILED broadcast

**File:** `packages/web/src/components/cohort/StageTimeline.tsx:130,152`
**Issue:** `liveAnchor = anchor?.enabled === true` drives `label = item.key === 'signed' && liveAnchor ? 'Anchored' : item.label`, so the final timeline row reads "Anchored" whenever the service broadcasts, regardless of the actual anchor `state`. On a `broadcast-failed` cohort (`enabled: true, state: 'failed'`) the row shows a pulsing (and, once `resolveStatus === 'resolved'`, good-tone) "Anchored" header even though the beacon broadcast terminally failed and there is no confirmed anchor. This contradicts the four-way honesty the WR-01 fix added to `CompletionSummary` (which keeps the `anchored` boolean false and renders the `broadcast-failed` copy). The `AnchorSubSteps` do mark the Broadcast sub-step bad-tone, but the dominant row header still claims "Anchored", so the timeline makes an on-chain-anchor claim the summary explicitly disclaims: the same defect class WR-01 targeted, one component over. The `broadcasting` (`state: 'none'`) sub-state has the same premature-"Anchored" problem.
**Fix:** Relabel and tone the final row from the same four-way state the summary uses, not from `enabled` alone:
```ts
const summary = anchorSummaryState(anchor);
const label = item.key === 'signed'
  ? (summary === 'anchored' ? 'Anchored' : item.label)
  : item.label;
```
Only render "Anchored" for the `anchored` case; keep "Signed" (or a broadcast/failed label) otherwise.

### WR-03: No upper bound on operator draft cohort `size` (carried forward from the pre-03-07 review, still open)

**File:** `packages/service/src/operator-cohorts.ts:272-274` (`validateDraft`)
**Issue:** `validateDraft` guards only the lower bound: `if (!Number.isInteger(size) || size < 1) throw SIZE_ERROR`. There is no maximum. An authenticated operator (or a fat-fingered form value, e.g. `size: 1000000`) reaches `buildCohortConfig(size, ...)` and `config.maxParticipants = size`, handing the library a cohort that can never fill and whose n-of-n structures scale with n. Every other unbounded collection in the module is deliberately capped (`MAX_TERMINAL = 24`, the anchor `MAX_TERMINAL`, the dashboard `MAX_COHORTS`); the cohort-size input is the one left open. Operator-authenticated, so not remotely exploitable, but a single typo can wedge the runner. 03-07 was scoped to CR-01/WR-01, so this was not addressed.
**Fix:** Add a sane upper bound with a user-facing message, mirroring the existing guard style:
```ts
const MAX_COHORT_SIZE = 100; // or the protocol's practical n-of-n ceiling
if (!Number.isInteger(size) || size < 1 || size > MAX_COHORT_SIZE) {
  throw new Error(`Cohort size must be a whole number between 1 and ${MAX_COHORT_SIZE}.`);
}
```

### WR-04: SubmitPanel renders a literal `&apos;` when the beacon-address fallback is used (carried forward, still open)

**File:** `packages/web/src/components/cohort/SubmitPanel.tsx:137`
**Issue:** `{beaconAddress ?? 'this cohort&apos;s beacon'}` places `&apos;` inside a JavaScript string literal (the `??` fallback), not JSX text. React renders string children verbatim without HTML-entity decoding, so when `beaconAddress` is null the live-broadcast consent line shows the literal text `this cohort&apos;s beacon` (ampersand-apos-semicolon) instead of an apostrophe. In normal flow `beaconAddress` is set by the `cohort-ready` handler before the submit window opens, so this defensive branch is effectively unreachable today, but it renders broken copy if the ordering ever changes. Flagged in the prior review (IN-02) and not fixed by 03-07.
**Fix:** Use a plain apostrophe in the JS string (surrounding JSX text can keep `&apos;`):
```tsx
{beaconAddress ?? "this cohort's beacon"}
```

## Info

### IN-01: Live broadcast/none path shows "Resolving your updated DID..." while no resolution is running

**File:** `packages/web/src/components/cohort/CompletionSummary.tsx:133-138`, `packages/web/src/stores/participant.ts:711-719`
**Issue:** On a live service whose beacon is `broadcast` (accepted) or `none` (broadcasting), `shouldAutoResolve` returns false (correctly: the beacon is not yet mined, so resolution would not find the appended beacon). Meanwhile `resolveStatus` stays `idle` and the round-trip card renders "Resolving your updated DID..." for the entire broadcast-to-confirm interval (minutes on mutinynet) even though no `resolve()` call is in flight. The copy implies active work that is not happening; the honest state is "waiting for the beacon to confirm before resolving".
**Fix:** Branch the pending copy on whether a resolve is actually in flight versus waiting on the anchor, e.g. show "Waiting for the beacon transaction to confirm before resolving" when `anchorEnabled && resolveStatus === 'idle' && !shouldAutoResolve(anchor)`.

### IN-02: `StageInput.optedIn` is threaded everywhere but never read by `deriveStage` (carried forward)

**File:** `packages/web/src/stores/participant.ts:597-605,622-643`
**Issue:** `StageInput` declares `optedIn`, and every caller (`App.tsx:55`, `CohortPage.tsx:113`, `BrowseView.tsx:53`) threads it in, but `deriveStage` never references `state.optedIn`. It is a dead input field: harmless, but it implies a dependency that does not exist and invites a future reader to assume `optedIn` affects the stage. Unchanged since the prior review.
**Fix:** Either drop `optedIn` from `StageInput` and the call sites, or add a comment stating it is retained for symmetry with the store slice but is not part of the derivation.

### IN-03: `createDraft` on a null / non-object body surfaces a raw `TypeError` as the 400 body (carried forward)

**File:** `packages/service/src/hono-adapter.ts:357-373`, `packages/service/src/operator-cohorts.ts:264-268`
**Issue:** The route parses JSON then calls `operatorCohorts.createDraft(body as DraftInput)` inside a try/catch that returns `err.message` as the 400 body. `validateDraft` destructures `const { beaconType, size, threshold } = input;` before any shape check, so a JSON `null` or a non-object body throws `Cannot destructure property 'beaconType' of ... as it is null`, returned verbatim. Operator-authenticated and not sensitive, but the message is an internal detail rather than the intended user-facing validation copy. Unchanged since the prior review.
**Fix:** Guard the body shape first: `if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('expected a JSON object { beaconType, size, threshold }');` before destructuring.

### IN-04: `join()` fast-path re-sets the `join` step to `active` after `cohort-joined` already completed it (carried forward)

**File:** `packages/web/src/stores/participant.ts:1197-1205`
**Issue:** On a fast (hermetic / in-process) path, `cohort-joined` can fire DURING `participant.start()`, setting `steps.join = 'done'` and `steps.submit = 'active'` and `optedIn = true`. The post-`start()` re-check only short-circuits on seated / complete / failed; for an opted-in-but-not-yet-seated round it falls through and runs `setStep('join', 'active')`, regressing `join` from `done` back to `active`. `deriveStage` reads only `steps.submit`, so the regression is cosmetically invisible today, but it is a real state inconsistency (and `failActiveStep` would then treat `join` as the mid-flight step on a later failure). Unchanged since the prior review.
**Fix:** Include `get().optedIn` in the early-return guard, or only set `join` active when it is not already `done`.

### IN-05: `Expander` collapsible is duplicated across three cohort-page render sites

**File:** `packages/web/src/components/cohort/CohortPage.tsx:54-78`, `packages/web/src/components/cohort/CompletionSummary.tsx:33-48`, `packages/web/src/components/cohort/SubmitPanel.tsx:114-130`
**Issue:** Two near-identical `Expander` components (same markup, same `max-h-80 overflow-auto` body, same uppercase header button) are defined independently in `CohortPage` and `CompletionSummary`, and `SubmitPanel` inlines a third copy of the same collapsible pattern. Low-risk duplication that invites drift: the `CompletionSummary` variant already lacks the `defaultOpen` prop the `CohortPage` one carries.
**Fix:** Extract a single shared `Expander` primitive (e.g. into `ui/primitives`) and import it in all three sites.

---

_Reviewed: 2026-07-17T22:33:57Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
