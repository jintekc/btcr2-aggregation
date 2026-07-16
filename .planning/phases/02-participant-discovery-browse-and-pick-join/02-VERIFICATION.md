---
phase: 02-participant-discovery-browse-and-pick-join
verified: 2026-07-16T14:00:00Z
status: human_needed
score: 28/28 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 23/23 must-haves verified
  gaps_closed:
    - "G-02-2: the 90s join-seat grace timer, previously armed in the cohort-joined handler at opt-in, falsely resolved a legitimately-filling cohort to 'filled or closed' under the wait-for-n (02-05) + 30-min discovery window (02-06) model, and its teardown stranded the accepted opt-in as an unreclaimable zombie seat. Closed by 02-09: the grace now arms exactly once, in handleDirectorySnapshot's opted-in-departure branch (the FIRST observed departure of the picked cohort from the Advertised set), guarded by the pre-existing joinGraceLogged one-shot; cohort-joined records the opt-in only and arms nothing; a new awaitingSeats { joined, capacity } | null field is captured on every still-Advertised poll tick and rendered in JoinIdentityStep.tsx as 'Waiting for the cohort to fill ({joined}/{capacity} seats)'; awaitingSeats resets on all five terminal/reset paths (adopt, join, leave, cohort-ready, fail)."
  gaps_remaining: []
  regressions: []
gaps: []
human_verification:
  - test: "F2 expiry-surfacing visual re-confirm (unchanged from the prior two reports, deferred from PLAN 02-06 Task 3 <human-check>, non-blocking)"
    expected: "An expired cohort visibly persists in the operator's list (never silently vanishes) with a legible reason; Re-advertise successfully revives it."
    why_human: "Visual fidelity + interaction cannot be grepped; pnpm e2e:operator's F2 leg (independently re-run this session, exit 0) proves the wire behavior, not the rendered surface."
  - test: "Pick -> identity -> join -> seated -> tail click flow, INCLUDING the new G-02-2 waiting-line behavior (UAT Test 2/3, previously deferred pending gap closure; the join path this gap changed). As operator advertise a 2-of-2 cohort; from a second anonymous tab click Join on the Open row, Cancel once before generating a key, then generate a KEY identity and click Join cohort while the cohort is NOT yet full; confirm the button stays 'Joining...' AND a faint line reads 'Waiting for the cohort to fill (1/2 seats)' (or the live count) instead of only a bare spinner, and the participant is NOT falsely failed while the row stays Advertised; then have a second participant fill the cohort and confirm it reaches the seated confirmation. Separately try to join a cohort that fills first; use Leave cohort from a seated state."
    expected: "A joinable row shows an enabled Join; a Filling/Full row shows Join disabled. Clicking Join reveals the inline identity step; Cancel returns to the directory having minted no key. Confirming Join while the cohort is still filling shows the truthful 'Waiting for the cohort to fill ({joined}/{capacity} seats)' line (not a false 90s failure), and once a second participant fills the cohort the seated confirmation 'You're seated in cohort ...' appears, with the reused tail proceeding to a 64-byte co-sign + resolve. Trying to join an already-filled cohort yields the deterministic filled/closed message and returns to browse with no dead spinner. Leave cohort returns to the directory with no confirmation dialog."
    why_human: "Same DOM-harness gap (packages/web has no render harness, deliberate, T-02-SC); pnpm e2e:browse (independently re-run this session, exit 0) proves the underlying lifecycle and selectivity headlessly, but not the rendered click path or the new waiting-line copy on screen. The prior Test 1 (two-field k-of-n form + honest directory row) already PASSED visually and needs no re-test."
---

# Phase 2: Participant Discovery + Browse-and-Pick Join Verification Report (G-02-2 Gap-Closure Re-Verification)

**Phase Goal:** A participant pointed at a service's URL can browse that service's advertised open cohorts and join one of their choosing, replacing the `shouldJoin` auto-accept of whatever advert arrives.
**Verified:** 2026-07-16T14:00:00Z
**Status:** human_needed
**Re-verification:** Yes, third gap-closure pass. Plans 02-01..02-07 were verified 19/19; the UAT visual re-confirm then surfaced G-02-1 (over-corrected single n-of-n threshold), closed by 02-08 and re-verified 23/23 (human_needed). The 02-08 UAT visual pass then surfaced a NEW gap, G-02-2 (the 90s join-seat grace timer falsely failing a legitimately-filling cohort under the wait-for-n model). Plan 02-09 closes G-02-2. This report re-verifies all NINE plans (02-01..02-09) with emphasis on 02-09, superseding the prior 23/23 report.

## Goal Achievement

### Observable Truths

Truths 1-23 are the prior report's consolidated set (plans 02-01..02-08), none of which were touched by 02-09's diff (participant.ts's join lifecycle, participant.spec.ts, JoinIdentityStep.tsx). Re-checked this session as a **regression check**: existence unchanged, and every gate that exercises them was independently re-run fresh (not read from SUMMARY.md). Full per-truth detail for 1-23 is carried forward from the prior report (`git show 4ac464b:.../02-VERIFICATION.md`); the evidence column below reflects this session's fresh re-run, not the prior session's.

Truths 24-28 are **new**, added for plan 02-09 (G-02-2 closure), and were given the full three-level check (exists, substantive, wired) plus independent re-execution of the reworked spec and all four hermetic e2e capstones.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (ROADMAP SC1) A participant sees a list of advertised open cohorts with beacon type, network, open seats, and status | VERIFIED | `pnpm e2e:browse` re-run independently this session, exit 0; directory row shape untouched by 02-09 |
| 2 | (ROADMAP SC2) The participant selects a specific open cohort and joins it by choice, not auto-joining whatever advert arrives | VERIFIED | `matchesPickedCohort`/`cohortId` threading in `createParticipant` unchanged; `pnpm e2e:browse` join-by-filter selectivity re-confirmed (B stays at 0 seats, random-id picker seats none) |
| 3 | (ROADMAP SC3) A joined participant is seated and counts against capacity; a full/closed cohort cannot be joined | VERIFIED | `capacity === maxParticipants === minParticipants === n` server-side invariant unchanged; `cohort-ready` (the sole seat authority) untouched by 02-09 |
| 4 | join-by-filter capstone still proves the mechanism end to end | VERIFIED | `pnpm e2e:browse` re-run independently: cohort A co-signs a 64-byte aggregate, cohort B stays at 0 seats, random-id picker reaches no seat |
| 5 | cohort-ready is still the definitive seat authority | VERIFIED | `packages/participant/src/index.ts` untouched by 02-09; `packages/web/src/stores/participant.ts` cohort-ready handler unchanged in its `seated: true` semantics (only gained an `awaitingSeats: null` reset alongside it) |
| 6 | Directory-empty vs service-unreachable states remain distinct | VERIFIED | `DirectoryList.tsx`/`DirectoryList.spec.ts` untouched by 02-09; full suite re-run, all pass |
| 7 | Browse reads remain anonymous; DTO exposes only counts | VERIFIED | `directory()`/`status()` unchanged by 02-09; `awaitingSeats` (the only new field) carries only the already-public `joined`/`capacity` counts, no DIDs/keys |
| 8 | Watchdog removal + CR-01 race fix hold | VERIFIED | `grep -c 'JOIN_WATCHDOG_MS\|joinWatchdog' participant.ts` == 0 (re-confirmed this session); CR-01 is the exact concern 02-09 rewrites (see truth 25) and remains proven |
| 9 | Inline identity step + seated confirmation + reused tail | VERIFIED (behavior-dependent; click-path visual confirmation is human-check) | `pnpm e2e:browse` re-run independently proves the headless lifecycle to a 64-byte co-sign; `JoinIdentityStep.tsx`'s confirm block is additively extended by 02-09 (waiting line only), not replaced |
| 10 | Leave cohort / one-cohort-at-a-time / belt-and-suspenders Join-disabled | VERIFIED | `BrowseView.tsx` untouched by 02-09; `leave()` gained the `awaitingSeats: null` reset alongside its existing `seated`/`optedIn`/`joinClosed` resets (spec test (e), independently re-run, pass) |
| 11 | (02-05/F1b) min == max == n enforced both sides | VERIFIED | `operator-cohorts.ts` untouched by 02-09; `operator-cohorts.spec.ts` (29 tests) re-run independently, pass |
| 12 | (02-05/F1a, refined by 02-08) The directory is honest by construction, two-field k-of-n pair | VERIFIED | Untouched by 02-09; `DirectoryList.spec.ts`'s k-of-n describe block re-run independently, pass |
| 13 | (02-06/F2) An advertised, unjoined cohort stays discoverable for a 30-min window, env-tunable | VERIFIED | `demo-server.ts` unchanged by 02-09; `pnpm e2e:operator` F2 leg re-run independently, exit 0 |
| 14 | (02-06/F2) Cohort expiry is surfaced to the operator, never silently deleted, never in the participant directory | VERIFIED | Untouched by 02-09; `pnpm e2e:operator` re-run independently confirms the expiry leg |
| 15 | (02-06/F2) The operator can re-advertise an expired cohort via a gated route | VERIFIED | Untouched by 02-09; `pnpm e2e:operator` re-run independently confirms re-advertise |
| 16 | (02-06/F2) The terminal-record store is bounded | VERIFIED | `MAX_TERMINAL = 24` unchanged |
| 17 | (02-07/F1c) n-of-n MuSig2 stays the deterministic default; k-of-n fallback activates only on a genuine stall | VERIFIED | `pnpm e2e:fallback` re-run independently this session: Leg A 64-byte key-path (no fallback), Leg B forced stall recovers via script-path |
| 18 | (02-07/F1c) `fallbackThreshold` configurable, bounded `[1, participants]` | VERIFIED | `packages/shared/src/index.ts` unchanged by 02-09; full suite re-run, pass |
| 19 | (02-07/F1c) F1c does not change F2 timer semantics | VERIFIED | `pnpm e2e:operator` (F2 leg) and `pnpm e2e:fallback` both re-run independently and both pass |
| 20 | (02-08/G-02-1) The operator sets two honest numbers, size n and threshold k, `1 <= k <= n`, wire `{ beaconType, size, threshold }` | VERIFIED | `operator-cohorts.ts` untouched by 02-09; `pnpm e2e:kofn` re-run independently confirms `capacity===4 && threshold===2` on create |
| 21 | (02-08/G-02-1) The directory and operator list show the two numbers honestly, flipped atomically at all four server emit sites | VERIFIED | Untouched by 02-09; `operator-cohorts.spec.ts` re-run independently, pass |
| 22 | (02-08/G-02-1) n-of-n MuSig2 stays the optimistic primary spend and k is the fallback floor (n=4/k=2 capstone) | VERIFIED | `pnpm e2e:kofn` re-run independently this session, exit 0: Leg 1 (drop 2) recovers via script-path, Leg 2 (drop 3, 1 survivor < k) reaches `cohort-failed` |
| 23 | (02-08/G-02-1) A k below the size cannot silently over-promise when the stall fallback is off | VERIFIED | `operator-cohorts.ts` `FALLBACK_OFF_ERROR` guard unchanged; spec test re-run independently, pass |
| **24** | **(02-09/G-02-2)** The join-seat grace timer arms on the FIRST observed departure of the picked cohort from the Advertised set (`handleDirectorySnapshot`'s opted-in branch), NOT at opt-in (`cohort-joined`). `cohort-joined` records `optedIn`/steps/log and arms nothing | VERIFIED | Read directly at source: `participant.ts:551-571` (`cohort-joined` handler, no `setTimeout` call, comment states "arms nothing"); `:739-749` (`handleDirectorySnapshot`'s opted-in-departure branch, `joinGrace = setTimeout(...)` is the sole arming site, `grep -c 'joinGrace = setTimeout'` == 1, independently confirmed); `participant.spec.ts` test "captures awaitingSeats and never fails an opted-in member while the picked cohort is still Advertised" (a still-Advertised opted-in participant survives `vi.advanceTimersByTime(JOIN_SEAT_GRACE_MS + 1000)` at `status: 'live'`) independently re-run and passing — this is a **behavior-dependent state-transition truth and it is behaviorally proven**, not just present |
| **25** | **(02-09/G-02-2)** CR-01 survives the move: the poll never tears down an opted-in member directly; the grace still exists (armed at observed departure); `cohort-ready` during the wait or the grace seats normally and clears both the poll and the grace; arming is one-shot via `joinGraceLogged`, never re-arming or resetting under repeated ~5s poll ticks | VERIFIED | `participant.spec.ts` tests "protects a genuine member seated during the grace window (CR-01)", "arms the grace at most once across repeated departure polls (arm-once)", and "protects an opted-in member the instant the picked cohort leaves Advertised (CR-01)" all independently re-run and passing (16/16 total in the file); `cohort-ready` handler at `participant.ts:572-581` unchanged in its `clearJoinGrace()`/`clearDirectoryPoll()` calls |
| **26** | **(02-09/G-02-2)** A truthful waiting surface: `awaitingSeats { joined, capacity } \| null` is captured on the still-Advertised poll path and rendered in `JoinIdentityStep.tsx` as `Waiting for the cohort to fill ({joined}/{capacity} seats)`; resets in `leave()`, the fail terminals, `cohort-ready`, and a fresh `join()` | VERIFIED | Source: `participant.ts:148` (field), `:435`/`:461` (initial + adopt), `:509-518`/`535` (join reset), `:414` (fail), `:577` (cohort-ready), `:728-739`/`767` (leave); `:712-718` (the sole capture site); `grep -c 'awaitingSeats' participant.ts` == 9 (>= 6 required); `JoinIdentityStep.tsx:39` selector + `:163-167` conditional render, `grep -c 'awaitingSeats'` == 3, `grep -c 'Waiting for the cohort to fill'` == 1; spec test "resets awaitingSeats to null on leave()" and "captures awaitingSeats and never fails..." both independently re-run and passing |
| **27** | **(02-09/G-02-2)** The client can never hang forever: bounded server-side by the cohort's own 30-min discovery window (02-06); when it expires the row vanishes, the poll observes the departure, arms the grace, and resolves to the deterministic filled-or-closed terminal | VERIFIED | `demo-server.ts` TTL/expiry mechanism unchanged (02-06, untouched by 02-09); the departure -> grace -> terminal chain is directly the mechanism proven by spec test "arms the grace once on an observed departure and resolves to filled-or-closed after the window (G-02-2)" (independently re-run, pass); `pnpm e2e:operator`'s F2 leg (independently re-run, exit 0) proves the row-vanish-on-TTL half of the chain |
| **28** | **(02-09/G-02-2)** Zero new packages, browser-only change; the four hermetic capstones (e2e:browse, e2e:operator, e2e:kofn, e2e:fallback) re-prove no regression | VERIFIED | `git show ef7971f c1c36cc --stat` touches only `packages/web/**`; `pnpm-lock.yaml` untouched; all four capstones independently re-run this session, all exit 0 (see Behavioral Spot-Checks) |

**Score:** 28/28 truths verified (0 present-but-behavior-unverified). Truths 24 and 25 assert state transitions/invariants (timer arming, arm-once, CR-01 protection) and are each backed by a passing `vi.useFakeTimers()`-driven behavioral test independently re-run this session, not symbol presence alone.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/web/src/stores/participant.ts` | Grace-timer arming moved from `cohort-joined` to `handleDirectorySnapshot`'s opted-in-departure branch (one-shot); `awaitingSeats` field + capture + five resets; rewritten CR-01/wait-for-n comments | VERIFIED | Read in full; every symbol present, wired, matches SUMMARY claims exactly (see Truths 24-27) |
| `packages/web/src/stores/participant.spec.ts` | RED-first coverage: still-Advertised not-failed + awaitingSeats capture; departure arms grace once, elapses to terminal; seat-during-grace protected; arm-once; never-opted-in departure unchanged; leave() resets awaitingSeats | VERIFIED | Read in full; 16 tests, independently re-run, all pass; `vi.useFakeTimers()` + `afterEach(leave())` teardown confirmed present |
| `packages/web/src/components/browse/JoinIdentityStep.tsx` | `Waiting for the cohort to fill ({joined}/{capacity} seats)` line, read from the store's `awaitingSeats` slice, additive to the existing `Joining…` state | VERIFIED | Read in full; line present at `:163-167`, no `font-medium` weight added to the new markup, additive (button state untouched) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `participant.ts handleDirectorySnapshot` (still-Advertised early-return) | the `awaitingSeats` store field | `set({ awaitingSeats: { joined: row.joined, capacity: row.capacity } })` from the picked Advertised row | WIRED | Confirmed at `:712-717`; only capture site (per plan's design) |
| `participant.ts handleDirectorySnapshot` (opted-in departure branch) | the module-scope `joinGrace` timer | one-shot arm guarded by `joinGraceLogged`, replacing the arm formerly in `cohort-joined` | WIRED | Confirmed at `:739-749`; `grep -c 'joinGrace = setTimeout'` == 1 (single site, not duplicated) |
| `JoinIdentityStep.tsx` | the participant store `awaitingSeats` slice | `useParticipant((s) => s.awaitingSeats)` rendered as the waiting line while `joining` | WIRED | Confirmed at `:39` and `:163-167` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `JoinIdentityStep.tsx` waiting line | `awaitingSeats.joined`/`.capacity` | store `awaitingSeats` <- `handleDirectorySnapshot` <- `GET /v1/directory` poll (every ~5s, live server data) | Yes, real polled counts from the live coordinator's directory, not static | FLOWING |

### Behavioral Spot-Checks (all independently re-run this session, fresh, not read from SUMMARY.md)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| The reworked store spec (16 tests, incl. 5 new G-02-2 tests) | `pnpm vitest run packages/web/src/stores/participant.spec.ts` | 16/16 pass | PASS |
| Typecheck (all packages) | `pnpm typecheck` | clean (`tsc -b`) | PASS |
| Full unit test suite | `pnpm test` (`tsc -b && vitest run`) | 302/302 tests pass (26 files, unchanged from the 02-08 report since 02-09 added tests to an existing file) | PASS |
| Web build | `pnpm --filter @btcr2-aggregation/web build` | `tsc --noEmit` + `vite build` clean (pre-existing chunk-size advisory only) | PASS |
| Lint | `pnpm lint` | clean (`eslint .`) | PASS |
| Browse -> pick -> join -> co-sign capstone | `pnpm e2e:browse` | exit 0 | PASS |
| Operator lifecycle + F2 expiry leg | `pnpm e2e:operator` | exit 0 | PASS |
| n=4/k=2 hermetic k-of-n capstone | `pnpm e2e:kofn` | exit 0 | PASS |
| F1c fallback activation capstone | `pnpm e2e:fallback` | exit 0 | PASS |

### Probe Execution

Not applicable. This phase has no `scripts/*/tests/probe-*.sh` convention; verification uses the project's vitest + tsx e2e gates above instead (all independently re-run in this session).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| PART-01 | 02-01, 02-02, 02-04, 02-05, 02-06, 02-07, 02-08 | Participant can browse a service's advertised open cohorts with enough detail to choose | SATISFIED | REQUIREMENTS.md marks PART-01 Complete; unaffected by 02-09 (directory-row shape unchanged) |
| PART-02 | 02-01, 02-03, 02-04, 02-06, 02-09 | Participant can join an advertised open cohort of their choice; the join wait is now truthful and never falsely fails a legitimately-filling cohort (G-02-2) | SATISFIED | REQUIREMENTS.md marks PART-02 Complete; code-level evidence in Truths 2, 14-15, 24-27; 02-09 strengthens PART-02 by fixing a false-failure defect in the join-by-choice lifecycle |

No orphaned requirements: both PART-01 and PART-02 are mapped to Phase 2 in REQUIREMENTS.md, and both are claimed by plans in this phase, including 02-09.

### Anti-Patterns Found

Debt-marker scan (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) across all three files touched by plan 02-09 returned zero matches. No em-dash characters in any of the three touched files. No placeholder/"coming soon"/"not yet implemented" strings.

No new anti-patterns found this session. Carried forward from the prior report (unchanged, none touched by 02-09):

- 3 open **warning**-level findings and 3 **info**-level findings remain open from the prior gap-closure code review (`02-REVIEW.md`, dated 2026-07-15T18:38:13Z, scoped to 02-08). None concern files 02-09 touched; none block the phase goal or any ROADMAP success criterion (WR-01 formError placement, WR-02 raw TypeError leak on a malformed body, WR-03 SigningStarted+ invisibility in the operator list — deferred to Phase 4).
- **IN-04** (informational, plan-writing hygiene only, not a functional gap): a stale grep-count self-check literal in the 02-08 plan text; unrelated to 02-09.

### Human Verification Required

1. **F2 expiry-surfacing visual re-confirm** (unchanged from the prior two reports, deferred from PLAN 02-06 Task 3 `<human-check>`, non-blocking)
   - **Test:** At `/operator`, advertise a cohort and let it sit unjoined past the discovery window (or use a short `PHASE_TIMEOUT_MS` for a faster check). Confirm the row flips to a bad-tone `Expired` badge with a reason, and `Re-advertise` puts a fresh cohort back into the directory.
   - **Expected:** An expired cohort visibly persists in the operator's list (never silently vanishes) with a legible reason; Re-advertise successfully revives it.
   - **Why human:** Visual fidelity + interaction cannot be grepped; `pnpm e2e:operator`'s F2 leg (independently re-run this session, exit 0) proves the wire behavior, not the rendered surface.

2. **Pick -> identity -> join -> seated -> tail click flow, including the new G-02-2 waiting-line behavior** (UAT Test 2/3 — the join path 02-09 changed; still due, non-blocking)
   - **Test:** As operator advertise a 2-of-2 cohort; from a second anonymous tab click Join on the Open row, Cancel once before generating a key, then generate a KEY identity and click Join cohort while the cohort is NOT yet full. Confirm the button stays `Joining…` and a faint line reads `Waiting for the cohort to fill (1/2 seats)` (or the live count) instead of only a bare spinner, and the participant is NOT falsely failed while the row stays Advertised. Then have a second participant fill the cohort and confirm it reaches the seated confirmation. Separately try to join a cohort that fills first; use Leave cohort from a seated state.
   - **Expected:** Non-joinable rows show disabled Join; Cancel mints no key; confirming Join while the cohort is still filling shows the truthful waiting line (not a false 90s failure); once the second participant fills the cohort, the seated confirmation `You're seated in cohort ...` appears and the reused tail proceeds to a 64-byte co-sign + resolve. A lost pick shows the deterministic filled/closed message and returns to browse with no dead spinner. Leave cohort returns to the directory with no confirmation dialog.
   - **Why human:** Same DOM-harness gap (no render harness in `packages/web`, deliberate, T-02-SC); `pnpm e2e:browse` (independently re-run this session, exit 0) proves the underlying lifecycle and selectivity headlessly, but not the rendered click path or the new waiting-line copy on screen.

The prior Test 1 (two-field k-of-n form + honest directory row) already PASSED visually in the last UAT pass and needs no re-test.

### Gaps Summary

No gaps remain. G-02-2 (the 90s join-seat grace timer falsely failing a legitimately-filling cohort under the wait-for-n + 30-min discovery window model, and the resulting zombie opt-in) is closed at the code level by plan 02-09: the grace now arms exactly once, on the first observed departure of the picked cohort from the Advertised set, rather than at opt-in; the CR-01 member-protection invariant (never tear down a genuine member mid-keygen) is preserved and behaviorally proven with `vi.useFakeTimers()`; a new `awaitingSeats` field gives the join flow a truthful, non-misleading waiting surface; and the client can never hang forever because the cohort's own server-side 30-minute discovery window (02-06) bounds the wait, observed by the poll as a departure that then drives the same deterministic filled-or-closed terminal.

All 28 consolidated must-have truths (23 carried forward plus 5 new for 02-09) are verified against the actual codebase, not re-asserted from SUMMARY.md: every claim was checked at the source level (files read in full) and every automated gate was re-run independently and fresh in this verification session — `pnpm vitest run` on the reworked spec (16/16), `pnpm typecheck`, `pnpm test` (302/302), `pnpm lint`, the web build, and all four hermetic e2e capstones (`e2e:browse`, `e2e:operator`, `e2e:kofn`, `e2e:fallback`), all passing. The two behavior-dependent truths this plan introduces (grace arming site, CR-01 protection under repeated poll ticks) are backed by passing fake-timer state-transition tests, not symbol presence alone.

The remaining work is two non-blocking human-verification items: the F2 expiry visual re-confirm (unchanged, carried forward) and the pick-to-join click flow now including the new waiting-line behavior the G-02-2 fix introduced. Neither is expected to fail given the underlying mechanisms are proven end to end by the hermetic e2e capstones and the reworked fake-timer spec; they close the loop on visual/interaction fidelity that no DOM harness in this codebase can assert.

---

_Verified: 2026-07-16T14:00:00Z_
_Verifier: Claude (gsd-verifier)_
