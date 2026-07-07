# btcr2-aggregation

A public, self-hostable reference app for end-to-end web-based **did:btcr2
aggregation** over the HTTP/REST transport. It is a consumer of the published
`@did-btcr2/*` packages (not a fork of the
[`did-btcr2-js`](https://github.com/dcdpr/did-btcr2-js) library).

did:btcr2 is a censorship-resistant DID method that uses Bitcoin as a verifiable
data registry. *Aggregation* lets a cohort of parties batch their DID-document
updates into a single on-chain *beacon* transaction, coordinated by a service via
MuSig2 (BIP-327) Taproot key-path signing. The coordinator holds **no signing
key**: every participant co-signs, so aggregation stays trustless
([ADR 0006](docs/adr/0006-keep-p2p-defer-trusted-coordinator-app.md)).

The full flow: a DID controller joins a cohort, submits a signed DID update, the
cohort n-of-n MuSig2 co-signs one aggregated CAS/SMT beacon transaction, it is
anchored on-chain, and the update becomes resolvable.

## Status: live and self-hostable

- **M1** headless real-HTTP cohort (service + N participants over
  `HttpClientTransport`, a full CAS cohort to a 64-byte aggregated signature).
- **M2** in-browser participant + coordinator dashboard (`packages/web`), rendered
  off the runner event streams; production same-origin static serve.
- **M3** live and resolvable: real beacon-tx construction, broadcast, and on-chain
  anchoring; server-driven resolution (`GET /resolve/:did`); three onboarding
  models (KEY self-bootstrap, EXTERNAL sidecar, EXTERNAL baked-genesis); CAS and
  SMT beacons; runtime network injection; mainnet guard rails; opt-in IPFS
  publishing; and a regtest CI node that broadcasts real beacon txs on every run.
- **M4** self-hostability: a container, `docker compose`, and an operator runbook
  (this milestone).

The Bitcoin network is config-driven, never hardcoded, and selectable at run time
(mutinynet default; signet / testnet / regtest / mainnet).

## Self-host it

```bash
docker compose up --build
```

Opens a real coordinator on **mutinynet** (offline, no real money) at
http://localhost:8080, serving the SPA and API from one origin. One image serves
any network: the browser reads the chain at runtime from `GET /v1/config`, so you
switch with `NETWORK` and never rebuild.

Going live, pointing at your own node, mainnet, IPFS, and TLS/reverse-proxy setup
are all in **[docs/DEPLOY.md](docs/DEPLOY.md)** (design in
[ADR 0014](docs/adr/0014-deployment-topology.md)).

## Layout

```
packages/
  shared/       @btcr2-aggregation/shared        keys/DIDs, cohort config, signed-update + tx helpers
  service/      @btcr2-aggregation/service        HttpServerTransport under Hono, the runner, resolve/broadcast/store/IPFS
  participant/  @btcr2-aggregation/participant    HttpClientTransport + the runner (isomorphic: Node + browser)
  web/          @btcr2-aggregation/web            React + Vite SPA: in-browser participant + coordinator dashboard
e2e/            @btcr2-aggregation/e2e            real-HTTP + real-chain (regtest) harnesses and their vitest wrappers
```

## Requirements

- Node >= 22
- pnpm (11.x)
- For the live regtest e2e / self-run node: `bitcoind` + an esplora-fork `electrs`
  (see [ADR 0013](docs/adr/0013-regtest-ci-live-path-gate.md)).

## Commands

```bash
pnpm install            # install workspace deps
pnpm demo               # build, then run the coordinator locally (NETWORK=... to pick a chain)
pnpm typecheck          # tsc -b across all packages
pnpm test               # unit tests (vitest)
pnpm lint               # eslint
pnpm e2e                # headless real-HTTP CAS cohort (one of many e2e legs)
pnpm e2e:live:regtest   # LIVE: real beacon txs on a throwaway regtest node, both beacon types + onboarding models
```

The hermetic gate (zero chain access) is 16 checks run in CI alongside a regtest
live-path job; see [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Networks and mainnet guard rails

The coordinator resolves one network at boot and serves it to the browser on
`GET /v1/config`, so the SPA mints its DIDs and beacon addresses on whatever chain
the operator runs.

```bash
NETWORK=mutinynet pnpm demo             # default: fast, free coins, no real money
NETWORK=signet LIVE=1 pnpm demo         # real esplora connection (resolve + tx proxy)
NETWORK=bitcoin pnpm demo               # REFUSED: mainnet needs an explicit opt-in
NETWORK=bitcoin ALLOW_MAINNET=1 LIVE=1 RECOVERY_KEY=<x-only hex> pnpm demo
```

Operator env vars (full reference in [docs/DEPLOY.md](docs/DEPLOY.md)):

- `NETWORK` - registry network name (`mutinynet` default; `signet`, `testnet3/4`,
  `regtest`, `bitcoin`). An unknown name fails at boot.
- `HOST` / `PORT` - bind address and port (the container sets `HOST=0.0.0.0`).
- `LIVE=1` - use a real esplora connection (server-driven resolution + the
  same-origin `/v1/tx/*` registration proxy). Off by default (offline, chain-free).
- `ESPLORA_HOST` - point resolution + the tx proxy at your own indexer (with `LIVE`).
- `ALLOW_MAINNET=1` - required for `NETWORK=bitcoin`, even offline.
- `RECOVERY_KEY` - operator-held x-only public key for every cohort's ADR 042
  recovery leaf. Required before any beacon is funded for real; without it cohorts
  get a throwaway key whose secret is discarded (a funds-loss mode). Derive it
  offline; only the public key belongs on the server.

The browser adds its own rails on mainnet (a red REAL FUNDS badge, and the
first-update registration requires an explicit acknowledgment before it will
broadcast). Full rationale and the layered opt-in matrix:
[docs/adr/0010-mainnet-guard-rails.md](docs/adr/0010-mainnet-guard-rails.md).

## Documentation

- Goal + upstream API: [docs/PROJECT-CONTEXT.md](docs/PROJECT-CONTEXT.md)
- Deploying: [docs/DEPLOY.md](docs/DEPLOY.md)
- App-level decisions: [docs/adr/](docs/adr/) (0001-0014). Library-level decisions
  live as ADRs in the `did-btcr2-js` repo.
