# Phase 1: Authenticated Operator Console + On-Demand Cohort Creation - Research

**Researched:** 2026-07-08
**Domain:** Server-enforced app-level auth (Hono cookie sessions) + on-demand cohort lifecycle control on an existing pnpm/TS/Node aggregation service
**Confidence:** HIGH (all library + framework claims verified against installed `node_modules`; codebase claims verified against source read this session)

## Summary

This is a course-correction of a working end-to-end app, not a greenfield build. Every protocol capability already exists; Phase 1 adds a thin, server-enforced operator control surface on top and rewires how cohorts come into existence. The good news from reading the installed library and framework: **everything this phase needs already ships.** `AggregationServiceRunner.advertiseCohort(config)` is explicitly documented as callable many times on one runner (the multi-cohort path) and returns `{ cohortId, completion }` - it is the exact on-demand replacement for the boot-time `while` loop [VERIFIED: node_modules @did-btcr2/aggregation@0.4.0 service-runner.d.ts]. Hono 4.12.27 ships first-class cookie helpers (`getCookie`/`setCookie`/`deleteCookie`) and a `createMiddleware` factory [VERIFIED: node_modules hono@4.12.27]. Node 22.22.2 ships `crypto.timingSafeEqual`, `crypto.randomUUID`, `crypto.randomBytes`, `crypto.createHash` [VERIFIED: node v22.22.2 runtime probe]. **No new npm dependency is required for this phase** - the auth layer is Hono helpers + Node stdlib, and cohort control is the library API already in use.

The single most important architectural fact for the auth design: the operator monitoring feed is an **SSE stream consumed by `EventSource`** (`packages/web/src/stores/dashboard.ts`), and `EventSource` cannot set an `Authorization` header - it only sends same-origin cookies automatically. This makes an **httpOnly session cookie** (already the locked decision D-06) not just a good choice but the *only* choice that gates `/dashboard/events` without rewriting the SSE transport. Cookie auth also means the browser JS can never read auth state directly (httpOnly), so the console must determine "am I logged in?" by probing a gated endpoint, not by reading the cookie.

The second fact: the SPA is served by a trailing `GET *` catch-all that already falls back to `index.html` for any non-asset, non-API path (`packages/service/src/static-site.ts:84-91`), so the `/operator` route (locked in UI-SPEC) needs **zero server change** - it is a purely client-side route, and the real boundary is the server-side session middleware on the `/v1/operator/*` and `/dashboard/*` API routes.

**Primary recommendation:** Add a small per-`createService` in-memory session store + a Hono `createMiddleware` guard mounted on the operator + telemetry route prefixes; add operator routes for create-draft / advertise / discard / list + a public directory + public status; delete the `while (running)` loop in `demo-server.ts` and make `advertiseCohort` operator-driven; prove it with one hermetic tsx e2e (`e2e/operator-cohort.ts`) plus vitest negative auth specs. Introduce no new packages.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Operator login / session validation / logout | API / Backend (`hono-adapter.ts`) | Browser (login form + probe) | HOST-01 D-04: the client tab toggle is never access control; enforcement is server-side in the sole HTTP mount point |
| Session storage | API / Backend (per-`createService` closure) | - | Matches existing `genesisStaging` / `seatedRosterKeys` in-memory-closure model (`index.ts:260,265`); single-process, no persistence (ADR 0014) |
| Cohort draft state (create/discard) | API / Backend (per-`createService` closure) | Browser (form + review) | D-12/D-13: a draft is app-level config not yet handed to the runner |
| Advertise (draft -> live cohort) | API / Backend -> library runner | - | SVC-02: `runner.advertiseCohort(config)` is the one call site, now operator-triggered |
| Directory listing (open cohorts) | API / Backend (derived from `runner.session.cohorts`) | Browser (Phase 2 consumes) | D-14/D-15: one source of truth = the live advertised set, no duplicate list |
| Public status (up / network / open count) | API / Backend | Browser (anonymous status card) | D-09: reads the same directory source |
| Operator console UI (login, create form, cohort list) | Browser (`/operator` route, new Zustand store) | - | D-01: experience split inside one same-origin bundle; presentation only |
| Lifecycle co-sign / anchor / resolve | Library + existing service wiring | - | Unchanged; already works, just triggered by an operator-advertised cohort |

## Standard Stack

**No new dependencies.** Phase 1 uses only what is already installed. The "stack" here is the set of existing APIs to compose.

### Core (already installed - the APIs to use)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hono` | 4.12.27 | Cookie helpers (`hono/cookie`) + `createMiddleware` (`hono/factory`) for the auth guard | Already the sole HTTP framework (`hono-adapter.ts`); helpers are first-party [VERIFIED: node_modules hono@4.12.27] |
| `node:crypto` | Node 22.22.2 | `timingSafeEqual` (constant-time password compare), `randomUUID`/`randomBytes` (session id), `createHash` (length-safe compare) | Node stdlib; no dependency; verified present at runtime [VERIFIED: node v22.22.2 probe] |
| `@did-btcr2/aggregation` | 0.4.0 | `runner.advertiseCohort(config)` (on-demand advertise) + `runner.session.cohorts` / `getCohort` / `getCohortPhase` (directory source) | Already consumed; documented multi-cohort path [VERIFIED: node_modules service-runner.d.ts, service.d.ts] |
| `@btcr2-aggregation/shared` | workspace | `buildCohortConfig(participants, beaconType, network, recoveryKey)` -> `CohortConfig`; `resolveNetwork`/`DEFAULT_NETWORK` (active network) | Already the cohort-config builder and network registry [VERIFIED: packages/shared/src/index.ts, networks.ts] |
| `zustand` | 5.0.14 (web) | New `stores/operator.ts` mirroring `stores/participant.ts` / `stores/dashboard.ts` | Established client-state pattern; no new dep [VERIFIED: packages/web/package.json] |

### Supporting (existing helpers to reuse)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `hono/body-limit` | 4.12.27 | Bound the login POST body before parsing (mirror `/v1/tx/broadcast`, `/v1/ipfs/pin`) | On `POST /v1/operator/login` and any mutating operator route [VERIFIED: hono-adapter.ts:19,211,340] |
| in-house `ui/primitives.tsx` | workspace | `Card`/`Button`/`Badge`/`StatusDot`/`SectionTitle`/`Mono`/`CopyField` + the 3 new `Input`/`Select`/`Field` | UI-SPEC governs; only additions permitted are `Input`/`Select`/`Field` [CITED: 01-UI-SPEC.md] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| httpOnly cookie session | Bearer token in `Authorization` header | **Rejected**: `EventSource` (the dashboard SSE client) cannot send custom headers; would force rewriting the SSE transport. Cookie is the locked D-06 decision and the only one that gates `/dashboard/events` cleanly |
| Server-tracked session id (opaque) | Stateless signed JWT / `getSignedCookie` | JWT can't be server-invalidated on logout without a denylist; D-06 requires "logout truly kills it," which needs server-tracked state anyway. Opaque id + in-memory Map is simpler and satisfies logout |
| Client-side path routing on `window.location.pathname` | Add `react-router` | CLAUDE.md: "stack is established, do not churn without reason." A ~20-line path switch + `history.pushState` covers `/operator` vs `/` with zero new dep. Recommend no router |
| App-level draft `Map` | `runner.session.createCohort()` then later `session.advertise()` | The library *does* expose a two-phase `createCohort` (phase `Created`) -> `advertise` split [VERIFIED: service.d.ts]. But `advertiseCohort()` (the runner facade) fuses create+advertise+drive; a session-level draft would sit outside the runner's driving loop and duplicate lifecycle wiring. Keep the draft app-side (config not yet passed to the runner) - simpler and matches D-15 |

**Installation:**
```bash
# None. No new packages. Phase 1 adds zero dependencies.
```

**Version verification:** Performed this session against installed `node_modules`:
- `hono@4.12.27` - cookie helpers present at `hono/dist/types/helper/cookie/index.d.ts`; `createMiddleware` at `hono/dist/types/helper/factory/index.d.ts` [VERIFIED]
- `@did-btcr2/aggregation@0.4.0` (pnpm dir `@did-btcr2+aggregation@0.4.0_typescript@5.9.3`) [VERIFIED]
- `@did-btcr2/method@0.51.0` [VERIFIED: pnpm store listing]
- Node `v22.22.2` [VERIFIED: `node --version`]

## Package Legitimacy Audit

> Phase 1 installs **no external packages**. Auth uses Hono's built-in `hono/cookie` + `hono/factory` and Node's built-in `node:crypto`; cohort control uses the already-installed `@did-btcr2/aggregation`. There is nothing to slopsquat.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none added) | - | - | - | - | - | No new packages this phase |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
                          ┌─────────────────────────────────────────────────────────┐
   Browser (ONE bundle)   │            Same-origin service (one Hono app)             │
   window.location.origin │                packages/service/src/hono-adapter.ts       │
                          │                                                           │
  ┌───────────────┐       │   ┌─────────────────────────────────────────────────┐    │
  │ "/"           │       │   │ PUBLIC (anonymous) routes                         │    │
  │ Participant   │──GET──┼──▶│  /v1/config  /v1/status(new)  /v1/directory(new)  │    │
  │  + public     │◀──────┼───│  /v1/adverts /resolve/* /cas/* /v1/ipfs /v1/tx/*  │    │
  │  status card  │       │   │  POST /v1/operator/login  (unauth by nature)      │    │
  └───────────────┘       │   └─────────────────────────────────────────────────┘    │
                          │                          │                                │
  ┌───────────────┐       │            login OK → Set-Cookie: httpOnly session        │
  │ "/operator"   │       │                          ▼                                │
  │ login gate    │─POST──┼──▶┌─────────────────────────────────────────────────┐    │
  │  ├ login form │  cookie│   │ session middleware  (createMiddleware)           │    │
  │  ├ create form│◀──────┼───│  getCookie → lookup Map<id,{expiresAt}> → 401?    │    │
  │  ├ draft list │  (auto │   └─────────────────────────────────────────────────┘    │
  │  └ SSE feed   │  sent) │                          │ valid session               │
  │   EventSource │◀──SSE──┼──────────────────────────┼─▶┌───────────────────────┐   │
  └───────────────┘       │   GATED (operator-only):  │  │ GET  /dashboard/events│   │
                          │     POST /v1/operator/cohorts (create draft) ─────────┼──▶│ drafts Map (closure)
                          │     POST /v1/operator/cohorts/:id/advertise ──────────┼──▶│ runner.advertiseCohort(cfg)
                          │     DELETE /v1/operator/cohorts/:id (discard draft)   │  │        │
                          │     GET  /v1/operator/cohorts (drafts + advertised)   │  │        ▼
                          │     GET  /v1/operator/session (probe: 200/401)        │  │  AggregationServiceRunner
                          │     POST /v1/operator/logout (delete session)         │  │   session.cohorts ──┐
                          └───────────────────────────────────────────────────────┘  │                     │
                                                                                       │ /v1/directory reads─┘
                                                                                       │ live advertised set (D-15)
```

The operator's advertise action is the ONLY path that calls `runner.advertiseCohort`; the `while` loop is deleted. The directory reads the live `runner.session.cohorts` (membership) enriched by the config the operator advertised each cohort with.

### Recommended Project Structure
```
packages/service/src/
├── operator-auth.ts      # NEW: session store (Map), constant-time password check,
│                         #      createMiddleware guard, login/logout handlers
├── operator-cohorts.ts   # NEW: draft Map + advertise/discard, directory + status derivation
├── hono-adapter.ts       # EDIT: mount auth middleware on /v1/operator/* + /dashboard/*;
│                         #       mount operator routes, /v1/directory, /v1/status
├── index.ts              # EDIT: thread operatorPassword + sessionTtlMs into createHonoApp;
│                         #       own the per-createService session + draft closures
└── demo-server.ts        # EDIT: delete while(running) loop + fillers; add fail-closed
                          #       OPERATOR_PASSWORD read + loud boot warning (mirror ADR 0010)

packages/web/src/
├── stores/operator.ts    # NEW: session probe, login/logout, draft form, create/advertise/
│                         #      discard, operator cohort list (mirror stores/participant.ts)
├── components/operator/   # NEW: LoginPanel, CreateCohortForm, DraftReview, OperatorCohortList
├── ui/primitives.tsx      # EDIT: add Input, Select, Field (only additions permitted)
├── lib/router.ts          # NEW (optional): tiny useLocation() over history API, no dep
└── App.tsx               # EDIT: route on pathname → OperatorConsole vs participant+status

e2e/
└── operator-cohort.ts    # NEW: login → create → advertise → headless join/co-sign/resolve
```

### Pattern 1: Constant-time credential check against an env password (D-05)
**What:** Compare the typed password to `OPERATOR_PASSWORD` without leaking length or timing, never logging either.
**When to use:** The `POST /v1/operator/login` handler only.
**Example:**
```typescript
// Source: node:crypto (verified present, Node v22.22.2). SHA-256 both sides first so
// timingSafeEqual never throws on unequal length (it requires equal-length buffers) and
// no length information leaks. Never console.log the password or the request body.
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

function passwordMatches(supplied: string, expected: string): boolean {
  const a = createHash('sha256').update(supplied, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b); // both 32 bytes → never throws
}

function newSessionId(): string {
  return randomBytes(32).toString('hex'); // server-issued only → session fixation impossible
}
```

### Pattern 2: Per-createService session store + Hono guard middleware (D-06/D-08)
**What:** In-memory session Map scoped to one `createService` call (mirrors `genesisStaging`/`seatedRosterKeys`), plus a middleware that 401s any request without a valid, unexpired session cookie.
**When to use:** Mounted on `/v1/operator/*` and `/dashboard/*`.
**Example:**
```typescript
// Source: hono/cookie + hono/factory (verified in node_modules hono@4.12.27).
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const SESSION_COOKIE = 'operator_session';

interface SessionStore {
  create(): string;          // returns a fresh id, records expiresAt = now + ttl
  isValid(id: string): boolean;
  destroy(id: string): void;
}

// Guard: reject before any operator handler runs. Order matters - register auth
// middleware on the prefix BEFORE the routes so a missing guard can never expose a route.
const requireOperator = (sessions: SessionStore) =>
  createMiddleware(async (c, next) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (!id || !sessions.isValid(id)) {
      return c.json({ error: 'operator authentication required' }, 401);
    }
    await next();
  });

// Login sets the cookie. Flags: HttpOnly always; SameSite=Strict (same-origin console,
// no cross-site flow); Secure derived from deployment (TLS terminates at the proxy per
// ADR 0014, so the browser sees https and Secure is correct in prod; allow an explicit
// opt-out env for local http dev). maxAge = configurable TTL (D-06, default ~24h).
setCookie(c, SESSION_COOKIE, id, {
  httpOnly: true,
  sameSite: 'Strict',
  secure: cookieSecure,   // true in prod (https at proxy); false only for local-http dev
  path: '/',
  maxAge: sessionTtlSeconds,
});
// Logout: destroy server-side THEN clear the cookie (server-tracked ⇒ logout truly kills it).
sessions.destroy(id);
deleteCookie(c, SESSION_COOKIE, { path: '/' });
```

### Pattern 3: On-demand create-draft → advertise (SVC-01/SVC-02, D-10..D-13)
**What:** Two app-level closures: `drafts: Map<draftId, CohortConfig>` and `advertised: Map<cohortId, CohortConfig>`. Create validates + stores a draft; advertise moves it to the runner; discard deletes an un-advertised draft.
**When to use:** The gated operator cohort routes.
**Example:**
```typescript
// buildCohortConfig(threshold, beaconType, network, recoveryKey) sets minParticipants=threshold.
// Capacity maps to CohortConfig.maxParticipants (a CohortConditions field, enforced as the
// accept/finalize ceiling - VERIFIED conditions.d.ts). Network is the service's active network
// (D-10), never chosen in the form.
function draftFromForm(form: { beaconType: BeaconType; threshold: number; capacity: number }): CohortConfig {
  const cfg = buildCohortConfig(form.threshold, form.beaconType, activeNetwork.name, recoveryKey);
  cfg.maxParticipants = form.capacity;    // capacity ceiling (D-19 auto-close-when-full)
  return cfg;
}

// Advertise: the ONLY caller of advertiseCohort (loop deleted). Move draft → live set.
const { cohortId, completion } = runner.advertiseCohort(cfg);   // VERIFIED service-runner.d.ts
advertised.set(cohortId, cfg);
drafts.delete(draftId);
// Prune the enrichment map when the cohort settles, so /v1/directory stays truthful.
void completion.finally(() => advertised.delete(cohortId));
```

### Pattern 4: Directory + status derived from the live advertised set (D-14/D-15/D-09)
**What:** `GET /v1/directory` (public) returns open cohorts from `runner.session.cohorts`, filtered by phase, enriched from the `advertised` config map. `GET /v1/status` (public) returns `{ up, network, openCohorts }`.
**Example:**
```typescript
// session.cohorts: ReadonlyArray<AggregationCohort> is the single source of truth (D-15).
// Each cohort exposes .id .beaconType .network .minParticipants .participants[] (accepted DIDs)
// [VERIFIED core/cohort.d.ts]. getCohortPhase(id) → ServiceCohortPhaseType [VERIFIED service.d.ts].
// "Open/joinable" = phases before signing starts:
const OPEN_PHASES = new Set(['Advertised', 'CohortSet', 'CollectingUpdates']); // confirm exact set at plan time
function directory() {
  return runner.session.cohorts
    .filter((k) => OPEN_PHASES.has(runner.session.getCohortPhase(k.id) ?? ''))
    .map((k) => {
      const cfg = advertised.get(k.id);
      return {
        cohortId: k.id,
        beaconType: k.beaconType,
        network: k.network,
        threshold: k.minParticipants,
        capacity: cfg?.maxParticipants ?? null,
        joined: k.participants.length,
        phase: runner.session.getCohortPhase(k.id),
      };
    });
}
// D-09 public status count reuses directory().length — one source, cannot drift.
```

### Anti-Patterns to Avoid
- **Gating in the browser.** The tab toggle (`App.tsx:21`) and any `if (loggedIn)` in React is presentation only. The boundary is the middleware. Never rely on hiding a route (D-04).
- **A second operator-written cohort list.** The directory must derive from `runner.session.cohorts`; do not maintain a parallel "advertised" list as the source of truth (D-15). The `advertised` config Map is enrichment only, keyed by the live cohort ids.
- **`timingSafeEqual` on raw unequal-length buffers.** It throws on length mismatch and the throw itself leaks length. Hash both sides to 32 bytes first.
- **Logging the login body.** The existing `dbg()`/`console.*` logs method+path; ensure the login route body (password) is never logged. Do not add `SSE_DEBUG`-style body logging to operator routes.
- **Reading the auth cookie from JS.** It is httpOnly - unreadable by design. Determine login state via a `GET /v1/operator/session` probe (200/401), not `document.cookie`.
- **Leaving `/dashboard/events` public.** It is now operator-gated telemetry (D-08); it must sit behind the same middleware. There is a test-coverage gap flagged in CONCERNS.md specifically for this - it must ship paired with its negative test.
- **Spawning fillers at boot.** With the loop gone there is no cohort at boot for fillers to join; fillers become dev+test-only and default-off (D-18). Remove them from the production boot path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Set/read/clear cookies with correct attributes | Manual `Set-Cookie` string building | `hono/cookie` `setCookie`/`getCookie`/`deleteCookie` | Handles serialization, `__Host-`/`__Secure-` constraints, SameSite casing [VERIFIED hono@4.12.27] |
| Route-prefix auth gate | Per-handler `if (!session) return 401` copy-pasted | `createMiddleware` mounted on the prefix via `app.use('/v1/operator/*', guard)` | One choke point; a forgotten per-handler check is exactly the "missing-auth on a mutating route" threat |
| Constant-time password compare | `a === b` or char-by-char loop | `crypto.timingSafeEqual` on equal-length hashes | Naive compare leaks timing; verified stdlib |
| Session id generation | `Math.random()` / counter | `crypto.randomBytes(32).toString('hex')` | CSPRNG; server-issued ids make fixation impossible |
| On-demand cohort advertise | New advertise/keygen orchestration | `runner.advertiseCohort(config)` | Library facade already drives keygen→sign→complete per cohort; documented multi-cohort path [VERIFIED] |
| Cohort capacity / min-to-finalize enforcement | Custom seat counting | `CohortConfig.minParticipants` (finalize floor) + `maxParticipants` (accept ceiling) | Enforced by the state machine [VERIFIED conditions.d.ts]; D-19 auto-close reuses `cohortTtlMs`/`phaseTimeoutMs` already wired |
| Client route for `/operator` | Full router install | `window.location.pathname` switch + `history.pushState` | SPA catch-all already serves index.html for `/operator` [VERIFIED static-site.ts]; no dep needed |

**Key insight:** The riskiest thing in an auth phase is a bespoke half-correct auth primitive. Every primitive this phase needs (cookies, constant-time compare, CSPRNG, prefix middleware) is a verified first-party helper or Node stdlib. Compose them; write no crypto.

## Runtime State Inventory

> Included because this phase restructures boot and removes the auto-advertise loop, and introduces a new secret. Rename/data-migration categories are mostly N/A (additive feature), but the boot/secret/state changes are real.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** - sessions and drafts are in-memory per-`createService` closures (mirroring `genesisStaging`/`seatedRosterKeys`, `index.ts:260,265`); no DB, no persistence (ADR 0014). Cohort state is already in-memory only (CONCERNS.md Scaling Limits). | None. A process restart clears sessions (operator re-logs in) and drafts (acceptable for MVP; durability is v2 DUR-01). |
| Live service config | **None new.** No external UI/DB holds operator state. | None. |
| OS-registered state | **None.** No task scheduler / pm2 / systemd names embed anything Phase 1 changes. | None. |
| Secrets / env vars | **New: `OPERATOR_PASSWORD`** (D-05), read at boot like existing `ALLOW_MAINNET`/`RECOVERY_KEY` (`opts.x ?? process.env.X` pattern, CONVENTIONS.md). Optional new: `OPERATOR_SESSION_TTL_MS`, `OPERATOR_COOKIE_SECURE` (local-http dev opt-out). | Add to `demo-server.ts` boot read; document in `docker-compose.yml` env table + `docs/DEPLOY.md`; never bake into the image (M4 `.env`-out-of-image lesson); never log. |
| Build artifacts | **None.** No egg-info/compiled-binary equivalent; TS/ESM only. | None. |

**Canonical check - after every file is updated, what runtime state persists?** Only the `OPERATOR_PASSWORD` env var (must be present at boot for the console to be enabled). Sessions/drafts are ephemeral in-process state by design.

## Common Pitfalls

### Pitfall 1: EventSource cannot carry a bearer token
**What goes wrong:** A designer picks `Authorization: Bearer` auth, then discovers the operator monitoring feed (`/dashboard/events`, consumed by `new EventSource(...)` in `stores/dashboard.ts`) has no way to send the header, so the gated telemetry breaks.
**Why it happens:** `EventSource` only sends same-origin cookies; it has no header API.
**How to avoid:** Use the httpOnly cookie (D-06). Same-origin `EventSource` sends it automatically. This is already the locked decision - do not deviate.
**Warning signs:** Any plan task proposing header-based auth for the SSE route.

### Pitfall 2: Secure cookie dropped in local dev
**What goes wrong:** `Secure` cookie set over `http://localhost` is silently discarded by the browser; login "succeeds" (200) but the next request has no cookie → infinite 401 loop.
**Why it happens:** TLS terminates at the reverse proxy (ADR 0014); the Node process itself serves plain http, and local dev has no proxy.
**How to avoid:** In production the browser talks to the proxy over https, so `Secure` is correct. Gate `Secure` on deployment: default `true`, with an explicit `OPERATOR_COOKIE_SECURE=0` (or derive from loopback bind) opt-out for local-http testing. The hermetic e2e runs over http on loopback, so it must set the insecure-cookie path.
**Warning signs:** e2e login returns 200 but operator routes 401; cookie present in response but absent on next request.

### Pitfall 3: Middleware registered after the routes
**What goes wrong:** Operator routes are reachable without auth because the guard was mounted after (or on the wrong prefix).
**Why it happens:** Hono matches in registration order; `app.use(prefix, guard)` must precede the route definitions it protects.
**How to avoid:** Mount `app.use('/v1/operator/*', requireOperator)` and `app.use('/dashboard/*', requireOperator)` immediately before those route groups. Add negative tests asserting 401 for no/invalid/expired session on every gated route (mandatory per CONCERNS.md).
**Warning signs:** A gated route returns 200 with no cookie in a test.

### Pitfall 4: Loud-boot fail-closed forgotten (D-07)
**What goes wrong:** Service boots without `OPERATOR_PASSWORD` and either crashes (too strict - breaks the public participant surface) or silently leaves operator routes open (dangerous default).
**Why it happens:** Missing the "still serve public, disable operator" branch.
**How to avoid:** Mirror the ADR 0010 mainnet loud-boot pattern (`demo-server.ts:176-186`): if no password, `log('!!! OPERATOR CONSOLE DISABLED: set OPERATOR_PASSWORD to enable ...')`, and pass a flag so `createHonoApp` does NOT mount the operator routes or the gated `/dashboard/events`. The public participant surface + directory + status + resolve still serve.
**Warning signs:** A booted-without-password instance where `/v1/operator/cohorts` or `/dashboard/events` returns anything but 404/disabled.

### Pitfall 5: Directory drift from the live set
**What goes wrong:** A parallel operator-written list shows a cohort that already completed/failed, or hides one that is live.
**Why it happens:** Treating the `advertised` enrichment Map as the source of truth instead of `runner.session.cohorts`.
**How to avoid:** Membership always from `session.cohorts` + phase filter; enrichment Map keyed by live cohort ids and pruned on `completion.finally` (D-15).
**Warning signs:** Directory count disagrees with actual advertised cohorts after one completes.

## Code Examples

### Fail-closed boot read (mirror ADR 0010 loud-boot), demo-server.ts
```typescript
// Source: mirrors packages/service/src/demo-server.ts:163-186 (mainnet guard/banner) +
// CONVENTIONS.md opts.x ?? process.env.X ?? DEFAULT ordering.
const operatorPassword = opts.operatorPassword ?? process.env.OPERATOR_PASSWORD;
if (!operatorPassword) {
  log('!!! OPERATOR CONSOLE DISABLED !!!');
  log('  - no OPERATOR_PASSWORD set at boot; the public participant surface still serves');
  log('  - the operator console, mutating cohort routes, and /dashboard/events are OFF');
  log('  - set OPERATOR_PASSWORD (and restart) to enable operator sign-in');
}
// Pass operatorPassword (possibly undefined) into createService → createHonoApp.
// When undefined, do NOT mount operator routes or the gated /dashboard/events.
```

### The loop deletion, demo-server.ts
```typescript
// DELETE: `let running = true;`, the entire `loop()` function (:240-273), and `void loop();`.
// The service still starts + listens; a fresh instance advertises NOTHING until the operator
// logs in and advertises (D-17). Fillers (opts.fillers / FILLERS) are removed from the boot
// path; participant spawning for lifecycle proof lives in the e2e harness (D-18).
// Keep: createService(...), service.start(...), and the SIGINT/SIGTERM graceful shutdown.
```

### e2e cookie handling (Node fetch has no cookie jar), e2e/operator-cohort.ts
```typescript
// Source: mirrors e2e/headless-cohort.ts harness idiom (real service + real HTTP + tsx).
// Node's fetch does not persist cookies, so capture Set-Cookie and echo it back manually.
const login = await fetch(`${baseUrl}/v1/operator/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: OPERATOR_PASSWORD }),
});
const setCookie = login.headers.get('set-cookie');           // "operator_session=...; HttpOnly; ..."
const cookie = setCookie?.split(';')[0] ?? '';               // "operator_session=..."
// Reuse `cookie` as the Cookie header on every gated call:
await fetch(`${baseUrl}/v1/operator/cohorts`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ beaconType: 'CASBeacon', threshold: 2, capacity: 2 }),
});
// NEGATIVE assertions (mandatory, CONCERNS.md):
//   wrong password → 401, no Set-Cookie
//   GET /v1/operator/cohorts with no cookie → 401
//   GET /dashboard/events with no cookie → 401
// Then spawn N createParticipant() peers (like headless-cohort) → co-sign → resolve.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Boot-time `while(running)` auto-advertise loop as the only cohort driver | Operator-triggered `runner.advertiseCohort` on demand | This phase (D-17) | A fresh instance advertises nothing until an operator acts |
| Anonymous read-only "Coordinator" telemetry tab (ADR 0004) | Operator-gated telemetry behind a session (supersedes ADR 0004's public-read posture; new auth ADR per D-03) | This phase (D-08) | `/dashboard/events` requires login |
| No control-plane auth anywhere (CONCERNS.md top concern) | httpOnly session cookie + prefix middleware | This phase (HOST-01) | First mutating surface ships with its guard |

**Deprecated/outdated:**
- ADR 0004 "dashboard is public read-only telemetry" - superseded for the gated feed; author a new operator-auth ADR (D-03).
- "booth/attendee" framing in new code - forbidden in Phase 1 additions (D-20); systematic sweep is Phase 6 (do not do it now).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | "Open/joinable" phases are exactly `{Advertised, CohortSet, CollectingUpdates}` | Pattern 4 / directory | Directory shows a cohort in the wrong window (e.g. a signing cohort as "open"). Low: the full `ServiceCohortPhaseType` list is verified [service phases.d.ts]; only the exact cut point needs confirmation at plan time. Mitigate: filter conservatively (pre-signing only). |
| A2 | `AggregationCohort` does NOT surface `maxParticipants`, so capacity must be kept in the app-side `advertised` config Map | Pattern 3/4 | If the field is actually present, the config Map is redundant for capacity. Low: the read cohort class fields are verified (cohort.d.ts shows `minParticipants` but no `maxParticipants` accessor); keeping the config Map is safe either way. |
| A3 | Node fetch has no cookie jar in this harness, requiring manual Set-Cookie echo | e2e | If a newer Node auto-persists, the manual echo is harmless. Low. |
| A4 | `Secure` cookie is correct in prod because TLS terminates at the proxy and the browser sees https | Pitfall 2 / Pattern 2 | If a deployment serves the Node process directly over http to browsers, Secure would drop the cookie. Mitigate: the `OPERATOR_COOKIE_SECURE` opt-out + document the TLS-at-proxy requirement (ADR 0014 already mandates it). |
| A5 | No rate-limiting/lockout on login is acceptable for ASVS L1 MVP | Security Domain | Brute-force risk on a weak `OPERATOR_PASSWORD`. Medium: recommend a simple in-memory attempt throttle; flag to planner as a should-have, not a Phase-1 blocker. Needs user confirmation. |

## Open Questions

1. **Exact "open cohort" phase cut-point (A1).**
   - What we know: the full `ServiceCohortPhaseType` enum is verified; membership source is `session.cohorts` + `getCohortPhase`.
   - What's unclear: whether `UpdatesCollected` should still count as "open/joinable" for the directory.
   - Recommendation: filter to pre-signing phases only; confirm during planning against a live cohort trace.

2. **Login route path/prefix: `/v1/operator/login` vs `/operator/login`.**
   - What we know: `/v1/*` is the protocol/API namespace and the static-site catch-all explicitly excludes `/v1/` and `/dashboard/` (so an API path never falls through to the SPA). `/operator` (no `/v1`) would be caught by the SPA fallback.
   - Recommendation: put ALL operator API routes under `/v1/operator/*` so they never collide with the client-side `/operator` SPA route. The client-side page is `/operator`; its API calls go to `/v1/operator/*`. (Claude's-discretion route inventory - resolved here.)

3. **Session TTL default + logout-all semantics.**
   - What we know: D-06 wants a configurable TTL (~24h default) and true server-side logout.
   - Recommendation: default `OPERATOR_SESSION_TTL_MS = 24h`; logout destroys only the current session id (single-operator model; multi-operator/roles is v2 OACC-01).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | everything | ✓ | v22.22.2 | - |
| `crypto.timingSafeEqual` / `randomBytes` / `createHash` | operator auth | ✓ | node:crypto (v22) | - |
| `hono` cookie + factory helpers | operator auth | ✓ | 4.12.27 | - |
| `@did-btcr2/aggregation` runner/session APIs | advertise + directory | ✓ | 0.4.0 | - |
| `pnpm` | build/test | ✓ | 11.4.0 (pinned) | - |
| Bitcoin node / esplora | NOT required for Phase 1 | ✗ (offline default) | - | Hermetic fixture/offline path is the default; `LIVE=1` opt-in only |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** live chain I/O is intentionally opt-in; the Phase 1 lifecycle e2e runs on the hermetic fixture path.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^2 (co-located `*.spec.ts` unit tests) + tsx e2e harnesses (real service, real HTTP) |
| Config file | none dedicated - run via root `vitest run`; e2e via `tsx e2e/*.ts` scripts in root `package.json` |
| Quick run command | `pnpm vitest run packages/service` (or a single spec: `pnpm vitest run packages/service/src/operator-auth.spec.ts`) |
| Full suite command | `pnpm test` (`tsc -b && vitest run`) then the e2e gate incl. new `pnpm e2e:operator` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOST-01 | Correct password → session cookie issued | unit | `pnpm vitest run packages/service/src/operator-auth.spec.ts` | ❌ Wave 0 |
| HOST-01 | Wrong password → 401, no cookie; password never logged; constant-time compare | unit | same | ❌ Wave 0 |
| HOST-01 | No/invalid/expired session → 401 on every gated route (`/v1/operator/*`, `/dashboard/events`) | unit | same | ❌ Wave 0 (**mandatory negative test**, CONCERNS.md) |
| HOST-01 | Logout destroys session server-side → subsequent request 401 | unit | same | ❌ Wave 0 |
| HOST-01 | Fail-closed: boot without `OPERATOR_PASSWORD` disables operator routes + gated telemetry, public surface still serves | unit | `pnpm vitest run packages/service/src/operator-boot.spec.ts` | ❌ Wave 0 |
| SVC-01 | Create draft validates (capacity ≥ threshold; threshold ≥ 1) and stores config; discard removes an un-advertised draft | unit | `pnpm vitest run packages/service/src/operator-cohorts.spec.ts` | ❌ Wave 0 |
| SVC-02 | Advertise calls `runner.advertiseCohort` once; cohort appears in `GET /v1/directory` as open | unit | same | ❌ Wave 0 |
| SVC-02 | `GET /v1/directory` + `/v1/status` derive from live `session.cohorts` (no drift after completion) | unit | same | ❌ Wave 0 |
| HOST-01/SVC-01/02 (success crit. 4) | login → create → advertise → headless participants join → co-sign → anchor → resolve, hermetic | e2e | `pnpm e2e:operator` (new: `tsc -b && tsx e2e/operator-cohort.ts`) | ❌ Wave 0 |
| SVC-02 | Loop removed: a fresh service advertises nothing until operator advertises | e2e/unit | assert `session.cohorts.length === 0` at boot in `e2e/operator-cohort.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run packages/service` (fast unit slice on the auth + cohort modules).
- **Per wave merge:** `pnpm test` (full typecheck + all unit) + `pnpm e2e:operator`.
- **Phase gate:** the full hermetic gate green (existing 16 checks + the new `e2e:operator`) and web `tsc --noEmit` + `vite build` clean, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `packages/service/src/operator-auth.spec.ts` - login success/fail, cookie flags, session validate/expire/logout, timing-safe compare, no-password-logging (HOST-01)
- [ ] `packages/service/src/operator-boot.spec.ts` - fail-closed boot (D-07)
- [ ] `packages/service/src/operator-cohorts.spec.ts` - draft create/validate/discard, advertise, directory/status derivation (SVC-01/02)
- [ ] `e2e/operator-cohort.ts` + `e2e:operator` script - full authed lifecycle incl. negative auth assertions (success criterion 4)
- [ ] (web) a `stores/operator.spec.ts` mirroring `stores/participant.spec.ts` for login-state probe + form validation, if the web slice warrants a unit test
- [ ] Framework install: none needed (vitest + tsx already present)

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high` [VERIFIED .planning/config.json]. This phase introduces the first authenticated + mutating surface, so the threat model is load-bearing.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Single operator password via env (`OPERATOR_PASSWORD`), constant-time `timingSafeEqual` on SHA-256 digests; never logged; consider a simple attempt throttle (A5) |
| V3 Session Management | yes | Server-issued opaque session id (`randomBytes(32)`); httpOnly + SameSite=Strict + Secure cookie; configurable TTL; server-side invalidation on logout; new id per login (fixation-proof) |
| V4 Access Control | yes | `createMiddleware` guard on `/v1/operator/*` + `/dashboard/*`; deny-by-default; fail-closed boot disables the surface entirely when unconfigured |
| V5 Input Validation | yes | `hono/body-limit` on login + mutating routes (mirror existing routes); validate create-form (`beaconType` ∈ {CASBeacon,SMTBeacon}, `threshold` integer ≥1, `capacity` ≥ threshold) with guard clauses + `throw new Error('operator: ...')` style |
| V6 Cryptography | yes (compare only) | Use `node:crypto` primitives only; never hand-roll; no key material handled beyond the session id |
| V7 Error/Logging | yes | Generic 401/400/413 bodies to the caller; detailed reason logged server-side with a module prefix (`[operator]`); never log the password or session id |
| V13 API | yes | Same-origin only (ADR 0003/0005); no CORS added |

### Known Threat Patterns for {Hono cookie-session operator surface}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Session-cookie theft (XSS reads cookie) | Information Disclosure | `HttpOnly` (JS cannot read it); `Secure` (not sent over http) |
| Session fixation (attacker plants a known id) | Spoofing / Elevation | Only server-issued ids are ever accepted; new id minted per successful login |
| Missing-auth on a mutating route | Elevation of Privilege | Prefix middleware mounted BEFORE routes; mandatory negative tests on every gated route + the SSE feed (CONCERNS.md) |
| Credential timing / length leak | Information Disclosure | SHA-256 both sides → `timingSafeEqual` on equal-length buffers |
| Credential logging | Information Disclosure | No body logging on operator routes; audit the `[adapter]`/`console.*` paths |
| CSRF on cookie-authed mutating routes | Tampering | `SameSite=Strict` cookie + same-origin topology; belt-and-suspenders: check `Origin`/`Referer` on `POST`/`DELETE` operator routes. (`/dashboard/events` is a GET/non-mutating, so CSRF-inert; it only needs the cookie.) |
| Brute-force on the login route | Spoofing | Recommend a simple in-memory per-IP attempt throttle (A5 - flag to planner; not a hard L1 blocker but cheap) |
| Unbounded login body DoS | Denial of Service | `hono/body-limit` before `c.req.json()` (mirror `/v1/tx/broadcast`, `/v1/ipfs/pin`) |
| Open-by-default when unconfigured | Elevation of Privilege | Fail-closed boot (D-07): no password ⇒ operator surface not mounted at all |

## Project Constraints (from CLAUDE.md)

- **Consume published `@did-btcr2/*`; no fork.** Phase 1 adds zero library changes; uses `advertiseCohort`/`session` as-is.
- **Config-driven network, never hardcoded.** Create form displays the service's single active network (D-10); no simultaneous multi-network. `buildCohortConfig(..., activeNetwork.name, ...)`.
- **Real-money paths opt-in behind guard rails.** Unchanged; the lifecycle e2e is hermetic (fixture/offline default). Do not couple operator auth to `LIVE`/mainnet.
- **Single-box self-host model (ADR 0014).** Sessions/drafts in-memory per process; no multi-instance coordination.
- **No unauthenticated mutating/control surface.** This is the phase that establishes it: auth ships with the first mutating route; nothing mutating is reachable without a valid session.
- **No em-dash character anywhere** (prose, comments, commits). Use commas/colons/parentheses/periods/`->`/spaced hyphen. **No Claude `Co-Authored-By` trailer** in commits.
- **House style:** explicit `.js` import extensions (NodeNext); `import type`; `throw new Error('module: ...')`; module-prefixed `console.*` (add `[operator]`); dense TSDoc with `{@link}` + ADR cross-refs; `.spec.ts` co-location; named exports.
- **GSD onboarding note:** planning commits land UNSIGNED via `git -c commit.gpgsign=false`.

## Sources

### Primary (HIGH confidence - read this session)
- `node_modules/.pnpm/hono@4.12.27/.../hono/dist/types/helper/cookie/index.d.ts` + `utils/cookie.d.ts` - cookie helper + `CookieOptions` (httpOnly/sameSite/secure/maxAge) [VERIFIED]
- `.../hono/dist/types/helper/factory/index.d.ts` - `createMiddleware` [VERIFIED]
- `node_modules/.pnpm/@did-btcr2+aggregation@0.4.0.../service/service-runner.d.ts` - `advertiseCohort`, multi-cohort docs, `session` accessor [VERIFIED]
- `.../service/service.d.ts` - `CohortConfig`, `session.cohorts`, `getCohort`, `getCohortPhase`, `createCohort`/`advertise` [VERIFIED]
- `.../core/conditions.d.ts` - `minParticipants` / `maxParticipants` semantics [VERIFIED]
- `.../core/cohort.d.ts` + `core/phases.d.ts` - `AggregationCohort` fields + `ServiceCohortPhaseType` enum [VERIFIED]
- `.../participant/participant.d.ts` - `CohortAdvert` shape [VERIFIED]
- Node `v22.22.2` runtime probe - `crypto.timingSafeEqual/randomUUID/randomBytes/createHash` present [VERIFIED]
- Repo source: `hono-adapter.ts`, `demo-server.ts`, `index.ts`, `static-site.ts`, `packages/shared/src/index.ts`, `packages/participant/src/index.ts`, `e2e/headless-cohort.ts`, `packages/web/src/App.tsx`, `stores/dashboard.ts`, `ui/primitives.tsx` [VERIFIED read this session]
- `.planning/` docs: 01-CONTEXT.md (D-01..D-20), 01-UI-SPEC.md, REQUIREMENTS.md, codebase/CONCERNS.md, codebase/CONVENTIONS.md, config.json [CITED]

### Secondary (MEDIUM confidence)
- ADR 0010 loud-boot pattern - referenced via `demo-server.ts:176-186` (not re-read in full this session) [CITED]

### Tertiary (LOW confidence)
- Login brute-force throttling as an L1 expectation - general security practice, flagged as A5 for user confirmation [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - every API verified against installed `node_modules` + Node runtime probe; zero new packages.
- Architecture: HIGH - route inventory, session model, draft/advertise, and directory-derivation all grounded in read source + verified library types.
- Pitfalls: HIGH - EventSource/cookie and Secure-in-dev pitfalls derive directly from the read SSE client + ADR 0014 topology.
- Security: MEDIUM/HIGH - ASVS L1 controls map cleanly to stdlib/framework primitives; brute-force throttle (A5) needs a product call.

**Research date:** 2026-07-08
**Valid until:** 2026-08-07 (stable; the only fast-moving inputs are `@did-btcr2/*`, pinned at method@0.51.0 / aggregation@0.4.0)
