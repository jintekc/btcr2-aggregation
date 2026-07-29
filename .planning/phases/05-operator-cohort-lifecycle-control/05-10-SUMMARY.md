---
phase: 05-operator-cohort-lifecycle-control
plan: 10
subsystem: operator-lifecycle
tags: [cancel, participant-narration, public-read, non-oracle, react, zustand, vitest, e2e]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 01)
    provides: the intent registry and the retained terminal record carrying the distinct canceled fate this read projects
  - phase: 03-participant-cohort-lifecycle (plan 07)
    provides: the post-seat gone-streak predicate (POST_SEAT_GONE_CONFIRMATIONS = 2) this plan follows and does not touch
  - phase: 04-operator-cohort-monitoring (plan 07)
    provides: the D-45 stall-copy fix whose branch order this plan had to get in front of
provides:
  - GET /v1/cohort-fate/:id - the public, non-oracle, one-bit fate read
  - OperatorCohorts.cohortFate + CohortFateDTO - the stripped anonymous projection beside the operator list
  - packages/web/src/lib/cohort-fate.ts - fetchCohortFate, the never-throwing anonymous client
  - terminalReason's required canceled input, checked before the stall branch
  - CANCELED_NARRATION / HONEST_TERMINAL_FALLBACK / STALL_NARRATION / TERMINAL_NEXT_STEP_LINE
affects: [05-14 phase capstone]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A fact the protocol cannot carry rides a narrow public read taken AFTER the existing detection already fired, so no timing changes"
    - "A non-oracle property is asserted by deep equality across unknown, evicted, and never-existed, never case by case"
    - "A terminal cause the service can state about itself arrives as a dedicated boolean, never as another alternative in a message-text classifier"
    - "A required (not optional) input field forces every call site to decide the fact rather than inherit a default"
    - "An unreachable read falls back to the honest line, so a network fault can never fabricate an accusation"
    - "Branch ORDER that is load-bearing is pinned by a source-order assertion, not by a comment alone"

key-files:
  created:
    - packages/service/tests/cohort-fate.spec.ts
    - packages/web/src/lib/cohort-fate.ts
    - packages/web/tests/terminal-reason.spec.ts
  modified:
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/hono-adapter.ts
    - packages/web/src/stores/participant.ts
    - packages/web/src/stores/participant.spec.ts
    - packages/web/src/components/cohort/CohortPage.tsx
    - e2e/operator-cohort.ts

key-decisions:
  - "cohortFate is one expression over the record's OWN fate, so no branch exists that could answer something other than the single boolean"
  - "The route answers 200 for every well-formed id and never 404, so the status code cannot be an oracle either"
  - "The route mounts even with no operator surface configured, because a route that existed only on an operator-enabled service would itself leak how the service was booted"
  - "The cancel fact is a REQUIRED field on terminalReason's input, not optional: a forgotten call site is a compile error rather than a silently wrong narration"
  - "The fate read runs once, after the gone streak has already landed the terminal state, guarded on the ROUND (pickedCohortId + status) rather than the poll epoch, which fail() has already bumped"
  - "fetchCohortFate accepts only a real boolean true as the canceled fact; a string, a number, or a missing key reads as not canceled"
  - "The next-step line renders unconditionally in the terminal card, so it follows either narration by construction rather than by a duplicated branch"

requirements-completed: [SVC-04]

coverage:
  - deliverable: "A participant whose cohort the operator canceled is told so specifically"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/terminal-reason.spec.ts#narrates a cancel as a cancel on the EXACT input that produces stall copy today"
        status: pass
      - kind: test
        ref: "packages/service/tests/cohort-fate.spec.ts#answers the canceled fact TRUE for a canceled cohort, with no session at all"
        status: pass
      - kind: command
        ref: "pnpm e2e:cancel"
        status: pass
  - deliverable: "A cancel is never narrated as a stall, and the honest fallback survives when attribution is not carried"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/terminal-reason.spec.ts#never narrates a cancel as a stall, a failure, or an expiry"
        status: pass
      - kind: test
        ref: "packages/web/tests/terminal-reason.spec.ts#keeps the shipped stall copy for the same input when the cancel fact is FALSE"
        status: pass
      - kind: test
        ref: "packages/web/tests/terminal-reason.spec.ts#keeps the honest fallback when nothing is known and no stall signal is present"
        status: pass
  - deliverable: "The cancel fact reaches the narration out of band, and the branch order is held in place"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/terminal-reason.spec.ts#checks the cancel fact BEFORE the stall branch in source order"
        status: pass
      - kind: test
        ref: "packages/web/tests/terminal-reason.spec.ts#does NOT add a cancel alternative to the message-text chain (the D-45 lesson)"
        status: pass
  - deliverable: "The public fate read is not an existence oracle and carries no operator-only field"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/cohort-fate.spec.ts#answers an unknown, an EVICTED, and a never-existed id byte-identically"
        status: pass
      - kind: test
        ref: "packages/service/tests/cohort-fate.spec.ts#answers 400 for a malformed id and NEVER 404, so the status code is not an oracle either"
        status: pass
      - kind: test
        ref: "packages/service/tests/cohort-fate.spec.ts#carries exactly one key: no reason, no member count, no DID, and no amount"
        status: pass
  - deliverable: "The post-seat gone-detection timing is unchanged"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/terminal-reason.spec.ts#leaves the post-seat gone-streak constant and its comparison exactly as shipped"
        status: pass
      - kind: test
        ref: "packages/web/src/stores/participant.spec.ts#lands the honest D-25 fallback terminal only after the bounded gone streak (Finding 2)"
        status: pass
  - deliverable: "An unreachable fate read invents no certainty"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/terminal-reason.spec.ts#reports unreachable WITHOUT throwing on a network failure"
        status: pass
      - kind: test
        ref: "packages/web/tests/terminal-reason.spec.ts#reads a non-boolean canceled field as NOT canceled (an accusation needs a real true)"
        status: pass
  - deliverable: "The two narration variants and the next-step line read correctly in the terminal card"
    human_judgment: true
    rationale: "Whether the cancel sentence plus the next-step line reads as informative rather than accusatory, and whether the bad-tone terminal card is the right weight for an operator's deliberate act, are judgments no unit test makes. Belongs to the phase's participant walkthrough at the end-of-phase gate."

# Metrics
duration: ~25 min
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 10: Participant Cancel Narration Summary

**A participant whose cohort the operator ended is now told that specifically, through one anonymous bit the service is willing to state about itself, read only after the existing gone-detection has already fired, and checked ahead of the stall branch so a deliberate cancel can never again be narrated as a service malfunction.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-29
- **Tasks:** 2 (both TDD, so each has a RED then a GREEN commit)
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- **The protocol cannot carry a cancel, so one bit rides beside it.** Nothing in `@did-btcr2/aggregation@0.4.0` lets a service tell a seated participant that their cohort was deliberately ended: `runner.stopCohort` emits nothing at all, and the participant learns only through the directory poll noticing an absence. `GET /v1/cohort-fate/:id` is the narrow public read that carries the attribution the protocol cannot, and it carries nothing else.
- **The timing of the existing detection is untouched, deliberately.** The post-seat gone streak requires two consecutive gone reads because a completed cohort legitimately drops its directory row at the same instant `cohort-complete` fires on another channel (03-07 CR-01). Shortening it to get the cancel news out faster would trade a real success for a faster failure. So the fate read runs strictly AFTER the streak has already landed the terminal state: it can only ever upgrade the copy, and a spec pins both the constant and its comparison as shipped.
- **The dangerous part was never the copy, it was the branch order.** The shipped `terminalReason`'s first branch fires on submitted-but-unsigned plus no validation-requested plus an unexplained reason, which is exactly what a cohort canceled mid-round looks like from inside the browser. Left alone, an operator's deliberate act would have been narrated as `This service stalled while collecting updates.` - the precise misattribution the 04 D-45 fix exists to prevent. The first row of the new spec is constructed to be that input byte for byte, and the second is the same input with the fact false, so the regression is pinned rather than described.
- **The fact arrives as a boolean, and the message-text chain is untouched.** No `/cancel/` alternative was added to the regular expressions. Keying narration on message text is what D-45 removed, and the server-side fate is already carried out of band for the same reason (05-01's intent registry declares the fate before the library call rather than reading it off a rejection). A spec walks every `/.../.test(e)` literal in the file and asserts none of them mentions cancel wording, so the technique cannot creep back in one regex at a time.
- **The cancel input is REQUIRED, not optional.** An optional field would have let a future terminal surface forget it and silently render stall copy for a genuine cancel - which is the exact prohibition this plan exists to close. Making it required turns that mistake into a compile error. The cost was five mechanical `canceled: false` additions in the shipped D-45 spec, whose assertions are unchanged.
- **The read is not an existence oracle, and that is asserted by comparison.** An unknown id, an EVICTED id (a real cancel that aged out of the bounded 24-record retention), and a never-existed id are compared by deep equality including status code, not asserted correct one at a time - three separately-correct-looking answers that differ in status or key set would pass the weaker test and fail this one. The evicted case is built by genuinely cancelling 25 cohorts through the real gated route.
- **It never answers 404, so the status code is not an oracle either.** Every well-formed id is a 200; a malformed one is a 400 before any lookup, including a percent-encoded traversal attempt. (A multi-segment path is a router miss, which is the same answer for every input and carries no cohort information.)
- **It mounts even on a fail-closed boot.** A service booted with no `OPERATOR_PASSWORD` mounts no operator surface at all, and this route still answers the same neutral `{ canceled: false }`. A route that existed only on an operator-enabled service would itself have been a signal about how the service was booted.
- **The body carries the canceled fact and nothing else.** One key. The same terminal record holds the operator-facing reason string, the seat counts, and the config, and none of it follows the bit out; the spec asserts the key set exactly and then greps the serialized body for reason, DID, seat, and amount wording.
- **A network fault can never accuse an operator.** `fetchCohortFate` never throws: unreachable, non-2xx, and malformed-body all return the neutral result, and only a real boolean `true` counts as the fact (a string `'yes'` reads as not canceled). When the read fails or answers false, the inherited honest fallback renders exactly as it did before.
- **Both narrations end in the same place, so the page says what to do next.** `Your keys and identity are still in this browser. Pick another cohort from the directory when one opens.` renders unconditionally in the terminal card, under either variant, rather than being duplicated into two branches that could drift.
- **A stranger proves it over real HTTP.** The `e2e:cancel` leg now reads the fate with no cookie header at all after the cancel, and additionally asserts that the still-live sibling cohort and an id the service never issued answer byte-identically - the non-oracle property observed from outside the process, not just inside the fold.

## Task Commits

Both tasks are TDD, so each has a RED then a GREEN commit:

1. **Task 1 (RED): failing spec for the public non-oracle cohort-fate read** - `fd93123` (test)
2. **Task 1 (GREEN): the public non-oracle cohort-fate read** - `9a4e732` (feat)
3. **Task 2 (RED): failing spec for cancel-specific participant narration** - `bfc512f` (test)
4. **Task 2 (GREEN): cancel-specific narration that can never become stall copy** - `d16660a` (feat)

## Files Created/Modified

- `packages/service/src/operator-cohorts.ts` - `CohortFateDTO` (documented as the stripped anonymous projection beside the rich operator list, the `publicFunding` precedent) and `cohortFate(cohortId)`, one expression over the retained record's own `fate` so no branch exists that could answer anything but the single boolean.
- `packages/service/src/hono-adapter.ts` - `GET /v1/cohort-fate/:id` in the PUBLIC block beside `/v1/anchor` and `/v1/funding`, above the `if (operatorAuth)` gate, with the same cheap id shape guard and the fail-open neutral answer when no operator surface is wired.
- `packages/service/tests/cohort-fate.spec.ts` (new, 8 tests) - the canceled happy path with no session, the live / draft / expired false cases, the exact key set, the deep-equality non-oracle row over a genuinely evicted cancel, the 400-not-404 status rule, the fail-closed boot, and the gated read still answering 401 to the same anonymous caller.
- `packages/web/src/lib/cohort-fate.ts` (new) - `fetchCohortFate`, `CohortFateDTO`, and the discriminated `CohortFateResult`; anonymous (`credentials: 'omit'`), 8s timeout, never throws, and strict `=== true` on the fact.
- `packages/web/src/stores/participant.ts` - `CANCELED_NARRATION` / `HONEST_TERMINAL_FALLBACK` / `STALL_NARRATION` as named constants, the required `canceled` input on `terminalReason` checked first with the ordering rationale in the doc-comment, the per-round `canceled` state field in `INITIAL_OUTCOME`, the optional `baseUrl` on `handlePostSeatSnapshot`, and the single round-guarded fate read after the streak lands.
- `packages/web/src/stores/participant.spec.ts` - the five inherited D-45 rows now pass `canceled: false` explicitly, with a comment stating what they have always meant and pointing at where the discrimination itself is asserted.
- `packages/web/src/components/cohort/CohortPage.tsx` - `TERMINAL_NEXT_STEP_LINE` authored beside the card that renders it, the `canceled` selector, and the terminal card rendering the narration plus the next-step line.
- `packages/web/tests/terminal-reason.spec.ts` (new, 12 tests) - the cancel-versus-stall discrimination on the exact misfiring input, the fallback preservation, the two source-order pins, the regex-chain pin, the gone-streak constant pin, and the four `fetchCohortFate` rows.
- `e2e/operator-cohort.ts` - the anonymous fate read in the `--cancel` leg (canceled true with no cookie, live sibling and unknown id byte-identical) and the extended pass banner.

## Decisions Made

- **`cohortFate` is one expression.** There is no branch that could return an extra key or a different shape, so the route cannot grow an existence signal by accident later.
- **Never 404.** Answering 404 for an id the service does not hold would make the status code the oracle the body deliberately is not.
- **The route mounts with no operator surface.** Its presence must not depend on how the service was booted.
- **The cancel input is required.** A forgotten call site should be a compile error, not a wrong sentence shown to a participant.
- **The fate read is guarded on the round, not the poll epoch.** `fail()` tears the poll down and bumps the epoch before the answer lands, so an epoch check would reject every answer; the honest guard is that the store still holds the same picked cohort in the same failed round.
- **Only a real boolean `true` is an attribution.** Coercing a truthy value would let a malformed body accuse an operator.
- **The next-step line renders unconditionally.** One line in one place cannot drift from itself; two branches can.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The required cancel field broke the shipped D-45 spec's typecheck**

- **Found during:** Task 2
- **Issue:** The plan asks for `a canceled: boolean field` on `terminalReason`'s input, and also that the shipped `packages/web/src/stores/participant.spec.ts` stay green. As a required field it is five `TS2345` errors in that spec, which is outside the plan's `files_modified` list; as an optional field it compiles everywhere but lets a future terminal surface omit it and silently render stall copy for a genuine cancel, which is this plan's central prohibition.
- **Fix:** Kept the field REQUIRED (the compiler should catch the omission) and added `canceled: false` to the five inherited call sites, whose assertions and expected strings are unchanged. A comment above that describe block records why the rows now state the fact explicitly and points at `packages/web/tests/terminal-reason.spec.ts` for the discrimination itself.
- **Files modified:** packages/web/src/stores/participant.spec.ts
- **Verification:** `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` clean; that spec's 65 tests green; the full 854-test suite green.
- **Committed in:** `d16660a`

**2. [Rule 1 - Bug] The traversal row of the never-404 assertion tested the router, not the guard**

- **Found during:** Task 1
- **Issue:** The RED spec asserted `GET /v1/cohort-fate/../../etc/passwd` is a 400. It is a 404: a multi-segment path never matches the single-segment route at all, so the shape guard is never reached. Asserting 400 there would have been asserting something the route does not do.
- **Fix:** The row now uses `encodeURIComponent('../../etc/passwd')`, which DOES reach the handler as one segment and is correctly refused with 400, with a comment recording that a multi-segment path is a router miss - the same answer for every input, carrying no cohort information, and therefore not an oracle.
- **Files modified:** packages/service/tests/cohort-fate.spec.ts
- **Verification:** the row passes; the shipped `/v1/anchor` read behaves identically, so no divergence was introduced.
- **Committed in:** `9a4e732`

### Deliberate readings of the plan

- **`handlePostSeatSnapshot` takes an OPTIONAL `baseUrl` second parameter** rather than the store retaining one. The shipped spec calls it with rows alone and stays byte-identical (no fetch stubbing, no behavior change); the poll closure that owns the real `baseUrl` passes it. Omitting it is exactly the inherited behavior: the honest fallback and no network call.
- **The COMPLETED-normally case has no fixture of its own.** `settleCompletion` prunes a cohort's retained record on success, so a completed cohort holds no terminal record at all and takes the identical unknown default the deep-equality row already pins. Driving a real hermetic cohort to completion inside a unit spec would need n participants and would race; the completion path itself is proven by the e2e legs. The spec docstring says exactly this rather than implying wider coverage.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test bug), plus 2 documented readings of the plan text.
**Impact on plan:** One file outside `files_modified` changed: `packages/web/src/stores/participant.spec.ts` (five mechanical additions forced by the required field). No interface a later plan references departed from the plan.

## Issues Encountered

- **The rendered terminal card is unverified by any automated test**, only its inputs and its copy constants. Whether the cancel sentence followed by the next-step line reads as informative rather than accusatory, and whether the inherited bad-tone card is the right weight for an operator's deliberate act (as opposed to a failure), belong to the phase's participant walkthrough at the end-of-phase gate. This is the same gap 05-06 through 05-09 recorded for the console surfaces.
- **The end-to-end participant experience of a cancel is not driven by a browser test.** `e2e:cancel` proves the read over real HTTP anonymously, and the unit specs prove the narration from the exact inputs, but no test drives a browser participant through seat, cancel, two directory polls, fate read, and rendered copy. Building that would mean holding a real browser through two 5-second post-seat poll intervals; the constituent parts are each proven, and the composed path belongs to the walkthrough.
- **Latency is two poll intervals by design** (RESEARCH Open Question 2, resolved). A canceled participant waits for the gone streak before learning anything, and only then for the fate read. That is a deliberate trade against the CR-01 race, not an oversight.

## Known Stubs

None. Every part of this path is wired end to end: the route reads the same retained terminal record the operator list reads, the browser client calls the real route, the fact flows into the real terminal render path, and the e2e leg exercises the whole thing over real HTTP with no session.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/service/tests/cohort-fate.spec.ts` (task 1 gate) | 8 tests pass |
| `pnpm e2e:cancel` (task 1 gate) | pass, with the new anonymous fate assertions |
| `pnpm typecheck` (task 1 gate) | clean |
| `pnpm vitest run packages/web/tests/terminal-reason.spec.ts packages/web/src/stores/participant.spec.ts` (task 2 gate) | 77 tests pass |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` | clean |
| `pnpm --filter @btcr2-aggregation/web build` (task 2 gate) | clean |
| `pnpm test` (full suite, `tsc -b` gated) | 54 files, 854 tests pass |
| `pnpm lint` | clean |
| `pnpm e2e:browse` | pass (no regression in the shipped participant path) |
| `pnpm e2e:browser:participant` | pass (browser capstone, full loop) |
| `pnpm e2e:operator` (full extended suite, including the cancel leg) | pass |
| `grep -rlP '\x{2014}' packages/service/src packages/web/src` | no files |

## User Setup Required

None. No new environment variable and no new boot requirement. The route mounts on every service, including one booted without an operator password, and answers the same neutral shape there. A participant needs no session, no configuration, and no opt-in: the read happens automatically once their cohort goes dark.

## Next Phase Readiness

- **The last CORE item of SVC-04 is closed.** The cancel slice is now honest on both sides: the operator ends a cohort deliberately (05-01/05-02), and the participant is told that specifically when the service can carry it, told the honest fallback when it cannot, and never told a stall happened.
- **The three folded builds are what remain** (05-11 chain-endpoint override, 05-12 PSBT registration leg, 05-13 participation terms), which are the slip-first tier by the phase's own three-tier slip order.
- **`GET /v1/cohort-fate/:id` is now the third anonymous sibling** beside `/v1/anchor` and `/v1/funding`, and the three share one shape: the same id guard, one 200 for every well-formed id, never a 404, and a body that answers identically for unknown and evicted. A fourth public participant-facing fact has one obvious shape to match.
- **`terminalReason`'s input is now the place a service-stated terminal cause goes.** If a later phase can carry a second one (an operator-stated expiry reason, say), it joins as another required boolean above the inference chain rather than as another regular expression inside it.
- **Carried concern, unchanged from 05-02 onward:** a settled cohort still cannot be re-opened and a single seat still cannot be released (upstream: `@did-btcr2/aggregation@0.4.0` has no seat-release API). A canceled participant's next step is genuinely to pick another cohort, which is what the next-step line says.
- **Carried gap, same as 05-06 through 05-09:** the rendered composition of the new surface is unverified by any automated test and belongs to the end-of-phase walkthrough.

## Self-Check: PASSED

- Created files verified present on disk: `packages/service/tests/cohort-fate.spec.ts`, `packages/web/src/lib/cohort-fate.ts`, `packages/web/tests/terminal-reason.spec.ts`.
- Commits verified in git history: `fd93123`, `9a4e732`, `bfc512f`, `d16660a`.
- Every task acceptance criterion re-run in this session, and the plan-level `<verification>` block re-run in full and green, including all four named e2e legs and the em-dash grep.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*
