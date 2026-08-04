---
phase: 05-operator-cohort-lifecycle-control
reviewed: 2026-08-04T14:05:00Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - packages/web/src/stores/operator.ts
  - packages/web/src/lib/operator.ts
  - packages/web/tests/operator.spec.ts
  - packages/service/src/runtime-settings.ts
  - packages/service/src/index.ts
  - packages/service/tests/runtime-settings.spec.ts
  - docs/DEPLOY.md
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 5: Code Review Report (re-review after gap-closure round 8)

**Reviewed:** 2026-08-04
**Depth:** deep (cross-file: `lib/operator.ts` result vocabulary into every branch of every gated verb in `stores/operator.ts`, then out into `components/operator/OperatorConsole.tsx` and `CohortDetail.tsx` for reachability; on the service side `index.ts`'s single `operatorPassword` binding into `createRuntimeSettings`'s `consequenceFor` and out into `docs/DEPLOY.md`)
**Files Reviewed:** 7 (round-8 delta `1c6ff5e..HEAD`, commits `bcd78f6..2ab158e`)
**Status:** issues_found

## Summary

Baseline reproduced locally with no source modified: `npx vitest run packages/web/tests/operator.spec.ts packages/service/tests/runtime-settings.spec.ts` is 2 files / 251 tests green. Every behavioral claim below was executed against the shipped store through a throwaway vitest file (written into `packages/web/tests/`, run, and deleted; `git status` is clean of it), not argued from the source alone.

**Six of the seven round-7 targets are genuinely closed, and closed at the mechanism.** WR-13 is real: all twelve gated action verbs now take one `stillAsking` comparison directly below their `unauthorized` branch, covering success, refusal, decline, transport fault and `catch` together (`operator.ts:996, 1323, 1376, 1425, 1490, 1530, 1551, 1574, 1606, 1639, 1680, 1707`), and the advertise drill-down landing re-reads the comparison on the far side of the interior refresh (`operator.ts:1461`) instead of caching a boolean, so the status-as-identity check that survived at the old `:1290` is gone; the only surviving `auth === 'logged-in'` read in the file is inside `askingRound` itself (`operator.ts:918`), pinned by a source-walk row. WR-14 is real: `CreateDraftResult` gained `unauthorized` (`lib/operator.ts:194-197`), `createDraft` checks 401 FIRST (`lib/operator.ts:217`), and `submitDraft` is the enumerated sixteenth capture site (`operator.ts:1307`); the capture count in the source is exactly 16, verified by grep. IN-15 is real and is the sharpest fix of the round: `probe` captures its round directly off the store before the await (`operator.ts:1070`) and refuses to start a session when a boundary was crossed while its question was in flight (`operator.ts:1087-1096`). IN-17 is real and derives from ONE binding: `const operatorPassword` is read twice in `index.ts` (`:683` for `operatorSurfaceMounted`, `:711` for the mount decision), `Boolean(x)` and the ternary's truthiness agree for every value including `''`, the holder reads it fail-closed (`runtime-settings.ts:847`, `=== true`), and a booted-service row proves the sentence and the surface agree (404 with no password, 401 with one). IN-18 is real: `gatedSliceReset()` is a factory called at both ending paths (`operator.ts:801, 1176, 1194`), and its field list still covers every non-deliberate member of `OperatorState` (checked field by field).

**WR-15 is closed only in its narration half, and the round summary's phrase "5xx freezes the console" does not describe what shipped.** `SessionState` did gain `unreachable` and `sessionProbe` does map 401 apart from every other status (`lib/operator.ts:58, 66-82`), so the false "Your operator session ended" sentence is genuinely gone. But `probeUnreachable` still calls `expireSession()` and then drops the operator to the login screen (`operator.ts:954-961`): a single 502 from a reverse proxy mid-reload retires the round, wipes the whole gated slice and forces a full re-login on a session whose cookie the service never refused. Executed: a live signed-in console plus one 502 probe lands on `auth: 'logged-out'`. That is the opposite of the D-25 freeze posture every other read in this store follows (`refreshCohorts` sets `listStale`, `pollDetail` freezes, `loadSettings` keeps its snapshot). See WR-17.

**The round's own sweep left one branch of the session-identity law unswept, and it is in the method the round rewrote twice.** IN-15 gave `probe` a captured round; the session-ENDING branches four lines below it (`operator.ts:1111-1126`) and the shared `probeUnreachable` (`operator.ts:954-961`) still decide from `liveSessionRound` alone and never look at that capture. Executed: a probe issued from the login screen, an operator who signs in while it is in flight, and a stale 401 answer landing afterwards ends the BRAND NEW session and narrates the exact `SESSION_EXPIRED` copy this whole finding series exists to prevent. The same interleaving with a thrown probe produces the same kill behind the unreachable line. See WR-16. The enumeration row that is supposed to make this class checkable cannot see it: it splits the source on the literal `const askedInRound = askingRound(get);` (`packages/web/tests/operator.spec.ts:3466, 3483`), so the one gated path with a hand-rolled capture (`askedAtRound`) is the one path no row counts.

Third, `exportCohort` is the one gated verb whose client function can still throw and whose store action has no `catch` (WR-18), which reopens the exact silent-no-op WR-06 closed, in the one case WR-06 did not cover.

Service side is clean. `runtime-settings.ts` gained one seed key, one derived boolean and one two-branch string composer; the composer's two variants keep the cost half and the environment-edit half byte-identical (asserted), and no route, no snapshot member and no behavior reads the new key. `docs/DEPLOY.md`'s refused-terms prose no longer names shortening as the only way back, but the runbook still offers the settings surface as a runtime path in two other unqualified places, and the row that claims to count every such offer cannot detect them (IN-19).

## Critical Issues

None. No security regression, no injection surface, no auth weakening: the two new decision points (`Boolean(operatorPassword)` server-side, the probe's round comparisons client-side) both fail in the closed direction.

## Warnings

### WR-16: `probe`'s session-ending branches ignore the round IN-15 just taught it to capture, so a stale probe answer kills the session that signed in after it

**File:** `packages/web/src/stores/operator.ts:1111-1126` (and the same omission in `probeUnreachable`, `packages/web/src/stores/operator.ts:954-961`)

**Issue:** IN-15 added `const askedAtRound = get().sessionRound;` at `:1070` and used it on exactly one branch, the session-START branch at `:1087`. The session-END branch four lines below it still decides only from `get().liveSessionRound !== undefined`, read at landing time. `liveSessionRound` answers "is SOME session live now", not "is the session that asked still live", which is the precise distinction the `sessionRound` docstring calls general law (`operator.ts:366-404`). The trio's docstring justifies the exemption with "nobody asked the probe's question in a round" (`operator.ts:896-902`), and that justification became stale in this same round: the probe now has a round.

Reproduced against the shipped store (throwaway vitest file, deleted after the run). Sequence: the console holds no live session, `probe` is issued (the real console reaches this any time two probes overlap, which the store's own docstrings call routine, or when one probe hangs across a tab switch while a second renders the login panel); the operator signs in and the store records a fresh live round; the first probe's stale `401` answer lands. Result:

```
AFTER STALE PROBE 401 -> {
  auth: 'logged-out',
  error: "Your operator session ended. Sign in again to keep monitoring. ...",
  roundMoved: true,
  liveSessionRound: undefined
}
```

The brand new session is ended, its gated slice is wiped, and the operator is told a session expired that the service never refused. The `state === 'disabled'` sub-branch at `:1122` has the same shape: a stale 404 answer would additionally paint the fail-closed notice over a live console.

The behavior is not covered by any row: `operator.spec.ts:2201` covers a probe finding no session on a console holding none, `:2236` covers the START branch, and `:2286` covers two probes both discovering the SAME end. None stages a session that begins after the probe was issued.

**Fix:** give the ending branches the same comparison the starting branch got, so an ending is scoped to the session that asked. `askedAtRound` is already in scope.

```ts
} else if (get().liveSessionRound !== undefined) {
  // A live session ENDED, discovered HERE rather than by a read's 401 (review CR-03) - but only
  // if it is the session this question was asked in. A probe issued before the current session
  // began carries no evidence about it (review WR-16), on exactly the reasoning the START branch
  // above already applies to the mirror case.
  if (get().sessionRound !== askedAtRound) {
    return;
  }
  get().expireSession();
  ...
```

Then extend the enumeration row so the bespoke capture is counted rather than invisible: split on `askingRound(get);` OR on `= get().sessionRound;`, and require a comparison against the captured value in each segment.

### WR-17: a transient 5xx or network blip on the session probe still terminates a healthy operator session, which is not "freezing" and contradicts D-25

**File:** `packages/web/src/stores/operator.ts:954-961` (`probeUnreachable`), reached from `:1078` and `:1139`

**Issue:** `probeUnreachable` calls `get().expireSession()` whenever any session is live, which retires the round and spreads `gatedSliceReset()`, then overwrites the copy with the honest unreachable line. The narration is now correct, so the WR-15 copy defect is genuinely closed, but the SESSION is still ended by a fault that says nothing about the session. Reproduced with no race at all: sign in, then one 502 probe.

```
AFTER 502 PROBE ON LIVE SESSION -> { auth: 'logged-out', error: 'Could not reach the service...', isExpiredCopy: false }
```

Every other read in this store draws the opposite conclusion from the identical status. `fetchCohortDetail` maps a non-401 non-ok to `unreachable` and `pollDetail` freezes (`operator.ts:1900-1904`); `refreshCohorts` raises `listStale` and retries quietly (`:1277-1281`); `loadSettings` keeps the snapshot on screen (`:1761-1765`). `lib/operator.ts:44-56` even cites `fetchCohortDetail` as drawing the same line. Only the probe converts the fault into a logout. In deployment terms this means one reverse-proxy reload, one container restart behind a load balancer, or one mobile network hiccup on the way back to the operator tab costs the operator their whole console and a fresh password entry, on a service that never refused their cookie.

The stale-answer half compounds it: `probeUnreachable` also ignores `askedAtRound`, so a probe that times out after 8 seconds can end a session that signed in during those 8 seconds. Reproduced:

```
AFTER STALE THROWN PROBE -> { auth: 'logged-out', error: 'Could not reach the service. Check that it is running, then reload.' }
```

The tests pin the current behavior deliberately (`operator.spec.ts:2142-2145`, "the slice still goes, deliberately and on the record"), so this is a decision rather than an oversight, but the decision is inconsistent with the freeze rule the same store states four other times, and the round summary describing it as "5xx freezes the console" does not match the code.

**Fix:** decide the fault case the way D-25 already decides it everywhere else. Keep the session, keep the last-known slice, surface the unreachable posture, and let the next probe or the next poll's real 401 end the session if it is genuinely gone. Concretely, a transport fault on a probe should leave `auth` alone rather than dropping to `logged-out`:

```ts
function probeUnreachable(set, get): void {
  if (get().liveSessionRound !== undefined) {
    // A transport fault is not evidence a session ended, so the session stands and the last-known
    // view freezes (D-25), exactly as every other read in this store treats the same statuses. A
    // genuine expiry still arrives as a 401, on the probe or on the next poll.
    set({ listStale: true });
    return;
  }
  set({ auth: 'logged-out', error: UNREACHABLE });
}
```

If the slice really must be surrendered on a fault (the T-05-43-04 argument), then at minimum scope the ending to `askedAtRound` so a fault cannot end a session that started after the probe was issued, and correct the round's own summary sentence, which currently claims a freeze that does not exist.

### WR-18: `exportCohort` is the one gated verb with an uncaught throw path, reopening the WR-06 silent no-op

**File:** `packages/web/src/stores/operator.ts:1540-1557`; throw site `packages/web/src/lib/operator.ts:818`

**Issue:** `downloadExport` wraps only the `fetch` in its `try` (`lib/operator.ts:803-811`). The `await res.blob()` at `:818` sits outside it, and `res.blob()` rejects when the body stream fails mid-transfer, which is exactly the failure mode a large monitoring export invites. The store's `exportCohort` has no `try/catch`, unlike `submitDraft` (`:1308`), `saveDraftEdit` (`:1360`) and `saveSettings` (`:1776`), the other three verbs whose client functions can throw. The caller is `onClick={() => void exportCohort(baseUrl, cohortId)}` (`components/operator/CohortDetail.tsx:504`), so the rejection is unhandled and the click produces: no download, no `actionError` (it was cleared on entry at `:1541`), no re-login, no log line. That is verbatim the defect `lib/operator.ts:795-799` says WR-06 closed, surviving in the one case WR-06 did not enumerate.

**Fix:** close the hole at the source so the discriminated vocabulary really is total, and add the store-side belt as the other three verbs have it.

```ts
// lib/operator.ts, inside downloadExport
let blob: Blob;
try {
  blob = await res.blob();
} catch {
  // A body that failed mid-transfer is the same fact as a fetch that never landed.
  return { kind: 'unreachable' };
}
```

```ts
// stores/operator.ts, exportCohort
let result: FetchResult<true>;
try {
  result = await apiDownloadExport(baseUrl, id);
} catch {
  result = { kind: 'unreachable' };
}
```

## Info

### IN-19: the runbook still offers the settings surface unqualified in two places, and the row that claims to count every offer cannot detect a fourth

**File:** `docs/DEPLOY.md:345, 491` (also `:226`); guard at `packages/service/tests/runtime-settings.spec.ts:1472-1480`

**Issue:** IN-16's prose fix is real: the overclaim "until you shorten it, the join flow has no terms step at all" is gone and the replacement (`DEPLOY.md:358-360`) orders cost, in-session repair, environment edit like every other account. But the runbook offers the same in-session repair twice more without the `OPERATOR_PASSWORD` precondition IN-17 added everywhere else:

- `:345` "Set `TERMS_TEXT` at boot, or the participation terms field in the settings surface at runtime"
- `:491` "`serviceName` appears once you set `SERVICE_NAME` (or the display name in the settings surface)"

A reader with no operator password is still being sent to a surface their service does not mount, which is the fact IN-17 exists to stop. The row meant to prevent this counts occurrences of the QUALIFIED phrasing and asserts exactly 3, while its own comment claims "the count is pinned so a fourth statement cannot be added unqualified". The opposite is true: adding an unqualified statement leaves the qualified count at 3 and the row green; only adding a fourth QUALIFIED statement fails it. The row's title ("qualifies EVERY in-session repair the runbook offers, all three of them") asserts more than the assertion measures.

**Fix:** qualify `:345` and `:491` the same way, then make the row measure the claim rather than its complement, for example by counting mentions of "settings surface" that are NOT followed by the qualifier and requiring that set to be empty outside the section that defines it.

### IN-20: the four guarded `setTimeout` clears are the un-swept writers of the session-identity sweep

**File:** `packages/web/src/stores/operator.ts:1011-1015, 1466-1470, 1510-1514, 1794-1798`

**Issue:** WR-13's rule as stated in the trio docstring (`:872`) is "one comparison per BRANCH THAT WRITES". Four branches that write are not covered: the transient-confirmation timers. Each fires 4000 ms later and writes `set({ <field>: undefined })` guarded only by message identity, with no `clearTimeout` anywhere in the file and no round comparison. Session A advertises, its session ends, the operator signs back in and advertises again inside the same 4 s window: A's timer fires, sees the identical `ADVERTISED_OK` string, and clears session B's confirmation early. The harm is cosmetic (a good-tone line disappears a couple of seconds early, never a false claim), which is why this is Info rather than a Warning, but it is a writing branch the sweep's own stated rule does not reach, and the docstring reads as though it does.

**Fix:** capture the round beside the message and compare both, or say in the docstring that the identity-guarded timers are a second documented exception, with the reason (they only ever clear, never assert).

### IN-21: the round guard's early return leaves in-flight markers set whenever the capture is undefined

**File:** `packages/web/src/stores/operator.ts:996, 1323, 1376, 1425, 1490, 1574, 1606, 1639, 1680, 1707`

**Issue:** Each verb sets its busy marker on entry (`cancelling`, `finalizing`, `addingTestPeers`, `broadcastBusy`, `pauseBusy`, `dismissing`, `advertiseStatus`/`advertisingId`, `createStatus`, `editStatus`) and then returns early when `stillAsking` is false, without clearing it. That is correct today for the intended case, because a false comparison from a MOVED round means a session ended and `gatedSliceReset()` cleared every marker. It is not correct for the other way `stillAsking` returns false: `askingRound` answers `undefined` whenever `auth !== 'logged-in'` (`:918`), and `undefined` never matches. In that path no session ended, nothing clears the marker, and the confirming control stays on its in-flight label (`Canceling…`, `Finalizing…`, `Disabling…`) permanently.

The only thing making this unreachable today is presentation: `OperatorConsole` replaces the entire console with the "Checking session…" card while `auth === 'checking'` (`components/operator/OperatorConsole.tsx:71-77`), so no gated control is on screen to be clicked during the one window where the capture can be undefined. A plausible future change (rendering the signed-in shell during a confirming probe instead of flashing the checking card, which is a natural UX fix) turns this latent defect live, in ten places at once.

**Fix:** clear the verb's own in-flight marker on the guard's early return, or have `askingRound` treat the probe's `checking` window as still belonging to the recorded live session (`liveSessionRound !== undefined ? get().sessionRound : undefined`), which is the stored fact the rest of this subsystem already prefers to the status.

---

_Reviewed: 2026-08-04T14:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
