---
phase: 05-operator-cohort-lifecycle-control
plan: 29
subsystem: ui
tags: [esplora, chain-identity, participant, part-05, gap-closure, vitest]

requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the participant-side chain endpoint guard (05-11), its E16 copy (ChainEndpointPanel) and the shared network registry's genesisHash/distinguishingBlock pair"
provides:
  - "classifyEndpoint identifies the observed chain from block zero FIRST, so a foreign genesis returns `mismatch` naming both chains instead of `unreachable`"
  - "the distinguishing-marker requirement narrowed to the one case it was written for: an observed genesis that already equals ours (the signet family's shared block zero)"
  - "default-network foreign-chain coverage the suite never had: mainnet, testnet3, testnet4, regtest and an unregistered chain, at both the pure and the orchestrated level"
  - "a whole-registry no-new-acceptance row proving the reordering widened acceptance for nothing"
  - "a UAT walk (05-UAT.md test 15, plus two procedures) pointed at the verdict the shipped code now produces"
affects: [05-verification, part-05 live UAT, participant chain endpoint]

tech-stack:
  added: []
  patterns:
    - "Chain identity is decided by block zero first; a second marker is corroboration only where block zero is ambiguous"
    - "A safety-relevant reordering carries a whole-registry row asserting no observation newly returns `ok`"

key-files:
  created: []
  modified:
    - packages/web/src/lib/esplora.ts
    - packages/web/tests/tx-client.spec.ts
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT-PROCEDURES.md

key-decisions:
  - "Gated the new branch on the GENESIS COMPARISON, not on `theirName === null` as 05-REVIEW.md sketched: identifyChain successfully names mainnet, testnet3, testnet4 and regtest, so the sketched gate would have been skipped for exactly the four families the gap is about"
  - "Wrote the no-new-acceptance row as an exact-shape assertion (ok appears only for our own unambiguous chain, and every foreign block zero reads `mismatch`) rather than the plan's literal 'no case returns ok', which cannot pass because our own chain legitimately returns ok"
  - "Corrected 05-UAT-PROCEDURES.md test 5 step 23 as well as test 15 step 14: both stated the old unreachable expectation and would have had the owner report the fix as a regression"
  - "Left 05-VERIFICATION.md untouched: it is the dated record of the gap being found, and the next verification pass supersedes it"

patterns-established:
  - "Test matrices must pair the project's OWN default configuration with the adversarial case, not only the rule in the abstract: every pre-existing mismatch row used `ourNetwork: 'regtest'` or signet-vs-signet, which is why a complete-looking matrix shipped green over this defect"

requirements-completed: [PART-05]

coverage:
  - id: D1
    description: "On mutinynet (DEFAULT_NETWORK), a foreign chain family's endpoint is refused with `mismatch` naming both chains rather than reported as an unreachable host"
    requirement: PART-05
    verification:
      - kind: unit
        ref: "packages/web/tests/tx-client.spec.ts#names bitcoin against the DEFAULT network, where no second marker can ever arrive (plus the testnet3, testnet4 and regtest rows)"
        status: pass
      - kind: unit
        ref: "packages/web/tests/tx-client.spec.ts#names a mainnet endpoint on the DEFAULT network, in ONE request"
        status: pass
    human_judgment: false
  - id: D2
    description: "An unregistered chain on the default network is refused with the honest unrecognized-chain string, never a guessed network name"
    requirement: PART-05
    verification:
      - kind: unit
        ref: "packages/web/tests/tx-client.spec.ts#names an unregistered chain honestly on the DEFAULT network too"
        status: pass
    human_judgment: false
  - id: D3
    description: "The change moved a verdict between two refusals and accepted nothing new: across every registry pairing with no marker observed, `ok` appears only for our own unambiguous chain"
    verification:
      - kind: unit
        ref: "packages/web/tests/tx-client.spec.ts#accepts NOTHING new: every registry pairing, with no marker observed"
        status: pass
    human_judgment: false
  - id: D4
    description: "The marker requirement was narrowed, not deleted: our own genesis without the required marker is still `unreachable`, and an unreadable height-one marker is still `unreachable` in exactly two requests"
    verification:
      - kind: unit
        ref: "packages/web/tests/tx-client.spec.ts#refuses rather than passing when a required second marker was not observed"
        status: pass
      - kind: unit
        ref: "packages/web/tests/tx-client.spec.ts#refuses an endpoint whose required second marker cannot be read at all"
        status: pass
    human_judgment: false
  - id: D5
    description: "The owner's live PART-05 walk states the expectation the shipped code produces, and the new hermetic coverage is cited in the retirement ledger"
    verification:
      - kind: manual_procedural
        ref: ".planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md test 15 note plus the 05-29 ledger row"
        status: pass
    human_judgment: true
    rationale: "A real CORS refusal and a real wrong-chain third-party host cannot be produced hermetically; the stub proves the verdict, not the behavior of a live third-party endpoint. Test 15 stays with a person."

duration: 12 min
completed: 2026-08-02
status: complete
---

# Phase 5 Plan 29: the mismatch verdict, reachable on the network this project ships on

**`classifyEndpoint` now identifies the observed chain from block zero before demanding a second marker, so a participant on mutinynet who pastes a mainnet, testnet3, testnet4, regtest or unknown-chain esplora is told which chain it is on instead of being sent to debug a host that answered correctly.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-02T12:07:30Z
- **Completed:** 2026-08-02T12:19:20Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- The tail of `classifyEndpoint` is reordered: the observed chain is resolved through the existing `identifyChain`, and a block zero that differs from ours returns `mismatch` immediately, naming the identified chain's registry label or the shipped `UNRECOGNIZED_CHAIN` constant. The distinguishing-marker guard runs after that branch, reached only when the observed genesis already equals ours, which is the signet-family case it was written for.
- The module docstring's numbered ordering was rewritten so step 3 describes what the code does, including that the second marker is required only where block zero is ambiguous. A docstring still describing the old ordering would have been the same defect in prose.
- Seven new rows in `packages/web/tests/tx-client.spec.ts`: the four-family default-network matrix (table-driven off `NETWORKS`), the unregistered-chain row, the orchestrated mainnet row asserting exactly ONE request, and the whole-registry no-new-acceptance row.
- `05-UAT.md` test 15 carries a dated note naming 05-29, and the retirement ledger gained one row for the new deterministic coverage with its hermetic limit stated.
- Two UAT procedures that would have reported the fix as a regression were corrected in place (details under Deviations).

## Task Commits

1. **Task 1: a different block zero is conclusive, so say WHICH chain** - `38801bb` (fix)
2. **Task 2: keep the owner's live walk pointed at what the code now does** - `1e1ace9` (docs)

## Files Created/Modified

- `packages/web/src/lib/esplora.ts` - genesis-conclusive branch ahead of the marker guard; module docstring's step 3 rewritten. No chain hash literal entered the package (`grep -cE "[0-9a-f]{64}"` returns 0).
- `packages/web/tests/tx-client.spec.ts` - the default-network foreign-chain matrix at both levels, the unregistered-chain row, the no-new-acceptance row, one existing row's verdict updated, and `NetworkName` imported for the registry iteration.
- `.planning/phases/05-operator-cohort-lifecycle-control/05-UAT.md` - dated note on test 15, one ledger row.
- `.planning/phases/05-operator-cohort-lifecycle-control/05-UAT-PROCEDURES.md` - test 15 step 14 and its Limits, test 5 step 23 and its Limits.

## Decisions Made

- **The branch is gated on the genesis comparison, not on `theirName === null`.** `05-REVIEW.md` sketched the null gate; reading `identifyChain` against `NETWORKS` on this checkout confirms it does NOT close the defect, because mainnet, testnet3, testnet4 and regtest each have a unique block zero and no `distinguishingBlock`, so `identifyChain` names them and the sketched branch would have been skipped for exactly the four families this gap is about.
- **`checkEndpoint` was left alone.** Its second-probe gate is load-bearing in both directions (one request in the common case, and a matching height-one marker cannot rescue a foreign genesis). Only the classification of the observation it produces changed.

## The existing row whose verdict legitimately changed

`esplora - checkEndpoint orders parse, probe, compare > stops after block zero when block zero already disagrees` served a regtest genesis to a `mutinynet` check while ALSO serving mutinynet's own height-one marker. It expected `{ kind: 'unreachable' }`; it now expects `{ kind: 'mismatch', theirNetwork: 'Regtest (local)', ourNetwork: 'Mutinynet (signet)' }`. Its request count is unchanged at exactly one, and its comment was rewritten rather than deleted: the second-probe gate is still load-bearing for request economy and for refusing to let a matching marker rescue a foreign genesis (both still asserted by this row), but the honest verdict for a foreign block zero is now that we identified the chain, not that we could not verify it. This row was the shape of the shipped defect, so it is called out here rather than folded into the diff.

Two rows deliberately did NOT change, and their survival is the proof the marker requirement was narrowed rather than deleted: the pure row `refuses rather than passing when a required second marker was not observed` (our own genesis, marker absent, still `unreachable`), and the orchestrated row `refuses an endpoint whose required second marker cannot be read at all` (still `unreachable` in exactly two requests). Both are green.

## The mutation, observed

RED was observed twice: once before the fix (tests written first) and once by restoring the original branch order after it. Restored ordering (the marker guard moved back above the genesis branch), `pnpm vitest run packages/web/tests/tx-client.spec.ts`:

```
 FAIL  ... > names bitcoin against the DEFAULT network, where no second marker can ever arrive
 FAIL  ... > names testnet3 against the DEFAULT network, where no second marker can ever arrive
 FAIL  ... > names testnet4 against the DEFAULT network, where no second marker can ever arrive
 FAIL  ... > names regtest against the DEFAULT network, where no second marker can ever arrive
 FAIL  ... > names an unregistered chain honestly on the DEFAULT network too
 FAIL  ... > accepts NOTHING new: every registry pairing, with no marker observed
 FAIL  ... > stops after block zero when block zero already disagrees
 FAIL  ... > names a mainnet endpoint on the DEFAULT network, in ONE request
      Tests  8 failed | 47 passed (55)
```

with the representative diff `expected { kind: 'unreachable' } to deeply equal { kind: 'mismatch', ourNetwork: 'Mutinynet (signet)', theirNetwork: 'Bitcoin mainnet' }`. The fix was restored and the file re-run: 55 passed.

## What Task 2 actually found

The round brief stated that `05-UAT.md` test 15 carried a note saying the mismatch case is expected to render as unreachable. **It did not.** On this checkout test 15's `expected:` line makes no such claim; the caveat lives only in `05-VERIFICATION.md`'s `human_verification` list, in the entry beginning "Environment 2" (`...the mismatch case is expected to currently render as 'unreachable' instead, because of the classifyEndpoint defect on mutinynet`). That file was deliberately left unmodified (`git diff --stat` on it is empty): it is the dated record of the gap being found, and rewriting a finding inside it would destroy the evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Corrected test 5's procedure as well as test 15's**

- **Found during:** Task 2
- **Issue:** The plan scoped the procedures edit to test 15. `05-UAT-PROCEDURES.md` test 5 step 23 (`https://mempool.space/api`, a mainnet esplora, on the default mutinynet boot) explicitly expected `Couldn't reach that endpoint.`, "not a mismatch", and test 5's Limits repeated the same claim. Left alone, the owner walking test 5 after this fix would have seen the mismatch sentence, matched it against the procedure, and reported the fix as a regression. The task's stated purpose is that the walk points at what the code does.
- **Fix:** Corrected step 23's expected sentence to the mismatch naming Bitcoin mainnet and Mutinynet (signet), with a dated CORRECTED marker naming 05-29 and the Gap 2 origin, and rewrote the one Limits sentence to record the mapping as closed rather than as a standing property.
- **Files modified:** `.planning/phases/05-operator-cohort-lifecycle-control/05-UAT-PROCEDURES.md`
- **Verification:** No em-dash in either edited file; `05-VERIFICATION.md` diff empty; no test renumbered; `## Summary` counts untouched.
- **Committed in:** `1e1ace9`

**2. [Rule 1 - Bug] The no-new-acceptance row asserts the exact shape rather than the plan's literal wording**

- **Found during:** Task 1
- **Issue:** The plan's acceptance criterion says to iterate every registry network as `ourNetwork` against every registry genesis and assert "no case returns `ok`". Taken literally that row cannot pass, before or after this change: `ourNetwork: 'bitcoin'` observing bitcoin's own genesis legitimately returns `ok`, which is the accepted case the whole feature exists to allow.
- **Fix:** The row asserts the exact permitted shape instead, which is strictly stronger than the intent: `ok` is returned if and only if the observed genesis equals ours AND our network carries no `distinguishingBlock`, and every pairing whose block zero differs from ours must read `mismatch`. Any reordering that widened acceptance, or that quietly returned `unreachable` for a foreign chain again, fails this row.
- **Files modified:** `packages/web/tests/tx-client.spec.ts`
- **Verification:** Row observed RED under the restored original ordering (listed above) and green after.
- **Committed in:** `38801bb`

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug in a stated criterion)
**Impact on plan:** Both keep the plan's own goal intact rather than widening it. No scope creep: no source file outside `packages/web/src/lib/esplora.ts` changed, and nothing under `packages/web/src/components` was touched.

## Issues Encountered

None.

## Prohibitions checked

- Fail-safe posture unchanged: the only movement is `unreachable` to `mismatch`, both refusals, asserted by the whole-registry row.
- Second-marker requirement intact where block zero matches ours: both preserved rows green, signet-vs-mutinynet still refused in two requests.
- No silent fallback introduced in either direction: no change to the store or to any call site; the existing "no failure path that quietly retries through the service" pins are green.
- No chain hash literal in `packages/web`: `grep -cE "[0-9a-f]{64}" packages/web/src/lib/esplora.ts` returns 0; every test hash and label reads from `NETWORKS`.
- Request economy unchanged: one request for a foreign block zero, two for the signet-family case, both asserted per row.
- No UI-SPEC E16 message string changed: no file under `packages/web/src/components` is in the diff.
- WR-5, WR-6, IN-1 and IN-2 deliberately not fixed; they remain open and recorded in `05-REVIEW.md` and `05-VERIFICATION.md` W4.
- No package added: `git diff --stat pnpm-lock.yaml` empty.

## Verification

- `pnpm test`: **1188 passed, 68 files** (round baseline 1169; wave 1 left 1181; this plan adds 7).
- `pnpm lint`: green.
- `pnpm --filter @btcr2-aggregation/web build`: green (the pre-existing chunk-size advisory is unchanged).
- Mutation observed RED and reverted, output quoted above.
- `git diff --stat pnpm-lock.yaml` empty; `.planning/.../05-VERIFICATION.md` unmodified.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Gap 2 (roadmap SC 6, PART-05, review WR-1) is closed in the tree and the UAT artifacts that pointed at the defect now point at the fix. Ready for 05-30, the last plan of the third gap-closure round. The live PART-05 walk (test 15) still needs a person against a real third-party host: a real CORS refusal and a real wrong-chain host are what the stubs cannot be.

## Self-Check: PASSED

- `packages/web/src/lib/esplora.ts` present and modified; `packages/web/tests/tx-client.spec.ts` present and modified; both UAT artifacts present and modified.
- Commits `38801bb` and `1e1ace9` found in `git log`.
- Every task acceptance criterion re-run after the final commit: full suite green at 1188, lint green, web build green.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-08-02*
