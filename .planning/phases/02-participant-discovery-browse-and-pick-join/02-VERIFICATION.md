---
phase: 02-participant-discovery-browse-and-pick-join
verified: 2026-07-15T19:20:00Z
status: human_needed
score: 23/23 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 19/19 must-haves verified
  gaps_closed:
    - "G-02-1: the F1a/F1b fix (02-05) over-corrected to a single collapsed n-of-n number, deleting the operator's signing-threshold control — closed by 02-08 (two-field DraftInput { beaconType, size, threshold? }, k = threshold ?? size guarded [1, size] with THRESHOLD_ERROR, the Decision-4 FALLBACK_OFF_ERROR over-promise guard, fallbackThreshold = k set explicitly at createDraft, the DTO flip threshold=k/capacity=n atomic at all four server emit sites, cosignValue/cosignCaption pure display helpers, the two-field create form, and a new n=4/k=2 hermetic capstone proving k reaches the signing gate and is a real floor)"
  gaps_remaining: []
  regressions: []
gaps: []
human_verification:
  - test: "Two-field k-of-n directory-honesty visual re-confirm (supersedes the prior F1a/F1b single-field check, deferred from PLAN 02-08 Task 2 <human-check>): at /operator (signed in) confirm the create form now shows TWO fields, `Cohort size (seats)` and `Signing threshold (k of n)`, each with its help line, with the threshold defaulting to the size. Create a size-4 / threshold-2 CAS cohort and advertise it; in an anonymous tab confirm the directory row reads `4 seats` and a `2-of-4` co-sign figure with the caption `all co-sign; anchors if at least 2 of 4 sign`. Separately create a size-2 / threshold-2 cohort and confirm its row reads `2-of-2` with the caption `all signers required`."
    expected: "Two distinct numeric fields on the create form (not one collapsed field); the directory row's seats and co-sign figures show the honest, independent k-of-n pair with the correct conditional caption for both the k<n and k==n cases."
    why_human: "Visual fidelity of the new two-field form and the rendered k-of-n copy cannot be asserted by grep/unit tests; packages/web has no DOM render harness (deliberate, T-02-SC). The string logic itself is unit-proven (DirectoryList.spec.ts's cosignValue/cosignCaption assertions, independently re-run and passing) but the on-screen rendering and form layout are not automated."
  - test: "F2 expiry-surfacing visual re-confirm (unchanged from the prior report, deferred from PLAN 02-06 Task 3 <human-check>): at /operator, advertise a cohort and let it sit unjoined past the discovery window (or use a short PHASE_TIMEOUT_MS override for a faster check). Confirm the row flips to a bad-tone `Expired` badge with a reason, and that `Re-advertise` puts a fresh cohort back into the directory."
    expected: "An expired cohort visibly persists in the operator's list (never silently vanishes) with a legible reason; Re-advertise successfully revives it. The row now also shows the k-of-n co-sign figure (unchanged by this gap-closure plan except for the label)."
    why_human: "Visual fidelity + interaction cannot be grepped; the e2e proves the wire behavior (re-independently confirmed via pnpm e2e:operator this session), not the rendered surface."
  - test: "Pick -> identity -> join -> seated -> tail click flow (UAT Test 2 — previously deferred, then skipped pending gap closure; still due). As operator advertise a 2-of-2 cohort; from a second anonymous tab click Join, Cancel once, then generate an identity and confirm Join while a second participant fills the cohort; separately try to join a cohort that fills first; use Leave cohort from a seated state."
    expected: "Non-joinable rows show disabled Join; Cancel mints no key; a successful join reaches the seated confirmation and the reused tail proceeds to a 64-byte co-sign + resolve; a lost pick shows the deterministic filled/closed message and returns to browse; Leave returns to the directory with no dialog. The row's Co-sign figure now reads `2-of-2` (k==n honest default) rather than the old duplicated-threshold literal."
    why_human: "Same DOM-harness gap; pnpm e2e:browse proves the underlying lifecycle and selectivity headlessly (independently re-run this session, exit 0), but not the rendered click path."
---

# Phase 2: Participant Discovery + Browse-and-Pick Join Verification Report (G-02-1 Gap-Closure Re-Verification)

**Phase Goal:** A participant pointed at a service's URL can browse that service's advertised open cohorts and join one of their choosing, replacing the `shouldJoin` auto-accept of whatever advert arrives.
**Verified:** 2026-07-15T19:20:00Z
**Status:** human_needed
**Re-verification:** Yes — second gap-closure pass. Plans 02-05/06/07 (F1a/F1b/F2/F1c) were verified 19/19 in the prior report; the subsequent UAT visual re-confirm then surfaced gap G-02-1 (the F1a/F1b fix over-corrected to a single n-of-n number, deleting the operator's signing-threshold control). Plan 02-08 closed G-02-1 with a two-field k-of-n model. This report re-verifies all 8 plans (02-01..02-08) with emphasis on 02-08.

## Goal Achievement

### Observable Truths

Truths 1-19 are the prior report's consolidated set (plans 02-01..02-07). Each was re-checked this session as a **regression check** (existence + a fresh independent gate re-run), since none of them failed previously; full detail is not repeated here beyond the evidence column. Truths 20-23 are **new**, added for plan 02-08 (G-02-1 closure), and were given the full three-level check (exists, substantive, wired) plus independent re-execution of the new e2e capstone.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (ROADMAP SC1) A participant sees a list of advertised open cohorts with beacon type, network, open seats, and status | ✓ VERIFIED | `pnpm e2e:browse` re-run independently this session, exit 0; directory row fields unchanged by 02-08 except the co-sign figure (now honest k-of-n, see #20-21) |
| 2 | (ROADMAP SC2) The participant selects a specific open cohort and joins it by choice, not auto-joining whatever advert arrives | ✓ VERIFIED | `matchesPickedCohort` gate unchanged; `pnpm e2e:browse` re-run independently confirms join-by-filter selectivity (B stays at 0 seats, random-id picker seats none) |
| 3 | (ROADMAP SC3) A joined participant is seated and counts against capacity; a full/closed cohort cannot be joined | ✓ VERIFIED | `capacity === maxParticipants === minParticipants === n` still enforced server-side (02-05, kept VERBATIM by 02-08, T-KOFN-04 config-contract test passing); "counts against capacity" and cohort-lock-at-n remain the same invariant by construction |
| 4 | join-by-filter capstone still proves the mechanism end to end | ✓ VERIFIED | `pnpm e2e:browse` re-run independently: cohort A co-signs a 64-byte aggregate, cohort B stays at 0 seats, random-id picker reaches no seat |
| 5 | cohort-ready is still the definitive seat authority | ✓ VERIFIED | `packages/participant/src/index.ts`/`participant.ts` untouched by 02-08; regression covered by the full 298-test suite (re-run independently, 298/298 pass) |
| 6 | Directory-empty vs service-unreachable states remain distinct | ✓ VERIFIED | `DirectoryList.tsx`/`DirectoryList.spec.ts` `directoryView`/`fetchDirectoryState` tests untouched by 02-08 (only new describe blocks added); all pass in the re-run |
| 7 | Browse reads remain anonymous; DTO exposes only counts | ✓ VERIFIED | `directory()`/`status()` access pattern unchanged by 02-08 (only the threshold/capacity VALUES flipped, not the fields exposed); still no member DIDs/keys in `DirectoryCohortDTO` |
| 8 | Watchdog removal + CR-01 race fix hold | ✓ VERIFIED | `grep -c 'JOIN_WATCHDOG_MS\|joinWatchdog' participant.ts` == 0 (re-confirmed); regression test passing in the re-run suite |
| 9 | Inline identity step + seated confirmation + reused tail | ✓ VERIFIED (behavior-dependent; click-path visual confirmation is human-check) | `JoinIdentityStep.tsx`/`BrowseView.tsx` untouched by 02-08; `pnpm e2e:browse` proves the headless lifecycle to a 64-byte co-sign |
| 10 | Leave cohort / one-cohort-at-a-time / belt-and-suspenders Join-disabled | ✓ VERIFIED | `BrowseView.tsx` untouched by 02-08; `CohortRow.tsx`'s `isJoinable`/disabled-Join logic untouched (only the co-sign VALUE line changed) |
| 11 | (02-05/F1b) min == max == n is enforced on both sides; a capacity ceiling above the co-sign threshold is unrepresentable | ✓ VERIFIED | `operator-cohorts.ts:242-254` (`validateDraft`) and `:382-383` (`createDraft`, `config.maxParticipants = size` kept VERBATIM per 02-08's own explicit comment); `operator-cohorts.spec.ts` (29 tests, up from 20, re-run independently, pass) |
| 12 | (02-05/F1a, refined by 02-08) The directory is honest by construction — now a two-field honest pair, not a collapsed single number | ✓ VERIFIED (refined, see #20) | Superseded in spirit by G-02-1's fix; the seat-count half (`capacity === maxParticipants`) still holds, and the co-sign half is now `threshold = k` (not `= capacity`), both honest by construction |
| 13 | (02-06/F2) An advertised, unjoined cohort stays discoverable for a 30-min window, env-tunable | ✓ VERIFIED | `demo-server.ts:33,42` unchanged by 02-08; `pnpm e2e:operator` F2 leg re-run independently, exit 0 |
| 14 | (02-06/F2) Cohort expiry is surfaced to the operator, never silently deleted, never in the participant directory | ✓ VERIFIED | `settleCompletion`/`rememberTerminal`/`listCohorts` untouched in control flow by 02-08 (only the DTO's threshold/capacity fields read differently, still coalesced); `pnpm e2e:operator` re-run independently confirms the expiry leg |
| 15 | (02-06/F2) The operator can re-advertise an expired cohort via a gated route | ✓ VERIFIED | `hono-adapter.ts` route registration unchanged; 02-08 only touched the create-route comment/400 string; `pnpm e2e:operator` re-run independently confirms re-advertise |
| 16 | (02-06/F2) The terminal-record store is bounded | ✓ VERIFIED | `MAX_TERMINAL = 24` unchanged by 02-08 |
| 17 | (02-07/F1c) n-of-n MuSig2 stays the deterministic default; k-of-n fallback activates only on a genuine stall | ✓ VERIFIED | `pnpm e2e:fallback` re-run independently this session: Leg A 64-byte key-path (no fallback), Leg B forced stall recovers via script-path |
| 18 | (02-07/F1c) `fallbackThreshold` configurable, bounded `[1, participants]` | ✓ VERIFIED | `packages/shared/src/index.ts:337,352-361` unchanged by 02-08; `pnpm vitest run` (full suite) re-run independently, includes `cohort-config.spec.ts`, pass |
| 19 | (02-07/F1c) F1c does not change F2 timer semantics | ✓ VERIFIED | `pnpm e2e:operator` (F2 leg) and `pnpm e2e:fallback` (signing-phase-only stall) both re-run independently and both pass in the same session |
| **20** | **(02-08/G-02-1)** The operator sets TWO honest numbers on the create form — cohort size n (seats, finalize-at-n, unchanged from 02-05) and a signing threshold k, `1 <= k <= n`, defaulting to n; the wire body is `{ beaconType, size, threshold }` with `threshold` optional (`k = threshold ?? size`), and `createDraft` always sets `fallbackThreshold = k` explicitly | ✓ VERIFIED | `packages/service/src/operator-cohorts.ts:101-105` (`DraftInput`), `:234-255` (`validateDraft`, `k = threshold ?? size`, guarded `[1, size]` with the exact `THRESHOLD_ERROR` literal), `:370-397` (`createDraft`, `buildCohortConfig(size, beaconType, activeNetwork, recoveryKey, k)` then `config.maxParticipants = size` VERBATIM); `packages/service/src/operator-cohorts.spec.ts` new/extended tests (k<n accept, THRESHOLD_ERROR for >size/0/non-integer, null-defaults-to-n, the config-contract assertion) all pass in the independent re-run; `pnpm e2e:kofn` re-run independently confirms `capacity===4 && threshold===2` on create |
| **21** | **(02-08/G-02-1)** The participant directory and the operator list show the two numbers honestly (`joined/n seats` + a `k-of-n` co-sign figure, DTO `capacity = n`, `threshold = k`), flipped atomically at ALL FOUR server emit sites (createDraft DTO, directory(), readvertiseExpired, the listCohorts expired branch) | ✓ VERIFIED | Read directly at source: `directory()` line 360 `threshold: config.fallbackThreshold ?? config.minParticipants`; `readvertiseExpired` line 454 and the `listCohorts` expired branch line 480 both use the same coalesce on `record.config`; `createDraft` DTO line 389 `threshold: k`; `operator-cohorts.spec.ts`'s "surfaces threshold = k / capacity = n at the directory + operator-list read paths" and "carries threshold = k / capacity = n onto an expired terminal record and its re-advertise" tests exercise all four sites and pass; web: `cosignValue`/`cosignCaption` pure helpers in `packages/web/src/lib/directory.ts` consumed by both `CohortRow.tsx` and `OperatorCohortList.tsx`, proven by `DirectoryList.spec.ts`'s new "k-of-n co-sign helpers" describe block (independently re-run, pass) |
| **22** | **(02-08/G-02-1)** n-of-n MuSig2 stays the optimistic primary spend and k is the fallback floor: a hermetic n=4/k=2 capstone proves the fallback completes when 2 of 4 drop (script-path, both survivors complete) and FAILS when 3 of 4 drop (1 survivor < k) | ✓ VERIFIED | `e2e/kofn-cohort.ts` (NEW), independently re-run this session (`pnpm e2e:kofn`), exit 0: Leg 1 fills 4/4, anonymous directory shows the honest `2-of-4`, dropping 2 triggers `fallback-started` + `path === 'script-path'` + both survivors reach `cohort-complete`; Leg 2 (drop 3, 1 survivor < k) reaches `cohort-failed` (a `FallbackRequested`-phase stall reason, not `signing-complete`) — n=4/k=2 is the design-mandated distinguishable choice (guards against a false-green where a broken thread silently falls back to the library's implicit n-1=3 default) |
| **23** | **(02-08/G-02-1)** A k below the size cannot silently over-promise: `validateDraft` rejects `k < size` with a 400 when the service booted with the stall fallback disabled | ✓ VERIFIED | `operator-cohorts.ts:250-253` (`FALLBACK_OFF_ERROR` guard); `operator-cohorts.spec.ts` "refuses a threshold below size when the stall fallback is off" test (independently re-run, passes); `k == n` still allowed either way per the same test file |

**Score:** 23/23 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/service/src/operator-cohorts.ts` | Two-field `DraftInput`, `validateDraft(input, autoFallbackOnStall)`, `THRESHOLD_ERROR`/`FALLBACK_OFF_ERROR` consts, `createDraft` setting `fallbackThreshold = k` + `maxParticipants = size` VERBATIM, DTO flip at 4 emit sites | ✓ VERIFIED | Read in full; every symbol present, wired, matches SUMMARY claims exactly (see Truths 20-23) |
| `packages/service/src/operator-cohorts.spec.ts` | Two-field accept/validate, THRESHOLD_ERROR (>size/0/string), null-defaults-to-n, config-contract, read-path flip at all 4 sites, fallback-off guard | ✓ VERIFIED | 29 tests (up from 20), all pass in the independent re-run |
| `packages/service/src/index.ts` | `autoFallbackOnStall` threaded into `createOperatorCohorts` | ✓ VERIFIED | `grep -c autoFallbackOnStall` == 3 (the option field, the runner-wiring from 02-07, and the new `createOperatorCohorts` thread at line 549) |
| `packages/service/src/hono-adapter.ts` | Create-route comment + malformed-body 400 string `{ beaconType, size, threshold }` | ✓ VERIFIED | 2 occurrences confirmed at source |
| `packages/web/src/lib/directory.ts` | `cosignValue`/`cosignCaption` pure helpers | ✓ VERIFIED | Both present, documented, consumed by `CohortRow.tsx` and `OperatorCohortList.tsx` |
| `packages/web/src/lib/operator.ts` | `DraftInput` gains `threshold: number` | ✓ VERIFIED | Confirmed at source |
| `packages/web/src/components/operator/CreateCohortForm.tsx` | Two Fields, `Cohort size (seats)` + `Signing threshold (k of n)`, client THRESHOLD_ERROR guard, submits `{ beaconType, size, threshold }` | ✓ VERIFIED | Read in full; both fields present with the exact help copy from the design; `grep -c font-medium` == 0 (no banned weight introduced) |
| `packages/web/src/components/browse/CohortRow.tsx` | `{cosignValue(row)}` value line (no `Co-sign:` prefix) + `{cosignCaption(row)}` caption, old `{row.threshold}-of-{row.threshold}` literal gone | ✓ VERIFIED | Read in full; `grep -c '{row.threshold}-of-{row.threshold}'` == 0 |
| `packages/web/src/components/operator/OperatorCohortList.tsx` | Muted `Co-sign: {cosignValue}` span + k<n `fallback floor` hint | ✓ VERIFIED | Read in full, matches design |
| `packages/web/src/components/browse/DirectoryList.spec.ts` | `2-of-3` value assertion, k<n caption, k==n `all signers required` fixture | ✓ VERIFIED | New "k-of-n co-sign helpers" describe block present and passing |
| `e2e/kofn-cohort.ts` | NEW n=4/k=2 two-leg hermetic capstone | ✓ VERIFIED | Exists, read in full; `pnpm e2e:kofn` independently re-run, exit 0 |
| `e2e/operator-cohort.ts`, `e2e/browse-join-cohort.ts` | Two-field create bodies (`threshold: THRESHOLD`), `capacity` asserts | ✓ VERIFIED | Both independently re-run, exit 0; `threshold: THRESHOLD` present in both |
| `package.json` | `e2e:kofn` script, not wired into CI | ✓ VERIFIED | Present at line 22; no CI workflow reference (consistent with the documented Phase-6 CI-debt deferral) |
| `.planning/.../02-UI-SPEC.md` | Stale n-of-n co-sign copy replaced with the k-of-n label + honest conditional caption | ✓ VERIFIED | Line ~153 confirmed updated |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `CreateCohortForm.tsx` | `operator-cohorts.ts validateDraft` | posts `{ beaconType, size, threshold }`, mirrors the exact `THRESHOLD_ERROR` copy client-side | ✓ WIRED | Byte-identical literal confirmed on both sides |
| `operator-cohorts.ts createDraft` | `packages/shared/src/index.ts buildCohortConfig` | `buildCohortConfig(size, beaconType, activeNetwork, recoveryKey, k)` sets `fallbackThreshold = k`, flowing into the ADR-042 fallback tapleaf | ✓ WIRED | Confirmed at source; `pnpm e2e:kofn` Leg 1 is the direct proof (a real script-path spend validates hermetically against the fixture prevout committing that leaf) |
| `e2e/kofn-cohort.ts` | `@did-btcr2/aggregation AggregationServiceRunner` | a booted service with `autoFallbackOnStall:true` emits `signing-complete` with `path==='script-path'` after a forced signing stall with exactly k survivors | ✓ WIRED | Confirmed via independent re-run: `fallback-started` observed, `path === 'script-path'`, both k=2 survivors reach `cohort-complete` |
| `directory()`/`readvertiseExpired`/`listCohorts` (expired branch) | the DTO `threshold` field | `config.fallbackThreshold ?? config.minParticipants` (or `record.config.` for the terminal-record paths) | ✓ WIRED | All three read sites confirmed at source (lines 360, 454, 480); note the plan's own acceptance-criteria grep (`fallbackThreshold ?? config.minParticipants`) undercounts to 1 because two of the three sites read from `record.config.` rather than `config.` — a cosmetic mismatch in the plan's self-check literal, not a functional gap; all three sites are exercised and pass in `operator-cohorts.spec.ts` |
| `CohortRow.tsx`/`OperatorCohortList.tsx` | `lib/directory.ts cosignValue/cosignCaption` | direct import + call | ✓ WIRED | Confirmed at source; `DirectoryList.spec.ts` asserts the exact rendered strings |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `CohortRow.tsx` `cosignValue(row)`/`cosignCaption(row)` | `row.threshold`/`row.capacity` | `GET /v1/directory` -> `directory()` -> live `runner.session.cohorts` config enrichment (`fallbackThreshold ?? minParticipants`) | Yes — real values from the live runner session's committed config, not static | ✓ FLOWING |
| `OperatorCohortList.tsx` co-sign span | `cohort.threshold`/`cohort.capacity` | `GET /v1/operator/cohorts` -> `listCohorts()` -> `advertised`/`terminal` maps (both populated from a real `createDraft`/`advertiseCohort` call) | Yes | ✓ FLOWING |
| `CreateCohortForm.tsx` submit | `thresholdText` state | operator keystrokes, defaulted from `sizeText`, guarded client-side, POSTed verbatim | Yes — a real form field, not hardcoded | ✓ FLOWING |

### Behavioral Spot-Checks (all independently re-run this session)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Typecheck (all packages) | `pnpm typecheck` | clean (`tsc -b`) | ✓ PASS |
| Full unit test suite | `pnpm test` (`tsc -b && vitest run`) | 298/298 tests pass (26 files, up from 286) | ✓ PASS |
| Web build | `pnpm --filter @btcr2-aggregation/web build` | `tsc --noEmit` + `vite build` clean | ✓ PASS |
| Lint | `pnpm lint` | clean (`eslint .`) | ✓ PASS |
| NEW n=4/k=2 hermetic k-of-n capstone | `pnpm e2e:kofn` | exit 0 — Leg 1 (drop 2) recovers via script-path with an honest `2-of-4` directory and both survivors complete; Leg 2 (drop 3) reaches `cohort-failed`, not `signing-complete` | ✓ PASS |
| Operator lifecycle + F2 expiry leg, two-field body | `pnpm e2e:operator` | exit 0 — auth negatives, on-demand-only driver, expiry surfaced + re-advertised, `capacity === THRESHOLD` asserted | ✓ PASS |
| Browse -> pick -> join -> co-sign, two-field body | `pnpm e2e:browse` | exit 0 — directory honest, join-by-filter selectivity, 64-byte co-sign | ✓ PASS |
| F1c fallback activation capstone (unchanged) | `pnpm e2e:fallback` | exit 0 — Leg A key-path default, Leg B forced-stall script-path recovery | ✓ PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` convention; verification uses the project's vitest + tsx e2e gates above instead (all independently re-run in this session, not taken from SUMMARY.md).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| PART-01 | 02-01, 02-02, 02-04, 02-05, 02-06, 02-07, 02-08 | Participant can browse a service's advertised open cohorts with enough detail to choose, and that detail is now honest (two-field k-of-n, no phantom seat, no collapsed threshold) and durable (30-min discovery window) | ✓ SATISFIED | REQUIREMENTS.md marks PART-01 Complete; code-level evidence in Truths 1, 11-13, 17-23 |
| PART-02 | 02-01, 02-03, 02-04, 02-06 | Participant can join an advertised open cohort of their choice; expiry no longer silently strands a directory entry mid-browse | ✓ SATISFIED | REQUIREMENTS.md marks PART-02 Complete; code-level evidence in Truths 2, 14-15; unaffected by 02-08 |

No orphaned requirements: both PART-01 and PART-02 are mapped to Phase 2 in REQUIREMENTS.md, and both are claimed by plans in this phase, including the G-02-1 gap-closure plan.

### Anti-Patterns Found

Debt-marker scan (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) across all 14 files touched by plan 02-08 returned zero matches. No em-dash characters in any of those 14 files plus the touched UI-SPEC doc (checked byte-for-byte, not a visual scan).

One **informational** finding from this verification pass (not a blocker, not from the SUMMARY):

- **IN-04 (new, this verification)**: The plan's own Task 1 acceptance criterion (`grep -c 'fallbackThreshold ?? config.minParticipants' packages/service/src/operator-cohorts.ts` >= 3) undercounts to 1 in the actual source, because two of the three read sites (`readvertiseExpired`, the `listCohorts` expired branch) coalesce against `record.config.fallbackThreshold ?? record.config.minParticipants` — a different literal string than the one the plan's grep pattern searches for. This is a documentation/self-check imprecision in the plan text, not a functional gap: all three sites were confirmed present and correct by direct source reading (`operator-cohorts.ts:360,454,480`) and are each exercised by a passing `operator-cohorts.spec.ts` assertion. No action needed; noted for plan-writing hygiene only.

3 open **warning**-level findings and 3 **info**-level findings remain open from the prior gap-closure code review (`02-REVIEW.md`, dated 2026-07-15T18:38:13Z — this review predates and does NOT cover the 02-08 diff; a fresh code review of 02-08 was reported as running concurrently with this verification but had not yet landed a 02-08-scoped `02-REVIEW.md` at verification time, so this report does not rely on it and verifies 02-08 directly against source instead, per the task instructions):

- **WR-01/WR-02/WR-03** and **IN-01/IN-02/IN-03**: unchanged from the prior verification report; none of the files they concern were touched by 02-08 in a way that would resolve or worsen them (WR-01 formError placement, WR-02 raw TypeError leak on a malformed body, WR-03 SigningStarted+ invisibility in the operator list — deferred to Phase 4). None block the phase goal or any ROADMAP success criterion.

### Human Verification Required

1. **Two-field k-of-n directory-honesty visual re-confirm** (supersedes the prior F1a/F1b single-field check; deferred from PLAN 02-08 Task 2 `<human-check>`, non-blocking)
   - **Test:** At `/operator` (signed in) confirm the create form now shows TWO fields, `Cohort size (seats)` and `Signing threshold (k of n)`, each with its help line, the threshold defaulting to the size. Create a size-4 / threshold-2 CAS cohort and advertise it; in an anonymous tab confirm the directory row reads `4 seats` and a `2-of-4` co-sign figure with the caption `all co-sign; anchors if at least 2 of 4 sign`. A size-2 / threshold-2 cohort should read `2-of-2` with `all signers required`.
   - **Expected:** Two distinct numeric fields, correctly labeled and defaulted; the directory row shows the honest independent k-of-n pair with the right conditional caption in both the k<n and k==n cases.
   - **Why human:** Visual fidelity of the new form layout and the rendered copy cannot be grepped; no DOM render harness exists in `packages/web` (deliberate). The underlying string logic is unit-proven (this session's independent re-run of `DirectoryList.spec.ts`), but the on-screen rendering is not.

2. **F2 expiry-surfacing visual re-confirm** (unchanged, deferred from PLAN 02-06 Task 3 `<human-check>`, non-blocking)
   - **Test:** At `/operator`, advertise a cohort and let it sit unjoined past the discovery window (or use a short `PHASE_TIMEOUT_MS` for a faster check). Confirm the row flips to a bad-tone `Expired` badge with a reason, and `Re-advertise` puts a fresh cohort back into the directory.
   - **Expected:** An expired cohort visibly persists in the operator's list (never silently vanishes) with a legible reason; Re-advertise successfully revives it.
   - **Why human:** Visual fidelity + interaction cannot be grepped; `pnpm e2e:operator`'s F2 leg (independently re-run this session) proves the wire behavior, not the rendered surface.

3. **Pick -> identity -> join -> seated -> tail click flow** (UAT Test 2 — previously deferred, then skipped pending gap closure; still due, non-blocking)
   - **Test:** As operator advertise a 2-of-2 cohort; from a second anonymous tab click Join on the Open row, Cancel once before generating a key, then generate a KEY identity and click Join cohort while a second participant fills the cohort; separately advertise a 1-of-1 that fills before confirming and try to join it; then use Leave cohort from a seated state.
   - **Expected:** A joinable row shows an enabled Join; a Filling/Full row shows Join disabled. Clicking Join reveals the inline identity step (KEY/import choice + custody note); Cancel returns to the directory having minted no key. Confirming Join cohort with a filling partner reaches the seated confirmation `You're seated in cohort ...`, and the existing co-sign/resolve tail proceeds to a 64-byte signature + resolve. Trying to join an already-filled cohort yields `That cohort just filled or closed. Pick another from the directory.` and returns to browse with no dead spinner. Leave cohort returns to the directory with no confirmation dialog.
   - **Why human:** Same DOM-harness gap; `pnpm e2e:browse` (independently re-run this session, exit 0) proves the underlying lifecycle and selectivity headlessly, but not the rendered click path.

### Gaps Summary

No gaps remain. Gap G-02-1 (the operator's signing-threshold control, over-corrected away by the earlier F1a/F1b fix) is closed at the code level by plan 02-08: the operator now sets two honest numbers (cohort size n and signing threshold k), the wire is backward-compatible (`threshold` optional, defaulting to n), a k below the size is impossible to over-promise on a fallback-disabled service, and the DTO flip (`threshold = k`, `capacity = n`) lands atomically at all four server emit sites plus the web display, closing the door on the T-KOFN-05 partial-flip threat. A new hermetic n=4/k=2 capstone (`e2e/kofn-cohort.ts`) proves both halves of the contract — the fallback completes when dropping exactly `n - k` participants, and fails when dropping one more than that — with a parameter choice (n=4, k=2, distinguishable from the library's implicit n-1=3 default) specifically designed to prevent a false-green.

All 23 consolidated must-have truths (the 19 from the prior report plus 4 new truths for 02-08) are verified against the actual codebase, not re-asserted from SUMMARY.md: every claim was checked at the source level (files read in full) and every automated gate was re-run independently and fresh in this verification session — `pnpm typecheck`, `pnpm test` (298/298, up from 286), `pnpm lint`, the web build, and all four hermetic e2e capstones (`e2e:kofn` NEW, `e2e:operator`, `e2e:browse`, `e2e:fallback`), all passing.

The remaining work is three non-blocking human-verification items — the two-field k-of-n visual re-confirm (updated to reflect G-02-1's fix, superseding the old single-field F1a/F1b check), the F2 expiry visual re-confirm (unchanged), and the pick-to-join click flow (UAT Test 2, still pending from the original UAT pass). None of these are expected to fail given the underlying mechanisms are proven end to end by the hermetic e2e capstones; they close the loop on visual/interaction fidelity that no DOM harness in this codebase can assert.

---

_Verified: 2026-07-15T19:20:00Z_
_Verifier: Claude (gsd-verifier)_
