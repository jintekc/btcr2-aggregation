---
phase: 05-operator-cohort-lifecycle-control
plan: 33
subsystem: api
tags: [hono, body-limit, runtime-settings, operator-console, utf-8, json]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the per-service runtime settings holder (05-04/05-07), its two free-text seed bounds (05-31), and the gated PUT /v1/operator/settings route"
provides:
  - "SETTINGS_BODY_LIMIT_BYTES, an exported constant derived from MAX_TERMS_CHARS, consumed by the gated settings route so the FIELD cap answers an over-long terms document"
  - "MAX_TERMS_CHARS exported, superseding the round-4 scope fence, so the route and both specs state one number rather than three"
  - "a measured derivation property over five encoding classes at the cap, including an anti-vacuity row against the smaller multiplier the review suggested"
  - "GET /v1/config's service display name with exactly one source (the holder), the unbounded static option deleted"
  - "the retained last-write whole-minute guard pinned as a no-op across HOSTILE_SEEDS"
  - "docs/DEPLOY.md describing the console save path an operator actually uses"
affects: [05-34, 05-35, phase-06]

actuals:
  tokens: 21000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A limit that governs a field belongs to that field, derived once, at the place the field is defined; any other layer bounding the same thing derives its number from that one"
    - "When two layers bound the same value, the test that matters sends the LARGEST legal value through BOTH"
    - "A derivation is pinned by MEASURING what the field can carry, never by restating the arithmetic from the same constants"

key-files:
  created: []
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/src/index.ts
    - packages/service/src/config.spec.ts
    - packages/service/tests/lifecycle-routes.spec.ts
    - packages/service/tests/runtime-settings.spec.ts
    - docs/DEPLOY.md

key-decisions:
  - "The settings route's byte budget is DERIVED from MAX_TERMS_CHARS at six bytes per UTF-16 code unit (the worst case, a control character emitted as a six-character backslash-u escape) plus 4096 bytes of headroom, giving 124096 bytes. The review's suggested MAX_TERMS_CHARS * 2 + 4096 was deliberately NOT taken: measured at the cap, a three-byte-per-character script makes a 60184 byte body and would still have been refused, leaving the identical gap open for any operator writing terms in their own language."
  - "MAX_TERMS_CHARS is exported and MAX_SERVICE_NAME_CHARS is not: the route must derive from the terms cap, while nothing outside the module needs the name cap, so the round-4 reasoning still holds for it."
  - "The static serviceName option is DELETED rather than documented (review IN-03). A bound that holds only because another code path always happens to run first is a bound a refactor can drop without failing anything."
  - "The IN-04 pin asserts on boot OUTPUT, not on the internal call: the retained guard is silent by construction on every reachable path, so a second whole-minute warning about that one field is the only observable a future second writer could produce."
  - "docs/DEPLOY.md names no byte figure. The route's budget is derived from a character cap already documented, an operator cannot set it, and naming it would put a fourth number in front of a reader when the whole point of the round is that there is one."

patterns-established:
  - "Derived-not-chosen limits: a cross-layer bound states its derivation in the source as a checkable proof (the per-class byte table), with the measured numbers behind each claim recorded"
  - "Anti-vacuity control on a derivation: a row proving the rejected alternative would have FAILED a real class, so the property cannot pass against a weaker constant"

requirements-completed: [SVC-04]

coverage:
  - id: D1
    description: "A full console-shaped settings save carrying a terms document at the stored 20000 character ceiling reaches applySettings instead of being refused 413 by the route's own byte budget (SC3 / Gap 1, review CR-02)"
    requirement: SVC-04
    verification:
      - kind: integration
        ref: "packages/service/tests/lifecycle-routes.spec.ts#accepts a FULL console save carrying a terms document at the stored ceiling (SC3, review CR-02)"
        status: pass
      - kind: integration
        ref: "packages/service/tests/lifecycle-routes.spec.ts#renames the service while a ceiling-length terms document is already stored"
        status: pass
    human_judgment: false
  - id: D2
    description: "The derivation is proven against what the field can actually carry: a terms document at the cap in a three-byte-per-character script is accepted exactly as an ASCII one is"
    requirement: SVC-04
    verification:
      - kind: integration
        ref: "packages/service/tests/lifecycle-routes.spec.ts#accepts the same save with the terms written in a three-byte-per-character script"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#the settings body budget bounds every encoding a terms document at the cap can have (6 rows)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The route still refuses an oversized body during streaming, before it is buffered: the bound moved, it was not removed"
    requirement: SVC-04
    verification:
      - kind: integration
        ref: "packages/service/tests/lifecycle-routes.spec.ts#413s a body over the derived settings limit before it is parsed"
        status: pass
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#stays inside the range this service already accepts on its other routes"
        status: pass
    human_judgment: false
  - id: D4
    description: "applySettings's own terms refusal sentence, naming the field and the limit, is reachable over HTTP instead of `request too large`"
    requirement: SVC-04
    verification:
      - kind: integration
        ref: "packages/service/tests/lifecycle-routes.spec.ts#makes the holder's own terms refusal reachable over HTTP, naming the limit"
        status: pass
    human_judgment: false
  - id: D5
    description: "The service display name has exactly one path to GET /v1/config; the unbounded static option is gone and cannot be reintroduced silently (review IN-03)"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/src/config.spec.ts#includes the optional serviceName ADDITIVELY when SERVICE_NAME is set (D-51)"
        status: pass
      - kind: other
        ref: "pnpm typecheck against a reintroduced static name path (TS2353, recorded below)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The retained last-write whole-minute guard is pinned as a no-op across the hostile-seed table, so a future second writer that makes it fire is a visible change (review IN-04)"
    requirement: SVC-04
    verification:
      - kind: unit
        ref: "packages/service/tests/runtime-settings.spec.ts#keeps the retained last-write whole-minute guard a NO-OP across the whole table (review IN-04)"
        status: pass
    human_judgment: false
  - id: D7
    description: "docs/DEPLOY.md's participation-terms paragraph and TERMS_TEXT row describe the console save path as it actually behaves"
    requirement: SVC-04
    verification: []
    human_judgment: true
    rationale: "The backstop truth is an operator following the runbook verbatim on a clean machine, setting a terms document at the documented cap and then saving an unrelated setting from the console. No test asserts prose accuracy against a human's reading of it; the behavior the prose describes is proven by D1, but that the prose describes it usefully is a judgment."

duration: 27 min
completed: 2026-08-03
status: complete
---

# Phase 05 Plan 33: Derived Settings Body Budget Summary

**The gated settings route's 4 KiB body limit, which refused every save once stored terms passed roughly 3900 characters, is replaced by a 124096 byte budget derived from `MAX_TERMS_CHARS` at the worst-case six bytes per JSON-encoded UTF-16 code unit, proven by measurement across five encoding classes at the cap.**

## Performance

- **Duration:** 27 min
- **Started:** 2026-08-03T14:25:00Z
- **Completed:** 2026-08-03T14:52:00Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- **CR-02 / SC3 closed.** `SETTINGS_BODY_LIMIT_BYTES` is exported from `runtime-settings.ts`, computed in the source expression as `MAX_TERMS_CHARS * WORST_CASE_TERMS_BYTES_PER_CODE_UNIT + SETTINGS_BODY_HEADROOM_BYTES` (20000 * 6 + 4096 = 124096), and consumed by the gated `PUT /v1/operator/settings` `bodyLimit`. A full console-shaped save carrying a terms document at the 20000 character ceiling now reaches `applySettings` and is stored.
- **The derivation is proven, not asserted.** Six rows in `runtime-settings.spec.ts` MEASURE the encoded byte length of a full console patch at the cap in plain ASCII, a two-byte script, a three-byte script, surrogate pairs and escape-forcing control characters, and assert the budget bounds each. One further row proves the review's suggested `MAX_TERMS_CHARS * 2 + 4096` would have refused the three-byte class outright, so the property cannot pass against the weaker constant.
- **The refusal an operator sees is now actionable.** One character past the cap is answered 400 carrying `Participation terms must be 20000 characters or fewer.` rather than `request too large`, which named no field, no limit and no remedy.
- **The streaming bound survived the move.** The pre-existing 413 row keeps its exact status assertion and its nothing-was-applied assertion, with its body raised past the new boundary; a companion row pins that the new value sits inside the 4 KiB to 512 KiB range this service already accepts elsewhere.
- **IN-03 closed by deletion.** `HonoAppOptions.serviceName`, its destructure and the `runtimeSettings ? ... : serviceName` fallback are gone, as is the now-dead argument at the `createHonoApp` call in `index.ts`. The holder is the display name's only source; the additive-key contract is byte-preserved.
- **IN-04 closed by evidence.** The retained last-write whole-minute guard is kept, and is now pinned as a no-op across every `HOSTILE_SEEDS` row through the boot output it would emit if it ever fired.
- **The runbook stopped contradicting the route.** `docs/DEPLOY.md`'s participation-terms paragraph and `TERMS_TEXT` row now state that the character cap is the only limit either path applies, that a runtime save above it is refused naming the limit with nothing else applied, and that the settings surface re-sends the whole form so terms at the cap never block another field's save.

## Task Commits

1. **Task 1: derived body budget + ceiling rows** - `5175d13` (fix)
2. **Task 2: runbook correction** - `99d3d69` (docs)
3. **Task 3: one path to the wire + IN-04 pin** - `df8b863` (refactor)

## Files Created/Modified

- `packages/service/src/runtime-settings.ts` - exports `MAX_TERMS_CHARS` and the new derived `SETTINGS_BODY_LIMIT_BYTES`, with the per-class byte table and the rejected-alternative measurements in the docstrings
- `packages/service/src/hono-adapter.ts` - the settings route consumes the derived budget; the static `serviceName` option, its destructure and the `/v1/config` fallback are removed
- `packages/service/src/index.ts` - the dead `serviceName` argument at the `createHonoApp` call is removed; the `createRuntimeSettings` seed is untouched
- `packages/service/src/config.spec.ts` - `namedApp` deleted, its row moved onto `holderApp` with the served-body `toEqual` byte for byte
- `packages/service/tests/lifecycle-routes.spec.ts` - `consolePatch` helper plus four new rows and the reshaped 413 row
- `packages/service/tests/runtime-settings.spec.ts` - the derivation property block (6 rows), the IN-04 pin, `MAX_TERMS_CHARS` imported rather than retyped
- `docs/DEPLOY.md` - the participation-terms paragraph and the `TERMS_TEXT` row

## Decisions Made

- **Derived at six bytes per code unit, not two.** `String.prototype.length` counts UTF-16 code units, so the multiplier is per code unit: ASCII costs 1, an escaped quote or a two-byte script costs 2, a surrogate pair costs 2 (four bytes across two units), a three-byte script costs 3, and a control character emitted as a six-character backslash-u escape costs 6. Six is therefore the bound rather than one measurement among several. The review's doubling was measured and rejected: at the 20000 character ceiling an ASCII body is 20184 bytes, surrogate pairs are 40184 and a three-byte script is 60184, so a 44096 byte budget still refuses a real class at the cap.
- **`MAX_TERMS_CHARS` exported, `MAX_SERVICE_NAME_CHARS` not.** The round-4 prohibition on exporting either was a scope fence, superseded here for the one constant the route must derive from. The other stays module-local for the reason round 4 gave.
- **The static name option deleted rather than documented.** Its own docstring already admitted it was superseded and survived only for callers wiring no holder. In production `createService` always wires one, so the 200 character bound held by shadowing.
- **The IN-04 pin observes boot output.** The guard is silent by construction on every reachable path, so the only thing a future second writer could change from outside the module is the warning count. The stored value is asserted beside the count so the property states the invariant and not merely the guard's silence.

## Mutations Observed

All four mutations required by the plan were run and their output recorded.

**1. The route's independently chosen byte constant, restored** (`maxSize: SETTINGS_BODY_LIMIT_BYTES` back to `maxSize: 4 * 1024`). This was also the test-first RED observation, taken before the fix landed:

```
 ❯ packages/service/tests/lifecycle-routes.spec.ts (57 tests | 4 failed) 473ms
AssertionError: expected 413 not to be 413 // Object.is equality
 ❯ packages/service/tests/lifecycle-routes.spec.ts:614:28
AssertionError: expected 413 not to be 413 // Object.is equality
 ❯ packages/service/tests/lifecycle-routes.spec.ts:633:28
AssertionError: expected 413 to be 200 // Object.is equality
 ❯ packages/service/tests/lifecycle-routes.spec.ts:650:24
AssertionError: expected 413 to be 400 // Object.is equality
 ❯ packages/service/tests/lifecycle-routes.spec.ts:665:24
```

Restored; the four rows pass.

**2. The ceiling rows against the shipped defect** (the same observation, run before any source change, with the constants declared but unconsumed): 4 failed, 139 passed across the two spec files, each failure a 413 where a success was asserted.

**3. A reintroduced static name path** (IN-03). A file calling `createHonoApp(transport, { serviceName: 'x'.repeat(5000) })` was added and `pnpm typecheck` run. The evidence is a compile failure rather than a passing test, which is the point of the finding:

```
packages/service/src/in03-mutation.ts(7,47): error TS2353: Object literal may only specify known properties, and 'serviceName' does not exist in type 'HonoAppOptions'.
```

The mutation file was removed.

**4. The retained whole-minute guard made to fire** (IN-04). A second writer was inserted into the guard's input (`clampedDiscoveryWindowMs + 1`), so the guard quantizes a value point 2 had already floored:

```
 FAIL  packages/service/tests/runtime-settings.spec.ts > no seed the holder ACCEPTS is a value it would REFUSE (W3, review WR-2 and WR-3) > keeps the retained last-write whole-minute guard a NO-OP across the whole table (review IN-04)
AssertionError: expected 2 to be less than or equal to 1
 ❯ packages/service/tests/runtime-settings.spec.ts:883:39
```

Restored; the tree is byte-identical to the committed state (`grep -c secondWriterMs` returns 0).

## Gate

| Check | Result |
|---|---|
| `pnpm test` | 68 files, **1247 tests** passed (baseline 68 files / 1234 tests, +13) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:gate` | exit 0, 13 legs PASS |
| `pnpm typecheck` | green |
| `git diff --stat pnpm-lock.yaml` | empty |
| `git diff --stat packages/web` | empty |
| em-dash scan over every touched file | none |

## Deviations from Plan

None - plan executed exactly as written.

The plan's deliberate, pre-declared divergence from the review's suggested constant (deriving the multiplier rather than taking `* 2`) was executed as planned and is recorded in Decisions Made, not as a deviation.

## Issues Encountered

- The escape-forcing encoding class was first written with a pasted raw `U+0001` byte in the spec source rather than the `\u0001` escape. Caught by reading the file back through `cat -A`, rewritten as an explicit escape with a comment saying why it must be readable in source. No behavior difference; the test measures the same string either way.

## Known Stubs

None. Nothing in this plan renders a placeholder, hardcodes an empty value, or leaves a surface unwired.

## Threat Flags

None. No new route, no new env var, no new package, no persisted state; the only wire-visible change is the removal of a `serviceName` key path that no shipped caller reached.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready for 05-34** (WR-06, the list-poll guard that compares a status rather than a session). It touches `packages/web` only and is serialized by this round's singleton-wave rule.
- **05-35** (WR-07, the dropped free-text seed captioned as an environment default) has a genuine file dependency on this plan: it amends the same holder and the same `lifecycle-routes.spec.ts`.
- The round's `pnpm e2e:gate` was run here because this plan changes a gated route; 05-35 runs it again at the end of the round.
- Out of scope by owner decision and still recorded: review WR-03, WR-04, WR-05, IN-01, IN-02, the verdict cache never cleared, `tx-client.ts`'s missing `AbortSignal.timeout`, the unbounded `verdictCache` singleton, the `/cas` prototype-pollution 500, the test-peer seat cap, and the deferred advert-slot-on-fill item.
- The 16 pending human items in `05-UAT.md` remain the owner's walk. This plan closes none of them; the `docs/DEPLOY.md` correction only removes a false statement the Environment 1 walk would otherwise have tripped over.

## Self-Check: PASSED

- `packages/service/src/runtime-settings.ts` FOUND, exports `SETTINGS_BODY_LIMIT_BYTES` and `MAX_TERMS_CHARS`
- `packages/service/src/hono-adapter.ts` FOUND, consumes the constant at the settings route
- `packages/service/src/index.ts`, `packages/service/src/config.spec.ts`, `packages/service/tests/lifecycle-routes.spec.ts`, `packages/service/tests/runtime-settings.spec.ts`, `docs/DEPLOY.md` all FOUND and modified
- Commits FOUND: `5175d13`, `99d3d69`, `df8b863`
- All acceptance criteria across the three tasks re-run and passing; all four mutations observed and restored

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-03*
