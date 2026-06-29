# Scaffold Plan: btcr2-aggregation

> The initial structure, dependencies, and first milestone for this app. Read
> [PROJECT-CONTEXT.md](./PROJECT-CONTEXT.md) first for the goal and the upstream
> API surface. This document is a plan, not yet code; it is the thing to approve
> and adjust before scaffolding.

## Shape of the app

Three runtime roles plus shared glue, built on the published `@did-btcr2/*`
packages:

- **service** - a Node HTTP server that runs `AggregationServiceRunner` behind
  `HttpServerTransport`, exposes the `/v1/*` routes, and builds the beacon
  transaction in `onProvideTxData`.
- **participant** - isomorphic (Node + browser) logic that runs
  `AggregationParticipantRunner` over `HttpClientTransport`. The same package
  backs both the headless E2E (Node) and the browser UI.
- **web** - the browser frontend attendees use (later phase); imports
  `participant` and adds UI.
- **shared** - DID/key/network/config helpers and app-level types used by all of
  the above.

A **pnpm workspace monorepo** holds these. It mirrors the proven `did-btcr2-js`
layout, lets the four packages share one TS config and cross-import types, and
keeps the deployable service and static web build cleanly separable. Everything
is **ESM, Node >= 22, TypeScript** (the `@did-btcr2` packages and their
transitive deps are ESM-first).

## Directory structure

```
btcr2-aggregation/
├── package.json              # private workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json        # shared compiler defaults (strict, ES2022, NodeNext)
├── eslint.config.js
├── docs/
│   ├── PROJECT-CONTEXT.md    # (exists) goal + upstream API
│   ├── SCAFFOLD-PLAN.md      # (this file)
│   └── adr/                  # app-level ADRs (deploy topology, network, key custody, UX)
├── packages/
│   ├── shared/               # @btcr2-aggregation/shared
│   ├── service/              # @btcr2-aggregation/service  (Node + Hono)
│   ├── participant/          # @btcr2-aggregation/participant  (isomorphic)
│   └── web/                  # @btcr2-aggregation/web  (Vite + React, phase 2)
└── e2e/                      # @btcr2-aggregation/e2e  (tsx harness; milestone 1)
    └── headless-cohort.ts
```

Milestone 1 scaffolds `shared`, `service`, `participant`, and `e2e`. `web` is
created in phase 2.

## Stack decisions

| Concern | Choice | Why / alternative |
|---|---|---|
| Package manager | **pnpm workspace** | Matches the library; strict node_modules; subpath-export friendly. |
| Language / module | **TypeScript, ESM, Node >= 22** | Upstream packages are ESM-first; Node 22 has global `fetch` + SSE. |
| Service HTTP framework | **Hono + @hono/node-server** | Tiny, fast, first-class streaming (clean SSE adapter for `handleSse`), and deploys to Node, Docker, or edge later. Alt: Express/Fastify if you prefer familiarity. |
| Participant runtime | **isomorphic package** | Pure logic over `HttpClientTransport` (fetch + SSE); runs in Node for E2E and in the browser for the UI. |
| Unit tests | **vitest** | TS-native, no compile step, fast, and has a browser/jsdom mode for the UI later. Alt: mocha+chai+c8 to match the library. |
| E2E tests | **standalone `tsx` scripts, real services** | No mocking: spin up the real service + real participants over real HTTP. Matches the "e2e = real services" convention. |
| Frontend (phase 2) | **Vite + React + TS** | Fast dev/build, large ecosystem, quick to a presentable demo. Alt: Svelte for a lighter bundle. |
| Bitcoin (M1) | **fixture-funded prevout, no node** | M1 proves transport+runner+signing; a synthetic regtest-style P2TR prevout is enough to build a signable tx and verify the aggregate signature. Live funding/broadcast is phase 3. |
| Beacon type (M1) | **CAS first** | Simpler announcement map; add SMT once CAS is green. Both are runner config (`beaconType`). |

## Dependencies (per package)

Versions are the currently-published `@did-btcr2/*` (2026-06-29); track latest.
Assumes the `@did-btcr2/*` packages are published to npm; if consuming a
pre-release, use `pnpm link` / a local registry / `file:` specifiers.

**Root** (`package.json`, `"private": true`, `"type": "module"`):
- devDeps: `typescript ^5.9`, `@types/node ^22`, `tsx ^4`, `vitest ^2`,
  `eslint ^9`, `typescript-eslint ^8`, `rimraf ^6`.
- scripts: `build` (`pnpm -r build`), `typecheck` (`tsc -b`), `test`
  (`vitest run`), `e2e` (`tsx e2e/headless-cohort.ts`), `lint`.

**packages/shared** (`@btcr2-aggregation/shared`):
- `@did-btcr2/aggregation ^0.3.0` (for `/core` types), `@did-btcr2/method ^0.45.0`,
  `@did-btcr2/keypair ^0.13.1`, `@did-btcr2/common ^9.1.0`,
  `@did-btcr2/bitcoin ^0.8.0`.

**packages/service** (`@btcr2-aggregation/service`):
- `@btcr2-aggregation/shared workspace:*`, `@did-btcr2/aggregation ^0.3.0`
  (`/service`, `/core`), `@did-btcr2/method ^0.45.0`, `@did-btcr2/bitcoin ^0.8.0`,
  `@did-btcr2/keypair ^0.13.1`, `hono ^4`, `@hono/node-server ^1`.

**packages/participant** (`@btcr2-aggregation/participant`, isomorphic):
- `@btcr2-aggregation/shared workspace:*`, `@did-btcr2/aggregation ^0.3.0`
  (`/participant`, `/core`), `@did-btcr2/method ^0.45.0`,
  `@did-btcr2/keypair ^0.13.1`. No Node-only APIs.

**e2e** (`@btcr2-aggregation/e2e`, private):
- `@btcr2-aggregation/service workspace:*`,
  `@btcr2-aggregation/participant workspace:*`,
  `@btcr2-aggregation/shared workspace:*`.

**packages/web** (phase 2, `@btcr2-aggregation/web`):
- `@btcr2-aggregation/participant workspace:*`, `react ^18`, `react-dom ^18`;
  devDeps `vite ^6`, `@vitejs/plugin-react ^4`.

## Milestone 1: headless real-HTTP E2E

**Goal:** prove the whole aggregation flow over the *real* HTTP transport, with no
UI, no Bitcoin node, and no broadcast. This is the gap the library does not cover
(its E2E uses an in-memory `MockTransport`; the HTTP client/server are tested only
in isolation).

**`pnpm e2e` does this:**

1. Start the **service** on `http://localhost:PORT` - Hono routes wired to
   `HttpServerTransport.handleRequest` / `handleSse`, driving an
   `AggregationServiceRunner` with a CAS cohort config and an `onProvideTxData`
   that builds a Taproot beacon tx spending a fixture-funded P2TR prevout at the
   cohort aggregate key.
2. Start **N participants** in-process, each with its own DID + `SchnorrKeyPair`
   and a `HttpClientTransport({ baseUrl: 'http://localhost:PORT' })` - real HTTP,
   real SSE. Each `onProvideUpdate` returns a signed BTCR2 update (`Updater.sign`).
3. Drive to completion: advertise -> discover -> join -> keygen -> submit update
   -> aggregate -> validate -> MuSig2 sign.
4. **Assert:** the service emits `signing-complete` with a valid aggregated
   BIP-341 key-path signature over the beacon tx sighash, and each participant
   sees `cohort-complete` with its CAS Announcement.

**Acceptance:** a green, deterministic `pnpm e2e` (and a vitest wrapper) that
exercises the real HTTP transport end to end, plus a documented service-adapter
and participant-wiring pattern the web phase builds on directly.

**Explicitly out of scope for M1:** any UI, a live Bitcoin node, broadcasting a
real tx, SMT beacons, multi-cohort, persistence, and deployment.

## Phasing beyond M1

- **M2 - web UI.** `packages/web` (Vite + React): a participant flow attendees
  drive in-browser (generate keys, join, submit, sign) plus a service dashboard,
  both rendered off the runner event streams. Reuses `participant` unchanged.
- **M3 - live + deploy.** Switch `onProvideTxData` to a real `@did-btcr2/bitcoin`
  connection on **mutinynet**; fund and broadcast a real beacon tx (reuse the
  library's scenario tooling patterns); deploy the service to a public host and
  serve the web build. Add SMT alongside CAS.

## Decisions (locked 2026-06-29)

1. **Structure** - pnpm workspace monorepo (`packages/{shared,service,participant,web}` + `e2e/`).
2. **Service framework** - Hono (+ `@hono/node-server`).
3. **Test runner** - vitest for unit tests; e2e as real-service `tsx` scripts (no mocking).
4. **Dependency source** - the published `@did-btcr2/*` packages from npm (caret ranges).

Still open (M2, does not gate M1): **frontend framework** - React (recommended) vs Svelte.
