# ADR 0015: Operator authentication - httpOnly session behind the first mutating control surface

- Status: Accepted
- Date: 2026-07-08
- Milestone: v1 Phase 1 (Authenticated Operator Console + On-Demand Cohort Creation; HOST-01)
- Supersedes: the public-read-only telemetry posture of [ADR 0004](0004-dashboard-sse-telemetry-channel.md)

## Context

Through M1-M4 the service had no authentication anywhere in the control plane. That
was acceptable while the only surface was read-only: the "Coordinator" web tab is
anonymous SSE telemetry over `GET /dashboard/events` (ADR 0004), and the only lever an
operator had was env vars plus Ctrl+C. The codebase audit (`.planning/codebase/CONCERNS.md`)
ranks "no auth anywhere in the control plane" as the top blocker to running a real,
self-hostable public aggregator.

Phase 1 introduces the first operator control surface that can change service state on
demand (create/configure/advertise a cohort, replacing the boot-time auto-advertise
loop). The project constraint is explicit: no unauthenticated mutating/control surface
may ever ship. So operator authentication (HOST-01) must land in the same phase as, and
strictly before, the first mutating route. Because the operator monitoring feed is a
live telemetry stream and is now operator-only rather than public, its access posture
changes too - hence this ADR supersedes ADR 0004's public-read-only stance for that feed.

The single most consequential technical constraint on the auth scheme: the telemetry
feed is a Server-Sent Events stream consumed by the browser's `EventSource`, and
`EventSource` cannot set an `Authorization` header. It only sends same-origin cookies
automatically.

## Decision

1. **App-level auth at the one same-origin service, enforced server-side** in the sole
   HTTP mount point (`packages/service/src/hono-adapter.ts`). The client-side route
   split (`/operator` vs `/`) is presentation only; the real boundary is the server
   middleware. (D-04)

2. **Credential = an operator-chosen password**, supplied via env at boot
   (`OPERATOR_PASSWORD`), never baked into an image (the M4 .env-out-of-image lesson),
   never logged, and compared with a **constant-time** check: SHA-256 both the supplied
   and expected value, then `crypto.timingSafeEqual` on the equal-length digests (no
   length or timing oracle). (D-05)

3. **Login issues an opaque, server-tracked, httpOnly session cookie** (`operator_session`),
   not a stateless token. httpOnly is not merely a good choice, it is the only scheme
   that gates the SSE feed without rewriting the transport, because `EventSource` sends
   the same-origin cookie automatically and cannot send a bearer header. Opaque
   server-tracked ids (a per-`createService` in-memory `Map`, mirroring the existing
   `genesisStaging`/`seatedRosterKeys` closures) mean logout can truly invalidate a
   session server-side, which a stateless JWT could not without a denylist. The session
   id is CSPRNG (`randomBytes(32)`) and server-issued only, so session fixation is
   impossible. Cookie flags: `HttpOnly`, `SameSite=Strict`, `Path=/`, a configurable
   `Max-Age` (default 24h), and `Secure` (default on; TLS terminates at the reverse
   proxy per ADR 0014). (D-06)

4. **Fail-closed boot** (D-07): if no `OPERATOR_PASSWORD` is set, the process still
   boots and serves the public participant surface, but the operator console, all
   mutating/operator routes, and the gated telemetry feed do NOT mount, and a loud boot
   warning is emitted (mirroring the ADR 0010 mainnet loud-boot banner). No credential
   means no operator access; the surface is never open by default. Unlike the mainnet
   guard this does not throw, so a fresh self-hosted service can boot before its operator
   chooses a password.

5. **Gated vs anonymous route split** (D-08):
   - Gated (require a valid session): `POST /v1/operator/logout`, `GET /v1/operator/session`,
     the mutating cohort routes (Phase 1 plans 02/03), and `GET /dashboard/events`.
   - Public by nature: `POST /v1/operator/login` (how a session is obtained), and the
     anonymous participant surface (`/v1/config`, `/v1/adverts`, `/resolve/*`, `/cas/*`,
     `/v1/ipfs`, `/v1/tx/*`, the directory + status routes added in plans 02/03).
   The session guard is a `hono/factory` `createMiddleware` mounted on both the
   `/v1/operator/*` and `/dashboard/*` prefixes BEFORE the routes they protect (Hono
   matches in registration order, so a guard mounted after a route would leave it
   exposed).

6. **Single-operator scope.** One shared operator password, one role. Multiple operators
   and role granularity (OACC-01) are deferred to v2.

## Defense in depth

- **CSRF:** `SameSite=Strict` already blocks cross-site cookie attachment; on top of
  that, a same-origin `Origin`/`Referer` check 403s a mutating (`POST`/`PUT`/`PATCH`/`DELETE`)
  operator request whose Origin is present and does not match the Host. An absent Origin
  (a non-browser API client, or a same-origin navigation) is allowed, since a browser
  always attaches Origin to a cross-site POST. `GET /dashboard/events` is CSRF-inert.
- **Login body DoS:** the login POST is body-limited (4 KiB) before its JSON is parsed.
- **Brute force:** an in-memory per-client fixed-window attempt throttle (10 attempts /
  5 min) returns 429 when exceeded and resets on a successful login. This is an ASVS L1
  should-have (belt-and-suspenders), not a hard lockout that could self-DoS the operator.
- **No credential leakage in logs:** operator routes never log the password, the request
  body, or the session id; denials log only method + path with the `[operator]` prefix.

## Consequences

- The first mutating operator surface ships behind a server-enforced session, closing
  the CONCERNS.md top blocker. Every later operator slice (create, advertise, monitor,
  lifecycle) inherits this guard.
- `GET /dashboard/events` now requires a valid operator session; the anonymous
  "Coordinator" telemetry of ADR 0004 no longer exists (superseded). A minimal public
  status surface (service up, active network, open-cohort count) covers what an
  anonymous visitor may still see (Phase 1 plans 02/03).
- Sessions and the login throttle are per-process in-memory state (ADR 0014, single-box
  self-host). A process restart clears sessions (the operator re-signs in); durable
  session storage is not a v1 requirement.
- Auth ships paired with its mandatory negative tests (per CONCERNS.md): wrong password,
  no/invalid/expired session on every gated route including the SSE feed, logout then
  401, and a spy asserting the password is never logged.

## Alternatives considered

- **Bearer token in an `Authorization` header.** Rejected: `EventSource` cannot send a
  custom header, so this could not gate `/dashboard/events` without rewriting the SSE
  transport.
- **Stateless signed JWT / signed cookie.** Rejected: cannot be server-invalidated on
  logout without a denylist, which reintroduces the server-side state a plain opaque id
  already provides more simply. D-06 requires logout to truly kill the session.
- **A full two-app split (separate participant and service deployments).** Considered
  and rejected for this milestone (see 01-CONTEXT.md D-02): the participant is
  architecturally a client, and a split would force CORS onto every route, need a second
  deployable, and supersede ADRs 0003/0005/0014 for zero v1 requirement coverage.
