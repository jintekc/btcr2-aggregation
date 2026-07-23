# Phase 4: Operator Cohort Monitoring - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning

<domain>
## Phase Boundary

On the authenticated console, the operator monitors each on-demand cohort in real time - who joined and seats remaining, pending DID-update submissions, per-member co-sign progress, and anchor status - turning the booth-era read-only telemetry tab into the operator's live view (SVC-03). By explicit owner direction ("the actual real server working out-of-the-box, not via an e2e script"), the phase also folds in live-path operability: a real boot can enable live co-sign + broadcast behind ADR 0010-style guard rails, the cohort beacon address gets a watch-only funding stage, and the live-UAT honesty defects (stall-copy misattribution, unconfirmed-signal resolve failure) are fixed. Both halves are non-negotiable core; the trimmings (export, service name, scoping docs) slip first if slicing is needed.

**Requirements:** SVC-03 (this phase's requirement of record). The live-path work maps to PROJECT.md's Active bullet "the live broadcast path is operable from the product itself"; planning should formalize a requirement ID + success criteria for it so verification has a contract (see planning notes).

**In scope:** the operator console rework (list-first, per-cohort drill-down, health strip); the server-side monitoring read model (snapshot DTOs, activity log ring, bounded retention) replacing the dashboard SSE; member/submission/co-sign/anchor visibility; live/broadcast boot enablement (BROADCAST=1) + the funding stage with its three states, dead-end, recovery-key disclosure, and honest window semantics; bounded broadcast send retry; participant-side awaiting-funding copy, join-time live notice, stall-copy fix, and unconfirmed-signal resolve guard; DEPLOY.md going-live section; a new ADR superseding ADR 0004; hermetic e2e gate + mocked-chain live funding leg + formalized live harness + browser operator capstone; three scoping one-pagers (esplora override, external signers, ToS/payments); JSON export of a cohort's monitoring record; SERVICE_NAME display.

**Out of scope (later phases / v2):** operator lifecycle actions - open/close/finalize, pause/cancel, reconfigure, runtime live toggling, ended-cohort dismissal, re-advertise beyond the shipped expired-row action, SERVICE_NAME editing (Phase 5); stranger-to-stranger CI e2e, booth-framing sweep, CI wiring of browser capstones (Phase 6); durable state / seat persistence (v2 DUR-01); multi-cohort participant management (v2 PMG-01); multi-operator (v2 OACC-01); BUILDING the three weak-fold todos (scoping docs only this phase); resolve-traffic telemetry; cross-cohort member correlation.
</domain>

<decisions>
## Implementation Decisions

Decisions D-34..D-45 were adversarially audited against the codebase and the published `@did-btcr2/*` libraries (two ultracode sweeps, 74 agents; findings verified by independent accuracy + materiality verifiers). Where the audit corrected a decision's wording, the text below is the FINAL corrected form - do not resurrect earlier phrasings from the discussion log.

### Monitoring surface shape
- **D-01:** Per-cohort drill-down is the monitoring surface: operator cohort list rows open a full-view per-cohort monitoring page (back link returns to the list). The booth-era all-cohorts card wall retires.
- **D-02:** The old Dashboard tab, `DashboardView`, `CohortCard`, `MetricsStrip`, and the client-side SSE store retire (delete dead code, Phase 3 D-31 precedent). The event log survives as a per-cohort activity log inside each drill-down.
- **D-03:** SPA-internal view state; no routed URLs this phase (routed URLs later, both sides at once).
- **D-04:** Live status chips on list rows (filling / signing / needs funding / fallback / failed / anchored) with warn/bad tones are the attention mechanism; no notification machinery.
- **D-05:** Drill-down layout: cohort-lifecycle stage timeline at top (mirrors the participant StageTimeline pattern), concern sections underneath - members, submissions, anchor detail, activity log.
- **D-06:** Service-level metrics: a compact live-count row (open / in-flight / anchored / failed) derived from the live set + retained records; no since-boot cumulative counters.
- **D-07:** The console is list-first: the create form moves behind a New-cohort button; monitoring is the default view.
- **D-08:** List grouping by state: attention-needing and active cohorts first, then drafts, then ended (anchored/failed/expired) trailing.
- **D-09:** Drafts keep the inline row treatment (config summary + Advertise/Discard actions); drill-down exists for advertised+ cohorts only.
- **D-10:** Expired records sit in the ended group with expiry reason and the shipped Re-advertise action on the row; no drill-down for expired records.
- **D-11:** Cross-cohort attention inside a drill-down: a warn-tone badge/count on the back link when another cohort needs attention.
- **D-12:** Copy register: plain-first with raw protocol detail behind the technical expander - the same voice as the participant side (Phase 2 D-09 / Phase 3 D-06 lineage).
- **D-13:** After advertising a draft, the operator lands in that cohort's drill-down.
- **D-14:** No dismissal of ended cohorts this phase (no new mutating routes; bounded retention keeps the list tidy). - **Reversibility:** reversible.
- **D-15:** A quiet link to `/` opens the public directory in a new tab (view-as-participant).
- **D-16:** Session expiry mid-monitoring: honest re-login redirect (plain copy, back to the login panel; monitoring rebuilds from server state after login). The 401-vs-network discrimination this needs is new plumbing (see planning notes).
- **D-17:** An always-visible compact health strip: live vs hermetic mode, active network, esplora reachability when live, IPFS on/off, plus the D-25 freshness indicator and SERVICE_NAME (D-51).
- **D-18:** Operator-side anchor detail mirrors participant D-22: Signed, Broadcast (txid + explorer link), Confirmed; freeze at first confirmation; "Anchored" reserved for confirmed (Truths 6-8 apply to every operator surface).

### Fresh-load truth (monitoring data path)
- **D-19:** Server snapshot, polled: a server-side monitoring module folds runner events into per-cohort DTOs; the console polls gated reads every few seconds. One data path for fresh loads and updates alike. `dashboard-sse.ts` and `/dashboard/events` retire with the old tab. - **Reversibility:** costly - retiring the SSE channel supersedes ADR 0004 and requires migrating its committed test pins (see planning notes); a new ADR records it.
- **D-20:** Read shape: a gated summary-list read (chips, counts, grouping) merged with/replacing the Phase 1 operator cohort-list read, plus a gated per-cohort detail read (members, submissions, activity log) polled only while its drill-down is open.
- **D-21:** The per-cohort activity log is a server-side bounded ring buffer delivered in the detail DTO; it survives fresh page loads.
- **D-22:** Log fidelity: ALL runner events (including rejects, nonce progress, non-fatal errors) plus broadcaster frames, each server-stamped with wall-clock time.
- **D-23:** Ended cohorts (anchored/failed/expired) are retained at a bounded cap mirroring anchor-state's 24, oldest evicted. Ended-record retention is CREATED by the monitoring module (no ended records exist server-side today beyond expired; anchored cohorts are currently pruned without a record).
- **D-24:** Process restart: honest empty state plus one plain line that the service keeps cohort state in memory and a restart clears it (DUR-01 stays v2).
- **D-25:** Poll failure: mirror participant D-24 - consecutive failures raise a distinct "can't reach this service" banner with quiet auto-retry; displayed state freezes honestly. A quiet freshness indicator (connected dot / updated-Ns-ago) lives in the health strip.
- **D-26:** The public surfaces stay untouched: `DirectoryCohortDTO` byte-identical, the public anchor read byte-untouched. All new member/submission/log detail is operator-gated only.
- **D-27:** Monitoring accumulator vs the shipped anchor-state module: Claude's discretion (independent module vs shared accumulator), hard constraint: the public anchor read stays byte-untouched.

### Member/submission depth
- **D-28:** Member rows show the full DID with the standard treatment (shortened display + copy-full Mono/CopyField) plus onboarding model when known; pubkeys (participantPk/communicationPk) live behind the row's technical expander only.
- **D-29:** Pending opt-ins are distinct from seated members (join interest is visible live).
- **D-30:** Submissions: who has submitted / who has not, with timestamps; raw signed-update JSON behind the expander.
- **D-31:** Per-member round state on the member row: pending/seated, submitted, validated, nonce sent, rejected - one place answers "who is holding this cohort up". Rejections also land in the activity log.
- **D-32:** Co-sign progress is per-participant where events carry identity (nonce-received, validation-received do). **Audit-corrected limit:** the partial-signature leg emits NO event and has no accessor - the drill-down honestly shows "all n nonces received, awaiting partial signatures" with no per-member or k/n progress for that leg. File an upstream `@did-btcr2/aggregation` request for a `partial-sig-received {cohortId, participantDid}` event (same posture as the block_time handoff) and adopt when released. The adapter-tap workaround (counting SIGNATURE_AUTHORIZATION wire messages at the HTTP boundary) was explicitly REJECTED - do not tap protocol internals outside the sans-I/O seam.
- **D-33:** Fallback anchoring mirrors participant D-23 operator-side: state plainly that the cohort anchored via the script-path fallback with k of n signatures; per-member inclusion marked where derivable.
- **D-34:** JSON export per cohort (owner divergence from the recommendation to skip): a download serializing the cohort's monitoring DTO + activity log - exactly what the console shows; off-chain artifacts stay referenced by hash at `/cas/*`. A plain gated GET, no new auth surface.

### Live-path enablement (audit-corrected final form)
- **D-35:** Env mapping: `LIVE=1` keeps its current meaning unchanged (live esplora for resolve + `/v1/tx` proxy, fixture co-sign). A NEW `BROADCAST=1` (requires `LIVE=1`, refuses otherwise) passes `{live: true, broadcast: true}` into `createService`, enabling funded live cohorts - one more ADR 0010 layer, zero behavior change for existing deployments. The middle createService mode (live sign, no push) stays unexposed via env. `LIVE_CHANGE_ADDRESS` joins the passthrough set. Loud boot banner on live+broadcast boots (ADR 0010 pattern). The console health strip shows the resulting mode read-only; runtime toggling is Phase 5. - **Reversibility:** costly - env vars are the operator-facing contract documented in docker-compose/DEPLOY.md; renaming after ship breaks deployments.
- **D-36:** Funding stage (watch-only, auto-detect): the drill-down shows the beacon address (copy + explorer link) with THREE states - waiting / seen-in-mempool-awaiting-confirmation / funded-and-confirmed - plus a distinct warn-tone TERMINAL dead-end state. **Predicate rule (audit-critical):** both the advance check and the dead-end check run the library's own `selectSpendableUtxo` over the polled UTXO set and compare THE SELECTED UTXO against the suggested minimum (mirroring the tx.ts pre-flight so watch and builder can never disagree); selection failure maps to waiting/awaiting-confirmation. Never an existence check over the UTXO set. The operator funds from their own external wallet; the app never holds or spends funding keys.
- **D-37:** Suggested minimum = max(MIN_LIVE_FUNDING_SATS 2000, fee+outputs-derived need) - fee derivation only ever raises the displayed ask. The dead-end state reads "funded below the minimum - topping up cannot fix this; re-create the cohort on a fresh address" and fires when the SELECTED confirmed UTXO is below that one number. Displayed ask, watch threshold, pre-flight floor, and dead-end band are one consistent number.
- **D-38:** Funding window semantics: env-tunable window, modest default (~10-15 min); long waits are an explicit operator env choice. **Timer mechanics (audit-critical):** the boot invariant covers the phase-timeout leg only - a live+broadcast boot fail-fast-validates PHASE_TIMEOUT_MS > funding window. The TTL leg is a per-cohort runtime clamp: the funding wait computes its deadline as min(configured window, remaining cohort TTL minus slack) and throws the specific "funding never arrived" reason from INSIDE onProvideTxData before either library timer fires (the throw routes through the library's #failCohort - no library change needed). When clamped, the funding-stage copy discloses the truncated window honestly ("this cohort's remaining lifetime shortens the funding window to ~N min"). Discovery-window semantics stay untouched.
- **D-39:** Blind lapse honesty: the window runs on wall clock, but the terminal "funding never arrived" is declared only when the final watch read was a successful empty observation. If observation gaps (esplora outage) span the lapse, both surfaces get uncertainty-honest copy: "the funding window ended while this service could not observe the chain - check the address before reusing it."
- **D-40:** RECOVERY_KEY posture: every live+broadcast boot without RECOVERY_KEY warns loudly regardless of network, and the funding stage ALWAYS shows the cohort's recovery-key state - "operator-held RECOVERY_KEY" vs "throwaway - if this cohort fails below the fallback threshold, funds sent here are unrecoverable". Mainnet additionally gets the warn-tone real-money line (D-42). ALLOW_MAINNET rails untouched.
- **D-41:** Broadcast send resilience: bounded internal auto-retry - `attachBeaconBroadcast` retains the raw tx and retries the send with backoff for a bounded period before declaring terminal failure (today the send is one-shot and the confirm poll stops after ~180s). No new HTTP surface, no operator action. Exhaustion copy distinguishes "network unreachable at send time" honestly.
- **D-42:** Mainnet: the funding stage carries a warn-tone real-money line when the active network is mainnet; plus one honest line about change routing (change defaults back to the beacon address and is timelocked; LIVE_CHANGE_ADDRESS redirects it).
- **D-43:** Esplora unreachable mid-flight: the health strip flips esplora to unreachable; affected cohorts' anchor/funding sections state they cannot currently observe the chain (stale-honest, D-24-style) while broadcast retry/confirm machinery keeps working underneath.
- **D-44:** Participant-side awaiting-funding: honest waiting copy during the wait, plus a join-time notice on live cohorts ("this cohort anchors on-chain; the operator must fund it after seats fill - keep this tab open"). The funding stage surfaces to the operator the moment keygen completes (attention chip nudges prompt funding, before the wait clock arms at Validated). Delivery vehicle for the mid-round participant signal is planning's choice (see planning notes) - the public anchor read stays byte-untouched.
- **D-45:** Stall-copy fix (audit-corrected operative definition): record the `validation-requested` participant event as a store fact (it fires only after the service collected ALL updates). "Submitted + never validation-requested" is the genuinely positive stall signal ("stalled collecting updates"); "submitted + validation-requested + unsigned" gets the uncertainty-honest "co-signing could not complete; this service didn't say why" line. Reason strings positively matching stall/collectingUpdates patterns keep the dedicated stall copy. Do NOT key the stall copy on submitted-but-unsigned alone - that is the predicate that misfired in live UAT.
- **D-46:** Unconfirmed-signal resolve: guard service-side in the resolve path - detect the mempool-resident-signal condition (upstream `@did-btcr2/method` Invalid Date throw) and return an honest, retryable "a beacon signal is awaiting confirmation - resolve again after it confirms" outcome instead of a 500. No library fork; adopt the upstream fix when released.

### Proof + docs
- **D-47:** Hermetic CI-facing gate: monitoring e2e over the fixture path PLUS a hermetic mocked-chain LIVE funding leg - `createService({live: true, broadcast: true, bitcoin: statefulMock})` per the `e2e/live-mock-cohort.ts` pattern, with `getUtxos` returning `[]` first and a confirmed above-minimum UTXO later, so awaiting-funding -> funded auto-advance is actually exercised. (The funding stage cannot exist on the fixture path: tx.ts short-circuits when `live` is absent and offline-chain always returns zero UTXOs.)
- **D-48:** The uncommitted `e2e/live-uat.ts` harness is formalized into the repo as the repeatable opt-in live check (`pnpm uat:live` against Polar/regtest) - RESHAPED, not verbatim: boot through the env-passthrough demo-server path and drop the getUtxos monkey-patch once the native funding stage exists; keep the runner-event tap and funding prompts.
- **D-49:** A local browser-level operator capstone (playwright-core: login, create, advertise, watch members/submissions/co-sign/anchor states appear), mirroring `e2e:browser:participant`; compose with the live-mock service pattern when it needs anchor states; CI wiring stays Phase 6 debt.
- **D-50:** Plans include a human live-UAT walkthrough checklist (boot live, create, advertise, fund via the new stage, watch anchor confirm, resolve) for the owner to run against Polar.
- **D-51:** SERVICE_NAME: a boot-time env var displayed in the console health strip AND the public directory header beside the origin. No mutating route or edit surface (editing is Phase 5). Carrier DTO is planning's choice (`/v1/config` is the natural boot-constant carrier; `/v1/status` is exact-pinned).
- **D-52:** Docs: extend `docs/DEPLOY.md` with an honest going-live section (env vars incl. BROADCAST/RECOVERY_KEY/funding window, funding walkthrough, network choices, guard rails). The flagship live story is MUTINYNET (default network, real public chain, free coins); regtest/Polar is the local-development story; hermetic remains the boot default.
- **D-53:** A new ADR authored during execution documents the polled monitoring read model + dashboard-SSE retirement, explicitly superseding ADR 0004, and patches ADR 0015's rationale/route inventory (it cites `/dashboard/events` and EventSource header limits; the cookie-session scheme survives on its independent merits).
- **D-54:** The three weak-fold todos become SCOPING DELIVERABLES only - concise decision one-pagers under `.planning/` (problem, options, recommended scope, dependencies incl. upstream needs) for: participant esplora-endpoint override; external signers (incl. the PSBT registration-leg option; full MuSig2 needs an upstream signer interface); ToS/contracts/payments/participant notifications. Build lands in Phase 5/6 or the next milestone.

### Phase priority
- **D-55:** SVC-03 monitoring AND live-path operability are jointly the non-negotiable core. If slicing is needed, the trimmings slip first: export (D-34), SERVICE_NAME (D-51), scoping one-pagers (D-54) - never the two cores.

### Claude's Discretion
- Exact poll intervals, DTO field inventories, env var names (FUNDING window var, BROADCAST spelling), retry/backoff constants, ring-buffer sizes.
- Monitoring accumulator topology (D-27): independent module vs shared accumulator with anchor-state; three existing 24-cap stores (anchor-state broadcast-touched, operator-cohorts expired-only, new monitoring ended) must not disagree inside the single merged read.
- The participant-side mid-round funding-signal vehicle (protocol SSE session vs a new additive public read) - NOT the frozen anchor read.
- SERVICE_NAME carrier DTO.
- Exact copy strings, layout, spacing, visual treatment (UI phase: a UI-SPEC will be authored via /gsd-ui-phase 4 before planning - owner decision).
- Where the funding watch's polling loop lives and when it starts (address is known at keygen-complete; the wait clock arms at Validated).

### Folded Todos
All 7 pending todos were folded (owner selected all):
- **Surface live beacon broadcast in the UI** (was: demo-server never passes live/broadcast) -> D-35 boot enablement + D-17 health strip + D-18 anchor detail.
- **Add operator UI flow to fund cohort beacon address** (was: funding is e2e-only) -> D-36..D-40 funding stage; its explicit "RECOVERY_KEY practice must be surfaced" ask lands in D-40.
- **Fix terminalReason misattributed stall copy** -> D-45 (audit-corrected positive signal).
- **Handle unconfirmed beacon signals during resolution** -> D-46 service-side guard.
- **Let participants supply their own esplora endpoint** -> D-54 scoping one-pager only.
- **Support external signers instead of pasted private keys** -> D-54 scoping one-pager only (upstream interface needed for MuSig2 leg).
- **Scope ToS, contracts, payments, participant notifications** -> D-54 scoping one-pager only.

### Planning notes (audit-verified facts the researcher/planner MUST honor)
1. **Dashboard-SSE retirement fallout:** migrate mechanically in the same change - `operator-boot.spec.ts` 404/401 pins on `/dashboard/events` (inside the CI `pnpm test` gate), `broadcast.spec.ts` uses `bridgeRunnerToSse` as its harness, the `index.ts` re-export, and `e2e/operator-cohort.ts`'s negative-auth 401 pin (Phase 3 security evidence). Move the negative-auth pins to the new gated snapshot reads.
2. **Error-event attribution:** the runner `error` event carries no cohortId, but its sole emit site pairs 1:1 with a cohort-attributed completion rejection carrying the same Error - the monitoring accumulator consumes the completion channel for live failure reasons (`operator-cohorts.ts` settleCompletion already does).
3. **401 discrimination:** the operator store currently swallows fetch failures status-blind; the D-16 redirect and D-25 freeze need explicit 401-vs-network/5xx discrimination on the merged read and all mutating routes.
4. **Live-path requirement bookkeeping:** formalize a requirement ID + success criteria for the live-path half from D-35..D-46 so verification has a contract.
5. **Phase 5 contract debt:** items parked "to Phase 5" here (runtime live toggle, ended-cohort dismissal, SERVICE_NAME edit) plus Phase 3's test-peer control are NOT in Phase 5's written criteria - Phase 5 discuss/plan must absorb or explicitly re-park them.
6. **Ended-record creation:** anchored cohorts are pruned today with no record; failed collapse into 'expired'. The monitoring module creates the anchored/failed/expired taxonomy at event time (before library GC), per D-23.
7. **Library timer facts (verified):** the phase timer resets on entering Validated (full PHASE_TIMEOUT_MS budget for the funding wait); cohort TTL is armed at advertise, never reset, no extension API; #failCohort settles first-wins, so the service's specific throw must fire before either library timer (hence D-38's clamp).
8. **Funding-watch selection facts (verified):** `selectSpendableUtxo` filters confirmed + above-dust and picks the DEEPEST UTXO; dust-only (<= 546 sat) confirmed funding IS fixable by topping up; the 547..min band is not. The tx.ts pre-flight already runs the library's own selection - the watch must reuse that convention (D-36).
9. **Partial-sig leg facts (verified):** after the last nonce-received the runner emits nothing until signing-complete/fallback-started/cohort-failed; the signing session holding partialSignatures is unreachable through the public API (D-32).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap (this milestone)
- `.planning/PROJECT.md` - North Star, constraints (no unauthenticated mutating surface; config-driven network; single-box in-memory; real-money opt-in), the live-path Active bullet, Key Decisions.
- `.planning/REQUIREMENTS.md` - SVC-03 (this phase); SVC-04 (Phase 5 boundary), HOST-02/03 (Phase 6); v2 PMG-01/DUR-01/OACC-01.
- `.planning/ROADMAP.md` - Phase 4 goal + 4 success criteria; Phase 5/6 boundaries.
- `.planning/phases/04-operator-cohort-monitoring/04-DISCUSSION-LOG.md` - full question/answer trail incl. both audit rounds (human reference).

### Prior phase context (decisions carried forward)
- `.planning/phases/03-participant-submit-co-sign-track-and-resolve/03-CONTEXT.md` - D-20/D-21 (anchor read seam Phase 4 extends), D-22 (freeze at first confirmation), D-23 (fallback honesty), D-24/D-25 (unreachable/honest-fallback treatments mirrored here), D-27 (activity log), D-31 (delete-dead-code precedent).
- `.planning/phases/02-participant-discovery-browse-and-pick-join/02-CONTEXT.md` - D-05 (poll pattern), D-08/D-09 (plain language + expander), directory-derives-from-live-set.
- `.planning/phases/01-authenticated-operator-console-on-demand-cohort-creation/01-CONTEXT.md` - D-07/D-08 (fail-closed boot + gated-vs-public split), D-15 (single source of truth), D-16 (basic cohort list this phase grows).
- `.planning/phases/01-authenticated-operator-console-on-demand-cohort-creation/01-UI-SPEC.md` - the design system the console rework EXTENDS (a new UI-SPEC will be authored via /gsd-ui-phase 4).

### Architecture + protocol ADRs (do not violate; one gets superseded)
- `docs/adr/0015-operator-authentication.md` - the gated-vs-public route split every new read/route must respect; its SSE rationale gets patched by the new ADR (D-53).
- `docs/adr/0004-dashboard-sse-telemetry-channel.md` - the channel this phase RETIRES; the new ADR explicitly supersedes it (D-19/D-53).
- `docs/adr/0010-mainnet-guard-rails.md` - the layered opt-in + loud-banner pattern D-35/D-40/D-42 apply; names the RECOVERY_KEY funds-loss mode.
- `docs/adr/0003-same-origin-topology.md`, `docs/adr/0014-deployment-topology.md` - one origin, one process, one image; env-driven boot config BROADCAST joins.
- `docs/adr/0013-regtest-ci-live-path.md` - the existing opt-in live leg the formalized harness (D-48) sits beside.

### Folded todos (original asks; D-54 one-pagers trace back to these)
- `.planning/todos/pending/2026-07-21-surface-live-beacon-broadcast-in-the-ui.md`
- `.planning/todos/pending/2026-07-21-add-operator-ui-flow-to-fund-cohort-beacon-address.md`
- `.planning/todos/pending/2026-07-22-fix-terminalreason-misattributed-stall-copy.md`
- `.planning/todos/pending/2026-07-21-handle-unconfirmed-beacon-signals-during-resolution.md`
- `.planning/todos/pending/2026-07-21-let-participants-supply-their-own-esplora-endpoint.md`
- `.planning/todos/pending/2026-07-21-support-external-signers-instead-of-pasted-private-keys.md`
- `.planning/todos/pending/2026-07-21-scope-tos-contracts-payments-and-participant-notifications.md`

### Key source files this phase reshapes (audit-grounded)
- `packages/service/src/dashboard-sse.ts` + `packages/web/src/stores/dashboard.ts` + `packages/web/src/components/dashboard/*` - retire (D-02/D-19); note the spec/e2e consumers in planning note 1.
- `packages/service/src/operator-cohorts.ts` (+ spec) - the gated list read D-20 merges into; settleCompletion (completion-rejection reasons); expired records + re-advertise.
- `packages/service/src/anchor-state.ts` (+ spec) - the bounded-fold pattern D-19 extends; PUBLIC read stays byte-untouched (D-26/D-27).
- `packages/service/src/hono-adapter.ts` + `packages/service/src/operator-auth.ts` - gated mounts for the new reads + export; 401 semantics (D-16, note 3).
- `packages/service/src/broadcast.ts` - one-shot send today; D-41's bounded retry lands here; confirm-poll budget facts.
- `packages/service/src/tx.ts` - MIN_LIVE_FUNDING_SATS, the pre-flight that runs the library's own selection (D-36/D-37), the onProvideTxData throw path D-38 rides.
- `packages/service/src/demo-server.ts` - env passthrough (D-35), boot banner + RECOVERY_KEY warn (D-40), boot invariant validation (D-38).
- `packages/service/src/index.ts` - createService live/broadcast/autoFallbackOnStall wiring; where the funding wait wrapper hooks onProvideTxData.
- `packages/service/src/resolve.ts` - D-46's unconfirmed-signal guard.
- `packages/service/src/beacon-address.ts`, `packages/service/src/offline-chain.ts` - recovery-leaf script tree (D-40 copy accuracy); why the fixture path cannot host the funding stage (D-47).
- `packages/web/src/stores/participant.ts` + `packages/web/src/components/cohort/CohortPage.tsx` - D-44 join notice + waiting copy, D-45 stall predicate + validation-requested fact.
- `packages/web/src/stores/operator.ts` + `packages/web/src/lib/operator.ts` + `packages/web/src/components/operator/*` - the console rework surface (D-01..D-17).
- `packages/web/src/lib/anchor.ts` - the public anchor DTO consumption (frozen; D-44 vehicle must not touch it).
- `e2e/live-uat.ts` (UNCOMMITTED, on disk) - the harness D-48 formalizes; its funding-wait wrapper + timer comments encode the D-38 constraints.
- `e2e/live-mock-cohort.ts` + `e2e/lib/*` - the mocked-chain live pattern D-47/D-49 build on.

### Library facts to re-verify at research time (versions: aggregation@0.4.0, method@0.51.0)
- `@did-btcr2/aggregation` service-runner: TTL armed at advertise / phase-timer reset per transition / #failCohort first-settlement-wins / no partial-sig event or session accessor (planning notes 7, 9).
- `@did-btcr2/method` beacon UTXO selection: confirmed-only, dust filter, deepest-first (planning note 8).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`anchor-state.ts` bounded-fold pattern** (events -> capped per-cohort map -> snapshot DTO) - the architectural template for the whole monitoring read model (D-19/D-23).
- **`operator-cohorts.ts` list read + settleCompletion** - the merge target for the summary read (D-20) and the reliable failure-reason channel (planning note 2).
- **The runner's event set + broadcaster frames** - the monitoring module's inputs; `dashboard-sse.ts`'s SERVICE_EVENTS list and serializers are a reference for payload shapes even as the SSE itself retires.
- **`e2e/live-mock-cohort.ts` mockBitcoin** - extend to a stateful unfunded-then-funded mock for D-47.
- **`e2e/live-uat.ts` funding-wait wrapper + runner-event tap** - the raw material for D-48's formalization; its comments encode the timer constraints D-38 resolves.
- **`ui/primitives.tsx` + the Phase 1 design system** - build the console rework from these; a new UI-SPEC extends 01-UI-SPEC.md.
- **`tx.ts` pre-flight** - the selection-mirroring convention D-36 generalizes; MIN_LIVE_FUNDING_SATS is D-37's floor.
- **Participant D-24/D-25 treatments** - mirrored operator-side (D-25) and reused for the esplora-outage narration (D-43).

### Established Patterns
- **Truthful, mode-honest copy as a hard rule** - "Anchored" only when confirmed; positive claims only from observed facts (D-39 extends this to funding lapses); uncertainty-honest fallbacks everywhere.
- **Public reads anonymous, operator surfaces gated** (ADR 0015) - all new detail reads + export sit inside the operatorAuth block; public DTOs frozen (D-26).
- **Opt-in behind loud guard rails** (ADR 0010) - BROADCAST=1 layering, boot banner, RECOVERY_KEY warning (D-35/D-40).
- **Bounded in-memory retention** (anchor-state's 24) - reused for ended cohorts and log rings (D-21/D-23).
- **Single source of truth from the live runner set** - monitoring derives, never maintains a parallel list.
- **Plain-first + technical expander** - extended to the operator console (D-12).

### Integration Points
- Monitoring module <-> runner events + broadcaster frames + completion rejections (`index.ts` wiring).
- Gated summary/detail reads + export <-> `hono-adapter.ts` operatorAuth block.
- Funding watch <-> `tx.ts` onProvideTxData wait (clamped, D-38) <-> BitcoinConnection UTXO reads <-> funding-stage DTO states.
- Send retry <-> `broadcast.ts` <-> anchor-state folds (broadcast/anchored/failed frames unchanged in shape).
- Participant store <-> validation-requested fact (D-45) + join notice/waiting copy vehicle (D-44).
- Console rework <-> `stores/operator.ts` polling + 401 discrimination (D-16).
- New ADR <-> docs/adr sequence (supersedes 0004, patches 0015 rationale).
</code_context>

<specifics>
## Specific Ideas

- The owner drove maximum thoroughness: every continue-gate was answered "More questions" until areas ran dry, then two ultracode adversarial audit rounds (74 agents total) were run over the captured decisions; round-1 found 9 verified issues, round-2 found 4, converging. The owner consistently took the recommended pragmatic-honest option, with ONE divergence: the JSON export (D-34) was chosen against the skip recommendation.
- Honesty over polish remains the through-line, now extended to observability itself: a positive terminal claim may only be made from an observed fact (D-39); truncated windows are disclosed (D-38); unknowable progress is not invented (D-32).
- The owner's priority sentence for this phase: "the actual real server working out-of-the-box, not via an e2e script" - live-path operability is co-equal core with SVC-03 (D-55).
- Mid-discussion the owner asked whether the app is going multi-tenant/multi-network on both sides; the locks were kept (one operator, one network per boot, many concurrent cohorts service-side, one cohort at a time participant-side) WITH an explicit revisit note for the next milestone (see Deferred).
</specifics>

<deferred>
## Deferred Ideas

- **PRIORITY REVISIT (owner-flagged): multi-network cohorts + participant multi-cohort (PMG-01)** - the owner wants these prioritized in the NEXT milestone discussion; today's locks (Phase 1 D-10 single active network, Phase 2 D-07 one-cohort-at-a-time, OACC-01 single operator) stand for this milestone.
- **Phase 5 contract absorption** - runtime live/broadcast toggle, ended-cohort dismissal, SERVICE_NAME edit surface, operator test-peer control (Phase 3 D-33): all parked "to Phase 5" but absent from Phase 5's written criteria; Phase 5 discuss must absorb or re-park (planning note 5).
- **Routed URLs** for operator + participant cohort pages - later, both sides at once (D-03).
- **Building the weak-three** - participant esplora override, external signers (PSBT leg first), ToS/payments/notifications: scoping one-pagers this phase (D-54), build later.
- **Upstream requests filed/adopted-when-released:** partial-sig-received event (D-32); block_time unconfirmed-signal fix (D-46, already handed off).
- **Operator resolve-traffic telemetry** (resolves served) - a future ops phase.
- **Cross-cohort DID correlation** in the console - v2, alongside PMG-01.
- **Full artifact-bundle export** (operator-side sidecar) - export stays monitoring-record-only (D-34).
- **Standalone OPERATOR.md handbook** - DEPLOY.md section chosen for now (D-52).
- **Seat persistence pull-forward** (survive refresh) - explicitly NOT chosen for the funding-wait problem (D-44 join notice + modest window instead); stays v2 DUR-01.
- **Adapter-tap partial-sig workaround** - explicitly rejected (D-32); do not resurrect without an owner decision.
- **Inline re-auth overlay, side-panel drill-down, protocol-first copy register, live confirmation counts, attention toasts/tab-title escalation, cumulative metrics** - considered and not chosen; the discussion log records the full option trail.

### Reviewed Todos (not folded)
None - all 7 pending todos were folded (see Folded Todos).
</deferred>

---

*Phase: 4-operator-cohort-monitoring*
*Context gathered: 2026-07-23*
