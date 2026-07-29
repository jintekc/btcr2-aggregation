---
phase: 05-operator-cohort-lifecycle-control
plan: 08
subsystem: operator-lifecycle
tags: [kill-switch, broadcast, adr-0010, telemetry, operator-log, react, zustand, vitest, e2e]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 04)
    provides: the runtime settings holder, where broadcastDisabled was declared but unwired
  - phase: 05-operator-cohort-lifecycle-control (plan 05)
    provides: the Service controls card this control joins, and the non-optimistic served-bit idiom
  - phase: 05-operator-cohort-lifecycle-control (plan 02)
    provides: the ConfirmPanel primitive and its tone ladder (rung 1 dismissal, rung 3 kill switch)
  - phase: 04-operator-cohort-monitoring
    provides: the bounded monitoring fold, the cached service mode, LogPanel with its server wall-clock formatTime, and the advertisedAt stamp the per-cohort decision compares against
provides:
  - a one-way broadcastDisabled flag with its engage timestamp, and no path back short of a restart
  - cohortKeepsLiveWiring, the ONE pure rule both beacon-tx handoffs share
  - ServiceHealthDTO.broadcastDisabled, a bit BESIDE the unchanged boot mode
  - POST /v1/operator/broadcast/disable and DELETE /v1/operator/ended/:id, both gated
  - monitor.dismissEnded and the bounded service-level operatorActions ring, served on the existing polled read
  - the Disable broadcast control, the Broadcast off chip, the ended-row Dismiss action, and the Operator actions log
affects: [05-09 test peers add their own log entry, 05-14 phase capstone]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runtime power over money movement points ONE way: the holder offers a set-true mutator and nothing else, and a spec searches the surface for the absence rather than documenting it"
    - "A mode fixed at construction is never re-derived; a state change beside it becomes a SECOND bit and a SECOND chip"
    - "The engage timestamp is stamped once and never moved, so a second click cannot slide the pivot and retroactively re-enable cohorts advertised in between"
    - "A gate on a money-moving path fails CLOSED on missing evidence"
    - "An empty array BEFORE a read and an empty array AFTER one are different facts, so the loading posture is keyed on the freshness stamp, not on the array"
    - "An action that clears a record records itself, inside the method rather than at its call sites"

key-files:
  created:
    - packages/service/tests/kill-switch.spec.ts
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/src/index.ts
    - packages/service/src/monitor.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/src/broadcast.ts
    - packages/service/tests/monitor.spec.ts
    - packages/service/tests/lifecycle-routes.spec.ts
    - packages/web/src/lib/operator.ts
    - packages/web/src/lib/clock.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/ServiceControls.tsx
    - packages/web/src/components/operator/HealthStrip.tsx
    - packages/web/src/components/operator/OperatorCohortList.tsx
    - packages/web/src/components/operator/CohortDetail.tsx
    - packages/web/tests/service-controls.spec.ts

key-decisions:
  - "The kill switch gates BOTH beacon-tx handoffs through one pure predicate, so a killed cohort is never built live and then silently not published"
  - "attachBeaconBroadcast gained a shouldBroadcast gate consulted BEFORE serialization, because a fixture tx would throw on extract and misreport a healthy cohort as failed"
  - "The engage stamp is taken once; a repeat disable is a no-op that must not move the pivot"
  - "Service-level operator actions are all info toned: they are the operator's own deliberate acts, and a warn tone would have the log shout at them about decisions they just made"
  - "Settings changes are recorded by comparing two served snapshots, so a save that changed nothing records nothing, and the VALUES are never logged"
  - "dismissEnded appends its own log entry inside the method, so no caller can forget that clearing a record is itself an action"
  - "The Broadcast off chip label is authored in HealthStrip.tsx beside the strip's other chip labels, not in the store, so every label on that row has one home"

requirements-completed: [SVC-04]

coverage:
  - deliverable: "The operator can stop the money-moving leg for NEW cohorts at runtime"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/kill-switch.spec.ts#does NOT broadcast a cohort advertised AFTER the switch engaged"
        status: pass
  - deliverable: "Cohorts already in flight finish under the mode they started with"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/kill-switch.spec.ts#still broadcasts a cohort advertised BEFORE the switch engaged"
        status: pass
  - deliverable: "The kill switch is one-way within a session; no route sets it back"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/kill-switch.spec.ts#exposes exactly ONE broadcast mutator, and it only ever sets the flag true"
        status: pass
      - kind: test
        ref: "packages/service/tests/kill-switch.spec.ts#registers NO counterpart route that turns broadcast back on"
        status: pass
  - deliverable: "The served boot mode is never mutated; broadcast-off is a separate bit and chip"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/kill-switch.spec.ts#reports broadcastDisabled as a bit BESIDE the unchanged boot mode"
        status: pass
  - deliverable: "An ended record can be dismissed, removing that record and only that record"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/monitor.spec.ts#removes exactly one ended record and leaves every sibling present"
        status: pass
  - deliverable: "Dismissal touches telemetry only, with no chain or directory effect"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/monitor.spec.ts#touches telemetry only: the runner is never called and the record simply stops being served"
        status: pass
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#leaves the public directory and the operator cohort list untouched by a dismissal"
        status: pass
  - deliverable: "Every operator action this phase adds appends one wall-clock-stamped service-level entry"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#records pause, resume, cancel, and finalize as self-contained sentences"
        status: pass
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#records a settings change by name, and records nothing for a save that changed nothing"
        status: pass
  - deliverable: "The log is bounded, oldest-first, and rides the existing gated poll rather than a new stream"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/monitor.spec.ts#is bounded and evicts oldest-first"
        status: pass
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#serves operatorActions as an additive sibling key beside rows/metrics/health"
        status: pass
  - deliverable: "Both gated routes reject an anonymous caller with 401 before any lookup"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/kill-switch.spec.ts#401s for an anonymous caller"
        status: pass
      - kind: test
        ref: "packages/service/tests/lifecycle-routes.spec.ts#401s with no session cookie, BEFORE any lookup"
        status: pass
  - deliverable: "The kill-switch and dismissal confirms render the documented copy, in-flight labels, and error line"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/service-controls.spec.ts#states all three kill-switch confirm body lines, including the no-way-back line"
        status: pass
      - kind: test
        ref: "packages/web/tests/service-controls.spec.ts#states the rung-1 dismissal copy, including that there is no undo"
        status: pass
  - deliverable: "The three console surfaces read well at a real viewport"
    human_judgment: true
    rationale: "Whether the kill-switch ceremony reads as sufficiently grave, whether the log sits comfortably on the controls card, and whether the two warn chips beside the mode chip crowd the strip are judgments no unit test makes. Belongs to the phase's console walkthrough at the end-of-phase gate."

# Metrics
duration: ~35 min
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 08: Broadcast Kill Switch, Ended-Record Dismissal, Operator Actions Log Summary

**A live operator can stand down money movement for new cohorts at runtime without killing their service, clear finished records off the console without touching anything real, and read back everything they did this session, with the one-way guarantee proven by a search for the absence of a way back rather than a comment claiming there is none.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-29
- **Tasks:** 3 (tasks 1 and 2 are TDD, so each has a RED then a GREEN commit)
- **Files modified:** 16 (1 created, 15 modified)

## Accomplishments

- **The decision is per cohort, at the handoff, and it is ONE rule.** `cohortKeepsLiveWiring` is a pure function comparing a cohort's advertise stamp against the moment the switch engaged, and `createService` calls it at BOTH beacon-tx handoffs: the data handoff (`onProvideTxData`, choosing the real builder or the fixture) and the broadcast handoff (`signing-complete`). Two call sites, one rule, so a cohort can never be built live and then silently not published, or the reverse. That is also what makes "cohorts already in flight finish under the mode they started with" a fact: a cohort advertised before the switch keeps its wiring all the way to its anchor.
- **A cohort standing down is genuinely on the fixture path, not merely unpublished.** With the switch engaged, a new cohort's `onProvideTxData` takes the fixture builder, so it never waits for funding, never reads a UTXO, and never produces a transaction that could be published. Had the gate lived only at the broadcast leg, an operator who disabled broadcast would still have had every new cohort block on a funding window for a beacon address nobody was going to fund.
- **The gate runs BEFORE serialization, and that ordering is load-bearing.** `attachBeaconBroadcast` gained a `shouldBroadcast` predicate consulted as the first thing in its `signing-complete` handler. A fixture beacon tx's dummy prevout makes `extract()` throw, so reaching the serialization would have emitted `beacon-broadcast-failed` and flipped a perfectly healthy cohort's ended chip to `failed`, telling the operator their cohort broke when in fact it did exactly what they asked.
- **The one-way guarantee is SEARCHED for, not asserted in prose.** `kill-switch.spec.ts` enumerates the holder's own surface and pins the broadcast members to exactly `broadcastDisabled`, `broadcastDisabledAtMs`, `disableBroadcast`; it then calls every other callable on the holder (both advertising toggles, a full `applySettings`, `snapshot`) and asserts the flag is still true, and separately enumerates the app's registered routes and pins the only broadcast route to the gated disable. A future `enableBroadcast` or `/broadcast/resume` fails the suite the moment it is written.
- **The engage stamp is taken once and never moved.** A second `disableBroadcast()` is a no-op that keeps the FIRST timestamp. Re-stamping would slide the pivot forward and silently re-enable broadcasting for every cohort advertised between the two clicks, which is the exact opposite of what the operator asked for, and it would be invisible.
- **The gate fails closed.** With the switch engaged and no advertise stamp for a cohort id, the answer is false. An id this service cannot show to predate the switch is one it cannot justify spending Bitcoin for, and for a money-moving decision the safe default is the one that moves no money.
- **The boot mode is never rewritten, and the honesty is structural.** `serviceHealth()` gained `broadcastDisabled` as a bit beside an untouched `mode`, and the strip renders a second warn chip beside the mode chip. The spec asserts the mode value and the esplora bit are byte-identical before and after the switch engages. This service really did boot live and its chain reads (resolve, anchor tracking, the funding watch) really are still live, so rewriting the mode chip would make the strip lie about how the service booted (T-05-08-03).
- **Dismissal removes one record and demonstrably nothing else.** `dismissEnded` deletes exactly one ended record plus its retained per-cohort activity and funding view, refuses an unknown id, and refuses a cohort still in an open or in-flight phase. The specs assert the sibling ended records survive, the service metrics move by exactly that one record, no runner verb is called, and the public directory is byte-identical across the call.
- **Clearing a record is itself recorded, from inside the method.** `dismissEnded` appends its own service-level entry rather than leaving that to its callers, so the one action whose whole purpose is to remove evidence cannot be the action that goes unrecorded.
- **The log records what MOVED, not what was sent.** A settings save is recorded by comparing the served snapshot before against the served snapshot after, so a save that re-submits values the service already holds records nothing, and a field the service normalized is judged on what the service ended up holding. The values themselves are never logged: an operator-authored name or terms document would widen the row without bound, and the field name is what the operator needs to recall what they did.
- **The log rides the poll the console already runs.** `operatorActions` is an additive sibling key on the gated `GET /v1/operator/cohorts` read, so it refreshes on the same tick as the rows, the metrics and the health chips. No new stream, honoring ADR 0016's retirement of the telemetry SSE channel.
- **An empty log before a read is not an empty log.** `operatorLogState` keys the loading posture on the freshness stamp rather than on the array being empty, because claiming `No operator actions this session.` against a service that has not answered yet would be a false claim about the operator's own history. A stale read freezes the entries under the list's inherited unreachable banner rather than dropping them.
- **Ceremony matches stakes at both ends of the ladder.** The kill switch is rung 3: danger tone, three stacked body lines saying in order what happens to new cohorts, what happens to work already in flight, and that there is no way back from here. Dismissal is rung 1: neutral tone, one body, no typed value, because nothing real is at stake and the only cost is that the record is gone.
- **Once engaged, the control is replaced rather than disabled.** A disabled `Disable broadcast` would imply the act is still pending or still possible from this console; it is neither. The replacement line names `BROADCAST=1` outright, because "restart with its broadcast environment set" is only actionable if the operator knows which variable, and this is the moment they need it.

## Task Commits

Tasks 1 and 2 are TDD, so each has a RED then a GREEN commit:

1. **Task 1 (RED): failing spec for the one-way broadcast kill switch** - `90da00e` (test)
2. **Task 1 (GREEN): the one-way kill switch, decided per cohort** - `ff7dd08` (feat)
3. **Task 2 (RED): failing specs for dismissal and the operator actions log** - `9807f05` (test)
4. **Task 2 (GREEN): ended-record dismissal and the service-level log** - `c405fa8` (feat)
5. **Task 3: Disable broadcast, Dismiss, and the Operator actions log on the console** - `f027307` (feat)

## Files Created/Modified

- `packages/service/src/runtime-settings.ts` - `disableBroadcast()` (sets true once, stamps `broadcastDisabledAtMs` once), the `broadcastDisabledAtMs` reader, and a docstring recording the deliberate absence of any counterpart; the `SettingsPatch` docstring now states why neither `paused` nor `broadcastDisabled` is a member.
- `packages/service/src/index.ts` - the exported pure `cohortKeepsLiveWiring`, the closure `cohortUsesLivePath` that reads the holder and the advertise stamp live, the two beacon-tx data builders with the wrapper installed only on a live service, the `shouldBroadcast` gate on `attachBeaconBroadcast`, and the service-level cancel and finalize log entries beside the existing per-cohort ones.
- `packages/service/src/monitor.ts` - `ServiceHealthDTO.broadcastDisabled`; the bounded (100, oldest-first) service-level `operatorActions` ring with its consecutive-duplicate guard and its copy-on-read projection; the `noteOperatorAction` service overload distinguished by arity; `dismissEnded`; and the exact operator-action strings with the short-id interpolation fixed at 8 characters.
- `packages/service/src/hono-adapter.ts` - gated `POST /v1/operator/broadcast/disable` (idempotent, no enable counterpart) and gated `DELETE /v1/operator/ended/:id` (id shape guard before any lookup); pause, resume and settings changes recording their own entries on the transition only; `recordSettingsChanges` with its plain-language `SETTING_LABELS`; `operatorActions` served on the existing monitoring read.
- `packages/service/src/broadcast.ts` - the `shouldBroadcast` option, consulted first in the `signing-complete` handler so a skipped cohort emits no frame at all.
- `packages/service/tests/kill-switch.spec.ts` (new, 16 tests) - the predicate's four cases including the fail-closed one, the holder's one-way surface search, the route-registration search, the unchanged-mode assertion, the route semantics, and the three end-to-end handoff cases over a counting esplora stub with a zero confirmation timeout.
- `packages/service/tests/monitor.spec.ts` - the dismissal block (one record only, metrics, unknown id, still-live refusal, telemetry-only, self-recording) and the service-ring block (stamp, bound, dedupe, unwritable projection, per-cohort separation); the five committed `serviceHealth` shape pins migrated in the same change.
- `packages/service/tests/lifecycle-routes.spec.ts` - the dismiss-route rows of the semantics matrix plus the log-on-the-gated-read block; the shared harness's `onCancel` / `onFinalize` updated to mirror `index.ts`.
- `packages/web/src/lib/operator.ts` - `disableBroadcast` and `dismissEnded` clients on the shared `FetchResult` idiom, the additive `ServiceHealthDTO.broadcastDisabled`, and `monitoring.operatorActions`.
- `packages/web/src/lib/clock.ts` - `fmtWallClock` lifted here from `CohortDetail.tsx` so both operator logs share one timestamp format.
- `packages/web/src/stores/operator.ts` - the E9 / E10 / E13 copy set, the `operatorActions` / `broadcastBusy` / `broadcastError` / `dismissing` slice cleared in both `signOut` and `expireSession`, and the two non-optimistic actions.
- `packages/web/src/components/operator/ServiceControls.tsx` - `broadcastControlState` and `operatorLogState` (pure), the kill-switch button, its rung-3 `ConfirmPanel`, the post-engage replacement line, the action-error line, and the `Operator actions` log with its three states.
- `packages/web/src/components/operator/HealthStrip.tsx` - the exported `BROADCAST_OFF_CHIP` label and the warn chip rendered beside the untouched mode chip.
- `packages/web/src/components/operator/OperatorCohortList.tsx` - the `group` prop, the ghost `Dismiss` action on Ended rows only, and its rung-1 `ConfirmPanel`.
- `packages/web/src/components/operator/CohortDetail.tsx` - imports `fmtWallClock` from `lib/clock` instead of defining its own.
- `packages/web/tests/service-controls.spec.ts` (+12 tests) - the two new pure helpers and the exact-copy contract for the kill switch, the dismissal and the log, each with its long-dash guard.

## Decisions Made

- **The gate is at both handoffs, through one predicate.** Gating only the broadcast leg would have left a killed cohort blocking on a funding window; gating only the data leg would have left the broadcaster serializing a fixture tx. One rule, two call sites.
- **`shouldBroadcast` runs before serialization.** See above: reaching `rawBeaconTxHex` on a fixture tx would have reported a healthy cohort as failed.
- **The engage stamp never moves.** A second click must not slide the pivot forward.
- **Missing evidence means no broadcast.** The predicate returns false for an unstamped cohort once the switch is engaged.
- **Service-level entries are all `info`.** These are the operator's own deliberate acts; a warn or bad tone would have the log shout at them about decisions they just made. The DTO still carries `level`, so a future entry that genuinely warrants another tone needs no shape change.
- **A settings change is recorded by snapshot comparison, and values are never logged.** A save that changed nothing says nothing, and an operator-authored string can never widen a row.
- **`dismissEnded` records itself.** Placing the append inside the method rather than at its call sites means the one action that removes evidence can never be the one that goes unrecorded.
- **The chip label lives in `HealthStrip.tsx`.** Every other chip label on that strip is authored in that file, and the audit grep that proves the chip renders alongside the mode chip reads it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The broadcast gate needed a seam in `broadcast.ts`, which the plan's `files_modified` did not list**

- **Found during:** Task 1
- **Issue:** The plan says to consult the flag "at the point where a cohort's beacon-tx path is chosen (the `signing-complete` handoff into the broadcast machinery)". That handoff is a listener registered INSIDE `attachBeaconBroadcast`, and `createService` has no way to suppress it from the outside: the listener is subscribed at construction, long before any cohort exists. Without a seam there, a cohort standing down would still reach `rawBeaconTxHex(result.signedTx)`, which throws on a fixture tx's dummy prevout, emitting `beacon-broadcast-failed` and flipping the cohort's ended chip to `failed`.
- **Fix:** `AttachBeaconBroadcastOptions` gained one optional `shouldBroadcast?: (cohortId: string) => boolean`, consulted as the first statement of the handler. Absent, every cohort broadcasts and the pre-D-14 behavior is byte-identical. The decision and its log line stay in `index.ts`, which is where the plan puts them; the broadcaster only honors the gate.
- **Files modified:** packages/service/src/broadcast.ts
- **Verification:** `kill-switch.spec.ts` asserts a post-engage cohort produces zero sends and a pre-engage one produces exactly one, over a counting esplora stub. 05-CONTEXT names `packages/service/src/broadcast.ts` under "Key source files this phase reshapes" for exactly this ("broadcast-mode selection for the kill switch"), so this is the file the phase context expected to change.
- **Committed in:** `ff7dd08`

**2. [Rule 2 - Missing Critical] The tx-DATA path also had to take the fixture branch, not just the broadcast path**

- **Found during:** Task 1
- **Issue:** Gating only the broadcast leg satisfies "publishes nothing to Bitcoin" but not D-14's actual wording, which is that new cohorts "fall back to the fixture path". On a live service `onProvideTxData` builds a real beacon tx and, when a funding window is configured, WAITS for the operator to fund the cohort's beacon address. A cohort created after the kill switch would therefore have blocked for the whole funding window, then either failed for want of funding or built a real transaction that was silently discarded, and either way the operator would have had to fund an address for a cohort they had just told the service not to publish.
- **Fix:** `createService` keeps both builders on a live service and routes each cohort through the same `cohortUsesLivePath` predicate the broadcast gate uses, logging the reason. A service with no live config is untouched: the wrapper is not installed at all.
- **Files modified:** packages/service/src/index.ts
- **Verification:** `cohortKeepsLiveWiring` is exported and asserted over its four cases; the wrapper and the broadcast gate visibly call the one predicate. The must-have truth "new cohorts are created on the fixture path" is the reason this is not optional.
- **Committed in:** `ff7dd08`

**3. [Rule 3 - Blocking] The service-level operator-actions ring had to land in task 1, not task 2**

- **Found during:** Task 1
- **Issue:** The plan builds the ring in task 2, but task 1's own behavior list and acceptance criteria require "engaging the switch twice is idempotent and appends one operator-action entry, not two". A kill switch is not about any cohort, so there is no per-cohort ring that entry could live in; task 1 could not be verified without the service-level ring.
- **Fix:** Task 1 lands the minimum: the bounded ring, the arity-distinguished `noteOperatorAction` overload, `operatorActions()`, and the disable entry. Task 2 adds `dismissEnded` and the remaining entries (pause, resume, cancel, finalize, settings) plus the served key and the route.
- **Files modified:** packages/service/src/monitor.ts
- **Verification:** the task 1 idempotence test asserts exactly one entry after two disable calls; the task 2 specs cover the ring's bound, eviction, stamping and dedupe.
- **Committed in:** `ff7dd08` (ring), `c405fa8` (the rest)

**4. [Rule 1 - Bug] Pause, resume and settings entries belong in the adapter, not in `index.ts`**

- **Found during:** Task 2
- **Issue:** The plan wires every remaining operator-action entry "in `packages/service/src/index.ts`". For cancel and finalize that is right: `createOperatorCohorts` calls the `onCancel` / `onFinalize` hooks `index.ts` supplies. But pause, resume and the settings save have no such hook: the routes mutate the runtime holder directly, so `index.ts` never learns they happened. Wiring them there would have required inventing a second callback layer for no gain, and the entries would have been unreachable in the meantime.
- **Fix:** The three route-level entries are recorded in `hono-adapter.ts`, at the seam where the action actually occurs, each guarded so it fires only on a real transition. Cancel and finalize stay in `index.ts` on the existing hooks, exactly as the plan says.
- **Files modified:** packages/service/src/hono-adapter.ts, packages/service/src/index.ts
- **Verification:** `lifecycle-routes.spec.ts` drives all four verbs plus a settings save through the real gated routes and asserts the exact entry sequence.
- **Committed in:** `c405fa8`

**5. [Rule 1 - Bug] Two copies of the wall-clock timestamp formatter would have drifted on one screen**

- **Found during:** Task 3
- **Issue:** The `Operator actions` log needs the same server wall-clock `formatTime` the per-cohort activity ring uses, but that formatter was a private function inside `CohortDetail.tsx`. Copying it would have put two definitions of one timestamp format in a console that can show both logs in one session.
- **Fix:** `fmtWallClock` moved into `lib/clock.ts` beside `fmtElapsed`; `CohortDetail.tsx` imports it, and the behavior is byte-identical.
- **Files modified:** packages/web/src/lib/clock.ts, packages/web/src/components/operator/CohortDetail.tsx, packages/web/src/components/operator/ServiceControls.tsx
- **Verification:** `pnpm --filter @btcr2-aggregation/web build` and the full unit suite green.
- **Committed in:** `f027307`

---

**Total deviations:** 5 auto-fixed (2 bugs, 1 missing critical, 2 blocking)
**Impact on plan:** All five serve the plan's stated truths more faithfully than the literal instruction would have. One file outside the plan's `files_modified` list changed (`packages/service/src/broadcast.ts`), which 05-CONTEXT already names as a file this phase reshapes for this exact reason. No interface a later plan references departed from the plan.

## Issues Encountered

- **The acceptance criterion `grep -c 'EventSource' packages/service/src` returns 1, not 0.** The single hit is a pre-existing COMMENT in `packages/service/src/operator-auth.ts` (added by 04-02, commit `a6b656b`) recording why the retired `/dashboard/events` feed shaped the cookie-session decision. No code anywhere in the service constructs or references an `EventSource`, and this plan added no stream: the operator actions log rides the existing gated poll. The criterion's intent (no new SSE channel) holds; the literal grep does not, because a historical rationale comment in a file this plan does not touch names the retired API. It was left in place deliberately rather than deleted to make a grep pass, since removing it would erase the ADR 0016 rationale.
- **No unit test covers the rendered composition of the new surfaces**, only their pure halves plus the copy contract. Whether the kill-switch ceremony reads as grave enough, whether the log sits comfortably at the bottom of the controls card, and whether two warn chips beside the mode chip crowd the strip belong to the phase's console walkthrough at the end-of-phase gate. This is the same gap 05-06 and 05-07 recorded.
- **The mixed-mode display carried from the UI-SPEC is untested by construction.** After the switch engages, the console can show a still-broadcasting cohort beside a `Broadcast off (this session)` chip. The plan carries the research position as a stated assumption (the per-cohort drill-down's own anchor and mode disclosure explains it in context) and builds no dedicated badge. Revisit only if an operator reads it as a bug.

## Known Stubs

None. Every control on these surfaces is wired end to end: `Disable broadcast` reaches the live gated route and a real one-way in-memory mutation that really does change which beacon-tx path a new cohort takes; the `Broadcast off (this session)` chip renders a served bit; `Dismiss` reaches a real delete that really removes a record; and the `Operator actions` log renders entries a real server ring produced from real operator verbs. The one entry string this plan does not emit, `Added {n} test peers to cohort {shortId}.`, is deliberately absent rather than stubbed: 05-09 owns the action that would produce it, and no control or placeholder for it renders here.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/service/tests/kill-switch.spec.ts packages/service/tests/live-boot.spec.ts` (task 1 gate) | 26 tests pass |
| `pnpm vitest run packages/service/tests/monitor.spec.ts packages/service/tests/lifecycle-routes.spec.ts` (task 2 gate) | 99 tests pass |
| `pnpm test` (full suite, `tsc -b` gated) | 51 files, 803 tests pass |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | clean |
| `pnpm --filter @btcr2-aggregation/web build` | clean |
| `pnpm e2e:live:mock` | pass (live beacon-tx build, broadcast wiring, funding wait, directory-row guard) |
| `pnpm e2e:operator` | pass (full extended suite: auth, expiry, monitoring, cancel, pause legs) |
| `pnpm e2e:monitor` | pass (gated detail read reflected members + submissions, settled anchored) |
| `pnpm e2e:fallback:operator` | pass (operator-driven k-of-n fallback through the gated route) |
| `grep -rn 'broadcast/enable' packages/` | no matches |
| `grep -rlP '\x{2014}' packages/service/src packages/web/src` | no files |
| `grep -rn 'Broadcast off' packages/web/src/components/operator/HealthStrip.tsx` | 1 match (the exported chip label); the mode chip render is byte-unchanged |
| `grep -rniE 'enableBroadcast\|broadcast/enable\|resumeBroadcast' packages/web/src` | 1 match, a docstring recording that no such client exists and never will |
| `grep -c 'EventSource' packages/service/src` (recursive) | 1, a pre-existing 04-02 comment; see Issues Encountered |

## User Setup Required

None. No new environment variable and no new boot requirement. Both new routes mount only inside the authenticated console, which exists only on a service booted with `OPERATOR_PASSWORD`, and the `Disable broadcast` control renders only on a service whose served mode is the live broadcasting one (`LIVE=1 BROADCAST=1`). A service booted without those behaves exactly as it did before. Re-enabling broadcast after engaging the switch requires a restart with `BROADCAST=1`, which the console states in those words.

## Next Phase Readiness

- **05-09's test-peer entry has its seam already.** `monitor.noteOperatorAction(text)` (the one-argument, service-level form) and the per-cohort two-argument form are both in place; 05-09 adds `Added {n} test peers to cohort {shortId}.` beside the existing strings in `monitor.ts` and calls the same seam. The log's console rendering needs no change.
- **`ServiceHealthDTO` is the shape any further service-level bit extends.** A new bit needs a field on the server DTO, an optional field on the web mirror, and a chip in `HealthStrip.tsx`; the polled read, the store and the freshness posture need no change. The rule the two existing bits establish: a state change beside a construction-fixed value becomes a SECOND bit and a SECOND chip, never a rewrite of the first.
- **Three of the four items parked to this phase are closed.** The broadcast-only kill switch (was 04 D-35), ended-record dismissal (was 04 D-14), and the service-level operator actions log those two needed. The fourth absorption, badged test peers (D-17), is 05-09.
- **Carried assumption, unresolved by design (UI-SPEC E9).** After the switch engages the console can show a broadcasting cohort and a broadcast-off chip at once. No dedicated "started before broadcast was disabled" badge was built; the drill-down's own anchor and mode disclosure is assumed sufficient. Revisit only if an operator reads it as a bug.
- **Carried concern, unchanged from 05-02 through 05-07:** a settled cohort still cannot be re-opened from the operator list. This plan did not touch that; it adds only the ability to remove a settled cohort's record from view.

## Self-Check: PASSED

- Created file verified present on disk: `packages/service/tests/kill-switch.spec.ts`.
- Commits verified in git history: `90da00e`, `ff7dd08`, `9807f05`, `c405fa8`, `f027307`.
- Every task acceptance criterion re-run in this session, and the plan-level `<verification>` block re-run in full and green (all three named e2e legs plus `e2e:fallback:operator`), with the one criterion that did not hold literally recorded honestly under Issues Encountered.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*




