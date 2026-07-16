---
phase: 02-participant-discovery-browse-and-pick-join
reviewed: 2026-07-16T17:29:21Z
depth: deep
files_reviewed: 3
files_reviewed_list:
  - packages/web/src/stores/participant.ts
  - packages/web/src/stores/participant.spec.ts
  - packages/web/src/components/browse/JoinIdentityStep.tsx
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 2: Code Review Report (02-09 / gap G-02-2)

**Reviewed:** 2026-07-16T17:29:21Z
**Depth:** deep
**Files Reviewed:** 3
**Status:** issues_found

> This review supersedes the earlier 02-REVIEW.md at this path. It is scoped to the
> 02-09 join-grace rearm change (diff base `30de2a3`), not the whole phase.

## Summary

Scope: the join-grace rearm for the wait-for-n model (plan 02-09, gap G-02-2). The
90s `JOIN_SEAT_GRACE_MS` timer was moved off `cohort-joined` and now arms once (guarded
by the `joinGraceLogged` one-shot) inside `handleDirectorySnapshot` on the FIRST observed
departure of the picked cohort from the Advertised set; a new `awaitingSeats` field feeds
a truthful "Waiting for the cohort to fill (j/n seats)" line in `JoinIdentityStep`.

The core timer lifecycle is, on inspection, well constructed. I traced every path (adopt,
fresh join, leave, cohort-ready, cohort-failed, cohort-complete, the error handler, the
`start()` fast-path re-check, and second-join-after-terminal). The critical guarantees hold:

- `clearJoinGrace()` cancels the timer AND resets `joinGraceLogged`, and it runs at the top
  of `join()` (via the explicit call + `teardownLive`) before any new state is set, so a
  stale grace from join A cannot survive into join B.
- The re-arm window is closed: every terminal handler sets its terminal `status`/`seated`
  BEFORE `clearJoinGrace()` resets `joinGraceLogged`, and `handleDirectorySnapshot`'s lead
  guard (`seated || pickedCohortId === null || status not connecting/live`) short-circuits a
  late-resolving poll snapshot. JS single-threading means there is no interleave between the
  synchronous `clearJoinGrace()` and the `set({ status: 'connecting' })` in `join()`.
- The one-shot prevents timer stacking within a round; double-fail is additionally blocked by
  the callback's `!seated && status connecting/live` re-check.

No BLOCKER-class correctness or security defect was found in the timer machinery. The findings
below are (1) a genuine latent race the codebase's own `ipfsEpoch` pattern already solves
elsewhere but that the directory poll omits, (2) an unbounded-wait UX gap, (3) a spec that
claims to pin arm-once semantics but does not, and three lower-severity staleness notes.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Directory poll has no round guard; a stale in-flight fetch can drive the wrong round

**File:** `packages/web/src/stores/participant.ts:687-694` (poll), `702-750` (`handleDirectorySnapshot`)
**Issue:**
The interval callback resolves via `get().handleDirectorySnapshot(rows)` with NO round/epoch
token, unlike the IPFS publish flow which guards every await with `ipfsEpoch` (lines 261,
802-803). `clearDirectoryPoll()` cancels the interval but cannot cancel a `fetchDirectory`
promise already in flight. Because `handleDirectorySnapshot` reads the LIVE `pickedCohortId`
via `get()`, a fetch issued during round A that resolves during round B is applied against
round B's picked cohort using round A's rows.

Concrete failure (single service, same `baseUrl`): cohort A fails/completes, the user picks
and joins cohort B; the still-in-flight fetch from A resolves during B's `connecting`/`live`
window. If B was advertised AFTER that stale snapshot was taken, B is absent from `rowsA`, so
`pickedCohortClosed(rowsA, pickedCohortId_B)` returns `true`, `optedIn` is still `false`, and
the store calls `fail('That cohort just filled or closed...')` - falsely terminating a
legitimate fresh join. In the milder case (B present in the stale rows) it writes stale
`awaitingSeats` counts for B. Cross-service switching makes the false-fail near-certain.

The window is narrow (fetches usually resolve in <5s, faster than a user reacts + re-joins),
which keeps this out of BLOCKER territory, but it is a real correctness bug and the codebase
already demonstrates the fix pattern.
**Fix:** Mirror `ipfsEpoch`. Bump a `directoryEpoch` in `clearDirectoryPoll()` (and/or at
`join()` reset), capture it when installing the interval, and drop stale snapshots:
```ts
let directoryEpoch = 0;
// in clearDirectoryPoll(): directoryEpoch += 1;
// when installing the poll:
const epoch = directoryEpoch;
directoryPoll = setInterval(() => {
  fetchDirectory(baseUrl).then(
    (rows) => { if (epoch === directoryEpoch) get().handleDirectorySnapshot(rows); },
    () => {},
  );
}, DIRECTORY_POLL_MS);
```
**Outcome:** FIXED (commit 3dd9150). Added a module-scope `directoryEpoch`, bumped in
`clearDirectoryPoll()`, captured at poll install, and checked in the continuation before
calling `handleDirectorySnapshot` - mirroring the existing `ipfsEpoch` pattern.

### WR-02: Still-Advertised / permanently-erroring poll is an unbounded client wait with no feedback

**File:** `packages/web/src/stores/participant.ts:687-693`
**Issue:**
By design (and documented at lines 273-279) a poll ERROR is swallowed so an unreachable
service never masquerades as a "closed" cohort. But there is NO counter, backstop, or user
signal for the case where the poll errors indefinitely (service went down) or the cohort
stays Advertised forever. The grace timer only ever arms on an observed DEPARTURE; while the
poll keeps erroring, no departure is ever observed, so the grace never arms and
`handleDirectorySnapshot` is never called. The user sits on "Joining…" / "Waiting for the
cohort to fill (j/n seats)" with zero indication the service became unreachable. The
in-code claim (lines 296-297) that "the client can never hang forever" relies on the poll
OBSERVING the row-vanish - which cannot happen if every poll fails. The comment documents
the intent but not this no-feedback gap.
**Fix:** Track consecutive poll failures and, past a bound (e.g. N failures ~= 60-90s),
surface a non-terminal warning ("service unreachable, still retrying") without failing the
join, or fail with a distinct "service unreachable" cause. At minimum, document the
permanently-unreachable behavior explicitly as accepted so downstream is not surprised.
**Outcome:** DEFERRED (UX policy follow-up). The service-down-mid-join no-feedback gap is
a product decision (non-terminal warning vs. distinct terminal cause vs. accept-and-document)
rather than a correctness fix; the SSE `error` handler already covers the common transport
failure, so the participant is not silently stuck for the typical case. Tracked for a later
UX pass, not fixed in this batch.

### WR-03: The "arm-once" spec does not actually pin arm-once semantics

**File:** `packages/web/src/stores/participant.spec.ts:181-195`
**Issue:**
`'arms the grace at most once across repeated departure polls (arm-once)'` calls
`handleDirectorySnapshot([])` three times WITHOUT advancing fake time between them, then sets
`seated: true`, advances the full window, and asserts `status === 'live'`. This assertion
holds regardless of how many timers were armed: all timers armed at t=0 fire at t=90s, and
each callback short-circuits on the `!seated` guard once `seated` is true. The test therefore
passes even if the one-shot were removed and three timers stacked - it does not distinguish
arm-once from arm-many, nor does it verify that a later poll does NOT reset/extend the window.
The G-02-2 arm-once guarantee is under-tested.
**Fix:** Test that the window is measured from the FIRST departure and is not reset by later
polls, and do not mask with `seated`:
```ts
useParticipant.setState({ optedIn: true, status: 'live' });
useParticipant.getState().handleDirectorySnapshot([]);      // arm at t=0
vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS / 2);             // t=45s
useParticipant.getState().handleDirectorySnapshot([]);      // must NOT re-arm/reset
vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS / 2);             // t=90s from FIRST departure
expect(useParticipant.getState().status).toBe('failed');   // fails only if window not reset
```
**Outcome:** FIXED (commit 867ef0a). Reworked the spec to arm at t0, feed later departure
ticks that must not reset the window, and assert the join fails exactly at
t0 + `JOIN_SEAT_GRACE_MS`; removed the `seated: true` mask so it pins the timing rather than
the callback's `!seated` short-circuit.

## Info

### IN-01: Stale `awaitingSeats` counts render during the grace window after departure

**File:** `packages/web/src/stores/participant.ts:730-749`, `packages/web/src/components/browse/JoinIdentityStep.tsx:163-167`
**Issue:**
When the picked cohort leaves Advertised (departure branch), the grace arms but
`awaitingSeats` is neither updated nor cleared - it retains the last Advertised counts (e.g.
`{joined:1, capacity:2}`). Status is still `live`, so `joining && awaitingSeats` stays truthy
and the UI keeps showing "Waiting for the cohort to fill (1/2 seats)" for up to 90s even
though the cohort is no longer Advertised or filling (it is either forming with us or filled
without us). The counts are stale/misleading for the duration of the grace window.
**Fix:** On arming the grace, either clear `awaitingSeats` (falling back to a bare "confirming
your seat…" line) or set a distinct "awaiting seat confirmation" surface so the copy stops
claiming a live fill count.
**Outcome:** FIXED (commit 2302a4d). The departure branch now `set({ awaitingSeats: null })`
when it arms the grace, so the "Waiting for the cohort to fill (j/n seats)" line disappears
instead of showing stale counts for the 90s window.

### IN-02: `cohort-complete` does not reset `awaitingSeats`

**File:** `packages/web/src/stores/participant.ts:600-645`
**Issue:**
Unlike `fail`, `adopt`, `join`, `leave`, and `cohort-ready`, the `cohort-complete` handler's
`set({ result, sidecar, status: 'complete', beaconAddress })` omits `awaitingSeats: null`.
Benign in practice because `cohort-ready` (which nulls it) always precedes `cohort-complete`,
and the UI hides the line when status is `complete` (not `joining`). But it is an incomplete
reset relative to every sibling terminal path and would surface if event ordering ever drifts.
**Fix:** Add `awaitingSeats: null` to the `cohort-complete` `set(...)` for symmetry with the
other terminals.
**Outcome:** FIXED (commit 2302a4d). `awaitingSeats: null` added to the `cohort-complete`
`set(...)` for parity with every sibling terminal.

### IN-03: An armed grace is not cleared if the picked cohort re-enters Advertised

**File:** `packages/web/src/stores/participant.ts:710-718`, `739-749`
**Issue:**
After a departure arms the grace (`joinGraceLogged = true`), if a later snapshot lists the
picked cohort as Advertised again, the still-Advertised branch runs (sets `awaitingSeats`,
returns) but neither clears the armed grace nor resets `joinGraceLogged`. The timer from the
earlier departure keeps ticking and will `fail()` the join at first-departure+90s even though
the cohort is Advertised again. Protocol monotonicity (Advertised is not re-entered once a
cohort locks membership) makes this improbable, but a flaky/replayed directory or reused
cohortId could trigger a spurious fail.
**Fix:** In the still-Advertised branch, if a grace is armed (`joinGrace !== null`), call
`clearJoinGrace()` before returning, so a genuinely-reopened cohort is not torn down by a
stale departure timer.
**Outcome:** FIXED (commit 2302a4d). The still-Advertised branch now calls `clearJoinGrace()`
when `joinGrace !== null`, with a comment noting the monotonicity assumption (a re-advertise
mints a fresh cohort id) so the defensive clear is understood as belt-and-suspenders.

---

_Reviewed: 2026-07-16T17:29:21Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
