# Phase 5: Operator Cohort Lifecycle Control - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The operator runs aggregation and controls each cohort's lifecycle from the authenticated console - cancels a cohort at any pre-broadcast stage, finalizes a stalled signing round via the k-of-n fallback, pauses/unpauses advertising drain-mode style, and reconfigures cohort shape and service settings at runtime - all without restarting the process (SVC-04). The public directory reflects every state change honestly, and a canceled cohort stops being joinable immediately.

By explicit owner direction this phase ALSO: (a) absorbs all four items parked "to Phase 5" by earlier phases - a broadcast-only kill switch, ended-cohort dismissal, SERVICE_NAME editing, and an operator test-peer control; and (b) folds in build work from the three Phase 4 scoping one-pagers - the participant esplora override, the external-signers PSBT registration leg, and a DID-signed ToS acceptance slice. The owner chose to fold all three against the keep-deferred recommendation (recorded in Specifics).

**Requirements:** SVC-04 (this phase's requirement of record). The three folded builds have no requirement IDs yet - planning must mint them (mirroring the Phase 4 LIVE-01 precedent) so verification has contracts (see planning notes).

**In scope:** cohort-level Cancel + Finalize-now actions with laddered confirmation ceremonies; the drain-mode advertising pause with an honest public paused notice; draft editing + create-form defaults + per-draft advanced timing fields; a service-settings surface on the env-seeds/runtime-overrides model; the broadcast kill switch; ended-record dismissal; SERVICE_NAME runtime edit; operator test peers (any mode, badged); the participant esplora-endpoint override; the PSBT registration-leg round trip + paste-import warning; DID-signed ToS acceptance at join; candidate-requirements capture for payments/notifications/contracts.

**Out of scope (later phases / v2 / upstream):** active per-seat reclaim/kick (upstream seat-release API missing - re-parked with honest workaround copy); building payments, notifications, or contracts (requirements capture only; product-model decision anonymous-vs-accounts still open); external co-sign via MuSig2 signer interface (upstream-blocked, request filed posture); dual-read esplora verification and extension-wallet signers (later refinements); runtime ENABLE of live/broadcast (forbidden - ADR 0010 env rails stand); routed URLs; stranger-to-stranger CI e2e + booth-framing sweep (Phase 6); durable state (v2 DUR-01).
</domain>

<decisions>
## Implementation Decisions

### Cohort lifecycle verbs (Cancel / Finalize-now / the honest "close")
- **D-01:** The console exposes only honest primitives: **Cancel** (wraps `runner.stopCohort`) and **Finalize now** (wraps `runner.triggerFallback`, which the library itself documents as an operator "fall back now" UI action). "Close" is NOT a button: it is the automatic lock when the nth seat fills (min == max == n), narrated as a lifecycle stage. No synthetic close state, no directory-retract verb - a partially filled n-of-n cohort that stopped accepting joins could never proceed, so "close early" is just Cancel and the UI must not pretend otherwise.
- **D-02:** Participant-side cancel narration is **specific if carried**: aim for "the operator canceled this cohort" when the protocol/service can carry that attribution to the participant (research verifies the channel - the stopped-error completion rejection and what reaches participant runners); otherwise fall back to the honest Phase 3 D-25 line ("the cohort ended and this service didn't say why"). Never invent certainty; the canceled reason must not collide with the 04 D-45 stall predicate.
- **D-03:** Confirmation ceremonies use **laddered friction**: Cancel = explicit-consequence dialog naming the cohort and its seated-participant count ("N seated participants will lose their seats"); canceling a FUNDED live cohort is the top rung - type-to-confirm, with the recovery-key state line ("operator-held RECOVERY_KEY" vs "funds sent here are unrecoverable", reusing 04 D-40 disclosure); Finalize-now = simple confirm stating the k-of-n consequence. Action-verb buttons, danger tone, never color alone.
- **D-04:** Cancel is available from Advertised through the signing stages - any point **before the beacon tx broadcasts**. After broadcast the action is hidden with honest copy (the transaction is out; nothing to cancel). Draft "cancel" remains the existing Discard.
- **D-05:** Canceled cohorts get a **distinct 'canceled' fate** in the ended taxonomy (chip + monitoring record + activity-log entry), never folded into 'failed' - the operator meant to do it. The fate is captured at event time per the 04 D-23 pattern and joins the bounded ended retention.

### Advertising pause (service-level drain mode)
- **D-06:** Pause is **drain mode**: it blocks NEW advertise and re-advertise actions only. Already-advertised cohorts keep filling, in-flight cohorts run to completion, seated participants are untouched, and resolve/anchor/monitoring/CAS routes stay up. Full quiesce = pause + individually canceling remaining open cohorts (D-01's ceremony each time - no bulk auto-retract).
- **D-07:** While paused, the public directory shows an **honest paused notice** ("this service isn't offering new cohorts right now" - exact copy is a UI call) replacing the generic empty-state line, in-flight rows keep showing, and `GET /v1/status` carries a **paused bit** so headless clients can tell a paused service from an idle one. - **Reversibility:** costly - `/v1/status` is exact-pinned; the additive DTO change must migrate every pin in the same change (Phase 4 planning-note-1 pattern).
- **D-08:** The paused state is an **in-memory runtime flag** behind a gated operator route, toggled from the console near the health strip. Restart resets to unpaused - consistent with the in-memory posture (DUR-01 stays v2) and disclosed by the existing restart-clears-state line. No persistence, no boot-default env var this phase.
- **D-09:** While paused, **everything except advertise stays available**: drafts can be created/edited/discarded (prep while quiet), Cancel/Finalize-now/monitoring/export all work; Advertise and Re-advertise render disabled with an honest "advertising is paused" note.

### Reconfigure without restart (drafts, defaults, settings surface)
- **D-10:** Two additions close criterion 3: **in-place draft editing** (an update path with the same validation as create; no more discard+recreate) and **create-form defaults** the operator sets on the new settings surface (beacon type, n, k). 
- **D-11:** The cohort **timing windows become per-draft advanced fields** - discovery window and funding window as optional fields seeded from the env defaults, exposed where the library actually supports per-cohort values (research verifies which of TTL/phase-timeout are per-cohort vs per-runner in `aggregation@0.4.0`). The 04 D-38 clamp invariants (funding wait < remaining TTL, specific throw before either library timer) must keep holding for any per-draft values.
- **D-12:** The settings surface follows an **env-seeds, runtime-overrides** model: env vars seed boot values; the console edits the in-memory runtime value behind gated routes; restart returns to env (disclosed honestly). Every setting displays its source - "env default" vs "changed this session". No settings persistence (that door opens with DUR-01).
- **D-13:** **Next-cohort-only is a hard rule**: defaults, draft edits, and timing fields apply only to drafts and future cohorts. An advertised or in-flight cohort's shape is immutable (the advert is public, seats may be filling); the UI states "applies to new cohorts only" plainly. The considered cancel-and-redraft convenience helper was not chosen (deferred).

### Absorbed parked items (04 planning note 5 settled)
- **D-14:** **Live/broadcast kill switch - broadcast only, disable only.** A console control stops the money-moving leg for NEW cohorts (they fall back to the fixture path); LIVE esplora reads stay up (resolve, anchor observation, health strip unaffected - 04 D-43 posture preserved); in-flight cohorts finish under the mode they started with. One-way per session: re-enabling requires the boot env. Danger-tone confirm + activity-log entry. Runtime ENABLE of live/broadcast from the console stays forbidden - the ADR 0010 layered env opt-in remains the only path to money movement. - **Reversibility:** one-way within a session by design - the escape hatch is a restart returning to the boot env contract.
- **D-15:** **Ended-cohort dismissal** (was 04 D-14): a gated dismiss action removes an ended record (anchored/failed/expired/canceled) from the console's ended group ahead of the bounded-24 eviction. Simple confirm; log entry; no undo (the record is telemetry, not protocol state).
- **D-16:** **SERVICE_NAME edit** (was 04 D-51's parked surface): joins the settings surface under the D-12 model - runtime edit, restart returns to env, plain auto-escaped text, no new carrier semantics (same additive `/v1/config` field shipped in 04-03).
- **D-17:** **Operator test peers** (was 03 D-33): a drill-down action fills a cohort's remaining seats with in-process test participants, available in hermetic AND live mode - so an operator can rehearse the full live funding/co-sign path solo (the Phase 4 UAT needed two humans for exactly this). Test-peer members are clearly badged in the operator console and stamped in the activity log; framing is "rehearse your service", never demo filler (no auto-fill, no boot-time filler loop - HOST-03 posture). Live-mode test peers participate for real with in-process throwaway keys.
- **D-18:** **Active seat reclaim is re-parked** (was 02 D-15/D-16): a true per-seat release needs an upstream seat-release API that `aggregation@0.4.0` lacks (documented known limit). File it with the queued upstream issue batch. Meanwhile the drill-down honestly documents the operator workaround: a stuck filling cohort with an abandoned seat is resolved by Cancel + re-advertise, alongside the existing TTL reclaim.

### Folded builds (from the three Phase 4 scoping one-pagers)
- **D-19:** **DID-signed ToS acceptance at join** is the built slice of the ToS/payments one-pager: the operator sets terms text via the settings surface (empty = no ToS step, feature fully absent); when set, the join flow requires the participant to accept, and the acceptance is recorded as a DID-signed artifact (both sides already hold did:btcr2 identities - the one-pager's lowest-new-trust synergy). Enforcement is app-level (the browse-and-pick UI join); a headless protocol client can still opt in without the UI - this limit is disclosed honestly, not papered over. Payments, notifications, and contracts are NOT built: they are captured as candidate requirements for the next milestone (the anonymous-utility vs accounts product-model decision and the owner's legal questions come first). - **Reversibility:** costly - once real acceptances exist, the artifact format is a proof format participants may rely on; research should shape it deliberately.
- **D-20:** **Participant esplora override, as scoped** (one-pager option 2): one optional endpoint field in the participant surface; when set, UTXO checks and anchor polling go direct to that endpoint (the same-origin proxy stays the zero-config default); broadcast via the override is a second explicit opt-in within the opt-in. CORS failures get the specific "this endpoint does not allow browser requests" copy; a network-mismatch guard refuses an endpoint whose chain disagrees with `GET /v1/config`; ADR 0010 real-funds acknowledgment gates are unweakened.
- **D-21:** **External signers - PSBT registration leg + import warning** (one-pager option 2 + the zero-dependency mitigation): the app builds the KEY first-update registration tx as an unsigned PSBT (P2TR key-spend, BIP-371 fields) handed out via download/copy, accepts the signed PSBT back via upload/paste, and validates it before broadcast - compatible with the 2026 wallet landscape (Sparrow/Coldcard 5.5+/Ledger 2.x). The paste-import path gains an ephemeral-session warning and imported secrets are never persisted. The co-sign leg stays upstream-blocked on an aggregation signer interface (same posture as the partial-sig event request).
- **D-22:** **Slip order is three tiers** (the 04 D-55 pattern): CORE, never slips - SVC-04 lifecycle control (Cancel/Finalize-now, pause, reconfigure + settings surface). SECOND - the four absorptions (kill switch, dismissal, SERVICE_NAME edit, test peers). SLIP-FIRST - the three folded builds (esplora override, PSBT leg, ToS slice), which re-park cleanly to Phase 6 or the next milestone if the phase runs long.

### Claude's Discretion
- Exact route paths, DTO field names, env var names for new knobs, poll interval reuse, retry constants.
- Finalize-now visibility mechanics (always-rendered during signing vs stall-emphasized), and its disabled-state copy outside signing.
- Which knobs beyond defaults/SERVICE_NAME/pause/kill-switch appear on the settings surface, and its layout.
- ToS artifact storage location and acceptance-proof shape (CAS-addressed vs elsewhere) - research informs; the DID-signed requirement is locked.
- PSBT transfer UX details (file vs copy default, validation depth before broadcast).
- Test-peer count limits, naming, and teardown behavior.
- Exact copy strings, layout, spacing, tones (a UI-SPEC should be authored via /gsd-ui-phase 5 before planning, mirroring Phase 4 - owner precedent).

### Folded Todos
The three weak-fold todos from Phase 3 UAT, scoped as one-pagers in Phase 4 (D-54), are now folded as BUILD work with the scopes above:
- **Let participants supply their own esplora endpoint** -> D-20 (traces to `.planning/scoping/participant-esplora-override.md`).
- **Support external signers instead of pasted private keys** -> D-21 (traces to `.planning/scoping/external-signers.md`).
- **Scope ToS, contracts, payments, participant notifications** -> D-19 builds the ToS slice only; the rest is requirements capture (traces to `.planning/scoping/tos-payments-notifications.md`).

### Planning notes (facts the researcher/planner MUST honor)
1. **Library control surface (verified this discussion, `service-runner.d.ts` at aggregation@0.4.0):** `stopCohort(cohortId)` drops the cohort's state machine and rejects its completion with a stopped error; `triggerFallback(cohortId)` is idempotent, commits the fallback path synchronously, throws if signing has not started; `stop()` fails every cohort. There is NO un-advertise, seat-release, or reconfigure primitive. Research must verify how a stopped cohort interacts with the advert replay window (advertTtlMs threading from 04-08) - a canceled cohort's advert must stop being replayed or the directory/SSE will disagree.
2. **`/v1/status` is exact-pinned** (04 D-51 note): the D-07 paused bit is an additive change that must migrate every committed pin in the same change. The directory DTO stays byte-frozen otherwise.
3. **Fate propagation for 'canceled':** the monitoring fold, operator-cohorts read, and web directory each carry phase/fate sets that were burned once before (the 04-08 three-mirrored-places lesson on IN_FLIGHT_PHASES). Adding the canceled fate must touch ALL mirrored sites in one change, and a canceled funding-stage cohort must retire its funding watch cleanly (funded is a terminal display state; canceled must also terminate the watch).
4. **Cancel vs stall copy:** the 04 D-45 stall predicate keys on the validation-requested store fact; the canceled narration (D-02) must route through the D-25 reason path without re-triggering stall copy.
5. **Requirement bookkeeping:** SVC-04 covers D-01..D-13 (+D-14..D-17 as operator-control extensions). Planning must mint requirement IDs for the three folded builds (esplora override, external signers, ToS acceptance) with their own success criteria, updating REQUIREMENTS.md and the ROADMAP phase entry - LIVE-01 is the precedent.
6. **Pause vs kill switch are distinct flags:** pause stops NEW adverts (protocol intake); the kill switch downgrades broadcast for NEW cohorts (money movement). Both are in-memory, both surface in/near the health strip, neither touches in-flight cohorts. Do not merge them into one "mode" enum.
7. **Test peers:** the booth-era filler loop was deleted in Phase 1; the FILLERS env in demo-server is dev-only residue. The test-peer action should spawn in-process `createParticipant` instances on operator demand - research verifies what filler machinery remains reusable and how test peers behave on live cohorts (real co-sign with throwaway keys).
8. **ToS enforcement boundary:** the library opt-in path cannot carry ToS acceptance; enforcement is the app-level join UI plus the recorded artifact. State the headless-bypass limit honestly in copy and docs rather than pretending protocol-level enforcement.
9. **PSBT leg grounding:** the registration tx is a plain P2TR key-spend (ADR 0007/0008 machinery); the PSBT round trip replaces the in-browser key requirement for that step only. Validate the returned PSBT (correct outputs, fee sanity) before broadcast; the ADR 0010 acknowledgment gates still apply.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap (this milestone)
- `.planning/PROJECT.md` - North Star, constraints (no unauthenticated mutating surface; config-driven network; single-box in-memory; real-money opt-in), Key Decisions.
- `.planning/REQUIREMENTS.md` - SVC-04 (this phase); HOST-02/03 (Phase 6 boundary); v2 DUR-01/PMG-01/OACC-01; planning note 5 requires minting IDs for the folded builds here.
- `.planning/ROADMAP.md` - Phase 5 goal + 4 success criteria; Phase 6 boundary.
- `.planning/phases/05-operator-cohort-lifecycle-control/05-DISCUSSION-LOG.md` - full question/answer trail (human reference).

### The folded one-pagers (now build scope; read for their constraints + open questions)
- `.planning/scoping/participant-esplora-override.md` - CORS constraint, network-mismatch guard, option-2 shape D-20 locks.
- `.planning/scoping/external-signers.md` - MuSig2 upstream blocker, PSBT registration-leg shape D-21 locks, import-warning mitigation.
- `.planning/scoping/tos-payments-notifications.md` - the product-model question, the DID-signed synergy D-19 builds, the do-not-build boundary for payments/notifications.

### Prior phase context (decisions carried forward)
- `.planning/phases/04-operator-cohort-monitoring/04-CONTEXT.md` - D-14/D-35/D-51 (the parked items this phase absorbs), D-19..D-27 (polled read model + bounded retention the lifecycle reads extend), D-36..D-46 (funding/live-path decisions the cancel ceremony and kill switch must respect), planning notes 1-9.
- `.planning/phases/03-participant-submit-co-sign-track-and-resolve/03-CONTEXT.md` - D-24/D-25 (unreachable/honest-fallback treatments D-02 rides), D-33 (test-peer parking this phase absorbs).
- `.planning/phases/02-participant-discovery-browse-and-pick-join/02-CONTEXT.md` - D-15/D-16 (seat-reclaim parking D-18 re-parks), directory-derives-from-live-set.
- `.planning/phases/01-authenticated-operator-console-on-demand-cohort-creation/01-CONTEXT.md` - gated-vs-public split, single source of truth, fillers-as-dev-only lineage for D-17.

### Architecture + protocol ADRs (do not violate)
- `docs/adr/0015-operator-authentication.md` - every new lifecycle/settings route sits inside the operatorAuth block.
- `docs/adr/0016-*.md` (polled monitoring read model) - the read model all new lifecycle state flows through.
- `docs/adr/0010-mainnet-guard-rails.md` - the layered env opt-in D-14 preserves (disable-only at runtime).
- `docs/adr/0003-same-origin-topology.md`, `docs/adr/0014-deployment-topology.md` - one origin, one process; the esplora override is an explicit, participant-chosen exception to same-origin reads.
- `docs/adr/0007-*.md` + `docs/adr/0008-*.md` - the KEY first-update registration machinery the PSBT leg (D-21) reshapes.
- `.planning/phases/04-operator-cohort-monitoring/04-LIVE-UAT-CHECKLIST.md` - the six known upstream limits constraining lifecycle control (single advert slot, no seat release, silent surplus opt-in drop, ignored advertRepeatIntervalMs, 60s envelope skew, deepest-first coin selection).

### Key source files this phase reshapes
- `packages/service/src/operator-cohorts.ts` (+ spec) - createDraft/advertiseDraft/discardDraft/readvertiseExpired/listCohorts/directory/status; gains draft edit, cancel, pause gating, canceled fate, paused status bit.
- `packages/service/src/index.ts` - createService wiring; where stopCohort/triggerFallback/test-peer/kill-switch actions bind to the runner.
- `packages/service/src/hono-adapter.ts` + `packages/service/src/operator-auth.ts` - gated mounts for all new mutating routes; 401 semantics.
- `packages/service/src/monitor.ts` - ended taxonomy (+canceled), chips, serviceHealth (paused/kill-switch bits), activity-log entries for operator actions.
- `packages/service/src/anchor-state.ts`, `packages/service/src/broadcast.ts`, `packages/service/src/tx.ts` - funding watch retirement on cancel; broadcast-mode selection for the kill switch; the D-38 clamps per-draft windows must respect.
- `packages/service/src/demo-server.ts` - env passthrough for any new seeds; boot banners unchanged.
- `packages/web/src/stores/operator.ts` + `packages/web/src/lib/operator.ts` + `packages/web/src/components/operator/*` - console actions, ceremonies, settings surface, test-peer badging, paused/kill-switch indicators.
- `packages/web/src/stores/participant.ts` + `packages/web/src/components/cohort/*` - canceled narration, ToS acceptance step, esplora-override reads, PSBT round-trip UI, import warning.
- `packages/web/src/lib/tx-client.ts` + `packages/web/src/lib/resolve.ts` + `packages/web/src/lib/sidecar.ts` - the chain-read/broadcast seams the esplora override reroutes; registration tx build for the PSBT leg.
- `e2e/operator-cohort.ts` + `e2e/lib/*` + `e2e/live-mock-cohort.ts` - the hermetic + mocked-chain harnesses lifecycle proofs extend; `pnpm uat:live` for the owner walkthrough.

### Library facts to re-verify at research time (aggregation@0.4.0, method@0.51.0)
- `AggregationServiceRunner`: stopCohort semantics (state drop + stopped-error completion rejection), triggerFallback preconditions, advert replay behavior after stopCohort, per-cohort vs per-runner TTL/phase-timeout/funding-window config.
- What reason/attribution reaches participant runners when a cohort is stopped (drives D-02's specific-if-carried).
- `@did-btcr2/method` registration-tx construction surface for PSBT serialization (D-21).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`operator-cohorts.ts` draft/expired/re-advertise machinery** - the lifecycle module cancel, draft-edit, pause gating, and the canceled fate extend; settleCompletion is the failure-reason channel.
- **`monitor.ts` ended taxonomy + bounded retention + activity ring** - canceled fate, dismissal, and operator-action log entries slot straight in (04 D-21..D-23 patterns).
- **The 04-06 funding stage + classifyFunding predicate** - the funded-live cancel ceremony reads its state; cancel must retire the watch.
- **`ui/primitives.tsx` + the Phase 1/4 design system + OperatorStageTimeline** - ceremonies, settings surface, badges build from these; a new UI-SPEC extends the Phase 4 one.
- **RegisterPanel-lineage registration logic (ADR 0007/0008) in the participant store** - the exact tx the PSBT leg serializes instead of signing in-browser.
- **`lib/tx-client.ts` proxy reads** - the seam the esplora override reroutes; `@did-btcr2/bitcoin` already ships the browser esplora REST client.
- **`e2e/live-mock-cohort.ts` stateful mock + `pnpm uat:live`** - lifecycle proofs (cancel mid-funding, kill switch, pause) compose with these.

### Established Patterns
- **Gated mutating routes only** (ADR 0015) - every new action/settings route inside operatorAuth; public reads stay anonymous.
- **Additive public DTO changes migrate their pins in the same change** - the paused bit on `/v1/status` follows the 04 dashboard-retirement lesson.
- **Truthful, mode-honest copy as a hard rule** - canceled vs failed vs expired are distinct facts; disable reasons stated plainly; no synthetic states.
- **Env-seeded boot config, runtime state in memory, restart honesty** - the settings model extends the existing disclosure line rather than inventing persistence.
- **Bounded in-memory retention** (24-cap stores) - dismissal operates on these, never on protocol state.
- **Opt-in behind loud guard rails** (ADR 0010) - kill switch is disable-only; esplora-override broadcast is opt-in-within-opt-in.

### Integration Points
- Cancel/Finalize-now <-> `runner.stopCohort`/`runner.triggerFallback` <-> completion rejections <-> monitor fold + directory reads.
- Pause flag <-> advertiseDraft/readvertiseExpired guards <-> directory empty-state copy <-> `/v1/status` paused bit <-> console switch.
- Settings surface <-> gated settings routes <-> in-memory config holder seeded at boot <-> create-form defaults + SERVICE_NAME + ToS terms text.
- Kill switch <-> createService broadcast wiring for NEW cohorts <-> health strip mode display.
- Test peers <-> in-process `createParticipant` spawns <-> monitor member badging <-> activity log.
- ToS acceptance <-> join flow step <-> DID-signed artifact storage <-> operator terms setting.
- Esplora override <-> participant store chain reads (`tx-client`/anchor polling) <-> network-mismatch guard vs `/v1/config`.
- PSBT leg <-> registration tx builder <-> file/paste round trip <-> validation before the existing broadcast path.
</code_context>

<specifics>
## Specific Ideas

- **Owner divergence to record:** offered the recommended "keep all three deferred", the owner explicitly chose to FOLD all three scoping one-pagers into Phase 5 as build work (confirmed after a clarifying question). The ToS fold was then bounded to the DID-signed acceptance slice + requirements capture (D-19), matching the one-pager's own do-not-build line for payments/notifications.
- Every other question resolved to the recommended pragmatic-honest option - the same pattern as Phases 2-4: maximum truthfulness in copy, minimum new backend, no synthetic states.
- The through-line the owner keeps confirming, extended to control actions: an operator verb exists only where a real primitive exists (D-01); a destructive act names its real consequences (D-03); runtime power only ever points in the safe direction (D-14).
- The test-peer decision was accepted specifically for the solo live rehearsal story - the Phase 4 UAT needed two humans where one operator should have been able to rehearse alone.
</specifics>

<deferred>
## Deferred Ideas

- **Payments, notifications, contracts** - captured as candidate requirements for the next milestone; the anonymous-utility vs accounts product-model decision and the owner's legal/compliance questions come first (D-19; `.planning/scoping/tos-payments-notifications.md`).
- **Active per-seat reclaim/kick** - re-parked pending an upstream seat-release API in `@did-btcr2/aggregation`; file with the queued upstream issue batch (D-18).
- **External co-sign for MuSig2** - blocked on the upstream signer interface; adopt when released (D-21).
- **Dual-read esplora verification** (proxy + override disagreement flagging) - later refinement on top of D-20.
- **Extension-wallet signer integration** - after the PSBT leg lands; landscape still thin (D-21).
- **Cancel-and-redraft convenience helper** on advertised cohorts - considered, not chosen; next-cohort-only immutability stands (D-13).
- **Bulk pause auto-retract** (cancel all open cohorts in one sweep) - considered, not chosen; per-cohort ceremony stands (D-06).
- **Pause boot-default env var** and **settings persistence to disk** - not this phase; persistence is DUR-01 territory (D-08/D-12).
- **Reversible in-session kill switch** (runtime re-enable) - explicitly rejected; re-enable is a boot-env act (D-14).
- **Runtime ENABLE of live/broadcast** - forbidden on ADR 0010 grounds; do not resurrect without an owner decision.
- **Ended-record dismissal undo** - dismissal is final within the bounded telemetry store (D-15).
- **Upstream issue filing** for the six documented library limits - still queued from Phase 4; the seat-release request joins it.

### Reviewed Todos (not folded)
None - the four strong todos shipped in Phase 4; the three weak todos are folded as build scope this phase (see Folded Todos).
</deferred>

---

*Phase: 5-operator-cohort-lifecycle-control*
*Context gathered: 2026-07-28*
