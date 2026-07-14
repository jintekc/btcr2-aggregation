# Phase 2: Participant Discovery + Browse-and-Pick Join - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-07-14
**Phase:** 2-participant-discovery-browse-and-pick-join
**Areas discussed:** Arriving at directory, Browse-vs-identity order, Directory freshness, Full/closed & multi-join, Per-cohort detail depth, Seated end-state, Empty/error states, Landing + stepper coexistence, Directory ordering, Join mechanism, Leave/seat release, Cohort status labels, Abandoned-seat robustness

---

## Arriving at the directory (connection model)

| Option | Description | Selected |
|--------|-------------|----------|
| Same-origin + show service identity | Browse `/v1/directory` on `window.location.origin` (no URL input, zero CORS); plus a visible service-identity header | ✓ |
| Same-origin, directory just appears | Same architecture, no explicit service-identity affordance | |
| URL input (cross-origin) | Type an arbitrary service URL; needs CORS, supersedes D-01, pulls v2 PMG-01 forward | |

**User's choice:** Same-origin + show service identity
**Notes:** Grounded in Phase 1 D-01/D-02 (one same-origin deployment; cross-origin roaming client is v2 PMG-01). `baseUrl = window.location.origin` confirmed in `App.tsx:15`.

## Service-identity header content

| Option | Description | Selected |
|--------|-------------|----------|
| Origin + network + open count | Reuse PublicStatus data (origin, active-network badge, open-cohort count); zero new backend | ✓ |
| Also show the coordinator DID | Above + the aggregator's own did:btcr2 (needs a `/v1/status` add) | |
| Operator-set friendly name | Above + a human display name the operator configures (new config + edit surface) | |

**User's choice:** Origin + network + open count
**Notes:** Coordinator-DID display and operator-set friendly name deferred (captured in CONTEXT Deferred Ideas).

---

## Browse vs identity order

| Option | Description | Selected |
|--------|-------------|----------|
| Browse first, identity at Join | Anonymous browse; generate/import identity only when picking a cohort to join (gradual engagement) | ✓ |
| Keep KeyGen-first | Preserve today's linear identity-then-browse entry | |
| You decide | Leave ordering to research/planning | |

**User's choice:** Browse first, identity at Join
**Notes:** Backed by gradual-engagement / lazy-registration UX research (Wroblewski; Duolingo; Baymard). Browsing `/v1/directory` is a public read; identity is only needed to opt in.

## Identity acquisition UX at Join

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit inline identity step | Clicking Join reveals an identity panel (reuse KeyGen/import); generate KEY (default) or import EXTERNAL; custody visible | ✓ |
| One-click 'Generate & join' | Auto-mint a fresh KEY identity on the Join click (silent key-mint) | |
| You decide | Leave the join-step identity UX to research/planning | |

**User's choice:** Explicit inline identity step
**Notes:** Chosen because the participant controls a real DID keypair (custody must be unmistakable); both onboarding models stay available.

---

## Directory freshness

| Option | Description | Selected |
|--------|-------------|----------|
| Poll /v1/directory every few seconds | Reuse the PublicStatus polling pattern (~5s); refreshes new cohorts + live seat counts; no new SSE wiring | ✓ |
| Live via /v1/adverts SSE | Near-instant new cohorts, but seat-fill still needs a directory read; more wiring | |
| Static fetch + manual Refresh | Simplest but goes stale | |

**User's choice:** Poll /v1/directory every few seconds
**Notes:** Best-practice research (SSE vs polling, 2025-2026): SSE wins for *frequently* changing data, but cohort adverts are operator-driven and infrequent, so polling is "perfectly fine" and simplest. Live-SSE directory noted as a later enhancement.

---

## Full/closed handling + join enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Server-authoritative + graceful return | Join counts only when the service seats you; poll-window fill/close -> reject + 'pick another'; client-side disable as belt-and-suspenders | ✓ |
| Client-side gating only | Disable Join from the polled snapshot; poll-window race risks a confusing stuck state | |
| You decide | Leave enforcement split to research | |

**User's choice:** Server-authoritative + graceful return
**Notes:** Guarantees criterion 3 against the poll-window race.

## Multi-join scope

| Option | Description | Selected |
|--------|-------------|----------|
| One cohort at a time | Sequential (leave, then re-pick); matches today's one-cohort-per-join; satisfies 'more than one' sequentially | ✓ |
| Concurrent multi-cohort join | Manage N seats/runners at once - this IS PMG-01 (v2) | |
| You decide | Leave multiplicity to research | |

**User's choice:** One cohort at a time
**Notes:** Concurrent multi-cohort deferred to v2 PMG-01.

---

## Per-cohort detail depth

| Option | Description | Selected |
|--------|-------------|----------|
| Required + threshold + cohort id | All from the existing DTO (zero new backend); beacon-type gloss, network, seats, status, n-of-n, cohort id | ✓ |
| Minimal (required-only) | Just beacon type, network, seats, status | |
| Add TTL/expiry countdown | Above + 'closes in ~Xm' (needs new DTO fields) | |

**User's choice:** Required + threshold + cohort id
**Notes:** TTL countdown deferred.

---

## The 'seated' end-state (Phase 2 / Phase 3 boundary)

| Option | Description | Selected |
|--------|-------------|----------|
| Seated confirmation + existing tail keeps working | Show a seated resting state; reuse today's submit/co-sign/resolve panels so the lifecycle still completes; Phase 3 rewires | ✓ |
| Seated + waiting only (tail dark until P3) | Show only seated/waiting; tail dark until Phase 3 - joining leads to a dead-end this phase | |
| You decide | Leave the reuse-vs-defer split to research | |

**User's choice:** Seated confirmation + existing tail keeps working
**Notes:** Keeps every phase demoable and the lifecycle unbroken.

---

## Empty / error / unreachable states

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse P1 patterns + deterministic join outcomes | Distinct empty/unreachable/failed-join states; replace the vague 'no advert received' watchdog with the concrete join response | ✓ |
| Minimal (one generic error) | One 'something went wrong' for all failures; conflates 'no cohorts' with 'service down' | |
| You decide | Leave to research/UI phase | |

**User's choice:** Reuse P1 patterns + deterministic join outcomes
**Notes:** Browse-and-pick joins a known cohort, so a deterministic join response replaces the old advert watchdog - no dead spinners.

---

## Landing + stepper coexistence

| Option | Description | Selected |
|--------|-------------|----------|
| Directory is the landing; stepper entry replaced now | Directory is the `/` front door; old KeyGen-first ENTRY gone this phase; Phase 3 rewires the tail | ✓ |
| Browse alongside the existing stepper | Keep both entries until Phase 3; two competing entries is confusing | |
| You decide | Leave to research/planning | |

**User's choice:** Directory is the landing; stepper entry replaced now
**Notes:** Pre-existing browser e2e is already red / deferred to Phase 6, so nothing blocks replacing the entry now.

---

## Directory ordering + filters

| Option | Description | Selected |
|--------|-------------|----------|
| Newest-advertised first, no filters | Predictable; single active network makes a network filter moot; beacon-type filter premature | ✓ |
| Most-open-seats first, no filters | Order by joinability instead of recency | |
| Add basic filters now | Ship filter controls; premature for a small single-network list | |

**User's choice:** Newest-advertised first, no filters
**Notes:** Sort/filter controls deferred until the list grows.

---

## Join mechanism direction

| Option | Description | Selected |
|--------|-------------|----------|
| Join-by-filter (shouldJoin === pickedId) | Run the runner, subscribe to /v1/adverts, shouldJoin true only for the picked cohortId; minimal change, reuses machinery | ✓ |
| Leave entirely to research | Let research pick the cleanest mechanism | |

**User's choice:** Join-by-filter (shouldJoin === pickedId)
**Notes:** Research validates timing/edge cases (advert no longer broadcast -> the graceful reject).

---

## Leaving a seated cohort (seat release)

| Option | Description | Selected |
|--------|-------------|----------|
| Client-side leave + rely on existing TTL reclaim | Wire the existing leave() into browse-and-pick; opt-out signal if the library exposes it, else TTL reclaims; no new protocol | ✓ |
| Build explicit server-side seat-release | Immediate opt-out route/signal; likely needs library support (fork) - out of scope | |
| You decide | Leave semantics to research | |

**User's choice:** Client-side leave + rely on existing TTL reclaim
**Notes:** Honors 'consume the library, don't fork'; research confirms whether an opt-out exists.

---

## Cohort status labels

| Option | Description | Selected |
|--------|-------------|----------|
| Plain-language labels | Map Advertised/CohortSet/CollectingUpdates -> 'Open'/'Filling'/'Collecting updates'; raw phase on hover | ✓ |
| Raw protocol phase | Show the protocol phase verbatim (jargon for strangers) | |
| You decide | Leave the label mapping to research/UI phase | |

**User's choice:** Plain-language labels
**Notes:** Exact copy is a UI-phase call; no booth/attendee framing.

---

## Abandoned-seat robustness

| Option | Description | Selected |
|--------|-------------|----------|
| Rely on existing TTL; explicit reclaim deferred | No new seat-reclaim machinery; abandoned seat reclaimed by PHASE_TIMEOUT_MS/COHORT_TTL_MS | ✓ |
| Build seat-reclaim now | Add disconnect detection + active reclaim; overlaps Phase 5, likely needs library support | |
| You decide | Leave abandoned-seat handling to research | |

**User's choice:** Rely on existing TTL; explicit reclaim deferred
**Notes:** Active/operator reclaim is Phase 5 lifecycle control; durable state is v2 DUR-01. Known limitation noted.

---

## Claude's Discretion

- Exact browse layout (cards vs list) and per-cohort card composition; which DTO fields render where (UI phase).
- Exact poll interval value (~5s target) and polling/backoff mechanics.
- Precise runner lifecycle for join/leave under join-by-filter; whether the library exposes a participant opt-out for immediate seat release.
- Server-side shape of a rejected join (status code + DTO); how the directory read distinguishes full vs closed.
- Exact copy strings (status labels, empty/error/seated messages) - UI phase.
- Browse route/component structure (new component vs restructuring ParticipantView); whether the public browse helpers move out of `lib/operator.ts`.
- The seated-state UI treatment and how the reused tail panels are reached from it.

## Deferred Ideas

- Operator-set friendly service name; coordinator/aggregator DID in the service-identity header.
- Live-SSE directory (via /v1/adverts) instead of polling.
- Per-cohort TTL/expiry countdown (needs new DTO fields).
- Concurrent multi-cohort join + management view (v2 PMG-01).
- Directory sort/filter controls (until the list grows).
- Explicit/immediate server-side seat-release + active abandoned-seat reclaim (Phase 5 / library support).
- Durable cohort/participant state across restart (v2 DUR-01).
- Full retirement/redesign of the submit/co-sign/track/resolve tail + standalone-stepper removal (Phase 3).
- Systematic booth/attendee framing sweep (Phase 6, HOST-03).
- Cross-origin roaming participant client (v2 PMG-01 / Phase 1 D-02 rejected two-app split).
- Rewiring the already-red `e2e:browser` / `e2e:browser:prod` (Phase 6 CI debt).
