---
status: complete
phase: 03-participant-submit-co-sign-track-and-resolve
source: [03-VERIFICATION.md]
started: 2026-07-20T14:24:37Z
updated: 2026-07-22T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Stage timeline + identity section + Signed copy visual check (confirming the fix)
expected: Join a cohort as a real browser user on both a hermetic and a live-configured (broadcast-enabled) service; observe the stage timeline through Waiting -> Seated -> Submit -> Co-signing -> Signed -> Anchored, including the pre-first-read checking window, a broadcasting-but-not-yet-posted window, a broadcast-but-unconfirmed window, and, if reproducible, a failed-broadcast case. Active stage pulses accent, completed stages read good-tone, future stages are dimmed; the Signed-line copy on the completion card matches the actual anchor state (checking / broadcasting / failed / anchored / hermetic) at every moment; the StageTimeline header, the persistent "Your cohort" chip, and the CompletionSummary heading all read "Signed"/"Broadcasting" (not "Anchored") while the anchor sub-steps beneath read "Confirmed: pending", and all flip to "Anchored"/"Confirmed" together only once the tx is mined.
result: pass
notes: Full pass including the hermetic pnpm demo leg. Live leg exercised via the Polar-backed live-UAT harness (e2e/live-uat.ts) because the product boot path cannot enable live broadcast (captured as todo surface-live-beacon-broadcast-in-the-ui); the broadcast-but-unconfirmed hold and the mine-to-flip transition were observed directly.

### 2. Submit-window consent + urgency check
expected: Reach the submit window; observe the heading escalation, the tab title change, the one consent line (hermetic vs live), and click Submit. Heading reads "Your update is needed"; tab title becomes "(!) Submit your update" and restores on submit/leave; exactly one consent line and one CTA; no second approval gate.
result: pass

### 3. Seated-row affordance + one-cohort-at-a-time + persistent-link navigation check
expected: While seated in a cohort, view the directory; observe the seated row's "You're in this cohort" + View cohort affordance, that Join is disabled on every other row, and that the persistent "Your cohort · {stage}" link correctly returns to the cohort page. Exactly one row shows the seated affordance; all other rows show a disabled Join; the persistent link/chip stays live and accurate (now including the corrected Signed/Anchored transition point).
result: pass

### 4. Checking-window neutral copy visual check
expected: On a live-configured (broadcast-enabled) service, observe the completion view the instant status becomes complete, before the first anchor read lands (a brief window). The Signed-line reads "Confirming this service's broadcast mode." and the round-trip placeholder reads "Resolving your updated DID..."; the hermetic "no-broadcast service" copy does NOT appear during this window.
result: pass
notes: User verdict was "not sure but I think pass" - the window is inherently brief; no hermetic copy flash was reported across multiple live completions.

## Summary

total: 4
passed: 4
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none - defects observed during live testing were pre-existing/out-of-phase-scope and were routed to .planning/todos/pending/ instead of Phase 3 gaps: terminalReason misattribution (CohortPage narrates any unexplained signing-window death as a submit stall), unconfirmed-signal resolution failure (upstream @did-btcr2/method Invalid-date throw), and the misleading round-trip "Try Resolve again" copy when KEY registration is the real blocker.]
