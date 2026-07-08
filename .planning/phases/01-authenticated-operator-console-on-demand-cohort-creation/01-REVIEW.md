---
phase: 01-authenticated-operator-console-on-demand-cohort-creation
reviewed: 2026-07-08T21:47:47Z
depth: deep
files_reviewed: 19
files_reviewed_list:
  - docs/adr/0015-operator-authentication.md
  - e2e/operator-cohort.ts
  - packages/service/src/demo-server.ts
  - packages/service/src/hono-adapter.ts
  - packages/service/src/index.ts
  - packages/service/src/operator-auth.spec.ts
  - packages/service/src/operator-auth.ts
  - packages/service/src/operator-boot.spec.ts
  - packages/service/src/operator-cohorts.spec.ts
  - packages/service/src/operator-cohorts.ts
  - packages/web/src/App.tsx
  - packages/web/src/components/operator/CreateCohortForm.tsx
  - packages/web/src/components/operator/LoginPanel.tsx
  - packages/web/src/components/operator/OperatorCohortList.tsx
  - packages/web/src/components/operator/OperatorConsole.tsx
  - packages/web/src/components/operator/PublicStatus.tsx
  - packages/web/src/lib/operator.ts
  - packages/web/src/stores/operator.ts
  - packages/web/src/ui/primitives.tsx
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-07-08T21:47:47Z
**Depth:** deep
**Files Reviewed:** 19
**Status:** issues_found

## Summary

This phase introduces the first authentication surface (operator sessions, constant-time
password check, gated mutating routes) and the on-demand cohort create/advertise control
plane. I reviewed the auth core, the HTTP mount ordering, the cohort surface, the demo-server
boot wiring, and the browser console adversarially, with focus on the security invariants
called out in the task.

The core security properties hold up well under tracing:

- **Constant-time compare is correct** (`passwordMatches` SHA-256s both sides before
  `timingSafeEqual`, so no length or timing oracle).
- **Cookie flags are correct**: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age`, and
  `Secure` defaulting on.
- **Session fixation is impossible** (id is CSPRNG server-minted, never accepted from client).
- **Fail-closed boot is correct**: with no `OPERATOR_PASSWORD` (or an empty one) the operator
  surface and gated telemetry do not mount; the public participant surface still serves.
- **No mutating operator route is reachable without a session.** I traced Hono's
  registration-ordered middleware chain (`hono-adapter.ts:299-357`): `requireSameOrigin` and
  `requireOperator` are both registered on the `/v1/operator/*` prefix before every gated
  route, and login is the only pre-guard route (intentionally public). Logout/session/cohort
  create/list/discard/advertise all inherit both guards.
- **Hermetic zero-chain default is preserved**: enabling the operator surface does not enable
  `live`/`bitcoin`; advertised cohorts still sign the fixture beacon tx.

No BLOCKER-class auth bypass, injection, secret leak, or data-loss defect was found. The
findings below are correctness and robustness gaps, the most consequential being the login
throttle's dependence on `socket.remoteAddress` under the project's own documented
reverse-proxy topology.

## Warnings

### WR-01: Login throttle, denial logging, and CSRF host-compare trust the raw socket peer under a reverse proxy

**File:** `packages/service/src/operator-auth.ts:151-153` (`clientKey`), `120-148` (throttle), `184-204` (`requireSameOrigin`)
**Issue:**
`clientKey` derives the throttle/log key from `c.env.incoming.socket.remoteAddress` only, with
no `X-Forwarded-For` / trusted-proxy handling. ADR 0014 (referenced throughout this phase)
deploys the service behind a TLS-terminating reverse proxy, so `remoteAddress` is the *proxy's*
address for every request. Consequences under the intended deployment:

1. The per-client fixed-window throttle collapses to a single shared key. Any unauthenticated
   remote party can burn the 10-attempts/5-min window; once `check()` returns false, the
   *legitimate operator's* correct-password login also returns 429 (the throttle runs before
   the password compare in `loginHandler`, `operator-auth.ts:230-233`). By failing 10x every
   5 minutes an attacker can keep the operator perpetually locked out of the sole control
   plane - an unauthenticated availability attack on operator sign-in.
2. Per-attacker brute-force accounting is defeated (distinct attackers share one counter with
   the operator), so the "belt-and-suspenders" brute-force bound described in ADR 0015 does
   not actually bind per client.
3. `[operator] failed login attempt from ${key}` and the throttle log record the proxy IP, not
   the real client, undermining the audit value of the denial logs.

Relatedly, `requireSameOrigin` compares `new URL(origin).host` against the raw `Host` header
(`operator-auth.ts:189,196`). If the proxy forwards its internal host (or the public host lands
in `X-Forwarded-Host` instead of `Host`), a legitimate same-origin mutating request 403s. This
is masked today only because `SameSite=Strict` is the real CSRF defense, but the check is
fragile against a common proxy configuration.

**Fix:** Introduce an explicit trusted-proxy switch (env, off by default) and, when enabled,
derive the client identity from the right-most trusted `X-Forwarded-For` hop for the throttle
key and denial logs; likewise honor `X-Forwarded-Host` (only when behind the trusted proxy) in
the same-origin compare. Keep raw `remoteAddress` for the direct-bind case. At minimum, document
that the throttle is per-source-IP-as-seen and that a shared-IP proxy turns it into a global
window, and consider not returning 429 to a request that presents a valid session cookie.

### WR-02: Malformed `OPERATOR_SESSION_TTL_MS` yields non-expiring sessions

**File:** `packages/service/src/demo-server.ts:211-213`, `packages/service/src/index.ts:322`, `packages/service/src/operator-auth.ts:77-95`
**Issue:**
`operatorSessionTtlMs` is parsed as `process.env.OPERATOR_SESSION_TTL_MS ? Number(...) : undefined`.
A non-numeric value (e.g. `OPERATOR_SESSION_TTL_MS=1h`) yields `NaN`. `NaN` is not nullish, so
`opts.operatorSessionTtlMs ?? 24h` in `index.ts:322` does **not** backstop it. The store then sets
`expiresAt = Date.now() + NaN = NaN`, and `isValid` checks `Date.now() > rec.expiresAt`, which is
always `false` for `NaN` - so the session **never expires server-side**. The cookie `Max-Age`
becomes `Math.floor(NaN/1000) = NaN`, which browsers treat as a session cookie (no persisted
expiry). The net effect of a silent typo is to defeat the session-expiry guarantee (a leaked
session id stays valid until process restart), the opposite of fail-safe.
**Fix:** Validate the parsed number and fall back to the default on `NaN`/non-positive:
```ts
const parsed = Number(process.env.OPERATOR_SESSION_TTL_MS);
const operatorSessionTtlMs =
  opts.operatorSessionTtlMs ?? (Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
```
and/or guard in `index.ts`: `const ttl = Number.isFinite(opts.operatorSessionTtlMs) && opts.operatorSessionTtlMs! > 0 ? opts.operatorSessionTtlMs! : 24*60*60*1000;`

### WR-03: Advertise failures produce no visible feedback and are cross-wired into the create form's error slot

**File:** `packages/web/src/stores/operator.ts:159-179`, `packages/web/src/components/operator/OperatorCohortList.tsx:79-107`, `packages/web/src/components/operator/CreateCohortForm.tsx:100-102`
**Issue:**
On an advertise failure the store writes the message to `formError` (`operator.ts:174,177`), but
`OperatorCohortList` never renders `formError` - only `advertiseMessage` (the success banner).
`formError` is rendered exclusively by `CreateCohortForm`. So a failed advertise either shows
nothing near the affected row, or surfaces confusingly as an error inside the unrelated "Create a
cohort" form. The row's button silently re-enables (`isAdvertising` goes false) with no explanation.
Server-side, the advertise route (`hono-adapter.ts:353-356`) does not wrap
`operatorCohorts.advertiseDraft` in try/catch, so a synchronous throw from `runner.advertiseCohort`
becomes a bare Hono 500 rather than a structured JSON error the client can display.
**Fix:** Give advertise its own error field (e.g. `advertiseError`) rendered in `OperatorCohortList`
(near the row or in the list banner), not `formError`. Wrap the advertise route body in try/catch
returning a `502`/`500` JSON `{ error }` (mirroring the create route at `hono-adapter.ts:337-340`).

### WR-04: Operator's own advertised cohort vanishes from the console once signing starts

**File:** `packages/service/src/operator-cohorts.ts:53,188-210,274-286`
**Issue:**
`listCohorts()` derives its advertised entries from `directory()`, which filters to
`OPEN_PHASES = {Advertised, CohortSet, CollectingUpdates}` (`operator-cohorts.ts:53,196`). The moment
a cohort leaves those pre-signing phases (signing starts, or it completes/fails), it disappears from
both the public directory *and the operator's own list*. The operator loses all console visibility of
their in-flight cohort exactly when it becomes most interesting (co-signing), with no "signing"/"done"
state shown anywhere. This is defensible only because monitoring is deferred to Phase 4, but as
shipped the operator list is misleading (a cohort they advertised and that is actively signing simply
is not listed). At minimum this deserves an explicit note; ideally the operator list should retain
advertised cohorts through their terminal state rather than reusing the public open-phase filter.
**Fix:** Track advertised cohorts for the operator list independently of the public open-phase filter
(e.g. keep the enrichment entry and surface a `phase`/`state` beyond `advertised`), or explicitly
scope-document that operator cohort visibility past `CollectingUpdates` is Phase 4.

## Info

### IN-01: No upper bound on `threshold` / `capacity`

**File:** `packages/service/src/operator-cohorts.ts:151-163`
**Issue:** `validateDraft` enforces integer, `threshold >= 1`, and `capacity >= threshold`, but no ceiling.
An authenticated operator can create a cohort with `threshold`/`capacity` of, say, `1e9`, which flows into
`buildCohortConfig(threshold, ...)` and `maxParticipants`. It requires a valid session (self-inflicted), so
this is hardening, not a vulnerability.
**Fix:** Add a sane upper bound (e.g. `threshold <= capacity <= 100`) with a clear 400 message.

### IN-02: Expired sessions are evicted only lazily on read of the same id

**File:** `packages/service/src/operator-auth.ts:85-95`
**Issue:** `isValid` deletes an expired record only when that exact id is looked up again. The common browser
path self-heals (the SPA re-probes with the stale cookie and evicts it), but ids for browsers that stop probing
linger in the `Map` for the process lifetime. For a long-lived single-box service with many re-logins this is a
slow, bounded growth. There is no periodic sweep.
**Fix:** Optionally sweep expired entries on `create()`, or accept the lazy behavior and document it (single
operator, single box, restart clears).

### IN-03: `OPERATOR_COOKIE_SECURE` only recognizes exactly `'0'`; Secure-on-http silent logout is only documented

**File:** `packages/service/src/demo-server.ts:214-215`, `packages/web/src/stores/operator.ts:98-115,134-142`
**Issue:** Only the literal string `'0'` disables the Secure flag; `OPERATOR_COOKIE_SECURE=false`/`no` are
ignored (secure-by-default is the safe direction, so this is a footgun, not a hole). Separately, when Secure is
left on but the service runs over plain HTTP, the browser drops the cookie: login returns 200 (store sets
`auth: 'logged-in'`), but the follow-up `refreshCohorts`/actions 401. `refreshCohorts` swallows the failure
silently (`operator.ts:138-141`), so the console shows a "signed in" shell where every action fails without
explanation. Documented as Pitfall 2, but not detected at runtime.
**Fix:** Accept common boolean spellings for the env; detect a 401 on the post-login refresh and drop back to
`logged-out` with the Secure-cookie hint.

### IN-04: `null` JSON body to create-draft leaks a raw TypeError message as the 400 body

**File:** `packages/service/src/operator-cohorts.ts:151-152`, `packages/service/src/hono-adapter.ts:332-340`
**Issue:** A body of literal `null` (valid JSON) reaches `validateDraft(null)`, whose destructuring throws
`TypeError: Cannot destructure property 'beaconType' of 'null'...`. The route's catch surfaces `err.message`
verbatim as the 400 body. It is only reflected in a JSON response consumed by `fetch` (React escapes it, so no
XSS), but it exposes an internal JS error string instead of a clean validation message.
**Fix:** Guard for non-object bodies up front in `validateDraft` (`if (input == null || typeof input !== 'object') throw new Error('operator: expected a JSON object body')`).

### IN-05: Public unauthenticated mutating routes remain (pre-existing, out of this phase's scope)

**File:** `packages/service/src/hono-adapter.ts:262-289` (`/v1/ipfs/pin`), `463-493` (`/v1/tx/broadcast`)
**Issue:** These mutating POST routes remain unauthenticated. They predate this phase (participant surface,
ADRs 0010/0011), are body-limited, and default to the offline/no-op path, so they are consistent with the
documented "public by nature" participant surface rather than the operator control plane the CLAUDE hard rule
targets. Noted for completeness so a future reviewer does not assume this phase's auth work covers them.
**Fix:** None required for Phase 1; revisit if/when participant-side actions gain an auth model.

---

_Reviewed: 2026-07-08T21:47:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
