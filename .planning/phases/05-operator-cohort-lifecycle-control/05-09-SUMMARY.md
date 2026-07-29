---
phase: 05-operator-cohort-lifecycle-control
plan: 09
subsystem: operator-lifecycle
tags: [test-peers, rehearsal, participant, monitor-badge, react, zustand, vitest, e2e]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 08)
    provides: the service-level operator-actions ring and its noteOperatorAction seam, which this plan's log entry rides
  - phase: 05-operator-cohort-lifecycle-control (plan 02)
    provides: the ConfirmPanel primitive and its tone ladder (rung 2 = warn, simple confirm, no typed value)
  - phase: 04-operator-cohort-monitoring
    provides: the bounded monitoring fold and its member projection, the gated per-cohort detail read, and the drill-down Members card
  - phase: 04-operator-cohort-monitoring (plan 06)
    provides: the funding-watch stop-handle idiom (abort listener, idempotent stop) this spawner's lifecycle copies
provides:
  - packages/service/src/test-peers.ts - spawnTestPeers, the per-service registry, and addTestPeersFor
  - CohortMemberDTO.testPeer, badged from a per-service DID set rather than any protocol field
  - POST /v1/operator/cohorts/:id/test-peers, gated, id-shape-guarded, count-capped
  - Service.testPeers, so a harness can COUNT the peers still running after a teardown
  - the drill-down Fill remaining seats with test peers control and its rung-2 ceremony
  - the e2e:testpeers hermetic leg
affects: [05-14 phase capstone]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "An operator-triggered spawn is bounded by a fact the SERVICE reads at call time, never by a number the browser sent"
    - "A label the protocol cannot carry comes from a set the service wrote itself; inferring it could only ever mislabel a genuine participant"
    - "The badge set is handed to the monitor as a LIVE instance, so a peer spawned later is badged with nothing rebuilt"
    - "Teardown is asserted by a COUNT of what is still running, never inferred from the absence of a visible break"
    - "A partial failure reports the number that actually took a seat, never the number asked for"
    - "A surface whose page already renders the shared action-error twice gets its own error field"

key-files:
  created:
    - packages/service/src/test-peers.ts
    - packages/service/tests/test-peers.spec.ts
  modified:
    - packages/service/src/index.ts
    - packages/service/src/monitor.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/tsconfig.json
    - packages/service/tests/lifecycle-routes.spec.ts
    - e2e/operator-cohort.ts
    - package.json
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/CohortDetail.tsx

key-decisions:
  - "The seat cap is read LIVE from the runner session at call time, so a mid-signing cohort refuses itself without any phase check: it already has all n seats filled"
  - "The test-peer badge comes from a per-service DID set written at spawn time and is handed to the monitor as the live Set instance"
  - "The registry keeps its badge set after a cohort settles, so an ended cohort's members keep reading Test peer; only the stop HANDLES are dropped"
  - "The verdict logic lives in test-peers.ts (addTestPeersFor), so the route-semantics matrix asserts the shipping arithmetic rather than a re-typed copy"
  - "A peer whose start() rejects is stopped and excluded from the count; a spawn where every peer failed is a 502, not a silent 200"
  - "The abort listener is registered once per spawn BATCH rather than once per peer: fewer listeners for the same effect, and it cannot be half-registered if a peer fails mid-loop"
  - "The member badge and row line are authored in CohortDetail.tsx beside the other member-row labels, following the 05-08 HealthStrip precedent"
  - "The test-peer surface has its OWN testPeerError field, because the drill-down already renders the shared actionError on two other cards"

requirements-completed: [SVC-04]

coverage:
  - deliverable: "The operator fills a cohort's remaining seats with in-process test participants from the drill-down"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#200s with the spawned count and fills every remaining seat when no body is sent"
        status: pass
      - kind: command
        ref: "pnpm e2e:testpeers"
        status: pass
  - deliverable: "One operator can rehearse the whole loop alone: the peers seat, submit, and co-sign to completion"
    human_judgment: false
    verification:
      - kind: command
        ref: "pnpm e2e:testpeers"
        status: pass
  - deliverable: "The spawn is capped at the cohort's remaining seats and refused at zero"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/test-peers.spec.ts#CAPS a request larger than the remaining seats, so the spawn is bounded by n"
        status: pass
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#409s a cohort with no seats left, carrying the exact reason the console renders"
        status: pass
  - deliverable: "Every spawned peer is torn down on cohort settle and on service stop"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/test-peers.spec.ts#releases a cohort peers when that cohort settles"
        status: pass
      - kind: test
        ref: "packages/service/tests/test-peers.spec.ts#stops every remaining peer when the service stops"
        status: pass
      - kind: test
        ref: "packages/service/tests/test-peers.spec.ts#stops and DROPS a cohort peers on release, asserted by a live count"
        status: pass
  - deliverable: "Test-peer members are badged from a per-service set, and a genuine stranger never is"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/test-peers.spec.ts#badges exactly those DIDs in the monitor member projection, and no others"
        status: pass
      - kind: test
        ref: "packages/service/tests/test-peers.spec.ts#keeps two registries in one process completely independent"
        status: pass
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#badges exactly the spawned members in the gated detail read"
        status: pass
  - deliverable: "The gated route answers 401 anonymously, 400 malformed, 404 unknown, 409 full, 200 with the count"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#401s with no session cookie, BEFORE any cohort-id lookup"
        status: pass
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#400s a malformed cohort id before any lookup"
        status: pass
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#404s an unknown cohort id with the SAME opaque body cancel and finalize use"
        status: pass
  - deliverable: "The spawn appends both the per-cohort activity line and the service-level log entry"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#records BOTH the per-cohort activity line and the service-level entry, once"
        status: pass
  - deliverable: "A live cohort's peers have their post-cohort registration honestly skipped with a console note"
    human_judgment: true
    rationale: "The skip note is emitted only on a live BROADCASTING service (mode === 'live'), which the hermetic gate cannot reach; the string and its gate are read in review, and the behavior belongs to the phase's live walkthrough."
  - deliverable: "The drill-down control, its help line, its zero-seat disabled reason, and the rung-2 confirm read correctly"
    human_judgment: true
    rationale: "Whether the control sits comfortably under the member list, whether the warn-tone confirm reads at the right weight for an act that adds rather than destroys, and whether the live-mode line lands with enough gravity are judgments no unit test makes. Belongs to the phase's console walkthrough at the end-of-phase gate."

# Metrics
duration: ~30 min
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 09: Operator Test Peers Summary

**A single operator now fills their own cohort's remaining seats with real in-process participants that co-sign the round for them, are labelled as theirs everywhere on the console from a set the service wrote itself rather than anything it read off the wire, and are counted to zero the moment the cohort settles.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-29
- **Tasks:** 2 (task 1 is TDD, so it has a RED then a GREEN commit)
- **Files modified:** 12 (2 created, 10 modified)

## Accomplishments

- **The Phase 4 live UAT needed two humans; this needs one.** `POST /v1/operator/cohorts/:id/test-peers` spawns in-process `createParticipant` instances against the service's OWN base URL, filtered to the one target cohort. `pnpm e2e:testpeers` drives the whole thing over the real HTTP transport: a 3-seat cohort, one peer added (leaving it genuinely partly filled), the remaining seats filled from the gated route, and the peers seating, submitting, and co-signing the cohort to `signing-complete`. Nothing about them is simulated.
- **They are real participants, and the badge says so honestly.** Nothing in the advert or the opt-in distinguishes a test peer from a stranger who joined from the public directory, which is correct. `CohortMemberDTO.testPeer` therefore comes from a per-service `Set<string>` of DIDs written at spawn time, exactly the way `seatedRosterKeys` is scoped per `createService` call. The spec pins both halves: the spawned DID reads badged, and a `did:example:a-real-stranger` seated in the same cohort does not (T-05-09-05).
- **The badge set is handed over as the LIVE Set instance, never a copy.** `createCohortMonitor` holds the very object the registry mutates, so a peer spawned minutes after the monitor was constructed is badged on the very next read with nothing rebuilt. A spec asserts exactly that ordering, because a copy taken at construction would badge nothing and would fail silently rather than loudly.
- **The count is bounded by a fact the SERVICE reads, not a number the browser sent.** `addTestPeersFor` reads the live cohort's seats at call time and caps the request at `capacity - seatsJoined`; `spawnTestPeers` caps again at `remainingSeats` and floors a non-finite or non-positive request at zero. A request for 10,000 peers into a 2-seat cohort spawns 2. The console's rendered seat count is one poll old by the time the operator clicks, so it can only ever be a request (T-05-09-02).
- **A mid-signing cohort refuses itself, with no phase check anywhere.** A cohort that has started signing already has all n seats filled, so its remaining count is zero and the action is a 409. That is why this plan adds no phase predicate: the seat arithmetic already answers the question, and a second source of truth about when a cohort accepts opt-ins is a second thing that can drift.
- **Teardown is COUNTED, not inferred.** Each peer holds two SSE subscriptions, so a leaked handle is a leaked connection. The registry exposes `activeCount`, `releaseCohortTables` calls `release(cohortId)` on all three settle paths, `service.stop()` calls `stopAll()`, and the injected `stopController.signal` is a third net. Three specs plus the e2e assert the count is zero afterwards rather than assuming nothing broke.
- **The badge survives the teardown, deliberately.** `release` drops the stop handles and never touches the DID set, because an ended cohort's drill-down must keep labelling those members. The set carries its own oldest-first bound (200) precisely because nothing prunes it on a settle.
- **The verdict logic lives where the spec can reach it.** `addTestPeersFor` is exported from `test-peers.ts` and used by BOTH `createService` and the route-semantics matrix, so `lifecycle-routes.spec.ts` asserts the shipping arithmetic over a real registry rather than a re-typed copy of it. Only the participant factory is faked there.
- **A partial failure reports what actually happened.** A peer whose `start()` rejects is stopped immediately (never left holding a socket) and left out of the count, so the operator is told how many seats were really taken. A spawn where every peer failed is a 502 with an app-authored reason, not a 200 claiming zero.
- **The confirm states the live consequence BEFORE the act.** On a service whose served mode is the live broadcasting one, an extra line inside the SAME rung-2 confirm says the peers co-sign for real and their DIDs are anchored on the named network. An operator should not learn that from a block explorer afterwards (T-05-09-04).
- **The live registration limit is spoken, not silently attempted.** On a live cohort the service logs and appends `Test peers co-sign this cohort, but their own DID registrations are skipped: a first update needs its own funded beacon address and a confirmed registration.` A KEY first update needs its own funded singleton beacon address and a CONFIRMED registration (the ADR 0007 chicken-and-egg), so attempting it per peer would fail where nobody would look, and demanding N funding steps would defeat the point of a solo rehearsal.
- **Test peers render INLINE in the same member list.** A separate "test peers" section would misrepresent both the protocol and the cohort's own seat count. The badge is neutral toned, never accent: a test peer is not a live-progress signal.
- **No auto-fill came back with it.** Every peer exists because one authenticated operator asked for it, on one named cohort. The module docstring records that the Phase 1 filler loop was deleted and that the surviving `fillers?: number` field on the demo-server type has no machinery behind it, so a future reader does not mistake this for its return (HOST-03 posture).

## Task Commits

Task 1 is TDD, so it has a RED then a GREEN commit:

1. **Task 1 (RED): failing spec for the operator test-peer spawner** - `6315123` (test)
2. **Task 1 (GREEN): the bounded spawner, badging, and teardown** - `bfafe68` (feat)
3. **Task 2: the drill-down action and the badged member rows** - `8ddde12` (feat)

## Files Created/Modified

- `packages/service/src/test-peers.ts` (new) - `spawnTestPeers` (the seat cap, the batch abort listener, the per-peer start-failure exclusion), `createTestPeers` (the live badge set with its oldest-first bound, the per-cohort handle map, `release` / `stopAll` / `activeCount`), `addTestPeersFor` (the closed verdict union), `TestPeerSpawner`, and the three exact refusal reasons. The module docstring records what the Phase 1 filler loop was and that it is gone.
- `packages/service/src/index.ts` - the closure-scoped registry wired to `stopController.signal` and the config-driven network, `startedBaseUrl` captured in `start()`, `testPeers.release` inside `releaseCohortTables`, `testPeers.stopAll()` in `stop()`, the `addTestPeers` action with its two log entries plus the live-mode skip note, `Service.testPeers`, and the re-exports.
- `packages/service/src/monitor.ts` - `CohortMemberDTO.testPeer`, the sixth `createCohortMonitor` parameter (the live set), the additive spread in the member projection, `addedTestPeersText`, `operatorAddedTestPeersText`, and `TEST_PEER_REGISTRATION_SKIPPED_TEXT`.
- `packages/service/src/hono-adapter.ts` - the gated `POST /v1/operator/cohorts/:id/test-peers` with its id shape guard, 4 KiB body limit, optional `count` validation, and the five-way verdict mapping.
- `packages/service/tsconfig.json` - a project reference to `../participant` (the package dependency was already declared; only the composite build reference was missing).
- `packages/service/tests/test-peers.spec.ts` (new, 21 tests) - the seat cap and its four edge cases, the start-failure exclusion, the badge set and its independence across two registries in one process, the badge-after-construction ordering, release / stopAll / abort teardown with live counts, the already-aborted and no-base-URL refusals, the two `createService` teardown paths, and the exact refusal copy with its long-dash guard.
- `packages/service/tests/lifecycle-routes.spec.ts` (+10 tests) - the harness gained a real test-peer registry (built BEFORE the monitor so the badge set is threaded) over a fake participant factory, a `setSeats` stage for the full-cohort row, and the route-semantics rows: 401 / 400 / 404 / 409 / 200, the empty-body fill, the smaller request, the capped request, the four invalid counts, the two log entries, and the badged detail read.
- `e2e/operator-cohort.ts` - `runTestPeersLeg` (the anonymous 401 negative, the partial fill, the empty-body fill of the remainder, co-sign to completion, every seated member badged, the anchored chip, the zero-peers-still-running count, and the refused repeat), the `--test-peers` flag, and its pass banner. The leg also joins the default `e2e:operator` suite.
- `package.json` - the `e2e:testpeers` script.
- `packages/web/src/lib/operator.ts` - `CohortMemberDTO.testPeer`, `AddTestPeersResult`, and `addTestPeers` (409 preserves the server's reason; a body with no numeric `spawned` is treated as unreachable rather than coerced).
- `packages/web/src/stores/operator.ts` - the E11 copy set (label, help, heading, body, live line, confirm labels, busy label, zero-seat reason), `addingTestPeers`, `testPeerError`, and the non-optimistic `addTestPeers` action that re-reads the detail.
- `packages/web/src/components/operator/CohortDetail.tsx` - the `TestPeerAction` component (remaining-seat recompute, the disabled zero-seat state, the rung-2 warn confirm with its live-mode line, the in-flight treatment, and its own error line), the `Test peer` badge and row line on both `SeatedRow` and `PendingRow`, and the served `health.mode` read.

## Decisions Made

- **The seat cap is read live at call time.** The console's number is one poll old; the cap that matters is the one the service enforces when the request lands.
- **A mid-signing cohort needs no phase check.** It already has every seat filled, so the seat arithmetic refuses it. A second predicate would be a second thing that can drift from the first.
- **The badge comes from a set the service wrote, never from the wire.** Inference could only ever mislabel a genuine participant, and there is nothing correct to infer from.
- **The monitor holds the live Set instance.** A copy at construction would badge nothing for every peer spawned afterwards, and would do it silently.
- **`release` keeps the DID set and drops only the handles.** An ended cohort's drill-down must keep labelling its members; the set carries its own bound precisely because nothing prunes it.
- **`addTestPeersFor` is exported and shared.** The route matrix asserts the shipping arithmetic rather than a re-typed copy, which is how a create/edit pair drifts.
- **The abort listener is per BATCH, not per peer.** Fewer listeners for identical behavior, and it cannot end up half-registered when a peer fails mid-loop.
- **A spawn where every peer failed is a 502.** A 200 reporting zero would look like success with nothing to show for it.
- **The member badge and line are authored in `CohortDetail.tsx`.** Every other member-row label is authored there, and the audit grep that proves both render reads that file. This follows the 05-08 `HealthStrip.tsx` precedent exactly.
- **The test-peer surface owns its error field.** The drill-down already renders the shared `actionError` on the Lifecycle card and again on the Export card; a third would print one failure three times down one page.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/service/tsconfig.json` had no project reference to `../participant`**

- **Found during:** Task 1
- **Issue:** `packages/service/package.json` already declares `@btcr2-aggregation/participant` as a workspace dependency (residue from the deleted filler path), but the composite `tsconfig.json` referenced only `../shared`. `test-peers.ts` imports `createParticipant`, so `tsc -b` could not resolve its types and the whole gate failed at typecheck.
- **Fix:** Added `{ "path": "../participant" }` to the service's references. No dependency was added and no cycle is introduced: `participant` references only `shared`.
- **Files modified:** packages/service/tsconfig.json
- **Verification:** `pnpm typecheck` clean; the full 52-file / 834-test suite green.
- **Committed in:** `bfafe68`

**2. [Rule 2 - Missing Critical] The verdict union needed two branches the plan's route mapping did not name**

- **Found during:** Task 1
- **Issue:** The plan maps unknown to 404, zero seats to 409, and success to 200. Two real outcomes fall outside that: a service that has not started listening has no origin for its own peers to connect back to, and a spawn where every peer's `start()` rejected produced nothing. Both would otherwise have to be reported as one of the three named verdicts, each of which would be a false statement about what happened.
- **Fix:** `AddTestPeersOutcome` gained `'unavailable'` (503) and `'failed'` (502), each with its own app-authored reason. Neither is reachable through the shipped console (the route only exists on a listening server), so the three named mappings are unchanged in practice.
- **Files modified:** packages/service/src/test-peers.ts, packages/service/src/hono-adapter.ts
- **Verification:** the no-base-URL branch is asserted in `test-peers.spec.ts` (`reports the service as unavailable while it has no base URL yet`); the start-failure exclusion that feeds `'failed'` is asserted by `excludes a peer whose start() rejects`.
- **Committed in:** `bfafe68`

**3. [Rule 1 - Bug] A shared `actionError` line would have printed one failure three times on the drill-down**

- **Found during:** Task 2
- **Issue:** The plan routes a failed spawn into `actionError`. That field is already rendered by `LifecycleActions` (the Lifecycle card) and again by the Export card, both on this same page. A failed spawn would have rendered the same sentence in three places, and a failed export would have rendered it inside the Members card.
- **Fix:** A dedicated `testPeerError` field, following the precedent `broadcastError` set in 05-08 for the same reason ("its own field ... a shared field would render one failure on two surfaces"). It is cleared alongside the other transient slices in both `signOut` and `expireSession`.
- **Files modified:** packages/web/src/stores/operator.ts, packages/web/src/components/operator/CohortDetail.tsx
- **Verification:** `pnpm --filter @btcr2-aggregation/web build` and `pnpm lint` clean; the error line renders inside the test-peer block in both its confirm and its idle state.
- **Committed in:** `8ddde12`

**4. [Rule 1 - Bug] The member badge and row line had to be authored in the component, not the store**

- **Found during:** Task 2
- **Issue:** The plan's own acceptance criterion requires `grep -c 'Test peer' packages/web/src/components/operator/CohortDetail.tsx` to be at least 2. With both strings imported from `stores/operator.ts` the grep read 1: the file rendering the badge contained neither string.
- **Fix:** `TEST_PEER_BADGE` and `TEST_PEER_ROW_LINE` are authored in `CohortDetail.tsx` beside the round-state labels that file already owns, following the 05-08 `HealthStrip.tsx` precedent (a chip label lives where it is rendered, and the audit grep reads that file). The store's copy block carries a pointer to their home. The grep now reads 3.
- **Files modified:** packages/web/src/stores/operator.ts, packages/web/src/components/operator/CohortDetail.tsx
- **Verification:** `grep -c 'Test peer' packages/web/src/components/operator/CohortDetail.tsx` returns 3.
- **Committed in:** `8ddde12`

**5. [Rule 3 - Blocking] Two spec-local collisions, fixed inside the spec**

- **Found during:** Task 1
- **Issue:** (a) The two-registry independence test minted the SAME fake DID from both registries, so it failed for the wrong reason. (b) The `lifecycleApp()` harness built its monitor BEFORE the test-peer registry existed, so the badge assertion in the route matrix saw no set at all.
- **Fix:** (a) The fake identity factory takes a prefix, and the independence test gives each registry its own. (b) The registry is constructed before the monitor in the harness, mirroring `index.ts`'s own ordering, and the set is threaded in.
- **Files modified:** packages/service/tests/test-peers.spec.ts, packages/service/tests/lifecycle-routes.spec.ts
- **Verification:** 21 + 43 tests green.
- **Committed in:** `bfafe68`

### Deliberate readings of the plan

- **The abort listener is registered once per spawn BATCH, not once per peer** (the plan says "exactly once per peer"). One listener that stops every peer in the batch is strictly fewer listeners for identical behavior, and it cannot end up half-registered when a peer fails mid-loop. The intent (no listener leak) is met and documented at the call site.
- **There is no timer to `unref()`.** The plan asks for the funding-watch treatment; this spawner is purely event-driven over SSE and starts no timer of its own, which the module docstring states rather than adding one to unref.

---

**Total deviations:** 5 auto-fixed (2 bugs, 1 missing critical, 2 blocking), plus 2 documented readings of the plan text.
**Impact on plan:** Two files outside the plan's `files_modified` list changed: `packages/service/tsconfig.json` (a build reference the new import requires) and nothing else. No interface a later plan references departed from the plan.

## Issues Encountered

- **No unit test covers the rendered composition of the new drill-down surface**, only its copy and its store action. Whether the control sits comfortably under the member list, whether a warn-tone confirm reads at the right weight for an act that adds rather than destroys, and whether the live-mode line lands with enough gravity belong to the phase's console walkthrough at the end-of-phase gate. This is the same gap 05-06, 05-07 and 05-08 recorded.
- **The live-mode paths cannot be exercised by the hermetic gate.** The extra confirm line, the skipped-registration note, and the console log all gate on the served `mode === 'live'`, which requires `LIVE=1 BROADCAST=1` and a real chain. They were read in review and belong to the live walkthrough. The peers themselves are mode-agnostic (they are ordinary participants either way), so only the disclosure copy is unproven, not the behavior.
- **The e2e's repeat-spawn assertion accepts either 409 or 404**, deliberately. Once a cohort settles it leaves the runner session on a timing this harness does not control, so the honest refusal is 409 while it is still there and 404 once it is not. Both are refusals; a 200 would be the failure, and that is what the assertion excludes. The deterministic 409 row lives in the unit route matrix with staged seats.

## Known Stubs

None. Every control on this surface is wired end to end: the button reaches a live gated route that spawns real `createParticipant` instances which really seat and really co-sign; the badge renders a served bit produced by a set the service wrote at spawn time; the disabled zero-seat state and its reason are computed from the served seat counts; and the operator-actions entry is produced by the real monitor ring.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/service/tests/test-peers.spec.ts packages/service/tests/lifecycle-routes.spec.ts` (task 1 gate) | 64 tests pass |
| `pnpm e2e:testpeers` (task 1 gate) | pass (partial fill, remainder fill, co-sign to completion, all members badged, zero peers left running) |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` (task 2 gate) | clean |
| `pnpm --filter @btcr2-aggregation/web build` (task 2 gate) | clean |
| `pnpm test` (full suite, `tsc -b` gated) | 52 files, 834 tests pass |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm e2e:operator` (full extended suite, now including the test-peer leg) | pass |
| `pnpm e2e:monitor` | pass |
| `pnpm e2e:cancel` | pass |
| `pnpm e2e:pause` | pass |
| `pnpm e2e:fallback:operator` | pass |
| `pnpm e2e:live:mock` | pass |
| `grep -rniE 'booth\|attendee\|filler' packages/service/src/test-peers.ts packages/web/src/components/operator/CohortDetail.tsx` | 2 matches, both in the `test-peers.ts` module docstring recording what Phase 1 removed (the historical note the plan's verification block permits); no product copy |
| `grep -rniE 'booth\|attendee\|demo\|filler' packages/web/src/{components/operator/CohortDetail.tsx,stores/operator.ts,lib/operator.ts}` | no matches |
| `grep -rlP '\x{2014}' packages/service/src packages/web/src` | no files |
| `grep -rlP '\x{2014}' packages/web/src/components/operator` | no files |
| `grep -c 'Test peer' packages/web/src/components/operator/CohortDetail.tsx` | 3 (the two constants plus the badge render) |
| root `package.json` scripts contains `e2e:testpeers` | yes |

## User Setup Required

None. No new environment variable and no new boot requirement. The route mounts only inside the authenticated console, which exists only on a service booted with `OPERATOR_PASSWORD`, and the peers connect back to the service's own origin. A service booted without an operator password behaves exactly as it did before. On a live service the peers co-sign real transactions, which the confirm states before the act; no per-peer funding is asked of the operator, and their own DID registrations are honestly skipped.

## Next Phase Readiness

- **The fourth and last parked absorption is closed.** D-17 (badged test peers) joins the broadcast kill switch, ended-record dismissal, and the SERVICE_NAME edit. All four items 05-08 listed as the second slip tier are now built.
- **`Service.testPeers` is the shape any later harness reads.** `activeCount` is the assertion a future teardown concern should reuse; `dids` is the live set the monitor already holds, so another badge (a "terms accepted" member badge, 05-13) can follow the same per-service-set pattern rather than inferring anything from the wire.
- **The route-semantics matrix in `lifecycle-routes.spec.ts` now covers three verbs** (cancel, finalize, test-peers) in one shape: 401 before any lookup, 400 malformed, 404 opaque unknown, 409 with an app-authored reason, 200 with the result. A fourth gated cohort verb has one obvious place to join.
- **Carried concern, unchanged from 05-02 through 05-08:** a settled cohort still cannot be re-opened from the operator list, and a single seat still cannot be released (upstream: `@did-btcr2/aggregation@0.4.0` has no seat-release API). This plan's control adds seats; it does not reclaim them. The honest `SEAT_RECLAIM_NOTE` renders directly above the new control, which reads correctly: fill the remaining seats yourself, or cancel and re-advertise.
- **Carried gap, same as 05-06 / 05-07 / 05-08:** the rendered composition of the new console surfaces is unverified by any automated test and belongs to the end-of-phase console walkthrough, along with the live-mode disclosure copy this plan could not exercise hermetically.

## Self-Check: PASSED

- Created files verified present on disk: `packages/service/src/test-peers.ts`, `packages/service/tests/test-peers.spec.ts`.
- Commits verified in git history: `6315123`, `bfafe68`, `8ddde12`.
- Every task acceptance criterion re-run in this session, and the plan-level `<verification>` block re-run in full and green, including all six named e2e legs. The one criterion whose literal grep does not return empty (`booth|attendee|filler` on `test-peers.ts`) matches only the historical module docstring the plan's own verification block names as permitted.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*
