---
phase: 05-operator-cohort-lifecycle-control
plan: 17
subsystem: service
tags: [security, dos, bounded-retention, terms-acceptance, svc-05]
status: complete
requires:
  - packages/service/src/store.ts (ArtifactStore, the acceptance namespace)
  - packages/service/src/hono-adapter.ts (recordTermsAcceptance and its six ordered checks)
provides:
  - packages/service/src/acceptance-ledger.ts (createAcceptanceLedger, MAX_ACCEPTANCES, acceptanceDedupKey)
  - ArtifactStore.delete on both store implementations
  - a bounded acceptance namespace with oldest-first eviction and per-participant-and-cohort replacement
affects:
  - POST /v1/terms/acceptance (step 7, retention, added after the six existing checks)
  - GET /cas/acceptance/:hash (an evicted record now reads as absent)
  - the operator settings help (the retention bound is disclosed there)
tech-stack:
  added: []
  patterns:
    - bounded-map-with-oldest-first-eviction (the MAX_TEST_PEER_DIDS / MAX_TERMINAL idiom)
    - delete-then-set so a refreshed entry is never the next eviction victim
    - store-then-reconcile retention, wrapped so housekeeping cannot turn a success into a refusal
key-files:
  created:
    - packages/service/src/acceptance-ledger.ts
    - packages/service/tests/acceptance-ledger.spec.ts
  modified:
    - packages/service/src/store.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/tests/tos.spec.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/SettingsView.tsx
    - packages/web/tests/settings.spec.ts
decisions:
  - Evict rather than cap-and-refuse, so an attacker filling the bound can never lock a legitimate joiner out of the SVC-05 join gate.
  - remember() never returns the hash it is retaining, which is what stops a byte-identical repost turning the route into a delete primitive.
  - The dedup key is participant plus cohort, deliberately excluding the terms hash, so re-accepting edited terms leaves one current record.
  - MAX_ACCEPTANCES is 200, matching MAX_TEST_PEER_DIDS.
metrics:
  duration: ~20 min
  completed: 2026-07-30
  tasks: 2
  commits: 5
  files: 8
---

# Phase 05 Plan 17: Bound the Anonymous Terms-Acceptance Store Summary

The one anonymous write path this phase added now has the same bound every other retained structure in the service already had: the acceptance namespace holds at most 200 records, one per participant-and-cohort, evicting oldest-first, and both artifact stores can actually drop a record.

## What was built

**`packages/service/src/acceptance-ledger.ts` (new).** A pure, closure-scoped, insertion-ordered map from a dedup key to the acceptance hash currently retained for it.

- `MAX_ACCEPTANCES = 200`, matching `MAX_TEST_PEER_DIDS`. An acceptance is a handful of short strings, so the worst case is a few hundred kilobytes of heap on a single-box coordinator.
- `acceptanceDedupKey(participantDid, cohortId)` composes the key in one place, NUL-separated because neither field can contain a NUL. The terms hash is deliberately excluded: a participant who re-accepts after the operator edits the terms should leave one current record, not one per terms version.
- `remember(dedupKey, hashHex)` returns every hash the caller must drop: the previously retained hash for that key **only when it differs from `hashHex`**, plus the oldest retained hash when the insertion pushed the map past the bound. Delete-then-set, so a participant who re-accepts moves to the newest position rather than staying next in line for eviction.
- `retained()` exposes the hashes it holds, which is what lets a spec assert the ledger and the store agree rather than trusting a number the ledger believes about a namespace that could quietly disagree.

**`packages/service/src/store.ts`.** `ArtifactStore.delete(kind, hashHex)` plus both implementations. `MemoryArtifactStore` deletes through `normalizeHexKey`; `FileSystemArtifactStore` unlinks the file its own `#file` helper builds and swallows ENOENT and ENAMETOOLONG (the same reasoning already written into its `get`), so deleting an absent artifact is a no-op rather than a throw. The interface documents that `delete` exists for BOUNDED namespaces and that the four resolution namespaces never call it. `exportSidecar` is untouched.

**`packages/service/src/hono-adapter.ts`.** One ledger per `createHonoApp` call, threaded into `recordTermsAcceptance` through the existing deps object. All six checks and their order are byte-unchanged; the only change is a seventh step after `putAcceptance` succeeds: ask the ledger what to drop for this record's dedup key, filter the just-stored hash out of that set as belt and braces, and delete each remaining hash, wrapped so a delete failure logs rather than turning a stored acceptance into a refusal. The numbered docstring gained step 7 and the T-05-17-07 cost disclosure.

**Operator disclosure.** `TERMS_RETENTION_NOTE` in `packages/web/src/stores/operator.ts`, rendered under the participation-terms setting beside the existing `TERMS_HONEST_LIMIT`, and pinned verbatim (plus added to the em-dash guard list) in `packages/web/tests/settings.spec.ts`.

## Red before green, with the observed counts

**Against the shipped code (the defect itself).** Run on `packages/service/tests/tos.spec.ts` before any implementation existed:

| Row | Expected | Observed against shipped code |
|---|---|---|
| overflow, 220 distinct dedup keys | exactly 200 entries | **220 entries** (`expected [ Array(220) ] to have a length of 200 but got 220`) |
| same participant re-accepting the same cohort | 1 record, the later one | **2 records**, both retained |
| ledger-store agreement | equal counts | store held **209**, nothing tracked them |
| `MemoryArtifactStore.delete` / `FileSystemArtifactStore.delete` | drop then absent | `TypeError: store.delete is not a function` |

That is the audit's finding reproduced in this repo's own spec: every distinct record added an entry and nothing ever removed one.

**Against the NAIVE implementation (the trap this plan's own algorithm sets).** With `remember` returning `previous` unconditionally, and with the call-site filter temporarily removed so the ledger's contract was the only thing under test:

| Row | Observed against the naive ledger |
|---|---|
| ledger unit contract, `remember(key, h)` twice with the same `h` | `expected [ 'aa' ] to deeply equal []` |
| route, IDENTICAL repost | **0 entries in the acceptance namespace**, and the 200 handed back a hash that resolved to nothing |
| ledger-store agreement | ledger retained 200, store held **199** |

**These two rows are NOT defect-catching rows and are not filed as such.** Both PASS against the shipped code, because today an identical repost is a harmless idempotent overwrite. Their red is against the intermediate implementation this plan would otherwise have invited, and that is exactly why the plan specified the guard as a contract rather than leaving it to the implementation. Adding `previous !== hashHex` turned all three green.

One correction worth recording: the ledger-store agreement row did **not** catch the naive bug on its first draft. The mixed batch posted the byte-identical replay first and overflowed afterwards, so the later overflow evicted the very key the ledger had gone wrong on and the two counts agreed again by accident. Reordering the batch to overflow FIRST and land the replay and the replacement at the newest end gave the row real teeth (it then failed 200 against 199). A row that only passes because a later step erased its own evidence is a false green, and this one nearly was.

## What the bound COSTS (T-05-17-07), in plain words

The bound is enforced by **evicting**, so an anonymous flood pays for itself out of somebody else's evidence. Roughly 200 throwaway-DID acceptances with distinct dedup keys evict every earlier retained acceptance, which means the hash `TermsStep.tsx` handed a real participant in a `CopyField` can stop resolving at `GET /cas/acceptance/<hash>`.

That is accepted rather than mitigated, and what bounds the damage is what the namespace is for: **nothing server-side reads it.** `putAcceptance` is its only writer and `mountArtifactRoutes` its only reader. An evicted record cannot refuse a join, cannot fail a cohort, and cannot change any protocol decision. What is lost is proof durability, not function.

The alternative that would close it is refusing past a cap, and that is strictly worse: an attacker fills the cap and legitimate joiners can no longer record an acceptance at all, which breaks the SVC-05 join gate itself (T-05-17-02). It would also add a seventh reason a caller can provoke, which the uniform refusal body exists to prevent. So this plan evicted, disclosed the cost in the route's retention docstring and in the operator's settings help, and left the operational mitigation to the proxy-layer request throttle in `docs/DEPLOY.md` that `05-18-PLAN.md` extends to name this route.

## Threats

| Threat | Disposition | Evidence |
|---|---|---|
| T-05-17-01 growth from an anonymous route | mitigated | overflow row: exactly 200 entries after 220 distinct dedup keys, oldest absent |
| T-05-17-02 participant lockout via a filled cap | mitigated | after the flood, a fresh joiner still answers 200 with their hash and the record is readable |
| T-05-17-03 eviction as an existence signal | mitigated | evicted read and never-existed read compared as whole answers (status plus body), both 404 |
| T-05-17-06 retention as a delete primitive | mitigated | identical-repost row (one entry, still 200 through `/cas/acceptance/`), ledger contract row, ledger-store agreement row, plus the call-site filter |
| T-05-17-04 unauthenticated schnorr-verify CPU | accepted | out of scope by design: generic to every public route, closed vector was the accumulating one, proxy-layer throttle is the shipped answer |
| T-05-17-05 a replaced acceptance | accepted | deliberate product choice, now disclosed in the operator settings help |
| T-05-17-07 attacker-driven eviction of real evidence | accepted | disclosed in the route docstring, the operator help, and the section above |
| T-05-17-SC package installs | mitigated | no package was installed |

## Prohibitions, held

- **The refusal body, status and check ORDER are unchanged.** `git diff 515ed47 -- packages/service/tests/tos.spec.ts | grep '^-'` removes exactly three lines: the vitest import, the store import, and the `acceptanceApp` signature. Not one shipped assertion row was edited. The uniform-refusal case, every store-stays-empty refusal row and the no-listing case are all still green as written, which is the evidence that the contract did not move.
- **The cohort id is still deliberately unchecked.** No existence check was added; the "ACCEPTS a well-formed but unknown cohort id, on purpose" row is untouched and passing.
- **The stored record is still the submitted bytes.** `putAcceptance(store, hash, record)` is unchanged; retention runs after it and only ever deletes OTHER hashes.
- **`remember` never returns the hash being retained**, and the call site never deletes it either (the `.filter((stale) => stale !== hash)` belt and braces).
- **No per-IP throttle was added**, per the scoping note.

## Verification

| Gate | Result |
|---|---|
| `pnpm vitest run packages/service/tests/acceptance-ledger.spec.ts packages/service/tests/tos.spec.ts` | green, 33 then 28 tests |
| `pnpm test` (composite typecheck plus full unit suite) | green, **61 files / 1008 tests** |
| `pnpm typecheck` | green |
| `pnpm lint` | green |
| `pnpm -r build` | green |
| `pnpm e2e:persist` (the filesystem-store leg) | PASSED |
| `grep -c MAX_ACCEPTANCES packages/service/src/acceptance-ledger.ts` | 3 |
| `grep -cF "delete('acceptance'" packages/service/src/hono-adapter.ts` | 1 |
| `grep -rlP '\x{2014}' packages/service/src packages/service/tests` | one file, see the note below |

**The em-dash grep note.** It lists `packages/service/tests/test-peers.spec.ts`, and the single occurrence is line 411: `expect(NO_SEATS_REASON).not.toMatch(/—/)`. That is the em-dash GUARD itself, not authored copy, and it predates this plan (untouched here). Removing it would delete the guard rather than satisfy it. No file this plan created or modified contains an em-dash.

## Deviations from Plan

**1. [Rule 2 - missing critical functionality] Operator-facing disclosure of the retention bound**

- **Found during:** Task 1, checking the plan's own must-have truths.
- **Issue:** Truth 9 and T-05-17-05 require the bound to be disclosed in "the route comment AND the operator-facing help", but `files_modified` listed service files only, so the operator half had nowhere to land.
- **Fix:** Added `TERMS_RETENTION_NOTE` to `packages/web/src/stores/operator.ts`, rendered it under the participation-terms setting in `SettingsView.tsx`, and pinned it verbatim in `packages/web/tests/settings.spec.ts` (including the existing em-dash guard list, which is the house rule for authored copy).
- **Files modified:** the three web files above.
- **Commit:** `90c9d9c`
- **Note:** `05-19-PLAN.md` also edits `packages/web/src/stores/operator.ts`. This change is a pure addition near `TERMS_HONEST_LIMIT` and does not touch anything that plan is expected to modify.

**2. [Rule 1 - Bug, self-inflicted] A literal NUL byte in the source**

- **Found during:** Task 1, running the plan's own `grep -c MAX_ACCEPTANCES` acceptance criterion.
- **Issue:** The dedup-key separator was written as a raw NUL byte, which made `file(1)` classify `acceptance-ledger.ts` as `data` and made grep treat it as binary. `grep -c MAX_ACCEPTANCES` reported nothing at all, even though the constant is on line 11. Any future pin that greps this file would have silently found zero matches.
- **Fix:** Replaced the raw byte with the `\u0000` escape. The file is now `JavaScript source, ASCII text` and the grep reports 3.
- **Files modified:** `packages/service/src/acceptance-ledger.ts`
- **Commit:** `cb30a65`

**3. [minor addition] An `acceptanceLedger` option on `HonoAppOptions`**

- **Why:** The ledger-store agreement criterion asserts over `ledger.retained()` after driving the real route, which needs a handle on the ledger the app is using.
- **Shape:** Optional and normally omitted. `createHonoApp` still builds one per call, closure-scoped, so production behavior is exactly what the plan specified; a caller supplies one only to assert over it.

## Known Stubs

None. Every path added here is wired and exercised by a passing row.

## Commits

| Commit | Message |
|---|---|
| `f755a94` | test(05-17): add failing spec for the bounded acceptance namespace |
| `1cfa6f3` | feat(05-17): bound the anonymous acceptance namespace, oldest-first |
| `cb30a65` | fix(05-17): escape the dedup-key separator instead of embedding a raw NUL |
| `90c9d9c` | docs(05-17): disclose the acceptance retention bound in the operator help |
| `700ab2e` | test(05-17): pin that the bound is not an oracle, a refusal, or a lockout |

## What would have caught this and did not

The shipped `tos.spec.ts` was genuinely careful about store growth: every refusal row asserts the store is still EMPTY rather than merely that the response was a 400, and the helper takes no default terms so a refusal cannot pass for the wrong reason. All of it is load-bearing and none of it was wrong. The missing axis was simply never posting more than a handful of SUCCEEDING acceptances and then looking at the size of the namespace. That is why the phase's threat model, which proved an unverified caller cannot grow the store by FAILING, read as complete while growth by SUCCEEDING stayed open.

## Self-Check: PASSED

- `packages/service/src/acceptance-ledger.ts` FOUND
- `packages/service/tests/acceptance-ledger.spec.ts` FOUND
- `packages/service/src/store.ts` FOUND (delete on both implementations)
- `packages/service/src/hono-adapter.ts` FOUND (retention step 7 wired)
- `packages/service/tests/tos.spec.ts` FOUND
- `packages/web/src/stores/operator.ts` FOUND (`TERMS_RETENTION_NOTE`)
- commits `f755a94`, `1cfa6f3`, `cb30a65`, `90c9d9c`, `700ab2e` all FOUND in `git log`
