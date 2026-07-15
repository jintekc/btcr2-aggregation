---
phase: 02-participant-discovery-browse-and-pick-join
verified: 2026-07-15T19:00:00Z
status: human_needed
score: 19/19 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 10/10 must-haves verified
  gaps_closed:
    - "F1a: directory advertised a phantom open seat that could never fill (capacity > threshold) — closed by 02-05 (single `size` n, min == max == n unrepresentable server-side)"
    - "F1b: operator could set threshold != capacity — closed by 02-05 (collapsed DraftInput { beaconType, size }, both browser and server enforce min == max == n)"
    - "F2: an advertised, unjoined cohort silently vanished after ~60s (booth-era stall timer) — closed by 02-06 (30-min discovery-window default, env-tunable, expiry surfaced to the operator as state:'expired'+reason, gated re-advertise route, never shown to participants)"
    - "F1c (optional): the ADR-042 k-of-n script-path fallback was committed into the beacon address but never activated, so a mid-round defector failed the whole cohort — closed by 02-07 (autoFallbackOnStall activated, n-of-n stays primary, configurable fallbackThreshold, fixture prevout fixed to commit both spend paths)"
  gaps_remaining: []
  regressions: []
gaps: []
human_verification:
  - test: "F1a/F1b directory-honesty visual re-confirm: at /operator (signed in) the create form shows a single `Cohort size (n-of-n)` field (no separate capacity input). Create a size-2 CAS cohort and advertise it; in an anonymous / tab the directory row reads `2/2 seats` (or `0/2 seats, 2 open` before anyone joins) and `Co-sign: 2-of-2`, with no seat that never fills."
    expected: "One size field on the create form; the directory row's seats and co-sign figure agree exactly (n/n and N-of-N) with no phantom unfillable seat."
    why_human: "Visual fidelity of the collapsed create form and the directory row's truthfulness cannot be asserted by grep/unit tests; packages/web has no DOM render harness (deliberate, T-02-SC). Deferred from PLAN 02-05 Task 2 <human-check>; this is the direct re-confirmation of the UAT F1a/F1b finding after the code-level fix."
  - test: "F2 expiry-surfacing visual re-confirm: at /operator, advertise a cohort and let it sit unjoined past the discovery window (or run with a short PHASE_TIMEOUT_MS env override for a faster check): the row flips to a bad-tone `Expired` badge with a reason, instead of silently vanishing. Clicking `Re-advertise` puts a fresh cohort back into the directory."
    expected: "An expired cohort is visibly retained in the operator's own list (never silently disappears) with a legible reason, and Re-advertise successfully revives it into a new live directory entry."
    why_human: "Visual fidelity + interaction (badge tone, reason placement, accent scarcity of the Re-advertise button) needs a human eye; the e2e (`pnpm e2e:operator` F2 leg) proves the wire behavior but not the rendered operator surface. Deferred from PLAN 02-06 Task 3 <human-check>; this is the direct re-confirmation of the UAT F2 finding after the code-level fix."
  - test: "Pick -> identity -> join -> seated -> tail click flow (UAT Test 2, previously deferred/skipped pending gap closure — now runnable since the 30-min discovery window makes the manual two-tab flow reliable). As operator advertise a 2-of-2 cohort; in a second anonymous tab click Join on the Open row, Cancel once before generating a key, then Generate a KEY identity and click Join cohort while a second participant fills the cohort; separately, advertise a 1-of-1 that fills before confirming and try to join it; then use Leave cohort from a seated state."
    expected: "A joinable row shows an enabled Join; a Filling/Full row shows Join disabled. Clicking Join reveals the inline identity step (KEY/import choice + custody note); Cancel returns to the directory having minted no key. Confirming Join cohort with a filling partner reaches the seated confirmation 'You're seated in cohort ...', and the existing co-sign/resolve tail proceeds to a 64-byte signature + resolve. Trying to join an already-filled cohort yields 'That cohort just filled or closed. Pick another from the directory.' and returns to browse with no dead spinner. Leave cohort returns to the directory with no confirmation dialog."
    why_human: "Visual fidelity + interaction sequencing (disabled-Join appearance, Cancel-mints-nothing, the seated-to-tail visual transition, the filled/closed banner) cannot be asserted without a DOM harness; the headless equivalent (join-by-filter selectivity, deterministic no-seat, 64-byte co-sign) is proven by the automated `pnpm e2e:browse` capstone, but the in-browser click path itself is not driven by any automated test. Originally deferred from PLAN 02-04 Task 2 <human-check>; UAT explicitly skipped it pending gap closure — it is now due."
---

# Phase 2: Participant Discovery + Browse-and-Pick Join Verification Report (Gap-Closure Re-Verification)

**Phase Goal:** A participant pointed at a service's URL can browse that service's advertised open cohorts and join one of their choosing, replacing the `shouldJoin` auto-accept of whatever advert arrives.
**Verified:** 2026-07-15T19:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plans 02-05, 02-06, 02-07 closing UAT findings F1a/F1b, F2, F1c)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (ROADMAP SC1) A participant sees a list of advertised open cohorts with beacon type, network, open seats, and status | ✓ VERIFIED | `packages/web/src/components/browse/{ServiceIdentityHeader,DirectoryList,CohortRow}.tsx` unchanged and now render truthful data (see #12); `pnpm e2e:browse` re-run independently, exit 0, directory shows both cohorts with correct fields |
| 2 | (ROADMAP SC2) The participant selects a specific open cohort and joins it by choice, not auto-joining whatever advert arrives | ✓ VERIFIED | `matchesPickedCohort` gate unchanged (`packages/participant/src/index.ts`); `pnpm e2e:browse` re-run independently confirms join-by-filter selectivity |
| 3 | (ROADMAP SC3) A joined participant is seated and counts against capacity; a full/closed cohort cannot be joined | ✓ VERIFIED | Now materially stronger post-gap-closure: `capacity === threshold === n` is enforced server-side (F1b), so "counts against capacity" and "cannot exceed the co-sign threshold" are the same invariant by construction, not merely a UI convention |
| 4 | join-by-filter capstone still proves the mechanism end to end after the size-model + timer + fallback changes | ✓ VERIFIED | `pnpm e2e:browse` re-run independently (this session): cohort A co-signs a 64-byte aggregate, cohort B stays at 0 seats, random-id picker reaches no seat |
| 5 | cohort-ready is still the definitive seat authority | ✓ VERIFIED | `packages/participant/src/index.ts`/`participant.ts` untouched by the gap plans; regression covered by the full 286-test suite (re-run independently) |
| 6 | Directory-empty vs service-unreachable states remain distinct | ✓ VERIFIED | `DirectoryList.tsx`/`DirectoryList.spec.ts` untouched by gap plans; 286/286 tests pass |
| 7 | Browse reads remain anonymous; DTO exposes only counts | ✓ VERIFIED | `directory()`/`status()` in `operator-cohorts.ts` unchanged in access pattern; still no member DIDs/keys in `DirectoryCohortDTO` |
| 8 | Watchdog removal + CR-01 race fix hold | ✓ VERIFIED | `grep -c 'JOIN_WATCHDOG_MS\|joinWatchdog' participant.ts` == 0 (re-confirmed); CR-01 regression test present and passing in the re-run suite |
| 9 | Inline identity step + seated confirmation + reused tail | ✓ VERIFIED (behavior-dependent; click-path visual confirmation is human-check) | `JoinIdentityStep.tsx`/`BrowseView.tsx` untouched by gap plans; `pnpm e2e:browse` proves the headless lifecycle to a 64-byte co-sign |
| 10 | Leave cohort / one-cohort-at-a-time / belt-and-suspenders Join-disabled | ✓ VERIFIED | `BrowseView.tsx`/`CohortRow.tsx` untouched by gap plans |
| **11** | **(02-05/F1b)** min == max == n is enforced on BOTH sides: `validateDraft` accepts only `{ beaconType, size }` and `createDraft` sets `minParticipants === maxParticipants === n`, so a capacity ceiling above the co-sign threshold cannot be constructed even by a hand-crafted request body | ✓ VERIFIED | `packages/service/src/operator-cohorts.ts:194-203,312-334` read directly; `config.maxParticipants = size` (line 320); code-review's adversarial trace confirms `validateDraft` reads only `{ beaconType, size }` from the untrusted body, no field can inject `minParticipants`/`maxParticipants`; `operator-cohorts.spec.ts` (20 tests) re-run independently, pass |
| **12** | **(02-05/F1a)** The directory is honest by construction: `threshold === capacity === n`, so the participant row shows `n/n` seats and `Co-sign: n-of-n` with no phantom unfillable seat, with zero change to the display code | ✓ VERIFIED | `CohortRow.tsx` confirmed unchanged (git diff scope in 02-05-SUMMARY, spot-checked via `directory()` now always returning `threshold === capacity`); `pnpm e2e:browse` directory assertions (`entry.threshold`/`entry.capacity === THRESHOLD`) pass |
| **13** | **(02-06/F2)** An advertised, unjoined cohort stays discoverable for a two-sided-appropriate window: `DEFAULT_PHASE_TIMEOUT_MS`/`DEFAULT_COHORT_TTL_MS` default to 30 minutes (was ~60s/3min), still env-tunable | ✓ VERIFIED | `packages/service/src/demo-server.ts:33,42` — `DEFAULT_PHASE_TIMEOUT_MS = 1_800_000`, `DEFAULT_COHORT_TTL_MS = 1_800_000`; env override paths (`PHASE_TIMEOUT_MS`/`COHORT_TTL_MS`) unchanged at lines 372-373 |
| **14** | **(02-06/F2)** Cohort expiry is surfaced to the operator (`state: 'expired'` + `reason`), never silently deleted, and never appears in the participant directory | ✓ VERIFIED | `packages/service/src/operator-cohorts.ts` `settleCompletion`/`rememberTerminal`/`listCohorts` read directly (lines 234-278, 397-422): rejection path moves the config into a bounded `terminal` map with a reason; `directory()`/`status()` never read `terminal`; `pnpm e2e:operator` re-run independently — F2 leg confirms "cohort absent from /v1/directory but surfaced to the operator as expired with a reason" |
| **15** | **(02-06/F2)** The operator can re-advertise an expired cohort via a gated, same-origin, CSRF-checked route | ✓ VERIFIED | `packages/service/src/hono-adapter.ts:362-365` — `POST /v1/operator/cohorts/:id/readvertise` registered inside the `operatorAuth`/`operatorCohorts` gated block (after `requireSameOrigin()` + `requireOperator()`, lines 299-318); `pnpm e2e:operator` re-run independently confirms re-advertise lands back in the directory; `operator-cohorts.spec.ts` 401/404 negative tests pass |
| **16** | **(02-06/F2)** The terminal-record store is bounded (oldest evicted past a cap) | ✓ VERIFIED | `MAX_TERMINAL = 24` (`operator-cohorts.ts:216`) with oldest-first `Map` eviction in `rememberTerminal` (lines 241-250) |
| **17** | **(02-07/F1c, optional)** n-of-n MuSig2 stays the deterministic default; the k-of-n script-path fallback activates only on a genuine signing-phase stall | ✓ VERIFIED | `pnpm e2e:fallback` re-run independently: Leg A = 64-byte key-path signature, fallback never fired; Leg B = forced stall recovers via `fallback-started` + `path === 'script-path'` |
| **18** | **(02-07/F1c)** `fallbackThreshold` is configurable, bounded to `[1, participants]`, defaults to n-1 when omitted | ✓ VERIFIED | `packages/shared/src/index.ts:337,352-361` read directly; `pnpm vitest run packages/shared/src/cohort-config.spec.ts` re-run independently, 10/10 pass |
| **19** | **(02-07/F1c)** F1c does not change F2 timer semantics — an idle Advertised cohort still expires; only a SIGNING-phase stall falls back | ✓ VERIFIED | `pnpm e2e:operator` (includes the F2 expiry leg) and `pnpm e2e:fallback` (SIGNING-phase-only stall) both re-run independently and both pass in the same session, proving the two mechanisms are distinct and non-interfering |

**Score:** 19/19 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/service/src/operator-cohorts.ts` | Collapsed `DraftInput { beaconType, size }`, `validateDraft`, `createDraft` (min==max==n), `settleCompletion`, `rememberTerminal`, `readvertiseExpired`, `listCohorts` surfacing expired rows | ✓ VERIFIED | Read in full; all symbols present, wired, and match SUMMARY claims exactly |
| `packages/service/src/operator-cohorts.spec.ts` | Coverage for size collapse + expiry surfacing + re-advertise negatives | ✓ VERIFIED | 20 tests, all pass (re-run) |
| `packages/service/src/hono-adapter.ts` | Updated create-body 400 string; gated `POST /v1/operator/cohorts/:id/readvertise` | ✓ VERIFIED | Read directly; route inherits `requireSameOrigin`+`requireOperator` |
| `packages/web/src/components/operator/CreateCohortForm.tsx` | Single `Cohort size (n-of-n)` field | ✓ VERIFIED | Read in full; one `Field`/`Input` bound to `sizeText`, no capacity input, `SIZE_ERROR` mirrors server copy |
| `packages/web/src/lib/operator.ts` | `DraftInput { beaconType, size }`; `readvertise` client | ✓ VERIFIED | `readvertise` function present at line 188 |
| `packages/web/src/stores/operator.ts` | `readvertise` store action | ✓ VERIFIED | Present at line 187, imports `apiReadvertise` |
| `packages/web/src/components/operator/OperatorCohortList.tsx` | Expired row (bad-tone badge + reason) + Re-advertise action | ✓ VERIFIED | `isExpired`/`Re-advertise` button wired to `readvertise(baseUrl, cohort.draftId)` at line 67-68 |
| `packages/service/src/demo-server.ts` | `DEFAULT_PHASE_TIMEOUT_MS`/`DEFAULT_COHORT_TTL_MS` = 30 min; `autoFallbackOnStall`/`AUTO_FALLBACK` | ✓ VERIFIED | Both constants and the `AUTO_FALLBACK` env resolution confirmed at source |
| `packages/service/src/index.ts` | `CreateServiceOptions.autoFallbackOnStall` threaded to the runner | ✓ VERIFIED | Line 184 (option), line 432 (threaded into runner construction) |
| `packages/shared/src/index.ts` | `fallbackThreshold` param on `buildCohortConfig`; `buildFixtureTxData` spends the real beacon-address output | ✓ VERIFIED | Lines 337-370 (fallbackThreshold validation); lines 530-553 (`OutScript.encode(Address(...).decode(beaconAddress))` when `beaconOutput` is supplied) |
| `e2e/fallback-cohort.ts` | Hermetic key-path-default + forced-stall script-path capstone | ✓ VERIFIED | Exists; `pnpm e2e:fallback` re-run independently, exits 0 |
| `e2e/operator-cohort.ts`, `e2e/browse-join-cohort.ts` | Create bodies switched to `{ beaconType, size }`; F2 expiry leg added | ✓ VERIFIED | Both e2e re-run independently, exit 0 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `CreateCohortForm.tsx` | `operator-cohorts.ts validateDraft` | posts `{ beaconType, size }`, mirrors `SIZE_ERROR` copy | ✓ WIRED | Confirmed at source, byte-identical error strings |
| `operator-cohorts.ts createDraft` | `@did-btcr2/aggregation` runner (finalize-at-minParticipants) | `config.maxParticipants = config.minParticipants = n` | ✓ WIRED | Confirmed at source; e2e proves a size-2 cohort locks + co-signs 2-of-2 |
| `operator-cohorts.ts advertiseDraft`/`readvertiseExpired` | cohort completion promise | `settleCompletion`: prune-on-success / retain-terminal-on-rejection | ✓ WIRED | Confirmed at source; `pnpm e2e:operator` F2 leg exercises the rejection branch end to end |
| `OperatorCohortList.tsx` | `POST /v1/operator/cohorts/:id/readvertise` | `readvertise(baseUrl, cohort.draftId)` store action -> `apiReadvertise` fetch | ✓ WIRED | Confirmed at source; e2e proves the wire round-trip (re-advertised cohort reappears in `/v1/directory`) |
| `demo-server.ts` | `createService` | `autoFallbackOnStall` forwarded (default ON in demo server, OFF in library) | ✓ WIRED | Confirmed at source (`index.ts:432`); `pnpm e2e:fallback` proves both defaults hold in the same run |
| `buildCohortConfig` | `beacon-address.ts` fallback tapleaf | `fallbackThreshold` flows onto `CohortConfig` | ✓ WIRED | Confirmed at source; `pnpm e2e:fallback` Leg B proves a real 2-of-3 script-path spend validates |
| `tx.ts` fixture path | `buildFixtureTxData` | passes `beaconAddress` + resolved network so the fixture prevout commits both spend paths | ✓ WIRED | Confirmed at source (`tx.ts:74-75`); `pnpm e2e:fallback` Leg B is the direct proof (script-path spend validates hermetically against the fixture prevout) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `CohortRow.tsx` (unchanged) | `row.threshold`/`row.capacity`/`row.joined` | `GET /v1/directory` -> `operator-cohorts.ts directory()` -> live `runner.session.cohorts` + `advertised` enrichment map | Yes — real values from the live runner session, not static | ✓ FLOWING |
| `OperatorCohortList.tsx` Expired row | `cohort.state`/`cohort.reason` | `GET /v1/operator/cohorts` -> `listCohorts()` -> `terminal` map (populated only on a real completion rejection) | Yes — driven by an actual rejected completion promise, not a hardcoded fixture | ✓ FLOWING |

### Behavioral Spot-Checks (all re-run independently this session, not taken from SUMMARY.md)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Typecheck (all packages) | `pnpm typecheck` | clean (`tsc -b`) | ✓ PASS |
| Full unit test suite | `pnpm vitest run` | 286/286 tests pass (26 files) | ✓ PASS |
| Web build | `pnpm --filter @btcr2-aggregation/web build` | `tsc --noEmit` + `vite build` clean | ✓ PASS |
| Lint | `pnpm lint` | clean (`eslint .`) | ✓ PASS |
| Browse->pick->join->co-sign hermetic capstone | `pnpm e2e:browse` | exit 0 — directory honest (threshold===capacity), join-by-filter selectivity, 64-byte co-sign | ✓ PASS |
| Operator lifecycle + F2 expiry leg | `pnpm e2e:operator` | exit 0 — auth negatives, on-demand-only driver, expiry surfaced + re-advertised | ✓ PASS |
| F1c fallback activation capstone | `pnpm e2e:fallback` | exit 0 — Leg A key-path default, Leg B forced-stall script-path recovery | ✓ PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` convention; verification uses the project's vitest + tsx e2e gates above instead (all re-run independently in this session).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| PART-01 | 02-01, 02-02, 02-04, 02-05, 02-06, 02-07 | Participant can browse a service's advertised open cohorts with enough detail to choose, and that detail is now honest (no phantom seat) and durable (30-min discovery window) | ✓ SATISFIED | REQUIREMENTS.md marked Complete; code-level evidence in Truths 1, 11-13, 17-19 |
| PART-02 | 02-01, 02-03, 02-04, 02-06 | Participant can join an advertised open cohort of their choice; expiry no longer silently strands a directory entry mid-browse | ✓ SATISFIED | REQUIREMENTS.md marked Complete; code-level evidence in Truths 2, 14-15 |

No orphaned requirements: both PART-01 and PART-02 are mapped to Phase 2 in REQUIREMENTS.md and both are claimed by plans in this phase, including all three gap-closure plans.

### Anti-Patterns Found

Debt-marker scan (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) across all 17 gap-closure-touched files returned zero blocking matches. (`GENESIS_PLACEHOLDER` in `packages/shared/src/index.ts` is a pre-existing, unrelated identifier name for a real DID placeholder value, not a debt marker — file untouched by the gap-closure diff.) No em-dash characters in any touched file.

3 open **warning**-level findings and 3 **info**-level findings remain from the deep gap-closure code review (`02-REVIEW.md`, 0 critical, non-blocking, none of which contradict the three ROADMAP success criteria):

- **WR-01**: Advertise/re-advertise failures write into `formError` (rendered only by `CreateCohortForm`), not an action-scoped field rendered by `OperatorCohortList`/`CohortRow` — a failed Advertise/Re-advertise on a row paints its error in the wrong place. Operator-facing UX gap, not a participant-facing one; does not affect the phase's browse/join success criteria.
- **WR-02**: A `null`/non-object create body reaches `validateDraft`'s destructuring and throws a raw `TypeError`, surfaced verbatim as the 400 body — still a 400, but leaks an internal error string. Operator-gated input, low severity.
- **WR-03**: An advertised cohort in the `SigningStarted`+ phases is invisible in the operator's own "Your cohorts" list (a pre-existing Phase-1 `directory()`-derived-list issue that F2 reinforces without closing). Adjacent to, but distinct from, the F2 fix (which covers the pre-signing `Advertised` phase). Explicitly deferred to Phase 4 (operator monitoring) per the reviewer's note.
- IN-01/IN-02/IN-03: stray JSDoc placement, no upper bound on cohort size, no handler-level try/catch on advertise/re-advertise routes — all cosmetic/hardening, non-blocking.

None of these block the phase goal or any of the three ROADMAP success criteria: browsing, picking, joining, seating, and the full co-sign/resolve lifecycle all work end to end, now on top of an honest directory (F1a/F1b), a durable discovery window with surfaced expiry (F2), and an activated liveness fallback (F1c) — all independently re-verified by re-running the full gate (unit suite, typecheck, lint, web build) plus all three hermetic e2e capstones (`e2e:browse`, `e2e:operator`, `e2e:fallback`) in this verification session, not merely by re-reading SUMMARY.md claims.

### Human Verification Required

1. **F1a/F1b directory-honesty visual re-confirm** (deferred from PLAN 02-05 Task 2 `<human-check>`, non-blocking)
   - **Test:** At `/operator` (signed in) confirm the create form shows a single `Cohort size (n-of-n)` field (no separate capacity input). Create a size-2 CAS cohort and advertise it; in an anonymous `/` tab confirm the directory row reads `2/2 seats` (or `0/2 seats, 2 open` before anyone joins) and `Co-sign: 2-of-2`.
   - **Expected:** One size field; the directory row's seats and co-sign figure agree exactly, with no seat that never fills.
   - **Why human:** Visual fidelity cannot be grepped; no DOM render harness exists in `packages/web` (deliberate). This is the direct re-confirmation of the UAT F1a/F1b finding after the code-level fix.

2. **F2 expiry-surfacing visual re-confirm** (deferred from PLAN 02-06 Task 3 `<human-check>`, non-blocking)
   - **Test:** At `/operator`, advertise a cohort and let it sit unjoined past the discovery window (or use a short `PHASE_TIMEOUT_MS` for a faster check). Confirm the row flips to a bad-tone `Expired` badge with a reason, and that `Re-advertise` puts a fresh cohort back into the directory.
   - **Expected:** An expired cohort visibly persists in the operator's list (never silently vanishes) with a legible reason; Re-advertise successfully revives it.
   - **Why human:** Visual fidelity + interaction cannot be grepped; the e2e proves the wire behavior, not the rendered surface. This is the direct re-confirmation of the UAT F2 finding after the code-level fix.

3. **Pick -> identity -> join -> seated -> tail click flow** (UAT Test 2 — previously deferred, then explicitly skipped pending gap closure; now due)
   - **Test:** As operator advertise a 2-of-2 cohort; from a second anonymous tab click Join, Cancel once, then generate an identity and confirm Join while a second participant fills the cohort; separately try to join a cohort that fills first; use Leave cohort from a seated state.
   - **Expected:** Non-joinable rows show disabled Join; Cancel mints no key; a successful join reaches the seated confirmation and the reused tail proceeds to a 64-byte co-sign + resolve; a lost pick shows the deterministic filled/closed message and returns to browse; Leave returns to the directory with no dialog.
   - **Why human:** Same DOM-harness gap; `pnpm e2e:browse` proves the underlying lifecycle and selectivity headlessly, but not the rendered click path. The 30-min discovery window (F2 fix) now makes this manual two-tab flow reliable to run, which it was not at the time of the original UAT pass.

### Gaps Summary

No gaps remain. All 3 ROADMAP success criteria and all 19 consolidated must-have truths (the original 10 from plans 02-01..04 plus 9 new truths from the gap-closure plans 02-05/06/07) are verified against the actual codebase — not just re-asserted from SUMMARY.md. Every gap-closure claim was independently checked at the source level (files read in full, not grepped-and-trusted) and every automated gate was re-run fresh in this verification session: `pnpm typecheck`, `pnpm vitest run` (286/286), `pnpm lint`, the web build, and all three hermetic e2e capstones (`e2e:browse`, `e2e:operator`, `e2e:fallback`), all passing. The three UAT findings (F1a/F1b directory dishonesty, F2 silent cohort expiry, and the optional F1c liveness gap) are closed at the code level: a capacity above the co-sign threshold is now structurally unrepresentable, an idle advertised cohort survives a 30-minute discovery window and is surfaced (never silently deleted) with a working re-advertise path, and a mid-round defector no longer fails the whole cohort thanks to the activated k-of-n script-path fallback while n-of-n MuSig2 remains the deterministic default.

The remaining work is three non-blocking human-verification items — two are direct visual re-confirmations of the now-fixed UAT findings (F1a/F1b, F2), and one is the previously-skipped UAT Test 2 (pick-to-join click flow), which is now reliably runnable thanks to the F2 timer fix. None of these are expected to fail given the underlying mechanisms are proven end to end by the hermetic e2e capstones; they close the loop on visual/interaction fidelity that no DOM harness in this codebase can assert.

---

_Verified: 2026-07-15T19:00:00Z_
_Verifier: Claude (gsd-verifier)_
