---
phase: 04-operator-cohort-monitoring
plan: 08
subsystem: testing
tags: [e2e, playwright-core, adr, deploy, live-uat, regtest, polar, monitoring, funding]

# Dependency graph
requires:
  - phase: 04-06
    provides: the cohort-beacon funding stage (watch predicate, clamped wait, honest disclosure) this plan drives against a real chain
  - phase: 04-07
    provides: the participant awaiting-funding notice, stall-copy fix, and unconfirmed-signal resolve guard the UAT exercises
  - phase: 04-04
    provides: the drill-down depth (members, submissions, co-sign, anchor, activity) the browser operator capstone asserts
provides:
  - fixture-path monitoring e2e leg (e2e:monitor) proving the gated monitoring read reflects real cohort activity
  - local browser operator capstone (e2e:browser:operator) driving login to advertise to drill-down states
  - committed opt-in live harness e2e/live-uat.ts on the env-passthrough boot (pnpm uat:live)
  - ADR 0016 (polled monitoring read model, supersedes ADR 0004, amends ADR 0015)
  - docs/DEPLOY.md going-live section (BROADCAST, funding walkthrough, network choices, guard rails)
  - three scoping one-pagers under .planning/scoping/
  - owner-run 04-LIVE-UAT-CHECKLIST.md and its passed live walkthrough (SVC-03 + LIVE-01 validated)
  - advert replay window equalized with the directory discovery window (advertTtlMs threading)
  - seated cohorts stay listed through the funding and co-sign window (IN_FLIGHT_PHASES widening)
  - honest race-loser seat copy and live seat count on the cohort page
  - KEY first-update registration honesty on the resolve surface (ADR 0007 chicken-and-egg)
affects: [phase-05-lifecycle-control, phase-06-two-sided-loop, upstream-issue-filing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-run live-UAT checklist as a phase-closing blocking human gate, with the hermetic mocked-chain leg as the automated evidence of record"
    - "Pure copy selectors (seatLineCopy, firstUpdateResolveNote) unit-tested without a DOM stack, components as plain projections"
    - "Terminal DISPLAY states for watch loops: funded retires the poll so post-spend chain activity cannot re-classify a settled verdict"

key-files:
  created:
    - e2e/browser-operator.ts
    - e2e/live-uat.ts
    - docs/adr/0016-polled-monitoring-read-model.md
    - .planning/scoping/participant-esplora-override.md
    - .planning/scoping/external-signers.md
    - .planning/scoping/tos-payments-notifications.md
    - .planning/phases/04-operator-cohort-monitoring/04-LIVE-UAT-CHECKLIST.md
    - packages/service/tests/create-service-advert-ttl.spec.ts
    - packages/service/tests/operator-cohorts-display.spec.ts
    - packages/web/tests/participant-seats.spec.ts
    - packages/web/tests/directory-labels.spec.ts
    - packages/web/tests/first-update-note.spec.ts
  modified:
    - e2e/operator-cohort.ts
    - e2e/live-mock-cohort.ts
    - e2e/browser-participant-cohort.ts
    - packages/service/src/index.ts
    - packages/service/src/monitor.ts
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/funding-watch.ts
    - packages/web/src/stores/participant.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/lib/directory.ts
    - packages/web/src/components/cohort/CohortPage.tsx
    - packages/web/src/components/cohort/CompletionSummary.tsx
    - packages/web/src/components/operator/FundingStage.tsx
    - docs/DEPLOY.md
    - docs/adr/0015-operator-authentication.md
    - package.json

key-decisions:
  - "The advert SSE replay window is threaded from cohortTtlMs (finite-positive guarded) so the joinable directory window and the discoverable advert window are the same window"
  - "IN_FLIGHT_PHASES widens to the four funding-wait phases in all three places that mirror it (operator-cohorts.ts, monitor.ts, web directory.ts), so a funding cohort stays listed, keeps its needs-funding chip, and counts inFlight"
  - "funded is a terminal DISPLAY state: the funding watch retires at funded and the monitor never regresses a funded view, because beacon change routes back to the beacon address"
  - "Race-loser and first-update copy state observed facts plus honest uncertainty rather than claiming delivery failures or anchors we cannot know occurred"
  - "The six library-level defects surfaced by the live UAT were deliberately NOT worked around in this consumer app; they are documented as known upstream limits and queued for upstream issue filing"

patterns-established:
  - "Live-UAT gap closure runs as rounds: owner reports a field symptom, the round root-causes it to product copy or a mirrored constant, lands fix plus pins, and the checklist is updated so the next run cannot walk into the same trap"
  - "Every mirrored constant gets a lockstep pin: a comment claiming it mirrors another file is not enough (the monitor IN_FLIGHT_PHASES drift proved it)"
  - "Library ctor options are built as an explicitly typed value with per-field assignment, never a conditionally spread literal, so an upstream rename fails tsc instead of silently degrading"

requirements-completed: [SVC-03, LIVE-01]

coverage:
  - id: D1
    description: "Fixture-path monitoring e2e asserts the gated GET /v1/operator/cohorts/:id reflects members joined, submissions, and the ended taxonomy end to end"
    requirement: SVC-03
    verification:
      - kind: e2e
        ref: "pnpm e2e:monitor (e2e/operator-cohort.ts runMonitorLeg)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Local browser operator capstone drives one real Chromium page through login, create, advertise, and the drill-down member/submission/co-sign/anchor states"
    requirement: SVC-03
    verification:
      - kind: automated_ui
        ref: "pnpm e2e:browser:operator (e2e/browser-operator.ts)"
        status: pass
    human_judgment: false
  - id: D3
    description: "e2e/live-uat.ts formalized as the committed opt-in live check on the env-passthrough (LIVE=1 BROADCAST=1) demo-server boot, no getUtxos monkey-patch, runner-event tap and funding prompts kept"
    requirement: LIVE-01
    verification:
      - kind: manual_procedural
        ref: "pnpm uat:live against Polar/regtest (owner run 2026-07-27)"
        status: pass
    human_judgment: true
    rationale: "Requires real funds on a real chain and an external wallet; cannot run in CI by construction"
  - id: D4
    description: "ADR 0016 records the polled monitoring read model, supersedes ADR 0004, and patches ADR 0015's retired SSE rationale"
    verification:
      - kind: other
        ref: "grep -qi supersed docs/adr/0016-polled-monitoring-read-model.md"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/DEPLOY.md going-live section covers BROADCAST, RECOVERY_KEY, FUNDING_WINDOW_MS, LIVE_CHANGE_ADDRESS, SERVICE_NAME, the funding walkthrough, and the mutinynet-flagship / regtest-local / hermetic-default framing"
    verification:
      - kind: other
        ref: "grep -qi BROADCAST docs/DEPLOY.md; going-live section review"
        status: pass
    human_judgment: false
  - id: D6
    description: "Three scoping one-pagers (participant esplora override, external signers, ToS/payments/notifications), scoping only, no build"
    verification:
      - kind: other
        ref: "test -f .planning/scoping/{participant-esplora-override,external-signers,tos-payments-notifications}.md"
        status: pass
    human_judgment: false
  - id: D7
    description: "Owner live-UAT walkthrough against Polar/regtest passes end to end: advertise, two browser participants join, single-payment cohort funding, co-sign, broadcast, confirmed anchor, per-participant KEY registration, resolve reflects the update"
    requirement: LIVE-01
    verification:
      - kind: manual_procedural
        ref: ".planning/phases/04-operator-cohort-monitoring/04-LIVE-UAT-CHECKLIST.md (owner sign-off: approved)"
        status: pass
    human_judgment: true
    rationale: "Real funds on a real chain, real browser windows, human judgment on copy honesty throughout; the hermetic mocked-chain leg (04-06) plus the fixture monitoring e2e are the automated evidence of record"

# Metrics
duration: 3 days elapsed (checkpoint-dominated)
completed: 2026-07-27
status: complete
---

# Phase 4 Plan 08: Proof, Docs, and the Owner Live-UAT Gate Summary

**Hermetic monitoring e2e plus a browser operator capstone plus a committed `pnpm uat:live` harness, ADR 0016 superseding the dashboard-SSE channel, an honest DEPLOY going-live story, three scoping one-pagers, and an owner-run live walkthrough on Polar that passed after three rounds of gap closure, closing SVC-03 and LIVE-01.**

## Performance

- **Duration:** 3 days elapsed (2026-07-24 to 2026-07-27), dominated by the blocking human gate and its three gap-closure rounds
- **Started:** 2026-07-24T21:46:10Z
- **Completed:** 2026-07-27T19:28:51Z
- **Tasks:** 3 of 3 (2 auto, 1 blocking human-verify checkpoint, resolved approved)
- **Files modified:** 32 across 23 commits

## Accomplishments

- Proved the monitoring read model hermetically (fixture `e2e:monitor` leg) and at the browser level (`e2e:browser:operator` capstone), completing SVC-03 criterion 4.
- Formalized the previously uncommitted live harness into `e2e/live-uat.ts` on the env-passthrough boot: no `getUtxos` monkey-patch, the native funding stage does the work, the runner-event tap and human-paced funding prompts survive.
- Documented the read-model shift (ADR 0016 supersedes ADR 0004, amends ADR 0015) and gave the self-hoster an honest going-live story in `docs/DEPLOY.md`.
- Landed three scoping one-pagers so the folded todos have a real next step without pulling any build work into this phase.
- Ran the phase's final human gate for real: the owner drove the whole two-sided loop on Polar/regtest with two browser participants, real funding, a confirmed on-chain anchor, per-participant KEY registration, and a resolve that reflected the update. Approved.
- Closed every defect the live run surfaced in this app's own code (nine fixes across three rounds), and drew a hard line at the six defects that live in the library.

## Task Commits

Each task was committed atomically, then the human gate drove three review-gated gap-closure rounds.

1. **Task 1: Proof harnesses (fixture monitoring e2e, browser operator capstone, formalized uat:live)** - `26dfc4e` (test), preceded by `ce514fc` (fix, deviation below)
2. **Task 2: ADR 0016 plus patched ADR 0015 plus DEPLOY going-live plus three scoping one-pagers** - `1b8bf7b` (docs)
3. **Task 3: Owner live-UAT checklist authored, then the blocking human gate** - `90e3f2c` (docs), resolved `approved`

### Gap-closure round 1 (first UAT failure: two joins were not reflected)

| Commit | What |
|---|---|
| `f55e3f4` | Advert replay window equalized with the 30-minute directory window via `advertTtlMs` threading (SVC-JOIN-1) |
| `c28f6f5` | Seated cohorts stay listed through the funding and co-sign window (`IN_FLIGHT_PHASES` widened in `operator-cohorts.ts` and web `directory.ts`) (SVC-JOIN-2) |
| `5408770` | Live seat count resurrected on `CohortPage`; the dead `JoinIdentityStep` block deleted (PWEB-1) |
| `b709064`, `3818fc8`, `d3cee65`, `0a84428` | Service specs, web store and label specs, e2e DOM plus directory-presence guards, lint |
| `67651ad`, `866c86a` | Checklist addendum for the re-run and a softened all-seats-filled expectation |
| `b7a5980` | Honest race-loser copy via the pure `seatLineCopy()` helper (grace expiry and confirming-seat) |
| `3202f3c` | The same four funding-wait phases mirrored into `monitor.ts` `IN_FLIGHT_PHASES` (the needs-funding chip was inverted exactly when it mattered) |
| `46ab781` | Typed `HttpServerTransportConfig` plus a finite-positive `advertTtl` guard (NaN and 0 no longer silently disable advert replay) |

### Gap-closure round 2 (funding dead-end field finding)

| Commit | What |
|---|---|
| `59f19bb` | Single-payment funding copy plus the oldest-coin explanation of why topping up cannot fix a dead-end |
| `c2937fb` | Checklist funding warning plus the upstream coin-selection limit entry |

### Gap-closure round 3 (resolve never showed the update) plus the approved-run caveat

| Commit | What |
|---|---|
| `1aff920` | Honest KEY first-update registration copy: `firstUpdateResolveNote()` selector plus the 1330-sat minimum surfaced on the register card |
| `84e9756` | The KEY first-update registration leg added to the checklist and the harness header |
| `1564253` | Confirmed-only anchored claim in the first-update note (an anchor-failed run must not read "anchored") |
| `ae2e8b3` | Registration-leg expectations corrected in the checklist |
| `758beb2` | The funding watch retires at `funded` and the monitor never regresses a funded view (the owner's stale dead-end caveat) |

**Plan metadata:** see the final `docs(04-08)` commit.

## Files Created/Modified

- `e2e/operator-cohort.ts` - gained `runMonitorLeg`: the hermetic fixture proof that the gated detail read reflects members, submissions, and the ended taxonomy
- `e2e/browser-operator.ts` - playwright-core operator capstone (login, create, advertise, drill-down state assertions) mirroring the participant capstone; local-only, CI wiring stays Phase 6 debt
- `e2e/live-uat.ts` - committed opt-in live harness on the `LIVE=1 BROADCAST=1` demo-server boot, with a header that now documents the KEY registration leg
- `e2e/live-mock-cohort.ts` - `runFundingDirectoryPresenceCohort`: asserts the directory row is present on every tick through the funding wait
- `e2e/browser-participant-cohort.ts` - DOM regression guard that the live seat-count surface is actually mounted
- `docs/adr/0016-polled-monitoring-read-model.md` - the polled read model, `Supersedes: ADR 0004`, `Amends: ADR 0015`
- `docs/adr/0015-operator-authentication.md` - the retired `/dashboard/events` and EventSource-header rationale removed; the cookie session noted as surviving on its own merits
- `docs/DEPLOY.md` - going-live section: env vars, the cohort-beacon funding walkthrough, network choices, guard rails, mutinynet flagship
- `.planning/scoping/*.md` - three one-pagers (problem, options, recommended scope, dependencies)
- `.planning/phases/04-operator-cohort-monitoring/04-LIVE-UAT-CHECKLIST.md` - the owner walkthrough, its honesty checks, the negative legs, and the known upstream limits
- `packages/service/src/index.ts` - `advertTtlMs` option, typed transport config, finite-positive guard
- `packages/service/src/operator-cohorts.ts` - `IN_FLIGHT_PHASES` widened to the four funding-wait phases
- `packages/service/src/monitor.ts` - the same widening in lockstep, plus the funded no-regression backstop in `noteFunding`
- `packages/service/src/funding-watch.ts` - `funded` retires the poll loop
- `packages/web/src/stores/participant.ts` - `seatLineCopy()` and `firstUpdateResolveNote()` pure selectors, live seat reflection in `handleDirectorySnapshot`, honest grace-expiry reasons
- `packages/web/src/components/cohort/{CohortPage,CompletionSummary}.tsx` - plain projections of those selectors
- `packages/web/src/components/operator/FundingStage.tsx` - single-payment copy and the dead-end cause
- `packages/web/src/{lib/operator.ts,stores/operator.ts}` - advertise returns the live cohort id (deviation below)
- `package.json` - `e2e:monitor`, `e2e:browser:operator`, `uat:live`

## Decisions Made

- **Equalize the advert window with the directory window.** The library's advert SSE replay defaulted to 5 minutes while the public directory keeps a cohort joinable for the full 30-minute TTL and nothing republishes the advert (D-17 removed the loop). A participant arriving at minute six saw a joinable cohort they could never opt into. `advertTtlMs` now defaults to `cohortTtlMs`, threaded only when finite and positive.
- **Mirror-and-pin, never mirror-and-comment.** `monitor.ts` carried a comment claiming its `IN_FLIGHT_PHASES` mirrored `operator-cohorts.ts`, which stopped being true the moment the latter widened. Every mirrored set now has a behavioral pin on both sides.
- **`funded` is terminal for display.** Beacon change routes back to the beacon address by default, so a watch that keeps polling after the spend re-reads the change UTXO and can hand back a `dead-end` verdict for a cohort that already anchored. The watch retires at `funded` and the monitor refuses to regress a funded view.
- **State observed facts plus honest uncertainty.** The last-seat race loser gets "the cohort locked with all N seats filled and this browser was not seated; it may have filled without you, or your seat confirmation was lost", not a claimed delivery failure. The first-update resolve note claims "anchored" only when the anchor state is `confirmed`.
- **Do not work around library defects in this consumer app.** Six of the defects the live UAT surfaced live in `@did-btcr2/aggregation@0.4.0` and `@did-btcr2/method@0.51.0`. They are documented as known upstream limits in the checklist and queued for upstream issue filing, per the standing constraint that this repo is a reference consumer, not a fork.

## Checkpoint Outcome: Owner Live UAT

**Result: approved.** The owner ran the full walkthrough on Polar/regtest: boot with `LIVE=1 BROADCAST=1`, operator login, create and advertise a live cohort, two separate browser windows discover and join it, the cohort-beacon funding stage surfaces and advances on a single adequate payment, co-sign completes, the beacon broadcasts, the anchor confirms on chain, each included participant registers their KEY first update, and resolve then reflects the update.

It took three rounds to get there. Each round was adversarially reviewed and left the gate green.

### Confirmed defects in this app, all fixed

1. **Advert replay window shorter than the discovery window** - a second participant arriving after five minutes could see a joinable cohort but never receive the advert, and hung at connecting forever. Fixed by threading `advertTtlMs`.
2. **Directory row vanished for the whole funding window** - the four funding-wait phases were not in `IN_FLIGHT_PHASES`, so a seated participant's post-seat poll saw the cohort go dark and false-failed it after about ten seconds. This was the guaranteed `BROADCAST=1` killer.
3. **No live seat count anywhere** - the only seat-count line lived in a render branch that had been unreachable since 03-05, so neither browser could ever see a fill count.
4. **Needs-funding chip inverted on the operator console** - the drifted `monitor.ts` phase set meant the operator saw a stale Filling row for the entire funding window, and the cohort counted in neither `open` nor `inFlight`.
5. **Race-loser copy claimed facts never observed** - both the grace-expiry terminal and the cohort page asserted a seat-confirmation delivery failure that cannot be known to have happened.
6. **Funding copy let the owner walk into a permanent dead-end** - the copy asked for a minimum but never said "in one single payment", and the dead-end verdict never explained why topping up cannot fix it.
7. **Resolve never showed the first update, with no explanation** - a KEY DID's first aggregated update resolves only after that participant's own genesis singleton-beacon registration signal confirms (ADR 0007 chicken-and-egg). The surface said nothing, and the register card never showed its funding minimum.
8. **The first-update note could claim "anchored" over a failed broadcast** - auto-resolve fires on a failed anchor too, so the note rendered a false anchored claim directly beneath the broadcast-failed narration.
9. **Stale dead-end funding verdict after the anchor confirmed** (the caveat reported alongside the approval) - change returns to the beacon address and the watch kept polling post-spend.

### Upstream defects, deliberately not worked around

These live in the published `@did-btcr2/*` packages. They are documented in the checklist's "Known upstream limits" section so an operator can work within them, and they are queued for upstream issue filing.

| Defect | Package | Field consequence |
|---|---|---|
| Single advert slot in the transport | `@did-btcr2/aggregation@0.4.0` | Advertising a second cohort evicts the first; late joiners only ever discover the newest |
| No seat release | `@did-btcr2/aggregation@0.4.0` | Reloading a joined participant tab abandons the seat with no way to reclaim it |
| Silent duplicate and surplus opt-in drop | `@did-btcr2/aggregation@0.4.0` | The loser of a last-seat race, and anyone reusing a seated secret, gets no reject signal at all |
| `advertRepeatIntervalMs` ignored | `@did-btcr2/aggregation@0.4.0` | No periodic advert republish, which is why the replay window had to be widened instead |
| 60s envelope-skew replay rejection | `@did-btcr2/aggregation@0.4.0` | A clock-skewed or slow client's envelope is rejected as a replay |
| Deepest-first coin selection with only a dust floor | `@did-btcr2/method@0.51.0` | `selectSpendableUtxo` cannot skip an inadequate older coin, so a below-minimum first send dead-ends the beacon address permanently |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Advertise landed the operator on a stale draft id**
- **Found during:** Task 1 (browser operator capstone)
- **Issue:** `advertiseDraft` calls `runner.advertiseCohort` and deletes the draft, minting a new live cohort id server-side, so the original draft id is stale the instant advertise succeeds. The web store opened the drill-down on that stale id, which the monitor has no entry for, so the operator landed on an empty "Seats: 0/0" page forever. A D-13 regression, surfaced by the new capstone before the owner ever hit it.
- **Fix:** `lib/operator.ts` advertise returns the live cohort id from the response DTO (or null on failure) instead of a bare boolean; `stores/operator.ts` opens the drill-down on the returned live id.
- **Files modified:** `packages/web/src/lib/operator.ts`, `packages/web/src/stores/operator.ts`
- **Verification:** the browser operator capstone reaches the populated drill-down
- **Committed in:** `ce514fc`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix was a precondition for the capstone the plan asked for, and for the owner's walkthrough. No scope creep.

## Issues Encountered

The blocking human gate did what a blocking human gate is for: three separate rounds of real-chain failure that no hermetic test had caught. The pattern in every round was the same. The product was honest about what it knew, but silent about what the operator or participant needed to do, and two of the nine defects were mirrored-constant drift that a comment claimed was impossible. The gap-closure work is documented above rather than repeated here.

Everything the rounds surfaced that was ours is fixed and pinned. Everything upstream is documented and queued.

## User Setup Required

None for the hermetic default boot. The live path requires the operator to supply their own funded wallet and an esplora endpoint; `docs/DEPLOY.md` going-live and the live-UAT checklist walk through it.

## Next Phase Readiness

- **SVC-03 and LIVE-01 are Validated.** Monitoring is proven hermetically, at the browser level, and against a real chain; the live broadcast path is operable from the product itself.
- **Phase 4 execution is complete** across all 8 plans, pending phase verification.
- **Queued for upstream:** six library defects listed above need issues filed against `@did-btcr2/aggregation` and `@did-btcr2/method`.
- **Carried forward unchanged:** WR-01 proxy-aware login throttle and WR-02 NaN-TTL hardening before any public-internet deploy; the two red browser e2e CI jobs plus wiring the new capstones into CI stay Phase 6 debt.
- **Phase 5 (operator cohort lifecycle control)** extends the same authenticated console this plan just proved end to end.

---
*Phase: 04-operator-cohort-monitoring*
*Completed: 2026-07-27*
