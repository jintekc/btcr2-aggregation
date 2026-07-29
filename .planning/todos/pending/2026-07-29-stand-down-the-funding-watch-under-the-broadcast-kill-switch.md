---
created: 2026-07-29T15:20:00.000Z
title: Stand down the funding watch when the broadcast kill switch is engaged
area: service
severity: high (real funds)
source: .planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md
files:
  - packages/service/src/index.ts:1112
  - packages/service/src/monitor.ts:1420
  - packages/service/tests/kill-switch.spec.ts
---

## Problem

The per-cohort predicate `cohortUsesLivePath` is consulted at exactly two sites, `onProvideTxData` and `shouldBroadcast`. The funding watch wired at the `keygen-complete` handler has no kill-switch test, so a cohort advertised AFTER the switch engages still starts a funding watch, still polls esplora, and still publishes a `waiting` funding view.

The console then tells the operator to send at least N sats in one single payment to a beacon address the fixture path will never read or spend, beside a copyable `bitcoin:` URI and (at `recoveryKeyState: throwaway`) the line that funds sent there are unrecoverable.

One skeptic reproduced this end to end with a stub esplora: the cohort correctly stood down ("broadcast is disabled for this session; not publishing its beacon transaction") while the stub was still polled three times, and both the anonymous `GET /v1/funding/:id` and the gated drill-down kept reporting `state: waiting` with `suggestedMinSats: 2000` before AND after the cohort ended.

A second consequence neither the finder nor the plan named: `publicFunding` returning true latches `liveCohort: true` in the participant store, so every seated participant of a stood-down cohort is told "This cohort anchors on-chain. The operator funds its beacon address after seats fill." That cohort anchors nothing.

05-08-SUMMARY.md claims a stood-down cohort "never waits for funding, never reads a UTXO". That is true of the authoritative wait in tx.ts and false of the display watch in funding-watch.ts, which drives every funding surface anyone sees. kill-switch.spec.ts has no funding assertion, which is why the gate missed it.

Preconditions: LIVE=1 BROADCAST=1 with a funding window configured, kill switch engaged, cohort advertised strictly after the engage stamp. Unreachable on the hermetic default.

## Solution

Consult the existing predicate at a third site, at the top of the `keygen-complete` handler, before the `fundingWatches.has` guard. It inherits the fail-closed default (no watch is the money-safe outcome for an unstamped or evicted cohort id) and leaves pre-switch cohorts funding stages intact. Add a kill-switch spec assertion that for a cohort advertised after `disableBroadcast()`, `getUtxos` is never called, the gated detail carries no `funding` key, and `GET /v1/funding/:id` reads `{ awaitingFunding: false }`.

## Provenance

Found by the Phase 5 adversarial audit (2026-07-29) and CONFIRMED: both independent skeptics, whose instructions were to refute it, failed to do so. Full finder report, both skeptic verdicts, their corrections and their suggested fixes are in `.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md`.
