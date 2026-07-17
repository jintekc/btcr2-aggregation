---
phase: 03-participant-submit-co-sign-track-and-resolve
reviewed: 2026-07-17T00:00:00Z
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
  critical: 1
  warning: 2
  info: 4
  total: 7
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-17
**Depth:** deep
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Reviewed the Phase-3 participant submit / co-sign / track / resolve slice at deep depth: the opt-in explicit-submit gate (`participant/src/index.ts`), the public anonymous `GET /v1/anchor/:cohortId` read (`anchor-state.ts` + `hono-adapter.ts`), the in-flight directory widening (`operator-cohorts.ts`), the pure-`deriveStage` participant store (`web/src/stores/participant.ts`), and the cohort-page UI.

Security posture is solid on the headline concern: the new anchor route is mounted OUTSIDE the operator-auth block, is anonymous, drops the raw broadcast error for a generic reason, guards the cohortId with a cheap regex before any lookup, answers unknown ids with `state:'none'` (no existence oracle), never touches the chain, and bounds its retained map (T-03-02-* all hold). It does NOT weaken ADR-0015 operator gating. The explicit-submit gate correctly builds the body once, never rejects, and runs the baked-mismatch decline before the gate.

The problems are on the participant-store lifecycle and the mode-honest completion copy, not on the security surface:

- One BLOCKER: a race between the post-seat directory poll and the `cohort-complete` SSE can turn a genuinely SUCCESSFUL cohort into a false terminal failure and discard the captured sidecar.
- Two WARNINGs: the completion copy claims "no-broadcast service" for a broadcasting service whose anchor is not yet (or never) confirmed; and the operator draft form has no upper bound on cohort size.
- Four INFO items (dead struct field, a latent literal-entity string, a raw-TypeError 400 body, a cosmetically-masked step regression).

No `<structural_findings>` block was provided, so there is no fallow substrate to reconcile; all findings below are narrative.

## Critical Issues

### CR-01: Post-seat directory poll can false-fail a SUCCESSFUL cohort and discard the participant's result

**File:** `packages/web/src/stores/participant.ts:1015-1037` (post-seat poll) and `:1319-1341` (`handlePostSeatSnapshot`), with `packages/service/src/operator-cohorts.ts:378-403` (`directory()`)

**Issue:** After a participant is seated, `cohort-ready` starts `postSeatPoll`, which every 5s fetches the public directory and calls `handlePostSeatSnapshot`. That handler treats "picked cohort absent from the directory entirely" as a terminal failure:

```
if (postSeatCohortGone(rows, pickedCohortId)) {
  fail("The cohort ended and this service didn't say why.");
  return;
}
```

But on the service side, `directory()` excludes a cohort the instant its phase leaves `DISPLAY_PHASES` (`operator-cohorts.ts:385-388`). When a cohort finishes signing, its phase transitions to `Complete` (not in `DISPLAY_PHASES`), so `directory()` stops listing it. That transition and the participant's `cohort-complete` SSE both originate from the same completion but travel over different channels with no ordering guarantee. If a `postSeatPoll` `fetchDirectory` resolves in the window after the phase flips to `Complete` but before the browser processes `cohort-complete`, then:

- `status` is still `'live'` and `seated` is still `true`, so the guard at `:1324` does not short-circuit,
- `postSeatCohortGone` returns `true` (the cohort is gone from the directory),
- `fail(...)` runs -> `status:'failed'`, `teardownLive()` stops the runner and nulls `live`.

Once the runner is stopped, the pending `cohort-complete` is never processed, so the `result`/`sidecar`/`captured` artifacts (`:1060-1102`) are never built. A participant who really co-signed a 64-byte aggregate signature is shown "The cohort ended and this service didn't say why." and loses their downloadable sidecar. The epoch/`status !== 'live'` guards only protect the case where `cohort-complete` wins the race; they do not protect the case where the poll wins.

**Fix:** Do not treat "absent from the directory" as terminal for a seated member without corroboration that the cohort actually failed (a completed cohort legitimately disappears). Options:

```ts
// Require the cohort-gone signal to persist across consecutive polls AND that no
// cohort-complete has landed, so a completed cohort's normal directory-drop is not
// mistaken for a stall. Reset the counter on any present read.
handlePostSeatSnapshot(rows) {
  const { status, seated, pickedCohortId } = get();
  if (!seated || pickedCohortId === null || status !== 'live') return;
  if (postSeatCohortGone(rows, pickedCohortId)) {
    postSeatGoneStreak += 1;
    if (postSeatGoneStreak < POST_SEAT_GONE_CONFIRMATIONS) return; // e.g. 2-3 polls
    append('warn', `cohort ${pickedCohortId} left the directory before completing`);
    fail("The cohort ended and this service didn't say why.");
    return;
  }
  postSeatGoneStreak = 0;
  if (get().unreachable) set({ unreachable: false });
}
```

A cleaner alternative: gate the post-seat "gone" terminal on the runner having NOT emitted `cohort-complete` (e.g. only fail from a small delayed timer that a subsequent `cohort-complete`/`cohort-failed` cancels), so the SSE always wins even when the poll observes the completion drop first.

## Warnings

### WR-01: Completion copy claims "no-broadcast service" on a broadcasting service whose anchor is not confirmed

**File:** `packages/web/src/components/cohort/CompletionSummary.tsx:72, 86-98` (and the derivation seam `packages/web/src/stores/participant.ts:605-626`)

**Issue:** `anchored` is computed as `anchor?.enabled && (state === 'confirmed' || state === 'broadcast')`, and the Signed line branches on it:

```tsx
{anchored ? (
  <p>Signed and anchored on {netLabel}.</p>
) : (
  <p>Signed. This no-broadcast service does not publish to Bitcoin, so there is no on-chain anchor to show.</p>
)}
```

On a LIVE broadcasting service (`anchor.enabled === true`), the anchor read is transiently `state:'none'` right after `cohort-complete` (the beacon tx has not been broadcast yet) and is permanently `state:'failed'` if the broadcast fails. In both cases `anchored` is `false`, so the page asserts "This no-broadcast service does not publish to Bitcoin" about a service that DOES broadcast. This is a mode-honesty violation (the exact posture D-07 is meant to protect) and it directly contradicts `StageTimeline`, which for `anchor.enabled === true` relabels the final row "Anchored" and renders the Signed/Broadcast/Confirmed sub-steps (`StageTimeline.tsx:130,152-154,70-108`). The user sees "Anchored / Broadcast pending" in the timeline and "no-broadcast service" in the summary simultaneously.

The `failed` case is worse than transient: `shouldAutoResolve` returns `false` for `enabled + 'failed'` (`participant.ts:660-668`), so auto-resolve never fires and the poll freezes (`:1297`), leaving the participant permanently on the "no-broadcast service" copy with no resolve outcome for a broadcast that actually failed.

**Fix:** Branch the Signed-line copy (and `deriveStage`'s `signed`/`anchored` decision) on `anchorEnabled`, not on `anchored`, adding the missing middle case:

```tsx
{anchored ? (
  <p>Signed and anchored on {netLabel}.</p>
) : anchorEnabled ? (
  anchor?.state === 'failed'
    ? <p>Signed. The beacon broadcast failed; retry from the operator or resolve later.</p>
    : <p>Signed. Broadcasting the beacon transaction to {netLabel}...</p>
) : (
  <p>Signed. This no-broadcast service does not publish to Bitcoin, so there is no on-chain anchor to show.</p>
)}
```

### WR-02: No upper bound on operator draft cohort `size`

**File:** `packages/service/src/operator-cohorts.ts:272-274` (`validateDraft`)

**Issue:** `validateDraft` guards only the lower bound: `if (!Number.isInteger(size) || size < 1) throw SIZE_ERROR`. There is no maximum. An authenticated operator (or a fat-fingered form value, e.g. `size: 1000000`) reaches `buildCohortConfig(size, ...)` and `config.maxParticipants = size`, handing the library a cohort that can never fill and whose n-of-n structures scale with n. The rest of the module carefully bounds every other unbounded collection (`MAX_TERMINAL = 24`, the anchor `MAX_TERMINAL`, the dashboard `MAX_COHORTS`) precisely to avoid this class of issue; the cohort-size input is the one that is left open. The surface is operator-authenticated, so this is not remotely exploitable, but a single typo can wedge the runner.

**Fix:** Add a sane upper bound with a user-facing message, mirroring the existing guard style:

```ts
const MAX_COHORT_SIZE = 100; // or the protocol's practical n-of-n ceiling
if (!Number.isInteger(size) || size < 1 || size > MAX_COHORT_SIZE) {
  throw new Error(`Cohort size must be a whole number between 1 and ${MAX_COHORT_SIZE}.`);
}
```

## Info

### IN-01: `StageInput.optedIn` is passed everywhere but never read by `deriveStage`

**File:** `packages/web/src/stores/participant.ts:580-588, 605-626`

**Issue:** `StageInput` declares `optedIn`, and every caller (`App.tsx:55`, `CohortPage.tsx:113`, `BrowseView.tsx:53`) threads it in, but `deriveStage` never references `state.optedIn`. It is a dead input field: harmless, but it implies a dependency that does not exist and invites a future reader to assume `optedIn` affects the stage.

**Fix:** Either drop `optedIn` from `StageInput` and the call sites, or add a code comment stating it is retained for symmetry with the store slice but not part of the derivation.

### IN-02: Fallback string renders a literal `&apos;` HTML entity

**File:** `packages/web/src/components/cohort/SubmitPanel.tsx:137`

**Issue:** `{beaconAddress ?? 'this cohort&apos;s beacon'}` is a JavaScript string expression, not JSX text, so React renders it verbatim: if `beaconAddress` is null the user sees the raw `this cohort&apos;s beacon` (the entity is not decoded). The submit window only opens after `cohort-ready` sets `beaconAddress`, so this fallback is effectively unreachable today, but it is a latent defect if the ordering ever changes.

**Fix:** Use a plain apostrophe in the JS string: `'this cohort's beacon'` (or `"this cohort's beacon"`).

### IN-03: `createDraft` on a null / non-object body surfaces a raw `TypeError` as the 400 body

**File:** `packages/service/src/hono-adapter.ts:364-372` with `packages/service/src/operator-cohorts.ts:268`

**Issue:** The route parses JSON, then calls `operatorCohorts.createDraft(body as DraftInput)` inside a try/catch that returns `err.message` as the 400 body. `validateDraft` destructures `const { beaconType, size, threshold } = input;` before any shape check, so a JSON `null` or a non-object body throws `Cannot destructure property 'beaconType' of ... as it is null`, which is returned verbatim to the caller. Operator-authenticated and not sensitive, but the message is an internal implementation detail rather than the intended user-facing validation copy.

**Fix:** Guard the body shape first: `if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('expected a JSON object { beaconType, size, threshold }');` before destructuring.

### IN-04: `join()` fast-path re-sets the `join` step to `active` after `cohort-joined` already completed it

**File:** `packages/web/src/stores/participant.ts:1139-1155`

**Issue:** On a fast (hermetic / in-process) path, `cohort-joined` can fire DURING `participant.start()`, setting `steps.join = 'done'` and `steps.submit = 'active'`. The post-`start()` re-check (`:1146-1153`) only short-circuits when seated / complete / failed; for an opted-in-but-not-yet-seated round it falls through and runs `setStep('join', 'active')` at `:1154`, regressing `join` from `done` back to `active`. Because `deriveStage` reads only `steps.submit` (not `steps.join`), the regression is cosmetically invisible today, but it is a real state inconsistency (and `failActiveStep` would then treat `join` as the mid-flight step on a later failure).

**Fix:** Include `get().optedIn` in the early-return guard, or only set `join` active when it is not already `done`:

```ts
if (live !== participant || get().optedIn || get().seated || get().status === 'complete' || get().status === 'failed') {
  return;
}
```

---

_Reviewed: 2026-07-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
