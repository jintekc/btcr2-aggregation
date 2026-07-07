<!-- refreshed: 2026-07-07 -->
# Architecture

**Analysis Date:** 2026-07-07

## System Overview

This is a reference/example app for `did:btcr2` aggregation over HTTP/REST. There is exactly **one server process** (the "coordinator" / `packages/service`); the "participant" role is a client library (`packages/participant`) run either headlessly in Node (e2e harnesses, in-process "fillers") or inside the browser as part of the web SPA (`packages/web`). Both the SPA and the REST API are served from the SAME origin/port by the coordinator process.

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                    Browser (one anonymous bundle, no auth)                │
│  packages/web  (React 19 + Vite 8 + Tailwind v4 + Zustand 5)              │
│  App.tsx = two-tab shell over ONE same-origin service                     │
│  ┌───────────────────────┐        ┌────────────────────────────────────┐ │
│  │ Participant tab        │        │ Coordinator tab                    │ │
│  │ ParticipantView.tsx    │        │ DashboardView.tsx                  │ │
│  │ drives an in-browser   │        │ READ-ONLY telemetry via SSE        │ │
│  │ `createParticipant`    │        │ (/dashboard/events) - NOT an admin │ │
│  │ (packages/participant) │        │ console, no write/control actions  │ │
│  └───────────┬────────────┘        └───────────────┬────────────────────┘ │
└──────────────┼─────────────────────────────────────┼──────────────────────┘
               │ HttpClientTransport (fetch + SSE)    │ SSE (read-only)
               ▼                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│              packages/service - the ONE server process (coordinator)      │
│  `demo-server.ts` boots + owns the advertise-cohort while-loop            │
│  `hono-adapter.ts` mounts everything on one Hono app, one port            │
│  ┌────────────┐ ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌─────────────┐ │
│  │ Protocol    │ │ Dashboard │ │ Resolve   │ │ Store    │ │ Tx proxy /  │ │
│  │ transport   │ │ SSE       │ │ (server-  │ │ (/cas/*  │ │ IPFS pin /  │ │
│  │ (HttpServer │ │ (dashboard│ │  driven   │ │  content-│ │ static-site │ │
│  │ Transport   │ │ -sse.ts)  │ │  resolve  │ │  addr.)  │ │ (SPA serve) │ │
│  │ from the    │ │           │ │  Btcr2)   │ │          │ │             │ │
│  │ aggregation │ │           │ │           │ │          │ │             │ │
│  │ library)    │ │           │ │           │ │          │ │             │ │
│  └────────────┘ └───────────┘ └───────────┘ └──────────┘ └─────────────┘ │
└──────────────┬──────────────────────────────────────────────┬─────────────┘
               │                                               │
               ▼                                               ▼
┌────────────────────────────┐                  ┌──────────────────────────┐
│ @did-btcr2/aggregation      │                  │ Bitcoin network           │
│ (published library):        │                  │ (mutinynet/signet/       │
│ AggregationServiceRunner /  │                  │  regtest/testnet/mainnet,│
│ AggregationParticipantRunner│                  │  config-driven via       │
│ n-of-n MuSig2 co-signing    │                  │  packages/shared/        │
│ CAS/SMT beacon construction │                  │  networks.ts)            │
└──────────────────────────────────────────────────────────────────────────┘
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

**Overall:** Single coordinator process exposing a sans-I/O protocol transport (from the published `@did-btcr2/aggregation` library) mounted under an HTTP framework adapter (Hono), plus demo/production concerns (dashboard telemetry, artifact store, resolver, tx proxy, static SPA serve) layered onto the same Hono app instance. Clients (participants) are a separate isomorphic package consumed by both Node e2e harnesses and the browser SPA - there is no separate participant server.

**Key Characteristics:**
- Same-origin topology: one port serves both the API and the SPA (dev: Vite proxy; prod: Hono static-site mount) — see `docs/adr/0003-same-origin-topology.md`.
- Config-driven Bitcoin network: never hardcoded; resolved once per boot from `packages/shared/src/networks.ts` and served to the browser at runtime via `GET /v1/config` so client-side DID/address derivation always matches the coordinator's chain.
- Everything real-money (LIVE broadcast, mainnet) is opt-in and layered behind explicit guard rails (`allowMainnet`, `live`), defaulting to a hermetic, zero-chain fixture path.
- The library's transport (`HttpServerTransport`/`HttpClientTransport`) is intentionally framework-agnostic; `hono-adapter.ts` is the only place Hono-specific request/response mapping happens.
- No auth/role separation at the HTTP layer: any client can hit any route (dashboard is read-only by construction, not by access control).

## Layers

**Protocol transport layer:**
- Purpose: Sans-I/O message routing, SSE fan-out, sender-key authentication for the aggregation protocol itself (adverts, opt-ins, MuSig2 rounds).
- Location: consumed from `@did-btcr2/aggregation/service` and `@did-btcr2/aggregation/participant` (external published packages, not in this repo).
- Contains: `HttpServerTransport`, `HttpClientTransport`, `AggregationServiceRunner`, `AggregationParticipantRunner`.
- Depends on: nothing in this repo (external dependency).
- Used by: `packages/service/src/index.ts`, `packages/participant/src/index.ts`.

**HTTP adapter layer:**
- Purpose: Bind the sans-I/O transport (and every app-level concern) to a real Node HTTP server via Hono.
- Location: `packages/service/src/hono-adapter.ts`, `packages/service/src/static-site.ts`.
- Contains: route mounting, request/response shape translation, raw SSE hijacking (`c.env.outgoing`).
- Depends on: the protocol transport, `packages/service`'s own modules (store, resolve, ipfs, broadcast).
- Used by: `createService` in `packages/service/src/index.ts`.

**Service orchestration layer:**
- Purpose: Wires side effects onto runner lifecycle events (persist artifacts on `signing-complete`, promote staged genesis on `participant-accepted`, broadcast+confirm the beacon tx), and the long-lived advertise loop.
- Location: `packages/service/src/index.ts` (createService), `packages/service/src/demo-server.ts` (process entry point + loop).
- Depends on: HTTP adapter layer, shared identity/network/cohort helpers.
- Used by: the `pnpm demo` entry point and every e2e harness that boots a real service.

**Client/participant layer (isomorphic):**
- Purpose: Join advertised cohorts, decide whether/how to submit a signed update, handle cooperative non-inclusion for baked-identity mismatches.
- Location: `packages/participant/src/index.ts`.
- Contains: `createParticipant` factory wrapping `AggregationParticipantRunner` + `HttpClientTransport`.
- Depends on: `packages/shared` (signed-update builder, cohort-fit classification), the protocol transport.
- Used by: `packages/service/src/demo-server.ts` (in-process "fillers"), `e2e/*.ts` headless harnesses, `packages/web/src/stores/participant.ts` (browser).

**Web UI layer:**
- Purpose: Browser-side presentation and orchestration for both the Participant flow and the read-only Coordinator dashboard.
- Location: `packages/web/src/{App.tsx,components,stores,lib}`.
- Contains: React components, Zustand stores (`participant.ts`, `dashboard.ts`), browser-only helpers (`lib/ipfs-node.ts`, `lib/tx-client.ts`, `lib/sidecar.ts`, `lib/resolve.ts`).
- Depends on: `packages/participant` (via the participant store), `packages/shared`, same-origin fetch/SSE to the coordinator.
- Used by: nothing further (leaf/UI layer).

**Shared/domain layer:**
- Purpose: DID/key identity construction, cohort config, signed-update helpers, IPFS digest helpers, the network registry (single source of truth for chain params).
- Location: `packages/shared/src/{index.ts,networks.ts,ipfs.ts}`.
- Depends on: `@did-btcr2/method`, `@did-btcr2/bitcoin` (external published libraries).
- Used by: `packages/service`, `packages/participant`, `packages/web` (all three consume `@btcr2-aggregation/shared`).

## Data Flow

### Full cohort lifecycle: advertise -> join -> submit -> co-sign -> anchor -> resolve

1. **Advertise** - `demo-server.ts`'s `loop()` calls `service.runner.advertiseCohort(cohortConfig)`, producing a fresh `cohortId` and a `completion` promise (`packages/service/src/demo-server.ts:245`). The runner broadcasts the advert over the protocol transport's SSE (`GET /v1/adverts`).
2. **Join** - Each participant (in-process filler, headless e2e, or browser) subscribes to `/v1/adverts` via `HttpClientTransport`, and its `shouldJoin` callback in `createParticipant` accepts (`packages/participant/src/index.ts:120`), recording the cohort's `beaconType`.
3. **Opt-in / authentication** - The participant's opt-in is authenticated server-side via `resolveSenderPk` (`packages/service/src/index.ts:274`): a KEY (`k1`) DID decodes its key directly; an EXTERNAL (`x1`) DID is bootstrap-authenticated from a self-verifying `genesisDocument` carried on the opt-in (ADR 0009). A BAKED x1 genesis is staged here (`GenesisStagingCache`) for possible promotion. When `rosterPks` is configured (pre-provisioned/baked cohorts), `decideRosterOptIn` (`packages/service/src/roster.ts`) additionally gates on roster membership and prevents duplicate seating (ADR 0012).
4. **Submit update** - On `onProvideUpdate`, the participant builds a signed did:btcr2 update via `buildSignedUpdate` (`packages/shared`) appending a beacon service matching the cohort's beacon type (CAS or SMT) at the cohort's beacon address (`packages/participant/src/index.ts:141`). A BAKED identity whose genesis does not match the cohort's derived beacon address/type instead returns `null` (cooperative non-inclusion, ADR 0012) so the n-of-n round is not stalled.
5. **n-of-n MuSig2 co-sign** - Handled entirely inside the library's `AggregationServiceRunner`/`AggregationParticipantRunner` (nonce exchange, aggregation, signing rounds); this repo only supplies `onProvideTxData` (the beacon tx to sign) via `makeProvideTxData` (`packages/service/src/tx.ts`).
6. **Aggregated beacon tx** - `onProvideTxData` builds either the zero-chain fixture tx (hermetic default) or, under `live`, a real `buildAggregationBeaconTx` spending a funded UTXO at the cohort's derived beacon address (`packages/service/src/tx.ts`, `packages/service/src/beacon-address.ts`).
7. **Persist artifacts** - On the runner's `signing-complete` event, `persistCohortArtifacts` (`packages/service/src/persist.ts`) harvests each member's signed update plus the CAS announcement/SMT proofs into the `ArtifactStore` (`packages/service/src/store.ts`), keyed by hex hash for later `GET /cas/*` and resolver lookups.
8. **Genesis promotion** - On `participant-accepted`, any staged BAKED x1 genesis is promoted into the durable store (`persistMemberGenesis`, `packages/service/src/genesis-capture.ts`), making that member sidecar-lessly resolvable.
9. **Broadcast + anchor (opt-in)** - When `broadcast: true` (requires `live`), `attachBeaconBroadcast` (`packages/service/src/broadcast.ts`) pushes the signed beacon tx to the network on `signing-complete` and polls for confirmation, emitting `beacon-broadcast`/`beacon-anchored` events surfaced on the dashboard SSE feed.
10. **Resolve** - `GET /resolve/:did` (KEY) or `POST /resolve/:did` (EXTERNAL, body carries the sidecar genesis) drives `resolveBtcr2` (`packages/service/src/resolve.ts`), which discovers beacon signals over the injected `BitcoinConnection` and fetches off-chain artifacts from the store, returning `{ didDocument, didDocumentMetadata }`.

### Dashboard telemetry (read-only, separate from the protocol data path)

1. Browser opens `GET /dashboard/events` (SSE) from the Coordinator tab (`DashboardView.tsx`).
2. `bridgeRunnerToSse` (`packages/service/src/dashboard-sse.ts`) subscribes to the runner's and (if present) broadcaster's lifecycle events and re-emits them as SSE frames.
3. `packages/web/src/stores/dashboard.ts` (Zustand) consumes the stream and updates UI-only state. No write path exists back from this tab to the coordinator - it is telemetry only, never a control surface.

**State Management:**
- Server: transport/runner state lives inside the library's `AggregationServiceRunner`/session (per-cohort accessors); this repo adds only side-tables (`GenesisStagingCache`, `seatedRosterKeys` Map) scoped to `packages/service/src/index.ts`.
- Client: Zustand stores per concern (`participant.ts` for the join/sign/register/resolve flow, `dashboard.ts` for telemetry), both scoped to `packages/web/src/stores/`.

## Key Abstractions

**Identity:**
- Purpose: A DID controller's keys + DID (+ optional `genesisDocument` for EXTERNAL/x1) — the unit both `createService` (coordinator identity) and `createParticipant` (attendee identity) are constructed from.
- Examples: `packages/shared/src/index.ts` (`createIdentity`, `Identity` type).
- Pattern: Same shape used server-side and client-side; onboarding model (KEY vs EXTERNAL) is a property of the identity, not a branch in calling code.

**NetworkConfig / network registry:**
- Purpose: Single source of truth for which Bitcoin network (mutinynet/signet/testnet/regtest/mainnet) the whole stack targets, including scure params and explorer/esplora hosts.
- Examples: `packages/shared/src/networks.ts` (`resolveNetwork`, `assertNetworkAllowed`, `toNetworkConfigDTO`, `DEFAULT_NETWORK`).
- Pattern: Resolved once server-side at boot; served to the browser via `GET /v1/config` DTO so client-side derivation always agrees with the server (no build-time constant drift — see ADR "netconfig").

**ArtifactStore:**
- Purpose: Content-addressed (hex-hash keyed) storage for the off-chain resolution artifacts (announcements, proofs, signed updates, genesis documents) a did:btcr2 resolver needs.
- Examples: `packages/service/src/store.ts` (`MemoryArtifactStore`, `FileSystemArtifactStore`, `mountArtifactRoutes`).
- Pattern: Write path is internal (`persistCohortArtifacts`, `persistMemberGenesis`); read path is the public, unauthenticated `GET /cas/*` route family.

**Service (createService) / Participant (createParticipant) factories:**
- Purpose: The two composition roots of the app — each wraps a library runner + transport plus this repo's side-effect wiring, and returns a small `start()/stop()` lifecycle handle.
- Examples: `packages/service/src/index.ts`, `packages/participant/src/index.ts`.
- Pattern: Options objects with extensive JSDoc describing opt-in gates (live, broadcast, roster, ipfs); nothing is enabled implicitly.

## Entry Points

**`pnpm demo` (production/self-host coordinator):**
- Location: `packages/service/src/demo-server.ts` (`invokedDirectly` guard runs `startDemoServer` when executed directly).
- Triggers: `tsx packages/service/src/demo-server.ts` after `pnpm -r build` (per `package.json` `demo` script).
- Responsibilities: resolve network + guard rails (mainnet opt-in), construct Bitcoin connection (offline or live), optional IPFS node, `createService`, start listening, run the perpetual advertise-cohort loop, handle SIGINT/SIGTERM shutdown.

**`pnpm dev` (web dev server):**
- Location: `packages/web/vite.config.ts` (Vite dev server + proxy for API routes to the coordinator).
- Triggers: `pnpm --filter @btcr2-aggregation/web dev`.
- Responsibilities: serve the SPA with HMR; proxy non-static requests to a coordinator running separately, preserving the same-origin illusion in dev.

**`e2e/*.ts` harnesses:**
- Location: `e2e/headless-cohort.ts`, `e2e/resolve-cohort.ts`, `e2e/baked-cohort.ts`, `e2e/live-mock-cohort.ts`, `e2e/browser-cohort.ts`, `e2e/browser-prod-cohort.ts`, `e2e/config.ts`, `e2e/ipfs-cohort.ts`, `e2e/persist-cohort.ts`, `e2e/live-broadcast-cohort.ts`.
- Triggers: `pnpm e2e*` scripts in `package.json`.
- Responsibilities: boot a real (or mocked-chain) `createService` + real `createParticipant`(s) in-process, drive a full cohort end to end, assert on real HTTP/SSE behavior (the fixture-tx default keeps this gate hermetic; `LIVE=1` opts into real esplora/broadcast, e.g. `e2e:live:regtest`).

**Web `main.tsx`:**
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

**What happens:** The web UI's second tab is literally labeled "Coordinator" and shows live cohort/broadcast telemetry, which could be mistaken for a privileged operator control panel.
**Why it's wrong:** There is no authentication, no write/control API behind it — it is purely `GET /dashboard/events` SSE consumption. Anyone with the URL sees the same view.
**Do this instead:** Treat any future write/control functionality on this tab as a new, separately-authenticated surface; do not assume the existing route family is protected. New code should not add mutating routes reachable from `DashboardView.tsx` without adding real authorization first.

### Rebuilding a signed update after submission

**What happens:** A naive implementation might try to recompute a participant's signed update later (e.g., for a retry or audit) by calling `buildSignedUpdate` again with the same inputs.
**Why it's wrong:** BIP340 signing injects fresh randomness per call, so a rebuilt update hashes differently from the one actually submitted and co-signed — the cohort's aggregate commitment would not match.
**Do this instead:** Capture the exact submitted body at submit time, as `packages/participant/src/index.ts` does via `submittedUpdates: Map<cohortId, SubmittedUpdate>`, and read it back via `getSubmittedUpdate(cohortId)`.

## Error Handling

**Strategy:** Fail fast on misconfiguration at boot (mainnet without opt-in, unknown network name, `live` without a Bitcoin connection); degrade gracefully and log at the per-cohort/per-request level for runtime faults (a stalled cohort times out via `cohortTtlMs`/`phaseTimeoutMs` and the advertise loop moves on; a persist/broadcast failure is caught, logged, and never crashes the runner).

**Patterns:**
- Side-effect listeners (`persistCohortArtifacts`, `persistMemberGenesis`, broadcast) are fire-and-forget with `.catch()` logging — a failure there must never disturb the protocol (`packages/service/src/index.ts`).
- HTTP routes that call out (resolve, tx proxy, ipfs pin) return generic `502`/`400` bodies to callers while logging the real error server-side, so internals are never disclosed to an untrusted caller (`packages/service/src/hono-adapter.ts`).
- Input shape guards run before expensive/parsing work (DID regex before `resolveBtcr2`, address regex before esplora calls, hex/length checks before tx broadcast) to keep unauthenticated 400s cheap.

## Cross-Cutting Concerns

**Logging:** Plain `console.log`/`console.warn`/`console.error`, prefixed by module tag (`[demo]`, `[service]`, `[adapter]`, `[resolve]`, `[tx]`); no structured logging framework. `SSE_DEBUG=1` env var enables verbose SSE tracing in `hono-adapter.ts`.

**Validation:** Manual regex/shape guards at each untrusted HTTP boundary (address format, DID format, hex tx format, body-size limits via Hono's `bodyLimit`); no schema validation library.

**Authentication:** Protocol-level sender authentication only (`resolveSenderPk`, DID-key decoding or genesis bootstrap-auth), handled entirely inside the aggregation library + the `resolveSenderPk` wrapper in `packages/service/src/index.ts`. No session/user auth exists anywhere in the HTTP layer; all REST routes (dashboard, resolve, cas, tx proxy) are unauthenticated by design (public reference app).

---

*Architecture analysis: 2026-07-07*
