# Technology Stack

**Analysis Date:** 2026-07-07

## Languages

**Primary:**
- TypeScript 5.9 (`^5.9`) - all packages (`packages/{shared,service,participant,web}`, `e2e/`)

**Secondary:**
- None (no other source language present; deploy tooling uses Dockerfile syntax, shell in CI YAML)

## Runtime

**Environment:**
- Node.js >= 22 (`package.json` `engines.node`), pinned to `node:22-bookworm-slim` in `Dockerfile`
- `type: "module"` everywhere - pure ESM, no CommonJS
- `tsx` (`^4`) used to run TypeScript directly for scripts/e2e without a separate compile step

**Package Manager:**
- pnpm workspace, pinned to `pnpm@11.4.0` in CI and `Dockerfile`
- Lockfile: present (`pnpm-lock.yaml`, committed, treated as trusted base)
- Workspace layout defined in `pnpm-workspace.yaml`: `packages/*` + `e2e`
- `pnpm-workspace.yaml` also pins `allowBuilds` (disables native builds for `classic-level`, `esbuild`) and `minimumReleaseAgeExclude` for specific fast-moving deps (`@did-btcr2/method`, `@did-btcr2/aggregation`, Tailwind v4 oxide binaries) to bypass pnpm 11's 24h minimumReleaseAge gate

## Frameworks

**Core (server):**
- Hono `^4` - HTTP framework for the coordinator/service (`packages/service/src/hono-adapter.ts`, `packages/service/src/demo-server.ts`)
- `@hono/node-server` `^1` - Node adapter to run Hono outside a serverless runtime

**Core (web):**
- React `^19.2.7` + `react-dom` `^19.2.7` - UI (`packages/web/src`)
- Vite `^8` - dev server and build (`packages/web/vite.config.ts`)
- `@vitejs/plugin-react` `^6`
- Tailwind CSS `^4.3.2` via `@tailwindcss/vite` `^4.3.2` - styling
- Zustand `^5.0.14` - client state (`packages/web/src/stores/dashboard.ts`)
- `vite-plugin-node-polyfills` `^0.28.0` - polyfills Node built-ins for browser bundle (needed because the isomorphic participant/shared code touches some Node-shaped APIs)

**Testing:**
- Vitest `^2` - unit tests across all packages (`*.spec.ts` co-located with source)
- Playwright (`playwright-core` `^1.61.1`, headless Chromium, no full `playwright` package) - drives browser e2e (`e2e/browser-cohort.ts`, `e2e/browser-prod-cohort.ts`)

**Build/Dev:**
- TypeScript project references / composite build: root `tsconfig.json` references `packages/shared`, `packages/service`, `packages/participant`, `e2e` (web builds separately via `tsc --noEmit` + `vite build`)
- ESLint `^9` + `typescript-eslint` `^8` - linting (`pnpm lint` = `eslint .`)
- `rimraf` `^6` - cross-platform clean script
- `tsx` `^4` - runs e2e harness scripts and the demo server without a build step in dev

## Key Dependencies

**Critical (protocol - published `@did-btcr2/*` packages, the core consumed library):**
- `@did-btcr2/method` `^0.51.0` - DID method core (create/update/resolve did:btcr2)
- `@did-btcr2/aggregation` `^0.4.0` - n-of-n MuSig2 cohort aggregation protocol, transports
- `@did-btcr2/keypair` `^0.13.1` - key generation/import
- `@did-btcr2/common` `^9.1.0` - shared method types/utilities
- `@did-btcr2/bitcoin` `^0.8.0` - `BitcoinConnection` esplora REST client, tx helpers (service + e2e only)
- `@did-btcr2/smt` `^0.3.0` - sparse Merkle tree beacon support (service only)

**Bitcoin/crypto primitives:**
- `@scure/btc-signer` `^1.8.1` - transaction building/signing
- `@noble/hashes` `^1.8.0` - hash primitives

**IPFS/libp2p (opt-in, `packages/service` and `packages/web`):**
- `libp2p` `2.10.0`, `@libp2p/interface` `2.11.0`, `@libp2p/identify` `3.0.39`, `@libp2p/websockets` `9.2.19`
- `@chainsafe/libp2p-noise` `16.1.5`, `@chainsafe/libp2p-yamux` `7.0.4` - transport security/muxing
- `@helia/utils` `1.4.0`, `@helia/interface` `5.4.0`, `@helia/block-brokers` `4.2.4` - Helia (IPFS) node
- `@multiformats/multiaddr` `12.5.1`, `multiformats` `13.4.2` - CID/multiaddr encoding
- `blockstore-core`/`blockstore-fs`, `datastore-core`/`datastore-fs` - Helia storage backends (fs-backed on the service, in-memory/browser-backed on web)

**Infrastructure:**
- None beyond the above (no ORM, no database driver, no queue/cache client)

## Configuration

**Environment:**
- Configured entirely via process env vars read in `packages/service/src/demo-server.ts` (no config file, no `.env.example` committed; `docker-compose.yml` documents the vars with defaults)
- Key vars: `NETWORK` (default `mutinynet`), `ESPLORA_HOST` (override indexer), `LIVE` (enables real esplora I/O), `ALLOW_MAINNET`, `RECOVERY_KEY`, `MIN_PARTICIPANTS`, `FILLERS`, `IPFS`, `IPFS_DIR`, `IPFS_ANNOUNCE`, `HOST`, `PORT`, `COHORT_TTL_MS`, `PHASE_TIMEOUT_MS`
- No `.env` file exists in the repo; `docker-compose.yml` supports one implicitly via compose env-file conventions
- Browser gets network config at runtime (not build time) via `GET /v1/config` served by `packages/service/src/hono-adapter.ts` - this is a deliberate "one image, any network" design (ADR 0014)

**Build:**
- `tsconfig.json` (root, project-references only, `files: []`)
- Per-package `tsconfig.json` under each `packages/*` and `e2e/`
- `packages/web/vite.config.ts` - dev proxy (`COORDINATOR_ORIGIN`, defaults to `http://127.0.0.1:8080`) forwards `/v1`, `/dashboard`, `/resolve`, `/cas` to the coordinator so the browser never needs CORS; browser build resolves the `browser` export condition first to pick up prebundled `dist/browser.mjs` from `@did-btcr2/method`/`aggregation` and excludes native `level`/`classic-level` from the dep prebundle
- `eslint.config.*` - not read in detail but present per `pnpm lint` script

## Platform Requirements

**Development:**
- Node >= 22, pnpm 11.4.0
- No database, no external service required to run the hermetic unit/e2e suite (offline/fixture mode is the default; chain and IPFS I/O are both opt-in)

**Production:**
- Self-hosted via Docker: `Dockerfile` (multi-stage: `base` -> `builder` -> `runtime`, non-root `node` user, `HEALTHCHECK` against `GET /v1/config`) + `docker-compose.yml`
- Single container serves both the API and the built SPA on one port (same-origin topology, ADR 0003); TLS terminated by an external reverse proxy (documented in `docs/DEPLOY.md`)
- One image serves any Bitcoin network - network selected at container run time via `NETWORK` env var, not baked in at build time

---

*Stack analysis: 2026-07-07*
