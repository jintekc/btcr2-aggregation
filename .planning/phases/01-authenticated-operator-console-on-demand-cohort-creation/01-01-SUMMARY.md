---
phase: 01-authenticated-operator-console-on-demand-cohort-creation
plan: 01
subsystem: operator-auth
status: complete
tags: [auth, security, hono, session-cookie, react, adr]
requires:
  - "Hono 4.x (hono/factory, hono/cookie, hono/body-limit) - already installed"
  - "node:crypto (timingSafeEqual, randomBytes, createHash) - Node 22 stdlib"
  - "@did-btcr2/aggregation service runner + transport (existing)"
provides:
  - "operator-auth.ts: SessionStore, requireOperator/requireSameOrigin guards, constant-time login, logout, session probe, per-IP login throttle"
  - "createHonoApp operatorAuth mount (login public + /v1/operator/* and /dashboard/* gated)"
  - "createService operatorPassword/operatorSessionTtlMs/operatorCookieSecure options"
  - "demo-server fail-closed OPERATOR_PASSWORD boot"
  - "web /operator login-gated console shell (LoginPanel, OperatorConsole, useOperator store)"
  - "ui primitives Input/Select/Field"
  - "ADR 0015 (supersedes ADR 0004 public-read-only telemetry posture)"
affects:
  - "packages/service/src/hono-adapter.ts, index.ts, demo-server.ts"
  - "packages/web/src/App.tsx (pathname routing; two-tab toggle removed)"
  - "docker-compose.yml, docs/DEPLOY.md (three new env vars)"
tech-stack:
  added: []
  patterns:
    - "httpOnly opaque server-tracked session cookie (EventSource-compatible auth)"
    - "createMiddleware prefix guard mounted before routes (fail-closed)"
    - "per-createService closure state for sessions/throttle (no module singleton)"
    - "login state via server probe, never document.cookie (httpOnly)"
key-files:
  created:
    - packages/service/src/operator-auth.ts
    - packages/service/src/operator-auth.spec.ts
    - packages/service/src/operator-boot.spec.ts
    - docs/adr/0015-operator-authentication.md
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/LoginPanel.tsx
    - packages/web/src/components/operator/OperatorConsole.tsx
  modified:
    - packages/service/src/hono-adapter.ts
    - packages/service/src/index.ts
    - packages/service/src/demo-server.ts
    - packages/web/src/ui/primitives.tsx
    - packages/web/src/App.tsx
    - docker-compose.yml
    - docs/DEPLOY.md
decisions:
  - "httpOnly cookie (not bearer) is the only scheme that gates the EventSource SSE feed without a transport rewrite (ADR 0015)"
  - "Fail-closed boot: no OPERATOR_PASSWORD leaves the operator surface unmounted but the public participant surface serving (D-07)"
  - "Login throttle (10/5min) shipped as an ASVS L1 should-have (A5), not a hard lockout"
  - "Same-origin CSRF check added on mutating operator routes as belt-and-suspenders atop SameSite=Strict"
metrics:
  duration: ~11 min
  completed: 2026-07-08
  tasks: 3
  files_created: 8
  files_modified: 7
---

# Phase 1 Plan 01: Authenticated Operator Console (auth foundation) Summary

httpOnly session-cookie operator authentication (HOST-01) enforced server-side in the Hono adapter, with a fail-closed boot, a login-gated `/operator` console shell in the SPA, and ADR 0015 - the first mutating/operator surface now ships behind a session guard, closing the CONCERNS.md top blocker.

## What Shipped

**Task 1 - `operator-auth.ts` (test-first, TDD):** a per-`createService` in-memory `SessionStore` (opaque CSPRNG ids, lazy expiry eviction), `passwordMatches` (SHA-256 both sides then `timingSafeEqual`, no length/timing oracle), the `requireOperator` `createMiddleware` guard, a `requireSameOrigin` CSRF guard, login/logout/session-probe handler factories, and a per-IP fixed-window login throttle (10/5min). 19 unit tests including all mandatory negatives (wrong password 401 + no Set-Cookie, no/invalid/expired session 401 on every gated route incl. `/dashboard/events`, logout-then-401, password-never-logged spy, fresh id per login, throttle 429).

**Task 2 - wiring + fail-closed boot + ADR:** `createHonoApp` mounts the operator surface only when `operatorAuth` is present - public body-limited `POST /v1/operator/login`, `requireSameOrigin` + `requireOperator` on `/v1/operator/*` and `requireOperator` on `/dashboard/*` (middleware before routes), then gated logout/session; `/dashboard/events` is now gated behind `runner && operatorAuth` (D-08). `createService` gained `operatorPassword`/`operatorSessionTtlMs`/`operatorCookieSecure` and constructs the session/throttle closures. `demo-server` reads `OPERATOR_PASSWORD` fail-closed with a loud boot warning (mirrors ADR 0010), never throwing. ADR 0015 authored (supersedes ADR 0004). Three env vars documented in `docker-compose.yml` + `docs/DEPLOY.md`. 8 boot tests (fail-closed 404s vs gated 401s). Service `tsc -b` clean.

**Task 3 - web `/operator` shell:** three new primitives (`Input`/`Select`/`Field`, 600-weight labels, non-accent focus ring); `lib/operator.ts` same-origin `login`/`logout`/`sessionProbe` (never reads the httpOnly cookie); `useOperator` Zustand auth state machine (`checking|logged-out|logging-in|logged-in|disabled`) driven only by the server probe; `LoginPanel` + `OperatorConsole` (UI-SPEC-faithful sign-in, gated shell with Sign out, fail-closed "disabled" notice); `App.tsx` switched from the two-tab toggle to a `window.location.pathname` route (`/operator` -> console, else participant). Web `tsc --noEmit` + `vite build` clean.

## Verification

- `pnpm vitest run packages/service` - 159 passed (incl. operator-auth 19 + operator-boot 8).
- `pnpm --filter @btcr2-aggregation/service exec tsc -b` - exit 0.
- `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` + `build` - exit 0.
- `pnpm typecheck` (root project references) - exit 0.
- `pnpm lint` - exit 0.
- Threat register: T-01-01/02/03/04/05/06/07/08 all mitigated and test-backed (no high-severity threat left un-mitigated).

## Deviations from Plan

**None that changed scope.** Two minor, in-spirit refinements:

1. **[Rule 2 - security] Same-origin CSRF guard placed before the login POST** so the login route also gets the `requireSameOrigin` check (the plan located it generically on "POST/DELETE operator routes"). Login stays outside `requireOperator` (public). The guard allows an absent Origin (non-browser API clients, the e2e), only rejecting a present cross-origin one - preserving the plan's e2e cookie-echo path.
2. **[Rule 2 - framing] Footer wording** in `App.tsx` changed "attendee" -> "participant" and "coordinator" -> "service" while rewriting that file, to avoid re-emitting booth/attendee framing in authored code (D-20). This is not the Phase 6 systematic sweep; only the one line being rewritten was touched.

## Notes for Downstream Plans (02/03/04)

- The operator console shell (`OperatorConsole.tsx`) has a clearly-labelled empty "Your cohorts" region reserved for the create form + operator cohort list + directory (plans 02/03). No cohort UI ships here.
- Gated route prefix `/v1/operator/*` and the `requireOperator`/`requireSameOrigin` guards are already mounted; new mutating cohort routes registered after the guards inherit them automatically.
- `Select` is ready for the CAS/SMT beacon-type field (plan 02).
- The e2e (`e2e/operator-cohort.ts`, plan 04) must run with `OPERATOR_COOKIE_SECURE=0` (http-on-loopback) and echo the `Set-Cookie` value manually (Node fetch has no cookie jar).

## Known Stubs

- `OperatorConsole` logged-in shell shows a placeholder "Your cohorts" card with no data source yet - intentional; wired by plans 02/03 (create/advertise/directory). Documented in the plan as the Wave-1 cut point, not a goal-blocking stub.

## Self-Check: PASSED
