---
created: 2026-07-21T18:07:57.964Z
title: Surface live beacon broadcast in the UI
area: ui
files:
  - packages/service/src/demo-server.ts:222-226
  - packages/service/src/broadcast.ts
  - packages/service/src/index.ts:207-250
---

## Problem

Two related gaps found during Phase 3 UAT (2026-07-21):

1. The product boot path cannot produce a broadcast-enabled service at all. `demo-server.ts` never passes `live`/`broadcast` to `createService` (its own comment at lines 222-226 says cohort co-signing stays on the fixture tx even under `LIVE=1`; `LIVE=1` only makes resolve and the `/v1/tx/*` proxy live). The only broadcast-enabled boots in the repo are e2e scripts (`live-broadcast-cohort.ts`, the regtest leg). This also blocks UAT Test 1's live half and Test 4 entirely.
2. When broadcast IS enabled, the aggregate beacon tx is pushed server-side (`broadcast.ts` polls esplora and emits anchor events). The user's product expectation is that broadcasting the live tx should be visible/driven from the UI (POST to esplora's `/tx` route), the way the participant's own registration tx already is (signed locally in the browser, relayed via `POST /v1/tx/broadcast`).

Note the design tension: the coordinator is the party that finalizes the n-of-n MuSig2 tx, so a UI-driven broadcast means handing the finalized raw tx to a browser (operator console or participant) to relay. That is a deliberate custody/UX decision, not a missing library call (`@did-btcr2/bitcoin` has the broadcast client).

## Solution

TBD. Minimum viable slice: wire `live`/`broadcast` opts through `startDemoServer` (env, e.g. `BROADCAST=1`, gated behind `LIVE=1`) so the product can actually run the live path, and surface broadcast/anchor lifecycle on the operator console (the `BeaconBroadcaster` events already exist and feed the dashboard SSE). A later slice can decide whether the finalized tx is also offered to the UI for manual relay (download raw hex / "broadcast from my browser" button) as a trust-minimization option.
