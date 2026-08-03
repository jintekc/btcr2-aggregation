---
phase: 05-operator-cohort-lifecycle-control
plan: 36
subsystem: ui
tags: [zustand, operator-console, session, race-condition, guard, react]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the sessionRound identity 05-34 added and the round guard it landed on refreshCohorts, plus the cohort-identity guard 05-28 added to pollDetail"
provides:
  - "a session round that identifies a SESSION rather than a probe event, so a tab switch no longer retires the round of a session that never ended"
  - "an asking-session capture on all four gated reads (refreshCohorts, pollDetail, loadSettings, saveSettings)"
  - "a 401 that ends only the session that asked, on every one of those four reads"
  - "a write that lands only in the session that asked, on every branch of pollDetail, loadSettings and saveSettings that writes"
  - "the shell's once-per-session settings latch asserted as a boolean rather than described, with OperatorConsole.tsx unedited"
  - "one anti-vacuity control per guard, so a guard that simply stopped acting fails here"
affects: [05-37, 05-38, phase-06]

actuals:
  tokens: 10000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "An answer is evidence about the question that was asked, and the question was asked by ONE session: the refusal branch is as much a fact about the asker as the ok body is"
    - "When a function branches on the KIND of answer, a concurrency guard needs one row per kind, not one row per race"
    - "A rule written down as general law in a docstring is a claim about every call site it names, and the plan that writes it owes a row per site or a narrower sentence"

key-files:
  created: []
  modified:
    - packages/web/src/stores/operator.ts
    - packages/web/tests/operator.spec.ts
    - packages/web/tests/settings.spec.ts

key-decisions:
  - "IN-07 was resolved by moving the BEHAVIOR to match the docstring, not by narrowing the docstring: `sessionRound` keeps the meaning 'one round identifies one session', because the three guards this plan adds compare it and a guard whose subject is narrower than the thing it protects is one nobody can reason about."
  - "The probe's transition status is captured at the TOP of `probe`, before its first `set({ auth: 'checking' })`. Measured after that line, no probe can ever observe a live session, so the condition would be dead code that bumps exactly as the unguarded version did. The comment names the trap at the capture site, because it is invisible where the condition is written."
  - "The 401 branches compare the round and deliberately NOT the status. Every path that ends a session bumps the round, so an unchanged round already proves this session never ended; adding a status check would additionally refuse a genuine expiry landing inside a probe's `checking` window and defer it a tick for no benefit."
  - "The 401 branches keep their position AHEAD of the write guard in `refreshCohorts` and `pollDetail`. The position was defended by a false claim (that both branches were session-scoped so the order could not matter); the position is fine once each branch carries its OWN comparison, so the comment changed and the order did not."
  - "`pollDetail` gained the session comparison ALONGSIDE its cohort comparison rather than instead of it: the cohort check cannot see a session boundary crossed while reopening the same id, and the session check cannot see a navigation inside one session."
  - "`saveSettings` derives ONE `stillAsking` boolean after its await and reads it in all four branches (ok, 401, rejection, transport fault). The transport-fault branch is guarded too, beyond the plan's three named answers, on the same reasoning `loadSettings`'s unreachable branch already carries: an error posture is a write into a console that made no save."
  - "The `UNREACHABLE` copy is asserted by its own words (`toContain`) rather than by exporting the constant, because this plan adds no exported symbol."
  - "`OperatorConsole.tsx` is unedited. The latch defect is closed in the store by refusing the dead session's write, and the shell's condition is asserted (a live session holding no snapshot) rather than changed."

patterns-established:
  - "Capture-and-compare on the refusal branch, not only on the ok branch: `if (askedInRound !== undefined && get().sessionRound === askedInRound)` guarding the shared expiry path"
  - "Anti-vacuity control paired beside each refusal row rather than grouped at the end, so a reader sees each refusal next to the thing it must not refuse"
  - "A component effect's condition asserted as a boolean computed in the store spec, closing a component-level defect without a DOM harness and without editing the component"

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "A probe that merely CONFIRMS the session already signed in leaves the round unchanged, so a tab switch cannot retire the round of a session that never ended (IN-07)"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#keeps the round when a probe merely CONFIRMS the session already signed in (review IN-07)"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#lets a list read started before a CONFIRMING probe still write when it lands (review IN-07)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A probe that finds a session live where none was live before still takes a fresh round, and no round is taken where no session becomes live"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#starts a returning session on a fresh round (a probe finds a live session)"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#takes no round where no session becomes live (throttled, disabled and rejected sign-ins, and a probe that finds none)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A 401 issued by a session that ENDED leaves the session that replaced it signed in, with no session-expired message and its gated slice untouched field by field, on all four gated reads (WR-08)"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#discards a 401 issued by a session that ENDED rather than signing the NEW session out (review WR-08)"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#pollDetail discards a 401 issued by an ENDED session rather than signing the NEW session out"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#loadSettings discards a 401 issued by an ENDED session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#saveSettings discards a 401 issued by an ENDED session"
        status: pass
    human_judgment: false
  - id: D4
    description: "The fail-closed posture is unweakened: a 401 answering the CURRENT live session still expires it immediately with the session-expired copy, on each of the four reads"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#STILL expires the session when the 401 answers the session that is live right now"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#pollDetail STILL expires the session when the 401 answers the session that is live right now"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#loadSettings STILL expires the session when the 401 answers the live session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#saveSettings STILL expires the session when the 401 answers the live session"
        status: pass
    human_judgment: false
  - id: D5
    description: "A 401 landing into a console holding no live session expires nothing, so an absent capture refuses to match rather than matching a stale value"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#expires nothing for a 401 landing into a console with no live session at all"
        status: pass
    human_judgment: false
  - id: D6
    description: "A detail answer from an ended session landing after a new session REOPENED the same cohort id writes neither the document, the provenance id nor the freshness stamp (WR-09)"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#pollDetail refuses a document from an ENDED session even when the new session REOPENS the same cohort"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#pollDetail STILL paints a same-session answer about the open cohort"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#pollDetail STILL freezes and flags a same-session unreachable read"
        status: pass
    human_judgment: false
  - id: D7
    description: "A settings read from an ended session leaves the snapshot undefined AND leaves the console shell's own re-read condition true, so the new session issues its own read and the create form never opens on a previous session's defaults (WR-09)"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#loadSettings refuses a snapshot from an ENDED session, leaving the shell free to re-read"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#loadSettings STILL populates the snapshot for the session that asked"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#loadSettings STILL shows the unreachable posture for the session that asked"
        status: pass
    human_judgment: false
  - id: D8
    description: "A save answer from an ended session writes neither the served snapshot, the saved message nor a validation error, while a same-session save still writes all of them"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#saveSettings refuses a served snapshot from an ENDED session"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#saveSettings refuses a REJECTION aimed at an ended session, so no error lands in a console that never saved"
        status: pass
      - kind: unit
        ref: "packages/web/tests/operator.spec.ts#saveSettings STILL writes the served snapshot and the saved message for the session that saved"
        status: pass
    human_judgment: false
  - id: D9
    description: "Every guard added here is load-bearing, proven by reverting it and observing the named rows RED with their neighbours green"
    requirement: SVC-04
    verification:
      - kind: manual
        ref: "three mutation runs recorded verbatim under Mutation checks below"
        status: pass
    human_judgment: false
  - id: D10
    description: "In a real browser at the shipped 4000 ms list poll and 4000 ms detail poll against the 8000 ms client timeout, a session expiry followed immediately by a password-manager sign-in leaves the operator signed in, on their own session's data, with no false session-ended message and no drill-down or settings content belonging to the previous session"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "Stated as a backstop truth in the plan. It needs a person, a browser, a real service and a real session expiry; the hermetic rows drive the store directly and cannot observe what the rendered console shows."

duration: 15 min
completed: 2026-08-03
status: complete
---

# Phase 05 Plan 36: Session-identity discipline across every gated read Summary

**One meaning for a session round, one guard shape applied to all four gated operator reads, so a 401 ends only the session that asked and no answer is written into a session that did not ask for it (review WR-08, WR-09, IN-07).**

## What Was Built

Round 5 wrote the session-identity rule down as general law in `sessionRound`'s docstring and applied it to one of three gated reads, and to none of their refusal branches. Three changes close that:

1. **`probe` bumps on a transition, not on a landing (IN-07).** The status the transition is measured against is captured at the top of `probe`, before its first `set({ auth: 'checking' })`. Measured after that line the condition would be dead code, because no probe can ever observe a live session once it has assigned `checking` to itself. The `sessionRound` docstring now names the probe bump as a transition, cites IN-07, keeps the paragraph explaining the END bumps, and states the guarantee the three guards below lean on.
2. **A 401 ends only the session that asked (WR-08).** `pollDetail`, `loadSettings` and `saveSettings` each gained the asking-session capture `refreshCohorts` already took, named after the shipped `askedInRound` precedent, and all four unauthorized branches now run the shared expiry path only when that captured round is defined and still the live one. The comment defending `refreshCohorts`'s branch position no longer claims both branches are scoped to the same session; it states that a 401 is evidence about the asker and cites WR-08.
3. **A write lands only in the session that asked (WR-09).** `pollDetail` compares the session alongside the cohort, `loadSettings` compares the session ahead of both its writing branches, and `saveSettings` derives one `stillAsking` boolean read by all four of its branches.

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | A round identifies a session (IN-07) | `5b3e3e1` | `packages/web/src/stores/operator.ts`, `packages/web/tests/operator.spec.ts` |
| 2 | A 401 ends only the session that asked (WR-08) | `296bfdb` | same two, plus `packages/web/tests/settings.spec.ts` |
| 3 | A gated read writes only into the session that asked (WR-09) | `a664eec` | `packages/web/src/stores/operator.ts`, `packages/web/tests/operator.spec.ts` |

## Mutation checks (each guard proven load-bearing)

**Task 1, remove the transition condition** (`if (wasLive)` forced false, so `probe` bumps on every live landing again):

```
FAIL  operator.spec.ts > ... > keeps the round when a probe merely CONFIRMS the session already signed in (review IN-07)
FAIL  operator.spec.ts > ... > lets a list read started before a CONFIRMING probe still write when it lands (review IN-07)
      Tests  2 failed | 42 passed (44)
```

Restored: `Tests 44 passed (44)`. Every 05-34 coverage row (sign-in, returning probe, expiry, sign-out, the negative row) stayed green throughout, which is the evidence one condition moved rather than the bump model.

**Task 2, remove the comparison from ONE read's 401 branch** (`loadSettings`):

```
FAIL  operator.spec.ts > ... > loadSettings discards a 401 issued by an ENDED session
      Tests  1 failed | 77 passed (78)
```

Restored: `Tests 78 passed (78)`. The other three reads' ABA rows stayed green, which proves the four guards are independently load-bearing rather than covered by a neighbour.

**Task 3, remove the session comparison from `pollDetail` only:**

```
FAIL  operator.spec.ts > ... > pollDetail refuses a document from an ENDED session even when the new session REOPENS the same cohort
      Tests  1 failed | 86 passed (87)
```

Restored: `Tests 87 passed (87)`. The settings rows and every 05-28 cohort-identity row stayed green.

Each fix was also written RED first: the two IN-07 rows failed against the shipped store (`expected 19 to be 18`, and the in-flight list read writing nothing), the five WR-08 rows failed together (`5 failed | 73 passed`), and the four WR-09 rows failed together (`4 failed | 58 passed`).

## Gate

| Check | Result |
|-------|--------|
| `pnpm test` | 68 files, **1291 tests**, green (baseline for this round: 68 files, 1271 tests) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `git diff --stat packages/service` | empty |
| `git diff --stat pnpm-lock.yaml` | empty |
| `packages/web/src/components/operator/OperatorConsole.tsx` | unedited |
| em-dash grep over the three touched files | no files |

Twenty new rows, none removed, none loosened. `packages/web/tests/operator.spec.ts` went from 41 to 62 rows; `settings.spec.ts` kept its count with three assertions byte-identical inside a reshaped `beforeEach`.

**`pnpm e2e:gate` was deliberately not run here**, and this is the reasoning rather than a silent skip: this plan changes only `packages/web/src/stores/operator.ts` and two spec files, no e2e leg drives the browser store (the operator legs drive the service over HTTP and the browser capstones are local-only), and the round-wide rule puts one `e2e:gate` run at the end of 05-38, which is the only plan in this round that touches service code.

## Deviations from Plan

None that changed scope. Three details worth recording:

1. **`saveSettings`'s transport-fault branch is guarded too**, beyond the three answers the plan enumerates (ok, 401, rejection). It writes an error posture into the settings slice on the same footing as the rejection branch, and `loadSettings`'s unreachable branch already carried that reasoning. The acceptance criterion is "before every branch that writes", which this satisfies rather than exceeds.
2. **The unreachable copy is asserted with `toContain('Could not reach the service')`** rather than against an imported constant: `UNREACHABLE` is module-private in the store, and the plan prohibits adding an exported symbol.
3. **The reshaped save block in `settings.spec.ts` seeds `auth: 'logged-in'` only** (plus the snapshot it already seeded). Nothing else moved, and the three rows' assertions are byte-identical.

## Deliberately NOT done, enumerated for the next round

The plan prohibits widening this fix to the operator-initiated ACTION verbs, which share the unguarded-401 shape. Enumerated here so the next round inherits the list rather than rediscovering it. Nine call sites in `packages/web/src/stores/operator.ts` call `get().expireSession()` with no session comparison:

| Verb | Line (post-change) | Kind |
|------|--------------------|------|
| `runAdvertisingToggle` (pause and resume) | ~718 | operator action |
| `saveDraftEdit` | ~1058 | operator action |
| `discard` | ~1125 | operator action |
| `exportCohort` | ~1139 | operator action |
| `cancelCohort` | ~1154 | operator action |
| `finalizeCohort` | ~1178 | operator action |
| `addTestPeers` | ~1203 | operator action |
| `disableBroadcast` | ~1236 | operator action |
| `dismissEnded` | ~1256 | operator action |

All nine are user-initiated single requests rather than polls or late-landing reads, the review names none of them, and they are recorded as an accepted threat (T-05-36-06) rather than a gap. `advertise` and `readvertise` have no direct expiry branch at all: they route through `refreshCohorts`, which is now guarded.

Also untouched by owner decision, each pinned as a prohibition and re-confirmed unedited: `lastUpdated` is not split (WR-05) even though this plan touches both of its writers; the `LifecycleActions` provenance barrier (WR-04), `validateDraft`'s per-draft window rule (WR-03), `numericKnob`'s coercion (IN-01) and `parseWindow` (IN-02); the earlier carried findings (the verdict cache never cleared, `tx-client.ts`'s missing timeout, the unbounded `verdictCache` singleton, the `/cas` prototype-pollution 500, the test-peer seat cap); the deferred advert-slot-on-fill item; and the 16 pending human items in `05-UAT.md`, none of which this plan claims to close.

No abort controller and no request cancellation was added: the guard makes a late answer harmless rather than preventing it, and an aborted request that lost the race still has to be ignored. Nothing moved onto the wire.

## Known limits recorded rather than claimed closed

An answer landing INSIDE a probe's own `checking` window is still discarded by the retained status check in `refreshCohorts` (threat T-05-36-07, accepted). The window is one probe round trip rather than one poll interval, the cost is one skipped update, and closing it would mean writing into a console whose session state is momentarily unknown. This is named in the consequence row's own comment rather than left as a silent gap.

## Known Stubs

None. No placeholder value, no empty data source, no TODO or FIXME was introduced.

## Self-Check: PASSED

- `packages/web/src/stores/operator.ts` FOUND
- `packages/web/tests/operator.spec.ts` FOUND
- `packages/web/tests/settings.spec.ts` FOUND
- commit `5b3e3e1` FOUND
- commit `296bfdb` FOUND
- commit `a664eec` FOUND
