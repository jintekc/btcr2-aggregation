# btcr2-aggregation

## What This Is

A self-hostable, **two-sided** reference application for `did:btcr2` aggregation over HTTP/REST. Each self-hosted **service** is a node whose operator sets up, advertises, and manages cohorts; each **participant** points a client at a service's URL, discovers the cohorts it advertises, joins one, and takes part (submits a DID update, co-signs the n-of-n MuSig2 beacon, tracks the anchor, and resolves the result). It is meant to be something anyone can stand up and run as a real aggregator over the public internet, and anyone else can join as a participant - not a supervised demo.

This project is being onboarded into a structured workflow to **course-correct**. Built with an unstructured flow, the delivered app drifted into a single hardwired demo happy-path plus a read-only telemetry tab, rather than the intended two-sided, self-hostable product. The full protocol lifecycle (advertise -> join -> submit -> co-sign -> anchor -> resolve) genuinely works end to end and is real, salvageable value; the goal now is to build the two-sided management and discovery experience on top of it and make it truly self-hostable.

## Core Value

**A stranger can self-host a real aggregation service that advertises cohorts, and another stranger can point a participant at that service's URL, browse its cohorts, join, co-sign, and resolve - a genuinely two-sided, self-hostable product, not a demo.** If everything else is stripped away, this two-sided self-hostable loop is the thing that must work.

## Requirements

### Validated

<!-- Shipped and confirmed working. This is the salvageable base the realignment builds on (M1-M4, all merged to main). -->

- ✓ Full cohort lifecycle works end to end over real HTTP/SSE: advertise -> join -> submit -> n-of-n MuSig2 co-sign -> anchor -> resolve (existing)
- ✓ Isomorphic participant client, identical in Node and in-browser (existing)
- ✓ Config-driven Bitcoin network (mutinynet default; signet/testnet/regtest/mainnet selectable), served to the browser at runtime via `GET /v1/config`, never hardcoded (existing)
- ✓ Same-origin topology: one process serves both the REST API and the SPA (existing, ADR 0003)
- ✓ Beacon-type parameterization: CAS and SMT beacons (existing)
- ✓ Server-driven resolve (`GET/POST /resolve/:did`) plus a content-addressed artifact store (`GET /cas/*`) (existing)
- ✓ Live on-chain broadcast/anchor as an opt-in, behind layered mainnet guard rails (existing, ADR 0010)
- ✓ Onboarding models: KEY self-bootstrap, EXTERNAL/x1 sidecar, and baked-genesis (existing, ADRs 0009/0012)
- ✓ Opt-in in-browser IPFS publish plus coordinator pinning (existing, ADR 0011)
- ✓ Self-host deploy tooling (Dockerfile + docker-compose + `docs/DEPLOY.md`) and a regtest CI live-path gate (existing, ADRs 0013/0014)

### Active

<!-- The realignment toward the intended two-sided, self-hostable product. Hypotheses until shipped and validated. -->

Service side (operator experience):
- [ ] Operator can **create and configure** a cohort on demand (beacon type CAS/SMT, network, n-of-n threshold, capacity/roster) - not only via a boot-time auto-advertise loop
- [ ] Operator can **advertise/publish** a cohort into a per-service directory so participants can find and join it
- [ ] Operator can **monitor** members and submissions (who joined, pending updates, co-sign progress, anchor status)
- [ ] Operator can **run aggregation and manage cohort lifecycle** (open -> close -> finalize; pause/cancel/reconfigure) without restarting the process

Participant side (attendee experience):
- [ ] Participant can **discover and browse** a service's advertised open cohorts by pointing at that service's URL (per-service directory)
- [ ] Participant can **join** an advertised cohort by choice (browse-and-pick), potentially across more than one cohort
- [ ] Participant can **submit a DID update and co-sign** the cohort's beacon (wire the existing signing flow into the discover -> join path)
- [ ] Participant can **track status and resolve** the updated DID once it is anchored

Self-hostable for real:
- [ ] The operator/control and telemetry surface is **protected by operator authentication** (today the only control lever is env vars + Ctrl+C; the audit flags "no auth anywhere" as the top blocker to a real public instance)
- [ ] The full two-sided flow is **smooth end to end for two strangers** (a stranger operator plus a stranger participant complete the loop without insider knowledge)
- [ ] The product **presents as a real aggregator**, not a booth/demo (retire the lingering "booth"/"attendee" framing in code, UI, and docs)

### Out of Scope

<!-- Explicit boundaries with reasoning, to prevent re-adding. -->

- Federated / cross-service cohort registry (a shared marketplace across operators) - discovery is deliberately **per-service** so each service stays a self-contained, self-hostable node with no shared infrastructure to run.
- Invite-link / join-code-only discovery - the chosen model is a public per-service directory participants browse.
- Horizontal scaling / multi-instance coordinator behind a load balancer - the model is single-box self-host (ADR 0014); multiple instances would split in-memory cohort state and break correctness.
- Durable cohort state across process restarts / crash recovery - deferred; single-process in-memory is acceptable for now, revisit when running unattended on a public host.
- Slim production Docker image (`pnpm deploy --prod`) - deferred (ADR 0014); worth revisiting once the workspace-symlink pruning issue is worked around.
- Changing the `@did-btcr2/*` protocol/library itself - this is a reference **consumer** application (wiring, UX, and product), not a fork of the aggregation library; consume the published packages.

## Context

- **Brownfield course-correction.** Milestones M1-M4 shipped and merged to main. The full lifecycle plumbing works, but it was built demo-first: cohorts are only ever advertised by an unconditional `while (running)` auto-advertise loop (`advertiseCohort` has exactly one caller, `packages/service/src/demo-server.ts:245`), the "Coordinator" web tab is read-only SSE telemetry (not a control console), there is no operator authentication anywhere, and code still carries literal "booth"/"attendee" framing. There is no per-service cohort directory a participant can browse: participants auto-join whatever advert arrives over `/v1/adverts` SSE via a `shouldJoin` callback. The participant tab is a linear KeyGen -> Register -> Publish -> Resolve stepper, not a discover-and-join experience.
- **Grounding source.** A refreshed codebase map lives at `.planning/codebase/` (`ARCHITECTURE.md`, `STRUCTURE.md`, `CONCERNS.md`, `INTEGRATIONS.md`, `STACK.md`, `CONVENTIONS.md`, `TESTING.md`, analysis date 2026-07-07). `CONCERNS.md` ranks the missing auth and the single non-operator-controllable advertise loop as the top blockers to the "real self-hostable aggregator" goal.
- **Reusable assets to build on.** `runner.advertiseCohort(...)` (needs an operator-driven caller and a directory layer), the `/v1/adverts` SSE channel (needs a browsable per-service directory on top), `createParticipant` (needs discover -> join instead of auto-join), and the dashboard SSE bridge (becomes part of a real, gated operator surface).
- **Prior decisions.** 14 ADRs (`docs/adr/0001-0014`) record why the topology, onboarding models, network handling, guard rails, and deploy tooling look the way they do. Realignment work must respect these or explicitly supersede them with a new ADR.

## Constraints

- **Tech stack**: pnpm workspace `packages/{shared,service,participant,web}` + `e2e/`; TypeScript/ESM/Node >= 22; React 19 + Vite 8 + Tailwind v4 + Zustand 5 (web); Hono (service, wrapping the library's `HttpServerTransport`); vitest units + tsx e2e - established, do not churn without reason.
- **Consume published `@did-btcr2/*`**: `method@0.51.0`, `aggregation@0.4.0` (caret) - this is a consumer app, not a library fork.
- **Config-driven network, never hardcoded**: mutinynet default; the chain is resolved once at boot and served to the browser via `GET /v1/config` - required by the North Star.
- **Real-money paths are opt-in behind guard rails**: every path that can move Bitcoin (LIVE broadcast, mainnet, tx relay) stays behind explicit flags/env, defaulting to the hermetic zero-chain fixture path (ADR 0010).
- **Single-box self-host model**: one coordinator process (ADR 0014); no multi-instance coordination.
- **No unauthenticated mutating/control surface**: once operator control actions exist, they must be authenticated (security; the audit's top concern) - do not add mutating routes reachable from the dashboard without auth first.

## Key Decisions

<!-- Decisions that constrain future work. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Onboard the existing repo into a GSD-managed workflow to course-correct | An unstructured flow drifted from the intended end product | Pending |
| Target is a two-sided product: services advertise/manage cohorts, participants discover/join/participate | The intended end product is two-sided, not a single demo flow; confirmed by the owner | Pending |
| Discovery is a per-service cohort directory (not a federated registry, not invite-only) | Keeps each service a self-contained, self-hostable node with no shared infra | Pending |
| Realign a clean, smooth, self-hostable two-sided core first; fold accreted features (x1/baked/IPFS/mainnet/CI/Docker) in behind it | The drift is demo-grade and not-smooth, not the features themselves | Pending |
| Consume published `@did-btcr2/*`; do not fork the library | This is a reference/example consumer application | ✓ Good (established) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? Move to Out of Scope with reason
2. Requirements validated? Move to Validated with phase reference
3. New requirements emerged? Add to Active
4. Decisions to log? Add to Key Decisions
5. "What This Is" still accurate? Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check - still the right priority?
3. Audit Out of Scope - reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-07 after initialization*
