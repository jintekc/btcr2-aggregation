---
phase: 05-operator-cohort-lifecycle-control
plan: 24
subsystem: web-participant-and-operator-store-coverage
tags: [gap-closure, coverage, mutation-testing, cancel-attribution, chain-endpoint, session-expiry, compile-gate]
status: complete
requires:
  - "packages/web inside the root tsc -b, so a dropped argument is a pnpm test failure (05-21)"
  - "packages/web/src/lib/cohort-fate.ts: fetchCohortFate (05-10)"
  - "packages/web/src/lib/esplora.ts: checkEndpoint, and the shared-genesis pair in packages/shared/src/networks.ts (05-11)"
provides:
  - "packages/web/tests/participant-fate.spec.ts: the first test that ever executes the store's guarded fate-read block"
  - "handlePostSeatSnapshot's base url as a REQUIRED parameter, so a dropped origin is a compile error"
  - "a cross-network endpoint row whose store chain differs from the endpoint's, breaking the six-rows-one-chain hole"
  - "per-row request counts on the endpoint acceptance and both shared-genesis family rows"
  - "the first store-level invocation of cancelCohort and finalizeCohort in the repo"
  - "seven new rows in the 05-UAT automation ledger (tests 4, 5, 10, 15)"
  - "a clause-by-clause retirement check on UAT test 10, recorded as PARTIAL with the uncovered clause named"
affects:
  - packages/web/src/stores/participant.ts
  - packages/web/src/stores/participant.spec.ts
  - packages/web/tests/participant-fate.spec.ts
  - packages/web/tests/tx-client.spec.ts
  - packages/web/tests/operator.spec.ts
  - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
tech-stack:
  added: []
  patterns:
    - "optional-to-required as a coverage fix: the parameter a caller can forget becomes a compile error, which only became gate-visible once 05-21 put packages/web inside tsc -b"
    - "a macrotask settle() turn to drain a fire-and-forget promise chain, which is what makes a NEGATIVE assertion (still false) meaningful rather than merely early"
    - "a manually-delivered fetch promise so a late answer genuinely arrives late rather than being prevented from arriving"
    - "reading a module-private constant OUT OF THE SOURCE so a spec cannot drift from the shipped value it depends on"
    - "two assertions per refusal row (the flag AND the rendered sentence), because a refusal that swapped the copy is still a defect"
    - "per-row request counts beside every endpoint verdict, so a row cannot pass because the code probed twice and took the second answer"
decisions:
  - "The fate-read block went into a NEW packages/web/tests/participant-fate.spec.ts rather than into the co-located legacy spec the audit named, per the standing tests-outside-src rule. The legacy file is still edited, but only mechanically."
  - "#13 got a stronger fix than the audit proposed. The audit's closing test pins fetchCohortFate; the argument is actually dropped at the poll closure, which no unit test executes. Making the parameter required turns that into a compile error, the same reasoning 05-10 used for the cancel fact reaching terminalReason."
  - "The audit's prediction that all four refusal rows go RED under its guard mutation is CONTRADICTED for the truthy-non-boolean row, and the reason is structural: fetchCohortFate collapses a non-boolean to canceled:false BEFORE the guard sees it. A second, load-bearing mutation was run to prove that row is not vacuous."
  - "The audit's proposed cross-network row (store mutinynet, endpoint regtest, expecting mismatch) is factually impossible: that shape returns unreachable via the A3 cannot-verify refusal. The row was built on the shared-genesis pair instead, which reaches mismatch AND makes the store's own chain the only thing that can separate the two."
  - "The nine legacy call sites got a fetch stub alongside the new argument, because the fate read now genuinely fires there. A 404 reads as unreachable and upgrades nothing, so every assertion in that file is byte-unchanged."
  - "UAT test 10 is NOT retired. Two of three clauses have rows; TERMINAL_NEXT_STEP_LINE is read by no test in the repo, and CohortPage.tsx is not in this plan's files_modified, so the pin was left to whoever owns that file rather than guessed at."
metrics:
  duration: ~45m
  completed: 2026-07-30
---

# Phase 5 Plan 24: Stop a fault accusing an operator, a dropped origin, a wrong-chain endpoint and a stale drill-down Summary

An unreachable service can no longer make a participant console accuse a named operator of
cancelling, the page origin can no longer fall silently out of the fate read, a participant on one
chain can no longer activate an endpoint on another, and a mid-session logout on either lifecycle
verb drops the console to login. Five mutation runs prove it, one of which contradicted the audit's
prediction and produced a sixth.

## Gap source

`.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT-2.md`. This plan closes **#18**
(entry 3, High), **#16** (entry 4, High), **#14** (entry 5, High) and **#13** (entry 9, Medium).

None is a live protocol bug. Each is a mutation that WOULD have shipped undetected, which is why
the proof that a coverage fix worked is that the mutation now fails.

## #14 and #13: the block that turns an answer into an accusation

`packages/web/src/lib/cohort-fate.ts` states the invariant in words at the top of the file: a
network fault must never be able to fabricate an accusation against an operator. The read itself
had thorough rows and the server route is non-oracle by deep equality across unknown, evicted and
never-existed. What nothing had was a **caller**. All nine `handlePostSeatSnapshot` calls in the
repo passed one argument, so the `if (baseUrl)` guard was never entered and the block inside it,
the one place an answer becomes an attribution, had never executed in a test at all.

`packages/web/tests/participant-fate.spec.ts` executes it, twelve rows:

| Row | Answer | Asserted |
|-----|--------|----------|
| refusal | the fetch throws | `canceled` false AND the honest fallback sentence |
| refusal | 500 | same |
| refusal | 200, body is not JSON | same |
| refusal | 200, `{"canceled":"yes"}` | same |
| refusal | 500, on the mid-round step shape | `canceled` false AND the STALL sentence, unchanged |
| acceptance | 200, `{"canceled":true}` | `canceled` true, the operator named, the log line present |
| acceptance | 200, `{"canceled":false}` | the honest fallback |
| wiring | any | the exact cohort-keyed public path, `credentials: 'omit'` |
| wiring | any | zero reads before the streak completes |
| wiring | any | exactly ONE read per completed streak, and still one after two more snapshots |
| round guard | a REAL cancel, delivered late | `canceled` stays false |
| meta | n/a | the streak length really was parsed out of the source |

Two things about the shape are load-bearing rather than tidy.

**Every refusal row asserts the sentence, not only the flag.** A refusal that left `canceled` false
but swapped the copy for something else would still be a defect, and only the second assertion
catches it. The sentence is computed by the exact expression `CohortPage.tsx:210` renders, over the
store's own facts.

**The fifth refusal row seeds the mid-round step shape deliberately.** Submitted, never
validation-requested, unexplained is what the shipped classifier narrates as a stall, so that row
proves a refused fate read neither invents the accusation nor rewrites the honest inference. It is
the row that makes "never names the operator" true independently of which sentence happens to be
showing.

**The gone-streak length is read out of the source**, not retyped:

```
const GONE_STREAK = Number(
  /const POST_SEAT_GONE_CONFIRMATIONS = (\d+);/.exec(PARTICIPANT_SOURCE)?.[1],
);
```

A spec that hardcoded 2 would quietly stop completing the streak the day somebody changed the
constant, leaving every row passing vacuously against a fate read that never ran. A meta row asserts
the regex matched, so a parse failure is loud rather than silent. The constant itself is untouched
and `terminal-reason.spec.ts`'s source pin on it still passes.

### The compile-enforced half (#13)

The argument is dropped, if it ever is, at the poll closure in `participant.ts`, which **no unit
test executes**: the store's `start()` is never called by any spec and `App.tsx` is never rendered.
So the audit's proposed closing test (assert the URL and `credentials`) pins `fetchCohortFate` and
would not have caught the actual defect. Instead the parameter became REQUIRED, which turns a
dropped argument into a compile error. That is the same reasoning 05-10 used for the cancel fact
reaching `terminalReason`: a forgotten call site should be a compile error rather than a wrong
sentence shown to a participant.

The diff on shipped source is **one character**, plus the docstring paragraph explaining it:

```
-  handlePostSeatSnapshot(rows: DirectoryCohortDTO[], baseUrl?: string): void;
+  handlePostSeatSnapshot(rows: DirectoryCohortDTO[], baseUrl: string): void;
```

The compiler then enumerated the call sites rather than working from a count: exactly nine, all in
`packages/web/src/stores/participant.spec.ts`, updated mechanically with no assertion changed. That
file also gained a `fetch` stub, because with the argument present the fate read genuinely fires
there now; a 404 reads as `unreachable` and upgrades nothing, so every assertion in it is
byte-unchanged.

**This fix only works because 05-21 put `packages/web` inside the root `tsc -b`.** Verified rather
than assumed: dropping the argument at the shipped call site was observed as
`packages/web/src/stores/participant.ts(1763,21): error TS2554: Expected 2 arguments, but got 1.`
from `pnpm typecheck`, which is the first half of `pnpm test`, then restored.

## #18: the endpoint check, given somebody else's chain

`packages/web/tests/tx-client.spec.ts:564` seeded `network: 'regtest'` for all six store rows, so
hardcoding the network at the store's single call into `checkEndpoint` passed every one of them,
while a mutinynet participant would have activated a regtest esplora and read UTXOs and
confirmations off the wrong chain, feeding `register()`'s funding read and, with the second opt-in
on, a direct broadcast.

**The audit's proposed row is factually impossible and was not written as specified.** It asks for
`network: 'mutinynet'` with a stubbed regtest genesis, "expecting `kind: 'mismatch'` naming
`NETWORKS.mutinynet.label`". That shape returns `unreachable`: mutinynet carries a
`distinguishingBlock`, the observation has no second marker, and `classifyEndpoint` refuses on the
A3 cannot-verify rule before it ever reaches the comparison. The row was built on the **shared
genesis pair** instead, which is strictly better for the property under test: the endpoint answers
with the signet family's genesis, which mutinynet also carries, so only the height-one marker
separates them and only a check that was given mutinynet can tell the two apart.

Three rows added beside the six, plus counts on the existing ones:

- **cross-network (store):** store `mutinynet`, endpoint answers signet's pair, expecting
  `mismatch` naming BOTH `Signet` and `Mutinynet (signet)`, in 2 requests. The message naming the
  store's own chain is the point: a refusal that named only the far side leaves the participant
  unable to tell which of the two is wrong.
- **second marker unreadable:** block zero agrees, height one 404s, so the required marker is
  genuinely unread, and the verdict is `unreachable`. Cannot-verify is not verified.
- **block zero already disagrees:** a foreign genesis with a height-one marker that happens to
  match ours. One request only, verdict `unreachable`. The second probe's gate on block zero
  already agreeing is what stops a matching marker rescuing an endpoint whose genesis is somebody
  else's chain.

Request counts were added to the acceptance row and to BOTH shared-genesis family rows, so a row
cannot pass because the code probed twice and took whichever answer it liked. It is also a claim
about a third party's endpoint: the check owes it no more requests than it needs.

## #16: the two lifecycle verbs no test had ever invoked

`05-02-SUMMARY.md:133-137` recorded the 401 path as code-verified with no store-level harness, and
deferred it to a browser walkthrough that was never added. Replacing `get().expireSession(); return;`
in either verb with a generic `actionError` would have shipped green, and the console would have
gone on showing a drill-down of a cohort to an operator who is logged out and can no longer act on
any of it.

Four rows in `packages/web/tests/operator.spec.ts`, mirroring the export block:

| Row | Asserted |
|-----|----------|
| cancel, 401 | `auth` logged-out, `error` is `SESSION_EXPIRED`, `view` reset to the list, `cancelling` cleared |
| finalize, 401 | the same four, with `finalizing` cleared |
| cancel, 404 | session untouched, `ACTION_FAILED`, view unchanged, NO optimistic chip (`cohorts` and `detail` both untouched) |
| finalize, 409 | the server's own reason preserved inside the action-error line |

Four facts per 401 row is what makes it a real pin. The auth state alone would pass a change that
logged the operator out but left the stale drill-down open, which is the exact consequence entry 4
names; the busy flag alone would pass one that cleared the button and left the session claim
untouched. The 404 and 409 rows are not padding: they are what proves the 401 branch is a BRANCH
rather than the only path a failure takes, and the 409 pins the asymmetry 05-03 deliberately built,
where an anti-oracle 404 explains nothing on purpose while a phase race explains itself.

## Mutation runs, as observed

Every mutation was applied to shipped source, run, observed and reverted. `git diff` over
`esplora.ts`, `cohort-fate.ts` and `operator.ts` after the round is EMPTY; the only shipped source
diff in this plan is the one-character signature change and its docstring.

| # | Mutation | Predicted | OBSERVED |
|---|----------|-----------|----------|
| 1 | **The audit's "Needs a mutation run" item 1:** replace the kind-and-canceled guard with `const canceled = fate.kind !== 'ok' ? true : fate.canceled; if (!canceled) return;` | all four refusal rows RED | **RED on THREE of the four, plus the fifth control row.** `expected true to be false`, four times: thrown fetch, 500, non-JSON, and "never names the operator where the copy is NOT the fallback". 4 failed, 8 passed. The truthy-non-boolean row stayed GREEN. **The audit's prediction is contradicted, and the reason is structural**, see below. |
| 1b | Follow-up, to prove the fourth row is not vacuous: `body?.canceled === true` becomes `Boolean(body?.canceled)` in `cohort-fate.ts` | not predicted by the plan | **RED on exactly that row**, `refuses a truthy value that is not the boolean true`. 1 failed, 11 passed. The same mutation is ALSO caught by `terminal-reason.spec.ts`'s client-level row, which is the proof that the two live at different levels rather than one being the other written twice. |
| 2 | Drop the argument at the shipped poll closure: `handlePostSeatSnapshot(rows)` | fails `tsc -b` | **RED at `pnpm typecheck`, before vitest started.** `packages/web/src/stores/participant.ts(1763,21): error TS2554: Expected 2 arguments, but got 1.` |
| 3 | Hardcode the network at the store's call: `checkEndpoint(raw, 'regtest')` | the NEW row RED, the six pre-existing rows GREEN | **Exactly that asymmetry.** 1 failed, 47 passed. `- ourNetwork: "Mutinynet (signet)" / + ourNetwork: "Regtest (local)"` and `- theirNetwork: "Signet" / + theirNetwork: "an unrecognized chain"`. The six old rows are untouched, which is the demonstration that they were the hole. |
| 4 | Drop the genesis-equality half of the two-marker comparison: `if (marker && genesis.hash === ...)` becomes `if (marker)` | the block-zero row RED | **Exactly that.** `stops after block zero when block zero already disagrees` failed `expected { kind: 'mismatch', ...(2) } to deeply equal { kind: 'unreachable' }`. 1 failed, 47 passed. |
| 5 | Replace the cancel 401 branch with `set({ actionError: actionFailedWith(), cancelling: undefined })` | the cancel 401 row RED | **RED.** `expected 'logged-in' to be 'logged-out'`. 1 failed, 16 passed. |

### Why mutation 1's prediction did not hold, in full

The audit predicted all four refusal shapes would go RED. Three did. The truthy-non-boolean row
could not, and this is a property of the code rather than a weakness in the row: `fetchCohortFate`
already collapses a non-boolean `canceled` to `{ kind: 'ok', canceled: false }` before the store's
guard ever sees it, so a mutation that only changes how `kind !== 'ok'` is treated is invisible to
that input by construction. The audit was reading the guard in isolation.

That is exactly why mutation 1b was run rather than the row being left as a passing assertion with
no demonstrated bite: the round's rule is that a mutation staying green means the assertion is not
load-bearing until proven otherwise. It IS load-bearing, against its own mutation. The two halves of
the strict-boolean rule are now pinned at both levels, the client (`terminal-reason.spec.ts`) and
the caller (`participant-fate.spec.ts`), and mutation 1b reddens both.

## The UAT automation ledger

Seven clauses across four tests (4 earns two, 5 one, 10 two, 15 one). The test-5 row states its
hermetic limit inside the row as the plan asked: every documented E16 verdict is now produced by the
shipped check against a stubbed endpoint, but a real CORS refusal and a real wrong-chain third-party
host are not covered and stay with test 15.

**Test 10 was checked clause by clause for full retirement and is NOT retired.** Two of its three
clauses have rows. The third, "the next-step line reads correctly", is uncovered:
`TERMINAL_NEXT_STEP_LINE` (`packages/web/src/components/cohort/CohortPage.tsx:18`) is exported and
rendered at `:212`, and `grep -rn` over `packages/web/src` and `packages/web/tests` finds no test
that reads it, so its wording could change unnoticed. `CohortPage.tsx` is not in this plan's
`files_modified`, so the pin was left to whoever owns that file rather than guessed at, with the
gap named in the ledger and the recommendation recorded (a render of the terminal card would also
cover the one thing no store row can: that the named cancel and the next-step line appear TOGETHER
on the card a participant sees).

Test 4's own remaining clauses are named too: the rung-2 k-of-n consequence wording and the
in-flight disable-both-buttons behavior, which is behind a click. `## Summary` counts are untouched;
05-27 reconciles them.

## Deviations from Plan

**1. The audit's cross-network row shape was impossible and was replaced, not approximated.**
Documented in full above. Store `mutinynet` plus a stubbed regtest genesis yields `unreachable` via
the A3 refusal, never `mismatch`, so the row as specified would have asserted something the shipped
code cannot produce. The shared-genesis pair reaches `mismatch` and makes the store's own chain the
only thing that can separate the two candidates, which is a strictly sharper form of the same
property.

**2. The plan's acceptance criterion "All four refusal rows must go RED" could not be met as
written**, and mutation 1b was added to close the gap honestly rather than leaving the fourth row
unproven. Reasoning above.

**3. The legacy spec's post-seat describe gained a `fetch` stub, which the plan did not name.**
The plan asked for the call sites to be updated "mechanically, passing a fixed base url", and doing
only that would have had those rows attempt a real network call the moment the streak completed. The
stub keeps them hermetic; a 404 is `unreachable`, which upgrades nothing, so no assertion in that
file changed. Stated because the plan's read-only regression rule for that file is strict.

**4. `grep -rlP '\x{2014}' packages/web/tests` lists three files, and could not have listed none.**
The same residual 05-21, 05-22 and 05-23 all recorded: `psbt.spec.ts:455`, `lifecycle.spec.ts:494`
and `settings.spec.ts:212` each contain the character INSIDE the regex literal of their own
em-dash guard. None is a file this plan touched. The property that matters holds: the scan over
`participant-fate.spec.ts`, `tx-client.spec.ts`, `operator.spec.ts`, `participant.spec.ts`,
`participant.ts`, `cohort-fate.ts` and `05-UAT.md` returns nothing.

## Verification

| Check | Result |
|-------|--------|
| `pnpm test` | green, **66 files / 1125 tests** (05-23 left it at 65 / 1106, so +1 file and +19 tests; no assertion deleted or loosened) |
| `pnpm vitest run packages/web/tests/participant-fate.spec.ts` | green, 12 (new) |
| `pnpm vitest run packages/web/src/stores/participant.spec.ts` | green, 65 (baseline 65: mechanical edits only) |
| `pnpm vitest run packages/web/tests/tx-client.spec.ts` | green, 48 (baseline 45) |
| `pnpm vitest run packages/web/tests/operator.spec.ts` | green, 17 (baseline 13) |
| `pnpm typecheck` | green |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:browser:participant` | **PASSED** (real headless Chromium, full directory to resolve loop). Run because this plan changes a shipped store signature. |
| `git diff --stat pnpm-lock.yaml` | empty (T-05-24-SC: no package installed) |
| `git diff` on `esplora.ts`, `cohort-fate.ts`, `operator.ts` | EMPTY: every mutation reverted |
| `git diff` on `participant.ts` | one functional line, `baseUrl?: string` to `baseUrl: string`, plus its docstring paragraph |
| the gone-streak constant | unchanged; `terminal-reason.spec.ts`'s source pin on `const POST_SEAT_GONE_CONFIRMATIONS = 2;` still passes |

Per-task counts: 1106 (baseline) to 1118 (task 1) to 1121 (task 2) to 1125 (task 3).

## Threat mitigations

| Threat ID | Disposition | How |
|-----------|-------------|-----|
| T-05-24-01 | mitigated | All four failure shapes plus two acceptances exercised at the STORE, each asserting the flag and the rendered sentence, so only a 200 carrying the boolean true can produce an attribution. Mutations 1 and 1b are RED. |
| T-05-24-02 | mitigated | The parameter is required, so a dropped argument is a compile error the gate catches. Mutation 2 is RED at `tsc -b`. |
| T-05-24-03 | mitigated | A cross-network row plus per-row request counts. Mutation 3 is RED on the new row and GREEN on all six pre-existing ones, which is the demonstration the plan asked for. |
| T-05-24-04 | mitigated | Both lifecycle verbs assert the shared expiry path resets auth, reason, view and busy flag, with a 404 and a 409 row proving the 401 is a branch. Mutation 5 is RED. |
| T-05-24-SC | mitigated | Zero packages installed; empty lockfile diff. |

## The honest limits, restated

1. **Nothing here renders.** The terminal card, the endpoint disclosure and the console drill-down
   are asserted as store facts and pure verdicts, not as markup. The wire between the store fact and
   the pixel for THIS plan's surfaces is not asserted, which is exactly why UAT test 10 keeps its
   next-step-line clause with a human.
2. **The endpoint rows produce every verdict against a stubbed endpoint.** A real cross-origin
   refusal cannot be manufactured in the node environment, and the `browser-rejected` verdict is
   documented as best-effort by the shipped code itself. Test 15 still needs real third-party hosts.
3. **The round guard is proven for a changed cohort id, not for a changed status.** The store's
   guard checks both; a row that changed `status` away from `failed` would be asserting a state the
   shipped teardown cannot reach from here, so it was not written rather than faked.

## Known Stubs

None. No placeholder values, no unwired data sources, no skipped tests, and no unrun `<verify>`
chain in this plan.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no schema change
at a trust boundary.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | `965fb7c` | `test(05-24): stop a fault accusing an operator, and make the page origin undroppable` |
| 2 | `c35265b` | `test(05-24): prove the endpoint check is given this participant's own chain` |
| 3 | `a4fc395` | `test(05-24): route a mid-session logout on both lifecycle verbs through the shared expiry path` |

## Self-Check: PASSED

Files verified present on disk: `packages/web/tests/participant-fate.spec.ts`,
`packages/web/src/stores/participant.ts`, `packages/web/src/stores/participant.spec.ts`,
`packages/web/tests/tx-client.spec.ts`, `packages/web/tests/operator.spec.ts`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md`.
Commits verified in `git log`: `965fb7c`, `c35265b`, `a4fc395`.
