# Codebase Concerns

**Analysis Date:** 2026-07-07

## Tech Debt

**No authentication/authorization anywhere in the control plane (TOP CONCERN):**
- Issue: a grep across `packages/service/src`, `packages/web/src`, `packages/participant/src`, `packages/shared/src` for login/session/password/token/cookie/jwt/auth turns up only DID *transport bootstrap-authentication* (proving a sender controls a DID key, e.g. `packages/service/src/roster.ts:53`, `packages/service/src/index.ts:107,241,270-392`, `packages/service/src/genesis-capture.ts:7-96`). There is no operator login, no admin session, no API key, no cookie, and no role separation of any kind.
- Files: `packages/service/src/demo-server.ts` (boot-time env only), `packages/service/src/hono-adapter.ts` (all HTTP routes; `:189` explicitly notes the `/v1/config` route is "Read-only, unauthenticated, and always" served), `packages/web/src/App.tsx:1-86` (single anonymous SPA bundle, no login gate)
- Impact: the coordinator's *only* control surface is boot-time environment variables (`ALLOW_MAINNET`, `RECOVERY_KEY`, `port`, `host`, etc., see `packages/service/src/demo-server.ts:60-184`) plus OS-level process lifecycle (start the process / Ctrl+C to stop it). There is no way to authenticate as "the operator" once the process is running, and no way to distinguish an operator from any random visitor. The `Coordinator` tab in the web UI (`packages/web/src/App.tsx:7-11`, rendered via `DashboardView` at `packages/web/src/components/dashboard/DashboardView.tsx`) is pure read-only SSE telemetry (per ADR 0004, "dashboard-sse-telemetry-channel"), not an admin console, yet it ships in the exact same anonymous bundle as the `Participant` tab (`packages/web/src/App.tsx:59-73`) with a client-side `useState` tab toggle only. Any visitor to a self-hosted instance can click "Coordinator" and watch the live service feed for every cohort, with zero access control.
- Fix approach: before treating this as a "real self-hostable aggregator" (per the project's stated North Star, not a demo/booth), add an operator authentication layer (e.g. a bearer token or reverse-proxy basic-auth in front of `/v1/dashboard`-class routes) and split the SPA into an authenticated operator bundle vs. an anonymous participant bundle, or at minimum gate the dashboard route server-side.

**Cohort lifecycle has exactly one, non-operator-controllable driver:**
- Issue: `advertiseCohort` has a single caller in the entire codebase, inside an unconditional `while (running)` auto-advertise loop.
- Files: `packages/service/src/demo-server.ts:245` (the sole call site, inside the loop starting near `:222` per its "Long-lived booth: keep advert/inbox SSE alive between attendees" comment)
- Impact: there is no operator API or UI action to advertise a new cohort on demand, pause advertising, cancel an in-flight cohort, or change `minParticipants`/`fillers`/TTL after boot; every knob is a constructor option or env var read once at process start (`packages/service/src/demo-server.ts:15-90`). Operating this "for real" means restarting the process to change any cohort-shape parameter, and there is no way to temporarily halt onboarding without killing the whole service (dashboard + resolve + config routes all die with it).
- Fix approach: expose an authenticated operator control endpoint (start/stop/reconfigure advertising) decoupled from process lifecycle, once auth (above) exists to protect it.

**Demo/booth framing lingers in code comments despite the "real aggregator" goal:**
- Issue: multiple doc comments and log lines still describe the service as a conference "booth" for "attendees," not a durable public aggregator.
- Files: `packages/service/src/demo-server.ts:33` ("so one attendee walking away mid-flow cannot wedge the booth"), `:118-121` ("Long-lived demo coordinator... so the booth keeps accepting attendees"), `:222` ("Long-lived booth: keep advert/inbox SSE alive between attendees")
- Impact: no functional bug, but the framing mismatch is a signal that lifecycle/ops decisions (single-process, no auth, no pause control, throwaway recovery key default) were made for a supervised in-person demo, not an unattended public service. It is worth re-reading these comments when hardening ops.
- Fix approach: none required functionally; consider a documentation pass once auth/ops gaps close, so comments describe the actual deployment target (self-hosted public aggregator, ADR 0014) rather than a booth.

**Deferred: slim production Docker image:**
- Issue: `pnpm deploy --prod` prod-only slim variant is explicitly deferred; the current image does a wholesale workspace copy instead.
- Files: `docs/adr/0014-deployment-topology.md:63-64,80` ("A slim prod-only variant (`pnpm deploy --prod`) is deferred (see Consequences)")
- Impact: larger-than-necessary container images; slower pulls/builds and more surface area (dev dependencies, other packages' source) baked into the runtime image.
- Fix approach: adopt `pnpm deploy --prod` per-package once the workspace-symlink pruning issue noted in the ADR is worked around (see MEMORY: "pnpm-prune-breaks-workspace-symlinks").

**Deferred/flagged: upstream transport-auth follow-up (§4.1):**
- Issue: the x1/k1 transport-auth blocker was fixed upstream in the library (shipped as `@did-btcr2/method@0.51.0`), but ADR 0009 references a design spec (`docs/specs/x1-k1-transport-auth.md`) whose full follow-up scope is only partially covered by what shipped.
- Files: `docs/adr/0009-external-x1-onboarding.md:11-13` ("no HTTP auth path existed for EXTERNAL DIDs... the fix landed in the library (its ADR 066)")
- Impact: low, since the immediate blocker is resolved and CI covers the x1 paths (`e2e:x1`, `e2e:mixed`, `e2e:x1:negative` per project memory). Any residual scope in the upstream spec document is worth a re-read before extending onboarding further.
- Fix approach: re-read `docs/specs/x1-k1-transport-auth.md` against the shipped library API before any new onboarding model work.

## Known Bugs

**LATE_PUBLISHING counter-inflation on regtest (KEY double-publish):**
- Symptoms: `method@0.51.0` resolves a KEY DID's double-signal as a confirmed duplicate correctly, but the DID's `versionId` counter still inflates (observed at 3 on regtest instead of the expected 2), even though the DID must remain first-update-terminal.
- Files: `docs/adr/0013-regtest-ci-live-path-gate.md:40,148` ("`LATE_PUBLISHING` - the doubly-published DID must stay first-update-terminal"; "...unresolvable (`LATE_PUBLISHING` against the inflated counter). A follow-up...")
- Trigger: publish a KEY DID's first update twice against the aggregate beacon on a live/regtest chain, then resolve.
- Workaround: none in this repo; this is an upstream library (`@did-btcr2/method`) behavior. The CI live-path gate (`e2e:live:regtest`) exercises this path and the ADR notes it as a stale row in ADR 0007's "Both -> Error" resolution table.

## Security Considerations

**Unauthenticated coordinator on a public host, combined with real-money mainnet paths:**
- Risk: the app is explicitly designed to be self-hosted "over the public internet" (per project North Star), yet the coordinator process has zero request-level authentication (see Tech Debt above). On mainnet, the coordinator mints real Bitcoin addresses/DIDs the browser invites the controller to fund, and (under `LIVE=1`) relays raw signed transactions via `/v1/tx/broadcast`.
- Files: mainnet guard code: `packages/service/src/demo-server.ts:60-90,161-184` (`ALLOW_MAINNET`/`allowMainnet`, `RECOVERY_KEY`/`recoveryKey`, boot-time real-funds banner); `packages/service/src/index.ts:167,293-302` (`assertNetworkAllowed` throws on a mainnet config without explicit opt-in); `docs/adr/0010-mainnet-guard-rails.md` (full design)
- Current mitigation: layered explicit opt-ins exist and are verified by tests (`packages/service/src/live-tx.spec.ts:214-233` - a live mainnet run throws without `allowMainnet`, succeeds when set; `packages/service/src/config.spec.ts:32` - client sees the mainnet flag to guard before live actions). A throwaway `RECOVERY_KEY` is the default (funds-loss mode is called out loudly at boot per `demo-server.ts:78-90,183-184`) and an operator must set `RECOVERY_KEY` explicitly before funding any real cohort beacon.
- Recommendations: even with these guard rails, an unauthenticated public dashboard/control-plane means anyone can watch every mainnet cohort's live state, and (per the "one auto-advertise loop, no pause control" gap above) an operator cannot halt onboarding without killing the process. Before recommending self-hosting on mainnet for real value, add request-level auth to at least the dashboard/telemetry and any future control endpoints.

**Public secrets baked into the live e2e fixtures:**
- Risk: `e2e/live-broadcast-cohort.ts` uses fixed participant/recovery secrets (checked into this public repo) so the beacon address stays stable for manual faucet funding during development.
- Files: `docs/adr/0010-mainnet-guard-rails.md` ("Public secrets in the live e2e" section, listing `e2e/live-broadcast-cohort.ts`)
- Current mitigation: these fixtures are documented as regtest/testnet-only and gated behind explicit opt-in flags (`LIVE=1`); no code path uses them for mainnet by default.
- Recommendations: if these fixture secrets are ever reused against mainnet (misconfiguration), the ADR notes the funded beacon becomes anyone-can-spend immediately (n-of-n key path reconstructable from public secrets) and the recovery leaf becomes sweepable after `recoverySequence` blocks. Keep this fixture path hard-blocked from mainnet, ideally with a runtime assertion, not just documentation.

## Fragile Areas

**`packages/service/src/index.ts` (480 lines) — central request-authorization + genesis-staging logic:**
- Files: `packages/service/src/index.ts` (largest file in `packages/service/src`)
- Why fragile: this file threads together DID transport bootstrap-auth, BAKED-genesis staging/promotion (`:251-392`), and mainnet network-allow enforcement (`:293-302`) in one large module with subtle ordering dependencies (e.g. `:380-392` notes a mismatch after bootstrap-auth "should never happen" but is still defensively checked). Changes to onboarding models (KEY/EXTERNAL/BAKED) touch this file's control flow directly.
- Safe modification: read the full onboarding-model comments in this file plus `docs/adr/0009`, `0012` before changing auth/staging order; the roster and genesis-capture modules (`packages/service/src/roster.ts`, `packages/service/src/genesis-capture.ts`) have matching defensive comments that assume this file's invariants hold.
- Test coverage: covered by `packages/service/src/roster.spec.ts` and the e2e onboarding suites (`e2e:x1`, `e2e:mixed`, `e2e:x1:negative`, `e2e:baked`), but no unit spec file specifically targets `index.ts`'s staging/promotion logic in isolation.

**Cohort lifecycle is single-process, in-memory, and has one advertise loop:**
- Files: `packages/service/src/demo-server.ts:222-260` (the `while (running)` loop)
- Why fragile: cohort state and the advertise loop live only in the running Node process; there is no persistence, no multi-instance coordination, and no operator lever to intervene short of restarting the process. A crash mid-cohort loses in-flight cohort state entirely (fixture and real cohorts alike, subject to per-cohort TTL/timeout as the only self-healing mechanism, per `demo-server.ts:26-34`).
- Safe modification: any change to cohort advertise cadence, TTL, or filler behavior needs to be verified against the full onboarding e2e matrix, since it is the only place cohort shape is configured.
- Test coverage: exercised by hermetic e2e suites (`e2e`, `e2e:smt`, `e2e:persist`) and the regtest-live CI job, but no test simulates process crash/restart mid-cohort.

## Performance Bottlenecks

Not detected as an active concern from source inspection; no profiling data or reported slow paths found. The one documented near-miss is fee estimation on mainnet (`packages/service/src/tx.ts:32-34`): "the run is either doomed or forced to burn most of the UTXO as fee... on mainnet, a dynamic fee estimator can still need" more headroom than the current static floor provides. This is a correctness/cost risk on live mainnet runs, not a throughput bottleneck.

## Scaling Limits

**Single-process, single-instance coordinator:**
- Current capacity: one Node process handles all cohorts, all dashboard SSE subscribers, and all HTTP routes; state is in-memory only (see Fragile Areas above).
- Limit: no horizontal scaling path exists; running two coordinator instances behind a load balancer would split cohort state and break correctness (participants routed to different instances would never see each other).
- Scaling path: not addressed anywhere in the current ADRs; would require externalizing cohort/session state (e.g. shared store) before any multi-instance deployment, which is out of scope for the current self-host-a-single-box model (ADR 0014).

## Dependencies at Risk

Not detected. The project consumes published `@did-btcr2/*` packages (method@0.51.0, aggregation@0.4.0) with caret ranges per project memory; no abandoned or deprecated dependency was found during this pass. Re-check `package.json` ranges before major library bumps.

## Missing Critical Features

**No operator authentication or role-based access control:**
- Problem: covered fully under Tech Debt/Security above; restated here because it blocks the stated "real self-hostable aggregator" goal, not just a nice-to-have.
- Blocks: safely running a public instance where the operator dashboard and any future control endpoints are protected from the general public; currently anyone with the URL sees the full coordinator telemetry feed.

**No on-demand cohort/lifecycle control API:**
- Problem: covered under Tech Debt above (single auto-advertise loop, boot-time-only config).
- Blocks: pausing onboarding, canceling a stuck cohort, or reconfiguring cohort shape without a full process restart.

## Test Coverage Gaps

**No test exercises the "unauthenticated dashboard visible to any visitor" scenario as a negative/security case:**
- What's not tested: there is no test asserting that dashboard/telemetry routes require any credential (because none is implemented), and no test asserting the SPA does not leak coordinator-only data to a participant-role user (because there is no role distinction).
- Files: `packages/service/src/hono-adapter.ts` (route definitions), `packages/web/src/App.tsx`, `packages/web/src/components/dashboard/DashboardView.tsx`
- Risk: if authentication is added later, regressions could silently reopen the dashboard to unauthenticated access without any test catching it.
- Priority: High, once auth work begins (should ship paired with the fix, not before).

**No test simulates coordinator process crash/restart mid-cohort:**
- What's not tested: recovery/cleanup behavior when the single Node process dies while cohorts are in-flight (relevant given the in-memory-only, single-process cohort state noted under Scaling Limits).
- Files: `packages/service/src/demo-server.ts`
- Risk: unknown behavior on real-world crashes (e.g. OOM, container restart) for participants mid-signing; TTL/timeout mechanisms are the only safety net and are untested against an abrupt process death specifically.
- Priority: Medium, most relevant once the app is running unattended on a public host.

---

*Concerns audit: 2026-07-07*
