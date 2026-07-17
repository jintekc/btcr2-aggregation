# Phase 3: Participant Submit, Co-Sign, Track, and Resolve - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning

<domain>
## Phase Boundary

From the cohort they joined by choice (Phase 2's browse-and-pick), the participant submits a DID update, takes part in the cohort's MuSig2 co-signing round, watches co-sign and anchor progress in real time, and resolves the updated DID - wiring the existing signing/resolve machinery into the discover -> join path and retiring the standalone linear KeyGen -> Register -> Publish -> Resolve stepper as an entry path (and as dead code).

**Requirements:** PART-03 (submit a DID update + take part in the co-signing round), PART-04 (track co-sign/anchor progress + resolve once anchored).

**In scope:** one live cohort page covering the whole participant journey from join onward (absorbing the Phase 2 waiting/seated states); an explicit submit moment with an honest preview; live stage tracking fed by the participant runner's own events plus a minimal new public anchor read; truthful degraded states (stall -> k-of-n fallback outcome, service unreachable, cohort ended, cooperative non-inclusion); auto-resolve with a round-trip check and completion summary; deletion of the stepper shell with surviving panel logic absorbed as stage internals; conditional fold-ins at their natural stages (live KEY registration, opt-in IPFS publish, x1 sidecar resolve/export); a browser-level hermetic capstone e2e.

**Out of scope (later phases / v2):** operator-side monitoring surfaces (Phase 4); operator lifecycle control incl. any test-peer control (Phase 5); stranger-to-stranger CI e2e + the systematic booth/attendee framing sweep + rewiring the red `e2e:browser`/`e2e:browser:prod` jobs (Phase 6); identity persistence across refresh / durable state (v2 DUR-01); multi-cohort concurrency or history views (v2 PMG-01); document editing in updates; reorg-depth UX beyond first confirmation.
</domain>

<decisions>
## Implementation Decisions

### Post-seat journey shape (the live cohort page)
- **D-01:** **One live cohort page** for the whole journey: the Phase 2 seated card grows into a live stage timeline (Waiting for seats -> Seated -> Submit update -> Co-signing -> Anchored/Signed -> Resolved); each action renders inline at the stage that needs it. Not a wizard, not status-plus-modals.
- **D-02:** **The page absorbs the Phase 2 waiting-for-seats state** - one continuous surface from join onward; the Phase 2 waiting line and seated card become the first stages. No handoff seam between Phase 2 and Phase 3 states.
- **D-03:** **Directory stays reachable mid-flight.** The cohort page is a distinct view; a persistent "Your cohort" link returns to it; Join is disabled on other rows (one-cohort-at-a-time). The "Your cohort" link carries the **live current stage** (label/dot updates); no browser notifications. Exception: see D-13 (submit-window urgency may also change the tab title).
- **D-04:** **The joined cohort's directory row gets a distinct "You're in this cohort" state** with a View action to the live page (not a disabled Join).
- **D-05:** **Full timeline upfront** with future stages dimmed as pending; the active stage shows a **quiet elapsed-time indicator** (no countdowns, no duration promises).
- **D-06:** **Plain-language stage labels + expandable technical detail** (raw protocol phase, cohort id, beacon address, txid as Mono/CopyField), extending Phase 2's D-09 precedent. A **compact identity section** shows the participant's own DID (Mono/CopyField), onboarding model, and the key-custody note.
- **D-07:** **Mode-honest anchor copy**: "Anchored" with txid appears only when a real broadcast+confirm happened; on the default hermetic (no-broadcast) service the stage reads as signed/complete without claiming an on-chain anchor. Never lie on the fixture path.
- **D-08:** **Keep-tab-open posture**: truthful copy that a refresh mid-flight loses the seat (existing TTL reclaim); no identity persistence or re-attach this phase (v2 DUR-01). Aggregate counts only about other members (seats, updates submitted, co-sign progress) - never member identities.
- **D-09:** **Leave hides once the cohort locks into signing** (Leave remains only while waiting for seats); copy explains the participant is committed through anchoring.
- **D-10:** **End states live on the cohort page**: a persistent completion summary (resolved DID document, anchor reference, "Browse cohorts" CTA) that is **replaced on the next join** (no history - v2 PMG-01); terminal failures land on the page with a plain-language reason + "Back to cohorts"; **cooperative non-inclusion is a distinct non-error outcome** ("the cohort proceeded without your update, here's why") that **keeps reporting the cohort's anchor result**. A **"Start over"** action from any terminal state clears the record AND the in-memory identity behind an explicit key-custody warning.
- **D-11:** **Internal SPA view state, no routed URL** for the cohort page this phase (live state is tab-bound anyway; a routed `/cohorts/:id` is deferred).

### Submit moment + update content
- **D-12:** **Explicit submit action** ("Submit my DID update") - the update is provided to the round when the participant clicks. **Auto-built canonical update** (append the cohort's beacon service via the existing `buildSignedUpdate` path) with a **plain-language preview + raw signed-update JSON expander** before confirming; no document editing.
- **D-13:** **Miss-the-window treatment**: when the submit window opens, escalate attention (prominent stage treatment + tab-title change, the one exception to D-03's quiet indicator); if the window closes unanswered, land in the honest outcome (not-included or stalled, per what the protocol actually does - research confirms which).
- **D-14:** **One consent at submit covers the whole signing round**, including the beacon transaction signature; the preview includes **one plain line about the beacon commitment** ("your signature helps anchor this cohort's aggregated update commitment at beacon address X", live/hermetic distinction in copy), tx detail in the raw expander. No second mid-round approval gate.
- **D-15:** **No sit-out UI** - once locked, submit is the only forward path; voluntary cooperative non-inclusion stays a protocol behavior, not a button (deferred idea).
- **D-16:** **KEY golden path, x1 kept working**: the generated-KEY identity is the polished path through submit/track/resolve; imported EXTERNAL/x1 identities (Phase 2 inline identity already accepts them) keep working through join/co-sign and resolve via the existing sidecar machinery, but their polish is a fold-in behind the core, not a Phase 3 criterion.
- **D-17:** **Conditional stages for accreted features**: on a live+broadcast service, the KEY first-update registration (fund genesis beacon + OP_RETURN, ADRs 0007/0008) appears as a conditional stage reusing shipped RegisterPanel logic (hermetic services never show it; research confirms protocol ordering). When the service advertises IPFS (ADR 0011), the opt-in publish/pin affordance rides the submit stage the same way.
- **D-18:** **Identity reuse across cohorts**: when an identity is already in memory, the join identity step offers "use current identity" as the default alongside generate/import - enabling the same DID to accumulate aggregate updates across cohorts (versionId N+1). Research confirms the second-update path resolves cleanly.
- **D-19:** **Import-time fit validation**: the join identity step runs the client-side fit checks possible before seating (network match; the beacon/genesis fit classification the participant package already computes) and **warns** with an informed "join anyway" choice - never blocks. Late cooperative non-inclusion remains the honest backstop.

### Tracking source + degraded states
- **D-20:** **Progress data = participant runner events client-side** for protocol stages (the in-tab runner already observes them) + the existing ~5s directory poll for cohort-level facts + **the smallest new PUBLIC anchor-status read** (anchor events currently reach only the operator-gated `/dashboard/events`). Research sizes that read (per-cohort anchor state: none/broadcast/confirmed + txid).
- **D-21:** **Anchor status is a public/anonymous read** - anchor facts are public chain data; matches the unauthenticated `/resolve` + `/cas` ethos. **Phase 4 seam: minimal now, Phase 4 extends** the same pattern for the gated operator view; no speculative fields.
- **D-22:** **Anchor stage granularity (broadcast-enabled)**: Signed -> Broadcast (txid + explorer link) -> Confirmed, mirroring the existing `beacon-broadcast` vs `beacon-anchored` events; **freeze at first confirmation** (no live conf count, no reorg UX - the explorer link carries depth-watching).
- **D-23:** **Explicit k-of-n fallback outcome**: if the ADR-042 script-path fallback rescues a stall, the timeline says the cohort anchored via the fallback path with k of n signatures and whether the participant's update was included (extends the Phase 2 G-02-1 honesty).
- **D-24:** **Service-unreachable treatment (closes 02-09 WR-02)**: consecutive poll/SSE failures raise a distinct "can't reach this service" banner with quiet auto-retry; stages freeze honestly; terminal failure only when the in-tab runner errors or the cohort is gone on reconnect.
- **D-25:** **Failure reasons are best-effort specific** (phase timeout, cohort vanished, runner error, seat lost) with an honest "the cohort ended and this service didn't say why" fallback; no invented certainty.
- **D-26:** **In-flight cohorts stay listed** in the public directory as honest non-joinable "In progress" rows until anchored/ended (joinable stays Advertised-only per Phase 2); the service looks alive to strangers.
- **D-27:** **A timestamped activity log** (joined/locked/submitted/broadcast at...) accumulates inside the technical detail expander - clean stages for strangers, auditable client-observed trail for practitioners.

### Resolve + stepper retirement
- **D-28:** **Auto-resolve when the anchor stage completes** (GET `/resolve/:did`; the x1 sidecar POST variant for imported identities) with a "Resolve again" re-run action; resolve is a read, so automation is harmless. **Honest retry on resolver lag**: brief "resolving..." retries; if the update still is not reflected, say so plainly (research checks whether lag is possible on fixture/live paths).
- **D-29:** **Truthful round-trip check**: the completion summary compares the resolved document against the submitted update and states the result plainly ("your update is reflected" or an honest mismatch warning).
- **D-30:** **Presentation**: plain-language result (beacon service added, version N) + the full DID document and resolution metadata behind the raw-detail expander; **sidecar/artifact export offered in the completion summary** (existing export logic reused) with copy explaining its purpose.
- **D-31:** **Stepper retirement = delete dead code**: the FlowStepper shell + standalone entry wiring are removed; surviving panel logic is absorbed as stage internals (KeyGen/import live ONLY in the Phase 2 inline join identity step - one identity moment in the app; Register/Publish/Resolve logic inside stages). The old booth-topology browser e2e is already red and owned by Phase 6.

### Proof + solo testing
- **D-32:** **Browser-level hermetic capstone e2e** (playwright-core, local like `e2e:kofn`; CI wiring stays Phase 6 debt): browse -> pick -> join -> explicit submit click -> co-sign -> mode-honest signed state -> auto-resolve -> round-trip check, with headless peers filling seats. Criterion 4 (the stepper is no longer the entry path) is provable only at the browser level.
- **D-33:** **No solo-demo affordance this phase**: the dev-only FILLERS env (Phase 1 D-18) covers self-testing and the docs should mention it; a first-class operator "test peers" control would be Phase 5 scope.

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
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap (this milestone)
- `.planning/PROJECT.md` - North Star, constraints (no unauthenticated mutating surface - the new anchor read is a public READ; config-driven network; single-box in-memory), Key Decisions incl. the two-field k-of-n honesty and the open 02-09 WR-02 follow-up this phase closes.
- `.planning/REQUIREMENTS.md` - PART-03/PART-04 (this phase); SVC-03 (Phase 4 - respect the D-21 seam), HOST-02/03 (Phase 6); v2 PMG-01/DUR-01.
- `.planning/ROADMAP.md` - Phase 3 goal + success criteria (esp. criterion 4: the stepper is no longer the entry path); Phase 4/5/6 boundaries.

### Prior phase context (decisions carried forward)
- `.planning/phases/02-participant-discovery-browse-and-pick-join/02-CONTEXT.md` - Phase 2's D-01..D-16 (same-origin, browse-first, inline identity at Join, server-authoritative join, seated confirmation, deterministic outcomes, watchdog removal); its Deferred list explicitly hands the tail rewire + stepper retirement to this phase.
- `.planning/phases/01-authenticated-operator-console-on-demand-cohort-creation/01-CONTEXT.md` - Phase 1's auth split (public vs gated routes), directory-derives-from-live-set, fillers as dev/test-only (D-18), clean framing rule (D-20).

### Architecture + protocol ADRs (do not violate)
- `docs/adr/0003-same-origin-topology.md` - one origin serves API + SPA; the cohort page lives inside this.
- `docs/adr/0015-operator-authentication.md` - the public-vs-gated route split; the new anchor read must be public without weakening the gated telemetry posture.
- `docs/adr/0007-*.md` (resolve roundtrip) + `docs/adr/0008-*.md` (web resolve UX + KEY self-bootstrap registration) - the registration/resolve machinery D-17/D-28 reuse; the first-update discoverability constraint.
- `docs/adr/0010-mainnet-guard-rails.md` - live/broadcast opt-in layering the mode-honest copy (D-07) reflects.
- `docs/adr/0011-ipfs-publish.md` - the opt-in IPFS publish folded in at the submit stage (D-17).
- `docs/adr/0012-baked-genesis-and-genesis-store.md` - cooperative non-inclusion semantics behind D-10/D-15/D-19.
- `docs/adr/0014-deployment-topology.md` - single-box, one process; no cross-instance state for tracking.

### Codebase maps (analysis 2026-07-07; Phases 1-2 have since reshaped the web/service surfaces)
- `.planning/codebase/ARCHITECTURE.md` - lifecycle data flow (steps 4-10 are this phase's material: submit, co-sign, persist, broadcast, resolve); the "rebuilding a signed update" anti-pattern (submittedUpdates map); anchor events flow to the dashboard SSE bridge.
- `.planning/codebase/CONVENTIONS.md` - house style, `.js` import extensions, comment-density expectation.

### Key source files this phase reshapes
- `packages/web/src/stores/participant.ts` - the participant state machine: join/seat lifecycle (Phase 2), the reused register/submit/co-sign/resolve logic to restructure into stages; awaitingSeats + grace/epoch guards (02-09) to preserve.
- `packages/web/src/components/participant/*` - `FlowStepper` (delete), `KeyGenPanel` (absorbed in join identity step), `RegisterPanel`/`PublishPanel`/`ResolvePanel`/`ResultCard` (logic survives as stage internals).
- `packages/web/src/App.tsx` + the Phase 2 browse/join components - the directory landing, "Your cohort" link + row state, cohort page mount.
- `packages/participant/src/index.ts` - runner lifecycle events the tracking rides; `getSubmittedUpdate(cohortId)`; cohort-fit classification for D-19.
- `packages/service/src/broadcast.ts` + `packages/service/src/dashboard-sse.ts` - where `beacon-broadcast`/`beacon-anchored` events originate/flow today; source for the minimal public anchor read (D-20/D-21).
- `packages/service/src/hono-adapter.ts` + `packages/service/src/operator-cohorts.ts` - route mounts + directory/status read side (in-flight row status, D-26).
- `packages/service/src/resolve.ts` - GET/POST `/resolve/:did` the auto-resolve calls.
- `packages/web/src/lib/sidecar.ts` + `packages/web/src/lib/resolve.ts` - sidecar export + browser resolve helpers reused in the completion summary.
- `e2e/browse-join-cohort.ts` + `e2e/lib/*` - the Phase 2 hermetic browse capstone the new browser-level capstone builds on.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The participant runner's lifecycle events** (in-tab, already authenticated by participation) - primary tracking source (D-20); the store already consumes them for the Phase 2 seat lifecycle.
- **`submittedUpdates` map / `getSubmittedUpdate(cohortId)`** - the exact-submitted-body capture that the round-trip check (D-29) compares against; never rebuild a signed update (BIP340 randomness).
- **`buildSignedUpdate`** (shared) - the auto-built canonical update behind the preview (D-12).
- **`beacon-broadcast`/`beacon-anchored` events** (`broadcast.ts` -> dashboard SSE) - the facts the minimal public anchor read must surface anonymously (D-20/D-22).
- **RegisterPanel / PublishPanel / ResolvePanel / ResultCard logic + `lib/sidecar.ts`** - survive as stage internals and the completion summary's export (D-17/D-30/D-31).
- **The Phase 2 join flow** (inline identity step, awaitingSeats waiting line, grace/epoch guards, directory poll) - becomes the first stages of the one live page (D-02); the identity step gains "use current identity" (D-18) and fit warnings (D-19).
- **`ui/primitives.tsx`** (Card/Badge/StatusDot/Mono/CopyField/Input/Select/Field) - build the timeline, expander, and summary from these.
- **Cohort-fit classification** in `packages/participant` (cooperative non-inclusion path) - the client-side fit check D-19 reuses.

### Established Patterns
- **Truthful copy as a hard rule** (two-field k-of-n precedent, G-02-1): mode-honest anchor stage (D-07), explicit fallback outcome (D-23), honest unknowns (D-25).
- **Plain language + technical expander** (Phase 2 D-08/D-09) - extended to stages, preview, log, and resolved document.
- **Public reads stay anonymous; mutating/operator surfaces stay gated** (ADR 0015) - the anchor read is public (D-21), no participant-side HTTP auth is invented.
- **Conditional opt-in surfaces** (live, IPFS, mainnet rails) - accreted features appear as conditional stages, never by default (D-17).
- **Directory derives from the live runner set** (Phase 1 D-15) - in-flight row status (D-26) derives from the same source, no parallel list.
- **Clean operator/service/aggregator framing** - no new booth/attendee wording anywhere in the new surfaces.

### Integration Points
- Cohort page <-> participant store restructure (stages, activity log, terminal states).
- Minimal public anchor read <-> `broadcast.ts` events <-> `hono-adapter.ts` mount (public, cheap 400s, shape-guarded).
- Directory row "You're in this cohort" + in-progress status <-> Phase 2 browse components + `operator-cohorts.ts` read side.
- Auto-resolve <-> `GET/POST /resolve/:did` <-> round-trip check against `getSubmittedUpdate`.
- Browser capstone e2e <-> the Phase 2 hermetic harness + headless peers.
</code_context>

<specifics>
## Specific Ideas

- The owner again drove hard toward thoroughness (chose "More questions"/"Explore more" at nearly every gate) and consistently picked the recommended pragmatic-honest option: every accepted recommendation pairs **maximum truthfulness in copy** with **minimum new backend**.
- Honesty over polish is the through-line the owner keeps confirming: mode-honest anchor stage, explicit fallback outcome, honest unknown failure reasons, round-trip verification, non-inclusion as a non-error outcome that still shows the cohort's fate.
- The owner wants the app to demonstrate the protocol's real story: identity reuse across cohorts for version N+1 updates (D-18) was accepted specifically because "the app never demonstrates a DID's second update" would undercut the product's point.
- One consent at submit (covering the beacon tx signature) was chosen to keep the ceremony stall-free; the informed-consent burden moves into the preview copy (D-14).
</specifics>

<deferred>
## Deferred Ideas

- **Routed `/cohorts/:id` URL** for cohort pages - pairs with Phase 4 operator monitoring patterns (D-11).
- **Session-local completed-cohort history list** - v2 PMG-01 territory (D-10).
- **Identity persistence / mid-flight re-attach across refresh** - v2 DUR-01 (D-08).
- **Explicit voluntary sit-out** (co-sign without including an update, as a user action) - deferred unless demand appears (D-15).
- **User-editable DID update content** (services/keys before signing) - its own phase if ever (D-12).
- **Full x1/EXTERNAL polish parity** through the new tail - fold-in behind the core after Phase 3 (D-16).
- **Live confirmation-count / reorg UX** beyond first confirmation - explorer link carries it (D-22).
- **Operator "test peers" control** for solo demos - Phase 5 lifecycle-control scope (D-33).
- **Full per-cohort status DTO** (members/submissions/co-sign progress) - Phase 4 designs it, extending the minimal anchor read pattern (D-21).
- **Tab-title notifications beyond the submit-window urgency exception** - considered, not chosen (D-03/D-13).
- **CI wiring of the new browser capstone** + rewiring `e2e:browser`/`e2e:browser:prod` - Phase 6 debt (D-32).

</deferred>

---

*Phase: 3-participant-submit-co-sign-track-and-resolve*
*Context gathered: 2026-07-16*
