# Phase 1: Authenticated Operator Console + On-Demand Cohort Creation - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 14 (6 service, 5 web, 1 e2e, plus 3 service spec files)
**Analogs found:** 14 / 14 (all files have a strong in-repo analog; 0 files need RESEARCH.md fallback)

This phase is a course-correction on a working end-to-end app, so every new file has a close sibling already in the tree. The controlling conventions (verified in read source, matching CONVENTIONS.md) that EVERY new file must follow:

- **`.js` import extensions** on all relative imports (`./operator-auth.js`) - NodeNext requirement, seen everywhere (`index.ts:19`, `hono-adapter.ts:21-27`).
- **`import type`** / inline `type` in named imports (`hono-adapter.ts:1,6-9`; `index.ts:1,7-8`).
- **`throw new Error('module: ...')`** guard-clause style, module-prefixed (`index.ts:299,417`; `buildCohortConfig` in `shared/src/index.ts`).
- **Module-prefixed `console.*`** logging: `[adapter]` (`hono-adapter.ts:34`), `[service]` (`index.ts:346,374`), `[demo]` (`demo-server.ts:129`), `[tx]`/`[resolve]` (`hono-adapter.ts:272,329`). New code adds `[operator]`.
- **Per-`createService` closure state**, never module singletons (`index.ts:260` `genesisStaging`, `index.ts:265` `seatedRosterKeys`) - sessions + drafts follow this exact shape.
- **`.spec.ts` co-located** with source (`packages/service/src/*.spec.ts`).
- **Named exports**, dense TSDoc with `{@link}` + ADR cross-refs (whole file `index.ts`).
- **Dashboard/telemetry SSE gating**: `/dashboard/events` is mounted inside `if (runner) {...}` at `hono-adapter.ts:235-242`; it becomes gated + conditional on the operator password being set.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/service/src/operator-auth.ts` (NEW) | middleware/service | request-response | `packages/service/src/index.ts` (closure state) + `hono-adapter.ts` (guards/logging) | role-match |
| `packages/service/src/operator-cohorts.ts` (NEW) | service | CRUD + event-driven | `packages/service/src/index.ts` (side-effect wiring) + `shared/src/index.ts` (`buildCohortConfig`) | role-match |
| `packages/service/src/hono-adapter.ts` (MODIFIED) | route/adapter | request-response + SSE | itself (existing route-mount + `if (runner)` SSE-gating patterns) | exact (self) |
| `packages/service/src/demo-server.ts` (MODIFIED) | config/entry-point | boot / lifecycle | itself (ADR 0010 loud-boot block `:164-186`; loop `:238-275`) | exact (self) |
| `packages/service/src/index.ts` (MODIFIED) | service/factory | wiring | itself (`CreateServiceOptions` + closure state) | exact (self) |
| `packages/service/src/operator-auth.spec.ts` (NEW) | test | request-response | `packages/service/src/config.spec.ts` (in-memory `app.request()`) | exact |
| `packages/service/src/operator-boot.spec.ts` (NEW) | test | boot | `packages/service/src/config.spec.ts` | role-match |
| `packages/service/src/operator-cohorts.spec.ts` (NEW) | test | CRUD | `packages/service/src/config.spec.ts` + `persist.spec.ts` | role-match |
| `packages/web/src/App.tsx` (MODIFIED) | component (shell) | request-response | itself (two-tab shell + `loadConfig`) | exact (self) |
| `packages/web/src/stores/operator.ts` (NEW) | store | request-response + SSE | `stores/participant.ts` (state machine) + `stores/dashboard.ts` (SSE/EventSource) | exact |
| `packages/web/src/components/operator/*.tsx` (NEW) | component | request-response | `components/participant/*.tsx`, `components/dashboard/*` | exact |
| `packages/web/src/ui/primitives.tsx` (MODIFIED: add Input/Select/Field) | component | n/a | itself (Button/Card/Badge conventions) | exact (self) |
| `packages/web/src/lib/operator.ts` (NEW, fetch helper) | utility | request-response | `packages/web/src/lib/config.ts` (`fetchNetworkConfig`) | exact |
| `e2e/operator-cohort.ts` (NEW) | test (e2e harness) | request-response + lifecycle | `e2e/headless-cohort.ts` (real-service tsx idiom) | exact |

No `## No Analog Found` section: every file maps cleanly. See "Watch items" at the end for the two spots RESEARCH flags for confirmation at plan time (open-phase cut-point; Secure-cookie-in-dev), neither of which is a missing analog.

---

## Pattern Assignments

### `packages/service/src/operator-auth.ts` (NEW - middleware/service, request-response)

**Analogs:** `packages/service/src/index.ts` (per-`createService` closure state), `packages/service/src/hono-adapter.ts` (guard + generic-error + module-prefixed logging + `bodyLimit`).

**Closure-state pattern to copy** (`index.ts:260-265`) - the session store is a closure, not a module singleton, exactly like `genesisStaging`/`seatedRosterKeys`:
```typescript
// index.ts:262-265
// Roster keys already seated per cohort ... Keyed by cohort id
const seatedRosterKeys = new Map<string, Set<string>>();
```
Apply: `const sessions = new Map<string, { expiresAt: number }>();` created inside the factory that owns it, returned via a small `SessionStore` interface (`create()/isValid()/destroy()`), so two services in one test process never share sessions.

**Generic-error + server-side-log pattern to copy** (`hono-adapter.ts:270-273`) - the 401 body is generic, the real reason is logged with a module prefix, and the password/session id is NEVER logged:
```typescript
// hono-adapter.ts:270-273
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[resolve] ${did} failed: ${message}`);
  return { status: 502, body: { error: 'resolution failed' } };
}
```
Apply: `return c.json({ error: 'operator authentication required' }, 401);` with a `[operator]` prefix on any server-side log; never interpolate the supplied password or cookie value.

**Crypto primitives** (RESEARCH Pattern 1) - `node:crypto` stdlib, no new dep: `createHash('sha256')` both sides -> `timingSafeEqual` (never on raw unequal-length buffers); `randomBytes(32).toString('hex')` for session ids.

**Guard-clause `throw new Error('operator: ...')` style** for input validation, matching `shared/src/index.ts` `buildCohortConfig` (`throw new Error('recoveryKey must be 64 hex chars ...')`).

**Body-limit on the login POST** (`hono-adapter.ts:211`): mirror `bodyLimit({ maxSize: ..., onError: (c) => c.json({ error: 'request too large' }, 413) })` before `c.req.json()`.

---

### `packages/service/src/operator-cohorts.ts` (NEW - service, CRUD + event-driven)

**Analogs:** `packages/service/src/index.ts` (side-effect wiring + closure state), `packages/shared/src/index.ts` (`buildCohortConfig`).

**Two closure Maps** (mirror `index.ts:260/265`): `drafts: Map<draftId, CohortConfig>` and `advertised: Map<cohortId, CohortConfig>` (enrichment only).

**Cohort-config construction** - reuse `buildCohortConfig(threshold, beaconType, activeNetwork, recoveryKey)` (signature verified below) then set the capacity ceiling. Do NOT hardcode network; take the service active network (D-10):
```typescript
// shared/src/index.ts buildCohortConfig(participants, beaconType='CASBeacon', network=NETWORK, recoveryKey?)
// -> { beaconType, minParticipants: participants, network, recoveryKey, recoverySequence: 144 }
const cfg = buildCohortConfig(form.threshold, form.beaconType, activeNetwork.name, recoveryKey);
cfg.maxParticipants = form.capacity; // capacity ceiling (D-11/D-19)
```

**Advertise = the ONLY caller of `advertiseCohort`** (replaces the deleted loop; the loop's call site is the pattern to lift, `demo-server.ts:245-247`):
```typescript
// demo-server.ts:245-247 (the call to relocate into the operator advertise handler)
const { cohortId, completion } = service.runner.advertiseCohort(
  buildCohortConfig(minParticipants, 'CASBeacon', net.name, recoveryKey),
);
```
Apply: on advertise, `advertised.set(cohortId, cfg); drafts.delete(draftId);` and prune on settle: `void completion.finally(() => advertised.delete(cohortId));` (RESEARCH Pattern 3). Note the `.catch()`/fire-and-forget discipline from `index.ts:372-376` for any listener side effects.

**Directory/status derive from `runner.session.cohorts`** filtered by `getCohortPhase`, enriched from the `advertised` Map (D-15; RESEARCH Pattern 4). The single-source-of-truth rule mirrors how the dashboard bridge reads live runner state, not a parallel list.

---

### `packages/service/src/hono-adapter.ts` (MODIFIED - route/adapter, request-response + SSE)

**Analog: itself.** New routes follow the existing conditional-mount idiom and land BEFORE the static-site catch-all (`:368`).

**Conditional feature-mount pattern to copy** (`hono-adapter.ts:206-233`, the `if (ipfs) {...}` block) - operator routes mount only when the password is configured (fail-closed, D-07); thread a new `operatorPassword?`/`operatorAuth?` field onto `HonoAppOptions` (mirror how `ipfs?`/`bitcoin?`/`runner?` are optional opts at `:104-143`):
```typescript
// hono-adapter.ts:235-242 - the /dashboard/events mount to make GATED + conditional
if (runner) {
  app.get('/dashboard/events', (c) => {
    dbg('SSE open GET /dashboard/events');
    const stream = openRawSse(c);
    bridgeRunnerToSse(runner, stream, { broadcaster, network });
    return RESPONSE_ALREADY_SENT;
  });
}
```
Apply: wrap in `if (runner && operatorAuth)` and register `app.use('/dashboard/*', requireOperator)` + `app.use('/v1/operator/*', requireOperator)` BEFORE these routes (Hono matches in registration order - middleware-before-routes is mandatory, RESEARCH Pitfall 3). `EventSource` sends the httpOnly cookie automatically, so no SSE-transport change is needed.

**Unauthenticated public routes** (`/v1/directory`, `/v1/status`) follow the always-mounted `GET /v1/config` idiom (`:194`) and the input-guard-before-work idiom (`:264` DID regex, `:322` address regex).

**Body-limit + JSON-parse-guard** for `POST /v1/operator/login` and the mutating cohort routes: copy `hono-adapter.ts:207-232` verbatim in shape (bodyLimit -> `try { body = await c.req.json() } catch { 400 }` -> validate -> handle).

---

### `packages/service/src/demo-server.ts` (MODIFIED - config/entry-point, boot/lifecycle)

**Analog: itself.**

**Delete** `let running = true;` (`:238`), the entire `loop()` function (`:240-273`), and `void loop();` (`:275`). Keep `createService(...)`, `service.start(...)`, and the SIGINT/SIGTERM graceful-shutdown block (`:305-322`). Fillers (`:250-260`) leave the boot path -> dev/test-only, default-off (D-18).

**Fail-closed loud-boot read to copy** - mirror the ADR 0010 mainnet banner (`demo-server.ts:164-186`), same `opts.x ?? process.env.X` ordering and `log('!!! ... !!!')` shape:
```typescript
// demo-server.ts:164-186 (the exact loud-boot pattern to mirror for OPERATOR_PASSWORD)
const allowMainnet = opts.allowMainnet ?? process.env.ALLOW_MAINNET === '1';
if (net.isMainnet && !allowMainnet) {
  throw new Error(`Refusing to start the coordinator on ${net.label} ...`);
}
...
if (net.isMainnet) {
  log(`!!! ${net.label.toUpperCase()}: REAL FUNDS !!!`);
  log('  - every address/DID the browser mints is a real mainnet object; ...');
}
```
Apply (RESEARCH "Fail-closed boot read"): `const operatorPassword = opts.operatorPassword ?? process.env.OPERATOR_PASSWORD;` and when absent, `log('!!! OPERATOR CONSOLE DISABLED !!!')` + the follow-up lines, then thread `operatorPassword` (possibly undefined) into `createService`. Unlike mainnet this does NOT throw - the public participant surface still serves (D-07). Add env docs to `docker-compose.yml` + `docs/DEPLOY.md`; never bake into the image; never log the value.

---

### `packages/service/src/index.ts` (MODIFIED - service/factory, wiring)

**Analog: itself.** Add `operatorPassword?`, `operatorSessionTtlMs?`, `operatorCookieSecure?` to `CreateServiceOptions` (mirror the optional-opt + dense-TSDoc style of `rosterPks?` at `:202-213`). Construct the session store closure here (next to `genesisStaging`/`seatedRosterKeys`, `:260/265`) and construct the operator-cohorts drafts closure; thread the auth guard + operator flag into `createHonoApp(...)` (the existing options object at `:430-447`). Surface any accessor the routes need on the returned `Service` object (mirror `readonly runner` / `readonly broadcaster` at `:222-231`).

---

### `packages/service/src/operator-auth.spec.ts` / `operator-boot.spec.ts` / `operator-cohorts.spec.ts` (NEW - test)

**Analog:** `packages/service/src/config.spec.ts` - the in-memory `createHonoApp(...).request(path)` idiom (no port, no chain), `describe/it/expect` from vitest, a small `bareApp()`-style builder helper:
```typescript
// config.spec.ts:11-22
function bareApp(networkName?: string) {
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  return createHonoApp(transport, networkName ? { networkName: networkName as never } : {});
}
describe('GET /v1/config route', () => {
  it('serves the default network ...', async () => {
    const res = await bareApp().request('/v1/config');
    expect(res.status).toBe(200);
```
Apply: build an app with an operator password set, POST `/v1/operator/login`, capture `Set-Cookie`, echo it back as the `cookie` header on gated `.request()` calls. **Mandatory negative tests** (CONCERNS.md): wrong password -> 401 + no `Set-Cookie`; no/invalid/expired cookie -> 401 on every gated route incl. `/dashboard/events`; logout -> subsequent request 401; assert the password is never in any logged output. `operator-boot.spec.ts` asserts fail-closed: no password -> operator + `/dashboard/events` routes not mounted (404/disabled) while `/v1/config` + public surface still 200.

---

### `packages/web/src/App.tsx` (MODIFIED - component shell)

**Analog: itself.** Today it is a `useState<Tab>` toggle (`:21`) + `loadConfig` effect (`:28-33`). Replace the tab toggle with a `window.location.pathname` switch (`/operator` -> `OperatorConsole`, else participant + public status) using `history.pushState` (no router dep - RESEARCH "Don't Hand-Roll"; optional `lib/router.ts`). Keep the `loadConfig(baseUrl)` effect and the network badge (`:48-56`) verbatim; the accent/`isMainnet` REAL-FUNDS badge is reused per UI-SPEC. The client route is presentation only - the real boundary is server middleware (D-04).

---

### `packages/web/src/stores/operator.ts` (NEW - store)

**Analogs:** `stores/participant.ts` (Zustand state-machine: `ParticipantStatus` union, `create<...>((set,get)=>...)`, log entries via `elapsed()`) and `stores/dashboard.ts` (EventSource lifecycle for the gated `/dashboard/events` feed).

**State-machine union pattern** to copy (`participant.ts` `ParticipantStatus`/`RegistrationStatus` at head): define `OperatorAuthStatus = 'checking' | 'logged-out' | 'logging-in' | 'logged-in' | 'disabled'` and a draft/advertise status union.

**EventSource pattern** (`dashboard.ts:279-343` `openSource`, incl. CLOSED-detect + manual reconnect + resync) for the gated telemetry feed - unchanged except it now requires a live session (the cookie rides automatically). Login state is determined by a `GET /v1/operator/session` probe (200/401), never by reading the httpOnly cookie (RESEARCH anti-pattern).

---

### `packages/web/src/components/operator/*.tsx` (NEW - components)

**Analogs:** `components/participant/*.tsx` (`RegisterPanel.tsx` for the login/create-form `Card` + `p-5` layout; `FlowStepper.tsx`, `ResultCard.tsx`) and `components/dashboard/*`. Build ONLY from `ui/primitives.tsx` (`Card`/`Button`/`Badge`/`StatusDot`/`SectionTitle`/`Mono`/`CopyField`) plus the three new `Input`/`Select`/`Field`. Copy strings from the UI-SPEC Copywriting Contract exactly. Draft badge = `neutral` tone, Advertised = `accent` tone; primary button reserved for `Sign in`/`Advertise cohort`, `danger` for `Discard draft`.

---

### `packages/web/src/ui/primitives.tsx` (MODIFIED - add Input/Select/Field)

**Analog: itself.** Match the existing primitive conventions exactly (`Button` at `:51-78`): typed props object, `variant`/`className` passthrough, Tailwind token classes (`bg-surface`/`border-edge`/`text-ink`, never hex), named export, one-line TSDoc. Only these three additions are permitted (UI-SPEC). Note: existing `Badge`/`Button` use `font-medium` (500) and `font-semibold` (600); UI-SPEC forbids introducing NEW 500 weight in new code - use 600 for emphasis in the new primitives.

---

### `packages/web/src/lib/operator.ts` (NEW - fetch helper)

**Analog:** `packages/web/src/lib/config.ts` `fetchNetworkConfig` - same-origin `fetch` of a JSON DTO, `baseUrl.replace(/\/$/, '')`, `AbortSignal.timeout(...)`, `if (!res.ok) throw new Error('...')`, typed DTO return, no new dependency. Apply for `login`/`logout`/`sessionProbe`/`createDraft`/`advertise`/`discard`/`listCohorts` calls; include `credentials: 'same-origin'` so the session cookie rides (default for same-origin, but be explicit).

---

### `e2e/operator-cohort.ts` (NEW - e2e harness)

**Analog:** `e2e/headless-cohort.ts` - the real-service tsx idiom: `createService` on a real ephemeral port, N `createParticipant` peers, milestone arrays, `withTimeout`, an `invokedDirectly` `main()` returning an exit code, `E2E PASSED/FAILED` console output. Add a login step and manual cookie echo (Node fetch has no cookie jar - RESEARCH e2e example): POST `/v1/operator/login`, `const cookie = setCookie?.split(';')[0]`, reuse as the `cookie` header on gated calls. Assert `session.cohorts.length === 0` at boot (loop removed), then create -> advertise -> spawn peers -> co-sign -> resolve. Include the mandatory negative auth assertions (wrong password 401; no-cookie 401 on `/v1/operator/cohorts` and `/dashboard/events`). Register a `pnpm e2e:operator` script (`tsc -b && tsx e2e/operator-cohort.ts`).

---

## Shared Patterns

### Authentication (session guard)
**Source:** NEW `operator-auth.ts`, composing `hono/factory` `createMiddleware` + `hono/cookie` + `node:crypto` (RESEARCH Patterns 1-2).
**Apply to:** the `/v1/operator/*` and `/dashboard/*` prefixes in `hono-adapter.ts` (mount BEFORE routes); every operator component/store (via 200/401 probe, never cookie read).
```typescript
const requireOperator = (sessions: SessionStore) =>
  createMiddleware(async (c, next) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (!id || !sessions.isValid(id)) return c.json({ error: 'operator authentication required' }, 401);
    await next();
  });
```

### Error handling + logging
**Source:** `hono-adapter.ts:270-273` (generic body to caller, detailed reason logged with module prefix), `index.ts:372-376` (fire-and-forget `.catch()` on side effects).
**Apply to:** all new operator routes and listeners. Add the `[operator]` prefix. NEVER log the password, request body, or session id (RESEARCH V7).

### Input validation
**Source:** `hono-adapter.ts:207-232` (bodyLimit -> json-parse-guard -> validate -> 400/413) and `shared/src/index.ts` `buildCohortConfig` (`throw new Error('...')` guard clauses).
**Apply to:** login POST and every mutating cohort route: `beaconType ∈ {CASBeacon,SMTBeacon}`, `threshold` integer ≥ 1, `capacity ≥ threshold`.

### Config-driven network (hard rule)
**Source:** `demo-server.ts:153-157` (`resolveNetwork(opts.network ?? process.env.NETWORK ?? DEFAULT_NETWORK)`), served to the browser via `GET /v1/config` (`hono-adapter.ts:194`).
**Apply to:** the create form / `operator-cohorts.ts` - use the service active network, never a hardcoded value (D-10). The form displays it read-only (UI-SPEC).

### Per-`createService` closure state (no module singletons)
**Source:** `index.ts:260` (`genesisStaging`), `index.ts:265` (`seatedRosterKeys`).
**Apply to:** the session Map and the drafts/advertised Maps - constructed inside the factory so parallel services in one test process never share state.

### Fail-closed loud boot
**Source:** `demo-server.ts:164-186` (ADR 0010 mainnet banner).
**Apply to:** the `OPERATOR_PASSWORD` boot read (warn + disable, do not throw).

---

## Watch items (from RESEARCH; not missing analogs)

- **Open-phase cut-point (A1):** confirm the exact `ServiceCohortPhaseType` set that counts as "open/joinable" for the directory at plan time; filter conservatively to pre-signing phases.
- **Secure-cookie-in-dev (Pitfall 2):** the hermetic e2e runs http-on-loopback, so it must take the `OPERATOR_COOKIE_SECURE=0` path or login 200 -> next-request 401 loops.
- **Login brute-force throttle (A5):** flagged as a should-have, not a Phase-1 blocker; planner decides.

## Metadata

**Analog search scope:** `packages/service/src`, `packages/web/src` (`App.tsx`, `stores/`, `components/`, `ui/`, `lib/`), `packages/shared/src/index.ts`, `e2e/`.
**Files scanned (read this session):** `hono-adapter.ts`, `demo-server.ts`, `index.ts`, `config.spec.ts`, `App.tsx`, `ui/primitives.tsx`, `stores/dashboard.ts`, `stores/participant.ts` (head), `shared/src/index.ts` (`buildCohortConfig`), `lib/config.ts`, `e2e/headless-cohort.ts`; directory listings for spec/store/component/e2e files.
**Pattern extraction date:** 2026-07-08
