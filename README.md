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
