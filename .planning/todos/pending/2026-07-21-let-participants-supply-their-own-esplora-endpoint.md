---
created: 2026-07-21T18:07:57.964Z
title: Let participants supply their own esplora endpoint
area: service
files:
  - packages/web/src/lib/tx-client.ts:1-50
  - packages/service/src/hono-adapter.ts
  - packages/shared/src/networks.ts
---

## Problem

Today the participant browser never talks to a Bitcoin esplora node directly. All chain reads and broadcasts go through the coordinator's same-origin proxy (`GET /v1/tx/utxos/:address`, `POST /v1/tx/broadcast`), which means a participant must fully trust the operator's chain view: UTXO existence, confirmation status, and broadcast acceptance are all reported by the service they joined. The operator can configure the service-side endpoint (`ESPLORA_HOST`), but a participant has no way to point at their own indexer for independent verification.

Raised during Phase 3 UAT (2026-07-21) as part of a trust-minimization critique: both sides should have an esplora connection by default, with the operator's configuration acting only as the default and participants able to input their own endpoint.

The proxy design exists for a reason (same-origin topology, ADR 0003; avoids esplora CORS problems), so this is an addition, not a replacement: keep the proxy as the zero-config default, add an optional participant-side override.

## Solution

TBD. Sketch: a participant-side setting (browse view or a settings surface) accepting an esplora base URL; when set, the participant store's UTXO checks, anchor polling, and (optionally) tx broadcast go direct to that endpoint instead of the proxy. `@did-btcr2/bitcoin@0.8.0` already ships the esplora REST client (address/UTXOs, tx, blocks, fee estimation) and the web bundle already resolves browser export conditions, so the client capability exists. CORS on third-party esplora hosts is the main constraint; the UI should surface a clear failure mode when the chosen host does not allow browser origins. Network mismatch guard: refuse an endpoint whose chain does not match the cohort's advertised network.
