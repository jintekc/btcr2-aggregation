# Phase 3: Participant Submit, Co-Sign, Track, and Resolve - Research

**Researched:** 2026-07-17
**Domain:** Brownfield rewiring: participant store/UI restructure over the existing `@did-btcr2/aggregation@0.4.0` runner + one minimal new public read; zero new packages
**Confidence:** HIGH (all load-bearing claims verified against the local codebase and the installed library source/types)

<user_constraints>
## User Constraints (from 03-CONTEXT.md)

### Locked Decisions

**Post-seat journey shape (the live cohort page)**
- **D-01:** One live cohort page for the whole journey: the Phase 2 seated card grows into a live stage timeline (Waiting for seats -> Seated -> Submit update -> Co-signing -> Anchored/Signed -> Resolved); each action renders inline at the stage that needs it. Not a wizard, not status-plus-modals.
- **D-02:** The page absorbs the Phase 2 waiting-for-seats state - one continuous surface from join onward; the Phase 2 waiting line and seated card become the first stages. No handoff seam between Phase 2 and Phase 3 states.
- **D-03:** Directory stays reachable mid-flight. The cohort page is a distinct view; a persistent "Your cohort" link returns to it; Join is disabled on other rows (one-cohort-at-a-time). The "Your cohort" link carries the live current stage (label/dot updates); no browser notifications. Exception: see D-13 (submit-window urgency may also change the tab title).
- **D-04:** The joined cohort's directory row gets a distinct "You're in this cohort" state with a View action to the live page (not a disabled Join).
- **D-05:** Full timeline upfront with future stages dimmed as pending; the active stage shows a quiet elapsed-time indicator (no countdowns, no duration promises).
- **D-06:** Plain-language stage labels + expandable technical detail (raw protocol phase, cohort id, beacon address, txid as Mono/CopyField), extending Phase 2's D-09 precedent. A compact identity section shows the participant's own DID (Mono/CopyField), onboarding model, and the key-custody note.
- **D-07:** Mode-honest anchor copy: "Anchored" with txid appears only when a real broadcast+confirm happened; on the default hermetic (no-broadcast) service the stage reads as signed/complete without claiming an on-chain anchor. Never lie on the fixture path.
- **D-08:** Keep-tab-open posture: truthful copy that a refresh mid-flight loses the seat (existing TTL reclaim); no identity persistence or re-attach this phase (v2 DUR-01). Aggregate counts only about other members (seats, updates submitted, co-sign progress) - never member identities.
- **D-09:** Leave hides once the cohort locks into signing (Leave remains only while waiting for seats); copy explains the participant is committed through anchoring.
- **D-10:** End states live on the cohort page: a persistent completion summary (resolved DID document, anchor reference, "Browse cohorts" CTA) that is replaced on the next join (no history - v2 PMG-01); terminal failures land on the page with a plain-language reason + "Back to cohorts"; cooperative non-inclusion is a distinct non-error outcome ("the cohort proceeded without your update, here's why") that keeps reporting the cohort's anchor result. A "Start over" action from any terminal state clears the record AND the in-memory identity behind an explicit key-custody warning.
- **D-11:** Internal SPA view state, no routed URL for the cohort page this phase (live state is tab-bound anyway; a routed `/cohorts/:id` is deferred).

**Submit moment + update content**
- **D-12:** Explicit submit action ("Submit my DID update") - the update is provided to the round when the participant clicks. Auto-built canonical update (append the cohort's beacon service via the existing `buildSignedUpdate` path) with a plain-language preview + raw signed-update JSON expander before confirming; no document editing.
- **D-13:** Miss-the-window treatment: when the submit window opens, escalate attention (prominent stage treatment + tab-title change, the one exception to D-03's quiet indicator); if the window closes unanswered, land in the honest outcome (not-included or stalled, per what the protocol actually does - research confirms which).
- **D-14:** One consent at submit covers the whole signing round, including the beacon transaction signature; the preview includes one plain line about the beacon commitment ("your signature helps anchor this cohort's aggregated update commitment at beacon address X", live/hermetic distinction in copy), tx detail in the raw expander. No second mid-round approval gate.
- **D-15:** No sit-out UI - once locked, submit is the only forward path; voluntary cooperative non-inclusion stays a protocol behavior, not a button (deferred idea).
- **D-16:** KEY golden path, x1 kept working: the generated-KEY identity is the polished path through submit/track/resolve; imported EXTERNAL/x1 identities (Phase 2 inline identity already accepts them) keep working through join/co-sign and resolve via the existing sidecar machinery, but their polish is a fold-in behind the core, not a Phase 3 criterion.
- **D-17:** Conditional stages for accreted features: on a live+broadcast service, the KEY first-update registration (fund genesis beacon + OP_RETURN, ADRs 0007/0008) appears as a conditional stage reusing shipped RegisterPanel logic (hermetic services never show it; research confirms protocol ordering). When the service advertises IPFS (ADR 0011), the opt-in publish/pin affordance rides the submit stage the same way.
- **D-18:** Identity reuse across cohorts: when an identity is already in memory, the join identity step offers "use current identity" as the default alongside generate/import - enabling the same DID to accumulate aggregate updates across cohorts (versionId N+1). Research confirms the second-update path resolves cleanly.
- **D-19:** Import-time fit validation: the join identity step runs the client-side fit checks possible before seating (network match; the beacon/genesis fit classification the participant package already computes) and warns with an informed "join anyway" choice - never blocks. Late cooperative non-inclusion remains the honest backstop.

**Tracking source + degraded states**
- **D-20:** Progress data = participant runner events client-side for protocol stages (the in-tab runner already observes them) + the existing ~5s directory poll for cohort-level facts + the smallest new PUBLIC anchor-status read (anchor events currently reach only the operator-gated `/dashboard/events`). Research sizes that read (per-cohort anchor state: none/broadcast/confirmed + txid).
- **D-21:** Anchor status is a public/anonymous read - anchor facts are public chain data; matches the unauthenticated `/resolve` + `/cas` ethos. Phase 4 seam: minimal now, Phase 4 extends the same pattern for the gated operator view; no speculative fields.
- **D-22:** Anchor stage granularity (broadcast-enabled): Signed -> Broadcast (txid + explorer link) -> Confirmed, mirroring the existing `beacon-broadcast` vs `beacon-anchored` events; freeze at first confirmation (no live conf count, no reorg UX - the explorer link carries depth-watching).
- **D-23:** Explicit k-of-n fallback outcome: if the ADR-042 script-path fallback rescues a stall, the timeline says the cohort anchored via the fallback path with k of n signatures and whether the participant's update was included (extends the Phase 2 G-02-1 honesty).
- **D-24:** Service-unreachable treatment (closes 02-09 WR-02): consecutive poll/SSE failures raise a distinct "can't reach this service" banner with quiet auto-retry; stages freeze honestly; terminal failure only when the in-tab runner errors or the cohort is gone on reconnect.
- **D-25:** Failure reasons are best-effort specific (phase timeout, cohort vanished, runner error, seat lost) with an honest "the cohort ended and this service didn't say why" fallback; no invented certainty.
- **D-26:** In-flight cohorts stay listed in the public directory as honest non-joinable "In progress" rows until anchored/ended (joinable stays Advertised-only per Phase 2); the service looks alive to strangers.
- **D-27:** A timestamped activity log (joined/locked/submitted/broadcast at...) accumulates inside the technical detail expander - clean stages for strangers, auditable client-observed trail for practitioners.

**Resolve + stepper retirement**
- **D-28:** Auto-resolve when the anchor stage completes (GET `/resolve/:did`; the x1 sidecar POST variant for imported identities) with a "Resolve again" re-run action; resolve is a read, so automation is harmless. Honest retry on resolver lag: brief "resolving..." retries; if the update still is not reflected, say so plainly (research checks whether lag is possible on fixture/live paths).
- **D-29:** Truthful round-trip check: the completion summary compares the resolved document against the submitted update and states the result plainly ("your update is reflected" or an honest mismatch warning).
- **D-30:** Presentation: plain-language result (beacon service added, version N) + the full DID document and resolution metadata behind the raw-detail expander; sidecar/artifact export offered in the completion summary (existing export logic reused) with copy explaining its purpose.
- **D-31:** Stepper retirement = delete dead code: the FlowStepper shell + standalone entry wiring are removed; surviving panel logic is absorbed as stage internals (KeyGen/import live ONLY in the Phase 2 inline join identity step - one identity moment in the app; Register/Publish/Resolve logic inside stages). The old booth-topology browser e2e is already red and owned by Phase 6.

**Proof + solo testing**
- **D-32:** Browser-level hermetic capstone e2e (playwright-core, local like `e2e:kofn`; CI wiring stays Phase 6 debt): browse -> pick -> join -> explicit submit click -> co-sign -> mode-honest signed state -> auto-resolve -> round-trip check, with headless peers filling seats. Criterion 4 (the stepper is no longer the entry path) is provable only at the browser level.
- **D-33:** No solo-demo affordance this phase: the dev-only FILLERS env (Phase 1 D-18) covers self-testing and the docs should mention it; a first-class operator "test peers" control would be Phase 5 scope.

### Claude's Discretion
Left to research/planning (implementation-level, not vision calls):
- The exact shape/path of the minimal public anchor read (new route vs a field on an existing read) and its polling mechanics.
- What the protocol actually does when a seated participant never submits (stall vs non-inclusion) - drives the D-13 outcome copy.
- Whether a signing pause hook exists in the runner (context for D-14; the decision stands regardless).
- Exact stage copy, empty/error strings, and the visual treatment of stages/expander (UI phase).
- The store restructure (how `participant.ts` absorbs stages, log accumulation, epoch/staleness guards).
- Which client-side fit checks are reliably computable pre-seat for D-19.
- Registration/IPFS stage ordering details relative to submit/anchor (D-17), from research on the shipped flows.
- e2e harness structure for the browser capstone and which existing harness it extends.

### Deferred Ideas (OUT OF SCOPE)
- Routed `/cohorts/:id` URL for cohort pages - pairs with Phase 4 operator monitoring patterns (D-11).
- Session-local completed-cohort history list - v2 PMG-01 territory (D-10).
- Identity persistence / mid-flight re-attach across refresh - v2 DUR-01 (D-08).
- Explicit voluntary sit-out (co-sign without including an update, as a user action) - deferred unless demand appears (D-15).
- User-editable DID update content (services/keys before signing) - its own phase if ever (D-12).
- Full x1/EXTERNAL polish parity through the new tail - fold-in behind the core after Phase 3 (D-16).
- Live confirmation-count / reorg UX beyond first confirmation - explorer link carries it (D-22).
- Operator "test peers" control for solo demos - Phase 5 lifecycle-control scope (D-33).
- Full per-cohort status DTO (members/submissions/co-sign progress) - Phase 4 designs it, extending the minimal anchor read pattern (D-21).
- Tab-title notifications beyond the submit-window urgency exception - considered, not chosen (D-03/D-13).
- CI wiring of the new browser capstone + rewiring `e2e:browser`/`e2e:browser:prod` - Phase 6 debt (D-32).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PART-03 | Participant can submit a DID update and take part in the cohort's n-of-n MuSig2 co-signing round | Finding 1 (deferred `onProvideUpdate` is the explicit-submit mechanism); Finding 2 (never-submit = whole-cohort stall, not non-inclusion); Finding 3 (`onApproveSigning` hook exists, default approve); Reusable assets: `buildSignedUpdate`, `getSubmittedUpdate`, participant runner events |
| PART-04 | Participant can track co-sign and anchor progress for a joined cohort and resolve the updated DID once it is anchored | Finding 4 (public anchor read design + retained anchor-state map); Finding 5 (D-26 in-flight directory rows); Finding 7 (resolve is mode-dependent: hermetic resolves to genesis, so the round-trip check must be mode-honest); Finding 8 (registration/IPFS stage ordering - both post-completion) |
</phase_requirements>

## Summary

Phase 3 is a client-heavy rewire with one small server addition. Everything the phase needs already exists: the participant runner emits every protocol lifecycle event the stage timeline requires (`cohort-joined/ready`, `update-submitted/declined`, `validation-requested`, `signing-requested`, `fallback-requested`, `cohort-complete/failed`) [VERIFIED: library d.ts `participant/events.d.ts`]; the submit/register/publish/resolve logic already lives in `participant.ts` + the four tail panels; and the anchor lifecycle events already exist server-side (`BeaconBroadcaster`) but only reach the operator-gated `/dashboard/events`. The work is: (1) restructure `packages/web/src/stores/participant.ts` from the four-step `StepKey` model into the D-01 stage model with a **deferred explicit submit**, (2) build the one live cohort page absorbing the Phase 2 waiting/seated states and the four tail panels' logic, (3) add a minimal public anchor read backed by a small retained anchor-state map fed by `BeaconBroadcaster`, (4) widen the public directory to list in-flight cohorts as non-joinable rows (D-26), (5) delete the FlowStepper/ParticipantView/KeyGenPanel dead-code entry path, and (6) a browser-level hermetic capstone e2e extending `e2e/lib/browser-harness.ts` + the `browse-join-cohort.ts` service-boot pattern.

Three research findings materially shape the plans. First, the explicit-submit moment (D-12) maps exactly onto the library's design: `onProvideUpdate` is an async callback the runner awaits (`Promise<SecuredDocument | null>`), so the store resolves a module-scope deferred when the user clicks - no library change, no polling. Second, the D-13 "window closes unanswered" outcome is now settled from library source: the service advances past CollectingUpdates **only when ALL n members respond** (`hasAllResponses()`), and the ADR-042 fallback salvages ONLY the three signing phases - so a seated participant who never submits stalls the WHOLE cohort until `phaseTimeoutMs` expires it for everyone (outcome copy: "the cohort ended - it stalled waiting for updates"; there is no per-member forfeit). Third, the D-17 phrasing "IPFS rides the submit stage" cannot be implemented literally: the shipped publish path requires artifacts that exist only at `cohort-complete` (`result.included` + sidecar), so both conditional fold-ins (registration AND IPFS publish) are post-completion stages, matching today's shipped ordering.

**Primary recommendation:** Keep `participant.ts` as the single lifecycle owner (Phase 2's proven pattern), add a `pendingSubmit` deferred + a derived `stage` selector instead of parallel state, add one new service module (`anchor-state.ts`: bounded map + public `GET /v1/anchor/:cohortId`), and prove criterion 4 with a browser capstone that boots the operator flow from `browse-join-cohort.ts` and drives one real Chromium page while headless in-process peers fill the remaining seats.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Explicit submit gate (deferred `onProvideUpdate`) | Browser/Client (participant store) | - | The runner runs in-tab; the submit decision is the user's, held client-side; the service just receives the signed update |
| Signed-update build + preview | Browser/Client (shared `buildSignedUpdate`) | - | BIP340 signing happens with the in-browser key; the preview renders the exact body that will be submitted |
| Stage timeline state | Browser/Client (Zustand store) | - | Derived from in-tab runner events + polls; tab-bound by design (D-08, no durability) |
| Anchor state (broadcast/confirmed + txid) | API/Backend (new `anchor-state.ts` + public route) | Browser polls it | Anchor events originate server-side in `BeaconBroadcaster`; SSE frames are transient so a poll read needs retained last-known state |
| In-flight directory rows (D-26) | API/Backend (`operator-cohorts.ts` directory read) | Browser renders | Directory derives from `runner.session.cohorts` (Phase 1 D-15); no parallel client list |
| Resolve + round-trip check | API/Backend resolves (`GET/POST /resolve/:did`); Browser compares | - | Resolution must run server-side (native `level` deps, ADR 0007); the comparison input (`getSubmittedUpdate`) exists only in-tab |
| Service-unreachable banner (D-24) | Browser/Client | - | Consecutive-failure counting over the existing poll/SSE; server cannot report its own absence |
| Capstone proof (criterion 4) | e2e (playwright-core browser + in-process peers) | - | "Stepper is no longer the entry path" is only observable at the rendered-UI level |

## Standard Stack

### Core (all existing - zero new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@did-btcr2/aggregation` | ^0.4.0 (installed 0.4.0) | Participant/service runners, transports, all lifecycle events | The protocol library this app consumes; constraint: no fork [VERIFIED: codebase package.json + installed dist] |
| `@btcr2-aggregation/participant` | workspace | `createParticipant`, `getSubmittedUpdate`, `getDeclineReason`, `classifyCohortFit` decline path | Isomorphic wrapper already driven by the store [VERIFIED: codebase] |
| `@btcr2-aggregation/shared` | workspace | `buildSignedUpdate`, `updateHashHex/Bytes`, identity helpers, network registry | Single source for the canonical update body [VERIFIED: codebase] |
| Zustand | ^5.0.14 | Participant store restructure | Established client-state pattern; store stays the single lifecycle owner [VERIFIED: codebase] |
| React 19 + Vite 8 + Tailwind v4 | installed | Cohort page UI from `ui/primitives.tsx` | Established; UI-SPEC phase owns visual treatment [VERIFIED: codebase] |
| Hono | ^4 | New public anchor route mount in `hono-adapter.ts` | The one place HTTP mapping happens (sans-I/O convention) [VERIFIED: codebase] |
| playwright-core | ^1.61.1 | Browser capstone (D-32) | Already used by `e2e/lib/browser-harness.ts`; Chromium cached at `~/.cache/ms-playwright/chromium-1228` [VERIFIED: local cache listing] |
| vitest | ^2 | Unit specs for new store/route/module logic | Established (`*.spec.ts` co-located) [VERIFIED: codebase] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `GET /v1/anchor/:cohortId` poll read | Public SSE anchor stream | SSE adds connection lifecycle + replay complexity for one tiny fact; the store already runs a ~5s poll cadence (D-20 chose poll-shaped mechanics) |
| Retained anchor-state map | Re-deriving anchor state from esplora on each read | Would put chain I/O on an anonymous public route (DoS surface) and break the hermetic default; the broadcaster already owns the facts |
| Deferred `onProvideUpdate` | Dropping to `runner.session` manual state machine | The runner facade already supports awaiting the callback indefinitely; manual session control is a much larger surface for zero gain |

**Installation:** none - no new packages.

## Package Legitimacy Audit

**No new packages are installed in this phase.** All work uses workspace packages and dependencies already present in the committed lockfile (`pnpm-lock.yaml`, treated as trusted base). Audit trivially satisfied.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Key Findings (answers to the Claude's Discretion questions)

### Finding 1: The explicit submit gate is a deferred `onProvideUpdate` - no library change needed

`OnProvideUpdate = (info: { cohortId; beaconAddress }) => Promise<SecuredDocument | null>` [VERIFIED: library d.ts `participant/participant-runner.d.ts`]. The runner awaits this promise; nothing in the protocol requires it to resolve promptly (the bound is the SERVICE's `phaseTimeoutMs` stall timer, Finding 2). Today `packages/participant/src/index.ts` resolves it immediately with `buildSignedUpdate(...)`. The D-12 mechanism:

- `createParticipant` gains an optional `onSubmitGate` (or the store passes a callback via options): when present, `onProvideUpdate` first builds the update (so the preview shows the EXACT signed body), stores it in `submittedUpdates`-adjacent pending state, surfaces `{ cohortId, beaconAddress, update }` to the store, and awaits a module-scope deferred the store resolves on the user's click.
- **Build-at-window-open, not at click:** `buildSignedUpdate` is BIP340-non-deterministic; the previewed body MUST be the submitted body (D-12 honest preview + D-29 round-trip check). Build once when the window opens, hold it, resolve the deferred with that exact object.
- The existing `submittedUpdates` capture then works unchanged (`update-submitted` fires after the runner sends it).
- Omitting the gate keeps the current auto-submit path, which the headless e2e peers and in-process fillers rely on - the gate must be opt-in so `e2e/*.ts` and `FILLERS` keep working.
- The decline path (`classifyCohortFit === 'mismatch'` -> return null) must run BEFORE the gate: a baked-mismatch identity never gets a submit window it must not use (D-15/D-19 backstop).

Confidence: HIGH.

### Finding 2: A seated participant who never submits stalls the WHOLE cohort (D-13 outcome copy)

From library source [VERIFIED: `dist/esm/service/service.js` + `service-runner.js`]:
- The service leaves CollectingUpdates only when `state.cohort.hasAllResponses()` - EVERY member must submit OR decline (cooperative non-inclusion is an explicit `SUBMIT_NONINCLUDED` message, not a timeout default).
- The stall timer's fallback salvage applies ONLY to `SigningStarted`, `NoncesCollected`, `AwaitingPartialSigs` (`#SIGNING_PHASES`). A CollectingUpdates stall is NOT salvaged: `phaseTimeoutMs` fires -> completion rejects with `"Cohort <id> stalled in phase CollectingUpdates for <N>ms"` -> the operator surface records it as `expired`.
- Therefore the honest D-13 copy is **"stalled"**, never "not included": an unanswered window ends the cohort FOR EVERYONE (n-of-n has no partial-roster path pre-signing). The submit-window urgency treatment (tab title) is genuinely load-bearing, and the preview copy should say plainly that the cohort waits on this submission.
- Participant-side detection of that expiry: the runner emits no cohort-expired event to members; the cohort simply goes dark and the directory row vanishes. D-25's "the cohort ended and this service didn't say why" fallback is the honest rendering, triggered by cohort-gone-on-poll after seating (a new post-seat use of the directory poll - today the poll is cleared at `cohort-ready`).

Confidence: HIGH (read from installed library source).

### Finding 3: A signing pause hook exists (`onApproveSigning`), context for D-14

`AggregationParticipantRunnerOptions` has `onValidateData` (default: approve iff the validation matches the submitted update's hash) and `onApproveSigning` (default: approve) [VERIFIED: library d.ts]. D-14 stands: leave both defaults untouched so one consent at submit covers the round; `signing-requested`/`fallback-requested` events still fire before the callbacks, so the timeline observes the round without gating it. Do NOT wire `onApproveSigning` to UI - a second gate is exactly what D-14 rejected.

Confidence: HIGH.

### Finding 4: Minimal public anchor read - new module + one public GET, backed by a bounded retained map

The `beacon-broadcast`/`beacon-anchored`/`beacon-broadcast-failed` events are transient emitter frames [VERIFIED: `broadcast.ts`]; a poll read needs last-known state retained server-side. Recommended shape (planner may adjust naming):

- New `packages/service/src/anchor-state.ts`: `createAnchorState(broadcaster?)` subscribes once and keeps a bounded `Map<cohortId, { state: 'broadcast' | 'confirmed' | 'failed'; txid?: string; reason?: string }>` (cap ~24, oldest-first eviction, mirroring `MAX_TERMINAL`).
- Route in `hono-adapter.ts`, PUBLIC (outside the operator-auth block, beside `/v1/directory`): `GET /v1/anchor/:cohortId` -> `{ enabled: boolean, state: 'none' | 'broadcast' | 'confirmed' | 'failed', txid?, explorerUrl?, reason? }`.
  - `enabled` = whether the service runs with broadcast (broadcaster present) - the mode-honesty bit (D-07): the client renders "Anchored" stages only when `enabled: true`, "signed/complete" otherwise. Mirrors the `GET /v1/ipfs` `{ enabled: false }` probe precedent.
  - `explorerUrl` derived via `network.explorerTxUrl(txid)` exactly as `dashboard-sse.ts` does.
  - Input guard first (cheap 400): cohortId shape check before any map lookup, per the house pattern. Unknown cohort -> `{ enabled, state: 'none' }` (not 404 - "no anchor facts" is a valid public answer and avoids an existence oracle).
- Polling mechanics: the store polls only while in post-sign stages AND `enabled` is unresolved-or-true, on the existing ~5s cadence; stop at `confirmed`/`failed` (D-22 freeze at first confirmation).
- Phase 4 seam (D-21): Phase 4's gated operator view extends this module's map (richer per-cohort DTO), not the SSE bridge.

Confidence: HIGH for the mechanism; the exact route path/DTO field names are planner/UI-phase discretion.

### Finding 5: D-26 in-flight rows - widen the directory's phase filter carefully

Today `directory()` lists only `OPEN_PHASES = {Advertised, CohortSet, CollectingUpdates}` AND requires a live `advertised`-map entry [VERIFIED: `operator-cohorts.ts`]. The enrichment map entry survives through signing (pruned only when the completion settles), so widening the phase filter to include the signing phases (`SigningStarted`, `NoncesCollected`, `AwaitingPartialSigs`, and whatever post-sign phase precedes completion-settle) lists in-flight cohorts with zero new state. Constraints:

- `isJoinable` is already Advertised-only client-side [VERIFIED: `web/src/lib/directory.ts`] and `pickedCohortClosed` checks `phase === 'Advertised'` [VERIFIED: `participant.ts`], so wider DISPLAY does not break join gating or the Phase 2 grace logic.
- **`status().openCohorts` reuses `directory().length`** - widening the filter silently inflates the public "open" count. Either count joinable-phase rows separately inside `status()`, or expose the phase set to both and filter. Must be an explicit task, not a side effect (this is the drift D-09/Phase 1 D-15 exists to prevent).
- `statusLabel` needs cases for the signing phases (e.g. "In progress"); unknown phases already fall back to the raw string, so this is copy work, not logic risk.
- Exactly how long a completed cohort remains in `runner.session.cohorts` after settle is unverified; the settle-prune already bounds directory listing, but the planner should assert the post-completion directory behavior in a spec (Open Question 1).

Confidence: HIGH on mechanism, MEDIUM on post-completion row lifetime.

### Finding 6: D-19 pre-seat fit checks - only two are reliably computable before `cohort-ready`

`classifyCohortFit(genesisDocument, beaconAddress, beaconType)` needs the beacon ADDRESS, which exists only at `cohort-ready` (keygen output) [VERIFIED: `participant/index.ts` uses it inside `onProvideUpdate`]. Pre-seat, the directory row carries `beaconType` + `network` only. Reliable pre-seat checks:

1. **Baked-genesis beacon-TYPE mismatch:** a baked x1 identity commits to a beacon type + address (`hasBakedAggregateBeacon` shape, shared); the TYPE half is checkable against the picked row's `beaconType` at the identity step. Address match remains a `cohort-ready`-time fact -> late cooperative non-inclusion stays the backstop (per D-19).
2. **Network match:** structurally near-guaranteed today - `generate`/`importSecret` derive on the runtime network from `GET /v1/config`, so an in-app identity always matches. The one honest warn case is an x1 genesis whose baked beacon address decodes for a different chain. Keep the check cheap and warn-only.

Confidence: MEDIUM (exact baked-genesis field shape should be read from `shared` `hasBakedAggregateBeacon`/`classifyCohortFit` during planning; the boundary - address unknowable pre-seat - is HIGH).

### Finding 7: Resolve is mode-dependent - the D-28/D-29 round-trip check must be mode-honest

On the hermetic default (offline chain, no broadcast, no registration), `GET /resolve/:did` resolves a KEY DID to its **genesis document**: there is no on-chain signal for the resolver to discover, so the co-signed update is NEVER "reflected" in the resolved document on the fixture path [VERIFIED: `e2e/lib/browser-harness.ts` `verifyResolveUx` asserts exactly this - genesis doc + "aggregate beacon not yet registered on-chain"; `findAppendedBeacon` in `web/src/lib/resolve.ts` encodes the presence test]. Consequences:

- The round-trip check has THREE honest outcomes, not two: (a) update reflected (live path, signal discovered - `findAppendedBeacon` finds the appended `#beacon-cas`/`#beacon-smt` service, metadata versionId advances); (b) hermetic: "resolved to the genesis document - this no-broadcast service has no on-chain signal to discover; your co-signed update lives in the sidecar/artifacts" (NOT a mismatch warning - it is the expected fixture outcome); (c) genuine mismatch on a live path.
- Resolver lag (D-28 retry): possible ONLY on the live path (esplora indexing + confirmation timing); on the fixture path the answer is immediate and stable, so retries are pointless there. Gate the brief retry loop on the anchor read's `enabled: true`.
- The comparison input is `updateHashHex` from the captured body + `findAppendedBeacon` against the resolved services - both already exist. Never re-resolve to "verify" by rebuilding the update (BIP340).
- x1 imported identities use the existing POST-with-genesis variant (`resolveDid(baseUrl, did, genesisDocument)`) - already wired in the store's `resolve()`.

Confidence: HIGH.

### Finding 8: D-17 conditional stage ordering - BOTH fold-ins are post-completion, and D-18 needs a live-path caveat

Shipped flow order [VERIFIED: store + panels]: `cohort-complete` captures the body/sidecar -> ResultCard -> IPFS publish (requires `result.included` + sidecar - it publishes the completed round's artifacts) -> KEY registration (requires `captured.updateHashBytes` from the completed round; live-only via funded-UTXO check) -> resolve. So:

- **Registration stage:** conditional on live service + KEY identity + included; sits AFTER Signed/Anchored, BEFORE Resolved (on live, the resolver discovers the first update only via this registration - ADRs 0007/0008). Hermetic services never render it (the store's funds check would honestly dead-end at `awaiting-funds`, but D-17 says never show it hermetically - gate on the anchor read's `enabled` or `/v1/config`-derived liveness; note the tx proxy (`fetchUtxos`) is the current liveness probe and 502s on offline services).
- **IPFS stage:** conditional on `GET /v1/ipfs` `enabled` (already probed + re-probed at completion in the store); despite CONTEXT's "rides the submit stage" phrasing, the publishable artifacts exist only at completion - render it in the completion summary region. This is a research-corrects-detail case the CONTEXT explicitly delegated ("from research on the shipped flows").
- **D-18 second-update caveat:** identity reuse producing update N+1 is protocol-real (subsequent updates ride the aggregate beacon once the first is discoverable - ADR 0007), and on the hermetic path a second join/co-sign works identically (nothing on-chain either time). But "resolves cleanly to version N+1" is only observable on a live path with the first update registered; regtest CI notes recorded versionId inflation (3 on regtest) and kept DIDs first-update-terminal [ASSUMED - from project memory of ADR 0013 findings, not re-verified this session]. Recommendation: implement "use current identity" (cheap, store-level), assert the hermetic co-sign works in tests, and scope any "version N+1 resolves" CLAIM in UI copy to what the mode can honestly show.

Confidence: HIGH on ordering; MEDIUM on the D-18 live-resolve caveat.

## Architecture Patterns

### System Architecture Diagram

```text
                         PARTICIPANT TAB (browser)                          SERVICE (one process)
  +------------------------------------------------------+     +------------------------------------------------+
  | BrowseView (directory landing)                       |     |  hono-adapter.ts                               |
  |   DirectoryList --"You're in this cohort" row (D-04) |     |   GET /v1/directory  <-- widened phases (D-26) |
  |        | pick -> JoinIdentityStep (+use-current,     |     |   GET /v1/status     (joinable count fixed)    |
  |        |         +fit warn D-18/D-19)                |     |   GET /v1/anchor/:cohortId  [NEW, public]      |
  |        v                                             |     |        ^                                       |
  | CohortPage (NEW, one live surface D-01/D-02)         |     |   anchor-state.ts [NEW bounded map]            |
  |   StageTimeline: waiting -> seated -> submit ->      |     |        ^  beacon-broadcast/anchored/failed     |
  |     co-signing -> signed|anchored -> resolved        |     |   BeaconBroadcaster (broadcast.ts, unchanged)  |
  |   ActivityLog (D-27, expander)                       |     |        ^  signing-complete                     |
  |        ^ runner events        ^ ~5s polls            |     |   AggregationServiceRunner                     |
  | participant.ts store (single owner)                  |     |        ^ /v1/messages,/v1/adverts,inbox SSE    |
  |   live: Participant (deferred onProvideUpdate) ------+-----+--------+                                       |
  |   captured / submittedUpdates -> round-trip (D-29)   |     |   GET/POST /resolve/:did (resolve.ts) <-------+-- auto-resolve (D-28)
  +------------------------------------------------------+     +------------------------------------------------+
```

Primary trace: pick -> join (Phase 2, unchanged) -> `cohort-ready` seats -> service requests updates -> deferred `onProvideUpdate` opens the submit window (preview = exact built body) -> click resolves the deferred -> runner submits -> `update-submitted` -> validation/signing events advance the timeline -> `cohort-complete` captures body+sidecar -> anchor poll (if `enabled`) walks Signed -> Broadcast -> Confirmed -> auto-resolve -> round-trip check -> completion summary.

### Recommended Project Structure (delta only)

```
packages/service/src/anchor-state.ts        # NEW: bounded anchor map + DTO (spec co-located)
packages/service/src/hono-adapter.ts        # +GET /v1/anchor/:cohortId (public block)
packages/service/src/operator-cohorts.ts    # widened directory phases; status() count fixed
packages/participant/src/index.ts           # +opt-in submit gate option (default = auto-submit)
packages/web/src/stores/participant.ts      # stage model, pendingSubmit deferred, anchor poll,
                                            #   post-seat cohort-gone detection, unreachable counter
packages/web/src/components/cohort/*.tsx    # NEW: CohortPage, StageTimeline, stage internals
                                            #   (absorb Register/Publish/Resolve/Result logic)
packages/web/src/components/participant/*   # DELETE FlowStepper/ParticipantView/KeyGenPanel;
                                            #   panels deleted or moved as stage internals
e2e/browser-participant-cohort.ts           # NEW capstone (script e2e:browser:participant)
```

### Pattern 1: Deferred submit via module-scope resolver (the D-12 mechanism)

**What:** hold the runner's awaited `onProvideUpdate` promise until the user clicks; store only serializable projection in Zustand, the deferred + built body at module scope (like `live`/`captured`).
**When to use:** any user gate injected into an awaited library callback.
```typescript
// Store module scope (packages/web/src/stores/participant.ts) - epoch-guarded like ipfsEpoch
let pendingSubmit: {
  cohortId: string;
  update: SubmittedUpdate;          // built ONCE at window-open; preview renders THIS body
  resolve: (u: SubmittedUpdate) => void;
} | null = null;
// participant option (opt-in; absent = today's auto-submit for e2e peers/FILLERS):
onSubmitGate: (info) => new Promise((resolve) => {
  pendingSubmit = { ...info, resolve };
  set({ /* stage: 'submit-window' */ });   // D-13 urgency: stage + document.title
}),
// user clicks "Submit my DID update":
submitUpdate() { pendingSubmit?.resolve(pendingSubmit.update); pendingSubmit = null; }
```
Teardown rule: `leave()`/terminal/`teardownLive` must clear `pendingSubmit` WITHOUT resolving (the runner is being stopped anyway); never reject it - an `onProvideUpdate` throw would send neither submit nor decline (the documented cohort-staller).

### Pattern 2: Retained-event-state module (anchor-state.ts)

**What:** subscribe once to a typed emitter, keep bounded last-known state for poll reads; mirrors `MAX_TERMINAL` eviction and the fire-and-forget listener style of `index.ts`.
**When to use:** exposing transient emitter facts on a stateless HTTP read.

### Pattern 3: Stage as a derived value, not a second state machine

**What:** the timeline stage derives from existing store facts (`status`, `optedIn`, `seated`, `pendingSubmit != null`, step flags, anchor DTO, `resolveStatus`) via a pure exported selector (`deriveStage(state): Stage`), spec-tested like `pickedCohortClosed`.
**Why:** Phase 2's single-owner store + pure-predicate pattern is the proven shape; a parallel stage enum stored separately WILL drift from the event handlers that already exist.

### Anti-Patterns to Avoid
- **Rebuilding a signed update after submission** (documented codebase anti-pattern): BIP340 randomness changes the canonical hash; always use `getSubmittedUpdate`/the captured body.
- **A second runner or SSE listener for tracking:** the in-tab runner already observes every protocol event; add listeners to the existing `join()` wiring.
- **Gating signing behind UI** (`onApproveSigning` wired to a button): violates D-14 and risks a mid-round stall.
- **Booth/attendee wording in any new copy or comment** (Phase 1 D-20 framing rule; full sweep is Phase 6 but do not add new instances).
- **Em-dash characters in UI copy or docs** (blocked a Phase 2 plan-check iteration; user hard rule).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Canonical signed update | Any manual document patching | `buildSignedUpdate` (shared) | Proof generation, beacon service shape, x1 genesis-resolution handled |
| Submitted-body capture | Re-signing to compare | `getSubmittedUpdate(cohortId)` | BIP340 non-determinism |
| Sidecar/export | New export shape | `buildSidecar`/`downloadJson` (`lib/sidecar.ts`) | Resolver-compatible artifact set incl. x1 genesis |
| Resolution | In-browser resolver | `GET/POST /resolve/:did` via `resolveDid` | Native `level` deps cannot bundle (ADR 0007) |
| Beacon-presence test | Custom service scan | `findAppendedBeacon` | Encodes exact `#beacon-cas`/`#beacon-smt` ids |
| Broadcast/confirm lifecycle | New chain polling | `BeaconBroadcaster` events via anchor-state | Already abort-safe, teardown-safe |
| Async staleness guards | Ad-hoc booleans | The epoch pattern (`ipfsEpoch`/`directoryEpoch`) | Proven against WR-01-class stale-continuation bugs |
| Browser e2e plumbing | New harness | `e2e/lib/browser-harness.ts` (`launchBrowser`, `trackPageErrors`, `waitForApp`) + `browse-join-cohort.ts` service-boot/login/advertise helpers | Chromium resolution, error tracking, cookie handling solved |

**Key insight:** every protocol-touching primitive this phase needs already exists and is teardown/epoch-hardened; hand-rolling any of them reintroduces bug classes Phase 2 already paid to fix.

## Common Pitfalls

### Pitfall 1: The submit gate breaks every existing headless caller
**What goes wrong:** making explicit submit the default in `createParticipant` stalls all e2e peers, FILLERS, and the Phase 2 capstone (they never click).
**How to avoid:** the gate is a strictly opt-in option; only the web store passes it. Verification: `pnpm e2e && pnpm e2e:browse && pnpm e2e:operator && pnpm e2e:kofn` stay green untouched.
**Warning signs:** any signature change to `createParticipant` that is not additive-optional.

### Pitfall 2: Tearing down or rejecting a pending `onProvideUpdate`
**What goes wrong:** rejecting/throwing inside the callback sends neither submit nor decline - the documented whole-cohort staller; resolving `null` on leave silently declares cooperative non-inclusion the user never chose.
**How to avoid:** on teardown, clear the deferred without settling (the runner is stopped); D-09 hides Leave once locked, so the only unresolved-deferred exits are tab-close (service `phaseTimeoutMs` handles it) and terminal failures.
**Warning signs:** a `reject(...)` or `resolve(null)` anywhere in teardown paths.

### Pitfall 3: Directory widening silently changes `status().openCohorts` and Phase 2 predicates
**What goes wrong:** D-26 widening inflates the public open count (D-09 drift) or gets "fixed" by touching `pickedCohortClosed`.
**How to avoid:** separate joinable-phase counting in `status()`; leave `pickedCohortClosed`/`isJoinable` byte-untouched (they filter on `Advertised` and remain correct). Spec both counts.
**Warning signs:** `e2e:browse` assertions about cohort B's directory presence failing.

### Pitfall 4: Mode-dishonest anchor/resolve copy on the hermetic default
**What goes wrong:** rendering "Anchored" or "your update is reflected" on the fixture path (no broadcast, resolve returns genesis) - the exact lie D-07/D-29 forbid.
**How to avoid:** every anchor/resolve string branches on the anchor read's `enabled`; the hermetic round-trip outcome is the (b) genesis-expected message from Finding 7. The capstone e2e asserts the SIGNED (not anchored) wording.
**Warning signs:** UI copy mentioning txids or on-chain state with `enabled: false`.

### Pitfall 5: Losing the Phase 2 join-lifecycle hardening during the store restructure
**What goes wrong:** the restructure drops `directoryEpoch`/`joinGrace`/`awaitingSeats`/WR-02 re-check-after-start semantics that closed G-02-2/WR-01.
**How to avoid:** treat the join-through-seat portion of `participant.ts` as frozen; Phase 3 ADDS post-seat state (stage derivation, pendingSubmit, anchor poll, unreachable counter, post-seat cohort-gone detection) around it. `participant.spec.ts` must keep passing unmodified where possible.
**Warning signs:** diffs inside `handleDirectorySnapshot` or the grace-timer blocks.

### Pitfall 6: Post-seat directory poll conflicts with the seat authority
**What goes wrong:** reusing the poll after `cohort-ready` (for D-24/D-25 cohort-gone detection and D-26 row state) accidentally re-enables the "left Advertised = closed" logic against a legitimately-signing cohort.
**How to avoid:** the post-seat poll is a NEW concern with its own predicate (row absent entirely AND runner silent -> candidate "cohort ended"; row present in a signing phase -> normal). Never route post-seat snapshots through `handleDirectorySnapshot`.
**Warning signs:** seated participants failing with "filled or closed".

### Pitfall 7: Capstone flakiness from the single-advert-slot transport
**What goes wrong:** the server transport replays only the MOST RECENT advert to late subscribers (~60s republish cadence); a capstone advertising multiple cohorts can leave the browser participant waiting on an unreachable advert.
**How to avoid:** copy `browse-join-cohort.ts`'s ordering discipline (advertise the picked cohort LAST) or advertise a single cohort; synchronize on hard completion events, never bare timers.
**Warning signs:** intermittent join timeouts in the browser capstone.

### Pitfall 8: GSD commit signing
**What goes wrong:** `gsd query commit` silently fails on the YubiKey non-interactive ssh-sign gate.
**How to avoid:** commit with `git -c commit.gpgsign=false` (established project workaround); never add Co-Authored-By/model trailers; no em-dash in commit messages.

## Code Examples

### Public anchor route (house-style guard-first, public block of hono-adapter.ts)
```typescript
// Source: pattern mirrors GET /v1/directory + /v1/ipfs mounts in packages/service/src/hono-adapter.ts
app.get('/v1/anchor/:cohortId', (c) => {
  const cohortId = c.req.param('cohortId');
  if (!/^[0-9a-zA-Z-]{1,64}$/.test(cohortId)) {
    return c.json({ error: 'invalid cohort id' }, 400);   // cheap 400 before any lookup
  }
  return c.json(anchorState ? anchorState.read(cohortId) : { enabled: false, state: 'none' });
});
```

### Store-side anchor poll (post-sign stages only, epoch-guarded)
```typescript
// Source: cadence + epoch pattern from directoryPoll in packages/web/src/stores/participant.ts
const epoch = anchorEpoch;
anchorPoll = setInterval(() => {
  fetchAnchor(baseUrl, cohortId).then((dto) => {
    if (epoch !== anchorEpoch) return;                    // stale continuation guard (WR-01 class)
    set({ anchor: dto });
    if (dto.state === 'confirmed' || dto.state === 'failed') clearAnchorPoll(); // D-22 freeze
  }, () => { /* unreachable counter (D-24), never a terminal by itself */ });
}, 5000);
```

### Round-trip check (Finding 7, three honest outcomes)
```typescript
// Source: findAppendedBeacon in packages/web/src/lib/resolve.ts + captured updateHashHex
const beacon = findAppendedBeacon(resolution.didDocument, did);
const roundTrip: RoundTrip =
  beacon && anchor?.enabled ? 'reflected'
  : !anchor?.enabled        ? 'hermetic-genesis'   // expected, NOT a mismatch (D-29 honest copy)
  :                            'not-reflected';    // live path, honest warning + retry offer
```

## State of the Art

| Old Approach (pre-Phase 3) | Current Approach (this phase) | Impact |
|--------------|------------------|--------|
| Auto-submit inside `onProvideUpdate` | Opt-in deferred submit gate (web only) | PART-03 explicit consent; headless paths unchanged |
| `StepKey` 4-step flags + FlowStepper | Derived stage timeline on one cohort page | D-01/D-31; FlowStepper/ParticipantView/KeyGenPanel become dead code to DELETE (only importer of all three is ParticipantView itself [VERIFIED: grep]) |
| Anchor facts operator-gated (`/dashboard/events`) | + minimal public anchor read | PART-04 tracking without weakening the gated posture (ADR 0015) |
| Directory lists pre-signing phases only | In-flight rows listed non-joinable | D-26; service looks alive to strangers |
| Resolve = manual button post-result | Auto-resolve + mode-honest round-trip | D-28/D-29 |

**Deprecated/outdated after this phase:** `FlowStepper.tsx`, `ParticipantView.tsx`, `KeyGenPanel.tsx` (generate/import lives only in `JoinIdentityStep`); the `StepKey`/`steps` record in `lib/types.ts`/store (superseded by the stage derivation - remove or migrate, do not leave both).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node >= 22 / pnpm 11.4.0 | everything | ✓ | per repo pins | - |
| Cached Chromium (playwright-core) | D-32 browser capstone | ✓ | `~/.cache/ms-playwright/chromium-1228` (and 1217) [VERIFIED: ls] | `resolveChromium()` falls back to the managed path; hard error otherwise |
| Bitcoin chain / esplora | NONE for this phase's gates | n/a | - | Hermetic fixture path is the default; live legs stay opt-in and out of Phase 3 scope |
| IPFS node | conditional stage rendering only | n/a | - | `GET /v1/ipfs` `{enabled:false}` hides the stage |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2 (unit, co-located `*.spec.ts`) + tsx-driven e2e scripts |
| Config file | per-package via workspace defaults; root scripts in `package.json` |
| Quick run command | `pnpm test` (`tsc -b && vitest run`; typecheck gates every run) |
| Full suite command | `pnpm typecheck && pnpm lint && pnpm test && pnpm e2e && pnpm e2e:browse && pnpm e2e:operator && pnpm e2e:kofn && pnpm e2e:fallback` + the new capstone + web `tsc --noEmit` + `vite build` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PART-03 | Deferred submit gate resolves the previewed body; opt-out preserves auto-submit | unit | `pnpm --filter @btcr2-aggregation/participant test` | ❌ Wave 0 (extend participant spec) |
| PART-03 | Store submit window / stage derivation / teardown-clears-without-settling | unit | `pnpm --filter @btcr2-aggregation/web test` (`participant.spec.ts` + new stage spec) | ❌ Wave 0 |
| PART-03 | Explicit submit -> co-sign end to end in the real UI | e2e (browser) | `pnpm e2e:browser:participant` (new script) | ❌ Wave 0 |
| PART-04 | Anchor-state map: event fold, bounds, `enabled`, unknown-cohort answer | unit | `pnpm --filter @btcr2-aggregation/service test` (new `anchor-state.spec.ts`) | ❌ Wave 0 |
| PART-04 | Public anchor route: shape guard 400, public (no cookie), DTO | unit/integration | service spec against `createHonoApp` | ❌ Wave 0 |
| PART-04 | D-26 widened directory + unchanged joinable count | unit | extend `operator-cohorts` specs + `DirectoryList.spec.ts` | ❌ Wave 0 |
| PART-04 | Auto-resolve + mode-honest round-trip outcomes | unit + browser e2e | web spec (pure outcome fn) + capstone assertion | ❌ Wave 0 |
| Criterion 4 | Stepper no longer the entry path (directory is the landing; no KeyGen-first UI) | e2e (browser) | capstone asserts landing surface + absence of stepper affordances | ❌ Wave 0 |
| Regression | Phase 1/2 gates untouched | e2e | `pnpm e2e:operator && pnpm e2e:browse && pnpm e2e:kofn && pnpm e2e:fallback` | ✅ existing |

### Sampling Rate
- **Per task commit:** `pnpm test` (typecheck + all unit specs)
- **Per wave merge:** `pnpm test && pnpm e2e && pnpm e2e:browse && pnpm e2e:operator` (+ the new capstone once it exists) + web `vite build`
- **Phase gate:** full suite green before `/gsd-verify-work` (the two booth-topology browser jobs `e2e:browser`/`e2e:browser:prod` remain red by prior operator decision - Phase 6 debt; do not count them)

### Wave 0 Gaps
- [ ] `e2e/browser-participant-cohort.ts` + `e2e:browser:participant` script - covers PART-03/PART-04/criterion 4 (extends `browser-harness.ts` + the `browse-join-cohort.ts` boot/login/advertise pattern; headless in-process peers fill seats)
- [ ] `packages/service/src/anchor-state.spec.ts` (with the module)
- [ ] Stage-derivation + submit-gate specs in web/participant packages
- [ ] Framework install: none needed

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no new auth | The anchor read is deliberately PUBLIC (D-21); it must NOT weaken ADR 0015 - `/dashboard/*` and `/v1/operator/*` gating untouched |
| V3 Session Management | no | No participant sessions exist or are introduced |
| V4 Access Control | yes | New route mounts OUTSIDE the operator-auth block beside `/v1/directory`; `credentials: 'omit'` on the client fetch (directory.ts precedent) |
| V5 Input Validation | yes | cohortId shape guard before lookup (cheap 400, house pattern); no request bodies on the new read |
| V6 Cryptography | yes | Never hand-roll: `buildSignedUpdate`/library MuSig2 only; captured-body discipline prevents hash drift |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Anchor-read info disclosure | Information disclosure | DTO carries ONLY public chain facts (state/txid/explorerUrl) + `enabled`; no member DIDs, keys, reasons beyond broadcast failure summary (consider omitting raw `reason` or keeping it generic, mirroring the 502-generic-body convention) |
| Anchor map growth DoS | DoS | Bounded map (~24, oldest-first eviction, `MAX_TERMINAL` precedent); reads are O(1) |
| Cohort-existence oracle | Information disclosure | Unknown cohortId returns `{state:'none'}` not 404; same answer for never-existed and evicted |
| Mid-round stall injection | DoS (protocol) | The submit gate can stall a cohort by design (Finding 2) - bounded server-side by `phaseTimeoutMs` (existing); UI urgency (D-13) is the honest mitigation, no new server surface |
| Key custody | Tampering | "Start over" identity wipe behind an explicit warning (D-10); secret shown only via existing CopyField patterns |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Regtest-era note that DIDs were kept first-update-terminal / versionId inflation (ADR 0013 memory) constrains what "version N+1 resolves cleanly" can claim on live paths | Finding 8 / D-18 | UI copy could over- or under-claim; hermetic behavior unaffected. Planner: keep N+1 claims out of hermetic copy; live verification is Phase-6/live-instance territory |
| A2 | Completed cohorts leave `runner.session.cohorts` promptly after completion settles (post-completion directory row lifetime) | Finding 5 / D-26 | An "In progress" row could linger after completion; covered by a spec assertion task (Open Question 1) |
| A3 | The exact baked-genesis field shape for the pre-seat TYPE check (read `hasBakedAggregateBeacon`/`classifyCohortFit` in shared during planning) | Finding 6 / D-19 | Warn logic might need a different accessor; boundary (address unknowable pre-seat) is verified |

## Open Questions

1. **Post-completion directory row lifetime (A2):** what phase string does a completed/failed cohort report before the settle-prune, and does it linger in `runner.session.cohorts`? What we know: the enrichment map prunes on settle, bounding listing. Recommendation: a small spec in the D-26 plan pins the observed behavior; label any post-sign unknown phase honestly via the existing raw-string fallback.
2. **Where the submit gate lives:** `createParticipant` option (recommended: keeps the store dumb and the gate testable in the participant package) vs store-side wrapping of `onProvideUpdate` composition. Recommendation: participant-package option, default absent.
3. **Whether the anchor DTO should carry the k-of-n fallback path fact (D-23):** the participant already observes `fallback-requested` in-tab, so the timeline can state the fallback outcome without server help; the anchor read stays minimal (D-21). Recommendation: client-side only; revisit in Phase 4's richer DTO.

## Sources

### Primary (HIGH confidence)
- Local codebase (read this session): `packages/web/src/stores/participant.ts`, `packages/participant/src/index.ts`, `packages/service/src/{broadcast,dashboard-sse,operator-cohorts,index,hono-adapter(partial)}.ts`, `packages/web/src/{App.tsx,components/browse/BrowseView.tsx,components/participant/ParticipantView.tsx,lib/{resolve,directory}.ts}`, `e2e/{browse-join-cohort.ts,lib/browser-harness.ts}`, root `package.json` scripts, import graph greps
- Installed library source/types `@did-btcr2/aggregation@0.4.0`: `dist/types/participant/{participant-runner,events}.d.ts`, `dist/esm/service/{service,service-runner}.js` (hasAllResponses, #SIGNING_PHASES, stall reason string)
- `.planning/phases/03-*/03-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json`

### Secondary (MEDIUM confidence)
- Project memory of ADR 0007/0012/0013 findings where not re-read this session (tagged [ASSUMED] where load-bearing)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - zero new packages; everything verified installed
- Architecture: HIGH - all seams read from source; only naming left to the planner
- Pitfalls: HIGH - each traces to a verified mechanism or a documented Phase 1/2 lesson
- D-18 live-resolve caveat + D-26 row lifetime: MEDIUM - flagged in Assumptions Log with closure tasks

**Research date:** 2026-07-17
**Valid until:** ~2026-08-16 (stable: pinned library versions, local codebase; re-check only if `@did-btcr2/*` versions bump)

