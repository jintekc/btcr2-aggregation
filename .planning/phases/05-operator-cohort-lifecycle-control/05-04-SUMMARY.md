---
phase: 05-operator-cohort-lifecycle-control
plan: 04
subsystem: api
tags: [aggregation, cohort-lifecycle, operator-console, runtime-settings, drain-mode, hono, vitest, e2e]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 01)
    provides: the gated operator route block and the cohort intent registry the pause gate sits beside
  - phase: 05-operator-cohort-lifecycle-control (plan 03)
    provides: the app-authored 409 refusal idiom (NOT_SIGNING_REASON) this plan's paused refusal copies, and the lifecycle-route auth posture
  - phase: 04-operator-monitoring-and-live-path
    provides: the polled ServiceHealthDTO strip the paused chip rides, the SERVICE_NAME boot carrier this plan makes runtime-editable, and the numericKnob NaN guard (WR-04) this plan promotes to a shared module
  - phase: 01 (operator auth)
    provides: requireSameOrigin + requireOperator, the prefix guards the pause and resume routes inherit
provides:
  - createRuntimeSettings, the per-service env-seeds / runtime-overrides holder with SettingField source tracking and all-or-nothing applySettings, deliberately non-persistent
  - numericKnob promoted out of demo-server.ts into runtime-settings.ts so one NaN guard serves both seeding paths
  - a two-call-site advertising pause gate with a discriminated paused refusal mapped to 409
  - gated POST /v1/operator/advertising/pause and /resume, idempotent, 401 anonymously
  - an additive paused bit on ServiceStatusDTO and ServiceHealthDTO, with every committed pin of both shapes migrated in the same change
  - GET /v1/config serving the service name from the holder PER REQUEST rather than a boot-time closure constant
affects: [05-05 ended dismissal, 05-07 settings surface, 05-08 broadcast kill switch, 05-09 participation terms, 05-11 test peers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Env-seeds / runtime-overrides: the environment seeds the boot value, the console edits the in-memory value, a restart returns every value to its environment default, and each field reports which of the two you are looking at"
    - "A gate is complete because its call sites are countable: pause is checked at exactly the two runner.advertiseCohort callers, and the grep that proves there are only two is an acceptance criterion"
    - "One derivation, two consumers: the public claim (GET /v1/status paused) and the enforced behavior (the advertise gate) read the SAME holder value, so they cannot drift"
    - "Save-as-a-set: applySettings validates every supplied field before touching any, so a settings surface can never render a half-saved state"
    - "A widened public DTO migrates every committed pin in ONE change, and the pin list is re-derived by a repo-wide grep rather than trusted from the plan"

key-files:
  created:
    - packages/service/src/runtime-settings.ts
    - packages/service/tests/runtime-settings.spec.ts
    - packages/service/tests/pause.spec.ts
  modified:
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/src/monitor.ts
    - packages/service/src/index.ts
    - packages/service/src/demo-server.ts
    - packages/service/src/config.spec.ts
    - packages/service/src/operator-cohorts.spec.ts
    - packages/service/tests/monitor.spec.ts
    - packages/web/src/lib/operator.ts
    - packages/web/tests/operator.spec.ts
    - e2e/operator-cohort.ts

key-decisions:
  - "The runtime settings holder declares its FULL field set now (paused, broadcastDisabled, serviceName, the four create-form defaults, termsText) even though only the paused mutation path is wired this phase, so later plans extend consumers rather than the contract"
  - "There is deliberately NO persistence method of any kind, and the absence is pinned by a spec: durable state across a restart is DUR-01 (v2), and quietly adding a write path would change the product's stated state model without anyone deciding to"
  - "numericKnob MOVED from demo-server.ts into runtime-settings.ts rather than being copied: a guard that exists twice is a guard that can be fixed once and left broken in the other place"
  - "changed is DERIVED per read (value !== envDefault), never tracked as a flag, so an operator who edits a field and sets it back gets the honest env default caption again"
  - "The paused refusal is a discriminated verdict mapped to 409, never a silent no-op and never a false 200: the operator must be able to tell I am draining from that draft is gone"
  - "paused is NOT folded into ServiceMode: the mode is fixed at construction and describes how a service signs and broadcasts, where pause describes whether it is offering new cohorts, a different question with a different lifetime"
  - "The paused signal rides ServiceStatusDTO only; DirectoryCohortDTO stays byte-frozen, so a participant's cohort rows are identical paused or running"

patterns-established:
  - "RESEARCH Pattern 4 (gate placement): the pause check lives at the two advertise call sites and nowhere else, and the spec asserts the narrowness with an explicit negative-surface block rather than assuming it"
  - "RESEARCH Pattern 5 (SettingField): value + envDefault + derived changed, read once at createDraft, saved as a set"
  - "RESEARCH Pitfall 6 closed: the six-site pin list for a widened status shape was re-derived by grep and every site migrated in one commit"

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "The operator can pause advertising so new cohorts stop being offered, without killing the running service: cohorts already advertised keep filling and every other surface keeps working"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#leaves a cohort advertised BEFORE the pause open, listed, counted, and joinable"
        status: pass
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#keeps createDraft, discardDraft, the operator list, and the gated monitoring read working"
        status: pass
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#keeps cancel and finalize working on a cohort advertised before the pause"
        status: pass
    human_judgment: false
  - id: D2
    description: "The pause flag is checked at exactly the two runner.advertiseCohort call sites and nowhere else, so the gate is provably complete and provably narrow"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#is the ONLY gate: exactly two runner.advertiseCohort call sites exist to guard"
        status: pass
      - kind: other
        ref: "grep -rn 'runner.advertiseCohort' packages/service/src shows two call sites, both guarded"
        status: pass
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#keeps the public reads answering, and the directory DTO byte-frozen"
        status: pass
    human_judgment: false
  - id: D3
    description: "A paused advertise attempt is refused with a specific reason (409) rather than silently succeeding or silently doing nothing, and the draft or expired record survives the refusal"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#refuses advertiseDraft with a paused verdict, leaving the draft a draft"
        status: pass
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#refuses readvertiseExpired the same way, leaving the expired record expired"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /v1/status carries a paused bit derived from the SAME holder value the gate reads, so a headless client can tell a paused service from an idle one and the public claim can never drift from the enforced behavior"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#reports paused on GET /v1/status while paused and false after resume"
        status: pass
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#makes the advertise refusal and the public bit agree, in one round trip"
        status: pass
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#feeds the operator health strip from the SAME holder the gate reads"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every committed pin of the ServiceStatusDTO shape is migrated in the same change as the additive paused field, including the no-operator-surface fallback literal"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#carries the paused bit on the ServiceStatusDTO key set (migrated pin)"
        status: pass
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#answers the no-operator-surface status fallback with the paused bit too"
        status: pass
      - kind: unit
        ref: "packages/service/tests/monitor.spec.ts (key-set pin migrated) + packages/service/src/operator-cohorts.spec.ts (full-equality pin migrated)"
        status: pass
    human_judgment: false
  - id: D6
    description: "POST /v1/operator/advertising/pause and /resume are gated (401 anonymously), idempotent in both directions, and return the resulting state"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#401s an anonymous caller for both routes"
        status: pass
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#pauses and resumes for an operator session, returning the resulting state"
        status: pass
      - kind: unit
        ref: "packages/service/tests/pause.spec.ts#is idempotent in both directions"
        status: pass
    human_judgment: false
  - id: D7
    description: "Runtime settings follow env-seeds / runtime-overrides with honest per-field source tracking, and a malformed numeric seed falls back to the built-in default with one warning rather than becoming NaN"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#falls back to the built-in default and warns ONCE on a non-numeric seed"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#falls back on a seed below the minimum and never yields a NaN on ANY field"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#reports an overridden field as changed and STILL carries its original env value"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#reports a field set BACK to its env value as the environment default again"
        status: pass
    human_judgment: false
  - id: D8
    description: "applySettings is all-or-nothing: one invalid field returns the first user-facing message and leaves every other field at its previous value"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#applies NO field when any supplied field is invalid, and returns the first message"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#refuses a threshold above the size supplied in the SAME patch"
        status: pass
    human_judgment: false
  - id: D9
    description: "Runtime settings are per-service closure state with no persistence path of any kind, so two services in one process never share them and the honest restart copy stays true"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#keeps two holders in one process independent (never a module singleton)"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#exposes NO persistence: the module never touches the filesystem or a store"
        status: pass
    human_judgment: false
  - id: D10
    description: "The service name is served from the runtime holder per request rather than a boot-time closure constant, and the GET /v1/config response stays additive with every network field byte-identical"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/src/config.spec.ts#serves the service name from the runtime holder PER REQUEST, network fields frozen (D-16)"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#stays byte-identical (no serviceName key) when the name is cleared at runtime"
        status: pass
    human_judgment: false
  - id: D11
    description: "No regression in the shipped operator, monitoring, cancel, and browse capstones against a real service with the widened status shape"
    requirement: SVC-04
    verification:
      - kind: e2e
        ref: "pnpm e2e:operator"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:monitor"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:cancel"
        status: pass
      - kind: e2e
        ref: "pnpm e2e:browse"
        status: pass
    human_judgment: false

# Metrics
duration: 12 min (execution) across two sessions
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 04: Runtime Settings and Advertising Drain Mode Summary

**An operator can drain advertising at runtime without killing anything else: the flag is checked at exactly the two `runner.advertiseCohort` call sites (a gate that is complete because its call sites are countable), a paused advertise is a 409 with app-authored copy rather than a silent no-op, and the public `GET /v1/status` paused bit is the SAME read the gate enforces, so the claim and the behavior cannot drift; underneath it sits `createRuntimeSettings`, the per-service, env-seeded, source-tracked, deliberately non-persistent holder every later Phase 5 control builds on.**

## Performance

- **Duration:** 12 min of execution, split across two sessions (a prior executor agent died mid-plan to a transient API stream timeout after committing all four task commits; this session verified that work, closed one mirror gap, and ran the full verification block)
- **Started:** 2026-07-28T23:37:16Z
- **Completed:** 2026-07-29T13:55:00Z
- **Tasks:** 2 (both TDD: RED then GREEN)
- **Files modified:** 14 (3 created, 11 modified)

## Accomplishments

- **`packages/service/src/runtime-settings.ts`: the env-seeds / runtime-overrides holder.** A per-`createRuntimeSettings` closure factory (never a module singleton, mirroring `anchor-state.ts` and `createOperatorCohorts`), because a singleton here would let one service's pause silently drain another's advertising in a process running two. Every field carries both its current value and the value it booted with, and `changed` is DERIVED per read rather than tracked, so an operator who edits a field and then sets it back gets the honest `env default` caption again instead of a permanent "changed this session" claim about a value that is no longer changed.
- **The full field set is declared now, wired incrementally.** `paused`, `broadcastDisabled` (one-way, false on every boot per ADR 0010), `serviceName`, the four create-form defaults, and `termsText` all exist on the contract today; only the `paused` mutation path is wired this plan. Later plans extend consumers rather than the interface, which is what keeps 05-07 (settings surface), 05-08 (broadcast kill switch), and 05-09 (participation terms) additive.
- **No persistence, and the absence is pinned at the source.** There is no write path to the filesystem or the artifact store, and `runtime-settings.spec.ts` asserts the module imports neither. Durable state across a restart is DUR-01, a v2 requirement. The console's honest restart copy (`A restart returns this service to its boot environment.`) is only true while this stays true, so the spec guards the sentence, not just the code.
- **`applySettings` saves as a SET.** It validates every supplied field before touching any, and applies none if any is invalid, returning the first user-facing message in the order the console renders the fields. `k` is validated against the `n` supplied in the SAME patch, never the stored one, so a save that shrinks n and raises k at once is judged as the operator wrote it rather than against a value the save is about to replace. A surface that can half-save is a surface whose displayed state can lie.
- **`numericKnob` moved (not copied) into the holder's module.** The WR-04 NaN guard lived in `demo-server.ts`; the holder now seeds its own numeric fields from the environment too, so both callers share one implementation. A guard that exists twice is a guard that can be fixed once and left broken in the other place. `demo-server.ts` imports it back, byte-identical in behavior.
- **The pause gate at exactly two call sites.** `advertiseDraft` and `readvertiseExpired` are the only `runner.advertiseCohort` callers in the whole app (the boot-time auto-advertise loop was deleted in Phase 1), which is precisely what makes a two-line check a complete gate: there is no third path by which a new cohort can come into existence. Both now return a discriminated paused verdict, so the route maps it to `409 ADVERTISING_PAUSED_REASON` rather than a silent no-op or a false 200. The operator must be able to tell "I am draining" from "that draft is gone".
- **The narrowness is asserted, not assumed.** `pause.spec.ts` carries an explicit negative-surface block: while paused, `createDraft`, `discardDraft`, `cancel`, `finalize`, the operator list, the gated monitoring read, the public directory, and the public status all behave exactly as on a running service, and a cohort advertised BEFORE the pause stays in the directory, stays in the joinable `Advertised` tier, and stays counted by `status().openCohorts`. Finalize refuses on its OWN grounds (not signing) rather than with the paused reason, proving the gate does not leak into a verb it does not govern. Pause is drain mode; full quiesce is pause plus a cancel each.
- **One derivation, three consumers.** `status().paused`, `serviceHealth().paused`, and the advertise gate all read the same holder value live (the health strip reads it through, never mirroring it into monitor state, because a second copy is a second thing that can go stale). `pause.spec.ts` proves the round trip in a single test: one pause, and both the public claim and the enforced refusal change together.
- **Gated `POST /v1/operator/advertising/pause` and `/resume`.** They mount inside the operator block after `requireSameOrigin` + `requireOperator`, so an anonymous caller is rejected 401 before either handler runs (T-05-04-01). Both take no body and are idempotent: the operator is asking for an END STATE, not toggling one, so a double-click or a retried request lands in the same place. Each returns the resulting state, so the console renders what the SERVICE reports rather than what the browser assumed. They mount on the runtime holder rather than the cohort surface because the flag is a service-level fact that must outlive any individual cohort.
- **Every committed pin of the widened status shape migrated in one change.** The pin list was re-derived by a repo-wide `openCohorts` grep rather than trusted from the plan: the `ServiceStatusDTO` interface and its single construction site, the no-operator-surface fallback literal in `hono-adapter.ts`, the key-set pin in `monitor.spec.ts`, the full-equality pin in `operator-cohorts.spec.ts`, the `ServiceStatus` client type in `packages/web/src/lib/operator.ts`, and the local harness interface in `e2e/operator-cohort.ts`. `DirectoryCohortDTO` stays byte-frozen: the paused signal rides `ServiceStatusDTO` only, so a participant's cohort rows are identical paused or running.
- **`GET /v1/config` reads the service name per request.** Phase 4 threaded `SERVICE_NAME` as a boot constant captured into the app's construction closure; Phase 5 makes the name runtime-editable, and a captured constant would have served the boot name forever while the console claimed the rename applied. The response stays additive exactly as shipped: the key appears only when set, disappears entirely when cleared at runtime, and every network field is byte-identical. Callers that wire no holder (the headless path, the older specs) keep the pre-Phase-5 behavior unchanged.

## Task Commits

Each task was committed atomically (task 1 and task 2 are both TDD, so each has a RED then a GREEN commit):

1. **Task 1 (RED): failing spec for the runtime settings holder** - `e6160b4` (test)
2. **Task 1 (GREEN): env-seeded runtime settings holder and a per-request service name** - `37bf47f` (feat)
3. **Task 2 (RED): failing spec for advertising drain mode** - `31ce875` (test)
4. **Task 2 (GREEN): advertising drain mode gated at the two advertise call sites** - `1ed163b` (feat)
5. **Task 2 (continuation): mirror the paused health bit into the operator client type** - `0e6f910` (feat)

## Files Created/Modified

- `packages/service/src/runtime-settings.ts` (new, 399 lines) - `SettingField`, `RuntimeSettingsSeed`, `SettingsPatch`, `RuntimeSettings`, `createRuntimeSettings`, and the relocated `numericKnob`. The docstring states the three load-bearing properties (per-service closure, NaN-guarded seeds, save-as-a-set) and records that persistence is deliberately absent.
- `packages/service/tests/runtime-settings.spec.ts` (new, 24 tests) - NaN-guarded seeding, source tracking including the set-back-to-env case, all-or-nothing `applySettings`, per-service isolation, the pinned absence of persistence, and the per-request `GET /v1/config` name.
- `packages/service/tests/pause.spec.ts` (new, 16 tests) - the two-call-site gate, the explicit negative-surface block, the one-derivation proof, the migrated key-set pins, and the route matrix (401 / 200 / idempotent).
- `packages/service/src/operator-cohorts.ts` - `ADVERTISING_PAUSED_REASON`, `isAdvertisePaused`, the paused verdict on both advertise verbs, `paused` on `ServiceStatusDTO` populated at the single `status()` construction site, and the module docstring extended to record why counting the call sites is what makes the gate complete. `SIZE_ERROR` / `THRESHOLD_ERROR` exported so the settings form reuses the create-form copy.
- `packages/service/src/hono-adapter.ts` - the `runtimeSettings` option, the gated pause and resume routes, the 409 mapping on both advertise routes, the per-request `/v1/config` name, and the migrated no-operator-surface status literal.
- `packages/service/src/monitor.ts` - `paused` on `ServiceHealthDTO`, read live from the holder in `serviceHealth()` and deliberately kept out of `ServiceMode` (fixed at construction, a different question with a different lifetime).
- `packages/service/src/index.ts` - the holder constructed in the `createService` closure from the existing options, exposed on the service handle for tests, and threaded into `createHonoApp`, `createOperatorCohorts`, and `createCohortMonitor`.
- `packages/service/src/demo-server.ts` - `numericKnob` removed in favour of the shared import; no env var renamed, no boot banner changed.
- `packages/service/src/config.spec.ts` - the per-request name assertion beside the frozen network-field pin, which still passes byte-identical.
- `packages/service/src/operator-cohorts.spec.ts`, `packages/service/tests/monitor.spec.ts` - migrated status pins.
- `packages/web/src/lib/operator.ts` - `paused` on the `ServiceStatus` client type and on the `ServiceHealthDTO` mirror.
- `packages/web/tests/operator.spec.ts` - the two health fixtures carry the new field.
- `e2e/operator-cohort.ts` - the local harness status interface carries `paused`.

## Decisions Made

- **The full field set is declared now; only the paused path is wired.** Declaring `broadcastDisabled` and `termsText` today costs nothing and means 05-08 and 05-09 add consumers rather than reopening the contract every plan.
- **`changed` is derived, never tracked.** A tracked flag would keep claiming "changed this session" after the operator restored the boot value, which is a small lie the console would then print under every field.
- **`numericKnob` moved rather than being duplicated.** Two copies of a NaN guard is a guard with a half-life.
- **The paused refusal is a discriminated verdict, not an exception and not `undefined`.** `undefined` already means "unknown draft" on both advertise routes; reusing it would have made a drain look like a lost draft.
- **`paused` is not part of `ServiceMode`.** The mode is fixed at construction and answers "how does this service sign and broadcast"; pause answers "is it offering new cohorts". Folding them would have made a paused hermetic service indistinguishable from a mode change.
- **The health bit is read through, never mirrored into monitor state.** The whole point of the bit is that the console chip and the advertise gate agree; a cached copy is a second thing that can go stale.
- **`DirectoryCohortDTO` stays byte-frozen.** A participant does not need a per-cohort paused flag: the cohorts they can see are, by construction, the ones already advertised, which pause does not touch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] The `paused` health bit had no typed consumer in the browser mirror**
- **Found during:** Task 2 (continuation session)
- **Issue:** The plan's stated purpose for the `ServiceHealthDTO.paused` bit is "so the console health strip can render its chip from the same read it already polls". The server side landed, but `packages/web/src/lib/operator.ts` carries a hand-written mirror of `ServiceHealthDTO` (`mode`, `esploraReachable`) that did not declare the new field, so the service was serving a key with zero declared consumers. That is the same drift the plan's own pin-migration discipline exists to prevent: a server field and a client mirror that disagree about the shape.
- **Fix:** Added `paused: boolean` to the web `ServiceHealthDTO` mirror with a doc comment recording the single-derivation rationale and why it is separate from `ServiceMode`, and updated the two health fixtures in `packages/web/tests/operator.spec.ts`. Deliberately NO rendering change: the plan does not list `HealthStrip.tsx` in `files_modified`, and the chip itself belongs to the settings surface plan. This is the mirror only.
- **Files modified:** packages/web/src/lib/operator.ts, packages/web/tests/operator.spec.ts
- **Verification:** `pnpm vitest run packages/web/tests/operator.spec.ts` (13 tests pass), `pnpm typecheck` green, web build green.
- **Committed in:** `0e6f910`

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Additive type-only completion of a mirror the plan already lists in `files_modified`. No behavior change, no scope creep, and no interface any later plan depends on was altered.

## Issues Encountered

- **The first executor agent died mid-plan to a transient API stream idle timeout.** It had already committed all four task commits (`e6160b4`, `37bf47f`, `31ce875`, `1ed163b`) and left the working tree clean, but produced no SUMMARY.md and no STATE/ROADMAP update, leaving the plan in the illegal partial-plan state the atomic close-out invariant describes. This session verified the four commits against the plan's tasks (`git show --stat` mapped every declared `files_modified` entry to a real change), re-ran every acceptance criterion and the full plan verification block from scratch rather than trusting the dead agent's unreported results, closed the one gap found (the deviation above), and completed the close-out. No committed work was redone or reverted.

## Known Stubs

None. Every surface added here is wired end to end. The one field with no runtime consumer yet is `broadcastDisabled`, which is deliberately a declared-contract placeholder rather than a stub: it is documented in the interface as owned by plan 05-08, it is pinned to `false` by a spec (`defaults broadcastDisabled to false (the boot contract, ADR 0010)`), it is not rendered anywhere, and nothing reads it to make a decision. The same is true of the create-form default fields and `termsText`: they are seeded, source-tracked and validated today, and their console surface arrives in 05-07 / 05-09. No UI claims a capability that is not behind it.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/service/tests/pause.spec.ts packages/service/tests/runtime-settings.spec.ts` | pass (part of the full suite below) |
| `pnpm test` (full suite, `tsc -b` gated) | 45 files, 634 tests pass |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm --filter @btcr2-aggregation/web build` | clean |
| `pnpm e2e:operator` | pass (no regression; login, create, advertise, expiry, monitoring, cancel legs) |
| `pnpm e2e:monitor` | pass (no regression) |
| `pnpm e2e:cancel` | pass (no regression) |
| `pnpm e2e:browse` | pass (no regression) |
| `grep -rn 'runner.advertiseCohort' packages/service/src` | exactly two call sites, both guarded |
| `grep -rn 'openCohorts' packages/ e2e/ --include=*.ts` | every source/pin site carries or asserts `paused`; no pin still asserts the three-key shape |
| `grep -nE 'node:fs\|node:path\|store' packages/service/src/runtime-settings.ts` | no persistence imports |
| `grep -rlP '\x{2014}'` over service, shared, web, e2e | no files |

## User Setup Required

None - no external service configuration required. The pause and resume routes mount inside the existing operator block, so they appear only on a service booted with `OPERATOR_PASSWORD` (fail-closed, unchanged). No environment variable was added or renamed: the holder seeds from the options `createService` already receives.

## Next Phase Readiness

- `createRuntimeSettings` is the holder every remaining Phase 5 control reads. Its contract is complete, so 05-07 (settings surface), 05-08 (broadcast kill switch) and 05-09 (participation terms) each add a consumer and a mutation path rather than reopening the interface.
- The console cannot yet pause: the routes, the flag, the public bit and the health bit all exist and are proven, but there is no button. That is by design (the settings surface is 05-07) and is why this plan's coverage carries no `human_judgment` entries: everything it ships is server-side and fully pinned.
- `packages/service/tests/pause.spec.ts` establishes the negative-surface block as the idiom for any later flag that gates a narrow behavior: assert what the flag does NOT touch, because a flag that quietly took the public directory down with it would look identical from the gated side.
- Carried concern, unchanged from 05-03: a settled cohort (expired, canceled, finalized-then-anchored) still cannot be re-opened from the operator list. 05-05 remains the natural home.

## Self-Check: PASSED

- Created files verified present on disk: `packages/service/src/runtime-settings.ts`, `packages/service/tests/runtime-settings.spec.ts`, `packages/service/tests/pause.spec.ts`.
- Commits verified in git history: `e6160b4`, `37bf47f`, `31ce875`, `1ed163b`, `0e6f910`.
- Every task acceptance criterion re-run in this session and passing; the plan-level `<verification>` block re-run in full and green.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*
