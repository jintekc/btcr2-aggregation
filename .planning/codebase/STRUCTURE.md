# Codebase Structure

**Analysis Date:** 2026-07-07

## Directory Layout

```
btcr2-aggregation/                     # pnpm workspace root
├── packages/
│   ├── shared/                        # @btcr2-aggregation/shared - domain/identity/network helpers
│   │   └── src/
│   │       ├── index.ts               # identity, cohort config, signed-update, cohort-fit helpers
│   │       ├── networks.ts            # network registry (mutinynet/signet/testnet/regtest/mainnet)
│   │       ├── ipfs.ts                # IPFS digest/CID helpers
│   │       └── *.spec.ts              # co-located unit tests
│   ├── service/                       # @btcr2-aggregation/service - the ONE coordinator server
│   │   └── src/
│   │       ├── demo-server.ts         # process entry point: boot + advertise loop + shutdown
│   │       ├── index.ts               # createService(): wires runner + transport + side effects
│   │       ├── hono-adapter.ts        # Hono HTTP mount: all routes on one app
│   │       ├── dashboard-sse.ts       # runner/broadcaster events -> read-only dashboard SSE
│   │       ├── resolve.ts             # server-driven resolveBtcr2 + GET/POST /resolve/:did
│   │       ├── store.ts               # ArtifactStore (memory/filesystem) + GET /cas/* routes
│   │       ├── persist.ts             # harvest cohort artifacts into the store
│   │       ├── genesis-capture.ts     # stage/promote BAKED x1 genesis documents
│   │       ├── roster.ts              # fixed-roster opt-in gating (pre-provisioned cohorts)
│   │       ├── beacon-address.ts      # derive a cohort's aggregate beacon address
│   │       ├── tx.ts                  # fixture / live beacon-tx data provider
│   │       ├── broadcast.ts           # opt-in beacon-tx broadcast + confirmation polling
│   │       ├── offline-chain.ts       # zero-network BitcoinConnection stub (hermetic default)
│   │       ├── static-site.ts         # serve packages/web/dist as a trailing catch-all
│   │       ├── ipfs.ts                # opt-in Helia pinning node + pin route validation
│   │       └── *.spec.ts              # co-located unit tests (one per module above)
│   ├── participant/                   # @btcr2-aggregation/participant - isomorphic client
│   │   └── src/
│   │       └── index.ts               # createParticipant(): join/submit/decline logic
│   └── web/                           # @btcr2-aggregation/web - React SPA (Vite)
│       └── src/
│           ├── main.tsx               # DOM mount entry point
│           ├── App.tsx                # two-tab shell (Participant / Coordinator)
│           ├── index.css              # Tailwind entry
│           ├── components/
│           │   ├── LogPanel.tsx       # shared log display
│           │   ├── participant/       # Participant-tab flow panels
│           │   │   ├── ParticipantView.tsx   # orchestrates the join/sign/register/resolve flow
│           │   │   ├── FlowStepper.tsx       # step progress UI
│           │   │   ├── KeyGenPanel.tsx       # identity/key generation step
│           │   │   ├── RegisterPanel.tsx     # first-update singleton-beacon registration (KEY self-bootstrap)
│           │   │   ├── PublishPanel.tsx      # opt-in IPFS artifact publish
│           │   │   ├── ResolvePanel.tsx      # resolve UX
│           │   │   └── ResultCard.tsx        # outcome display
│           │   └── dashboard/         # Coordinator-tab (read-only telemetry)
│           │       ├── DashboardView.tsx
│           │       ├── CohortCard.tsx
│           │       └── MetricsStrip.tsx
│           ├── stores/                # Zustand state
│           │   ├── participant.ts     # participant flow state machine (804 lines - largest file in repo)
│           │   ├── participant.spec.ts
│           │   └── dashboard.ts       # dashboard SSE-fed telemetry state
│           ├── lib/                   # browser-only helpers (no Node APIs)
│           │   ├── config.ts          # GET /v1/config client
│           │   ├── resolve.ts         # browser resolve client (calls same-origin /resolve/:did)
│           │   ├── tx-client.ts       # same-origin /v1/tx/* proxy client
│           │   ├── sidecar.ts         # sovereign sidecar download/format
│           │   ├── ipfs.ts            # IPFS client helpers
│           │   ├── ipfs-node.ts       # in-browser Helia node bootstrap
│           │   ├── types.ts           # shared web-local types
│           │   └── clock.ts           # time helpers
│           └── ui/
│               └── primitives.tsx     # low-level shared UI primitives (buttons, cards, etc.)
├── e2e/                                # cross-package end-to-end harnesses (own tsconfig/package.json)
│   ├── headless-cohort.ts             # base cohort e2e (+ --smt/--x1/--mixed/--negative flags)
│   ├── persist-cohort.ts              # artifact-persistence e2e
│   ├── resolve-cohort.ts              # resolve round-trip e2e (LIVE=1 for regtest live legs)
│   ├── config.ts                      # GET /v1/config + mainnet-guard + IPFS env-path e2e
│   ├── ipfs-cohort.ts                 # IPFS publish/pin e2e
│   ├── baked-cohort.ts                # baked-genesis onboarding e2e
│   ├── live-mock-cohort.ts            # live beacon-tx build/sign against a mocked connection
│   ├── live-broadcast-cohort.ts       # live beacon-tx broadcast e2e
│   ├── browser-cohort.ts              # Playwright-driven browser participant e2e (dev topology)
│   ├── browser-prod-cohort.ts         # Playwright-driven browser e2e against the prod static build
│   └── lib/
│       └── regtest.ts                 # throwaway bitcoind + esplora-electrs harness (CI live gate)
├── docs/
│   ├── adr/                           # 0001-0014, one architectural decision per file
│   ├── specs/                         # deep design specs
│   ├── DEPLOY.md                      # self-host deploy runbook
│   ├── PROJECT-CONTEXT.md, SCAFFOLD-PLAN.md, M3-PLAN.md, M3b2-ipfs-cid-spike.md
├── .github/workflows/ci.yml           # hermetic 16-check job + regtest-live job
├── Dockerfile, docker-compose.yml     # M4 self-host deploy tooling
├── .planning/                          # GSD planning artifacts (this analysis lives here)
└── package.json                        # workspace scripts (build/test/e2e:*/dev/demo)
```

## Directory Purposes

**`packages/shared/`:**
- Purpose: The single source of truth for identity construction, cohort config, signed-update building, and the Bitcoin network registry — consumed by every other package.
- Contains: pure TS modules + co-located `.spec.ts` unit tests, no HTTP/framework code.
- Key files: `src/index.ts` (identity/cohort/update), `src/networks.ts` (network registry, `resolveNetwork`, `assertNetworkAllowed`, `DEFAULT_NETWORK`).

**`packages/service/`:**
- Purpose: The one coordinator server process — protocol transport hosting, dashboard telemetry, resolver, artifact store, tx proxy, optional IPFS node, static SPA serving.
- Contains: one Node/Hono app's worth of modules, each with a co-located `.spec.ts`.
- Key files: `src/demo-server.ts` (entry point), `src/index.ts` (composition root `createService`), `src/hono-adapter.ts` (route mounting).

**`packages/participant/`:**
- Purpose: The isomorphic client role (works identically in Node and the browser) that joins cohorts and submits/declines signed updates.
- Contains: a single `src/index.ts` composition function, `createParticipant`; no framework or Node-only dependencies.
- Key files: `src/index.ts`.

**`packages/web/`:**
- Purpose: The browser SPA — a two-tab shell over the same-origin coordinator (Participant flow + read-only Coordinator dashboard).
- Contains: React components, Zustand stores, browser-only lib helpers, Tailwind styling.
- Key files: `src/App.tsx` (shell), `src/stores/participant.ts` (largest file in the repo, 804 lines — the flow state machine), `src/stores/dashboard.ts`.

**`e2e/`:**
- Purpose: Cross-package integration/end-to-end tests that boot a real (or mock-chain) service + real participants and drive full cohorts over real HTTP/SSE. Has its own `package.json`/`tsconfig.json` (separate TS project, not part of the `packages/*` workspace build graph).
- Generated: `e2e/dist` is build output (generated, not committed source).
- Key files: `headless-cohort.ts` (base flow + flags), `lib/regtest.ts` (the regtest CI harness).

**`docs/adr/`:**
- Purpose: One architectural decision record per significant design choice; numbered sequentially (0001-0014). Consult before changing topology, onboarding models, network handling, or deploy tooling.
- Committed: Yes.

## Key File Locations

**Entry Points:**
- `packages/service/src/demo-server.ts`: coordinator process boot (`pnpm demo`).
- `packages/web/src/main.tsx`: browser SPA mount.
- `packages/web/vite.config.ts`: dev server + API proxy config (`pnpm dev`).
- `e2e/headless-cohort.ts` and siblings: e2e harness entry points (`pnpm e2e*`).

**Configuration:**
- `package.json` (root): workspace scripts, `pnpm -r` fan-out commands.
- `packages/web/vite.config.ts`: Vite/Tailwind config, dev proxy target.
- `packages/*/tsconfig.json`: per-package TS project refs (`tsc -b` at root builds all).
- Env vars consumed at runtime (not files): `NETWORK`, `ESPLORA_HOST`, `LIVE`, `ALLOW_MAINNET`, `RECOVERY_KEY`, `IPFS`, `IPFS_DIR`, `IPFS_ANNOUNCE`, `HOST`, `PORT`, `MIN_PARTICIPANTS`, `FILLERS`, `COHORT_TTL_MS`, `PHASE_TIMEOUT_MS` — see `packages/service/src/demo-server.ts`.

**Core Logic:**
- `packages/service/src/index.ts`: composition root for the server side.
- `packages/participant/src/index.ts`: composition root for the client side.
- `packages/shared/src/index.ts`, `packages/shared/src/networks.ts`: shared domain logic both sides depend on.

**Testing:**
- Unit tests: co-located `*.spec.ts` next to the module under test in every `packages/*/src/`.
- Integration/e2e: `e2e/*.ts` (own TS project, run via `tsx`, not vitest).
- CI: `.github/workflows/ci.yml` (hermetic gate + a separate regtest-live job).

## Naming Conventions

**Files:**
- Source module: `kebab-case.ts` or `camelCase.ts` matching its primary export's concern (e.g. `hono-adapter.ts`, `demo-server.ts`, `beacon-address.ts`).
- Unit test: same basename + `.spec.ts`, co-located in the same directory as the module (never a separate `__tests__/` tree).
- React component: `PascalCase.tsx`, one component per file, grouped by tab under `components/{participant,dashboard}/`.
- Zustand store: `camelCase.ts` under `stores/`, named after the concern it owns (`participant.ts`, `dashboard.ts`).

**Directories:**
- Workspace packages: `packages/<name>/`, published/consumed as `@btcr2-aggregation/<name>`.
- Package internals: always `src/` for source, `dist/` for build output (generated, gitignored).
- Web feature grouping: `components/<tab-name>/` (not by component type), `stores/` (state), `lib/` (browser-only stateless helpers), `ui/` (generic presentational primitives).

## Where to Add New Code

**New protocol/coordinator behavior (server-side):**
- Primary code: new module in `packages/service/src/`, wired into `createHonoApp` (`hono-adapter.ts`) if it adds routes, or into `createService` (`index.ts`) if it's a runner-event side effect.
- Tests: co-located `<module>.spec.ts` in the same directory.
- If it touches real money (broadcast, mainnet), gate it behind an explicit opt-in flag/env var following the `live`/`allowMainnet`/`IPFS` pattern already established.

**New participant/client behavior (isomorphic):**
- Primary code: extend `packages/participant/src/index.ts` (or split into a new co-located module if it grows) — must remain Node/browser isomorphic (no Node-only APIs; bind `fetch` if needed, per the existing `globalThis.fetch.bind(globalThis)` pattern).
- Tests: co-located `.spec.ts`, plus a headless e2e case in `e2e/` if it changes cross-process behavior.

**New shared domain logic (identity, config, network):**
- Primary code: `packages/shared/src/index.ts` or a new focused module under `packages/shared/src/` (mirror the existing `networks.ts`/`ipfs.ts` split).
- Tests: co-located `.spec.ts`.
- Consumed by all three of `service`, `participant`, `web` — keep it dependency-light and framework-free.

**New web UI (Participant tab):**
- Component: `packages/web/src/components/participant/<Name>Panel.tsx` or `<Name>Card.tsx`, following the existing `*Panel.tsx`/`ResultCard.tsx` naming.
- State: extend `packages/web/src/stores/participant.ts` (the existing flow state machine) rather than introducing a new store, unless the concern is genuinely orthogonal.
- Browser-only helpers (no React): `packages/web/src/lib/`.

**New web UI (Coordinator/dashboard tab):**
- Component: `packages/web/src/components/dashboard/<Name>Card.tsx`.
- State: extend `packages/web/src/stores/dashboard.ts`.
- Remember: this tab must stay strictly read-only telemetry (SSE consumption) — do not add mutating routes/actions here without first adding real authentication, since the entire web bundle ships with no auth/role separation today.

**New e2e scenario:**
- New file `e2e/<scenario>-cohort.ts` (or extend an existing one with a CLI flag, following `headless-cohort.ts`'s `--smt`/`--x1`/`--mixed` pattern).
- Add a corresponding `e2e:<scenario>` script to the root `package.json` and to `.github/workflows/ci.yml`'s hermetic job if it should gate every change.

## Special Directories

**`packages/*/dist/`:**
- Purpose: TypeScript build output per package.
- Generated: Yes (via `tsc -b` / `pnpm -r build`).
- Committed: No.

**`e2e/dist/`:**
- Purpose: build output for the e2e TS project.
- Generated: Yes.
- Committed: No.

**`.planning/`:**
- Purpose: GSD workflow planning artifacts (roadmap, phase plans, this codebase analysis).
- Generated: Partially (some hand-authored, some tool-generated like this document).
- Committed: Yes (per project convention).

**`docs/adr/`:**
- Purpose: Architectural decision records; the authoritative history of WHY the topology/onboarding/network/deploy design looks the way it does.
- Generated: No (hand-authored).
- Committed: Yes.

---

*Structure analysis: 2026-07-07*
