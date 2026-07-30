---
phase: 05-operator-cohort-lifecycle-control
plan: 26
subsystem: operator-service-wiring-and-proof-format
tags: [gap-closure, coverage, mutation-testing, boot-wiring, audit-trail, refusal-copy, known-answer-vectors]
status: complete
requires:
  - "packages/service/src/index.ts: the runtime-settings construction (the ceiling seeded from cohortTtlMs) and the addTestPeers spawn callback with its live-only disclosure"
  - "packages/service/src/hono-adapter.ts: the pause / resume / broadcast-disable routes, each reading prior state before the call"
  - "packages/service/src/monitor.ts: the operator-actions ring and its consecutive-duplicate skip, which is what masked every existing sequence"
  - "packages/shared/src/tos.ts: termsHashHex and termsAcceptanceSigningBytes (SVC-05, D-19)"
provides:
  - "packages/service/tests/runtime-settings.spec.ts: the first test that boots a REAL service and reads its exposed settings holder, proving the discovery-window ceiling is SEEDED rather than injected"
  - "packages/service/tests/lifecycle-routes.spec.ts: three interleaved toggle sequences the monitor ring's own duplicate skip cannot satisfy, each with a positive control"
  - "packages/service/tests/pause.spec.ts: a literal pin and a raw-library-phrasing guard for ADVERTISING_PAUSED_REASON, the treatment its two siblings already had"
  - "packages/service/tests/test-peers.spec.ts: the live and hermetic pair driven through the shipped createService spawn path over real HTTP with real participants"
  - "packages/shared/tests/tos.spec.ts: three known-answer SHA-256 vectors and the signing-bytes identity, the first assertions in the repo that do not compare the digest to itself"
  - "a dated correction in 05-18-SUMMARY.md about the boot seed that was named and pinned by nothing"
  - "five new rows in the 05-UAT automation ledger, and clause-by-clause retirement checks on tests 2 and 9 both recorded PARTIAL"
affects:
  - packages/service/tests/runtime-settings.spec.ts
  - packages/service/tests/lifecycle-routes.spec.ts
  - packages/service/tests/pause.spec.ts
  - packages/service/tests/test-peers.spec.ts
  - packages/shared/tests/tos.spec.ts
  - .planning/phases/05-operator-cohort-lifecycle-control/05-18-SUMMARY.md
  - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
tech-stack:
  added: []
  patterns:
    - "asserting a boot-supplied value by NEVER supplying it: the new rows read the holder through the service handle rather than constructing it, so the six rows that hand-inject the same knob stay valid and stay green"
    - "interleaving a DIFFERENT recorded action between two identical ones, so a downstream deduplicating ring cannot answer for an upstream transition guard"
    - "counting occurrences of one entry's own text rather than checking array length, so an unrelated entry landing in between cannot change the result"
    - "proving a negative-pattern guard fires against an INLINE fixture rather than by editing the shipped constant, because a guard verified by mutating what it guards is a guard nobody can trust afterwards"
    - "known-answer vectors from an implementation with no relationship to this codebase (published SHA-256 vectors, GNU coreutils sha256sum), because a self-consistent assertion is the one shape that cannot fail when the function changes"
    - "pinning a NON-ASCII vector beside the ASCII ones, so the encoding step is pinned as well as the digest"
decisions:
  - "The boot-seed block boots a real `createService` WITHOUT the `vi.mock` runner recipe from `create-service-advert-ttl.spec.ts`. A module mock is hoisted over the whole file and `runtime-settings.spec.ts` already constructs a real runner and transport in `draftDefaultsApp`; mocking would have broken five shipped rows to save milliseconds on five new ones."
  - "The mutation's acceptance is ASYMMETRIC and was observed as such: three new rows RED, all six hand-injected ceiling rows GREEN. If the existing rows had also reddened, the block would have been written against the holder again rather than against a boot."
  - "Two extra guard-deletion mutations were run beyond the one the plan named (resume and broadcast-disable, not only pause), because the round's rule is that an assertion is not load-bearing until its own mutation is observed. Each reddened exactly one row."
  - "The live test-peer pair fakes NOTHING, not even the participant factory the plan permitted. `createService` exposes no peer-factory seam, and a `vi.mock` of the participant package would have poisoned the two shipped service-level rows in the same file that deliberately use REAL peers. One peer is requested into a two-seat cohort so the cohort never fills and no signing path is entered."
  - "A second, unplanned test-peer mutation was run: deleting the disclosure CALL outright, not only its live guard. The guard deletion reddens the hermetic mirror and the call deletion reddens the live row; only both together prove the pair discriminates in both directions."
  - "The non-ASCII digest vector was taken from GNU coreutils `sha256sum`, an independent implementation, rather than computed with the function under test. That is the whole point of the row."
  - "`packages/service/tests/test-peers.spec.ts` carried the repo's one em-dash (inside its own guard regex, from 05-09). Since this plan owns the file, the character was converted to the `\\u2014` escape, so the repo-wide scan the guard exists to satisfy now returns nothing."
metrics:
  duration: ~55m
  completed: 2026-07-30
---

# Phase 5 Plan 26: Four server-side facts that were only ever asserted against stand-ins Summary

Each of these five defects had MORE coverage than most things in the repo, and each of them covered
a stand-in. Six rows proved a ceiling clamps and none proved a real boot ever supplies it. Three rows
proved a repeated toggle records once and every one was green whether or not the route guard existed.
The live test-peer caveat had a route spec that re-typed the callback and skipped the branch. And
every terms-hash assertion in three spec files compared the function to itself.

Seven mutation runs, all observed, all reverted. `git diff` over every source file this plan touched
is EMPTY: this plan changes no shipped behavior at all.

## Gap source

`.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT-2.md`. This plan closes **#6**
(entry 7), **#5** (entry 12, marked warn), **#2** (entry 13), **#11** (entry 18) and the SERVER half
of **#1** (entry 20). The web half of #1, the rendered advertise-control guards, was closed in 05-23;
both halves cite each other so #1 is counted once.

## #5: six rows about a rule, none about the wiring

`createRuntimeSettings` clamps an over-ceiling discovery-window seed, refuses an over-ceiling save,
and warns with both numbers. All of that was already proven, in six rows, and every one of them
passes `discoveryWindowCeilingMs` into the holder's own constructor. The route home in
`lifecycle-routes.spec.ts` builds a ceiling-free holder. So the one line that supplies the ceiling on
the product path, `discoveryWindowCeilingMs: opts.cohortTtlMs` inside `createService`, was covered by
nothing at all.

The consequence is a promise the service cannot keep. An over-ceiling `DEFAULT_DISCOVERY_WINDOW_MS`
would have been served as this service's `env default` with `changed: false`, captioned to the
operator as configuration they can rely on, while `armWindowTimer` returns early at or above the TTL
so no app timer is ever armed and the cohort lapses with the generic expired fate instead of the
app's own window-expired reason. And `PUT /v1/operator/settings` would have accepted a discovery
window the runner's TTL overrules.

Five rows in `packages/service/tests/runtime-settings.spec.ts`, none of which touches the knob:

| Row | Drives | Asserted |
|-----|--------|----------|
| clamped boot | `createService({ cohortTtlMs: 30m, defaultDiscoveryWindowMs: 60m })` | `value` AND `envDefault` both 30m, `changed` false |
| unclamped control | the same boot with a 5m default | 5m in both halves, so the clamp is proven to BOUND rather than to overwrite |
| refused save | `applySettings({ defaultDiscoveryWindowMs: 45m })` on a real boot | the exact `discoveryWindowCeilingError(30m)` sentence, and the stored value unmoved |
| the boundary | a save at exactly the TTL | accepted, so equal is proven not to be over |
| the loud warning | `console.warn` spy over the clamped boot | exactly one `defaultDiscoveryWindowMs` line, carrying the `[settings]` prefix and BOTH numbers |

The six existing rows are byte-unchanged. They were always right about the rule, and the audit did
not dispute them.

### The correction to 05-18

`05-18-PLAN.md:112` named `packages/service/src/index.ts` as "where the ceiling is provably available
at seed time" and pinned nothing there. `05-18-SUMMARY.md` now carries a dated correction saying so
in those terms, and naming what deleting the seed would have cost.

## #2: three guards indistinguishable from no guard

`hono-adapter.ts` reads the prior state before pause, resume and disable-broadcast, and records an
operator action only on a real transition. The obvious test for that, two identical actions back to
back, is worthless here: the operator-actions ring in `monitor.ts` skips a consecutive duplicate
ITSELF, so `pause -> pause` yields one entry with the guard present and with it deleted. Every
existing sequence in the repo has that shape, including the false green the audit names at
`kill-switch.spec.ts:305-317`.

So each new row drives a DIFFERENT recorded action BETWEEN the two identical ones. That breaks the
ring's adjacency test and leaves the route guard as the only thing that can hold the count at one.

| Row | Sequence | Asserted |
|-----|----------|----------|
| pause | pause, RENAME, pause | exactly one `Paused advertising.`, and the whole log equals `[paused, renamed]` so the interleave is proven to have landed |
| pause control | pause, resume, pause | TWO pause entries, because the operator really did pause twice: the guard is about STATE, not about suppressing repeated text |
| resume | resume, RENAME, resume, on a service that boots unpaused | ZERO resume entries |
| resume control | pause, resume | exactly one |
| broadcast | disable, CANCEL a cohort, disable | exactly one `Disabled broadcast for new cohorts.`, and the whole log equals `[disabled, canceled]` |
| broadcast control | one disable | exactly one, which is all this one-way switch will ever have |

Each row counts occurrences of its own entry text rather than checking array length, so the
interleaved entry cannot change the answer.

The consequence this protects: the operator-actions log is the audit trail for who stood
broadcasting down and when. A guard lost to a refactor fills it with bogus duplicates, and a record
of decisions stops being a record of decisions.

## #1 (server half): the refusal string nobody read

Both existing assertions compare the 409 body against the imported `ADVERTISING_PAUSED_REASON`,
which proves the ROUTE emits this service's own reason and says nothing about what the reason SAYS.
The e2e leg checks truthiness. Both siblings were already guarded: `NO_SEATS_REASON` is pinned byte
for byte and `NOT_SIGNING_REASON` carries a library-leak guard, so this is the treatment catching up
rather than a new idea.

Five rows in `packages/service/tests/pause.spec.ts`: the literal pin, a lowercase-clause assertion
(the console interpolates the reason into `Could not advertise: {reason}.`), the raw-library-phrasing
guard, a row proving that guard FIRES against an inline fixture, and a long-dash guard.

The guard is composed from the shapes the reason's own JSDoc warns about, taken from the library's
phrasing (`Cannot start fallback for cohort {id}: phase is {phase}.`):
`/Cannot |cohort .*:|phase is|INVALID_PHASE|advertiseCohort/i`. It is shown to fire against
`'Cannot advertise cohort 9f3c21ab: phase is Advertised.'` supplied inline in the test, never by
editing the shipped constant: a guard verified by mutating the thing it guards is a guard nobody can
trust afterwards.

## #11: a branch no test could reach

`createService`'s own spawn callback records two unconditional entries and, only on a live boot, the
honest note that these peers' own DID registrations are skipped. The route matrix in
`lifecycle-routes.spec.ts` re-types its own `onSpawned` with the two unconditional entries and omits
the live branch entirely. No spec called `service.addTestPeers` at all.

That is how a branch nobody drives ships green in BOTH directions: delete the `mode === 'live'` guard
and every hermetic run gains a caveat that is false; delete the call and a live operator believes
their test peers' DIDs were registered when they were not. (The second was caught by `pnpm lint`'s
unused-import rule, which is not part of `pnpm test`.)

Two rows in `packages/service/tests/test-peers.spec.ts` fake **nothing**. Two real services, one live
with a broadcaster and one hermetic, each started on a real ephemeral port, each driven through the
real gated route with a real operator session, each spawning a real participant that really joins.
The only stand-in anywhere is the counting esplora connection the live boot needs in order to exist,
and no case reaches a beacon tx.

**Only ONE peer is requested, into a two-seat cohort.** A filled cohort starts signing, which is a
different code path and, on the live boot, one that wants a funded beacon address.

**Both rows assert the two unconditional entries.** Without them the hermetic row's `not.toContain`
would pass just as happily against a spawn that logged nothing at all.

## #6: every assertion compared the function to itself

`termsHashHex` had a shape assertion (`/^[0-9a-f]{64}$/`), a stability assertion (the function
against itself), a sensitivity assertion (the function against itself on a different input) and a
UTF-8 assertion (the function against itself). The same in `packages/web/tests/terms.spec.ts` and at
the service's verification site. Swap sha256 for any other 32-byte digest in the pinned
`@noble/hashes` and every one of them stays green, because both sides of every comparison move
together.

The consequence is not internal. The acceptance record is a FROZEN proof format (SVC-05, D-19): a
third party handed a stored acceptance verifies it with STANDARD SHA-256. A digest swap would leave
this repo entirely self-consistent while making every stored acceptance unverifiable by anyone
outside it, and the break would surface as an unexplainable mismatch long afterwards.

| Row | Input | Expected, and where it came from |
|-----|-------|----------------------------------|
| empty string | `''` | `e3b0c442...b855`, the published SHA-256 test vector |
| ASCII | `'abc'` | `ba7816bf...15ad`, the published SHA-256 test vector |
| NON-ASCII | `'Sé excelente.'` | `0244e5b9...bc55`, from GNU coreutils `sha256sum` over the same UTF-8 bytes |

The non-ASCII row pins the ENCODING step as well as the digest: a swap to latin1 or UTF-16 reddens
it while leaving the two ASCII rows untouched.

Plus the signing-bytes identity: `termsAcceptanceSigningBytes(record)` is asserted EQUAL to
`hexToBytes(termsAcceptanceHashHex(record))`, so the two derivations are pinned as one value rather
than two that agree today. The browser signs those bytes, the service verifies against them, and the
SAME hash is the store key the verified artifact is written under; if the signing input ever stopped
being that hash, a stored acceptance would be filed under a key its own signature does not cover. A
second row asserts the signing bytes are never the plain terms-text hash, so an acceptance signature
cannot be replayed as a signature over the terms document itself.

## Mutation runs, as observed

Every mutation was applied to shipped source, run, observed and reverted.
`git diff packages/service/src packages/shared/src packages/web/src` after the round is **EMPTY**.

| # | Mutation | Predicted | OBSERVED |
|---|----------|-----------|----------|
| 1 | **Plan task 1:** delete `discoveryWindowCeilingMs: opts.cohortTtlMs` from the holder construction in `index.ts` | the new rows RED, the six hand-injected rows green | **Exactly that asymmetry. 3 failed / 38 passed of 41.** RED on the clamped boot (`expected 3600000 to be 1800000`), the refused save (`expected undefined to be 'This service ends a cohort after 30 minutes...'`) and the loud warning (`expected [] to have a length of 1 but got +0`). Every one of the six existing ceiling rows stayed GREEN, which is the demonstration that they were the hole. |
| 2 | **Plan task 2:** delete the PAUSE route's transition guard in `hono-adapter.ts` | the interleaved pause row RED | **1 failed / 94 passed of 95** across `lifecycle-routes`, `pause` and `kill-switch`. RED on exactly `pauses, records something ELSE, then pauses again` (`expected 2 to be 1`). `kill-switch.spec.ts`'s own idempotence row, the false green the audit named, stayed GREEN, as did every other pre-existing row. |
| 3 | **Added:** delete the BROADCAST-DISABLE transition guard | not predicted by the plan | **1 failed / 74 passed of 75.** RED on exactly the interleaved kill-switch row (`expected 2 to be 1`). Run because the plan named only the pause guard, and this round's rule is that an assertion is not load-bearing until its own mutation is observed. |
| 4 | **Added:** delete the RESUME transition guard | not predicted by the plan | **1 failed / 74 passed of 75.** RED on exactly the interleaved resume row (`expected 2 to be +0`). The shipped `records pause, resume, cancel, and finalize as self-contained sentences` row stayed GREEN, correctly: its resume IS a genuine transition, which is precisely why it could never see this. |
| 5 | **Plan task 2:** reword `ADVERTISING_PAUSED_REASON` to `'Cannot advertise cohort: phase is paused.'` | the literal pin RED | **3 failed / 17 passed of 20.** RED on the literal pin, the lowercase-clause row (`expected 'C' to be 'c'`) and the raw-library-phrasing guard. All eight pre-existing symbolic rows stayed GREEN, which is the audit's claim confirmed empirically. |
| 6 | **Plan task 3:** delete the `mode === 'live'` guard on the registration-skipped entry | the hermetic mirror RED | **1 failed / 75 passed of 76.** RED on exactly `records NO such note on the hermetic boot` (`expected [ Array(2) ] to not include 'Test peers co-sign this cohort, but...'`). The live row stayed green, correctly: the entry is still recorded, just everywhere. |
| 7 | **Added:** delete the disclosure CALL outright, not only its guard | not predicted by the plan | **1 failed / 22 passed of 23.** RED on exactly the LIVE row (`expected [ 'Operator added 1 test peers.' ] to include 'Test peers co-sign this cohort, but...'`), and `pnpm lint` also errored on the now-unused import. Run because mutation 6 proves the hermetic mirror load-bearing and says nothing about the live row; only both together show the pair discriminates in both directions. |
| 8 | **Plan task 3:** swap `sha256` for `sha3_256` in `packages/shared/src/tos.ts` | both vectors RED | **4 failed / 13 passed of 17.** All THREE known-answer vectors RED, plus the signing-bytes identity (`termsAcceptanceSigningBytes` took the swapped digest while `termsAcceptanceHashHex` goes through `canonicalHash` from `@did-btcr2/common`, which did not, so the two derivations came apart). **All 13 pre-existing assertions in the file stayed GREEN**, which is defect #6 reproduced exactly as written. |

Seven distinct mutations, eight runs counting the asymmetric one. Three of them were added beyond
the plan's four, in each case because a planned mutation left a new assertion unproven.

## The UAT automation ledger

Five rows appended: test 1 (the boot clamp warning naming both numbers), test 2 (the over-ceiling
save refused with the real maximum named in minutes), test 6 (the paused-advertise refusal reason),
test 7 (a save with one invalid field applies nothing and every rendered field still shows what the
service holds) and test 9 (the live-cohort registration disclosure).

**Test 7's row is recorded as pre-existing rather than claimed.** The plan said to check before
claiming it, and the check found the clause already covered on both sides:
`runtime-settings.spec.ts`'s "applies NOTHING when any field in the patch is invalid" on the service
side, and `packages/web/tests/settings.spec.ts`'s whole "a rejected save leaves the rendered snapshot
exactly as the service holds it" block on the rendered side. It is entered in the ledger as
`pre-existing, recorded 05-26`.

**Test 1's row retires nothing.** Test 1 already passed by eye. The row records that the clause is
now a script rather than an observation somebody made once, so 05-27 can narrow test 1 honestly
instead of leaving a passed item carrying a clause a script proves.

**Test 2 was checked clause by clause and is NOT retired.** Four of five clauses have rows. The
fifth, "`Cancel edit` closes the form without destroying anything", is uncovered and is behind a
click: nothing renders `DraftEditForm` and no store test invokes the cancel-edit action, so both the
form-state reset and the draft's survival are unexercised.

**Test 9 was checked clause by clause and is NOT retired.** Its live clause is closed here and its
zero-seat disabled reason was closed by 05-22. What remains is the COPY of the test-peer confirm
family. 05-22 pinned the four STATIC constants plus `NO_SEATS_LEFT_REASON`, with an em-dash guard
over exactly those five; the four INTERPOLATED ones are pinned by nothing. That matters more than it
sounds: `addTestPeersHelp` is where "throwaway keys created inside this process" actually lives, so
test 9's help-line clause and half of its "co-sign for real with throwaway keys" clause both ride on
an unpinned string, and `liveTestPeersLine` is the console-side twin of the very service-side note
this plan just pinned. `packages/web/tests/service-controls.spec.ts` is not in this plan's
`files_modified` and no other plan in this round claims it, so the pins were left to their owner with
the recommended shape named in the ledger rather than guessed at.

`## Summary` counts are untouched; 05-27 reconciles them.

## Deviations from Plan

**1. Three mutations were added.** The plan asked for four (one per task 1 and 3, two in task 2).
Mutations 3, 4 and 7 were added because a planned mutation left a new assertion unproven: the pause
guard says nothing about the resume and broadcast rows, and the live-guard deletion says nothing
about the live row. Same reasoning 05-24 and 05-25 used for their own added mutations.

**2. The live test-peer pair fakes NOTHING, not even the participant factory the plan permitted.**
`createService` exposes no peer-factory seam (its `createTestPeers` call passes no `createPeer`), so
the only way to fake it would be a `vi.mock` of `@btcr2-aggregation/participant`, which is hoisted
over the whole file and would have poisoned the two shipped service-level rows that deliberately use
REAL peers against a REAL started service. Real peers over a real ephemeral port cost about 60 ms and
are strictly stronger than the plan required.

**3. The boot-seed block does not reuse `create-service-advert-ttl.spec.ts`'s runner mock.** The plan
named that recipe. It is a `vi.mock` of `@did-btcr2/aggregation/service`, hoisted over the whole
file, and `runtime-settings.spec.ts` already constructs a real runner and transport in
`draftDefaultsApp` for five shipped rows. A real unstarted `createService` is cheap enough (the five
new rows add 30 ms) and breaks nothing.

**4. [Rule 2] The pre-existing em-dash in `test-peers.spec.ts` was converted to an escape.** 05-25
recorded that `grep -rlP '\x{2014}' packages/service/tests` "lists one file and could not have listed
none", because `test-peers.spec.ts` carries the character inside its own em-dash guard's regex
literal (committed in 05-09). This plan's acceptance criterion asks for zero files, and this plan
owns that file, so the literal became a `\u2014` escape with a comment saying why. Same treatment applied
to the new guard in `pause.spec.ts`. The scan over `packages/service/tests` and
`packages/shared/tests` now returns nothing.

## Verification

| Check | Result |
|-------|--------|
| `pnpm test` | green, **66 files / 1160 tests** (05-25 left it at 66 / 1137, so +23 tests and no new file; no assertion deleted or loosened) |
| `pnpm vitest run packages/service/tests/runtime-settings.spec.ts` | green, 41 (baseline 36) |
| `pnpm vitest run packages/service/tests/lifecycle-routes.spec.ts` | green, 53 (baseline 47) |
| `pnpm vitest run packages/service/tests/pause.spec.ts` | green, 20 (baseline 15) |
| `pnpm vitest run packages/service/tests/test-peers.spec.ts` | green, 23 (baseline 21) |
| `pnpm vitest run packages/shared/tests/tos.spec.ts` | green, 17 (baseline 12) |
| `pnpm vitest run packages/service/tests/create-service-advert-ttl.spec.ts` | green, 5, file UNCHANGED (read-only regression) |
| `pnpm vitest run packages/service/tests/kill-switch.spec.ts` | green, 42, file UNCHANGED (read-only regression) |
| `packages/service/tests/tos.spec.ts` | UNCHANGED; ran inside `pnpm test` (read-only regression) |
| `pnpm typecheck` (`tsc -b`, the first half of `pnpm test`) | green |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:gate` | **PASSED, exit 0**, every hermetic leg. Run because this plan boots real services in unit tests and transiently mutated `index.ts`, `hono-adapter.ts`, `operator-cohorts.ts` and `tos.ts`; `git diff` was confirmed empty over all of them first |
| `git diff --stat pnpm-lock.yaml` | empty (T-05-26-SC: no package installed) |
| `git diff` on `packages/service/src`, `packages/shared/src`, `packages/web/src` | **EMPTY**: every mutation reverted, and this plan's only non-test changes are two planning documents |
| `grep -rlP '\x{2014}' packages/service/tests packages/shared/tests` | **no files** (see deviation 4) |

Per-task suite counts: 1137 (baseline) to 1142 (task 1) to 1153 (task 2) to 1160 (task 3).

## Must-have truths

| Truth | Status |
| --- | --- |
| The ceiling is proven SEEDED at boot by reading a real service's exposed settings, not by hand-injecting the knob | met (five rows, none of which passes `discoveryWindowCeilingMs`) |
| Deleting the boot seed makes a real service accept a settings save the runner's TTL would overrule, and that now fails | met (mutation 1, RED on the refused-save row) |
| The three no-op guards are distinguished from having no guard, using a DIFFERENT interleaved action | met (three interleaved rows plus three positive controls; mutations 2, 3, 4 each RED on exactly one) |
| The advertising-paused reason is pinned as a literal and guarded against raw library phrasing | met (mutation 5 RED on three rows) |
| The live disclosure is driven through a real service with a broadcaster, with a hermetic mirror asserting absence | met (mutations 6 and 7 RED in opposite directions) |
| The terms hash has a KNOWN-ANSWER vector, and the signing bytes are proven to BE the canonical hash | met (mutation 8 RED on all four; all 13 pre-existing rows green) |

## Prohibitions

| Prohibition | Held |
| --- | --- |
| MUST NOT assert the duplicate-action guards with two identical actions in a row | held: every one of the three drives a rename or a cancel in between, and each row also asserts the whole log so the interleave is proven to have landed |
| MUST NOT hand-inject the ceiling knob in the new boot row | held: `discoveryWindowCeilingMs` appears nowhere in the new block; the boot supplies it from `cohortTtlMs` |
| MUST NOT compare a hash function against itself | held: three externally sourced hex literals, two of them published SHA-256 vectors and one from GNU coreutils |
| MUST NOT re-type the `onSpawned` callback to reach the live disclosure | held: the pair goes `fetch` to the real gated route on a real started service, so the shipped closure in `index.ts` is the one that runs |
| No new packages, no new vitest config, no `any` / `@ts-expect-error` / non-null assertions | held: empty lockfile diff, no config file added, and the only cast is the existing `as unknown as BitcoinConnection` idiom this repo already uses for esplora stubs |

## Threat mitigations

| Threat ID | Disposition | How |
|-----------|-------------|-----|
| T-05-26-01 | mitigated | Three known-answer vectors (including a non-ASCII one pinning the encoding) plus the signing-bytes identity. Mutation 8 is RED on all four while every pre-existing row stays green. |
| T-05-26-02 | mitigated | Interleaved sequences the ring's own duplicate skip cannot satisfy, plus a positive control per toggle. Mutations 2, 3 and 4 each redden exactly one row. |
| T-05-26-03 | mitigated | The shipped spawn path driven in both modes over real HTTP. Mutation 6 reddens the hermetic mirror, mutation 7 the live row. |
| T-05-26-04 | mitigated | Literal pin plus a raw-library-phrasing guard proven to fire against an inline fixture. Mutation 5 is RED. |
| T-05-26-SC | mitigated | Zero packages installed; empty lockfile diff. The digest mutation used `sha3_256` from the already-pinned `@noble/hashes`, and was reverted. |

## The honest limits, restated

1. **Nothing here renders.** These are service-side facts. That the console DISPLAYS the ceiling
   refusal, the paused reason, or the test-peer caveat is asserted nowhere by this plan; the
   rendered halves live in 05-22 and 05-23's work, and the interpolated test-peer confirm copy is
   pinned by nobody at all (recorded in the ledger).
2. **The live test-peer rows prove a live-MODE service records the caveat.** They do not prove
   anything about a real chain: the esplora connection is a stub and no cohort here reaches a beacon
   tx. UAT test 17 still needs a real `LIVE=1 BROADCAST=1` boot.
3. **The known-answer vectors pin `termsHashHex` and the signing bytes.** They do not pin
   `termsAcceptanceHashHex` itself against an external answer, because that value goes through
   `canonicalHash` from `@did-btcr2/common` and its canonicalization is the library's contract, not
   this app's. What IS pinned is that the signing input equals it, which is the property a verifier
   depends on.
4. **The interleaved sequences prove each route guard exists.** They say nothing about the ring's
   own duplicate skip, which remains covered by its shipped rows; the point here was to stop the ring
   from ANSWERING for the guards.

## Known Stubs

None. No placeholder values, no unwired data sources, no skipped tests, and no unrun `<verify>` chain
in this plan.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no schema change
at a trust boundary. It changes no shipped source at all.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | `08baa08` | `test(05-26): boot a real service and prove the discovery-window ceiling is seeded, not injected` |
| 2 | `76670d9` | `test(05-26): distinguish the no-op action guards from having no guard at all` |
| 3 | `d09116b` | `test(05-26): drive the live test-peer disclosure through the shipped path and give the terms hash a known answer` |

## Self-Check: PASSED

Files verified present on disk: `packages/service/tests/runtime-settings.spec.ts`,
`packages/service/tests/lifecycle-routes.spec.ts`, `packages/service/tests/pause.spec.ts`,
`packages/service/tests/test-peers.spec.ts`, `packages/shared/tests/tos.spec.ts`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-18-SUMMARY.md`,
`.planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md`.
Commits verified in `git log`: `08baa08`, `76670d9`, `d09116b`.
