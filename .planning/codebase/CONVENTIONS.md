# Coding Conventions

**Analysis Date:** 2026-07-07

## Naming Patterns

**Files:**
- Lowercase, hyphenated for modules: `beacon-address.ts`, `genesis-capture.ts`, `hono-adapter.ts`, `static-site.ts`
- Test files co-located with `.spec.ts` suffix: `store.spec.ts`, `resolve.spec.ts`, `config.spec.ts` (in `packages/*/src/`)
- React components use PascalCase `.tsx`: `App.tsx`, `CohortCard.tsx`, `DashboardView.tsx`, `PublishPanel.tsx` (see `packages/web/src/components/`)
- ADRs numbered sequentially in `docs/adr/`: `0001-m1-service-framework-and-fixture-tx.md` through `0014-deployment-topology.md`

**Functions:**
- camelCase: `resolveBtcr2`, `driveResolution`, `createHonoApp`, `runHeadlessCohort`

**Variables:**
- camelCase for values, `SCREAMING_SNAKE_CASE` for module-level constants: `DEFAULT_NETWORK`, `EXPECTED_SERVICE_MILESTONES`

**Types:**
- PascalCase interfaces/types, often suffixed `Options`, `Like`, `Config`: `ResolveBtcr2Options`, `ResolverLike`, `NetworkConfig`

## Code Style

**Formatting:**
- No dedicated Prettier config detected; formatting is enforced implicitly through ESLint + TypeScript strictness
- Single quotes, semicolons, trailing content on interface members with inline JSDoc

**Linting:**
- Flat config: `eslint.config.js` (repo root) using `typescript-eslint` recommended rules
```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '**/*.tsbuildinfo'],
  },
  ...tseslint.configs.recommended,
);
```
- Run via `pnpm lint` (`eslint .`) at repo root; part of the CI hermetic gate

**TypeScript:**
- Project-references build: `tsc -b` from repo root (`packages/*/tsconfig.json` each extend `tsconfig.base.json`)
- `tsconfig.base.json` (repo root): `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `composite: true`, ESM throughout
- `pnpm typecheck` = `tsc -b`; `pnpm test` runs `tsc -b && vitest run` (typecheck gates every test run)

## Import Organization

**ESM import style (critical convention):**
- All relative imports MUST use explicit `.js` extensions even though source files are `.ts` (NodeNext module resolution requirement)
  - Example (`packages/service/src/resolve.ts`): `import type { ArtifactKind, ArtifactStore } from './store.js';`
- Type-only imports use `import type` or inline `type` specifiers in named import lists:
```typescript
import {
  BeaconSignalDiscovery,
  DidBtcr2,
  type BeaconService,
  type CASAnnouncement,
  type DataNeed,
  type DidResolutionResponse,
  type ResolverState,
  type Sidecar,
  type SignedBTCR2Update,
  type SMTProof,
} from '@did-btcr2/method';
```

**Order (observed convention):**
1. External published packages (`@did-btcr2/*`, `vitest`, `hono`)
2. Internal cross-package imports (relative, always `.js` suffix)
3. Type-only imports interleaved or grouped with `type` keyword, not force-separated

**Path Aliases:**
- None used at the TS/build level; pnpm workspace `packages/{shared,service,participant,web}` cross-reference each other via published/workspace package names, not path aliases
- Vite config (`packages/web/vite.config.ts`) uses a dev proxy for same-origin topology (ADR 0003) rather than import aliases

## Error Handling

**Patterns:**
- Plain `throw new Error(...)` with a descriptive, prefixed message identifying the function/module, e.g.:
```typescript
// packages/service/src/genesis-capture.ts
throw new Error(`GenesisStagingCache: cap must be a positive integer, got ${cap}`);

// packages/service/src/store.ts
throw new Error(`artifact key must be non-empty lowercase hex, got "${key}"`);

// packages/service/src/index.ts
throw new Error('createService: live=true requires an injected `bitcoin` connection');
```
- No custom Error subclasses observed; errors are distinguished by message content and call site, not by type
- Guard clauses at the top of functions validate inputs and throw immediately rather than deep-nesting

## Comments and Documentation (distinctive convention)

**This codebase carries unusually dense, explanatory JSDoc/comments.** Nearly every exported function, interface, and non-trivial option has multi-sentence JSDoc explaining not just WHAT but WHY, including tradeoffs, alternatives considered, and pointers to ADRs. This is a first-class convention, not incidental:

```typescript
/**
 * The subset of `@did-btcr2/method`'s {@link import('@did-btcr2/method').Resolver}
 * the driver loop touches: the sans-I/O `resolve()` / `provide()` protocol. Declaring
 * it structurally (rather than importing the concrete class) lets the loop be
 * unit-tested with a scripted fake resolver, and keeps {@link driveResolution}
 * independent of the resolver's private internals.
 */
export interface ResolverLike {
  /** Advance the state machine (needs data, or resolved). */
  resolve(): ResolverState;
  /** Provide the data a prior {@link resolve} requested. */
  provide(need: DataNeed, data: unknown): void;
}
```

- Uses `{@link}` TSDoc tags to cross-reference other symbols and even library-internal types
- File-header comments in e2e/CI/config files explain non-obvious "why" decisions at length (see `.github/workflows/ci.yml` header, `e2e/lib/regtest.ts`)
- Inline comments in tests explain the intent of an assertion, not just what it checks (e.g. `// A CAS cohort delivers the announcement map, not an SMT proof.`)
- **When adding new code, match this density**: document non-obvious rationale, edge cases, and links to relevant ADRs (`docs/adr/000N-*.md`) rather than terse one-liners.

## Config-Driven Network Convention (hard rule)

**Never hardcode the Bitcoin network.** The target network (mutinynet/signet/testnet/regtest/mainnet) is always threaded through as configuration, never assumed:
- Server-side: resolved from `opts.network ?? process.env.NETWORK ?? DEFAULT_NETWORK` (`packages/service/src/demo-server.ts:154`)
- Browser-side: fetched at runtime from `GET /v1/config` (ADR: runtime network injection, see MEMORY `project-m3f-netconfig`) rather than baked into the client bundle
- Any new feature touching chain interaction must accept/derive the network from config, not import a constant network value

## Environment-Variable-Driven Boot Config

The service (`packages/service/src/demo-server.ts`) reads boot configuration exclusively from `process.env`, with `opts.X ?? process.env.X` fallback ordering (explicit option always wins over env):

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

New boot-time behavior should follow this same `opts.x ?? process.env.X ?? DEFAULT` pattern for testability (opts always overridable in tests/CLI).

## House Style Rules (repo-wide, non-negotiable)

Documented in `docs/PROJECT-CONTEXT.md:148` and `docs/SCAFFOLD-PLAN.md:238`, and enforced by the user's global instructions:

1. **No em-dash character (`—`)** anywhere: prose, code comments, docs, or commit messages. Use commas, colons, parentheses, periods, `->`, or a spaced hyphen instead.
2. **No Claude `Co-Authored-By` trailers** (or any AI-attribution footer) in any commit message, ever.

## Function Design

**Size:** Functions tend toward medium length with heavy upfront JSDoc; internal logic favors guard clauses and early returns over deep nesting.

**Parameters:** Options-object pattern for anything with more than 1-2 params, typed via a dedicated `XOptions` interface (e.g. `ResolveBtcr2Options`), each field individually documented.

**Return Values:** Structured result objects favored over tuples/positional returns, especially in e2e harnesses (e.g. `runHeadlessCohort` returns a result object with `beaconType`, `signatureLength`, `serviceMilestones`, `participants`).

## Module Design

**Exports:** Named exports throughout; no default exports observed in library code.

**Barrel Files:** Not used inside packages; imports go directly to the defining file (`./store.js`, `./hono-adapter.js`) rather than through an `index.ts` re-export barrel, aside from each package's top-level `src/index.ts` acting as the public package entry point.

---

*Convention analysis: 2026-07-07*
