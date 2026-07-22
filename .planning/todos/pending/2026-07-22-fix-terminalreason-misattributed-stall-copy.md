---
created: 2026-07-22T00:00:00Z
title: Fix terminalReason misattributed stall copy
area: ui
files:
  - packages/web/src/components/cohort/CohortPage.tsx:26-52
---

## Problem

Hit live during Phase 3 UAT (2026-07-21): a cohort whose signing phase failed because the
live beacon tx builder found no confirmed UTXO (funding race) was narrated to the
participant as "The cohort ended. It stalled waiting for all members to submit their
updates." - a confidently WRONG cause. `terminalReason` in `CohortPage.tsx` shows the
stall copy not only for genuine submit stalls but for ANY cohort death during the signing
window where this participant's own submit succeeded and the service's reason string is
empty or unrecognized (the `submittedButUnsigned && (!raw || didn't-say-why)` branch).
Server-side failure reasons (e.g. the tx builder's "has no UTXOs; fund it" message) never
reach the participant, so every live signing-start failure lands in this bucket.

This was flagged as a warning in 03-REVIEW.md ("terminalReason misattribution") and is now
confirmed user-visible in a realistic operator-funded live flow.

## Solution

TBD. Directions: (a) make the unexplained-signing-window-death copy honest about its
uncertainty ("co-signing could not complete; this service didn't say why") instead of
asserting a submit stall; reserve the stall copy for reasons that positively match
stall/collectingUpdates patterns; (b) longer-term, forward the runner's `cohort-failed`
reason to participants (library/transport surface permitting) so the UI can narrate the
real cause - the live-UAT harness's server-side event tap showed the reason exists at the
service. Consider alongside the anchor-honesty precedent: never claim a specific cause the
data does not support.
