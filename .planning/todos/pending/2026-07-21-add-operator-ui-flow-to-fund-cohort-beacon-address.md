---
created: 2026-07-21T18:07:57.964Z
title: Add operator UI flow to fund cohort beacon address
area: ui
files:
  - e2e/live-broadcast-cohort.ts:14-40
  - packages/web/src/components/operator/OperatorConsole.tsx
  - packages/web/src/stores/participant.ts:1642-1659
---

## Problem

A funding UI flow exists for the participant's own singleton beacon (registration `awaiting-funds` state: the P2TR address is surfaced, UTXOs are polled through the proxy, and the minimum sats to fund is shown, `participant.ts:1642-1659`). But there is NO UI flow to fund the cohort's aggregate beacon address, which is required before a live cohort's beacon tx can be built and broadcast. Today that funding step only exists as the headless LEARN/FUND dance in `e2e/live-broadcast-cohort.ts` (deterministic keys to stabilize the address, print it, operator funds out-of-band, poll `getUtxos` until a confirmed UTXO appears).

Raised during Phase 3 UAT (2026-07-21). Without this, no real operator can run a live broadcast-enabled cohort from the product itself; the live path is effectively e2e-only.

## Solution

TBD. Sketch: on the operator console, when a cohort's keygen completes (`keygen-complete` exposes the beacon address), show a funding card: the beacon address (copyable / QR), the required minimum, a live UTXO poll via the existing tx proxy, and a funded/unfunded status that gates enabling broadcast for that cohort. `RECOVERY_KEY` practice must be surfaced here too (the boot log already warns that a throwaway recovery key is unsafe once a beacon is funded for real). Depends on the service exposing broadcast enablement to the operator at all, see the related todo "Surface live beacon broadcast in the UI".
