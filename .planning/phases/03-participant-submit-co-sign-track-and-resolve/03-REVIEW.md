---
phase: 03-participant-submit-co-sign-track-and-resolve
reviewed: 2026-07-19T00:00:00Z
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
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-19
**Depth:** deep
**Files Reviewed:** 23
**Status:** issues_found

## Summary

This is a re-review after gap-closure plans 03-07 (CR-01 / WR-01) and 03-08 (anchor-narration
consistency, Truth 7) landed. This report overwrites the prior 03-REVIEW.md to reflect the current
state of the code.

The anchor-narration consistency work is coherent. I traced every one of the five anchor states
(checking / hermetic / broadcasting / anchored / broadcast-failed) through all four render surfaces
(`deriveStage`, the `StageTimeline` final-row label, the `CompletionSummary` header, and the
`CompletionSummary` narration paragraph) and they agree in each state. The prior CR-01 (opted-in
member torn down mid-keygen) and WR-01 (two-way hermetic-or-anchored collapse) are both closed and
pinned by spec tests. The service-side anchor read (`anchor-state.ts` plus the public
`GET /v1/anchor/:cohortId` route) is bounded at 24 with oldest-first eviction, is non-oracle
(unknown reads `state: 'none'`, never 404), is mode-honest via the `enabled` bit, and never touches
the chain on the anonymous path, matching its threat model.

No BLOCKER defects were found. The store's teardown/epoch discipline (directory poll, post-seat
poll, anchor poll, IPFS epoch, submit deferred) is careful and consistently guarded, and the
security-sensitive surfaces (public anchor read, operator-gated cohort routes, tx proxy) preserve
their auth boundaries.

Two WARNING-level issues remain: a broken defensive fallback string in `SubmitPanel` that would
render a raw HTML entity, and a narration overclaim where a broadcast-but-unconfirmed anchor is
labeled "anchored" while the sub-steps simultaneously render "Confirmed: pending". Three low-value
INFO items round out the report.

## Warnings

### WR-01: `SubmitPanel` fallback renders a literal `&apos;` HTML entity

**File:** `packages/web/src/components/cohort/SubmitPanel.tsx:137`
**Issue:** In the live/enabled consent line, the beacon-address fallback is a JavaScript string
literal interpolated into JSX via `{...}`:

```jsx
commitment at beacon address {beaconAddress ?? 'this cohort&apos;s beacon'}. This is a real broadcast on{' '}
```

JSX only decodes HTML entities that appear as literal source text between tags, not values produced
by an expression. When `beaconAddress` is null this renders the seven literal characters `&apos;` to
the user (`this cohort&apos;s beacon`) instead of an apostrophe. The intended text needs a real
apostrophe in the JS string, not the entity.

In the happy path `beaconAddress` is set by the `cohort-ready` handler before the submit window
opens, so this defensive branch is unlikely to be reached, which is why it is a WARNING and not a
BLOCKER. But the fallback exists precisely for the case where it is null, and in that case it ships
visibly broken copy.

**Fix:**
```jsx
{beaconAddress ?? "this cohort's beacon"}
```
(use a plain apostrophe inside the JS string; the `&apos;` entity only works in literal JSX text, as
on the surrounding `cohort&apos;s` occurrences).

### WR-02: "Anchored" / "Signed and anchored" is claimed for a broadcast-but-unconfirmed anchor, contradicting the sub-steps

**File:** `packages/web/src/stores/participant.ts:701` (`anchorSummaryState`), `packages/web/src/components/cohort/CompletionSummary.tsx:72,89,94-95`, `packages/web/src/components/cohort/StageTimeline.tsx:73-79,163`
**Issue:** `anchorSummaryState` maps `state === 'broadcast'` (enabled) to `'anchored'`, and both
`deriveStage` and the `CompletionSummary` `anchored` boolean do the same. So while a live beacon tx
is broadcast but not yet mined, the header reads "Anchored" and the narration reads "Signed and
anchored on {netLabel}." At that same moment `AnchorSubSteps` renders "Confirmed: pending"
(`confirmed = anchor.state === 'confirmed'`, StageTimeline:74,79). The user is shown "anchored on
{network}" and "Confirmed: pending" simultaneously, which is internally contradictory: a mempool /
unconfirmed transaction is not anchored on-chain.

This is a deliberate, consistently-applied mapping (documented in `anchorSummaryState` and covered by
`participant.spec.ts:556-558`), so it is not a correctness break, but for a phase whose explicit
charter is mode-honest anchor narration it is an honesty overclaim: "broadcast (accepted, not yet
mined)" should narrate as broadcasting/pending, not as anchored. The transient window can be long on
a slow network, and a broadcast tx can still be dropped or replaced before it confirms.

**Fix:** Reserve the "anchored" narration for `state === 'confirmed'` and let `state === 'broadcast'`
fall into the existing `'broadcasting'` narration (which already reads "Broadcasting the beacon
transaction... This can take a few minutes to post."). For example, in `anchorSummaryState`:
```ts
if (anchor.state === 'confirmed') {
  return 'anchored';
}
if (anchor.state === 'failed') {
  return 'broadcast-failed';
}
return 'broadcasting'; // covers 'broadcast' (accepted, not yet mined) and 'none'
```
and align `deriveStage`'s `'anchored'` branch and `CompletionSummary`'s `anchored` boolean to
`state === 'confirmed'` so the "Anchored" stage/header only appears once mined. If broadcast is
intentionally treated as anchored, at minimum drop the "Confirmed: pending" sub-step whenever the
header claims "anchored" so the two surfaces stop contradicting each other.

## Info

### IN-01: Inconsistent ellipsis glyph across participant copy

**File:** `packages/web/src/components/cohort/SubmitPanel.tsx:133,148`, `packages/web/src/components/browse/JoinIdentityStep.tsx:122,188`, `packages/web/src/components/browse/DirectoryList.tsx:103`
**Issue:** These strings use the single-character ellipsis `…` (U+2026) while the rest of the
participant surface uses three ASCII dots (`CompletionSummary` "Resolving your updated DID...",
"Publishing...", `CohortPage`/`SubmitPanel` "Resolving...", etc.). The repo is deliberate about copy
consistency (the em-dash prohibition is enforced at the source); this glyph split is the same class
of drift. Not a bug, purely cosmetic.
**Fix:** Pick one convention (the ASCII `...` used everywhere else) and normalize the five `…`
occurrences to match.

### IN-02: Redundant optional chaining after an explicit null guard

**File:** `packages/web/src/stores/participant.ts:698`
**Issue:** `anchorSummaryState` returns early on `anchor === null` (lines 695-697), so at line 698
`anchor` is provably non-null; the `!anchor?.enabled` optional chain can never short-circuit on null
there. Harmless, but it signals to a reader that `anchor` might still be null and slightly muddies
the narrowing.
**Fix:** Use `!anchor.enabled` now that null is already handled.

### IN-03: A live beacon tx that broadcasts but never confirms polls indefinitely with no resolve

**File:** `packages/web/src/stores/participant.ts:720-728` (`shouldAutoResolve`), `1355-1359` (freeze condition)
**Issue:** On a live service, `trackAnchor` freezes only on `confirmed` / `failed` / `!enabled`, and
`shouldAutoResolve` fires only on `confirmed` / `failed`. A beacon tx that is accepted (`state:
'broadcast'`) but never confirms (dropped from the mempool, or the coordinator's confirm-timeout
elapses and reports `confirmed:false`, which folds back to `'broadcast'`) leaves the participant
polling every ~5s indefinitely, with the "Broadcasting..." copy never resolving and auto-resolve
never firing. The user can still click "Resolve again" manually, and on a healthy network the tx
confirms, so this is a benign edge rather than a defect; noting it because it is the one
non-terminating path in the anchor tracker. (Performance is out of v1 review scope; flagged only for
the never-resolves UX.)
**Fix:** Consider a bounded overall anchor-tracking budget, or treat a coordinator `confirmed:false`
timeout as a distinct "still pending, stop auto-polling" state that surfaces the manual retry, so a
perpetually-unconfirmed tx does not leave the tab polling with no resolution.

---

_Reviewed: 2026-07-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
