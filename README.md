# btcr2-aggregation

A public example app demonstrating end-to-end web-based **did:btcr2 aggregation**
over the HTTP/REST transport. It is a consumer of the published `@did-btcr2/*`
packages (not a fork of the [`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js)
library).

did:btcr2 is a censorship-resistant DID method that uses Bitcoin as a verifiable
data registry. *Aggregation* lets a cohort of parties batch their DID-document
updates into a single on-chain *beacon* transaction, coordinated by a service via
MuSig2 (BIP-327) Taproot key-path signing.

See [docs/PROJECT-CONTEXT.md](docs/PROJECT-CONTEXT.md) for the goal and upstream
API, and [docs/SCAFFOLD-PLAN.md](docs/SCAFFOLD-PLAN.md) for the build spec.

## Status: Milestone 1 (headless real-HTTP E2E)

M1 is a headless run with no UI and no Bitcoin node: one aggregation **service** on
a real local port and N **participants** over `HttpClientTransport` (real HTTP +
SSE), driving a full CAS cohort to a valid 64-byte aggregated Taproot signature
against a fixture prevout (no broadcast).

```
join cohort -> submit signed DID update -> MuSig2 keygen + signing -> aggregated beacon tx
```

## Layout

```
packages/
  shared/       @btcr2-aggregation/shared       keys/DIDs, cohort config, signed-update + fixture-tx helpers
  service/      @btcr2-aggregation/service       HttpServerTransport mounted under Hono + the runner
  participant/  @btcr2-aggregation/participant   HttpClientTransport + the runner (isomorphic; reused in M2)
e2e/            @btcr2-aggregation/e2e           the headless real-HTTP harness + its vitest wrapper
```

## Requirements

- Node >= 22
- pnpm

## Commands

```bash
pnpm install      # install workspace deps
pnpm typecheck    # tsc -b across all packages (also builds dist)
pnpm e2e          # build, then run the headless real-HTTP cohort (exits non-zero on failure)
pnpm test         # build, then run the vitest wrapper asserting a 64-byte signature
pnpm lint         # eslint
```

`pnpm e2e` and `pnpm test` build first (`tsc -b`), so they work from a clean
checkout. Set `SSE_DEBUG=1` to log adapter requests and SSE writes.

## Networks and mainnet guard rails

The Bitcoin network is config-driven, never hardcoded: the coordinator resolves one
network at boot and serves it to the browser on `GET /v1/config`, so the SPA mints
its DIDs and beacon addresses on whatever chain the operator runs.

```bash
NETWORK=mutinynet pnpm demo             # default: fast, free coins, no real money
NETWORK=signet LIVE=1 pnpm demo         # real esplora connection (resolve + tx proxy)
NETWORK=bitcoin pnpm demo               # REFUSED: mainnet needs an explicit opt-in
NETWORK=bitcoin ALLOW_MAINNET=1 LIVE=1 RECOVERY_KEY=<x-only hex> pnpm demo
```

Operator env vars:

- `NETWORK` - registry network name (`mutinynet` default; `signet`, `testnet3/4`,
  `regtest`, `bitcoin`). An unknown name fails at boot.
- `LIVE=1` - use a real esplora connection (server-driven resolution + the
  same-origin `/v1/tx/*` registration proxy). Off by default: the offline
  connection keeps everything chain-free.
- `ALLOW_MAINNET=1` - required for `NETWORK=bitcoin`, even offline. Mainnet moves
  real funds: the browser derives real addresses it invites the controller to fund,
  and a LIVE coordinator relays real signed transactions.
- `RECOVERY_KEY` - operator-held x-only public key for every cohort's ADR 042
  recovery leaf (spendable by its holder after `recoverySequence` = 144 blocks,
  about one day). Without it cohorts get a throwaway key whose secret is discarded -
  fine for fixture cohorts, a funds-loss mode for any beacon funded with real value.
  Derive it offline; only the public key belongs on the server.

The browser adds its own rails on mainnet (a red REAL FUNDS badge, and the
first-update registration requires an explicit acknowledgment before it will
broadcast). The live-broadcast e2e refuses mainnet unless fresh, non-default
participant/recovery secrets are supplied (the built-in ones are public, making a
funded beacon anyone-can-spend). Full rationale and the layered opt-in matrix:
[docs/adr/0010-mainnet-guard-rails.md](docs/adr/0010-mainnet-guard-rails.md).

## How M1 works

1. `e2e/headless-cohort.ts` generates a service identity and N=2 participant KEY
   DIDs on `mutinynet`.
2. It starts `@btcr2-aggregation/service` on `127.0.0.1:<ephemeral>` with a CAS
   cohort config and the fixture `onProvideTxData`.
3. It creates N `@btcr2-aggregation/participant`s over `HttpClientTransport`,
   starts them (which opens the advert + inbox SSE subscriptions), then calls
   `service.runner.run()`.
4. It asserts a 64-byte signature, a signed tx, and the expected service and
   participant event milestones, then tears everything down.

App-level decisions are recorded in [docs/adr/](docs/adr/). Library-level decisions
live as ADRs in the `did-btcr2-js` repo.

## Beyond M1

- **M2 (web UI):** `packages/web` (Vite) with an in-browser participant and a
  service dashboard rendered off the runner event streams. Reuses `participant`
  unchanged.
- **M3 (live + deploy):** swap the fixture `onProvideTxData` for a real
  `@did-btcr2/bitcoin` connection on mutinynet, fund and broadcast a real beacon
  tx, and deploy the service publicly.
