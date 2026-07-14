# Phase 2: Participant Discovery + Browse-and-Pick Join - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning

<domain>
## Phase Boundary

A participant pointed at a service's URL browses that service's advertised open cohorts (from the `GET /v1/directory` endpoint Phase 1 shipped) and joins **one by choice**, replacing today's `shouldJoin: async () => true` auto-accept that joins *every* advert arriving on `/v1/adverts` (`packages/participant/src/index.ts:120`). This is the participant-discovery half of the two-sided product: the operator (Phase 1) populates the directory; the participant now browses it and picks.

**Requirements:** PART-01 (browse a service's open cohorts with enough per-cohort detail to choose), PART-02 (join a chosen open cohort, not auto-join whatever arrives).

**In scope:** the participant's browse surface as the landing at `/` (service-identity header + a polled directory list); anonymous browsing (no keypair to look); an explicit inline identity step at the Join moment; picking a specific open cohort and joining only that one; server-authoritative seating with graceful full/closed handling; a clear "seated" resting confirmation from which the existing submit/co-sign/resolve tail keeps working; plain-language cohort status; reuse of the shipped `GET /v1/directory` + `GET /v1/status` read side and the Phase 1 design system.

**Out of scope (later phases / v2):** rewiring/redesigning the submit -> co-sign -> track -> resolve tail into the discover-first flow and retiring the standalone stepper as a code path (Phase 3); rich operator-side live monitoring (Phase 4); operator open/close/finalize + pause/cancel + reconfigure + explicit seat reclaim (Phase 5); stranger-to-stranger e2e + the systematic booth/attendee framing sweep (Phase 6); concurrent multi-cohort join + a management view (v2 PMG-01); durable state across restart (v2 DUR-01); a cross-origin roaming client that points at an arbitrary service URL (v2 PMG-01 / the Phase 1 D-02 rejected two-app split).
</domain>

<decisions>
## Implementation Decisions

### Connection model + service identity (Area 1)
- **D-01:** **Same-origin, no URL input** - the directory a participant browses is the directory of the service that served the page. "Point a participant at a service's URL" is satisfied by *navigating the browser to that service's domain*; `baseUrl = window.location.origin` (already how the SPA works, `App.tsx:15`). This holds Phase 1's D-01 (one same-origin deployment) and ADR 0005. A cross-origin URL-input roaming client was explicitly **not** chosen (v2 PMG-01; would force CORS onto every route + the hand-rolled SSE path).
- **D-02:** **Show a service-identity header** on the browse surface so "this is a specific service's directory" is legible: service **origin** + **active-network badge** + **open-cohort count**, all reusing the data `PublicStatus` already surfaces from `GET /v1/status` (**zero new backend**). An operator-set friendly service name and a coordinator-DID display were considered and **deferred** (see Deferred Ideas).

### Browse-before-identity ordering (Area 2)
- **D-03:** **Browse first, identity at Join** (gradual engagement / lazy registration). Browsing `GET /v1/directory` is anonymous (a public read, no keypair). A did:btcr2 identity is acquired **only** when the participant picks a cohort and acts to join. This turns the current KeyGen-first linear stepper into a discover-first flow.
- **D-04:** **Explicit inline identity step at Join** (not silent auto-mint). Clicking Join on the chosen cohort reveals an identity panel (reuse the existing KeyGen / import panels): **generate a new KEY identity (default)** or **import an existing/EXTERNAL (x1) identity**, with key custody visible, then confirm to join. **Both onboarding models stay available**; no key material is minted behind the participant's back (the caveat the UX research flags for real DID keypairs).

### Directory freshness (Area 3)
- **D-05:** **Poll `GET /v1/directory` every ~5s**, reusing the proven `PublicStatus` polling pattern (which already polls `/v1/status` every 10s). The one authoritative endpoint refreshes **both** newly-advertised cohorts **and** live seat counts, with **no new SSE consumer wiring** in the browse UI. Adverts are operator-driven and infrequent, so polling overhead is negligible. A live-SSE directory (via the existing public `/v1/adverts`) is **deferred** as a later enhancement.

### Join enforcement + multiplicity (Area 4)
- **D-06:** **Server-authoritative join.** A join only counts when the service **seats** the participant against the live runner set. If the picked cohort filled or transitioned out of the open phases during the poll window, the service **rejects** and the UI returns to browse with a specific message ("that cohort just filled/closed - pick another"). The list **also** client-side disables Join on rows already shown full/closed (belt-and-suspenders), but the server is the source of truth. This is how criterion 3 ("a full or closed cohort cannot be joined") is guaranteed against the poll-window race.
- **D-07:** **One cohort at a time (sequential).** Pick+join a single cohort; to join another, leave/finish then pick again. Satisfies PART-02's "potentially across more than one cohort" in the sequential sense and matches today's "one cohort per Join" (`participant.ts:507`). Concurrent multi-cohort join + management is **deferred to v2 (PMG-01)**.

### Directory presentation - detail, status labels, ordering (Areas 5, 12, 9)
- **D-08:** **Per-cohort detail = required fields + n-of-n threshold + cohort id**, all from the existing `DirectoryCohortDTO` (`cohortId/beaconType/network/threshold/capacity/joined/phase`) - **zero new backend**. Each row shows: beacon type (with a short human gloss), active-network badge, seats `{joined}/{capacity}` (+ remaining), status label, the **n-of-n threshold** (how big the co-sign group is), and the **cohort id** as `Mono`/`CopyField`. Enough to distinguish cohorts and gauge fill-likelihood + co-sign size. A TTL/expiry countdown (needs new DTO fields) was considered and **deferred**.
- **D-09:** **Plain-language cohort status labels.** Map the raw protocol phase (`Advertised` / `CohortSet` / `CollectingUpdates`) to clear labels a stranger understands ("Open" / "Filling" / "Collecting updates" - exact copy is a UI-phase call), no booth/attendee framing. The raw phase may appear on hover / as `Mono` if useful.
- **D-10:** **Newest-advertised first; no filter controls in the MVP.** The service targets **one active network** (Phase 1 D-10), so a network filter is moot; a beacon-type filter is premature for a small list. Sort/filter controls are **deferred** until the list grows.

### Seated end-state + Phase 2/3 boundary (Area 6)
- **D-11:** After join, a clear **seated confirmation** ("You're seated in cohort X - `{joined}/{capacity}`, status"). From that seated state the **existing submit/co-sign/resolve tail keeps working unchanged** (reuse today's panels + participant-store logic), so once the cohort fills the full lifecycle still completes and **nothing breaks**. Phase 3 formally **rewires/redesigns** that tail into the discover-first flow and retires the standalone stepper as a code path. Keeps every phase demoable and the lifecycle unbroken (the project's "keep the gate green" rhythm).

### Non-happy paths - empty / unreachable / failed join (Area 7)
- **D-12:** **Reuse Phase 1's empty/status patterns and keep three states distinct.** (a) **Directory empty** = benign: reuse the shipped copy ("This service isn't advertising any cohorts right now. Check back soon.") and keep polling so a newly-advertised cohort appears automatically. (b) **Service unreachable / directory fetch error** = a distinct "can't reach this service" state with auto-retry (the poll continues). (c) **Failed join** = a specific message + return to browse. Because browse-and-pick joins a **known** cohort, **replace the current vague "no advert received" watchdog** (`participant.ts:531`, `JOIN_WATCHDOG_MS`) with the **deterministic join response** (seated, or a clear full/closed/error rejection) - no dead spinners.

### Landing + stepper coexistence (Area 8)
- **D-13:** **The directory is the participant's landing at `/` now.** The service-identity header + browse directory is the front door; pick+join flows into the reused tail (inline identity -> seated -> existing co-sign/resolve panels). The old standalone **KeyGen-first ENTRY is replaced this phase**. (The pre-existing browser e2e is already red / deferred to Phase 6, so nothing blocks replacing the entry now. Full retirement/redesign of the *tail* remains Phase 3.)

### Join mechanism direction (Area 10)
- **D-14:** **Intended direction = join-by-filter.** Start the participant runner, subscribe to `/v1/adverts`, and have `shouldJoin` return true **only for the picked cohortId** (replace today's `return true` at `packages/participant/src/index.ts:120-123` with `advert.cohortId === pickedId`). Minimal change, reuses existing machinery, deterministic single-cohort join. **Research validates** exact timing/edge cases (e.g. the advert for the picked cohort is no longer being broadcast -> the D-06/D-12 graceful reject; whether a more targeted opt-in fits the library surface better).

### Seat lifecycle - leave + abandoned seats (Areas 11, 13)
- **D-15:** **Client-side leave + rely on existing TTL reclaim.** Wire the existing `leave()` action (`participant.ts:164`, `teardownLive`) into browse-and-pick so "leave" returns to the directory. If the library exposes a participant **opt-out** signal, send it for immediate seat release; otherwise the abandoned seat is reclaimed by the existing `PHASE_TIMEOUT_MS`/`COHORT_TTL_MS` machinery. **No new seat-release protocol is built** (honors "consume the published `@did-btcr2/*`, don't fork"). Research confirms whether an opt-out exists.
- **D-16:** **Abandoned-seat reclaim relies on the existing TTL.** Phase 2 builds no new seat-reclaim machinery; a seat abandoned by a closed tab / disconnect before the cohort fills is reclaimed by the existing `PHASE_TIMEOUT_MS`/`COHORT_TTL_MS`. Good enough for the MVP; active/operator reclaim is **Phase 5** lifecycle control, durable state is **v2 (DUR-01)**. Noted as a known limitation for a public stranger-facing deploy.

### Claude's Discretion
Left to research/planning + the UI phase (implementation-level, not vision calls):
- The exact browse layout (cards vs list rows) and which `DirectoryCohortDTO` fields render where; the exact per-cohort card composition from the Phase 1 primitives.
- The precise poll interval value (~5s is the target) and the polling/backoff mechanics.
- The precise runner lifecycle for join/leave under join-by-filter (D-14) and whether the library exposes a participant opt-out for immediate seat release (D-15).
- The server-side shape of a rejected join (status code + DTO) and how the directory read distinguishes full vs closed for the D-06 graceful message.
- Exact copy strings (status labels, empty/error/seated messages) - UI phase.
- The browse route/component structure: a new browse component vs restructuring `ParticipantView`/`FlowStepper`; whether the public browse helpers move out of `lib/operator.ts` into a neutral lib.
- The seated-state UI treatment and exactly how the reused tail panels are reached from it.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap (this milestone)
- `.planning/PROJECT.md` - two-sided self-hostable North Star; constraints (config-driven single active network; no unauthenticated mutating/control surface; single-box single-process in-memory); Key Decisions (per-service directory shipped Phase 1).
- `.planning/REQUIREMENTS.md` - **PART-01** (browse), **PART-02** (join by choice); v2 **PMG-01** (concurrent multi-cohort management) + **DUR-01** (durability); Out of Scope table (federated registry, invite-only discovery, multi-instance).
- `.planning/ROADMAP.md` - Phase 2 goal + success criteria (esp. criterion 3: seated + counts against capacity, full/closed cannot be joined); **Phase 3 boundary** (owns the submit/co-sign/track/resolve tail rewire + standalone-stepper retirement).

### Prior phase (the directory + auth this phase builds on)
- `.planning/phases/01-authenticated-operator-console-on-demand-cohort-creation/01-CONTEXT.md` - Phase 1 D-01 (same-origin, one deployment), D-09 (public status = up/network/open-count), D-14/D-15 (directory built read-side, derives from the live advertised set - **single source of truth, no parallel list**), D-10 (single active network).
- `.planning/phases/01-authenticated-operator-console-on-demand-cohort-creation/01-03-SUMMARY.md` - the shipped `advertiseDraft` + `GET /v1/directory` + `GET /v1/status` implementation Phase 2 consumes: `OPEN_PHASES = {Advertised, CohortSet, CollectingUpdates}`, the `DirectoryCohortDTO` field set (`cohortId/beaconType/network/threshold/capacity/joined/phase`), `ServiceStatus` (`up/network/openCohorts`), and the note that `e2e/browser-cohort.ts` / `browser-prod-cohort.ts` still assume the removed auto-advertise loop and need rewiring.
- `.planning/phases/01-authenticated-operator-console-on-demand-cohort-creation/01-UI-SPEC.md` - the design system to EXTEND (in-house primitives, dark-slate + bitcoin-orange tokens, typography/spacing scales, copywriting contract) and the empty-state copy to reuse ("This service isn't advertising any cohorts right now.").

### Architecture + topology ADRs (do not violate)
- `docs/adr/0003-same-origin-topology.md` - one origin/port serves API + SPA, no CORS; the browse surface lives inside this.
- `docs/adr/0005-bind-globalthis-fetch-in-browser.md` - browser base URL = `window.location.origin` (why D-01 is same-origin, not cross-origin).
- `docs/adr/0004-dashboard-sse-telemetry-channel.md` - the public advert/telemetry SSE context; `/v1/adverts` is the public protocol channel the join-by-filter (D-14) rides.
- `docs/adr/0015-operator-authentication.md` - the Phase 1 public-vs-gated route split; **`/v1/directory` + `/v1/status` are public/anonymous** (the participant browse reads them without a session), while operator telemetry is gated.
- `docs/adr/0014-deployment-topology.md` - single-box, one process, one-image-any-network; single active network per boot.

### Codebase maps (analysis 2026-07-07)
- `.planning/codebase/ARCHITECTURE.md` - component/route map; the "Coordinator tab looks like an admin console but isn't" note; the participant data path.
- `.planning/codebase/STRUCTURE.md` - package/file layout for the web + participant packages.
- `.planning/codebase/CONVENTIONS.md` - house style, naming, `.js`-extension imports, comment-density expectation, clean framing.

### Key source files this phase reshapes
- `packages/participant/src/index.ts` - `createParticipant` + the `shouldJoin` auto-join (`:120-123`) to narrow to the picked cohortId (D-14); the join/leave lifecycle.
- `packages/web/src/stores/participant.ts` - the browser participant state machine: `join(baseUrl)`, `leave()` (`:164`), `teardownLive` (`:239`), the "one cohort per Join" stop (`:507`), and the `JOIN_WATCHDOG_MS` "no advert received" watchdog (`:231`/`:531`) to replace with a deterministic join outcome (D-12).
- `packages/web/src/lib/operator.ts` - already exports the **public** `fetchDirectory`/`fetchStatus` (`credentials: 'omit'`) + `DirectoryCohortDTO`/`ServiceStatus` types the browse reuses (consider relocating out of the operator-named lib since they are not operator-only).
- `packages/web/src/components/operator/PublicStatus.tsx` - the anonymous status card + its 10s polling pattern; the model for the ~5s directory poll (D-05) and the service-identity header (D-02).
- `packages/web/src/App.tsx` - the anonymous surface (`:70-71` renders `PublicStatus` + `ParticipantView`); restructure so the **directory is the landing at `/`** (D-13).
- `packages/web/src/components/participant/*` - `ParticipantView`, `FlowStepper`, `KeyGenPanel`, `RegisterPanel`, `PublishPanel`, `ResolvePanel`, `ResultCard`: the entry is replaced (D-13); KeyGen moves to the inline identity step (D-04); Register/Publish/Resolve are the **reused tail** (D-11).
- `packages/service/src/operator-cohorts.ts` - `directory()`/`status()` (the read side the browse consumes) + where server-authoritative join enforcement (D-06) reasons about the live set.
- `packages/service/src/hono-adapter.ts` - the `GET /v1/directory` + `GET /v1/status` route mounts and where any join-related server behavior maps.
- `packages/web/src/ui/primitives.tsx` - `Card`/`Button`/`Badge`/`StatusDot`/`Mono`/`CopyField` + Phase 1's new `Input`/`Select`/`Field`: build the browse list + inline identity step from these.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`GET /v1/directory` (`DirectoryCohortDTO`) + `GET /v1/status` (`ServiceStatus`)** - shipped in Phase 1, derived from the live runner set (single source of truth, no parallel list). The browse data source; all D-08 detail fields already exist in the DTO (zero new backend).
- **`lib/operator.ts` `fetchDirectory` / `fetchStatus`** (public, `credentials: 'omit'`) + the `DirectoryCohortDTO` / `ServiceStatus` types - reuse directly for the participant browse.
- **`PublicStatus.tsx` polling pattern** (10s `/v1/status`) - the model for the ~5s directory poll (D-05) and the service-identity header (D-02, origin + network + open count).
- **`createParticipant` / `shouldJoin`** (`packages/participant/src/index.ts`) - the join hook to narrow to the picked cohortId (D-14); currently `shouldJoin: async () => true` (auto-join every advert).
- **The participant store's `leave()` + `teardownLive()`** - wire into browse-and-pick "leave" (D-15).
- **The existing tail** (`RegisterPanel`/`PublishPanel`/`ResolvePanel`/`ResultCard` + the participant store's register/submit/co-sign/resolve logic) - reused **unchanged** post-seat (D-11).
- **`ui/primitives.tsx`** (incl. Phase 1's `Input`/`Select`/`Field`) - build the browse list rows/cards + the inline identity step.
- **Network registry + `GET /v1/config`** (`packages/shared/src/networks.ts`) - the single active network shown per cohort (D-08) and in the service-identity header (D-02).

### Established Patterns
- **Same-origin, sans-I/O transport + one adapter** (`hono-adapter.ts` is the sole HTTP mount) - the browse reads and any join-enforcement route land here.
- **Config-driven single active network** (Phase 1 D-10) - all directory cohorts share the service's active network, which is why a network filter is moot (D-10 here).
- **Directory derives from the live runner set** (single source of truth, Phase 1 D-15) - the browse MUST consume `/v1/directory`, never maintain a parallel client-side cohort list.
- **Per-`createService` in-memory state; no durability** (DUR-01 is v2) - abandoned seats reclaim via existing TTL, not persisted state (D-16).
- **House style:** explicit `.js` import extensions, module-prefixed `console.*` logging, manual shape guards at each untrusted HTTP boundary, fire-and-forget side effects with `.catch()`, and **clean operator/service/aggregator framing** (introduce no new booth/attendee wording - D-09 labels stay plain and clean).

### Integration Points
- Participant browse UI <-> `GET /v1/directory` + `GET /v1/status` (public reads, ~5s poll).
- `createParticipant.shouldJoin` <-> the picked cohortId (join-by-filter, D-14).
- Server-authoritative join enforcement <-> `operator-cohorts.ts` / runner live set (full/closed reject, D-06).
- Landing route `/` <-> `App.tsx` restructure (directory becomes the front door, D-13).
- The reused tail <-> the existing participant-store submit/co-sign/resolve logic (D-11).
</code_context>

<specifics>
## Specific Ideas

- The owner drove hard toward **thoroughness** (repeatedly chose "explore more gray areas"), and consistently selected the **pragmatic MVP option that reuses shipped Phase 1 assets with zero/minimal new backend**, honoring the "consume the library, don't fork," "single active network," and "single-process in-memory" constraints.
- The owner confirmed **same-origin** browsing (no cross-origin URL input) and the **browse-first, identity-at-join** gradual-engagement model, with an **explicit** (not silent) identity step because the participant controls a real DID keypair.
- The owner chose to make the **directory the participant's landing now** (replacing the standalone stepper entry this phase), front-loading part of Phase 3's entry change while leaving the *tail* rewire to Phase 3 so the lifecycle stays unbroken.
- The owner accepted **server-authoritative join** (client-side disable is only belt-and-suspenders) and **one-cohort-at-a-time** sequential joining for v1.
</specifics>

<deferred>
## Deferred Ideas

- **Operator-set friendly service name** in the service-identity header (a new operator config field + edit surface) - considered for D-02, deferred (its own scope; touches the operator side).
- **Coordinator/aggregator DID display** in the service-identity header - optional, deferred (small `/v1/status` add if wanted later).
- **Live-SSE directory** (via the existing public `/v1/adverts`) instead of polling - a later enhancement; polling is the MVP (D-05).
- **Per-cohort TTL/expiry countdown** ("closes in ~Xm", needs new DTO fields off `COHORT_TTL_MS`/`PHASE_TIMEOUT_MS`) - deferred (D-08).
- **Concurrent multi-cohort join + a management view** - v2 **PMG-01** (D-07).
- **Directory sort/filter controls** (by beacon type, etc.) - deferred until the list grows (D-10).
- **Explicit/immediate server-side seat-release + active abandoned-seat reclaim** - Phase 5 lifecycle control (and likely needs library support) (D-15/D-16).
- **Durable cohort/participant state across restart** - v2 **DUR-01** (D-16).
- **Full retirement/redesign of the submit/co-sign/track/resolve tail into the discover-first flow + standalone-stepper removal as a code path** - **Phase 3**.
- **Systematic booth/attendee framing sweep** - **Phase 6** (HOST-03); new Phase 2 code uses clean framing.
- **Cross-origin roaming participant client** (point at any service URL) - v2 **PMG-01** / the Phase 1 D-02 rejected two-app split.
- **Rewiring the pre-existing `e2e:browser` / `e2e:browser:prod` (booth-topology, already red since Phase 1)** - Phase 6 CI debt; Phase 2 should not rely on them and may need a fresh hermetic browse->pick->join proof.

None of these are Phase 2 scope; discussion stayed within the phase boundary.
</deferred>

---

*Phase: 2-participant-discovery-browse-and-pick-join*
*Context gathered: 2026-07-14*
