---
phase: 03-participant-submit-co-sign-track-and-resolve
reviewed: 2026-07-20T00:00:00Z
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
  info: 2
  total: 6
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-07-20
**Depth:** deep
**Files Reviewed:** 23
**Status:** issues_found

## Summary

No structural pre-pass (`structural_findings`) was supplied; all findings below are narrative, from direct cross-file review. This is the third refresh of the Phase 3 review, focused on the just-landed 03-09 changes.

The newest 03-09 changes (commits `f53c0da`, `3f8cc3d`) that reserve the "anchored" narration for anchor `state === 'confirmed'` are internally consistent across every surface I traced: `deriveStage`, `anchorSummaryState`, `CompletionSummary` (heading boolean and paragraph copy), `StageTimeline` (final-row relabel), `AnchorSubSteps` (independent `confirmed` check), and the persistent "Your cohort" chip in `App.tsx` / `BrowseView.tsx`. All of them derive their "Anchored" claim from a single confirmed-only condition, so no surface can claim "Anchored" while another shows "Confirmed: pending." The unit specs (`participant.spec.ts:374-383`, `anchor-state.spec.ts`) pin the new boundaries (broadcast -> not anchored, confirmed -> anchored). This part of the phase is sound; I found no regression introduced by 03-09, and `shouldAutoResolve` stays consistent with the new `signed`-for-broadcast stage (both refuse to advance on an unconfirmed broadcast).

The defects below are in the surrounding anchor/resolve narration and completion flow that 03-09 did not touch, plus one concrete rendering bug. None is a blocker. The most consequential are the live (broadcasting) paths, which are the North Star's real product target: a beacon tx that is broadcast but never confirms leaves the participant permanently stuck at "Signed" with an unbounded poll and no auto-resolve, and the resolve round-trip card mis-narrates a cooperatively non-included DID on a live service.

## Warnings

### WR-01: Raw `&apos;` entity rendered literally in the SubmitPanel live-mode fallback

**File:** `packages/web/src/components/cohort/SubmitPanel.tsx:137`
**Issue:** The fallback for a missing beacon address is a JavaScript string literal placed inside a JSX expression:
```
commitment at beacon address {beaconAddress ?? 'this cohort&apos;s beacon'}. This is a real broadcast on{' '}
```
Unlike lines 110/133/136/142 (where `&apos;` is JSX *text* and is correctly decoded to an apostrophe), the `&apos;` here lives in a plain JS string. React renders JS strings verbatim, so the user would see the literal text `this cohort&apos;s beacon`. This only fires on the live (`enabled === true`) consent line when `beaconAddress` is null. In the normal flow `cohort-ready` sets `beaconAddress` before the submit window opens, so it is a latent path, but it renders visibly broken copy on any timing where the address is not yet populated.
**Fix:** Use a plain apostrophe in the JS string (no HTML entity):
```tsx
commitment at beacon address {beaconAddress ?? "this cohort's beacon"}. This is a real broadcast on{' '}
```

### WR-02: Live beacon tx that is broadcast but never confirms leaves the participant stuck at "Signed" with an unbounded poll and no auto-resolve

**File:** `packages/web/src/stores/participant.ts:729-737` (`shouldAutoResolve`), `packages/web/src/stores/participant.ts:1364-1368` (freeze condition)
**Issue:** When a live broadcast is accepted but confirmation times out, the broadcaster emits `beacon-anchored { confirmed: false }`, which `anchor-state.ts:116-120` folds to `state: 'broadcast'` permanently (the broadcaster stops polling after `confirmTimeoutMs` per `index.ts:247-252`, so it never re-emits `confirmed` even if the tx later mines). On that terminal `'broadcast'` read:
- `shouldAutoResolve` returns `false` (only `confirmed`/`failed`/hermetic trigger it), so auto-resolve never fires.
- The anchor poll freeze condition (`!dto.enabled || state === 'confirmed' || state === 'failed'`) is never met, so `trackAnchor` polls `GET /v1/anchor/:cohortId` every 5s indefinitely while the tab is open.
- `deriveStage` returns `'signed'` forever, so the "Signed" timeline row stays `active` and the "Active for mm:ss" clock ticks without end.

The user can still click "Resolve again" manually, so it is degraded rather than dead, but on a real live service a slow-to-confirm beacon tx never reaches a settled outcome on its own and the poll never stops.
**Fix:** Add a bounded terminal for the stuck-broadcast case: after a bounded number of unchanged `'broadcast'` reads past the service's confirm window, freeze the poll and surface an honest "broadcast, awaiting confirmation" resting state (optionally auto-resolve once so the round-trip card renders). At minimum, stop the unbounded 5s poll after a bounded number of unchanged `'broadcast'` reads.

### WR-03: Resolve round-trip card tells a cooperatively non-included DID to "Try Resolve again" on a live service

**File:** `packages/web/src/components/cohort/CompletionSummary.tsx:85,169-174`
**Issue:** `roundTrip = roundTripOutcome({ beaconPresent, anchorEnabled })` ignores `result.included`. For a participant that cooperatively declined (D-10 non-inclusion) on a live service (`anchorEnabled === true`), no update was ever submitted, so `beaconPresent` is false and `roundTripOutcome` returns `'not-reflected'`. The card then renders "Your update was not found in the resolved document yet. If the anchor just confirmed, the resolver may still be indexing. Try Resolve again." That invites the user to retry resolving an update that was deliberately never submitted, and it contradicts the separate non-inclusion copy shown just above (lines 133-139). The hermetic path is unaffected (it correctly reads `hermetic-genesis`), so this is live-only, but it is reachable: `preSeatFitWarning` (`participant.ts:771-790`) warns-but-allows a baked x1 beacon-type mismatch to join.
**Fix:** Gate the "not-reflected / Try Resolve again" branch on `result.included`, or thread inclusion into the round-trip decision so a declined DID renders an honest "no update was submitted for this cohort" outcome instead of a retry prompt.

### WR-04: `terminalReason` claims an update-collection stall even when co-signing had already started

**File:** `packages/web/src/components/cohort/CohortPage.tsx:26-35`
**Issue:** `terminalReason` maps a post-seat "cohort gone" failure (store message `"The cohort ended and this service didn't say why."`, `participant.ts:1419`) to the specific copy "The cohort ended. It stalled waiting for all members to submit their updates." The trigger is `submittedButUnsigned = steps.submit === 'done' && steps.sign !== 'done'`, and `/didn.t say why/` matches the honest fallback message. But `steps.sign` can be `'active'` at that point (co-signing already requested for this member, i.e. every member's update was already collected and signing was in flight - the exact state exercised in `participant.spec.ts:463`). In that case the round stalled during signing, not "waiting for all members to submit their updates," so the rendered cause is inaccurate. This undercuts the phase's mode-honesty goal by asserting a specific wrong cause where the store deliberately said "didn't say why."
**Fix:** Only render the update-collection stall copy when signing has not started, e.g. gate on `steps.submit === 'done' && steps.sign === 'idle'`; when `steps.sign === 'active'`, use a signing-phase-neutral honest line (or fall through to the "didn't say why" copy) rather than naming submission as the stall point.

## Info

### IN-01: Public anchor route cohortId regex can turn a valid cohort into a spurious "unreachable"/hermetic narration

**File:** `packages/service/src/hono-adapter.ts:315-321`, `packages/web/src/lib/anchor.ts:52-55`
**Issue:** `GET /v1/anchor/:cohortId` rejects any id not matching `^[0-9a-zA-Z-]{1,64}$` with a 400. `fetchAnchor` throws on any non-2xx, and both the post-sign anchor poll (`participant.ts:1370-1378`) and the SubmitPanel probe (`SubmitPanel.tsx:68-81`) treat that throw as an unreachable/hermetic read. If the library ever mints a cohort id containing a character outside that class (e.g. an underscore) or longer than 64 chars, a participant's own valid cohort would 400, silently degrading the live consent line and completion narration to the hermetic copy and counting toward the D-24 unreachable signal. The e2e passes with current ids, so this is a latent coupling to the library's id format rather than an observed break.
**Fix:** Either widen the guard to match the library's actual cohort-id alphabet/length, or have the route answer a shape-mismatch id with `200 { enabled, state: 'none' }` (the same non-oracle default) instead of 400, so a malformed-but-participant-supplied id degrades to "no anchor facts" rather than an unreachable read.

### IN-02: Service-supplied `explorerUrl` is rendered as an `href` without scheme validation

**File:** `packages/web/src/components/cohort/StageTimeline.tsx:95-104`
**Issue:** `AnchorSubSteps` renders `<a href={anchor.explorerUrl}>` where `explorerUrl` comes from the connected service's `GET /v1/anchor` response. React does not sanitize `href` against `javascript:` URLs, so a hostile coordinator could return a script URL. In the same-origin topology the coordinator already serves the SPA, so this is not a privilege escalation today, but it is a defense-in-depth gap that would matter if the app were ever served from a different origin than the coordinator.
**Fix:** Validate the scheme before using it as an href (accept only `http:`/`https:`), e.g. render the link only when `new URL(explorerUrl).protocol` is `http`/`https`.

---

_Reviewed: 2026-07-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
