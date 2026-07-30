---
phase: 05-operator-cohort-lifecycle-control
plan: 16
subsystem: service
tags: [kill-switch, funding, money-path, honesty, gap-closure]
status: complete
requires:
  - "packages/service/src/index.ts cohortUsesLivePath (the shared per-cohort kill-switch predicate)"
  - "packages/service/src/funding-watch.ts createFundingWatch (the display watch)"
  - "packages/service/src/monitor.ts noteFunding / publicFunding / serviceHealth"
provides:
  - "A third call site of cohortUsesLivePath, at the top of the keygen-complete funding-watch handler: a cohort off the live path starts no watch, reads no UTXO, and records no funding view"
  - "readonly monitor: CohortMonitor on the Service handle, so a harness can assert a funding projection without binding a port"
  - "Funding assertions in packages/service/tests/kill-switch.spec.ts, including one DIFFERENTIAL route-level row over a real broadcasting service"
  - "The T-05-16-05 disclosure: the health strip's esplora-reachability bit is unfed once only post-switch cohorts remain, pinned by a spec row and recorded in ADR 0017 plus the UAT checklist"
affects:
  - "packages/web/src/stores/participant.ts liveCohort latch (closed at the source, no web-side change)"
  - "packages/web/src/components/operator/CohortDetail.tsx FundingStage (renders nothing for a stood-down cohort)"
tech-stack:
  added: []
  patterns:
    - "One rule, N call sites: a money-adjacent leg consults the shared predicate rather than re-implementing the timestamp comparison"
    - "Differential route assertion over one real service, so a blanket false from a fixture with no feeder cannot pass for the mitigation"
    - "Register a cost the fix introduces rather than assuming it away (the T-05-17-06 posture)"
key-files:
  created: []
  modified:
    - packages/service/src/index.ts
    - packages/service/tests/kill-switch.spec.ts
    - docs/adr/0017-runtime-lifecycle-control.md
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md
decisions:
  - "The guard lands at the watch, never at the cached serviceMode: the service really did boot live and its resolve/anchor reads really are still live"
  - "No noteEsploraObservation is synthesized on the stand-down path; the resulting stale bit is disclosed in three places instead of simulated"
  - "The route-level assertion is differential (pre-switch true beside post-switch false) or it is not written"
metrics:
  duration: 15 min
  completed: 2026-07-30
requirements: [SVC-04]
---

# Phase 05 Plan 16: Stand down the funding watch under the broadcast kill switch Summary

The broadcast kill switch now stands down the DISPLAY funding surface too, so the console cannot ask an operator to send real bitcoin to a beacon address the fixture path will never read or spend, and a seated participant of a stood-down cohort is never told the cohort anchors on-chain.

## What shipped

**The guard (`packages/service/src/index.ts`).** The `runner.on('keygen-complete', ...)` handler
now consults `cohortUsesLivePath(cohortId)` as its FIRST statement, before the `fundingWatches.has`
re-emit guard. A cohort off the live path logs why it is not being watched and returns, so no
`createFundingWatch` is created, no `getUtxos` runs against its beacon address, and no funding view
is ever recorded for it. That makes it the THIRD call site of one rule: `grep -c 'cohortUsesLivePath'
packages/service/src/index.ts` returns 4 (one definition, three call sites), so the tx-data handoff,
the broadcast handoff and the watch agree by construction. It inherits the predicate's fail-closed
direction: an id with no advertise stamp starts no watch.

**The harness affordance.** `readonly monitor: CohortMonitor` joins the `Service` interface and the
returned object, documented with the reasoning `settings` and `testPeers` already carry. It is what
makes the funding assertion possible at all: the funding surface is a projection over that fold,
and there is no `app` on the `Service` handle to route through.

**The spec (`packages/service/tests/kill-switch.spec.ts`).** `stubBitcoin()` now counts `getUtxos`
by address the same way it counts `send`, and `liveService()` returns that counter plus a 60s
funding poll interval so a watch that IS created contributes exactly one deterministic read. Four
new rows in a funding describe block, plus one disclosure row in its own block.

**The disclosure (ADR 0017 + `05-UAT-CHECKLIST.md`).** Decision 4 gains an amended-consequence
block naming the one-caller seam and narrowing D-14's "health strip unaffected" to the parts of the
strip it is actually true of. The checklist's existing broadcast-switch item gains a note telling
the owner which chip on that strip is still live.

## Red before green, recorded exactly

The pre-fix values below were observed against the shipped code, first with a read-only probe over
`createService` and then by reverting `packages/service/src/index.ts` to the RED commit and running
the new spec. Both runs agree.

| Assertion | Pre-fix observed | Red without `await settle()`? |
|---|---|---|
| `service.utxoReads` after `keygen-complete`, same tick | `1` read, `["tb1pafter..."]` | YES. This is the one genuinely red row without a flush. |
| `monitor.detail(id).funding` | full view: `{state:'waiting', suggestedMinSats:2000, beaconAddress, explorerUrl, recoveryKeyState:'throwaway', mainnet:false, changeAddressRedirected:false, truncatedWindowMin:1, esploraStale:false}` | NO. Red only WITH the flush. |
| `monitor.publicFunding(id)` | `{"awaitingFunding":true}`, identical before and after `signing-complete` | NO. Red only WITH the flush. |
| `GET /v1/funding/pair-after` body (differential row) | `{"awaitingFunding":true}` where `false` was expected | Red with the flush; the pre-switch control half read `{"awaitingFunding":true}` in both directions, which is what makes the row non-vacuous. |

Stated plainly, because a red-before-green claim that quietly rests on a missing flush is the class
of certification this round exists to close: **only the counted-`getUtxos` row is red without the
flush.** `createFundingWatch` evaluates `getUtxos(...)` synchronously (the call happens before the
`await` suspends the loop), but `monitor.noteFunding` runs only once that promise RESOLVES, so the
`detail` and `publicFunding` rows asserted in the emit's own tick would pass against the unfixed
code and prove nothing. Both carry an `await settle()` and a comment saying why.

The two non-regression rows (pre-switch cohort keeps its watch, switch-off keeps every watch)
PASSED pre-fix, as they must: they exist to fail a guard written too broadly, not to catch the
defect.

## The cost this fix introduces (T-05-16-05), in plain words

After the switch engages, a service whose remaining cohorts are all post-switch **stops refreshing
`serviceHealth().esploraReachable`**. The funding watch's `onState` in `packages/service/src/index.ts`
is the ONLY caller of `monitor.noteEsploraObservation` in the whole service, confirmed by grep;
`broadcast.ts` never calls it despite the monitor docstring mentioning a confirm poll. So the bit
keeps reporting its last value, or the optimistic `true` it was initialised to at `monitor.ts:824`
if nothing ever wrote it, while `HealthStrip.tsx` keeps painting the good-tone badge. The switch is
one-way per session, so a restart is the only escape.

The part of D-14's "health strip unaffected" that survives is the **mode chip**: the service really
did boot live, its resolve and anchor esplora reads really are still live, and nothing re-derives
the cached mode. The esplora-reachability badge is the part that does not survive.

This is accepted and disclosed, never simulated. Calling `noteEsploraObservation` on the stand-down
path was prohibited by the plan and is refused in the code comment: there is no chain read there, so
any reading would be a fabricated observation, which is a worse honesty defect than the stale bit it
would paper over. Both real mitigations are product decisions rather than defect fixes (a
cohort-independent reachability probe adds a new always-on indexer call with its own lifecycle and
disclosure surface; a third `unknown` state widens the served DTO plus `HealthStrip.tsx`), and
neither is taken in a gap round.

Disclosed in four places, as required: the spec row below, this summary, the note beside the
kill-switch item in `05-UAT-CHECKLIST.md`, and the amended kill-switch consequences in
`docs/adr/0017-runtime-lifecycle-control.md`.

**What the disclosure row does and does not catch.** It runs over `liveService()` and
`service.monitor`, asserts the booted mode plus `esploraReachable === true`, and adds one line
proving nothing observed anything (`utxoReads` is empty). It CATCHES any future change that makes
the post-switch health read something other than the booted mode plus a `true` bit, which a third
`unknown` state, a probe reporting `false`, or a re-derived mode would all do, forcing the reader
back to the comment and the ADR. It does NOT catch someone adding a feeder that happens to observe
successfully, since that also reports `true`. It is a documentation pin with teeth on one side, not
a guard. Its three health assertions passed pre-fix as well as post-fix; only the accompanying
no-read proof line depends on the guard, and the comment says so.

## Traps dodged

**The vacuous route assertion.** `killSwitchApp()` builds a monitor over a bare runner with no
`createService` behind it, so no funding watch exists in it for any cohort and
`GET /v1/funding/:cohortId` answers `{ awaitingFunding: false }` for every well-formed id, switch
engaged or not, before the fix and after a fix that does nothing. The route row is therefore built
over the SAME `liveService()` instance with `createHonoApp(service.transport, { monitor:
service.monitor, runtimeSettings: service.settings, networkName: ACTIVE_NETWORK })`, `operatorAuth`
omitted because the funding route is mounted in the public block before that gate. `killSwitchApp()`
is unmodified; `git diff` confirms it.

**Standing a watch in with `noteFunding`.** Refused for the mirror-image reason: it would make the
post-switch id answer TRUE, so the row would fail rather than pass, leaving "record nothing" as the
only way to green it, which is the vacuous case again. `monitor.noteFunding` is not called anywhere
in the new spec.

**Ending the control cohort too early.** `publicFunding` answers false for a canceled record and for
a view carrying a terminal verdict, so emitting `signing-complete` or a cancel for the pre-switch
cohort before the request pair would flip the control half to false and quietly turn the
differential row back into the vacuous one. The pre-switch cohort is kept in flight and still
waiting for the duration of the pair, and the comment says why.

**A file-wide checklist grep.** The UAT clause slices the `### The one-way broadcast switch` section
with `awk` before grepping for `esplora`, because a file-wide `grep -qi 'esplora'` over that
checklist is ALREADY green from the PART-05 section and would certify nothing. Both doc clauses were
run BEFORE the edits and both were RED; the file-wide contrast grep was GREEN, confirming the point.

**Editing the shipped health row.** `expect(after.esploraReachable).toBe(before.esploraReachable)`
(now at line 274) runs over `killSwitchApp()`, whose monitor has no funding watch in either
direction, so it is a same-before-and-after equality genuinely about the MODE not being rewritten.
It stays green through this fix and was not touched. `git diff 1f9de9b` shows the only removed lines
in the spec are the `stubBitcoin`/`liveService` helper signatures the plan directed changing.

## Verification

| Gate | Result |
|---|---|
| `pnpm vitest run kill-switch.spec.ts funding-watch.spec.ts monitor.spec.ts` | 101 passed |
| `pnpm test` (composite typecheck plus the full unit suite) | 60 files, 985 tests passed |
| `pnpm lint` | clean |
| `pnpm e2e:live:mock` | PASSED (CAS and SMT, funding wait advanced, broadcast wiring pushed the finalized tx) |
| `grep -c 'cohortUsesLivePath' packages/service/src/index.ts` | 4 |
| `grep -c 'esploraReachable' packages/service/tests/kill-switch.spec.ts` | 3 |
| `grep -q 'noteEsploraObservation' docs/adr/0017-runtime-lifecycle-control.md` | holds (RED before the edit) |
| `awk` slice of the broadcast-switch section, grep for esplora | holds (RED before the edit) |
| em-dash grep over the four touched files | no hits |

`packages/service/tests/funding-watch.spec.ts` and `monitor.spec.ts` were read-only regression runs
and needed no expectation edit, so neither entered `files_modified` and no wave conflict re-check
was required. Neither the watch module nor the monitor was changed: this plan changes only WHETHER a
watch is created.

## Deviations from Plan

**1. [Rule 3 - Blocking] Pinned the funding poll interval in `liveService()`**

- **Found during:** Task 1
- **Issue:** With the default 5s poll, a watch that IS created could contribute a variable number of
  reads depending on how long a case ran, making the counted assertions timing-dependent.
- **Fix:** `liveService()` passes `fundingPollIntervalMs: 60_000` (an existing `createService`
  option), so a created watch contributes exactly its one immediate first poll.
- **Files modified:** `packages/service/tests/kill-switch.spec.ts`
- **Commit:** 6e35d02

**2. [Rule 3 - Blocking] Reworded one comment so the call-site count stays measurable**

- **Found during:** Task 1
- **Issue:** The guard's comment mentioned `cohortUsesLivePath` in prose, which pushed
  `grep -c 'cohortUsesLivePath'` to 5 and broke the acceptance criterion that counts call sites.
- **Fix:** The prose now says "the SHARED per-cohort predicate defined above". The count is 4.
- **Files modified:** `packages/service/src/index.ts`
- **Commit:** 8b05a81

Everything else executed exactly as written. No architectural change, no package install, no
checkpoint.

## Judgment calls

**The tracer feedback gate ran as an automated check, not a human checkpoint.** Auto mode is off in
`.planning/config.json` (`auto_advance: false`, `_auto_chain_active: false`), which by the default
rule would mean stopping after the tracer for a human to verify it. The tracer's `<verify>` here is
entirely `<automated>` (`pnpm vitest run ... && pnpm typecheck`), the plan declares
`autonomous: true`, and the plan carries no checkpoint task. Re-running an automated command through
a human adds friction and no signal, so the gate was satisfied by running that verify end to end and
observing it green before any Task 2 work began.

**One pre-existing em-dash hit is intentional and was left alone.**
`grep -rlP '\x{2014}' packages/service/src packages/service/tests` lists
`packages/service/tests/test-peers.spec.ts`. The single hit is
`expect(NO_SEATS_REASON).not.toMatch(/em-dash/)` at line 411, an assertion that shipped copy contains
no em-dash. It is the prohibition being enforced, not violated. The four files this plan touched are
clean.

## Known Stubs

None. No placeholder, no hardcoded empty value flowing to a surface, no unwired data source.

## Threat Flags

None. This plan removes surface (one chain read and one served projection) rather than adding any.
No new endpoint, no new auth path, no schema change at a trust boundary.

## Related but deliberately NOT closed here

Recorded so these are triaged rather than read as closed by this plan:

- **Audit entry 9 (MEDIUM):** a stood-down cohort is still recorded and displayed as `Anchored`.
  Different mechanism, different file, planned in `05-20-PLAN.md`.
- **The test-peer confirmation copy** (`packages/web/src/components/operator/CohortDetail.tsx:409`,
  UNVERIFIED): `liveTestPeersLine` renders from `health?.mode === 'live'` alone, so a post-switch
  cohort still tells the operator its test peers co-sign for real. Same honesty family as this
  defect, but it is a web-side copy fix in a component no plan in this round touches, and the honest
  fix is a per-cohort fact on the served DTO rather than another consumer of `mode`.
- **`finalizeAvailability`'s missing terminal case** and the **unreachable `repairAdvertSlot.clear()`
  branch**, both noted in `05-19-PLAN.md`, which owns those files.

## Self-Check: PASSED

All four modified files exist on disk. All three task commits (`6e35d02`, `8b05a81`, `6538f7f`)
resolve in `git log`. No file was deleted between the plan's base (`1f9de9b`) and HEAD.

