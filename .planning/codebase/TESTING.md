# Testing Patterns

**Analysis Date:** 2026-07-07

## Test Framework

**Runner:**
- Vitest 2 (`vitest` devDependency, repo root `package.json`)
- No dedicated `vitest.config.*` found; runs via workspace-aware default config against `.spec.ts` files co-located in each package's `src/` and in `e2e/`

**Assertion Library:**
- Vitest's built-in `expect` (Jest-compatible API): `describe`, `expect`, `it` imported from `'vitest'`

**Run Commands:**
```bash
pnpm test               # tsc -b && vitest run — typecheck gates every unit-test run
pnpm typecheck           # tsc -b only
pnpm lint                # eslint .
```

Full `pnpm` script surface relevant to testing, from the root `package.json`:

| Script | Purpose |
|---|---|
| `test` | `tsc -b && vitest run` — all `*.spec.ts` unit tests across the workspace |
| `e2e` | `tsx e2e/headless-cohort.ts` — real-HTTP headless CAS cohort |
| `e2e:smt` | Same harness, `--smt` flag (SMT beacon type) |
| `e2e:x1` | Same harness, `--x1` (EXTERNAL x1 onboarding cohort) |
| `e2e:mixed` | Same harness, `--mixed` (mixed KEY + EXTERNAL cohort) |
| `e2e:x1:negative` | Same harness, `--negative` (x1 negative/attacker probe) |
| `e2e:persist` | `tsx e2e/persist-cohort.ts` — cohort persistence/sidecar-export round-trip |
| `e2e:resolve` | `tsx e2e/resolve-cohort.ts` — server-driven `resolveBtcr2` + `GET /resolve/:did` round-trip |
| `e2e:config` | `tsx e2e/config.ts` — `GET /v1/config` runtime network injection paths, incl. mainnet-guard + IPFS env combinations |
| `e2e:ipfs` | `tsx e2e/ipfs-cohort.ts` — opt-in in-browser Helia publish + coordinator pinning |
| `e2e:baked` | `tsx e2e/baked-cohort.ts` — EXTERNAL-baked-genesis onboarding |
| `e2e:live:mock` | `tsx e2e/live-mock-cohort.ts` — live-shaped tx construction without real broadcast |
| `e2e:live:broadcast` | `tsx e2e/live-broadcast-cohort.ts` — real broadcast leg (manual/opt-in) |
| `e2e:live:regtest` | `LIVE=1 LIVE_NETWORK=regtest tsx e2e/resolve-cohort.ts` — full real-chain resolve round-trip on a throwaway regtest node |
| `e2e:browser` | `pnpm -r build && tsx e2e/browser-cohort.ts` — Playwright-core-driven browser cohort (dev topology) |
| `e2e:browser:prod` | `pnpm -r build && tsx e2e/browser-prod-cohort.ts` — same, against the prod static-served build; includes mainnet-rails + IPFS bitswap-pin scenarios and an automated bundle-cleanliness check |

## Test File Organization

**Location:**
- Unit tests: co-located `*.spec.ts` next to the implementation file inside each package's `src/`, e.g. `packages/service/src/resolve.spec.ts` beside `packages/service/src/resolve.ts`
- Observed unit spec files:
  - `packages/shared/src/{networks,registration,baked-identity,external-identity,cohort-config,ipfs}.spec.ts`
  - `packages/service/src/{store,beacon-address,genesis-capture,resolve,ipfs,config,offline-chain,persist,broadcast,live-tx,roster}.spec.ts`
  - `packages/web/src/stores/participant.spec.ts`
- E2E harness wrappers: `e2e/headless-cohort.spec.ts`, `e2e/x1-cohort.spec.ts` (vitest `describe/it` wrappers around the tsx-runnable harness functions, allowing them to also run under `pnpm test`)
- E2E harness implementations (plain `tsx`-executable scripts, not vitest specs): `e2e/{headless-cohort,browser-cohort,browser-prod-cohort,config,ipfs-cohort,baked-cohort,live-broadcast-cohort,live-mock-cohort,persist-cohort,resolve-cohort}.ts`
- Shared e2e infrastructure: `e2e/lib/browser-harness.ts`, `e2e/lib/regtest.ts`

**Naming:**
- `<subject>.spec.ts` for vitest tests
- `<scenario>-cohort.ts` for e2e cohort-driving scripts

## Test Structure

**Suite Organization (unit, hermetic):**
```typescript
// packages/service/src/hono-adapter.spec.ts style
import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { describe, expect, it } from 'vitest';
import { createHonoApp } from './hono-adapter.js';

function bareApp(networkName?: string) {
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  return createHonoApp(transport, networkName ? { networkName: networkName as never } : {});
}

describe('GET /v1/config route', () => {
  it('serves the default network (mutinynet) with no network threaded in', async () => {
    const res = await bareApp().request('/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { network: string; label: string; isMainnet: boolean };
    expect(body).toEqual({ network: 'mutinynet', label: 'Mutinynet (signet)', isMainnet: false });
  });
});
```
- In-memory HTTP testing via Hono's `.request()` (no port bound, no real network) for hermetic route-level unit tests
- Explanatory comments precede each `describe` block stating what real-world path the hermetic test stands in for

**Suite Organization (e2e, real service over real HTTP):**
```typescript
// e2e/headless-cohort.spec.ts
describe('headless real-HTTP aggregation cohort', () => {
  it('drives a full CAS cohort to a 64-byte aggregated Taproot signature', async () => {
    const result = await runHeadlessCohort({ quiet: true });
    expect(result.beaconType).toBe('CASBeacon');
    expect(result.signatureLength).toBe(64);
    expect(result.hasSignedTx).toBe(true);
    expect(result.serviceMilestones).toEqual(EXPECTED_SERVICE_MILESTONES);
  }, 60000);
});
```
- Extended timeouts (`60000` ms) passed as third arg to `it(...)` since these spin up a real service and drive real HTTP traffic
- Milestone-array equality checks (`toEqual` on ordered milestone name lists) are the primary way these tests assert protocol progression, not just final state

**Patterns:**
- Setup: harness functions (`runHeadlessCohort`, etc.) encapsulate full service+participant bring-up so tests stay declarative
- Teardown: harnesses handle their own service/process shutdown internally (not visible as explicit `afterEach` in the spec files)
- Assertion: prefer exact structural equality (`toEqual`) over loose `toBeTruthy` checks, especially for ordered milestone/state-machine sequences

## Mocking

**Framework:** Vitest's built-in `vi` (no `vi.mock`/`vi.fn`/`vi.spyOn` usage found in the surveyed `.spec.ts` files at time of analysis)

**What's used instead of mocking:**
- Structural "Like" interfaces (e.g. `ResolverLike` in `packages/service/src/resolve.ts`) let tests inject a scripted fake implementation without a mocking framework, by design ("lets the loop be unit-tested with a scripted fake resolver")
- Hermetic route tests build a real (but store/bitcoin/runner-less) app via `createHonoApp(...)` and hit it in-memory with `.request()`, rather than mocking Hono internals
- Chain access is avoided entirely in the hermetic gate: real-chain behavior is opt-in via `LIVE=1`, not mocked out per-test

**What NOT to mock:**
- Do not mock `@did-btcr2/*` library internals; prefer real instances driven with test-scoped hermetic transports (`heartbeatIntervalMs: 0`, no store/bitcoin passed) or structural fakes at defined seams (`ResolverLike`)

## Fixtures and Factories

**Test Data:**
- No separate fixtures directory; hermetic tests construct minimal inline objects/options (e.g. `bareApp(networkName?)` helper function local to the spec file)
- Regtest e2e harness (`e2e/lib/regtest.ts`, 298 lines) provisions a throwaway `bitcoind` + esplora-fork `electrs` node per run, auto-mining blocks, functioning as the "live-chain fixture"

**Location:**
- Shared e2e fixtures/harness helpers live in `e2e/lib/` (`browser-harness.ts`, `regtest.ts`)

## Coverage

**Requirements:** No coverage tool/threshold configured (no `c8`/`istanbul` config or coverage script detected). Coverage is enforced behaviorally via the CI gate's breadth (16 checks) rather than a numeric coverage threshold.

**View Coverage:**
- Not applicable — no coverage command exists in `package.json`.

## Test Types

**Unit Tests:**
- Scope: pure logic and hermetic route-level tests inside individual packages (`packages/{shared,service,participant,web}/src/*.spec.ts`)
- Approach: real instances of internal code with either no chain access or structural fakes at defined interface seams; run under `vitest run`, gated by `tsc -b` first

**Integration/E2E Tests:**
- Scope: real service process + real HTTP transport + (optionally) real chain, driven from `e2e/*.ts` via `tsx`
- Approach: each `e2e/<scenario>-cohort.ts` (or `.ts` script) boots the actual service (`@did-btcr2/aggregation` `HttpServerTransport`/`HttpClientTransport`), drives a full cohort protocol run, and asserts on milestone sequences and final artifacts
- Coverage of scenarios: headless CAS/SMT, x1 EXTERNAL onboarding, mixed cohorts, x1 negative probes, persistence/sidecar-export, resolve round-trip, runtime `/v1/config`, IPFS publish/pin, baked-genesis onboarding, live-shaped tx construction (mock), real broadcast, and full regtest live resolve

**Browser E2E:**
- Framework: `playwright-core` (launched programmatically from `e2e/browser-cohort.ts` / `e2e/browser-prod-cohort.ts` via `e2e/lib/browser-harness.ts`), full Chromium headless with `--no-sandbox`, not the `@playwright/test` runner
- `e2e:browser` exercises the dev (Vite proxy) same-origin topology; `e2e:browser:prod` exercises the production static-served build and additionally checks mainnet-guard-rail UI paths, IPFS bitswap-pin UX, and bundle cleanliness (no leaked dev-only code in the prod bundle)

**Live-Chain (opt-in) Tests:**
- Gated entirely behind the `LIVE=1` environment variable; the hermetic default (`pnpm test`, `pnpm e2e*` without `LIVE`) never touches a real chain
- `e2e:live:mock` builds live-shaped transactions without broadcasting
- `e2e:live:broadcast` performs a real broadcast (manual/opt-in leg, not in the standard CI hermetic gate)
- `e2e:live:regtest` (`LIVE=1 LIVE_NETWORK=regtest tsx e2e/resolve-cohort.ts`) is the fully automated live-path gate: spins up a throwaway `bitcoind` + esplora-fork `electrs` regtest node (`e2e/lib/regtest.ts`), auto-mines blocks, and runs real beacon-tx broadcast + real `GET /resolve/:did` resolution for both beacon types (CAS/SMT) and both onboarding models (KEY/BAKED)

## CI Pipeline

**Workflow:** `.github/workflows/ci.yml` — two separate jobs by design (documented in the file header):

1. **`hermetic` job** (45 min timeout): must see zero chain-related env vars. Runs, in order:
   `pnpm install --frozen-lockfile --trust-lockfile` -> Playwright Chromium cache/install -> `pnpm typecheck` -> `pnpm lint` -> `pnpm test` -> `pnpm e2e` -> `e2e:smt` -> `e2e:x1` -> `e2e:mixed` -> `e2e:x1:negative` -> `e2e:persist` -> `e2e:resolve` -> `e2e:config` -> `e2e:ipfs` -> `e2e:baked` -> `e2e:live:mock` -> `e2e:browser` -> `e2e:browser:prod`
   (16 checks total: typecheck, lint, test, and 13 e2e legs)
2. **`regtest-live` job** (30 min timeout): provisions pinned `bitcoind` (v29.3, SHA256-verified) + esplora-fork `electrs` (SHA256-verified), then runs `LIVE=1 LIVE_NETWORK=regtest pnpm e2e:resolve` as the single live-path gate step.

**Supply-chain posture:** all GitHub Actions pinned by full commit SHA (version comment is documentation only, SHA is the enforced truth); pnpm's `minimumReleaseAge` re-verification is bypassed via `--trust-lockfile` and `pnpm_config_verify_deps_before_run: "false"` (the reviewed lockfile is treated as the trust boundary).

**Concurrency:** one run per ref; stacked PR pushes cancel the superseded run, but pushes to `main` never cancel an in-flight merge verification.

## Known Coverage Gaps

- **No test coverage exists for any auth/operator-admin surface.** No such surface exists yet in the codebase (no admin API, no operator authentication/authorization layer has been built), so this is an absence of both feature and tests rather than an untested existing feature. Any future admin/auth surface should get e2e coverage analogous to the existing `e2e:config`/`e2e:resolve` legs plus hermetic route-level unit specs following the `hono-adapter.spec.ts` in-memory `.request()` pattern.
- No numeric coverage threshold is enforced; gaps are caught only by the breadth of the 16-check hermetic gate plus the regtest live-path gate, not by a coverage report.

## Common Patterns

**Async Testing:**
```typescript
it('drives a full CAS cohort to a 64-byte aggregated Taproot signature', async () => {
  const result = await runHeadlessCohort({ quiet: true });
  expect(result.hasSignedTx).toBe(true);
}, 60000);
```

**Milestone/state-machine assertion pattern:**
```typescript
expect(result.serviceMilestones).toEqual(EXPECTED_SERVICE_MILESTONES);
for (const participant of result.participants) {
  expect(participant.milestones).toEqual(EXPECTED_PARTICIPANT_MILESTONES);
}
```

---

*Testing analysis: 2026-07-07*
