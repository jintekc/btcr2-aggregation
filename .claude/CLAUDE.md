<!-- GSD:project-start source:PROJECT.md -->

## Project

**btcr2-aggregation**

A self-hostable, **two-sided** reference application for `did:btcr2` aggregation over HTTP/REST. Each self-hosted **service** is a node whose operator sets up, advertises, and manages cohorts; each **participant** points a client at a service's URL, discovers the cohorts it advertises, joins one, and takes part (submits a DID update, co-signs the n-of-n MuSig2 beacon, tracks the anchor, and resolves the result). It is meant to be something anyone can stand up and run as a real aggregator over the public internet, and anyone else can join as a participant - not a supervised demo.

This project is being onboarded into a structured workflow to **course-correct**. Built with an unstructured flow, the delivered app drifted into a single hardwired demo happy-path plus a read-only telemetry tab, rather than the intended two-sided, self-hostable product. The full protocol lifecycle (advertise -> join -> submit -> co-sign -> anchor -> resolve) genuinely works end to end and is real, salvageable value; the goal now is to build the two-sided management and discovery experience on top of it and make it truly self-hostable.

**Core Value:** **A stranger can self-host a real aggregation service that advertises cohorts, and another stranger can point a participant at that service's URL, browse its cohorts, join, co-sign, and resolve - a genuinely two-sided, self-hostable product, not a demo.** If everything else is stripped away, this two-sided self-hostable loop is the thing that must work.

### Constraints

- **Tech stack**: pnpm workspace `packages/{shared,service,participant,web}` + `e2e/`; TypeScript/ESM/Node >= 22; React 19 + Vite 8 + Tailwind v4 + Zustand 5 (web); Hono (service, wrapping the library's `HttpServerTransport`); vitest units + tsx e2e - established, do not churn without reason.
- **Consume published `@did-btcr2/*`**: `method@0.51.0`, `aggregation@0.4.0` (caret) - this is a consumer app, not a library fork.
- **Config-driven network, never hardcoded**: mutinynet default; the chain is resolved once at boot and served to the browser via `GET /v1/config` - required by the North Star.
- **Real-money paths are opt-in behind guard rails**: every path that can move Bitcoin (LIVE broadcast, mainnet, tx relay) stays behind explicit flags/env, defaulting to the hermetic zero-chain fixture path (ADR 0010).
- **Single-box self-host model**: one coordinator process (ADR 0014); no multi-instance coordination.
- **No unauthenticated mutating/control surface**: once operator control actions exist, they must be authenticated (security; the audit's top concern) - do not add mutating routes reachable from the dashboard without auth first.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript 5.9 (`^5.9`) - all packages (`packages/{shared,service,participant,web}`, `e2e/`)
- None (no other source language present; deploy tooling uses Dockerfile syntax, shell in CI YAML)

## Runtime

- Node.js >= 22 (`package.json` `engines.node`), pinned to `node:22-bookworm-slim` in `Dockerfile`
- `type: "module"` everywhere - pure ESM, no CommonJS
- `tsx` (`^4`) used to run TypeScript directly for scripts/e2e without a separate compile step
- pnpm workspace, pinned to `pnpm@11.4.0` in CI and `Dockerfile`
- Lockfile: present (`pnpm-lock.yaml`, committed, treated as trusted base)
- Workspace layout defined in `pnpm-workspace.yaml`: `packages/*` + `e2e`
- `pnpm-workspace.yaml` also pins `allowBuilds` (disables native builds for `classic-level`, `esbuild`) and `minimumReleaseAgeExclude` for specific fast-moving deps (`@did-btcr2/method`, `@did-btcr2/aggregation`, Tailwind v4 oxide binaries) to bypass pnpm 11's 24h minimumReleaseAge gate

## Frameworks

- Hono `^4` - HTTP framework for the coordinator/service (`packages/service/src/hono-adapter.ts`, `packages/service/src/demo-server.ts`)
- `@hono/node-server` `^1` - Node adapter to run Hono outside a serverless runtime
- React `^19.2.7` + `react-dom` `^19.2.7` - UI (`packages/web/src`)
- Vite `^8` - dev server and build (`packages/web/vite.config.ts`)
- `@vitejs/plugin-react` `^6`
- Tailwind CSS `^4.3.2` via `@tailwindcss/vite` `^4.3.2` - styling
- Zustand `^5.0.14` - client state (`packages/web/src/stores/dashboard.ts`)
- `vite-plugin-node-polyfills` `^0.28.0` - polyfills Node built-ins for browser bundle (needed because the isomorphic participant/shared code touches some Node-shaped APIs)
- Vitest `^2` - unit tests across all packages (`*.spec.ts` co-located with source)
- Playwright (`playwright-core` `^1.61.1`, headless Chromium, no full `playwright` package) - drives browser e2e (`e2e/browser-cohort.ts`, `e2e/browser-prod-cohort.ts`)
- TypeScript project references / composite build: root `tsconfig.json` references `packages/shared`, `packages/service`, `packages/participant`, `e2e` (web builds separately via `tsc --noEmit` + `vite build`)
- ESLint `^9` + `typescript-eslint` `^8` - linting (`pnpm lint` = `eslint .`)
- `rimraf` `^6` - cross-platform clean script
- `tsx` `^4` - runs e2e harness scripts and the demo server without a build step in dev

## Key Dependencies

- `@did-btcr2/method` `^0.51.0` - DID method core (create/update/resolve did:btcr2)
- `@did-btcr2/aggregation` `^0.4.0` - n-of-n MuSig2 cohort aggregation protocol, transports
- `@did-btcr2/keypair` `^0.13.1` - key generation/import
- `@did-btcr2/common` `^9.1.0` - shared method types/utilities
- `@did-btcr2/bitcoin` `^0.8.0` - `BitcoinConnection` esplora REST client, tx helpers (service + e2e only)
- `@did-btcr2/smt` `^0.3.0` - sparse Merkle tree beacon support (service only)
- `@scure/btc-signer` `^1.8.1` - transaction building/signing
- `@noble/hashes` `^1.8.0` - hash primitives
- `libp2p` `2.10.0`, `@libp2p/interface` `2.11.0`, `@libp2p/identify` `3.0.39`, `@libp2p/websockets` `9.2.19`
- `@chainsafe/libp2p-noise` `16.1.5`, `@chainsafe/libp2p-yamux` `7.0.4` - transport security/muxing
- `@helia/utils` `1.4.0`, `@helia/interface` `5.4.0`, `@helia/block-brokers` `4.2.4` - Helia (IPFS) node
- `@multiformats/multiaddr` `12.5.1`, `multiformats` `13.4.2` - CID/multiaddr encoding
- `blockstore-core`/`blockstore-fs`, `datastore-core`/`datastore-fs` - Helia storage backends (fs-backed on the service, in-memory/browser-backed on web)
- None beyond the above (no ORM, no database driver, no queue/cache client)

## Configuration

- Configured entirely via process env vars read in `packages/service/src/demo-server.ts` (no config file, no `.env.example` committed; `docker-compose.yml` documents the vars with defaults)
- Key vars: `NETWORK` (default `mutinynet`), `ESPLORA_HOST` (override indexer), `LIVE` (enables real esplora I/O), `ALLOW_MAINNET`, `RECOVERY_KEY`, `MIN_PARTICIPANTS`, `FILLERS`, `IPFS`, `IPFS_DIR`, `IPFS_ANNOUNCE`, `HOST`, `PORT`, `COHORT_TTL_MS`, `PHASE_TIMEOUT_MS`
- No `.env` file exists in the repo; `docker-compose.yml` supports one implicitly via compose env-file conventions
- Browser gets network config at runtime (not build time) via `GET /v1/config` served by `packages/service/src/hono-adapter.ts` - this is a deliberate "one image, any network" design (ADR 0014)
- `tsconfig.json` (root, project-references only, `files: []`)
- Per-package `tsconfig.json` under each `packages/*` and `e2e/`
- `packages/web/vite.config.ts` - dev proxy (`COORDINATOR_ORIGIN`, defaults to `http://127.0.0.1:8080`) forwards `/v1`, `/dashboard`, `/resolve`, `/cas` to the coordinator so the browser never needs CORS; browser build resolves the `browser` export condition first to pick up prebundled `dist/browser.mjs` from `@did-btcr2/method`/`aggregation` and excludes native `level`/`classic-level` from the dep prebundle
- `eslint.config.*` - not read in detail but present per `pnpm lint` script

## Platform Requirements

- Node >= 22, pnpm 11.4.0
- No database, no external service required to run the hermetic unit/e2e suite (offline/fixture mode is the default; chain and IPFS I/O are both opt-in)
- Self-hosted via Docker: `Dockerfile` (multi-stage: `base` -> `builder` -> `runtime`, non-root `node` user, `HEALTHCHECK` against `GET /v1/config`) + `docker-compose.yml`
- Single container serves both the API and the built SPA on one port (same-origin topology, ADR 0003); TLS terminated by an external reverse proxy (documented in `docs/DEPLOY.md`)
- One image serves any Bitcoin network - network selected at container run time via `NETWORK` env var, not baked in at build time

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Lowercase, hyphenated for modules: `beacon-address.ts`, `genesis-capture.ts`, `hono-adapter.ts`, `static-site.ts`
- Test files co-located with `.spec.ts` suffix: `store.spec.ts`, `resolve.spec.ts`, `config.spec.ts` (in `packages/*/src/`)
- React components use PascalCase `.tsx`: `App.tsx`, `CohortCard.tsx`, `DashboardView.tsx`, `PublishPanel.tsx` (see `packages/web/src/components/`)
- ADRs numbered sequentially in `docs/adr/`: `0001-m1-service-framework-and-fixture-tx.md` through `0014-deployment-topology.md`
- camelCase: `resolveBtcr2`, `driveResolution`, `createHonoApp`, `runHeadlessCohort`
- camelCase for values, `SCREAMING_SNAKE_CASE` for module-level constants: `DEFAULT_NETWORK`, `EXPECTED_SERVICE_MILESTONES`
- PascalCase interfaces/types, often suffixed `Options`, `Like`, `Config`: `ResolveBtcr2Options`, `ResolverLike`, `NetworkConfig`

## Code Style

- No dedicated Prettier config detected; formatting is enforced implicitly through ESLint + TypeScript strictness
- Single quotes, semicolons, trailing content on interface members with inline JSDoc
- Flat config: `eslint.config.js` (repo root) using `typescript-eslint` recommended rules
- Run via `pnpm lint` (`eslint .`) at repo root; part of the CI hermetic gate
- Project-references build: `tsc -b` from repo root (`packages/*/tsconfig.json` each extend `tsconfig.base.json`)
- `tsconfig.base.json` (repo root): `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `composite: true`, ESM throughout
- `pnpm typecheck` = `tsc -b`; `pnpm test` runs `tsc -b && vitest run` (typecheck gates every test run)

## Import Organization

- All relative imports MUST use explicit `.js` extensions even though source files are `.ts` (NodeNext module resolution requirement)
- Type-only imports use `import type` or inline `type` specifiers in named import lists:
- None used at the TS/build level; pnpm workspace `packages/{shared,service,participant,web}` cross-reference each other via published/workspace package names, not path aliases
- Vite config (`packages/web/vite.config.ts`) uses a dev proxy for same-origin topology (ADR 0003) rather than import aliases

## Error Handling

- Plain `throw new Error(...)` with a descriptive, prefixed message identifying the function/module, e.g.:
- No custom Error subclasses observed; errors are distinguished by message content and call site, not by type
- Guard clauses at the top of functions validate inputs and throw immediately rather than deep-nesting

## Comments and Documentation (distinctive convention)

- Uses `{@link}` TSDoc tags to cross-reference other symbols and even library-internal types
- File-header comments in e2e/CI/config files explain non-obvious "why" decisions at length (see `.github/workflows/ci.yml` header, `e2e/lib/regtest.ts`)
- Inline comments in tests explain the intent of an assertion, not just what it checks (e.g. `// A CAS cohort delivers the announcement map, not an SMT proof.`)
- **When adding new code, match this density**: document non-obvious rationale, edge cases, and links to relevant ADRs (`docs/adr/000N-*.md`) rather than terse one-liners.

## Config-Driven Network Convention (hard rule)

- Server-side: resolved from `opts.network ?? process.env.NETWORK ?? DEFAULT_NETWORK` (`packages/service/src/demo-server.ts:154`)
- Browser-side: fetched at runtime from `GET /v1/config` (ADR: runtime network injection, see MEMORY `project-m3f-netconfig`) rather than baked into the client bundle
- Any new feature touching chain interaction must accept/derive the network from config, not import a constant network value

## Environment-Variable-Driven Boot Config

| Var | Purpose |
|---|---|
| `NETWORK` | Target Bitcoin network name (mutinynet/signet/testnet/regtest/bitcoin) |
| `ESPLORA_HOST` | Esplora REST endpoint override |
| `LIVE` | `"1"` opts into real on-chain broadcast/resolve behavior |
| `ALLOW_MAINNET` | `"1"` unlocks mainnet guard rails (ADR 0010) |
| `RECOVERY_KEY` | Recovery key material for self-bootstrap flows |
| `IPFS` | `"1"` opts into in-browser/coordinator IPFS publish (ADR 0011) |
| `IPFS_ANNOUNCE` | Comma-separated multiaddr announce list |
| `IPFS_DIR` | On-disk IPFS data directory |
| `HOST` | Bind host (deploy tooling, ADR 0014) |
| `PORT` | Bind port (default `8080`) |
| `MIN_PARTICIPANTS`, `FILLERS`, `COHORT_TTL_MS`, `PHASE_TIMEOUT_MS` | Cohort-runner tuning knobs |
| `SSE_DEBUG` | `"1"` enables SSE transport debug logging (`packages/service/src/hono-adapter.ts:31`) |
| `LIVE_NETWORK` | Network used specifically by the regtest live e2e leg (`e2e:live:regtest`) |

## House Style Rules (repo-wide, non-negotiable)

## Function Design

## Module Design

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Demo server boot / advertise loop | Starts the coordinator, continuously advertises fresh cohorts, wires optional Bitcoin/IPFS connections | `packages/service/src/demo-server.ts` |
| Service factory | Wires `AggregationServiceRunner` + `HttpServerTransport` + all side-effect listeners (persist, genesis promotion, broadcast) | `packages/service/src/index.ts` |
| Hono HTTP adapter | Maps Hono `Context` <-> library's transport-agnostic `HttpRequestLike`/SSE; mounts all routes on one app | `packages/service/src/hono-adapter.ts` |
| Dashboard SSE bridge | Forwards runner + broadcaster lifecycle events to `GET /dashboard/events` for the read-only Coordinator tab | `packages/service/src/dashboard-sse.ts` |
| Server-driven resolver | `resolveBtcr2` + `GET/POST /resolve/:did`: discovers beacon signals over Bitcoin, fetches off-chain artifacts from the store | `packages/service/src/resolve.ts` |
| Content-addressed artifact store | In-memory/filesystem store + read-only `GET /cas/*` routes for CAS announcements, SMT proofs, signed updates | `packages/service/src/store.ts` |
| Genesis capture / roster | Stages + promotes EXTERNAL (x1) BAKED genesis documents on acceptance; fixed-roster opt-in gating for pre-provisioned cohorts | `packages/service/src/genesis-capture.ts`, `packages/service/src/roster.ts` |
| Beacon tx construction | Builds the fixture or LIVE aggregation beacon tx data the runner signs | `packages/service/src/tx.ts` |
| Beacon broadcast + confirm | Opt-in: broadcasts the signed beacon tx, polls for confirmation, emits anchor events | `packages/service/src/broadcast.ts` |
| Offline chain stub | Zero-network `BitcoinConnection` stand-in for the hermetic default gate | `packages/service/src/offline-chain.ts` |
| Static site mount | Serves the built web SPA (`packages/web/dist`) as a trailing catch-all | `packages/service/src/static-site.ts` |
| IPFS pinning node | Opt-in Helia node; `GET /v1/ipfs` probe + `POST /v1/ipfs/pin` (bitswap fetch or store-verified bytes) | `packages/service/src/ipfs.ts` |
| Persistence | Harvests each completed cohort's off-chain artifacts into the store | `packages/service/src/persist.ts` |
| Participant runner (isomorphic) | Wraps `AggregationParticipantRunner` + `HttpClientTransport`; joins cohorts, builds+submits signed updates, handles cooperative non-inclusion | `packages/participant/src/index.ts` |
| Shared identity/config/network | DID/key identity creation, cohort config builder, signed-update helpers, network registry (mutinynet/signet/testnet/regtest/mainnet) | `packages/shared/src/index.ts`, `packages/shared/src/networks.ts` |
| Web app shell | Two-tab shell (Participant / Coordinator) over one same-origin service; fetches runtime network config | `packages/web/src/App.tsx` |
| Participant view + flow panels | KeyGen -> Register -> Publish -> Resolve step UI; drives the in-browser participant | `packages/web/src/components/participant/*.tsx` |
| Dashboard view | Read-only telemetry cards over `/dashboard/events` SSE | `packages/web/src/components/dashboard/*.tsx` |
| Participant store (Zustand) | Client-side orchestration state machine: identity, cohort join, tx signing/broadcast, resolve | `packages/web/src/stores/participant.ts` |
| Dashboard store (Zustand) | Client-side SSE-fed telemetry state | `packages/web/src/stores/dashboard.ts` |

## Pattern Overview

- Same-origin topology: one port serves both the API and the SPA (dev: Vite proxy; prod: Hono static-site mount) - see `docs/adr/0003-same-origin-topology.md`.
- Config-driven Bitcoin network: never hardcoded; resolved once per boot from `packages/shared/src/networks.ts` and served to the browser at runtime via `GET /v1/config` so client-side DID/address derivation always matches the coordinator's chain.
- Everything real-money (LIVE broadcast, mainnet) is opt-in and layered behind explicit guard rails (`allowMainnet`, `live`), defaulting to a hermetic, zero-chain fixture path.
- The library's transport (`HttpServerTransport`/`HttpClientTransport`) is intentionally framework-agnostic; `hono-adapter.ts` is the only place Hono-specific request/response mapping happens.
- No auth/role separation at the HTTP layer: any client can hit any route (dashboard is read-only by construction, not by access control).

## Layers

- Purpose: Sans-I/O message routing, SSE fan-out, sender-key authentication for the aggregation protocol itself (adverts, opt-ins, MuSig2 rounds).
- Location: consumed from `@did-btcr2/aggregation/service` and `@did-btcr2/aggregation/participant` (external published packages, not in this repo).
- Contains: `HttpServerTransport`, `HttpClientTransport`, `AggregationServiceRunner`, `AggregationParticipantRunner`.
- Depends on: nothing in this repo (external dependency).
- Used by: `packages/service/src/index.ts`, `packages/participant/src/index.ts`.
- Purpose: Bind the sans-I/O transport (and every app-level concern) to a real Node HTTP server via Hono.
- Location: `packages/service/src/hono-adapter.ts`, `packages/service/src/static-site.ts`.
- Contains: route mounting, request/response shape translation, raw SSE hijacking (`c.env.outgoing`).
- Depends on: the protocol transport, `packages/service`'s own modules (store, resolve, ipfs, broadcast).
- Used by: `createService` in `packages/service/src/index.ts`.
- Purpose: Wires side effects onto runner lifecycle events (persist artifacts on `signing-complete`, promote staged genesis on `participant-accepted`, broadcast+confirm the beacon tx), and the long-lived advertise loop.
- Location: `packages/service/src/index.ts` (createService), `packages/service/src/demo-server.ts` (process entry point + loop).
- Depends on: HTTP adapter layer, shared identity/network/cohort helpers.
- Used by: the `pnpm demo` entry point and every e2e harness that boots a real service.
- Purpose: Join advertised cohorts, decide whether/how to submit a signed update, handle cooperative non-inclusion for baked-identity mismatches.
- Location: `packages/participant/src/index.ts`.
- Contains: `createParticipant` factory wrapping `AggregationParticipantRunner` + `HttpClientTransport`.
- Depends on: `packages/shared` (signed-update builder, cohort-fit classification), the protocol transport.
- Used by: `packages/service/src/demo-server.ts` (in-process "fillers"), `e2e/*.ts` headless harnesses, `packages/web/src/stores/participant.ts` (browser).
- Purpose: Browser-side presentation and orchestration for both the Participant flow and the read-only Coordinator dashboard.
- Location: `packages/web/src/{App.tsx,components,stores,lib}`.
- Contains: React components, Zustand stores (`participant.ts`, `dashboard.ts`), browser-only helpers (`lib/ipfs-node.ts`, `lib/tx-client.ts`, `lib/sidecar.ts`, `lib/resolve.ts`).
- Depends on: `packages/participant` (via the participant store), `packages/shared`, same-origin fetch/SSE to the coordinator.
- Used by: nothing further (leaf/UI layer).
- Purpose: DID/key identity construction, cohort config, signed-update helpers, IPFS digest helpers, the network registry (single source of truth for chain params).
- Location: `packages/shared/src/{index.ts,networks.ts,ipfs.ts}`.
- Depends on: `@did-btcr2/method`, `@did-btcr2/bitcoin` (external published libraries).
- Used by: `packages/service`, `packages/participant`, `packages/web` (all three consume `@btcr2-aggregation/shared`).

## Data Flow

### Full cohort lifecycle: advertise -> join -> submit -> co-sign -> anchor -> resolve

### Dashboard telemetry (read-only, separate from the protocol data path)

- Server: transport/runner state lives inside the library's `AggregationServiceRunner`/session (per-cohort accessors); this repo adds only side-tables (`GenesisStagingCache`, `seatedRosterKeys` Map) scoped to `packages/service/src/index.ts`.
- Client: Zustand stores per concern (`participant.ts` for the join/sign/register/resolve flow, `dashboard.ts` for telemetry), both scoped to `packages/web/src/stores/`.

## Key Abstractions

- Purpose: A DID controller's keys + DID (+ optional `genesisDocument` for EXTERNAL/x1) - the unit both `createService` (coordinator identity) and `createParticipant` (attendee identity) are constructed from.
- Examples: `packages/shared/src/index.ts` (`createIdentity`, `Identity` type).
- Pattern: Same shape used server-side and client-side; onboarding model (KEY vs EXTERNAL) is a property of the identity, not a branch in calling code.
- Purpose: Single source of truth for which Bitcoin network (mutinynet/signet/testnet/regtest/mainnet) the whole stack targets, including scure params and explorer/esplora hosts.
- Examples: `packages/shared/src/networks.ts` (`resolveNetwork`, `assertNetworkAllowed`, `toNetworkConfigDTO`, `DEFAULT_NETWORK`).
- Pattern: Resolved once server-side at boot; served to the browser via `GET /v1/config` DTO so client-side derivation always agrees with the server (no build-time constant drift - see ADR "netconfig").
- Purpose: Content-addressed (hex-hash keyed) storage for the off-chain resolution artifacts (announcements, proofs, signed updates, genesis documents) a did:btcr2 resolver needs.
- Examples: `packages/service/src/store.ts` (`MemoryArtifactStore`, `FileSystemArtifactStore`, `mountArtifactRoutes`).
- Pattern: Write path is internal (`persistCohortArtifacts`, `persistMemberGenesis`); read path is the public, unauthenticated `GET /cas/*` route family.
- Purpose: The two composition roots of the app - each wraps a library runner + transport plus this repo's side-effect wiring, and returns a small `start()/stop()` lifecycle handle.
- Examples: `packages/service/src/index.ts`, `packages/participant/src/index.ts`.
- Pattern: Options objects with extensive JSDoc describing opt-in gates (live, broadcast, roster, ipfs); nothing is enabled implicitly.

## Entry Points

- Location: `packages/service/src/demo-server.ts` (`invokedDirectly` guard runs `startDemoServer` when executed directly).
- Triggers: `tsx packages/service/src/demo-server.ts` after `pnpm -r build` (per `package.json` `demo` script).
- Responsibilities: resolve network + guard rails (mainnet opt-in), construct Bitcoin connection (offline or live), optional IPFS node, `createService`, start listening, run the perpetual advertise-cohort loop, handle SIGINT/SIGTERM shutdown.
- Location: `packages/web/vite.config.ts` (Vite dev server + proxy for API routes to the coordinator).
- Triggers: `pnpm --filter @btcr2-aggregation/web dev`.
- Responsibilities: serve the SPA with HMR; proxy non-static requests to a coordinator running separately, preserving the same-origin illusion in dev.
- Location: `e2e/headless-cohort.ts`, `e2e/resolve-cohort.ts`, `e2e/baked-cohort.ts`, `e2e/live-mock-cohort.ts`, `e2e/browser-cohort.ts`, `e2e/browser-prod-cohort.ts`, `e2e/config.ts`, `e2e/ipfs-cohort.ts`, `e2e/persist-cohort.ts`, `e2e/live-broadcast-cohort.ts`.
- Triggers: `pnpm e2e*` scripts in `package.json`.
- Responsibilities: boot a real (or mocked-chain) `createService` + real `createParticipant`(s) in-process, drive a full cohort end to end, assert on real HTTP/SSE behavior (the fixture-tx default keeps this gate hermetic; `LIVE=1` opts into real esplora/broadcast, e.g. `e2e:live:regtest`).
- Location: `packages/web/src/main.tsx`.
- Triggers: browser page load.
- Responsibilities: mount `App.tsx` (the two-tab shell) into the DOM.

## Architectural Constraints

- **Threading:** Single-threaded Node event loop per coordinator process; no worker threads. The advertise loop (`demo-server.ts`) is a `while` loop over awaited promises, not a separate thread.
- **Global state:** `packages/service/src/index.ts` holds two per-`createService`-call closures of mutable state: `genesisStaging` (`GenesisStagingCache`) and `seatedRosterKeys` (`Map<cohortId, Set<pubkeyHex>>`). Both are scoped to one `createService()` call, not module-level singletons, so multiple services in the same process (e.g. tests) do not share state.
- **No auth/role separation in the web bundle:** `packages/web` ships ONE anonymous JS bundle containing both the Participant flow and the Coordinator dashboard tab; there is no login, no role check, no build-time split. Anyone loading the page can switch to the Coordinator tab (it is read-only telemetry, so this is a transparency choice, not a vulnerability, but it means "Coordinator" here means "the app operator's public status view," not a privileged admin panel).
- **Real-money paths are opt-in-only:** every code path that can move Bitcoin (LIVE broadcast, mainnet target, the `/v1/tx/*` proxy actually relaying) requires explicit flags/env vars (`live`, `broadcast`, `allowMainnet`, `LIVE=1`, `ALLOW_MAINNET=1`); the default is the hermetic zero-chain fixture path (see ADR 0010).
- **Sans-I/O core, one adapter:** the aggregation protocol transport itself is framework-agnostic; `hono-adapter.ts` is the sole place that binds it to a real HTTP server, so swapping HTTP frameworks would only touch that one file plus `demo-server.ts`'s `serve()` call.

## Anti-Patterns

### The "Coordinator" tab looks like an admin console but isn't

### Rebuilding a signed update after submission

## Error Handling

- Side-effect listeners (`persistCohortArtifacts`, `persistMemberGenesis`, broadcast) are fire-and-forget with `.catch()` logging - a failure there must never disturb the protocol (`packages/service/src/index.ts`).
- HTTP routes that call out (resolve, tx proxy, ipfs pin) return generic `502`/`400` bodies to callers while logging the real error server-side, so internals are never disclosed to an untrusted caller (`packages/service/src/hono-adapter.ts`).
- Input shape guards run before expensive/parsing work (DID regex before `resolveBtcr2`, address regex before esplora calls, hex/length checks before tx broadcast) to keep unauthenticated 400s cheap.

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
