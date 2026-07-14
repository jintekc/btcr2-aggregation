# Phase 2: Participant Discovery + Browse-and-Pick Join - Research

**Researched:** 2026-07-14
**Domain:** Browser participant discovery UX + `@did-btcr2/aggregation` participant/service runner join semantics (consumer app, not a library fork)
**Confidence:** HIGH (every load-bearing claim verified against the installed `@did-btcr2/aggregation@0.4.0` source and this repo's source)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Same-origin, no URL input. The directory a participant browses is the directory of the service that served the page. `baseUrl = window.location.origin` (`App.tsx:15`). Holds Phase 1 D-01 + ADR 0005. Cross-origin roaming client NOT chosen (v2 PMG-01).
- **D-02:** Show a service-identity header on the browse surface: service origin + active-network badge + open-cohort count, all from `GET /v1/status` (zero new backend). Friendly service name + coordinator-DID display deferred.
- **D-03:** Browse first, identity at Join (gradual engagement / lazy registration). Browsing `GET /v1/directory` is anonymous. A did:btcr2 identity is acquired only when the participant picks a cohort and acts to join.
- **D-04:** Explicit inline identity step at Join (not silent auto-mint). Clicking Join reveals an identity panel (reuse KeyGen / import panels): generate a new KEY identity (default) or import an existing/EXTERNAL (x1) identity, key custody visible, then confirm to join. Both onboarding models stay available.
- **D-05:** Poll `GET /v1/directory` every ~5s, reusing the `PublicStatus` polling pattern (10s `/v1/status`). One authoritative endpoint refreshes newly-advertised cohorts AND live seat counts. No new SSE consumer wiring. Live-SSE directory deferred.
- **D-06:** Server-authoritative join. A join only counts when the service seats the participant against the live runner set. If the picked cohort filled or transitioned out of the open phases during the poll window, the service rejects and the UI returns to browse with a specific message. The list also client-side disables Join on rows shown full/closed (belt-and-suspenders), but the server is the source of truth.
- **D-07:** One cohort at a time (sequential). Concurrent multi-cohort join deferred to v2 (PMG-01).
- **D-08:** Per-cohort detail = required fields + n-of-n threshold + cohort id, all from `DirectoryCohortDTO` (`cohortId/beaconType/network/threshold/capacity/joined/phase`) - zero new backend. TTL/expiry countdown deferred.
- **D-09:** Plain-language cohort status labels. Map raw protocol phase (`Advertised` / `CohortSet` / `CollectingUpdates`) to clear labels ("Open" / "Filling" / "Collecting updates" - exact copy is a UI-phase call), no booth/attendee framing.
- **D-10:** Newest-advertised first; no filter controls in the MVP (single active network; small list). Sort/filter deferred.
- **D-11:** After join, a clear seated confirmation. From that seated state the existing submit/co-sign/resolve tail keeps working unchanged (reuse today's panels + participant-store logic). Phase 3 formally rewires that tail.
- **D-12:** Reuse Phase 1's empty/status patterns and keep three states distinct: (a) directory empty = benign (reuse shipped copy, keep polling); (b) service unreachable / fetch error = distinct "can't reach this service" state with auto-retry; (c) failed join = specific message + return to browse. Replace the vague "no advert received" watchdog (`participant.ts:531`, `JOIN_WATCHDOG_MS`) with a deterministic join outcome.
- **D-13:** The directory is the participant's landing at `/` now. The old standalone KeyGen-first ENTRY is replaced this phase. Full retirement/redesign of the tail remains Phase 3.
- **D-14:** Intended direction = join-by-filter. Start the participant runner, subscribe to `/v1/adverts`, have `shouldJoin` return true only for the picked cohortId (replace `return true` at `packages/participant/src/index.ts:120-123`). Research validates exact timing/edge cases.
- **D-15:** Client-side leave + rely on existing TTL reclaim. Wire the existing `leave()` action into browse-and-pick. If the library exposes a participant opt-out, send it; otherwise the abandoned seat is reclaimed by existing `PHASE_TIMEOUT_MS`/`COHORT_TTL_MS`. No new seat-release protocol built. Research confirms whether an opt-out exists.
- **D-16:** Abandoned-seat reclaim relies on the existing TTL. Phase 2 builds no new seat-reclaim machinery. Active/operator reclaim is Phase 5; durable state is v2 (DUR-01).

### Claude's Discretion
- Exact browse layout (cards vs list rows) and which `DirectoryCohortDTO` fields render where; card composition from Phase 1 primitives.
- Precise poll interval value (~5s target) and polling/backoff mechanics.
- Precise runner lifecycle for join/leave under join-by-filter (D-14) and whether the library exposes a participant opt-out (D-15).
- Server-side shape of a rejected join (status code + DTO) and how the directory read distinguishes full vs closed (D-06).
- Exact copy strings (UI phase).
- Browse route/component structure: new browse component vs restructuring `ParticipantView`/`FlowStepper`; whether the public browse helpers move out of `lib/operator.ts` into a neutral lib.
- The seated-state UI treatment and how the reused tail panels are reached from it.

### Deferred Ideas (OUT OF SCOPE)
- Operator-set friendly service name in the identity header.
- Coordinator/aggregator DID display in the identity header.
- Live-SSE directory (via `/v1/adverts`) instead of polling.
- Per-cohort TTL/expiry countdown (needs new DTO fields).
- Concurrent multi-cohort join + management view (v2 PMG-01).
- Directory sort/filter controls.
- Explicit/immediate server-side seat-release + active abandoned-seat reclaim (Phase 5).
- Durable cohort/participant state across restart (v2 DUR-01).
- Full retirement/redesign of the submit/co-sign/track/resolve tail + standalone-stepper removal (Phase 3).
- Systematic booth/attendee framing sweep (Phase 6).
- Cross-origin roaming participant client (v2 PMG-01).
- Rewiring the pre-existing `e2e:browser` / `e2e:browser:prod` (Phase 6 CI debt) - Phase 2 must not rely on them and needs a fresh hermetic browse -> pick -> join proof.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PART-01 | Participant can point a client at a service's URL and browse that service's advertised open cohorts, with enough per-cohort detail (beacon type, network, open seats, status) to choose one. | `GET /v1/directory` (`DirectoryCohortDTO`) + `GET /v1/status` (`ServiceStatus`) already ship every field (verified in `operator-cohorts.ts:87-104` and `lib/operator.ts:79-95`). Browse is a same-origin poll of these public reads (D-01/D-05). Zero new backend. |
| PART-02 | Participant can join an advertised open cohort of their choice (browse-and-pick), rather than auto-joining whatever advert arrives. | Join-by-filter: narrow `shouldJoin` to the picked cohortId (D-14). Verified viable against `AggregationParticipantRunner` (`participant-runner.js` `#handleAdvert`). Requires making the picked cohortId a parameter of `createParticipant` and the store's `join()`. The deterministic "seated vs full/closed" outcome is directory-driven (see Findings 4-6), not a protocol reject (the protocol has no participant-facing reject signal). |
</phase_requirements>

## Summary

Phase 2 is a **browser-and-participant-runner phase with zero new backend and zero new packages.** The read side (`GET /v1/directory`, `GET /v1/status`) and the join transport (`POST`/SSE `/v1/adverts`) all shipped in Phase 1 and in `@did-btcr2/aggregation@0.4.0`. The work is: (1) a new anonymous **browse surface** as the landing at `/` (service-identity header + a ~5s-polled directory list built from `ui/primitives.tsx`), reusing the `PublicStatus` poll pattern; (2) making the participant **join by the picked cohortId** instead of auto-joining every advert; (3) restructuring `App.tsx` so the directory is the front door while the existing submit/co-sign/resolve tail keeps working unchanged.

**The single most important finding, which reshapes D-06/D-09/D-12/D-14 planning:** the `@did-btcr2/aggregation` protocol has **no participant-facing opt-in accept event and no opt-in reject message, and no leave/opt-out message at all** (verified: the only cohort-keygen messages are `cohort_advert`, `cohort_opt_in`, `cohort_opt_in_accept`, `cohort_ready` - `constants.d.ts`; `cohort_opt_in_accept` is received silently with no runner event - `participant-runner.js` `#handleOptInAccept`). Consequently a participant cannot learn "you were seated" or "that cohort is full/closed" from the protocol. The **directory poll is the authority** for both the positive (the cohort forms and `cohort-ready` fires) and the negative (the picked cohort leaves the `Advertised` phase in the poll without seating us -> "it just filled/closed, pick another"). This is how D-06/D-12 are satisfied with zero new backend, and it is why the vague `JOIN_WATCHDOG_MS` timer is replaced, not merely retuned.

**Second key finding:** with the shipped default `onReadyToFinalize` (which `createService` does not override), a cohort **finalizes keygen and locks membership the instant it reaches `minParticipants` (= the operator's `threshold`)**, transitioning `Advertised -> CohortSet`. `maxParticipants` (`capacity`) is only a hard ceiling that silently ignores surplus opt-ins. So the true **joinable predicate is `phase === 'Advertised'`** (not the whole `OPEN_PHASES` set the directory lists), and the real fill target is `threshold`, not `capacity`. Phase 1's own capstone sets `threshold === capacity` (the n-of-n norm); the plan should treat that as the coherent case and present `CohortSet`/`CollectingUpdates` cohorts as "in progress / closed to new members," not as still-joinable.

**Primary recommendation:** Build a new `BrowseView` landing (identity header + polled directory list + pick), thread a `pickedCohortId` through `createParticipant` -> store `join()` -> `shouldJoin`, and drive the seated/full/closed outcome off the directory poll plus the `cohort-ready`/`cohort-failed` runner events. Add one fresh hermetic tsx e2e (`e2e/browse-join-cohort.ts`, modeled on `e2e/operator-cohort.ts`) as the browse -> pick -> join -> seated proof; do not rely on the red `e2e:browser*`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Browse the directory (list of open cohorts) | Browser / Client (React) | API (existing `GET /v1/directory`) | Anonymous public read; presentation + polling are client concerns. |
| Service-identity header (origin + network + open count) | Browser / Client | API (existing `GET /v1/status`) | Reuses the `PublicStatus` data source (D-02). |
| Directory freshness (~5s poll) | Browser / Client | - | `setInterval` poll, the `PublicStatus` model (D-05). No server push. |
| Pick + join a specific cohort (join-by-filter) | Participant runner (isomorphic lib consumer, runs in-browser) | API (public `/v1/adverts` transport) | `shouldJoin === pickedId` filters adverts client-side; the opt-in rides the existing public protocol transport. |
| Seating + capacity enforcement (who is admitted, when the cohort locks) | API / Backend (the library `AggregationServiceRunner` + state machine) | - | Already enforced server-side: ceiling ignore + finalize-at-threshold. Nothing new to build server-side. |
| Deterministic "seated vs full/closed" outcome | Browser / Client (directory poll + runner events) | API (directory as the authority) | The protocol exposes no participant-facing accept/reject; the client derives the outcome from the directory + `cohort-ready`/`cohort-failed`. |
| Landing route `/` = browse | Browser / Client (`App.tsx`) | - | Route/composition change only (D-13). |
| Reused submit/co-sign/resolve tail | Browser / Client (existing panels + store) | API (existing routes) | Unchanged post-seat (D-11); Phase 3 rewires. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@did-btcr2/aggregation` | `^0.4.0` (installed `0.4.0`) | `createParticipant` -> `AggregationParticipantRunner` + `HttpClientTransport`; `shouldJoin`, `cohort-joined`/`cohort-ready`/`cohort-complete`/`cohort-failed` events. | Already the sole protocol engine; this phase only changes the `shouldJoin` predicate. Do not fork (project constraint). |
| React | `^19.2.7` | Browse view + inline identity step + reused tail. | Established web stack. |
| Zustand | `^5.0.14` | `stores/participant.ts` orchestration state machine (join/leave/seated). | Established; the store already owns the join lifecycle. |
| Tailwind v4 + `ui/primitives.tsx` | `^4.3.2` | Browse list rows + identity step from `Card`/`Button`/`Badge`/`StatusDot`/`SectionTitle`/`Mono`/`CopyField`/`Input`/`Select`/`Field`. | Phase 1 design system to extend; UI-SPEC locks ZERO new primitives. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@btcr2-aggregation/shared` | workspace | `resolveNetwork`, `DEFAULT_NETWORK`, identity helpers (`createIdentity`/`createExternalIdentity`/`importIdentity`/`importExternalIdentity`). | Network badge in the identity header; the inline identity step reuses these exactly as `KeyGenPanel` does today. |
| existing `lib/operator.ts` | - | `fetchDirectory` / `fetchStatus` (`credentials: 'omit'`) + `DirectoryCohortDTO` / `ServiceStatus` types. | The browse data source. Consider relocating to a neutral lib (see Finding 8). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polling `/v1/directory` (D-05) | Live SSE over `/v1/adverts` | SSE gives instant updates but needs a new browser SSE consumer + reconnect handling; polling reuses the proven `PublicStatus` pattern with negligible overhead for infrequent operator-driven adverts. Explicitly deferred (D-05). |
| Directory-poll-driven join outcome | A new server `POST /v1/join` returning a synchronous 200/409 | A crisp synchronous reject is nicer UX but requires a thin NEW server route (leaves the pure zero-new-backend target) and would have to reach into the runner's live set. Not required for the MVP; document as a future option (Finding 4). |

**Installation:** None. Zero new packages. (`pnpm-lock.yaml` unchanged.)

**Version verification:** `@did-btcr2/aggregation@0.4.0` is the installed, pinned version (verified: `node_modules/.pnpm/@did-btcr2+aggregation@0.4.0_typescript@5.9.3`). No new dependency is introduced by this phase.

## Package Legitimacy Audit

**Not applicable.** This phase installs no external packages. All work reuses already-installed, already-audited dependencies (`@did-btcr2/aggregation@0.4.0`, React 19, Zustand 5, Tailwind v4) and existing in-repo modules. No `npm install`, no lockfile change.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
                        Browser (same-origin SPA, baseUrl = window.location.origin)
  ┌───────────────────────────────────────────────────────────────────────────────────┐
  │  App.tsx  (route: '/' = BROWSE landing;  '/operator' = operator console, unchanged) │
  │                                                                                     │
  │   BrowseView (NEW, landing)                                                         │
  │     ├─ ServiceIdentityHeader  ──poll ~10s──►  GET /v1/status   (origin+net+count)   │
  │     ├─ DirectoryList          ──poll ~5s───►  GET /v1/directory (DirectoryCohortDTO[])│
  │     │     row = beaconType · network · joined/capacity · status(phase) · threshold  │
  │     │           · cohortId(Mono/CopyField) · [Join] (enabled iff phase==Advertised  │
  │     │             && joined<capacity)                                               │
  │     └─ pick(cohortId)                                                                │
  │            │                                                                         │
  │            ▼                                                                         │
  │   Inline identity step (reuse KeyGen/import; D-04)  ──confirm──► store.join(base,id) │
  │            │                                                                         │
  │            ▼                                                                         │
  │   participant store (Zustand)                                                        │
  │     createParticipant({ identity, baseUrl, cohortId })                              │
  │       runner.shouldJoin = advert => advert.cohortId === pickedId   ◄── D-14 change   │
  │            │  start(): runner.start() + transport.start()                            │
  │            ▼                                                                         │
  │     HttpClientTransport  ──SSE──►  GET /v1/adverts  (advert cache replays, ~5min TTL)│
  │                          ──POST─►  opt_in ... nonce ... partial sig                  │
  │            │                                                                         │
  │   outcome (DETERMINISTIC, no watchdog timer):                                        │
  │     • cohort-ready  ─────────────────────────► SEATED + forming  ─► reused tail      │
  │     • picked cohort leaves 'Advertised' in the poll w/o cohort-ready ─► "just        │
  │        filled/closed, pick another"  ─► back to BrowseView                           │
  │     • cohort-failed / error ────────────────► failed state + Retry/Leave            │
  └───────────────────────────────────────────────────────────────────────────────────┘
                                    │
             Service (Hono, one origin/port; ADR 0003) - UNCHANGED by this phase
  ┌───────────────────────────────────────────────────────────────────────────────────┐
  │ /v1/directory, /v1/status  ◄─ operatorCohorts.directory()/status() ◄─ runner.session│
  │ /v1/adverts (public transport)  ◄─ HttpServerTransport                              │
  │ AggregationServiceRunner: default onOptInReceived=accept-all (open cohorts),        │
  │   maxParticipants ceiling ignores surplus, onReadyToFinalize=finalize @ minParts    │
  │   -> membership LOCKS at `threshold`; cohortTtlMs=180000 / phaseTimeoutMs=60000      │
  │      reclaim an abandoned seat (D-16)                                                │
  └───────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
packages/web/src/
├── components/
│   ├── browse/                 # NEW: the landing browse surface
│   │   ├── BrowseView.tsx      # header + directory list + pick -> identity -> seated wiring
│   │   ├── DirectoryList.tsx   # the ~5s-polled list (PublicStatus poll pattern)
│   │   ├── CohortRow.tsx       # one list row from ui/primitives (D-08 fields, D-09 label)
│   │   ├── ServiceIdentityHeader.tsx  # origin + network badge + open-cohort count (D-02)
│   │   └── JoinIdentityStep.tsx       # inline KEY/import identity at Join (D-04)
│   └── participant/            # EXISTING tail, reused unchanged post-seat (D-11)
│       ├── FlowStepper.tsx  RegisterPanel.tsx  PublishPanel.tsx  ResolvePanel.tsx  ResultCard.tsx
│       └── (ParticipantView.tsx / KeyGenPanel.tsx: entry replaced; identity portion reused by JoinIdentityStep)
├── lib/
│   └── directory.ts            # NEW (optional, Claude's discretion): re-home fetchDirectory/fetchStatus
├── stores/
│   └── participant.ts          # join(baseUrl, cohortId); replace JOIN_WATCHDOG_MS with directory-driven outcome
└── App.tsx                     # '/' renders BrowseView (D-13)
packages/participant/src/
└── index.ts                    # CreateParticipantOptions.cohortId; shouldJoin => advert.cohortId === cohortId
e2e/
└── browse-join-cohort.ts       # NEW hermetic proof (model: e2e/operator-cohort.ts)
```

### Pattern 1: Join-by-filter (D-14) - the exact change
**What:** Narrow the participant's `shouldJoin` from "accept every advert" to "accept only the picked cohort."
**When to use:** The single mechanism for browse-and-pick.
**Example:**
```typescript
// packages/participant/src/index.ts - CreateParticipantOptions gains a picked cohortId.
// Source: verified against participant-runner.js #handleAdvert (shouldJoin fires per advert).
export interface CreateParticipantOptions {
  identity: Identity;
  baseUrl: string;
  beaconType?: BeaconType;
  /** Browse-and-pick: join ONLY this cohort. Omitted keeps the legacy accept-all (do not rely on it in Phase 2). */
  cohortId?: string;
}
// inside createParticipant, in the runner options:
shouldJoin: async (advert: CohortAdvert) => {
  if (opts.cohortId !== undefined && advert.cohortId !== opts.cohortId) {
    return false;                       // ignore every cohort except the picked one
  }
  cohortBeaconTypes.set(advert.cohortId, normalizeBeaconType(advert.beaconType));
  return true;
},
```

### Pattern 2: The `PublicStatus` poll (D-05) applied to the directory
**What:** `useEffect` -> `setInterval(load, POLL_MS)` with an `active` guard and `clearInterval` on unmount; render nothing until the first successful fetch (empty/error handled separately).
**When to use:** Both the ~5s directory poll and the ~10s identity-header status poll.
**Example:**
```typescript
// Source: packages/web/src/components/operator/PublicStatus.tsx:21-42 (proven pattern).
useEffect(() => {
  let active = true;
  const load = () => {
    fetchDirectory(baseUrl)
      .then((rows) => { if (active) { setRows(rows); setReachable(true); } })
      .catch(() => { if (active) setReachable(false); });   // D-12(b): distinct "unreachable" state
  };
  load();
  const timer = setInterval(load, 5000);                     // D-05 ~5s
  return () => { active = false; clearInterval(timer); };
}, [baseUrl]);
```

### Pattern 3: Directory-driven join outcome (replaces `JOIN_WATCHDOG_MS`, D-06/D-12)
**What:** Derive seated / full-closed / failed from the directory poll + runner events, never from a fixed timer.
**When to use:** The whole post-Join lifecycle.
**Logic:**
- Positive (seated + cohort formed): `cohort-ready` fires -> drive the reused tail.
- Resting "seated, waiting to fill": `cohort-joined` fired (opted in) AND the picked cohort is still `phase === 'Advertised'` in the poll AND `joined` climbing. Show "You're in cohort X - waiting for it to fill ({joined}/{capacity})".
- Negative (D-06/D-12c): the picked cohort's directory `phase` advances past `Advertised` (or the row disappears) and `cohort-ready` never fired for us -> "That cohort just filled or closed. Pick another." Tear down, return to browse.
- Failure: `cohort-failed` / `error` -> failed state (existing `fail()`), Retry / Leave.

### Anti-Patterns to Avoid
- **A fixed post-join watchdog timer as the "closed" signal.** `JOIN_WATCHDOG_MS` (`participant.ts:231/534-540`) fires on "no advert received," which conflates "coordinator unreachable" with "cohort full/closed" and produces dead spinners. D-12 explicitly replaces it with the directory-driven outcome.
- **A parallel client-side cohort list.** The directory is the single source of truth (Phase 1 D-15). Never merge adverts + a local list; always render from the latest `GET /v1/directory`.
- **Treating `cohort-joined` as "seated."** `cohort-joined` fires the instant the opt-in is SENT (`participant-runner.js` `#handleAdvert`), before the service accepts. Do not show "seated / confirmed" on `cohort-joined` alone; use `cohort-ready` for the definitive seat, and the directory for the negative.
- **Treating every `OPEN_PHASES` cohort as joinable.** `CohortSet`/`CollectingUpdates` are listed but membership is LOCKED. Only `phase === 'Advertised'` (and `joined < capacity`) is joinable (Finding 3).
- **Adding a mutating/control route for join.** Join rides the existing public `/v1/adverts` protocol transport. Do NOT add any unauthenticated mutating route (project hard constraint).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Selecting one cohort to join | A custom opt-in message / new join route | `shouldJoin` returning `advert.cohortId === pickedId` (D-14) | The runner + transport already do opt-in, keygen, co-sign. One predicate change. |
| Seat counting / "how full is it" | A client tally of adverts | `DirectoryCohortDTO.joined` / `.capacity` from `GET /v1/directory` | Server-derived from `runner.session.cohorts` (single source of truth, D-15). |
| "Is it still joinable / did it fill" | A bespoke timer/heuristic | The directory `phase` (`Advertised` = joinable) + `cohort-ready` event | The protocol has no participant-facing accept/reject; the directory is the authority (Findings 4-6). |
| Releasing an abandoned seat | A new leave/opt-out protocol | Existing `cohortTtlMs` (180000) / `phaseTimeoutMs` (60000) reclaim (D-15/D-16) | No leave/opt-out message exists in the protocol at all (verified). |
| Capacity ceiling enforcement | A client-side "reject if full" as the source of truth | The library runner (`maxParticipants` ceiling + finalize-at-threshold) | Already enforced server-side; the client check is belt-and-suspenders only (D-06). |
| Directory / status fetch | A new fetch client | Existing `fetchDirectory` / `fetchStatus` (`credentials:'omit'`) | Already public, typed, bounded-timeout. |

**Key insight:** the protocol engine is a black box that emits only positive milestones. Phase 2's job is not to add protocol machinery but to wrap the existing engine with a directory-authoritative outcome layer and a browse UI.

## Runtime State Inventory

> This phase adds a browse UI and changes a `shouldJoin` predicate + a route composition. It is not a rename/refactor/migration, and it introduces no stored data, no service-config, no OS-registered state, no secrets/env vars, and no build artifacts that outlive a source change.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None - the directory derives from in-memory `runner.session.cohorts` (per-`createService`, no datastore). Verified `operator-cohorts.ts:188-210`. | None. |
| Live service config | None - no new env var, no external service config. The single active network is resolved at boot (existing). | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None new. `OPERATOR_PASSWORD` (Phase 1) is untouched; browse/join are anonymous (public reads + public transport). | None. |
| Build artifacts | None - no new package, no new build output beyond the normal `vite build` of the SPA. | Normal `pnpm -r build` before `e2e:browser*`-style runs (existing). |

## Common Pitfalls

### Pitfall 1: The directory lists cohorts that are NOT joinable
**What goes wrong:** The plan treats every directory entry as joinable and shows "Join" on `CohortSet`/`CollectingUpdates` rows. Clicking Join on them starts a runner that never gets `cohort-ready` (membership is locked), then hangs or falsely reports failure.
**Why it happens:** `directory()` filters to `OPEN_PHASES = {Advertised, CohortSet, CollectingUpdates}` (`operator-cohorts.ts:53`), but a cohort only ACCEPTS new participants during `Advertised`. It finalizes keygen (locks) the instant it reaches `minParticipants` (= `threshold`) under the shipped default `onReadyToFinalize` (`service-runner.js:90-92`, not overridden in `createService`).
**How to avoid:** Join is enabled only when `phase === 'Advertised' && joined < capacity`. Map `CohortSet`/`CollectingUpdates` to non-joinable labels ("Forming" / "In progress" / "Collecting updates"), not "Filling" implying open. (D-09 copy is a UI-phase call; research flags the semantic.)
**Warning signs:** a Join click on a non-`Advertised` row; a participant stuck in "connecting" with no `cohort-ready`.

### Pitfall 2: `capacity` vs `threshold` mismatch makes "open seats" misleading
**What goes wrong:** The row shows `joined/capacity` with capacity > threshold; the cohort finalizes at `threshold` and stops accepting, but the UI still shows "seats open," so a user tries to join a de-facto-closed cohort.
**Why it happens:** `maxParticipants` (capacity) is a hard ceiling that silently ignores surplus opt-ins (`service-runner.js:491-494`), but finalize fires at `minParticipants` first, so seats between threshold and capacity are never reached under the default.
**How to avoid:** For v1, treat `threshold === capacity` as the coherent n-of-n norm (Phase 1's own `e2e/operator-cohort.ts:48-49,220` sets `threshold === capacity === 2`). Present the phase as the joinability authority regardless of the count. If the team wants capacity > threshold to fill to capacity, that needs a service-side `onReadyToFinalize` change (out of the zero-new-backend target) - flag it, do not silently assume it.
**Warning signs:** an operator creates a draft with capacity > threshold and the browse row looks joinable after the cohort has already formed.

### Pitfall 3: `cohort-joined` mistaken for "seated"
**What goes wrong:** UI shows "You're seated" on `cohort-joined`, then the service silently ignores the opt-in (cohort full/closed) and the user is never actually in.
**Why it happens:** `cohort-joined` = opt-in SENT, not accepted (`participant-runner.js` `#handleAdvert`). There is no `opt-in-accepted` runner event (`#handleOptInAccept` emits nothing) and no reject message at all (`constants.d.ts`).
**How to avoid:** Treat `cohort-joined` as "opted in, awaiting the cohort to form." Use `cohort-ready` as the definitive seat confirmation and the directory poll for the negative (Pattern 3).
**Warning signs:** a "seated" state that never advances to the tail.

### Pitfall 4: Reusing the tail without the seat gate
**What goes wrong:** The reused `RegisterPanel`/`PublishPanel`/`ResolvePanel` render before a result exists, or the store's `cohort-joined`/`cohort-ready` handlers still assume the old KeyGen-first flow.
**Why it happens:** `ParticipantView` gates the tail on `hasResult` (`ParticipantView.tsx:28`); the store's `join()` currently flips to `live` on `cohort-joined` (`participant.ts:432-444`). The browse flow reaches those same handlers via a different entry.
**How to avoid:** Keep the store's event handlers as the single lifecycle owner; the browse UI drives `join(baseUrl, cohortId)` and reads the same `status`/`result`. Reuse `hasResult`-style gates for the tail unchanged (D-11).
**Warning signs:** tail panels rendering with null data; duplicated lifecycle logic in the browse component.

### Pitfall 5: The advert cache re-delivers a stale advert
**What goes wrong:** A participant that clicks Join after a cohort has finalized still receives the cached advert (advert cache TTL ~5 min, `http-server.d.ts` `advertTtlMs` default 5 minutes), so `shouldJoin` fires and an opt-in is sent into a locked cohort.
**Why it happens:** The runner stops REPUBLISHING on keygen-complete (`service-runner.js` `#stopAdvertRepeating`), but the transport's advert cache still replays the last advert to late SSE subscribers (this is exactly why Phase 1's `e2e/operator-cohort.ts:276-278` works).
**How to avoid:** Do not rely on advert absence to mean "closed." The pre-join guard (re-fetch the directory and require `phase === 'Advertised'`) plus the directory-driven negative (Pattern 3) handle it deterministically.
**Warning signs:** an opt-in accepted-looking start on a cohort the directory shows as past `Advertised`.

## Code Examples

### The picked-cohort filter (the core PART-02 change)
```typescript
// Source: packages/participant/src/index.ts:120-123 (today) -> narrowed.
// Verified against @did-btcr2/aggregation participant-runner.js #handleAdvert:
//   shouldJoin(advert) is awaited per discovered advert; false => skip (no opt-in sent).
shouldJoin: async (advert: CohortAdvert) => {
  if (opts.cohortId !== undefined && advert.cohortId !== opts.cohortId) return false;
  cohortBeaconTypes.set(advert.cohortId, normalizeBeaconType(advert.beaconType));
  return true;
},
```

### Client-side joinability + status label (D-06 belt + D-09)
```typescript
// Source: DirectoryCohortDTO fields verified in operator-cohorts.ts:87-97 / lib/operator.ts:79-88.
const JOINABLE_PHASE = 'Advertised';
function isJoinable(row: DirectoryCohortDTO): boolean {
  return row.phase === JOINABLE_PHASE && row.joined < row.capacity;
}
function statusLabel(phase: string): string {
  switch (phase) {
    case 'Advertised':        return 'Open';                 // joinable
    case 'CohortSet':         return 'Forming';              // NOT joinable (membership locked) - flag vs D-09 "Filling"
    case 'CollectingUpdates': return 'Collecting updates';   // NOT joinable
    default:                  return phase;                  // Mono fallback
  }
}
```

### Store `join` signature change (D-14/D-12)
```typescript
// Source: packages/web/src/stores/participant.ts:162,407-546 (join today).
// join gains the picked cohortId; JOIN_WATCHDOG_MS (231/534-540) is removed in favor of
// the directory-driven outcome (Pattern 3). createParticipant is called with { identity, baseUrl, cohortId }.
join(baseUrl: string, cohortId: string): Promise<void>;
```

## State of the Art

| Old Approach (this repo, pre-Phase-2) | Current Approach (Phase 2) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Auto-join every advert (`shouldJoin: async () => true`) | Join only the picked cohortId (D-14) | This phase | The participant chooses (PART-02). |
| KeyGen-first standalone stepper entry | Directory browse landing at `/`; identity inline at Join (D-03/D-04/D-13) | This phase | Discover-first product; the old entry is replaced (tail reused). |
| `JOIN_WATCHDOG_MS` "no advert received" timer | Directory-driven seated/full-closed outcome (D-06/D-12) | This phase | Deterministic, no dead spinners. |
| Boot-time auto-advertise loop drives cohorts | Operator-driven advertise only (Phase 1) | Phase 1 | A fresh service advertises nothing; the browse directory may legitimately be empty (D-12a). |

**Deprecated/outdated:**
- `e2e/browser-cohort.ts` / `e2e/browser-prod-cohort.ts`: assume the removed auto-advertise loop; RED since Phase 1, deferred to Phase 6. Do not rely on or extend them for Phase 2 (write a fresh hermetic proof).
- The store comment at `participant.ts:236-238` ("the runner joins EVERY advert") is stale under join-by-filter; update it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Operators will set `threshold === capacity` for v1 (the n-of-n norm), so `joined/capacity` is a coherent "open seats" display. | Pitfall 2 / Summary | If operators routinely set capacity > threshold, the browse "seats" reads confusingly for already-formed cohorts. Mitigation: phase is the joinability authority regardless; a create-form hint or a small `onReadyToFinalize` change (out of scope) resolves it. Low risk - flagged for discuss/UI. |
| A2 | `~5s` directory poll overhead is negligible (adverts are infrequent, operator-driven). | D-05 | Only wrong at implausible directory sizes; poll interval is trivially tunable. Negligible. |

**All other claims in this document are `[VERIFIED]` against the installed `@did-btcr2/aggregation@0.4.0` source or this repo's source, cited inline by file:line.**

## Open Questions

1. **Should the deterministic full/closed reject be a client-derived outcome, or a thin new server signal?**
   - What we know: The protocol exposes no participant-facing accept/reject; the directory poll + `cohort-ready` fully determine the outcome with zero new backend (Pattern 3, Finding 4).
   - What's unclear: Whether the team prefers a crisp synchronous reject (would require a new server route reaching the runner's live set) over the directory-derived outcome.
   - Recommendation: Ship the directory-derived outcome (honors zero-new-backend and the "no mutating route without auth" constraint). Note the synchronous-reject route as a Phase 5-ish enhancement if UX demands it.

2. **Copy for the non-joinable open phases (`CohortSet`/`CollectingUpdates`).**
   - What we know: D-09 suggests "Filling" for `CohortSet`, but `CohortSet` is not joinable.
   - What's unclear: Exact strings (a UI-phase call).
   - Recommendation: Prefer "Forming" / "In progress" over "Filling" so the label does not imply the cohort is still open; the UI phase finalizes copy.

## Environment Availability

> No external dependency is introduced. Browse + join are same-origin public reads + the existing public protocol transport; the hermetic e2e runs offline/fixture like the rest of the gate.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@did-btcr2/aggregation` participant | join-by-filter | Yes | 0.4.0 (installed) | - |
| Node / pnpm / tsx | hermetic e2e | Yes | Node >= 22, pnpm 11.4.0, tsx ^4 | - |
| Playwright (headless Chromium) | optional browser leg | Yes (`playwright-core ^1.61.1`) | 1.61.1 | Headless tsx proof is the deterministic core; a Playwright leg is optional. |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

> `nyquist_validation` is enabled. `e2e:browser` / `e2e:browser:prod` are RED since Phase 1 (booth topology, deferred to Phase 6). Phase 2 needs a FRESH hermetic browse -> pick -> join -> seated proof, modeled on `e2e/operator-cohort.ts`.

### Test Framework
| Property | Value |
|----------|-------|
| Unit framework | Vitest `^2` (`*.spec.ts` co-located); `pnpm test` = `tsc -b && vitest run`. |
| E2E harness | tsx scripts booting a real `createService` + real `createParticipant`(s) over real HTTP (hermetic offline/fixture default). |
| New e2e | `e2e/browse-join-cohort.ts` + a `e2e:browse` package script (model: `e2e/operator-cohort.ts`). |
| Quick run command | `pnpm vitest run packages/web packages/participant` (unit) |
| Full suite command | `pnpm test && pnpm e2e:operator && pnpm e2e:browse` (plus the existing gate) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PART-01 | Browse lists advertised open cohorts with beacon type / network / seats / status | e2e (assert `GET /v1/directory` entry fields after operator advertise) + unit (row render + `isJoinable`/`statusLabel`) | `tsx e2e/browse-join-cohort.ts` ; `vitest run` | Wave 0 |
| PART-02 | Participant joins the PICKED cohort, not whatever arrives | e2e (participant with `cohortId` filter joins only that cohort; a second cohort advertised concurrently is NOT joined) + unit (`shouldJoin` predicate) | `tsx e2e/browse-join-cohort.ts` | Wave 0 |
| Criterion 3 (positive) | Joined participant is seated + counts against capacity; cohort forms + co-signs | e2e (`threshold === capacity === 2`; both peers reach `cohort-complete`, 64-byte signature; directory `joined` reflects seats) | `tsx e2e/browse-join-cohort.ts` | Wave 0 |
| Criterion 3 (negative) | A full/closed cohort cannot be joined | e2e (attempt to join a cohortId already finalized / not in `Advertised` -> `shouldJoin` never fires / no `cohort-ready` -> deterministic reject, no dead spinner) + unit (store: directory phase-advance -> "closed" outcome) | `tsx e2e/browse-join-cohort.ts` ; `vitest run` | Wave 0 |
| D-12 | Empty / unreachable / failed-join states distinct | unit (BrowseView state: empty vs unreachable; store: failed-join returns to browse) | `vitest run` | Wave 0 |
| D-15/D-16 | Leave tears down client; abandoned seat reclaims via TTL | unit (`leave()` teardown) + note e2e for TTL reclaim is bounded by `cohortTtlMs`/`phaseTimeoutMs` (assert cohort fails after phase timeout) | `vitest run` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <touched package>` (quick).
- **Per wave merge:** `pnpm test && pnpm e2e:operator && pnpm e2e:browse` + web `tsc --noEmit` + `vite build`.
- **Phase gate:** the full hermetic gate green (minus the pre-existing red `e2e:browser*`, still deferred to Phase 6) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `e2e/browse-join-cohort.ts` - the hermetic browse -> pick -> join -> seated + co-sign proof, plus the full/closed-negative leg (covers PART-01/PART-02/criterion 3). Add `e2e:browse` to `package.json` scripts.
- [ ] `packages/participant/src/index.spec.ts` (or extend) - `shouldJoin` filters to the picked cohortId; a non-matching advert is not joined.
- [ ] `packages/web/src/stores/participant.spec.ts` - `join(baseUrl, cohortId)` sets the seated/waiting/closed states off runner events + directory; `JOIN_WATCHDOG_MS` removed.
- [ ] `packages/web/src/components/browse/*.spec.ts` - `isJoinable`/`statusLabel`; empty vs unreachable states (D-12).
- Note: `e2e:browse` is NOT wired into CI in Phase 2 (CI wiring + the red `e2e:browser*` rewrite are Phase 6 CI debt); register the script locally like `e2e:operator`.

## Security Domain

> `security_enforcement: true`, ASVS level 1, block-on high. Browse + join add no authenticated surface; the risk is data exposure on the public reads and abuse of the public join transport.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture / data flow | yes | Browse is anonymous by design; the ONLY new surface is client code + reuse of existing public reads. No new mutating/control route (project hard constraint). |
| V2 Authentication | no (for browse/join) | Browse/join are intentionally anonymous (D-03). Operator auth (Phase 1, ADR 0015) is untouched and must stay green. |
| V4 Access Control | yes | The directory/status reads are public (`credentials:'omit'`, `lib/operator.ts:180/195`); `/v1/directory` + `/v1/status` are the ONLY data the browse consumes. Do not send the operator session cookie from the browse surface. |
| V5 Input Validation | yes | The picked `cohortId` is untrusted; only allow picking a cohortId currently present in the fetched directory (client guard). The server already validates opt-ins (transport sender-auth + ceiling/roster gates) - the client filter is belt, not the boundary. |
| V6 Cryptography | yes (never hand-roll) | All MuSig2 / signing stays in `@did-btcr2/aggregation`. Phase 2 writes zero crypto. |
| V9 Data Protection | yes | `DirectoryCohortDTO` must expose no participant DIDs/keys - only a `joined` count (already the case, `operator-cohorts.ts:87-97`, T-03-02). Keep it; do not add member identities to the row. |

### Known Threat Patterns for the browse/join surface
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Participant DID/key leakage via the public directory | Information disclosure | DTO exposes only counts (verified); do not widen it. |
| Opt-in spam / join flood on the public transport | Denial of service | The `HttpServerTransport` already carries a `RateLimiter` + advert rate limits (`http-server.d.ts`); no change. Abandoned seats reclaim via `cohortTtlMs`/`phaseTimeoutMs` (D-16). |
| Guessing/POSTing a cohortId not in the directory | Tampering / Spoofing | Server auth + phase gating reject a non-`Advertised` opt-in; the client only offers directory-listed cohortIds. |
| Sending the operator session cookie from the anonymous browse | Elevation / info disclosure | Browse reads use `credentials:'omit'` (existing helpers); keep it if the helpers are relocated. |
| A stale/misleading "seated" state masking a non-seat | Repudiation / integrity | Use `cohort-ready` (not `cohort-joined`) as the seat authority; directory-drive the negative (Pattern 3). |

## Sources

### Primary (HIGH confidence - verified against installed source / repo source this session)
- `@did-btcr2/aggregation@0.4.0` `dist/types` + `dist/esm`: `participant/participant-runner.{d.ts,js}` (`shouldJoin` per-advert, `cohort-joined` = opt-in sent, `#handleOptInAccept` emits nothing, `cohort-ready`), `participant/participant.d.ts` (no `leaveCohort`), `participant/events.d.ts` (event list), `service/service-runner.js` (`onReadyToFinalize` default = finalize at `minParticipants`; `maxParticipants` ceiling ignore; `#stopAdvertRepeating`), `service/service.d.ts` + `core/conditions.d.ts` (`maxParticipants` "accept/finalize ceiling"), `core/phases.d.ts` (`ServiceCohortPhaseType`), `core/messages/constants.d.ts` (no opt-in-reject, no leave message), `service/http-server.d.ts` (advert cache `advertTtlMs` default 5 min; `RateLimiter`).
- This repo: `packages/participant/src/index.ts` (`shouldJoin` today), `packages/web/src/stores/participant.ts` (`join`/`leave`/`teardownLive`/`JOIN_WATCHDOG_MS`), `packages/service/src/operator-cohorts.ts` (`DirectoryCohortDTO`, `OPEN_PHASES`, `directory()`/`status()`), `packages/service/src/index.ts` (`createService` does NOT override `onReadyToFinalize`; `onOptInReceived` only with `rosterPks`), `packages/service/src/demo-server.ts` (`cohortTtlMs=180000`/`phaseTimeoutMs=60000`), `packages/service/src/hono-adapter.ts` (`/v1/directory`, `/v1/status`, `/v1/adverts` mounts; no join route), `packages/web/src/lib/operator.ts` (`fetchDirectory`/`fetchStatus`, `credentials:'omit'`), `packages/web/src/components/operator/PublicStatus.tsx` (poll pattern), `packages/web/src/App.tsx` (route composition), `packages/web/src/components/participant/{ParticipantView,KeyGenPanel}.tsx` (tail + identity gate), `e2e/operator-cohort.ts` (hermetic capstone model; `threshold===capacity===2`; advert-cache replay note).

### Secondary (MEDIUM confidence)
- None required; all claims trace to primary source above.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack (zero new packages): HIGH - installed versions verified; no install.
- Architecture / join semantics: HIGH - verified line-by-line against `@did-btcr2/aggregation@0.4.0` source and repo source.
- Pitfalls (finalize-at-threshold, no reject/leave signal, advert cache): HIGH - verified in the library runner + transport source.
- Assumptions (A1 threshold==capacity norm): MEDIUM - a product/UX convention, flagged for discuss/UI.

**Research date:** 2026-07-14
**Valid until:** 2026-08-13 (stable; re-verify only if `@did-btcr2/aggregation` is bumped past `0.4.0`, since the finalize/accept/reject semantics are version-specific).
