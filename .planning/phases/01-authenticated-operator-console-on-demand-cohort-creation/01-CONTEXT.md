# Phase 1: Authenticated Operator Console + On-Demand Cohort Creation - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

An authenticated operator logs into a protected console and creates, configures, and advertises a cohort on demand, replacing the boot-time `while (running)` auto-advertise loop (`packages/service/src/demo-server.ts:245`, today the only thing that brings a cohort into existence). This is the first phase with a mutating operator surface, so operator authentication (HOST-01) ships with it. The full lifecycle (co-sign, anchor, resolve) still completes for an operator-advertised cohort, proven by an automated e2e.

**Requirements:** HOST-01 (operator auth), SVC-01 (create/configure on demand), SVC-02 (advertise into a per-service directory).

**In scope:** operator login (server-enforced), an operator console distinct from the anonymous participant surface, on-demand cohort create/configure (beacon type, threshold, capacity; active network shown), two-step create-draft-then-advertise, a queryable per-service directory listing, a basic operator cohort list, removal of the auto-advertise loop, and a minimal public status surface.

**Out of scope (later phases):** participant browse-and-pick join (Phase 2); participant submit/co-sign/track/resolve rewiring (Phase 3); rich live cohort monitoring (Phase 4); operator open/close/finalize + pause/cancel + reconfigure + runtime network-switching + draft editing (Phase 5); stranger-to-stranger e2e + systematic booth/attendee framing retirement (Phase 6).
</domain>

<decisions>
## Implementation Decisions

### Architecture: split question (resolved)
- **D-01:** **Experience split inside ONE same-origin deployment - NOT a full two-app split.** Keep the single same-origin service process. The operator console is a distinct, login-gated front-end (its own route and/or bundle); the participant surface stays anonymous/public at the service origin. There is NO second deployable and NO `btcr2-aggregation-participant` app.
- **D-02 [informational]:** A full two-app split (separate participant + service apps discovering each other over HTTP/REST) was explicitly considered and **rejected for this milestone.** (Tagged informational: this is a rejected alternative with no build target, so no plan covers it; see D-01 for what was built instead.) Rationale (unanimous, high-confidence multi-lens analysis): the participant is architecturally a **client** (`HttpClientTransport`, outbound fetch/SSE, no routes, no `listen`), not a server; a full split would force CORS onto every route + the hand-rolled SSE path, need a second deployable, break "one image, any network," and supersede ADRs 0003/0005/0014 for **zero v1 requirement coverage**, while pulling deferred v2 scope (PMG-01) forward. The one genuine win a real split unlocks (an independently-audited single participant client that removes the operator from the participant's trusted computing base) is a **v2 trust upgrade**; the experience split keeps that door open. See Deferred Ideas.
- **D-03:** This supersedes ADR 0004's "dashboard is public read-only telemetry" posture and warrants a **new operator-auth ADR** (author during planning/execution).

### Operator authentication (HOST-01)
- **D-04:** **App-level auth at the one same-origin service, enforced SERVER-SIDE** in the HTTP adapter (`packages/service/src/hono-adapter.ts`). The client-side tab toggle (`App.tsx:21`) is never access control.
- **D-05:** **Credential = operator-chosen password** set via env at boot (e.g. `OPERATOR_PASSWORD`). Typed on a login screen, compared server-side with a **constant-time** check, **never logged**.
- **D-06:** **Login issues an httpOnly session cookie.** Operator routes require a valid session. Session has a **configurable TTL** (sensible default ~24h) and an **explicit logout that invalidates the session server-side** (server tracks sessions, so logout truly kills it).
- **D-07:** **Fail-closed default:** if no operator credential is set at boot, the process **still boots and serves the public participant surface, but the operator console + all mutating/operator-telemetry routes are DISABLED**, with a **loud boot warning** (mirrors the ADR 0010 mainnet loud-boot-warning pattern). No credential = no operator access; never open-by-default.
- **D-08:** **Gated vs anonymous route split.** Gated (operator-only): the console, the mutating cohort routes (create/advertise), and the live coordinator/monitoring telemetry (`/dashboard/events`-class). Anonymous/public: the participant surface, the protocol advert channel (`/v1/adverts`), the directory listing (below), `/resolve/*`, `/cas/*`, `/v1/config`. Exact route inventory is for research/planning.

### Public view
- **D-09:** An anonymous visitor sees the **participant experience + a minimal public status** (service up, active network, open-cohort count). The count reads from the directory listing (D-14). The detailed live coordinator/monitoring feed stays operator-gated.

### Cohort create surface (SVC-01)
- **D-10:** **Network = selectable but ONE active network at a time** (config-driven allow-set, nothing hardcoded; NO simultaneous multi-network). Phase 1's create form uses/displays the service's **active** network. This honors the config-driven-network constraint, so **no superseding ADR is needed.** (Operator-driven runtime switching of the active network without restart is deferred to Phase 5. True simultaneous multi-network is deferred; see Deferred Ideas.)
- **D-11:** **Roster = capacity-only for the MVP.** The create form exposes beacon type (CAS/SMT), n-of-n threshold, and capacity/max-seats. Roster/pre-provisioning (baked-genesis, ADR 0012) is **deferred** and folds in later behind the clean core.
- **D-12:** **Two-step create then advertise.** The operator creates+configures an **unadvertised draft**, reviews it, then **explicitly advertises** to publish it into the directory. Clean SVC-01 (create) vs SVC-02 (advertise) split; sets up Phase 5's paused/unadvertised state.
- **D-13:** **Draft management depth = create, advertise, discard.** The operator can create a draft, advertise it, and discard an un-advertised draft. **Editing** a draft's config and **canceling** an already-advertised cohort are Phase 5.

### Directory + console
- **D-14:** **Build the read-side directory listing in Phase 1** (a data model + a queryable GET endpoint of open cohorts). Success criterion 3 ("appears as a joinable entry in the directory") is then directly provable, and the public open-cohort count (D-09) has a source. Phase 2's browse UI consumes this endpoint.
- **D-15:** **Directory derives from the live advertised-cohort set** the runner broadcasts on `/v1/adverts` - **one source of truth, no duplicate operator-written list.** Matches the single-process in-memory model; the directory cannot drift from what is actually advertised.
- **D-16:** **Phase 1 console shows a basic cohort list** (draft vs advertised, with basic fields: network, beacon type, seats/capacity, state) so the operator can confirm an advertise worked. **Rich live monitoring** (members, submissions, co-sign progress, anchor status) stays in **Phase 4**.

### Auto-advertise loop + Phase 1 lifecycle proof
- **D-17:** **Remove the `while (running)` auto-advertise loop entirely.** Operator on-demand creation becomes the ONLY way a cohort comes into existence; a fresh self-hosted service advertises nothing until the operator logs in and creates one. `demo-server.ts` boot restructures around this (also adds the D-07 fail-closed credential check + warning).
- **D-18:** **Phase 1 proves the full lifecycle via an automated e2e** (operator creates+advertises; headless participants join, co-sign, anchor, resolve - satisfying success criterion 4). The in-process **fillers/headless participants become a dev+test-only aid, default-off in production** - not a shipped runtime cohort driver.

### Cohort close trigger (Phase 1 boundary)
- **D-19:** **Auto-trigger co-sign** when a cohort reaches capacity (n-of-n full) or min-participants + TTL/phase timeout (reuse today's `minParticipants`/`cohortTtlMs`/`phaseTimeoutMs` machinery). No new operator lifecycle control in Phase 1; operator open/close/finalize is **Phase 5**.

### Framing
- **D-20:** New Phase 1 code (operator console, routes, restructured boot) uses **clean "operator/service/aggregator" framing**, not "booth/attendee." The **systematic** retirement sweep of existing booth/attendee framing across the codebase is Phase 6 (HOST-03); do not do the full sweep now, but do not introduce new booth framing.

### Claude's Discretion
Left to research/planning (implementation-level, not vision calls): the exact operator-route inventory; password hashing vs constant-time raw compare specifics and cookie flags (SameSite/Secure); the precise directory-listing endpoint path/shape (DTO fields); create-form field defaults and validation; how `demo-server.ts` restructures once the loop is gone; whether the operator console is a separate route in one bundle vs a separate bundle (front-end expression of the same server-enforced boundary); the operator console URL (deferred to the UI phase); the exact content/wording of the new auth ADR.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap (this milestone)
- `.planning/PROJECT.md` - two-sided self-hostable North Star, constraints (config-driven network; no unauthenticated mutating/control surface; single-box self-host), Key Decisions.
- `.planning/REQUIREMENTS.md` - HOST-01, SVC-01, SVC-02 (v1); PMG-01/DUR-01/OACC-01 (v2 deferred); Out of Scope table (federated registry, invite-only discovery, multi-instance).
- `.planning/ROADMAP.md` - Phase 1 goal + success criteria (esp. criterion 4: lifecycle still completes for an operator-advertised cohort); phase boundaries 2-6.

### Architecture + topology (do not violate; a full split would supersede these)
- `docs/adr/0003-same-origin-topology.md` - one origin/port serves API + SPA, no CORS. The auth split lives inside this.
- `docs/adr/0004-dashboard-sse-telemetry-channel.md` - the current read-only public telemetry. **This phase supersedes its public-read-only posture** (new auth ADR).
- `docs/adr/0005-bind-globalthis-fetch-in-browser.md` - browser base URL = `window.location.origin` (why the participant is same-origin, not cross-origin).
- `docs/adr/0006-keep-p2p-defer-trusted-coordinator-app.md` - the reserved trusted-coordinator variant; do NOT conflate a "btcr2-aggregation-service" split with that reserved decision.
- `docs/adr/0014-deployment-topology.md` - single-box, one process, one image-any-network; `HOST`/`PORT`/env boot config the new operator credential joins.

### Guard-rail + onboarding patterns to mirror / defer
- `docs/adr/0010-mainnet-guard-rails.md` - the loud-boot-warning + layered-opt-in pattern to mirror for the D-07 fail-closed credential warning.
- `docs/adr/0012-baked-genesis-and-genesis-store.md` - roster/pre-provisioning machinery; **deferred** in Phase 1 (D-11), fold in later.

### Codebase maps (analysis 2026-07-07)
- `.planning/codebase/ARCHITECTURE.md` - component/route map, data flow, the "Coordinator tab looks like an admin console but isn't" anti-pattern.
- `.planning/codebase/CONCERNS.md` - the top-two blockers this phase fixes (no auth; single non-operator-controllable advertise loop) with exact file refs; the "auth must ship paired with its negative test" note.
- `.planning/codebase/CONVENTIONS.md` - house code style, naming, import/`.js`-extension rules, comment-density expectation.

### Key source files this phase reshapes
- `packages/service/src/hono-adapter.ts` - sole HTTP mount point; where auth middleware + new operator routes + the directory GET endpoint land.
- `packages/service/src/demo-server.ts` - remove the advertise loop (`:245`), restructure boot, add fail-closed credential check + warning.
- `packages/service/src/index.ts` - `createService` factory + side-effect wiring; per-service in-memory state (drafts/directory derive from here).
- `packages/web/src/App.tsx` - the two-tab anonymous shell to restructure into a gated operator console + anonymous participant experience.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `runner.advertiseCohort(cohortConfig)` (via `createService`): already produces a `cohortId` + `completion` promise. Phase 1 gives it an **operator-driven caller** (the advertise action) instead of the loop; the draft->advertise step maps onto configuring the `cohortConfig` then calling this.
- `/v1/adverts` SSE (protocol advert channel) + the live advertised-cohort set: the **single source of truth** the new directory listing derives from (D-15). Stays public.
- `createParticipant` (`packages/participant/src/index.ts`): the isomorphic client reused as the **headless e2e/filler** driver that proves the Phase 1 lifecycle (D-18).
- Dashboard SSE bridge (`packages/service/src/dashboard-sse.ts`) + `/dashboard/events`: becomes **operator-gated** telemetry; graduates into the Phase 4 monitoring view.
- Network registry (`packages/shared/src/networks.ts`: `resolveNetwork`, `assertNetworkAllowed`, `toNetworkConfigDTO`, `DEFAULT_NETWORK`): the **active-network + allow-set** source for D-10; `/v1/config` already serves the active network to the browser.
- Shared cohort config builder (`packages/shared/src/index.ts`): backs the create-form -> `cohortConfig` mapping.

### Established Patterns
- **Same-origin, sans-I/O transport + one adapter:** all HTTP mapping is in `hono-adapter.ts` - the single place auth middleware + new routes belong.
- **Config-driven network (never hardcoded):** resolved once at boot, served via `/v1/config`; D-10 keeps a single active network so this holds.
- **Opt-in behind loud guard rails:** mainnet/live gate with a loud boot banner (ADR 0010) - mirror for the D-07 fail-closed credential warning.
- **Fire-and-forget side-effect listeners** with `.catch()` logging; **manual regex/shape guards** at each untrusted HTTP boundary; **module-prefixed `console.*`** logging (`[demo]`, `[service]`, `[adapter]`). Match these.
- **Per-`createService` in-memory state** (closures, not module singletons) so multiple services in one process (tests) do not share state - drafts/directory follow this.

### Integration Points
- `hono-adapter.ts`: add session/auth middleware; mount gated operator routes (create/advertise/discard, operator cohort list) + the public directory GET endpoint + the public status.
- `demo-server.ts`: delete the advertise loop; add the boot-time operator-credential read + fail-closed warning; keep listening + graceful shutdown.
- `App.tsx` + `packages/web/src/stores/`: split into a gated operator console (new operator store/route) and the existing anonymous participant experience; add a login screen and a minimal public status element.
- `packages/service/src/static-site.ts`: still serves the one SPA (which now expresses both experiences).

### Test coverage note (from CONCERNS.md)
- Auth **must ship paired with its negative test**: assert operator routes reject no/invalid session and that anonymous callers cannot reach operator-only telemetry or mutating routes. Add the removed-loop / on-demand-advertise e2e that drives create->advertise->co-sign->anchor->resolve.
</code_context>

<specifics>
## Specific Ideas

- The owner probed hard on whether to split into two whole client/server apps (`btcr2-aggregation-participant` + `btcr2-aggregation-service`) that find each other over HTTP/REST. Resolved to the **experience split** (D-01/D-02): one deployment, two front-ends, server-enforced boundary. The owner confirmed the **service-side has its own dedicated operator UI** (login + config + management), just not its own separate deployment.
- Operator console URL (e.g. `/operator` vs `/admin`) intentionally **left to the UI phase**.
</specifics>

<deferred>
## Deferred Ideas

- **v2 - full two-app split for the audited-single-client trust upgrade:** an independently-audited participant client removes the operator from the participant's trusted computing base. Ties to ADR 0006's trusted-coordinator variant and PMG-01. Real, but not a v1 requirement.
- **v2 - roaming/wallet-like participant client** across many services (PMG-01); this is where cross-origin/CORS becomes intrinsic and a real split earns its cost.
- **Later - true simultaneous multi-network cohorts:** cohorts on different networks live at once (multi-connection, per-cohort browser derivation, `/v1/config` as a set, per-cohort mainnet guards). Supersedes the single-network constraint; needs its own ADR.
- **Later - roster/pre-provisioning** (baked-genesis, ADR 0012) folded into the create form behind the clean core.
- **Phase 5 - operator lifecycle control:** open/close/finalize, pause/cancel advertising, reconfigure cohort shape, runtime switching of the active network without restart, draft editing, canceling an advertised cohort.
- **Phase 4 - rich live cohort monitoring** (members, submissions, co-sign progress, anchor status) built from the gated telemetry.
- **Phase 6 - systematic booth/attendee framing retirement** (HOST-03); new Phase 1 code already uses clean framing.
- **UI phase - operator console URL.**

None of these are Phase 1 scope; discussion stayed within the phase boundary.
</deferred>

---

*Phase: 1-authenticated-operator-console-on-demand-cohort-creation*
*Context gathered: 2026-07-08*
