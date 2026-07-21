---
created: 2026-07-21T21:30:00.000Z
title: Handle unconfirmed beacon signals during resolution
area: service
files:
  - packages/service/src/resolve.ts
---

## Problem

Found live during Phase 3 UAT (2026-07-21, Polar regtest run): `GET /resolve/:did` fails
outright with `Invalid date: Invalid Date` whenever ANY discovered beacon signal tx is
still unconfirmed. Upstream chain in `@did-btcr2/method@0.51.0`:

1. `dist/esm/core/beacon/signal-discovery.js:94` sets `time: beaconSignal.status.block_time`;
   an unconfirmed esplora tx has `status: {confirmed: false}` with NO `block_time`, so
   `time` is `undefined`.
2. `dist/esm/core/resolver.js:251` calls `DateUtils.blocktimeToTimestamp(undefined)` which is
   `new Date(NaN)`, and `toISOStringNonFractional` throws `Invalid date: Invalid Date`
   (`@did-btcr2/common` `utils/date.js`). The library's own TODO at `resolver.js:252`
   acknowledges unconfirmed blocks are unhandled.

Real-world trigger: the web registration flow marks a KEY first-update "registered" on
BROADCAST, not confirmation, so a participant who registers and immediately resolves
always has a mempool-resident singleton signal, and resolution of the whole DID (including
already-confirmed history) fails until the next block lands. On mainnet/mutinynet this is a
routine 10-second-to-10-minute window, not an edge case.

## Solution

TBD. Options, not exclusive:

1. Upstream fix (preferred): file an issue/PR against `@did-btcr2/method` to skip or defer
   unconfirmed signals during discovery (their own TODO), or epoch-clamp the missing time.
2. Consumer-side mitigation in `resolveBtcr2` (`packages/service/src/resolve.ts`): pre-scan
   the DID's beacon addresses for unconfirmed signal txs before driving the library
   resolver, and return a distinct, honest response ("N signal(s) pending confirmation;
   retry after the next block") instead of a generic 502 from the thrown Invalid date.
3. Web copy: the round-trip/resolve error path could surface that same pending-confirmation
   state; today the participant just sees "resolution failed".

Related UX finding from the same session (candidate for the same fix slice): the round-trip
"not found yet" copy suggests resolver lag ("Try Resolve again") even when the real blocker
is that the KEY first-update registration has not been done or confirmed yet, a state the
store already knows via `regStatus`.
