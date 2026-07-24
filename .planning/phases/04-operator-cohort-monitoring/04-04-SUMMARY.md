---
phase: 04-operator-cohort-monitoring
plan: 04
subsystem: service+web
tags: [monitoring, operator-console, drill-down, submissions, co-sign, anchor, activity-log, json-export, honest-progress]

# Dependency graph
requires:
  - phase: 04-operator-cohort-monitoring
    plan: 01
    provides: "the per-service createCohortMonitor fold + detail(cohortId) projection + the gated GET /v1/operator/cohorts/:id read + the discriminated fetchCohortDetail/pollDetail + the SPA-internal drill-down view state this plan deepens"
  - phase: 04-operator-cohort-monitoring
    plan: 02
    provides: "the monitor summary()/serviceMetrics() + the lifted serialize()/summarizeTx fixture-fee guard, and the ended-taxonomy fold this plan's activity + anchor refinement build on"
  - phase: 04-operator-cohort-monitoring
    plan: 03
    provides: "the list-first console shell + drill-down view state + the promoted Expander primitive this drill-down renders inside"
provides:
  - "Monitor detail depth: the fold now folds every identity-carrying runner event (update-received/validation-received/nonce-received/message-rejected + signing/fallback/complete) into per-member round state (seated -> submitted -> validated -> nonce-sent, rejected off-path), submissions with wall-clock stamps + the live raw signed-update body, honest co-sign (nonces k/n + awaitingPartialSigs, NEVER a partial-sig count, D-32), an operator anchor view composed from the injected anchor-state (hermetic reads {enabled:false,state:none}), a fallback flag (k/n when derivable), and a bounded (200, oldest-first) per-cohort activity ring, all server wall-clock stamped (D-21/D-22)"
  - "Member pubkeys (participantPk/communicationPk, hex) captured on the fold for the Technical detail expander only (D-28)"
  - "exportRecord(cohortId): the full detail projection + activity ring + cohortId/exportedAt as plain JSON (D-34)"
  - "Gated GET /v1/operator/cohorts/:id/export: a two-segment sibling of the detail read, requireOperator-gated (anonymous 401 before any lookup), 400 on a bad id shape, Content-Disposition filename built ONLY from the shape-validated id (T-04-04-02), no new auth surface (D-34)"
  - "OperatorStageTimeline: the operator cohort-lifecycle timeline (advertise -> filling -> submissions -> co-signing -> anchor) mirroring the participant StageTimeline treatment, stage derived purely from observed detail facts, Anchored reserved for a confirmed anchor (D-05/D-18)"
  - "Drill-down depth render: stage timeline + Members (round chips + pubkeys behind Technical detail) + Submissions (who/when + Raw signed update expander) + honest Co-sign + Anchor sub-steps (hermetic + fallback lines) + Activity log (server wall-clock stamps) + JSON export card, top-to-bottom per D-05"
  - "LogPanel formatTime prop: the reused activity log renders the SERVER wall-clock stamp, not the participant elapsed offset (D-22); participant callers byte-identical (default fmtElapsed)"
affects: [04-06-funding-stage-live-mode, 04-08-live-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injected anchor-state composition: the monitor takes the SAME AnchorState the public read uses and re-serves its projection in the operator detail (byte-untouched public read, D-18/D-26), rather than re-folding the broadcaster frames a second time"
    - "Honest-limit DTO shape: coSign carries exactly {noncesReceived,total,awaitingPartialSigs} - a real observed nonce count + a boolean awaiting flag - and NO partial-signature count field anywhere, so the unobservable leg (no runner event, D-32) can never be rendered as a fact"
    - "Bounded per-cohort activity ring with a per-cohort monotonic id sequence, so the client LogPanel's key + auto-follow stay stable across polls even after the ring fills and evicts oldest-first (T-04-04-03 DoS bound)"
    - "Furthest-along stage derivation: the operator timeline ratchets its active stage from the max of phase + observed submissions + observed nonces + non-none anchor, so a cohort never reads behind its real progress and never claims a stage the monitor did not observe"

key-files:
  created:
    - packages/web/src/components/operator/OperatorStageTimeline.tsx
  modified:
    - packages/service/src/monitor.ts
    - packages/service/src/index.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/tests/monitor.spec.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/components/operator/CohortDetail.tsx
    - packages/web/src/components/LogPanel.tsx
  deleted: []

key-decisions:
  - "The operator anchor view is composed from the SAME injected AnchorState the public GET /v1/anchor read serves (threaded into createCohortMonitor as a third param from index.ts), not a second broadcaster fold: the public anchor read stays byte-untouched (D-26 freeze) and the operator drill-down and the participant surface agree on one anchor projection (D-18)."
  - "Member pubkeys were added to the fold during Task 2 (Rule 2 deviation): the D-28 must-have truth requires participantPk/communicationPk behind the Technical detail expander, but the 04-01 member DTO carried only did/status/since. Captured hex-encoded from the opt-in payload, optional (absent for a member first seen on a later round event), and mapped into the member DTO."
  - "The onboarding-model badge (KEY/EXTERNAL) on member rows is honestly OMITTED: the monitoring DTO does not carry the onboarding model, and deriving it from a raw did:btcr2 string needs bech32m decoding the browser bundle deliberately avoids (MEMORY Identifier.decode lesson). The plan phrased it 'when known'; it is not known here, so no badge is invented. Not a blocking stub."
  - "The co-sign k/n uses the cohort capacity (n = minParticipants) as the total; awaitingPartialSigs flips true only once every nonce is in (noncesReceived >= capacity) AND signing has not completed, and is frozen back to false on signing-complete. On a bare (no-live-cohort) fold capacity is 0 so the flag stays false - honest, since there is no cohort size to compare against."

patterns-established:
  - "LogPanel gained an optional formatTime prop (default fmtElapsed) so ONE component serves both the participant elapsed-offset log and the operator server-wall-clock log without a second component (D-22)."
  - "The export route is a two-segment sibling (:id/export) of the single-segment detail route, so Hono's in-order matching never lets one shadow the other, and both inherit the requireSameOrigin + requireOperator prefix guards by registration position."

requirements-completed: []
requirements-advanced: [SVC-03]

coverage:
  - id: T1
    description: "Monitor detail depth: the fold folds the identity-carrying events into per-member round state, submissions (who/when + raw), honest co-sign (nonces k/n + awaitingPartialSigs, no partial-sig count), an anchor view (hermetic = {enabled:false,state:none}), a fallback flag, and a bounded activity ring; plus exportRecord (D-30/D-31/D-32/D-33/D-21/D-34)."
    requirement: SVC-03
    verification:
      - kind: unit
        ref: "packages/service/tests/monitor.spec.ts -> 35 passed (round transitions, rejects in the ring, honest co-sign flip with no partial-sig count, bounded ring, hermetic + broadcasting anchor, pubkey capture, export record)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/service exec tsc -b -> exit 0"
        status: pass
    human_judgment: false
  - id: T2
    description: "Drill-down depth render: the operator stage timeline + Members (round chips + pubkeys behind Technical detail) + Submissions (who/when + Raw signed update) + honest Co-sign (k/n + the awaiting line with no count) + Anchor sub-steps (hermetic + fallback lines) + the Activity log with server wall-clock stamps, top-to-bottom per D-05."
    requirement: SVC-03
    verification:
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web exec tsc --noEmit -> clean; pnpm --filter @btcr2-aggregation/web build -> green (697 modules)"
        status: pass
      - kind: manual_procedural
        ref: "CohortDetail renders OperatorStageTimeline + Members(SeatedRow round chip + Technical detail Expander) + Submissions(SubmissionRow + Raw signed update Expander) + Co-sign(awaitingPartialSigs -> All {n} nonces received. Awaiting partial signatures. else {k} of {n}) + Anchor(OperatorAnchorSubSteps or hermetic line, fallback line) + LogPanel(formatTime=fmtWallClock)"
        status: pass
    human_judgment: false
  - id: T3
    description: "Gated per-cohort JSON export: GET /v1/operator/cohorts/:id/export 401s anonymously, 400s on a bad id, returns the export JSON + a safe Content-Disposition within a session; the drill-down Export card downloads it (D-34)."
    requirement: SVC-03
    verification:
      - kind: unit
        ref: "packages/service/tests/monitor.spec.ts -> export 401 anon, 400 bad id, record + Content-Disposition within a session (all pass)"
        status: pass
      - kind: build
        ref: "pnpm --filter @btcr2-aggregation/web build -> green; downloadExport (same-origin fetch -> blob -> client download) compiles"
        status: pass
    human_judgment: false

# Metrics
duration: 35min
completed: 2026-07-24
status: complete
---

# Phase 4 Plan 04: Drill-Down Depth (Submissions, Honest Co-Sign, Anchor, Activity Log, JSON Export) Summary

**Deepened the operator drill-down from the 04-01 members/seats tracer to the full SVC-03 monitored depth: the monitor fold now folds every identity-carrying runner event into per-member round state, submissions with wall-clock stamps and the live raw signed-update body, honest co-sign progress that refuses to invent the unobservable partial-signature leg (D-32), an operator anchor view composed from the SAME injected anchor-state the public read serves (D-18/D-26), a fallback flag, and a bounded server-stamped activity ring (D-21/D-22); the drill-down renders it top-to-bottom behind an operator stage timeline, with pubkeys and raw JSON behind technical expanders (D-28/D-12); and a gated two-segment JSON export downloads exactly what the page shows plus the log (D-34).**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3
- **Files:** 1 created, 7 modified

## Accomplishments
- Extended `createCohortMonitor` to fold the remaining identity-carrying runner events into per-member round state (`update-received` -> submitted + wall-clock stamp, `validation-received` -> validated or rejected, `nonce-received` -> nonce-sent + a unique-DID nonce set, `message-rejected` -> rejected + reason in the ring), a forward progression that answers "who is holding this cohort up" (D-31), deliberately stopping at `nonce-sent` because the per-member partial-signature leg emits no event (D-32).
- Added a bounded per-cohort activity ring (`ACTIVITY_RING_SIZE = 200`, oldest-first eviction, per-cohort monotonic id) carrying every attributable runner event plus the broadcaster frames, each server wall-clock stamped, tone by level (rejects/failures -> bad) (D-21/D-22, T-04-04-03 DoS bound).
- Composed the detail DTO to full depth: `submissions` (who/when + the live `pendingUpdates` raw signed-update body), `coSign` ({noncesReceived, total, awaitingPartialSigs} with NO partial-sig count anywhere, D-32), `anchor` (the injected anchor-state projection, hermetic = `{enabled:false,state:'none'}`, D-18), `fallback` ({used, k?, n?} from `getResult().path === 'script-path'` or `fallback-started`, D-33), and the `activity` ring.
- Added `exportRecord(cohortId)` returning the detail projection + activity ring + `cohortId`/`exportedAt` as plain JSON, off-chain artifacts referenced by hash at `/cas/` (D-34).
- Registered the gated `GET /v1/operator/cohorts/:id/export` as a two-segment sibling of the detail read (inherits requireSameOrigin + requireOperator, anonymous 401 before any lookup, 400 on a bad id shape), with a `Content-Disposition` filename built ONLY from the shape-validated id (T-04-04-02); no new auth surface (D-34).
- Created `OperatorStageTimeline` (advertise -> filling -> submissions -> co-signing -> anchor) mirroring the participant `StageTimeline` treatment but with its own stage set, the active stage derived purely from the observed detail (phase + submissions + nonces + anchor), and "Anchored" reserved for a confirmed anchor only (D-05/D-18); it does NOT import the participant component.
- Rewrote `CohortDetail` to render the drill-down top-to-bottom (D-05): the stage timeline, Members (round-state chips + participant/communication pubkeys behind a `Technical detail` expander, D-28/D-31), Submissions (`{shortDid} submitted at {time}` / `: not yet submitted`, raw JSON behind a `Raw signed update` expander, D-30), Co-sign (`{k} of {n} nonces received`, or exactly `All {n} nonces received. Awaiting partial signatures.` with no count during the partial-sig window, D-32), Anchor (the Signed/Broadcast/Confirmed sub-steps, the no-broadcast line for a hermetic service, the k-of-n fallback line, D-18/D-33), the Activity log, and the Export card.
- Added a `formatTime` prop to `LogPanel` (default `fmtElapsed`) so the operator activity log renders the server wall-clock stamp while the participant callers stay byte-identical (D-22).
- Captured member pubkeys (hex) on the fold for the Technical detail expander (D-28), a Rule 2 addition the 04-01 member DTO lacked.
- SVC-03 criteria 2 (submissions + co-sign progress) and 3 (anchor status) now hold on the drill-down, plus the per-cohort activity log and the JSON export.

## Task Commits

Each task was committed atomically (unsigned per project convention):

1. **Task 1: Monitor detail depth (submissions, round state, honest co-sign, anchor, activity ring, export)** - `71883c2` (feat)
2. **Task 2: Drill-down depth render (stage timeline, round state, submissions, co-sign, anchor, activity)** - `aff11d2` (feat)
3. **Task 3: Gated per-cohort JSON export (route + download)** - `af7b38a` (feat)

## Files Created/Modified
- `packages/web/src/components/operator/OperatorStageTimeline.tsx` (created) - the operator cohort-lifecycle timeline; own stage set + pure furthest-along stage derivation; Anchored reserved for confirmed.
- `packages/service/src/monitor.ts` - the round-state fold, activity ring, submissions/coSign/anchor/fallback composition, pubkey capture, and `exportRecord`; `createCohortMonitor` gained a third `anchorState` param.
- `packages/service/src/index.ts` - threads `anchorState` into `createCohortMonitor`; exports the new monitor types.
- `packages/service/src/hono-adapter.ts` - the gated `:id/export` route + the widened detail-route monitor-absent fallback.
- `packages/service/tests/monitor.spec.ts` - the new detail-depth + export-route + pubkey coverage (35 tests) and the widened absent-DTO pins.
- `packages/web/src/lib/operator.ts` - the widened `CohortDetailDTO` mirrors (round, pubkeys, submissions, coSign, anchor, fallback, activity) + the `downloadExport` client helper.
- `packages/web/src/components/operator/CohortDetail.tsx` - the full drill-down render.
- `packages/web/src/components/LogPanel.tsx` - the optional `formatTime` prop.

## Decisions Made
- **The operator anchor view reuses the injected anchor-state, not a second broadcaster fold.** `createCohortMonitor` gained a third optional `anchorState` param, threaded from `index.ts` (which already builds it just before the monitor). The operator detail serves that read's projection directly, so the public `GET /v1/anchor` read stays byte-untouched (D-26) and the operator drill-down and the participant surface never disagree on an anchor (D-18). A hermetic service passes `undefined`, so the detail reads `{enabled:false,state:'none'}`.
- **Member pubkeys were folded during Task 2 (Rule 2 deviation).** The D-28 must-have truth requires the pubkeys behind the Technical detail expander, but the 04-01 member DTO carried none. The opt-in payload already delivers `participantPk`/`communicationPk`, so they are hex-encoded onto the member record (optional: a member first seen on a later round event has none) and mapped into the member DTO.
- **The onboarding-model badge is honestly omitted.** The monitoring DTO does not carry the KEY/EXTERNAL onboarding model, and deriving it from a raw `did:btcr2` string needs bech32m decoding the browser bundle deliberately avoids. The plan said "when known"; it is not known, so no badge is invented (see Known Stubs).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Threaded anchorState + exported new monitor types via index.ts (Task 1, file outside the Task 1 `<files>` list)**
- **Found during:** Task 1 (composing the operator anchor view)
- **Issue:** The plan's key_link requires the anchor detail to be "composed from the existing anchor-state read", but `createCohortMonitor` took only `(runner, broadcaster)`. The composition root that builds both the anchor-state and the monitor is `index.ts`, which is not in Task 1's `<files>`.
- **Fix:** Added a third optional `anchorState` param to `createCohortMonitor`, threaded it from `index.ts` (declared just before the monitor), and exported the new monitor DTO types from `index.ts`.
- **Files modified (beyond Task 1 `<files>`):** `packages/service/src/index.ts`
- **Committed in:** `71883c2` (Task 1 commit)

**2. [Rule 2 - Missing critical functionality] Captured member pubkeys on the fold for the D-28 Technical detail expander (Task 2, files monitor.ts + monitor.spec.ts belong to Task 1)**
- **Found during:** Task 2 (rendering the Technical detail expander)
- **Issue:** The D-28 must-have truth requires participantPk/communicationPk behind the member row's Technical detail expander, but the 04-01 member DTO (and the fold) carried only did/status/since - the pubkeys from the opt-in payload were discarded. The render had no data to show.
- **Fix:** Added optional hex `participantPk`/`communicationPk` to `MemberRecord` + `CohortMemberDTO`, captured them in the `opt-in-received` handler, mapped them into the detail, and added a spec assertion.
- **Files modified (beyond Task 2 `<files>`):** `packages/service/src/monitor.ts`, `packages/service/tests/monitor.spec.ts`
- **Committed in:** `aff11d2` (Task 2 commit)

**3. [Rule 3 - Blocking] Added a formatTime prop to LogPanel so the reused activity log renders server wall-clock stamps (Task 2, file LogPanel.tsx outside the Task 2 `<files>` list)**
- **Found during:** Task 2 (reusing LogPanel for the activity log)
- **Issue:** The reuse-map contract (and the plan action) require the operator activity log's timestamp column to render the server wall-clock `t`, not the participant elapsed `fmtElapsed`. `LogPanel` hardcoded `fmtElapsed`, which would render a huge millisecond number for a `Date.now()` stamp.
- **Fix:** Added an optional `formatTime?: (t: number) => string` prop defaulting to `fmtElapsed` (participant callers byte-identical); the operator log passes `fmtWallClock`.
- **Files modified (beyond Task 2 `<files>`):** `packages/web/src/components/LogPanel.tsx`
- **Committed in:** `aff11d2` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all consequences of meeting the plan's must-have truths + reuse-map contract). No behavioral surprises; all other work matched the plan.

## Known Stubs
None that block the plan goal. One honest OMISSION: the **onboarding-model badge (KEY/EXTERNAL) on member rows is not rendered** because the monitoring DTO does not carry the onboarding model and deriving it from a raw `did:btcr2` string needs bech32m decoding the browser bundle avoids. The plan phrased this "when known"; it is not known from the detail read, so no badge is invented (mode honesty). Surfacing the onboarding model would require the fold to derive and carry it (a small future addition if a later plan wants it); it is not required by any SVC-03 acceptance criterion and does not block the drill-down goal.

## Verification Evidence
- `pnpm vitest run packages/service/tests/monitor.spec.ts` -> **35 passed** (round transitions, submissions who/when, validation + message rejects landing in the ring, honest co-sign flip with no partial-sig count, bounded ring, hermetic + broadcasting anchor views, pubkey capture, export record, export route 401/400/session).
- `pnpm --filter @btcr2-aggregation/service exec tsc -b` -> exit 0.
- `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` -> clean.
- `pnpm --filter @btcr2-aggregation/web build` (Vite + tsc) -> green (697 modules, +3 vs 04-03's 694).
- `pnpm test` (tsc -b + vitest, the committed CI gate) -> **407 passed** (29 files), no regressions (+14 vs 04-03's 393: the new detail-depth + export tests).
- `pnpm lint` (eslint on all changed files) -> clean.
- Em-dash scan over all created/modified files -> none.

## Threat Surface
The threat register dispositions hold: T-04-04-01 (detail/export info disclosure) is mitigated by the detail + export routes both inheriting requireOperator (member DIDs/pubkeys/raw updates + activity are operator-gated; no recovery-key value is serialized; off-chain artifacts referenced by hash). T-04-04-02 (Content-Disposition) is mitigated by building the filename only from the shape-validated (`/^[0-9a-zA-Z-]{1,64}$/`) cohort id, no user-controlled header content. T-04-04-03 (activity-ring DoS) is mitigated by the fixed `ACTIVITY_RING_SIZE = 200` oldest-first eviction; reads are pure projections. T-04-04-04 (repudiation) is mitigated by the honesty rule: no invented partial-sig count anywhere in the DTO, "Anchored" only at a confirmed anchor, the fallback disclosed plainly. No new anonymous surface: the export route is a gated GET beside the detail read; the public directory/status/anchor DTOs are byte-untouched (freeze pins still green).

## Next Phase Readiness
- 04-06 (live funding stage) inserts the funding stage between co-signing and anchor in `OperatorStageTimeline`, populates the health-strip live mode + esplora chip, and adds the Funding concern section; the beacon address already rides the fold (`keygen-complete`).
- 04-08 (live UAT) exercises the full drill-down (submissions/co-sign/anchor/activity/export) against Polar/regtest, including the real broadcast anchor sub-steps and the k-of-n fallback line.

## Self-Check: PASSED

- `packages/web/src/components/operator/OperatorStageTimeline.tsx` -> FOUND
- `packages/service/src/monitor.ts` -> FOUND
- `packages/service/src/hono-adapter.ts` -> FOUND
- `.planning/phases/04-operator-cohort-monitoring/04-04-SUMMARY.md` -> FOUND
- Task 1 commit `71883c2` -> FOUND
- Task 2 commit `aff11d2` -> FOUND
- Task 3 commit `af7b38a` -> FOUND

---
*Phase: 04-operator-cohort-monitoring*
*Completed: 2026-07-24*
