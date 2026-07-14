---
phase: 02-participant-discovery-browse-and-pick-join
reviewed: 2026-07-14T20:54:41Z
depth: deep
files_reviewed: 15
files_reviewed_list:
  - e2e/browse-join-cohort.ts
  - packages/participant/src/index.spec.ts
  - packages/participant/src/index.ts
  - packages/web/src/App.tsx
  - packages/web/src/components/browse/BrowseView.tsx
  - packages/web/src/components/browse/CohortRow.tsx
  - packages/web/src/components/browse/DirectoryList.spec.ts
  - packages/web/src/components/browse/DirectoryList.tsx
  - packages/web/src/components/browse/JoinIdentityStep.tsx
  - packages/web/src/components/browse/ServiceIdentityHeader.tsx
  - packages/web/src/components/participant/KeyGenPanel.tsx
  - packages/web/src/lib/directory.spec.ts
  - packages/web/src/lib/directory.ts
  - packages/web/src/stores/participant.spec.ts
  - packages/web/src/stores/participant.ts
findings:
  critical: 1
  warning: 2
  info: 5
  total: 8
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-07-14T20:54:41Z
**Depth:** deep
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the participant discovery + browse-and-pick join slice: the participant Zustand
store (`join`, the directory poll, the `pickedCohortClosed` predicate, `handleDirectorySnapshot`),
the neutral `lib/directory` read/joinability helpers, the isomorphic participant runner filter
(`matchesPickedCohort`), the browse React components, and the hermetic capstone e2e.

Security posture is sound: every browse read (`fetchDirectory`, `fetchStatus`) uses
`credentials: 'omit'` (verified in `lib/operator.ts`, re-exported through `lib/directory.ts`),
so the anonymous surface never sends the operator session cookie; no mutating or auth-bearing
call was found on the participant/browse path. No em-dash (U+2014) occurrences in any reviewed
file (copy uses `·` middle-dot and plain hyphen).

The dominant concern is a **race between the directory poll and the `cohort-ready` seat event**
that can incorrectly fail a legitimately-seated participant mid-keygen and stall the entire
n-of-n cohort - directly threatening the North Star's real-internet join loop. Secondary issues:
BrowseView never surfaces the store's `failed` status (errors are swallowed from the browse UI),
an orphaned-interval ordering hazard in `join`, and residual dead code (KeyGenPanel/ParticipantView).

## Critical Issues

### CR-01: Directory poll can fail a genuinely-seated participant and stall the whole cohort

**File:** `packages/web/src/stores/participant.ts:606-634` (poll setup + `handleDirectorySnapshot`)

**Issue:** A cohort leaves the `Advertised` phase the instant it reaches its co-sign
threshold (documented in `directory.ts` and in `pickedCohortClosed`), which is **before**
keygen runs. The `cohort-ready` seat event fires only **after** keygen completes
(`participant.ts:506-514`, "keygen complete; beacon ..."). Between those two moments the
directory already reports the picked cohort as no-longer-Advertised while `seated` is still
`false`.

The `~5s` join-time poll (`participant.ts:606`) calls `handleDirectorySnapshot`, whose guard
only bails when `seated || pickedCohortId === null || status not in {connecting,live}`
(`participant.ts:626`). For a participant that already opted in (`cohort-joined` set
`status: 'live'`) and IS a real member of the now-locked cohort, that guard does not fire:
`pickedCohortClosed` returns `true` (the row left Advertised), and the store calls
`fail(...)` -> `teardownLive()`. This:

1. Incorrectly tells a seated participant "That cohort just filled or closed. Pick another."
2. Tears down the live runner/transport mid-keygen, so the participant drops out of the
   MuSig2 session. Because signing is n-of-n, the cohort can no longer complete - one unlucky
   poll tick stalls the round for **every** member.

A directory fetch (~tens of ms) will routinely resolve before `cohort-ready` (keygen +
SSE delivery, plausibly seconds over the public internet), so the poll frequently wins the
race. The window is `keygen duration + SSE latency`; over a 5s poll interval the hit
probability is material, not theoretical. Note the store's poll/seat path is exercised by
no test (both `participant.spec.ts` and `e2e/browse-join-cohort.ts` drive the predicate/runner
directly, never the interval-vs-`cohort-ready` interleaving), so this is uncovered.

**Fix:** Do not treat "left Advertised while unseated" as terminal the instant it is observed.
Add a confirmation/grace gate so a genuine seat can arrive first, e.g. require the cohort to
be observed closed on N consecutive polls (or for a bounded grace period) with no intervening
`cohort-ready`, and/or stop the poll the moment `cohort-joined` transitions to a state where
`cohort-ready` is still expected:

```ts
// Sketch: require a short grace before declaring closed, so a seat mid-keygen wins.
handleDirectorySnapshot(rows) {
  const { status, seated, pickedCohortId } = get();
  if (seated || pickedCohortId === null || (status !== 'connecting' && status !== 'live')) {
    return;
  }
  if (!pickedCohortClosed(rows, pickedCohortId)) {
    closedObservations = 0;              // still open: reset
    return;
  }
  // Closed this tick. Wait for a second confirming observation (>= one poll apart)
  // so an in-flight cohort-ready seat has a chance to land first.
  if (++closedObservations < 2) {
    return;
  }
  set({ joinClosed: true });
  fail('That cohort just filled or closed. Pick another from the directory.');
}
```

Even a single-cycle grace closes the common race; pair it with clearing the counter on
`cohort-joined`/`cohort-ready`.

## Warnings

### WR-01: BrowseView never surfaces the store's `failed` status - errors are swallowed from the UI

**File:** `packages/web/src/components/browse/BrowseView.tsx:48-114`

**Issue:** BrowseView branches only on `joinClosed`, `seated`, `pickedRow`, then default. The
store's `error`/`status: 'failed'` is rendered **only** inside the `joinClosed` branch. Two
real failure paths are therefore invisible:

- **Post-seat failure.** `cohort-failed` or a mid-signing `error` calls `fail(...)`
  (`participant.ts:359-364`), which sets `status: 'failed'` and `error` but leaves `seated`
  true and `joinClosed` false. BrowseView keeps rendering the happy seated card ("You're
  seated ... When this cohort fills, co-signing begins below") with no error and `hasResult`
  false - the participant is stuck on a success-looking screen after a real failure.
- **Pre-seat connect/runtime failure.** The `error` handler / `start()` catch call `fail(...)`
  with `joinClosed` false and `seated` false while `pickedRow` is still set. BrowseView falls
  to the "picked but not seated" branch -> `JoinIdentityStep`, whose `joining` is false when
  `status === 'failed'`, so the Join button silently re-enables with no error message. The
  failure reason is discarded from the user's view.

**Fix:** Add an explicit `status === 'failed'` (non-`joinClosed`) branch in BrowseView that
surfaces `error` and offers "Back to directory" (mirroring the `joinClosed` card), or thread
the `error` into `JoinIdentityStep`/the seated card so a post-seat failure is visible.

### WR-02: Join-time poll is created after `await participant.start()`, orphaning it if a seat/complete event lands during start

**File:** `packages/web/src/stores/participant.ts:594-613`

**Issue:** `directoryPoll = setInterval(...)` is assigned only **after** `await
participant.start()` resolves. The `cohort-ready` / `cohort-complete` handlers each call
`clearDirectoryPoll()` (`participant.ts:512`, `575`). If either event is delivered during the
`await` (fast in-process/hermetic paths open SSE and may replay the current advert
immediately), that `clearDirectoryPoll()` is a no-op (the interval does not exist yet), and
the interval is then created against an already-seated/complete round. It keeps ticking every
5s until the next terminal transition (`leave`/next `join`). The `handleDirectorySnapshot`
guard prevents a false `fail` here, so it is a leak rather than a correctness bug, but the
prompt specifically called out timer leaks not cleared on seat.

**Fix:** Re-check the round before installing the interval, or install it before `await
participant.start()` and let the handlers own teardown, e.g.:

```ts
await participant.start();
// If a seat/terminal event already fired during start, do not (re)arm the poll.
if (live !== participant || get().seated || get().status === 'complete' || get().status === 'failed') {
  return;
}
directoryPoll = setInterval(/* ... */);
```

## Info

### IN-01: KeyGenPanel and ParticipantView are now dead code

**File:** `packages/web/src/components/participant/KeyGenPanel.tsx` (whole file)

**Issue:** `App.tsx` renders `BrowseView` (or `OperatorConsole`), never `ParticipantView`,
which is the only importer of `KeyGenPanel`. `ParticipantView` is referenced only in a
BrowseView doc comment. This phase edited KeyGenPanel to disable the standalone Join/Retry
buttons (`KeyGenPanel.tsx:140`, `148`), but the whole panel now sits on an unreachable path.
A disabled "Join the cohort" button plus a live "Regenerate"/"Reset" alongside it would
mislead anyone who re-mounts the component.

**Fix:** Delete `ParticipantView.tsx` + `KeyGenPanel.tsx` (the reusable identity-acquisition
logic already lives in `JoinIdentityStep`), or add a comment/annotation making the
dead-but-retained status explicit and unmistakable.

### IN-02: `createParticipant` JSDoc contradicts the browse-and-pick filter it now implements

**File:** `packages/participant/src/index.ts:94-107`

**Issue:** The function header still states "It auto-joins every advertised cohort and
contributes a signed did:btcr2 update ...". With `opts.cohortId` set (the Phase-2 default from
the store/e2e), `shouldJoin` opts into exactly one cohort. The stale doc understates the
selectivity guarantee on a security-relevant path.

**Fix:** Update the header to describe the picked-cohort filter (`matchesPickedCohort`) as the
primary behavior and note accept-all only survives for pre-Phase-2 callers.

### IN-03: Seated confirmation reads stale seat counts from the frozen `pickedRow`

**File:** `packages/web/src/components/browse/BrowseView.tsx:66-69`

**Issue:** The seated card derives `seats`/`label` from `pickedRow`, the snapshot captured when
Join was tapped. The CohortRow doc claims BrowseView reads "live seats/status," but `pickedRow`
is never re-polled, so `2/3 seats · Open` can stay shown after the cohort has actually filled.

**Fix:** Read live seat/status from the store or a fresh directory row keyed on the picked
cohort id, or drop the "live" wording and label it the snapshot-at-pick.

### IN-04: ServiceIdentityHeader blanks the whole header on a transient fetch error

**File:** `packages/web/src/components/browse/ServiceIdentityHeader.tsx:32-36,46-48`

**Issue:** On any `fetchStatus` rejection the effect does `setStatus(undefined)`, and the
component then renders `null`, hiding the service origin/network/online header entirely. This
is inconsistent with `DirectoryList`, which deliberately keeps stale rows and shows an
"unreachable" banner (D-12) rather than blanking. A single blip makes the identity header
flicker out.

**Fix:** Keep the last-good status on error (only clear on first-load failure), matching the
directory's keep-stale-on-blip behavior.

### IN-05: Join-time poll and live runner are not tied to BrowseView's lifecycle

**File:** `packages/web/src/stores/participant.ts:253-286` (module-scoped `directoryPoll`/`live`)

**Issue:** `directoryPoll` and `live` are module singletons cleared only on
seat/complete/fail/leave. BrowseView has no unmount effect that calls `leave()`, so unmounting
mid-join (e.g. a client-side route change to `/operator`) would leave the poll and the live
runner running. This is latent (the `/operator` route appears to be a full page load today,
which resets module state), but the browse/join lifecycle has no component-level safety net.

**Fix:** Add a BrowseView unmount effect that calls `leave()` when a join is in flight and not
seated, or document why the module-scoped handles intentionally outlive the component.

---

_Reviewed: 2026-07-14T20:54:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
