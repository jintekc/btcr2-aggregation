---
phase: 01
slug: authenticated-operator-console-on-demand-cohort-creation
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-08
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> First authentication surface in the project. Verified from PLAN threat models
> (`register_authored_at_plan_time: true`) against the implementation by gsd-security-auditor;
> classifications traced in code, not taken from SUMMARY claims. Reconciles the deep code
> review (`01-REVIEW.md`).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Anonymous internet → operator control plane | Unauthenticated client authenticates via `POST /v1/operator/login`, receives an httpOnly session cookie, then reaches gated mutating routes under `/v1/operator/*` and gated telemetry under `/dashboard/*` | Operator password (in), opaque CSPRNG session id (out, httpOnly cookie), cohort draft config (in) |
| Reverse proxy → service (ADR 0014) | TLS-terminating external proxy forwards to the loopback service; TLS is not terminated in-process | Client IP (seen as `socket.remoteAddress` = the proxy today, NOT `X-Forwarded-For` — see T-01-06), `Host`/`Origin`/`Referer` headers |
| Service → public read surface | Anonymous `GET /v1/directory` and `GET /v1/status` derive from the live `runner.session.cohorts` | Field-minimized cohort DTOs (out); no keys, recovery key, or DIDs |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Spoofing / Elevation | operator-auth (password + session) | high | mitigate | SHA-256 both sides → `timingSafeEqual` (no length oracle); `randomBytes(32)` opaque id; fresh id minted server-side per login (fixation-proof) — `operator-auth.ts:46-49,57-59,80-84` | closed |
| T-01-02 | Elevation of Privilege | hono guard ordering | high | mitigate | `app.use('/v1/operator/*', requireOperator)` + `/dashboard/*` registered BEFORE gated routes; Hono matches in registration order — `hono-adapter.ts:308-311,364-371` | closed |
| T-01-03 | Information Disclosure | session cookie | high | mitigate | `httpOnly:true, sameSite:'Strict', secure:cookieSecure, path:'/'`; `cookieSecure` defaults true — `operator-auth.ts:247-253`, `index.ts:330` | closed |
| T-01-04 | Information Disclosure | auth logging | medium | mitigate | Equal-length compare; logs only the IP key, never password/body/session-id — `operator-auth.ts:46-49,231,243,255` | closed |
| T-01-05 | Tampering (CSRF) | mutating operator routes | medium | mitigate | `requireSameOrigin` Origin/Referer↔Host compare (403 on mismatch) mounted over `/v1/operator/*` incl. login; `SameSite=Strict` is the primary CSRF defense — `operator-auth.ts:184-204`, `hono-adapter.ts:300` | closed |
| T-01-06 | Spoofing (login brute-force) | login throttle | medium | mitigate | Declared per-IP fixed-window throttle (10/5min) EXISTS and runs before the password compare, BUT keys on raw `socket.remoteAddress` with no `X-Forwarded-For` handling → per-**proxy** not per-client under ADR 0014 — `operator-auth.ts:120-153,230-233` | **open — below `high` threshold (non-blocking)** |
| T-01-07 | Denial of Service | login body | medium | mitigate | `bodyLimit({maxSize:4KiB, onError:413})` before `c.req.json()` — `hono-adapter.ts:305` | closed |
| T-01-08 | Elevation of Privilege | fail-closed boot | high | mitigate | Operator block wrapped in `if(operatorAuth)`; `operatorAuth` undefined when no password; loud "OPERATOR CONSOLE DISABLED" warning, no throw, public surface still serves — `hono-adapter.ts:299`, `index.ts:323`, `demo-server.ts:216-221` | closed |
| T-02-01 | Elevation of Privilege | create/list/discard routes | high | mitigate | Registered inside `if(operatorAuth)` AFTER `requireOperator`; e2e no-cookie → 401 — `hono-adapter.ts:318-347`, `operator-cohort.ts:179-182` | closed |
| T-02-02 | Tampering / DoS | draft create body | medium | mitigate | 4 KiB body limit + guard-clause field validation → specific 400 — `hono-adapter.ts:324`, `operator-cohorts.ts:151-163` | closed |
| T-02-03 | Tampering (CSRF) | cohort POST/DELETE | medium | mitigate | Inherits `requireSameOrigin` prefix guard — `hono-adapter.ts:300` | closed |
| T-02-04 | Information Disclosure | operator cohort DTO | low | mitigate | `OperatorCohortDTO` field minimization — `operator-cohorts.ts:70-79` | closed |
| T-03-01 | Elevation of Privilege | advertise route | high | mitigate | Advertise POST registered after `requireOperator`; e2e asserts gated — `hono-adapter.ts:353` | closed |
| T-03-02 | Information Disclosure | public directory/status DTO | medium | mitigate | `DirectoryCohortDTO`/`ServiceStatusDTO` expose only cohortId/beaconType/network/threshold/capacity/joined/phase + up/network/openCohorts; no keys/DIDs — `operator-cohorts.ts:87-104` | closed |
| T-03-03 | Tampering (CSRF) | advertise POST | medium | mitigate | Inherits `requireSameOrigin` — `hono-adapter.ts:300` | closed |
| T-03-04 | DoS / integrity | directory drift | low | mitigate | Directory derived from live `runner.session.cohorts` + OPEN_PHASES filter; enrichment pruned on `completion.finally` (count cannot outlive the live set) — `operator-cohorts.ts:188-210,251` | closed |
| T-03-05 | Elevation of Privilege | demo auto-advertise loop | high | mitigate | Loop + fillers removed (`while (running)`=0, `advertiseCohort`=0 in demo-server); sole caller `operator-cohorts.ts:243` (whole-repo scan confirms one call site) | closed |
| T-04-01 | Elevation of Privilege | e2e auth boundary | high | mitigate | Real assertions: wrong-pw 401 + no Set-Cookie, no-cookie `/v1/operator/cohorts` 401, no-cookie `/dashboard/events` 401 — `e2e/operator-cohort.ts:165-193` | closed |
| T-04-02 | Elevation of Privilege | e2e on-demand-only driver | high | mitigate | `session.cohorts.length===0` at boot; signed cohort id === advertised cohort id (no phantom cohort) — `e2e/operator-cohort.ts:154-161,307-312` | closed |
| T-04-03 | Denial of Service | e2e hermeticity | low | mitigate | Hermetic (no LIVE/esplora); `withTimeout` bounds signing + completion — `e2e/operator-cohort.ts` | closed |
| T-01-SC | Tampering (supply chain) | plan 01-01 deps | low | accept | Only pre-existing deps (hono, node:crypto); `tech-stack.added: []` | closed (accepted) |
| T-02-SC | Tampering (supply chain) | plan 01-02 deps | low | accept | Zero new packages | closed (accepted) |
| T-03-SC | Tampering (supply chain) | plan 01-03 deps | low | accept | Zero new packages | closed (accepted) |
| T-04-SC | Tampering (supply chain) | plan 01-04 deps | low | accept | tsx + workspace packages already present | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on (`high`) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Open Threats (non-blocking, below `high`)

### T-01-06 — login throttle is per-proxy, not per-client (medium)

The declared per-IP fixed-window login throttle is implemented and runs before the password
compare, but it keys on `c.env.incoming.socket.remoteAddress` with no `X-Forwarded-For`
handling. Under the project's own documented reverse-proxy topology (ADR 0014) `remoteAddress`
is the proxy, so the throttle collapses to one global counter. Two consequences (both traced,
reconciles code-review WR-01):

1. Per-attacker brute-force accounting is defeated (all clients share one 10/5min window).
2. Because `throttle.check()` runs before `passwordMatches`, an unauthenticated remote can burn
   10 attempts / 5 min and hold the legitimate operator at HTTP 429 — an unauthenticated
   **availability attack on the sole control plane**.

Medium severity → does not block phase completion. **Recommended before the public-internet
deployment this product targets:** switch to a trusted-proxy `X-Forwarded-For` key (bounded to
a configured proxy hop), and/or skip the 429 when a valid session cookie is presented. Tracked
for a follow-up (`/gsd-code-review 1 --fix` or a Phase 1.x hardening slice).

---

## Hardening Notes (no register threat opened; recommended fixes)

- **WR-02 — `NaN` session TTL (defense-in-depth):** a non-numeric `OPERATOR_SESSION_TTL_MS`
  (e.g. `1h`) yields `NaN`; `?? 24h` is nullish-only and does not backstop `NaN`, so
  `Date.now() > NaN` is always false and sessions never expire server-side under that
  misconfig. Session **fixation** (T-01-01) is prevented independently by new-id-per-login, so
  no register threat opens — but add a `Number.isFinite(x) && x > 0` guard as a fail-safe.
  (`demo-server.ts:211-213`, `index.ts:322`, `operator-auth.ts:82,90`)
- **IN-01/IN-02:** no upper bound on threshold/capacity (operator-self-inflicted); lazy-only
  session eviction (bounded memory). Hardening, not threats.
- **IN-04:** `null` JSON body → raw `TypeError` string rendered as the 400 body (React-escaped,
  no XSS); minor internal-string leak beyond T-02-04's DTO-minimization scope.
- **IN-05 (standing tension, flagged for the constraint owner):** `/v1/ipfs/pin`
  (`hono-adapter.ts:262-289`) and `/v1/tx/broadcast` (`:463-493`) are **unauthenticated mutating
  POST routes** that PRE-DATE Phase 1 (participant surface, ADRs 0010/0011), are body-limited,
  and default to the offline/no-op path. Not new attack surface this phase and not part of the
  operator control-plane register — but the project's #1 constraint is "no unauthenticated
  mutating/control surface," so these remain to be resolved when the participant surface gains
  an auth model.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-SC / T-02-SC / T-03-SC / T-04-SC | Zero new third-party packages added across all 4 plans (traced imports use only pre-existing hono, node:crypto, tsx, workspace packages); supply-chain surface unchanged this phase | operator (2026-07-08) | 2026-07-08 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-08 | 24 | 23 | 1 (medium, non-blocking) | gsd-security-auditor (opus, ASVS L1, block_on: high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed (no open threat at or above `high`)
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-08 (with one non-blocking medium open threat T-01-06 + hardening notes recommended before public-internet deployment)
