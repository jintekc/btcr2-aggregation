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
- ✓ Operator authentication protects the control + telemetry surface: httpOnly opaque server-tracked session, fail-closed boot when `OPERATOR_PASSWORD` unset, no unauthenticated mutating/control route (HOST-01 - Phase 1, ADR 0015 supersedes 0004)
- ✓ Operator creates and configures a cohort on demand from a protected `/operator` console (beacon type CAS/SMT, n-of-n threshold, capacity), not via a boot-time loop (SVC-01 - Phase 1)
- ✓ Operator advertises a cohort into a per-service directory (public `GET /v1/directory` + `GET /v1/status` derived from the live set); the boot-time auto-advertise loop + fillers are removed (SVC-02 - Phase 1)
- ✓ Participant discovers and browses a service's advertised open cohorts by pointing at that service's URL: anonymous directory landing at `/` (service-identity header, ~5s-polled list, plain-language labels, honest seats + k-of-n co-sign figures, empty/unreachable states) (PART-01 - Phase 2)
- ✓ Participant joins an advertised cohort by choice (browse-and-pick with inline identity), waits with a truthful `joined/n seats` line until all n seats fill, is seated when the cohort locks, and a full or closed cohort cannot be joined (deterministic filled-or-closed outcome, Leave from a seated state) (PART-02 - Phase 2; multi-cohort management stays deferred as PMG-01)
- ✓ Participant submits a DID update and takes part in the cohort's n-of-n MuSig2 co-signing round from the cohort they chose, via an explicit consent gate; the linear demo stepper is retired and the directory is the only entry path (PART-03 - Phase 3)
- ✓ Participant tracks co-sign progress and anchor status in real time on one continuous cohort page and resolves the updated DID once anchored; every surface narrates the anchor state honestly ('Anchored' reserved for a confirmed tx, mode-honest hermetic/live copy, best-effort failure reasons with an honest fallback) (PART-04 - Phase 3; confirmed by human UAT 4/4 including a real live regtest broadcast)

### Active

<!-- The realignment toward the intended two-sided, self-hostable product. Hypotheses until shipped and validated. -->

Service side (operator experience):
- [ ] Operator can **monitor** members and submissions (who joined, pending updates, co-sign progress, anchor status)
- [ ] Operator can **run aggregation and manage cohort lifecycle** (open -> close -> finalize; pause/cancel/reconfigure) without restarting the process

Self-hostable for real:
- [ ] The full two-sided flow is **smooth end to end for two strangers** (a stranger operator plus a stranger participant complete the loop without insider knowledge)
- [ ] The product **presents as a real aggregator**, not a booth/demo (retire the lingering "booth"/"attendee" framing in code, UI, and docs)
- [ ] The **live broadcast path is operable from the product itself** (boot-time enablement plus operator funding/broadcast surfacing), not only from e2e harnesses - emerged from Phase 3 live UAT (owner direction: "the actual real server working out-of-the-box"; see the 7 pending todos)

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
| Discovery is a per-service cohort directory (not a federated registry, not invite-only) | Keeps each service a self-contained, self-hostable node with no shared infra | ✓ Phase 1 (public `GET /v1/directory` + `/v1/status` shipped) |
| Realign a clean, smooth, self-hostable two-sided core first; fold accreted features (x1/baked/IPFS/mainnet/CI/Docker) in behind it | The drift is demo-grade and not-smooth, not the features themselves | In progress (Phases 1-2 delivered operator create/advertise + participant browse-and-pick join) |
| Consume published `@did-btcr2/*`; do not fork the library | This is a reference/example consumer application | ✓ Good (established) |
| Operator auth = httpOnly opaque server-tracked session cookie (gates the SSE telemetry feed); fail-closed boot when `OPERATOR_PASSWORD` unset | Only scheme that gates the EventSource feed; enforces "no unauthenticated mutating/control surface" | ✓ Phase 1 (ADR 0015, supersedes ADR 0004) |
| Remove the boot-time auto-advertise loop; `advertiseDraft` is the sole `runner.advertiseCohort` caller (cohorts exist only on operator action) | Retires the demo happy-path driver; makes advertise operator-driven (the core course-correction) | ✓ Phase 1 (D-17/D-18) |
| Active Bitcoin network is the service's resolved network, shown read-only per cohort (never a per-cohort form value) | Honors "config-driven network, never hardcoded"; avoids simultaneous multi-network cohorts | ✓ Phase 1 (D-10) |
| Known follow-up: login throttle keys on raw socket IP (per-proxy under ADR 0014), and session TTL misconfig can disable expiry | Surfaced by code review (WR-01/WR-02) + security audit (T-01-06, medium, non-blocking) | Open - fix recommended before public-internet deploy (01-SECURITY.md) |
| Cohort shape is a two-field k-of-n: n seats that ALL join before the cohort starts (min == max == n), plus a separate signing floor k wired to the activated ADR-042 script-path fallback (`fallbackThreshold`, 1 <= k <= n, default k = n); the directory shows `joined/n seats` + a `k-of-n` co-sign figure honestly | A single-field n-of-n over-promised "all co-sign" while the fallback could anchor with fewer; the owner corrected the model to two honest numbers (G-02-1) | ✓ Phase 2 (02-05/02-07/02-08; `pnpm e2e:kofn` n=4/k=2 capstone) |
| Advertised cohorts get a 30-minute discovery window (env-tunable); expiry is surfaced to the operator as a bounded `expired` record with a reason and a gated re-advertise route, never silently deleted and never shown to participants | A stranger browsing by choice needs real time to discover; the booth-era ~60s reap made browse-and-pick impossible (F2) | ✓ Phase 2 (02-06) |
| The join-seat grace timer arms at the picked cohort's first observed departure from the Advertised directory set, not at opt-in; while the row stays Advertised the participant waits indefinitely with a truthful `Waiting for the cohort to fill (joined/n seats)` line | Under wait-for-n with no fillers, arming at opt-in falsely failed every solo joiner at 90s and stranded a zombie seat (G-02-2) | ✓ Phase 2 (02-09) |
| Known follow-up: no distinct participant feedback when the service goes down mid-join (poll failure is indistinguishable from a slow directory) | Surfaced by 02-09 code review (WR-02, non-blocking); fold into the participant status work | ✓ Phase 3 (D-24 unreachable signal + D-25 honest terminal fallback) |
| Anchor narration is a defect class, closed at the selector root: 'Anchored' is reserved for `anchor.state === 'confirmed'` across every surface (StageTimeline, chip, CompletionSummary); broadcast-but-unconfirmed narrates as Signed/Broadcasting | Three gap-closure rounds (03-07/08/09) each found a subtler variant; fixing the two pure selectors ended the class instead of patching surfaces | ✓ Phase 3 (Truths 6-8; human-verified in live UAT) |
| Live-path operability gaps are product work, not test-rig work: the boot path cannot enable broadcast, cohort-beacon funding has no UI, and an unconfirmed signal breaks resolution (upstream) | Phase 3 live UAT over a real regtest chain (Polar) surfaced all three; routed to pending todos for Phase 4/5 planning rather than logged as Phase 3 gaps (out of its scope) | Open - fold into Phases 4/5 |

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
*Last updated: 2026-07-22 after Phase 3 (Participant Submit, Co-Sign, Track, and Resolve)*
