---
status: testing
phase: 02-participant-discovery-browse-and-pick-join
source: [02-VERIFICATION.md]
started: 2026-07-14T21:30:00Z
updated: 2026-07-15T22:30:00Z
---

## Current Test

number: 2
name: F2 expiry-surfacing visual re-confirm
expected: |
  At /operator, advertise a cohort and let it sit unjoined past the discovery window (or use a
  short PHASE_TIMEOUT_MS override for a faster check). The row flips to a bad-tone `Expired`
  badge with a reason, and `Re-advertise` puts a fresh cohort back into the directory. The row
  now also shows the k-of-n co-sign figure.
awaiting: user response

## Tests

All four gap-closure plans have landed (02-05 F1a/F1b, 02-06 F2, 02-07 F1c, 02-08 G-02-1
two-field k-of-n). Re-verification: 23/23 must-haves, all gates independently re-run green
(298 unit tests, e2e:kofn both legs + e2e:operator + e2e:browse + e2e:fallback, typecheck,
lint, web build). The wire behavior behind each test below is machine-proven; these three
re-confirm the rendered click path a human eye must judge (no DOM harness, T-02-SC).

### 1. Two-field k-of-n directory-honesty visual re-confirm (supersedes the prior F1a/F1b single-field check; deferred from PLAN 02-08 Task 2 human-check)
expected: |
  At /operator (signed in) the create form shows TWO fields, `Cohort size (seats)` and
  `Signing threshold (k of n)`, each with its help line, with the threshold defaulting to the
  size. Create a size-4 / threshold-2 CAS cohort and advertise it; in an anonymous tab the
  directory row reads 4 seats and a `2-of-4` co-sign figure with the caption
  `all co-sign; anchors if at least 2 of 4 sign`. Separately create a size-2 / threshold-2
  cohort and confirm its row reads `2-of-2` with the caption `all signers required`.
why_human: |
  Visual fidelity of the new two-field form and the rendered k-of-n copy cannot be asserted by
  grep/unit tests; packages/web has no DOM render harness (deliberate, T-02-SC). The string
  logic is unit-proven (DirectoryList.spec.ts cosignValue/cosignCaption assertions) but the
  on-screen rendering and form layout are not automated.
result: pass
reported: |
  "pass - it wont join from the participant side, idk if thats expected" (the visual checks
  passed; the join report is diagnosed as gap G-02-2 below, re-tested by Test 3 after the fix).

### 2. F2 expiry-surfacing visual re-confirm (unchanged from the prior report; deferred from PLAN 02-06 Task 3 human-check)
expected: |
  At /operator, advertise a cohort and let it sit unjoined past the discovery window (or use a
  short PHASE_TIMEOUT_MS override for a faster check). The row flips to a bad-tone `Expired`
  badge with a reason, and `Re-advertise` puts a fresh cohort back into the directory. The row
  now also shows the k-of-n co-sign figure.
why_human: |
  Visual fidelity + interaction cannot be grepped; the e2e proves the wire behavior
  (pnpm e2e:operator F2 leg, independently re-run), not the rendered surface.
result: pending

### 3. Pick to join to seated click flow, including the truthful waiting line (UAT Test 2; re-scoped after the G-02-2 fix)
expected: |
  As operator advertise a 2-of-2 cohort; from a second anonymous tab click Join on the Open
  row, Cancel once before generating a key, then generate a KEY identity and confirm Join
  cohort. While the cohort waits for its second seat, the join flow shows the truthful
  `Waiting for the cohort to fill (1/2 seats)` line (NOT a bare indefinite `Joining...`, and
  it is NOT falsely failed after 90 seconds - the G-02-2 fix). Then fill the second seat from
  another tab (or a headless participant): the seated confirmation `You're seated in cohort
  ...` appears and the reused tail proceeds to a 64-byte co-sign + resolve. Separately
  advertise a 1-of-1 that fills before confirming and try to join it: the deterministic
  `filled or closed` message appears and returns to browse with no dead spinner. Leave cohort
  from a seated state returns to the directory with no confirmation dialog. The row's co-sign
  figure reads `2-of-2` (k == n honest default).
why_human: |
  Same DOM-harness gap; pnpm e2e:browse proves the underlying lifecycle and selectivity
  headlessly (independently re-run, exit 0), and the 16 store spec tests pin the G-02-2 timer
  semantics, but the rendered click path and waiting line are not automated.
result: pending

## Summary

total: 3
passed: 1
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

- gap_id: G-02-2
  truth: "A participant who joins a not-yet-full cohort by choice stays in a truthful waiting state until the cohort fills all n seats (bounded only by the cohort's own server-side lifetime), and is never falsely told the cohort filled or closed while it is still openly Advertised."
  status: resolved
  resolved_by: 02-09-PLAN.md
  resolved_at: 2026-07-16
  reason: "User reported at Test 1: 'it wont join from the participant side'. Root cause (proven from source, no debug agent needed): packages/web/src/stores/participant.ts arms a 90s join-seat grace timer (JOIN_SEAT_GRACE_MS, line 550) in the cohort-joined handler (opt-in sent). Its premise, written in the CR-01 comment at lines 272-282, is the booth-era model: a cohort locks at threshold within seconds (fillers) and the server reaps idle cohorts at 60s, so a seat is imminent after opt-in and 90s is generous slack. That premise was invalidated by the accepted gap fixes: 02-05 makes a cohort seat members only when ALL n join (min == max == n, the user-confirmed wait-for-n model), 02-06 gives an advertised cohort a 30-minute discovery window, and there are no fillers. A solo joiner now opts in, waits at 'Joining...', and at 90s the timer fires fail('That cohort filled or closed before you were seated.') while the cohort is still Advertised and open in the directory. fail() also calls teardownLive() (line 395-401), stopping the runner while the accepted opt-in remains server-side: a zombie seat the protocol cannot reclaim (no leave signal) that can wedge the cohort in keygen when it eventually fills. The directory-poll handler (handleDirectorySnapshot, lines 688-719) already distinguishes the states correctly (still-Advertised: keep waiting; left-Advertised while never-opted-in: true filled-or-closed; left-Advertised while opted-in: the genuinely ambiguous window). The sole defect is WHERE the grace timer is armed."
  severity: major
  verdict: gap
  test: 1
  artifacts: [packages/web/src/stores/participant.ts, packages/web/src/stores/participant.spec.ts, packages/web/src/components/browse/JoinIdentityStep.tsx, packages/web/src/components/browse/BrowseView.tsx]
  missing: ["move the grace-timer arming from the cohort-joined handler to the poll's opted-in-departure branch (handleDirectorySnapshot lines 709-718, alongside the existing joinGraceLogged one-shot), so 90s bounds only the genuine lock-to-cohort-ready ambiguity window and an opted-in participant waits as long as the picked cohort remains Advertised (the cohort's own 30-min expiry bounds the wait via the poll when the row vanishes)", "a truthful waiting surface while opted-in and Advertised: store the polled row's joined/capacity (e.g. an awaitingSeats field updated in handleDirectorySnapshot) and render 'Waiting for the cohort to fill ({joined}/{capacity} seats)' in the join flow instead of a bare indefinite 'Joining...'", "rework participant.spec.ts: RED that an opted-in participant with the picked cohort STILL Advertised past the old 90s window is NOT failed (old behavior fails this), plus the moved-grace outcomes (departure then no cohort-ready within window -> filled-or-closed terminal; cohort-ready during grace -> seated; never-opted-in departure -> immediate terminal unchanged)"]

Resolved gaps from earlier passes (retained for traceability):

- gap_id: G-02-1
  truth: "The operator can shape a k-of-n cohort: n seats that all join (the cohort starts only when n join) with a separate signing threshold k (k required to sign), and the participant directory shows `joined/n seats` + a `k-of-n` co-sign figure honestly."
  status: resolved
  resolved_by: 02-08-PLAN.md
  resolved_at: 2026-07-15
  reason: "Closed by 02-08: DraftInput { beaconType, size, threshold? } with k = threshold ?? size guarded [1, size] (exact THRESHOLD_ERROR, byte-identical server/client) plus the fallback-off over-promise guard; createDraft always sets fallbackThreshold = k while min == max == n stays pinned; the DTO flipped atomically (threshold = k, capacity = n) at all four emit sites incl. the F2 expired records; cosignValue/cosignCaption drive the honest display; proven by the n=4/k=2 e2e:kofn capstone (drop-2 script-path recovery + drop-3 cohort-failed floor). Re-verified 23/23. Awaiting the Test 1 visual re-confirm above."
  severity: major
  verdict: gap
  test: 1

- gap_id: G-02-F1-legacy
  truth: "The participant directory faithfully represents the cohort's signing set and seat expectations."
  status: resolved
  resolved_by: [02-05-PLAN.md, 02-07-PLAN.md, 02-08-PLAN.md]
  reason: "The phantom unfillable seat is gone (finalize-at-n, 02-05); the fallback is activated (02-07); and the signing-threshold control returned as an honest second number k (02-08, superseding the single-n-of-n over-correction)."
  severity: minor
  verdict: expected-but-confusing
  test: 1

- gap_id: G-02-F2-legacy
  truth: "An operator-advertised cohort stays discoverable long enough for a stranger to browse and join it by choice over time."
  status: resolved
  resolved_by: [02-06-PLAN.md]
  reason: "30-min discovery-window defaults (env-tunable), expiry surfaced to the operator as state:'expired' + reason with a gated re-advertise route, never silently deleted and never shown to participants."
  severity: major
  verdict: gap
  test: 1
