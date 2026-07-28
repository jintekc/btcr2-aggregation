# Phase 5: Operator Cohort Lifecycle Control - Research

**Researched:** 2026-07-28
**Domain:** Operator lifecycle control over a multi-cohort `AggregationServiceRunner`; runtime service configuration without restart; participant-side chain-read override, PSBT round trip, and DID-signed acceptance artifacts.
**Confidence:** HIGH (every library claim is verified against the installed dist/src under `node_modules/.pnpm`, with file paths and line numbers; the PSBT round trip is empirically executed, not assumed. One LOW-confidence claim is isolated in the Assumptions Log.)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cohort lifecycle verbs (Cancel / Finalize-now / the honest "close")**

- **D-01:** The console exposes only honest primitives: **Cancel** (wraps `runner.stopCohort`) and **Finalize now** (wraps `runner.triggerFallback`, which the library itself documents as an operator "fall back now" UI action). "Close" is NOT a button: it is the automatic lock when the nth seat fills (min == max == n), narrated as a lifecycle stage. No synthetic close state, no directory-retract verb - a partially filled n-of-n cohort that stopped accepting joins could never proceed, so "close early" is just Cancel and the UI must not pretend otherwise.
- **D-02:** Participant-side cancel narration is **specific if carried**: aim for "the operator canceled this cohort" when the protocol/service can carry that attribution to the participant (research verifies the channel - the stopped-error completion rejection and what reaches participant runners); otherwise fall back to the honest Phase 3 D-25 line ("the cohort ended and this service didn't say why"). Never invent certainty; the canceled reason must not collide with the 04 D-45 stall predicate.
- **D-03:** Confirmation ceremonies use **laddered friction**: Cancel = explicit-consequence dialog naming the cohort and its seated-participant count ("N seated participants will lose their seats"); canceling a FUNDED live cohort is the top rung - type-to-confirm, with the recovery-key state line ("operator-held RECOVERY_KEY" vs "funds sent here are unrecoverable", reusing 04 D-40 disclosure); Finalize-now = simple confirm stating the k-of-n consequence. Action-verb buttons, danger tone, never color alone.
- **D-04:** Cancel is available from Advertised through the signing stages - any point **before the beacon tx broadcasts**. After broadcast the action is hidden with honest copy (the transaction is out; nothing to cancel). Draft "cancel" remains the existing Discard.
- **D-05:** Canceled cohorts get a **distinct 'canceled' fate** in the ended taxonomy (chip + monitoring record + activity-log entry), never folded into 'failed' - the operator meant to do it. The fate is captured at event time per the 04 D-23 pattern and joins the bounded ended retention.

**Advertising pause (service-level drain mode)**

- **D-06:** Pause is **drain mode**: it blocks NEW advertise and re-advertise actions only. Already-advertised cohorts keep filling, in-flight cohorts run to completion, seated participants are untouched, and resolve/anchor/monitoring/CAS routes stay up. Full quiesce = pause + individually canceling remaining open cohorts (D-01's ceremony each time - no bulk auto-retract).
- **D-07:** While paused, the public directory shows an **honest paused notice** ("this service isn't offering new cohorts right now" - exact copy is a UI call) replacing the generic empty-state line, in-flight rows keep showing, and `GET /v1/status` carries a **paused bit** so headless clients can tell a paused service from an idle one. Reversibility: costly - `/v1/status` is exact-pinned; the additive DTO change must migrate every pin in the same change (Phase 4 planning-note-1 pattern).
- **D-08:** The paused state is an **in-memory runtime flag** behind a gated operator route, toggled from the console near the health strip. Restart resets to unpaused - consistent with the in-memory posture (DUR-01 stays v2) and disclosed by the existing restart-clears-state line. No persistence, no boot-default env var this phase.
- **D-09:** While paused, **everything except advertise stays available**: drafts can be created/edited/discarded (prep while quiet), Cancel/Finalize-now/monitoring/export all work; Advertise and Re-advertise render disabled with an honest "advertising is paused" note.

**Reconfigure without restart (drafts, defaults, settings surface)**

- **D-10:** Two additions close criterion 3: **in-place draft editing** (an update path with the same validation as create; no more discard+recreate) and **create-form defaults** the operator sets on the new settings surface (beacon type, n, k).
- **D-11:** The cohort **timing windows become per-draft advanced fields** - discovery window and funding window as optional fields seeded from the env defaults, exposed where the library actually supports per-cohort values (research verifies which of TTL/phase-timeout are per-cohort vs per-runner in `aggregation@0.4.0`). The 04 D-38 clamp invariants (funding wait < remaining TTL, specific throw before either library timer) must keep holding for any per-draft values.
- **D-12:** The settings surface follows an **env-seeds, runtime-overrides** model: env vars seed boot values; the console edits the in-memory runtime value behind gated routes; restart returns to env (disclosed honestly). Every setting displays its source - "env default" vs "changed this session". No settings persistence (that door opens with DUR-01).
- **D-13:** **Next-cohort-only is a hard rule**: defaults, draft edits, and timing fields apply only to drafts and future cohorts. An advertised or in-flight cohort's shape is immutable (the advert is public, seats may be filling); the UI states "applies to new cohorts only" plainly. The considered cancel-and-redraft convenience helper was not chosen (deferred).

**Absorbed parked items (04 planning note 5 settled)**

- **D-14:** **Live/broadcast kill switch - broadcast only, disable only.** A console control stops the money-moving leg for NEW cohorts (they fall back to the fixture path); LIVE esplora reads stay up (resolve, anchor observation, health strip unaffected - 04 D-43 posture preserved); in-flight cohorts finish under the mode they started with. One-way per session: re-enabling requires the boot env. Danger-tone confirm + activity-log entry. Runtime ENABLE of live/broadcast from the console stays forbidden - the ADR 0010 layered env opt-in remains the only path to money movement. Reversibility: one-way within a session by design - the escape hatch is a restart returning to the boot env contract.
- **D-15:** **Ended-cohort dismissal** (was 04 D-14): a gated dismiss action removes an ended record (anchored/failed/expired/canceled) from the console's ended group ahead of the bounded-24 eviction. Simple confirm; log entry; no undo (the record is telemetry, not protocol state).
- **D-16:** **SERVICE_NAME edit** (was 04 D-51's parked surface): joins the settings surface under the D-12 model - runtime edit, restart returns to env, plain auto-escaped text, no new carrier semantics (same additive `/v1/config` field shipped in 04-03).
- **D-17:** **Operator test peers** (was 03 D-33): a drill-down action fills a cohort's remaining seats with in-process test participants, available in hermetic AND live mode - so an operator can rehearse the full live funding/co-sign path solo (the Phase 4 UAT needed two humans for exactly this). Test-peer members are clearly badged in the operator console and stamped in the activity log; framing is "rehearse your service", never demo filler (no auto-fill, no boot-time filler loop - HOST-03 posture). Live-mode test peers participate for real with in-process throwaway keys.
- **D-18:** **Active seat reclaim is re-parked** (was 02 D-15/D-16): a true per-seat release needs an upstream seat-release API that `aggregation@0.4.0` lacks (documented known limit). File it with the queued upstream issue batch. Meanwhile the drill-down honestly documents the operator workaround: a stuck filling cohort with an abandoned seat is resolved by Cancel + re-advertise, alongside the existing TTL reclaim.

**Folded builds (from the three Phase 4 scoping one-pagers)**

- **D-19:** **DID-signed ToS acceptance at join** is the built slice of the ToS/payments one-pager: the operator sets terms text via the settings surface (empty = no ToS step, feature fully absent); when set, the join flow requires the participant to accept, and the acceptance is recorded as a DID-signed artifact (both sides already hold did:btcr2 identities - the one-pager's lowest-new-trust synergy). Enforcement is app-level (the browse-and-pick UI join); a headless protocol client can still opt in without the UI - this limit is disclosed honestly, not papered over. Payments, notifications, and contracts are NOT built: they are captured as candidate requirements for the next milestone (the anonymous-utility vs accounts product-model decision and the owner's legal questions come first). Reversibility: costly - once real acceptances exist, the artifact format is a proof format participants may rely on; research should shape it deliberately.
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
- Exact copy strings, layout, spacing, tones (a UI-SPEC should be authored via `/gsd-ui-phase 5` before planning, mirroring Phase 4 - owner precedent). **Status: 05-UI-SPEC.md is APPROVED (6/6 dimensions PASS, 2026-07-28). Its copy strings and tone maps are binding.**

### Deferred Ideas (OUT OF SCOPE)

- **Payments, notifications, contracts** - captured as candidate requirements for the next milestone; the anonymous-utility vs accounts product-model decision and the owner's legal/compliance questions come first (D-19).
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
- Routed URLs; stranger-to-stranger CI e2e + booth-framing sweep (Phase 6); durable state (v2 DUR-01).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SVC-04** | Operator can run aggregation and manage a cohort's lifecycle (open -> close -> finalize) and pause, cancel, or reconfigure advertising without restarting the process | Verified control primitives (`stopCohort` / `triggerFallback`), their exact semantics and preconditions, the fate-tagging pattern cancel requires, the advert-slot hazard cancel triggers, the pause gate location (two call sites only), and the per-runner-vs-per-cohort truth about timing windows. See Standard Stack, Architecture Patterns 1 through 6, Pitfalls 1 through 6. |
| **(to mint) esplora override** | Participant may point chain reads at their own esplora endpoint, with a network-mismatch guard, CORS-specific failure copy, and broadcast as an opt-in within the opt-in (D-20) | Verified the exact esplora REST contract the existing proxy speaks (`GET /address/:a/utxo`, `POST /tx` text/plain), that `@did-btcr2/bitcoin` is NOT a `packages/web` dependency, and that `/v1/anchor/:cohortId` is a service read model an esplora endpoint cannot replace. See Architecture Pattern 7, Don't Hand-Roll, Pitfall 8. |
| **(to mint) PSBT registration leg** | The KEY first-update registration tx is exported as an unsigned PSBT, signed externally, returned, validated, and broadcast; paste-import carries an ephemeral-session warning (D-21) | Empirically executed the full round trip against the project's exact tx shape with the installed `@scure/btc-signer@1.8.1`: `toPSBT` / `fromPSBT` / `sign` / `finalize` / `extract`, txid parity with the local path, and a working predicate for each of the five UI-SPEC validation outcomes. See Architecture Pattern 8, Code Examples, Pitfall 9. |
| **(to mint) DID-signed ToS acceptance** | Operator sets terms text; when set, joining requires acceptance recorded as a DID-signed artifact; the headless-bypass limit is disclosed honestly (D-19) | Verified the app already holds a canonical-hash + sign + content-addressed-store toolchain (`updateHashBytes`, the participant's own signing keys, `MemoryArtifactStore` / `GET /cas/*`), and verified the protocol has NO message type that could carry acceptance. See Architecture Pattern 9, Pitfall 10. |

Requirement minting follows the Phase 4 LIVE-01 precedent: the planner adds each new ID to `.planning/REQUIREMENTS.md` (v1 list plus the Traceability table and the coverage count) and to the Phase 5 entry in `.planning/ROADMAP.md`, each with its own success criteria.
</phase_requirements>

---

## Summary

The single most important finding is that **`stopCohort` is silent**. It emits no runner event at all: it flips `ctx.settled`, disposes the cohort, calls `session.removeCohort`, and rejects the completion promise, with no `this.emit(...)` anywhere in its body (`service-runner.ts:573-580`). Every other terminal path (`#failCohort`) emits `'error'` and usually `'cohort-failed'` first. The consequence cascades through the whole phase: `monitor.ts` learns cohort fates exclusively from `runner.on(...)` handlers, so a canceled cohort would produce **no monitoring record at all**, while `operator-cohorts.ts`'s `settleCompletion` reject branch would silently file it as `state: 'expired'` with the reason string `Cohort {id} stopped.`. Both outcomes contradict D-05. The correct shape is therefore not "call `stopCohort` and observe" but **"declare the intent, then call `stopCohort`"**: a small per-service intent map written before the call, read by both the monitor (via a new `noteCanceled`, mirroring the existing `noteFunding` seam) and by `settleCompletion`, which then files a `canceled` record instead of an `expired` one. That same intent-tagging mechanism is what makes per-draft discovery windows possible (see below), so it is the load-bearing tracer for this phase.

The second finding is a genuine, operator-triggerable regression risk. `HttpServerTransport` holds exactly **one** advert slot (`#currentAdvert`, `http-server.ts:173`), a new SSE broadcast subscriber is replayed only that one advert (`http-server.ts:493-495`), and the stop closure returned by `publishRepeating` clears the slot when the stopping cohort owns it (`http-server.ts:307-309`). `stopCohort` runs that closure via `#disposeCohort`. So **canceling the most-recently-advertised cohort makes every other still-open cohort unjoinable to new participants**: they remain in the directory (which derives from `runner.session.cohorts`, not from the advert slot) but a freshly-connecting browser receives no `COHORT_ADVERT`, and `createParticipant`'s `shouldJoin` filter never fires, so the participant hangs at "connecting". This latent defect already exists on the normal completion path, but Phase 5 turns it into a button. It is fixable entirely app-side and without forking the library, because `createCohortAdvertMessage` and the transport's `publishRepeating` are both reachable: after any cohort settles, re-publish the newest still-open cohort's advert. That is Architecture Pattern 3 and it should be treated as part of the cancel tracer, not a follow-up.

The third cluster concerns reconfiguration. `cohortTtlMs`, `phaseTimeoutMs`, and `advertRepeatIntervalMs` are all **per-runner** constructor options (`service-runner.ts:32-109`), and `advertTtlMs` is a **per-transport** option; none of them is per-cohort. There is no library primitive for a per-cohort discovery window, so D-11's "expose where the library actually supports per-cohort values" resolves to: the funding window is app-owned and genuinely per-cohort today, while the discovery window must be enforced app-side by the same intent-tagged `stopCohort` timer, and can only ever **shorten** the runner's TTL, never lengthen it. On the folded builds, the picture is better than the scoping docs assumed. The PSBT round trip needs **zero new dependencies** and produces a txid identical to the current in-browser path (empirically confirmed). The esplora override also needs zero new dependencies: `packages/web/src/lib/tx-client.ts` is 74 lines of plain `fetch` against the same two esplora routes the server proxy calls, so parameterizing it is a smaller change than importing `@did-btcr2/bitcoin` into the browser bundle. The one correction worth flagging to the planner is that `@did-btcr2/aggregation@0.4.0` **does** ship an `AggregationSigner` interface (`core/signer.d.ts`), contradicting the external-signers one-pager's premise, but it is unusable for hardware wallets regardless: `withSecret(fn)` is synchronous and materializes the raw 32-byte scalar, and `AggregationParticipantRunner` hard-wires `new KeyPairAggregationSigner(options.keys)` anyway (`participant-runner.ts:144`). D-21's "co-sign stays upstream-blocked" conclusion stands; only its stated reason needs correcting.

**Primary recommendation:** Build 05-01 as a tracer that establishes the cohort-intent registry (cancel and expiry tags written before `stopCohort`), the monitor `noteCanceled` seam, the `settleCompletion` fate branch, and the advert-slot re-publish, then layer pause, settings, and the absorbed items on that spine; add zero runtime dependencies across the entire phase.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cancel a cohort (`stopCohort` + fate tagging) | API / Backend (`packages/service`) | Browser (confirm ceremony) | The runner lives in the coordinator process; only the service can drop protocol state. The browser only issues the gated request and renders the ceremony. |
| Finalize now (`triggerFallback`) | API / Backend | Browser (confirm) | Same: the fallback commits a state-machine transition and sends protocol messages. |
| Canceled fate projection | API / Backend (`monitor.ts` + `operator-cohorts.ts`) | Browser (chip render) | Fate must be captured at event time server-side (04 D-23); the browser polls a projection and must never derive fate itself. |
| Advert-slot re-publish after settle | API / Backend (`index.ts` transport seam) | none | Purely a transport-state repair; the browser has no visibility into `#currentAdvert`. |
| Advertising pause (drain mode) | API / Backend (`operator-cohorts.ts` gate) | Browser (toggle + disabled states) | Only two functions call `runner.advertiseCohort`; the gate belongs at exactly those two call sites, not in the UI. |
| Paused bit on `/v1/status` | API / Backend | Browser + headless clients | A public honesty signal; headless clients must be able to distinguish paused from idle without a browser. |
| Runtime settings (defaults, SERVICE_NAME, terms, windows) | API / Backend (in-memory config holder) | Browser (settings form) | Env seeds the holder at boot; the console edits the holder. Storing settings client-side would break the "one service, one truth" model and would not survive a second browser. |
| Broadcast kill switch | API / Backend (`createService` broadcast wiring) | Browser (danger confirm) | Money-movement mode is a process-level fact; a browser-held flag would be trivially bypassable. |
| Ended-record dismissal | API / Backend (bounded telemetry store) | Browser (confirm) | The record lives in the monitor's bounded map; dismissing client-side only would resurrect on the next poll. |
| Test peers | API / Backend (in-process `createParticipant`) | Browser (trigger + badge) | Peers must run in the coordinator process to co-sign; the browser cannot host them for another party's cohort. |
| Esplora endpoint override | Browser (`lib/tx-client.ts`) | none | This is explicitly a participant-side trust choice. Routing it through the service would defeat its entire purpose. |
| Network-mismatch guard for the override | Browser | API (`GET /v1/config` supplies the expected chain) | The comparison is browser-local; the service only publishes its own chain identity. |
| PSBT build / export / import / validate | Browser (`packages/shared` builder + web UI) | API (broadcast relay only) | The unsigned template and the validation must be computed where the participant can audit them; the service only relays bytes. |
| ToS terms text (authoring, storage) | API / Backend (settings holder) | Browser (render) | Operator-owned content served to every participant. |
| ToS acceptance signing | Browser (participant key) | API (artifact storage) | The participant's private key never leaves the browser; the service stores the resulting artifact. |
| ToS acceptance enforcement | Browser (join flow) | none (honest limit) | The protocol carries no acceptance field, so enforcement cannot be server-side. This is the disclosed limit in D-19, not a design slip. |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@did-btcr2/aggregation` | 0.4.0 (installed, caret) | `AggregationServiceRunner` control surface (`stopCohort`, `triggerFallback`), `HttpServerTransport`, `createCohortAdvertMessage` | Already the app's protocol dependency. Every Phase 5 lifecycle verb is a thin wrapper over it. `[VERIFIED: node_modules/.pnpm/@did-btcr2+aggregation@0.4.0.../src/service/service-runner.ts]` |
| `@did-btcr2/method` | 0.51.0 (installed, caret) | did:btcr2 update construction and canonical hashing behind `updateHashBytes` | Unchanged from Phase 4; the PSBT leg reshapes only how the resulting tx is signed. `[VERIFIED: node_modules/.pnpm/@did-btcr2+method@0.51.0]` |
| `@scure/btc-signer` | 1.8.1 (installed) | PSBT serialize/parse/sign/finalize/extract for the registration leg | Already a `packages/shared` dependency and already builds this exact transaction. Its `Transaction` class **is** a PSBT; no PSBT library is needed. `[VERIFIED: empirically executed round trip, this session]` |
| Hono | ^4 (installed) | Gated route mounts for all new operator actions | Established; every new mutating route mounts inside the existing `operatorAuth` block. `[VERIFIED: packages/service/src/hono-adapter.ts:353-500]` |
| Zustand | ^5.0.14 | Console and participant client state for the new controls | Established; `stores/operator.ts` and `stores/participant.ts` already hold the polled read models. `[VERIFIED: packages/web/package.json]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@did-btcr2/bitcoin` | 0.8.0 | `EsploraProtocol` path constants (reference only) | Read its `src/client/rest/protocol.ts` to confirm the two REST paths, then hand-write the two `fetch` calls in `tx-client.ts`. Do **not** add it to `packages/web`. See Don't Hand-Roll. |
| `@btcr2-aggregation/participant` | workspace | `createParticipant` for in-process test peers (D-17) | Already a `packages/web` and `packages/service` sibling; the e2e harnesses spawn peers exactly this way. |
| `vitest` | ^2 | Unit coverage for every new pure predicate | Established; 522 tests currently green in ~8s. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written `fetch` in `tx-client.ts` for the esplora override | `@did-btcr2/bitcoin`'s `BitcoinConnection` in the browser | The package is not currently a web dependency, ships an RPC client alongside the REST client, and would enlarge the bundle for two URL shapes the app already knows. The scoping doc's "already ships the browser esplora REST client" is technically true but the integration cost is higher than the 20-line alternative. |
| `@scure/btc-signer` PSBT | `bitcoinjs-lib` `Psbt` | Would add a second Bitcoin library with a different taproot model to a codebase that already builds this tx with scure. Rejected. |
| Re-publishing the advert via `transport.publishRepeating` | POSTing a signed envelope to the app's own `/v1/adverts` route | Both work (`signEnvelope` and `createCohortAdvertMessage` are exported from `@did-btcr2/aggregation/core`), but the direct transport call avoids a self-HTTP round trip and stays inside `createService`'s existing closure. |
| A per-cohort TTL library option | (does not exist) | `cohortTtlMs` is per-runner. App-side enforcement via a tagged `stopCohort` timer is the only path. |

**Installation:**

```bash
# No new packages. Phase 5 adds zero runtime and zero dev dependencies.
```

**Version verification:** performed against the installed pnpm store rather than the registry, because this project pins its `@did-btcr2/*` versions and the phase's correctness depends on the **installed** dist, not the latest published one:

```
@did-btcr2/aggregation  0.4.0    node_modules/.pnpm/@did-btcr2+aggregation@0.4.0_typescript@5.9.3
@did-btcr2/method       0.51.0   node_modules/.pnpm/@did-btcr2+method@0.51.0
@did-btcr2/bitcoin      0.8.0    node_modules/.pnpm/@did-btcr2+bitcoin@0.8.0
@did-btcr2/keypair      0.13.1   @did-btcr2/common 9.1.0   @did-btcr2/smt 0.3.0
@scure/btc-signer       1.8.1    node_modules/.pnpm/@scure+btc-signer@1.8.1
```

---

## Package Legitimacy Audit

**Not applicable: this phase installs no external packages.** Every capability is built from dependencies already present in `pnpm-lock.yaml` and already exercised by shipped code. The legitimacy gate is therefore vacuous, and the planner should add **no** `checkpoint:human-verify` install tasks.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | - | - | - | - | - | No package installed this phase |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

If a plan later proposes a new dependency (for example a PSBT or QR library), that plan must run the legitimacy gate before the install task is written. The research position is that no such dependency is needed.

---

## Architecture Patterns

### System Architecture Diagram

```text
                             OPERATOR BROWSER                          PARTICIPANT BROWSER
                     (session cookie, same-origin)                          (anonymous)
                                   |                                              |
        +--------------------------+                                              |
        |  console actions                                                        |  public reads
        |  POST /v1/operator/cohorts/:id/cancel                                   |  GET /v1/directory
        |  POST /v1/operator/cohorts/:id/finalize                                 |  GET /v1/status  (+ paused bit)
        |  POST /v1/operator/advertising/pause | /resume                          |  GET /v1/anchor/:id
        |  PATCH /v1/operator/cohorts/:id      (draft edit)                       |  GET /v1/funding/:id
        |  PUT  /v1/operator/settings                                             |  GET /v1/cohort-fate/:id  (NEW, D-02)
        |  POST /v1/operator/broadcast/disable                                    |  GET /v1/config  (terms text, D-19)
        |  POST /v1/operator/cohorts/:id/test-peers                               |  GET /cas/*      (acceptance artifact)
        |  DELETE /v1/operator/ended/:id       (dismiss)                          |
        v                                                                         v
  +-----------------------------------------------------------------------------------------+
  |  hono-adapter.ts                                                                        |
  |    requireSameOrigin -> requireOperator  ==>  every mutating route above                |
  |    public block (no session)             ==>  directory / status / anchor / funding / fate |
  +-----------------------------------------------------------------------------------------+
                                   |
                                   v
  +-----------------------------------------------------------------------------------------+
  |  createService (index.ts)  -- the composition root                                      |
  |                                                                                          |
  |   +----------------------------+     writes BEFORE calling stopCohort                   |
  |   |  COHORT INTENT REGISTRY    | <----------------------------+                          |
  |   |  Map<cohortId, 'canceled'  |                              |                          |
  |   |                | 'expired'>|                              |                          |
  |   +----------------------------+                              |                          |
  |         |                    |                                |                          |
  |    read by                read by                             |                          |
  |         v                    v                                |                          |
  |   monitor.noteCanceled   settleCompletion                 lifecycle actions               |
  |   (ended fate = canceled) (terminal fate branch)          cancel / expiry timer           |
  |                                                                |                          |
  |   +----------------------------+                               v                          |
  |   |  RUNTIME SETTINGS HOLDER   |                    runner.stopCohort(id)  --> SILENT     |
  |   |  paused, broadcastDisabled,|                    runner.triggerFallback(id) --> emits  |
  |   |  defaults, serviceName,    |                                 'fallback-started'       |
  |   |  termsText, windows        |                                |                          |
  |   |  (env-seeded, in-memory)   |                                v                          |
  |   +----------------------------+                    +-------------------------+           |
  |         |            |                              | AggregationServiceRunner|           |
  |    gates advertise   feeds /v1/status,              |   session (state machine)|          |
  |    (2 call sites)    /v1/config                     +-------------------------+           |
  |                                                                |                          |
  |                                              after ANY settle: |                          |
  |                                              re-publish newest still-open advert          |
  |                                                                v                          |
  |                                                    +-------------------------+            |
  |                                                    |  HttpServerTransport    |            |
  |                                                    |  #currentAdvert (ONE)   | --SSE-->   |
  |                                                    +-------------------------+  participants
  +-----------------------------------------------------------------------------------------+
                                   |
                       side effects (fire and forget)
                                   v
             funding watch -> broadcast -> anchor-state -> artifact store (/cas)
```

### Recommended Project Structure

```
packages/service/src/
├── cohort-intent.ts        # NEW: the intent registry + a tagged stopCohort wrapper
├── runtime-settings.ts     # NEW: env-seeded, in-memory settings holder (D-12)
├── advert-republish.ts     # NEW: reinstall the transport advert slot after a settle
├── test-peers.ts           # NEW: in-process createParticipant spawner (D-17)
├── operator-cohorts.ts     # EXTEND: draft edit, cancel, pause gate, canceled fate, paused bit
├── monitor.ts              # EXTEND: canceled chip + noteCanceled + dismiss + operator-action log
├── index.ts                # EXTEND: wire the above; kill-switch-aware broadcast selection
├── hono-adapter.ts         # EXTEND: gated mounts + the public fate read
└── demo-server.ts          # EXTEND: env passthrough for new seeds only

packages/shared/src/
├── registration.ts (or index.ts)  # EXTEND: split build into template + sign; add PSBT helpers
└── tos.ts                  # NEW: canonical acceptance-record shape + hash (D-19)

packages/web/src/
├── lib/tx-client.ts        # EXTEND: optional direct-esplora mode (D-20)
├── lib/esplora.ts          # NEW: endpoint probe + genesis-hash network guard
├── lib/psbt.ts             # NEW: pure validate-returned-PSBT predicate (D-21)
├── lib/operator.ts         # EXTEND: typed clients for the new gated routes
├── stores/operator.ts      # EXTEND: action state, settings, ceremonies
├── stores/participant.ts   # EXTEND: canceled narration, terms step, override, PSBT path
├── ui/primitives.tsx       # EXTEND: TextArea + ConfirmPanel (the two the UI-SPEC permits)
└── components/operator/    # NEW: ServiceControls, SettingsView, DraftEditForm, LifecycleActions
```

### Pattern 1: Declare intent, then stop (the phase's load-bearing pattern)

**What:** Never call `runner.stopCohort` directly. Write the reason into a per-service intent map first, then call it. Both downstream fate consumers read the map.

**When to use:** Every path that ends a cohort deliberately: the Cancel action (D-05) and the per-draft discovery-window timer (D-11).

**Why it is mandatory:** `stopCohort` emits nothing (verified below), so there is no event a listener could key on, and the completion rejection alone is indistinguishable from a stall for `settleCompletion`'s purposes.

```typescript
// packages/service/src/cohort-intent.ts (new)
// Source: shape mirrors the per-createService closure scoping used by
// `seatedRosterKeys` / `genesisStaging` in index.ts, and the bounded-24
// eviction used by every per-cohort map in monitor.ts / operator-cohorts.ts.

export type CohortIntent = 'canceled' | 'window-expired';

export interface CohortIntentRegistry {
  /** Record why this cohort is about to be stopped. Call BEFORE stopCohort. */
  declare(cohortId: string, intent: CohortIntent): void;
  /** Read a declared intent; undefined means the cohort died on its own. */
  read(cohortId: string): CohortIntent | undefined;
  /** Drop the tag once both consumers have folded it. */
  clear(cohortId: string): void;
}
```

The cancel action then reads:

```typescript
// packages/service/src/operator-cohorts.ts (extended)
cancelCohort(cohortId: string): boolean {
  if (!advertised.has(cohortId)) {
    return false;                       // 404: unknown or already settled
  }
  intents.declare(cohortId, 'canceled'); // FIRST, before any library call
  monitor?.noteCanceled(cohortId);       // fate captured at event time (04 D-23)
  runner.stopCohort(cohortId);           // silent; rejects the completion
  republishNewestOpenAdvert();           // repair the single advert slot (Pattern 3)
  return true;
}
```

and `settleCompletion`'s reject branch gains one branch:

```typescript
(err) => {
  const config = advertised.get(cohortId);
  advertised.delete(cohortId);
  if (!config) return;
  const intent = intents.read(cohortId);
  intents.clear(cohortId);
  if (intent === 'canceled') {
    rememberTerminal(cohortId, config, 'canceled by the operator', 'canceled');
  } else {
    rememberTerminal(cohortId, config, reasonString(err), 'expired');
  }
}
```

**Anti-pattern this replaces:** matching on the rejection message (`/stopped/.test(err.message)`). The message is `Cohort {id} stopped.` and the error carries `code: 'COHORT_STOPPED'`, but `stop()` (whole-runner shutdown) also rejects with a `RUNNER_STOPPED` error through the same channel, and a shutdown must not be narrated as an operator cancel.

### Pattern 2: Finalize-now availability is a phase predicate, not a try/catch

**What:** Render `Finalize now` as available only when the cohort's phase is one of the three signing phases, because `triggerFallback` throws otherwise.

**Verified precondition chain:** `triggerFallback` returns silently (a no-op) when the cohort is unknown, settled, or already committed to a path; otherwise it calls `session.startFallbackSigning(cohortId)` **first**, which throws `COHORT_NOT_FOUND` or a no-signing-session error. Only after that transition commits does it set `ctx.committedPath = 'fallback'`, stop the advert loop, emit `'fallback-started'`, and send. `[VERIFIED: service-runner.ts:491-506, service.ts:838-846]`

The library's own stall timer uses exactly this predicate:

```typescript
// Source: @did-btcr2/aggregation@0.4.0 src/service/service-runner.ts:257-261
static readonly #SIGNING_PHASES: readonly ServiceCohortPhaseType[] = [
  ServiceCohortPhase.SigningStarted,
  ServiceCohortPhase.NoncesCollected,
  ServiceCohortPhase.AwaitingPartialSigs,
];
```

Mirror that set into `packages/shared/src/phases.ts` (which is already the single cross-package source of truth for `OPEN_PHASES` / `IN_FLIGHT_PHASES` / `DISPLAY_PHASES`) as `FINALIZABLE_PHASES`, and derive the button's availability and its disabled-reason copy from it. Note that `IN_FLIGHT_PHASES` is **wider** than the signing phases (it includes the four funding-wait phases added in 04-08), so reusing `IN_FLIGHT_PHASES` for this would offer `Finalize now` on a cohort where it throws.

Because `triggerFallback` is idempotent and returns `Promise<void>`, the route should treat a successful resolve as success and map a thrown `AggregationServiceError` to a 409 with the UI-SPEC's action-error copy, never a 500.

### Pattern 3: Repair the advert slot after every settle

**What:** After any cohort leaves the live set (cancel, completion, or failure), re-publish the newest still-open cohort's advert so the transport's single slot is never left empty while joinable cohorts exist.

**Why:** verified transport behavior, three facts that compose into the defect:

```typescript
// Source: @did-btcr2/aggregation@0.4.0 src/service/http-server.ts:302-309
this.#currentAdvert = { dataJson, id, expiresAtMs };      // ONE slot, overwritten
for (const sub of this.#broadcastSubscribers) { ... }
return (): void => {
  if (this.#currentAdvert?.id === id) this.#currentAdvert = undefined;   // the stop closure
};

// Source: same file, :493-495  (a NEW SSE subscriber is replayed only the one slot)
if (this.#currentAdvert && this.#currentAdvert.expiresAtMs > this.#now()) {
  this.#safeWrite(stream, SSE_EVENT.ADVERT, this.#currentAdvert.dataJson, this.#currentAdvert.id);
}
```

and `stopCohort` -> `#disposeCohort` -> `#stopAdvertRepeating` runs that closure (`service-runner.ts:373-380, 573-580`).

**The recipe** (fully reconstructible app-side; `session.advertise` cannot be re-called because it throws `INVALID_PHASE` once the cohort leaves `Created`, `service.ts:276-281`):

```typescript
// Source: reconstructs exactly what AggregationService.advertise builds
//         (@did-btcr2/aggregation@0.4.0 src/service/service.ts:283-291)
import { createCohortAdvertMessage } from '@did-btcr2/aggregation/core';

function republishAdvert(cohortId: string, config: CohortConfig): void {
  const { network, ...conditions } = config;
  const message = createCohortAdvertMessage({
    from: did,
    cohortId,
    network,
    communicationPk: keys.publicKey.compressed,
    ...conditions,
  });
  // publishRepeating signs the envelope itself, installs #currentAdvert with a
  // fresh expiresAtMs, and writes to every current broadcast subscriber. The
  // intervalMs argument is IGNORED by HttpServerTransport (documented upstream
  // limit), so 0 is the honest value here.
  transport.publishRepeating(message, did, 0);
}
```

Pick the cohort to re-publish as the most recently advertised entry in `advertised` whose phase is in `OPEN_PHASES`. If none is open, leave the slot empty. Guard the whole call in try/catch and log: an advert repair failure must never disturb the protocol, matching the fire-and-forget posture of every other side effect in `index.ts`.

### Pattern 4: Pause is a gate at exactly two call sites

**What:** The paused flag is checked in `advertiseDraft` and `readvertiseExpired` and nowhere else.

**Why this is sufficient and safe:** `operator-cohorts.ts`'s own module docstring states, and the code confirms, that these two functions are the **only** callers of `runner.advertiseCohort` in the entire app since the boot-time auto-advertise loop was deleted in Phase 1. `[VERIFIED: packages/service/src/operator-cohorts.ts:9-14, 426-453, 463-486; no other call site found repo-wide]`

```typescript
advertiseDraft(draftId: string): OperatorCohortDTO | undefined | { paused: true } {
  if (settings.paused) {
    return { paused: true };            // route maps to 409 + the UI-SPEC reason copy
  }
  ...
}
```

D-09 falls out for free: drafts, cancel, finalize, monitoring, export, settings, and every public read are untouched by the flag because none of them routes through these two functions. The `/v1/status` paused bit reads the same holder, so the public claim and the gate can never drift (the same single-derivation discipline `openCount()` already uses).

### Pattern 5: Env-seeded, in-memory runtime settings

**What:** One holder constructed at boot from the env values `demo-server.ts` already resolves, mutated by gated routes, read by everything else. Each field tracks its boot value so the UI can render `env default` versus `changed this session (environment default: {value})`.

```typescript
// packages/service/src/runtime-settings.ts (new)
export interface SettingField<T> { value: T; envDefault: T; changed: boolean }

export interface RuntimeSettings {
  paused: boolean;                       // D-08, not env-seeded this phase
  broadcastDisabled: boolean;            // D-14, one-way true
  serviceName: SettingField<string | undefined>;
  defaultBeaconType: SettingField<BeaconType>;
  defaultSize: SettingField<number>;
  defaultThreshold: SettingField<number>;
  defaultDiscoveryWindowMs: SettingField<number | undefined>;
  defaultFundingWindowMs: SettingField<number | undefined>;
  termsText: SettingField<string | undefined>;
}
```

Two rules the planner must enforce. First, D-13: nothing in this holder is ever read by a cohort that is already advertised. Read it **once**, at `createDraft` time, into the draft's own `CohortConfig`; never re-read it at advertise time or during a cohort's life. Second, settings save as a set (UI-SPEC E8 `partial`): validate every field first, apply none on any failure, so the surface can never show a half-saved state.

`serviceName` needs one extra hop: it is currently a boot-time constant captured by `createHonoApp`'s closure and interpolated into the `/v1/config` response (`hono-adapter.ts:253`). Change that route to read the holder per request rather than the captured constant, keeping the additive-only shape (the field appears only when set) so the frozen `config.spec` network pin stays byte-identical.

### Pattern 6: The kill switch selects a mode for NEW cohorts only

**What:** `broadcastDisabled` is consulted where a cohort's beacon-tx path is chosen, not where the service's mode was resolved at boot.

**Critical constraint from the verified wiring:** `createService` resolves `const mode: ServiceMode = broadcaster ? 'live' : live ? 'live-no-broadcast' : 'hermetic'` **once** and passes it into `createCohortMonitor(runner, broadcaster, anchorState, mode)` (`index.ts:762-763`), and the monitor's docstring states the mode is "derived ONCE at construction, never re-derived per read". So the kill switch must **not** try to mutate `mode`. Instead:

- The health strip keeps reporting the served boot mode (`Live`), and the UI-SPEC adds a separate `Broadcast off (this session)` warn chip beside it. This is exactly what the UI-SPEC specifies, and it is the honest rendering: the service really did boot live, and its esplora reads really are still live.
- The per-cohort broadcast decision (the `signing-complete` handler that hands off to `broadcastAndConfirm`) checks `settings.broadcastDisabled` **and** whether this cohort was advertised before or after the switch engaged. Record the switch's engage timestamp and compare against the cohort's `advertisedAt` entry, which `index.ts` already maintains (`index.ts:572, 769-770`). That is what makes "in-flight cohorts finish under the mode they started with" true rather than aspirational.
- ADR 0010 is preserved because the flag can only ever move from `false` to `true`. Expose no route that sets it back; a restart is the only way back, and the UI-SPEC copy says so explicitly.

The UI-SPEC carries one unresolved item here (E9, mixed modes visible simultaneously). The research position is that the per-cohort drill-down already renders its own anchor/mode disclosure, so the apparent contradiction is explained in context; the planner should carry it as a stated assumption and not build a dedicated badge.

### Pattern 7: The esplora override is a mode on the existing client, not a new client

**What:** Give `tx-client.ts` an optional endpoint and switch URL shapes. Nothing else changes.

**Verified REST contract** (the two routes the server proxy itself calls, so the direct path is provably equivalent):

```
GET  {esplora}/address/{address}/utxo   -> AddressUtxo[]   (same JSON the proxy returns verbatim)
POST {esplora}/tx    body = raw hex, Content-Type: text/plain   -> txid as plain text
```

`[VERIFIED: @did-btcr2/bitcoin@0.8.0 src/client/rest/protocol.ts:138-141, 89-91; consumed by packages/service/src/hono-adapter.ts:601, 632]`

Note the response-shape asymmetry the planner must handle: the proxy's broadcast returns `{ txid }` JSON while esplora returns the txid as bare text. The direct path must read `await res.text()` and trim.

**Network-mismatch guard (D-20):** compare the genesis block hash. `GET {esplora}/block-height/0` returns the hash of block 0, which uniquely identifies the chain, and the path exists on the same protocol surface (`protocol.ts:105-107`). Compare it against the chain implied by `GET /v1/config`. Do this **before** any UTXO read, cache the verdict per endpoint, and refuse with the UI-SPEC's `That endpoint is on {theirNetwork}, but this service is on {ourNetwork}. It was not used.` If `packages/shared/src/networks.ts` does not already carry genesis hashes, adding them there is the right home (it is the declared single source of truth for chain parameters).

**CORS detection:** a browser CORS rejection surfaces as a `TypeError` from `fetch` with an opaque message, indistinguishable from a DNS failure at the JS level. Distinguish them with an ordering trick rather than message parsing: run the genesis-hash probe first with `mode: 'cors'`; if it throws a `TypeError` and the URL parses and resolves, present the CORS copy with the "use this service's chain reads" escape, matching the UI-SPEC's requirement that the app never silently reverts. Treat this as best-effort classification and keep the unreachable string as the fallback.

**What the override cannot do:** `GET /v1/anchor/:cohortId` is a service **read model** keyed by cohort id (`packages/web/src/lib/anchor.ts`, `packages/service/src/anchor-state.ts`); an esplora endpoint has no notion of a cohort. D-20's "anchor polling" therefore resolves to: keep polling `/v1/anchor` for the txid, and once a txid exists, optionally confirm it independently via `GET {esplora}/tx/{txid}` (`protocol.ts:71-74`). The copy must not imply the participant's endpoint replaced the service's anchor read.

### Pattern 8: The PSBT leg splits the existing builder in two

**What:** Refactor `buildSingletonRegistrationTx` into a template builder and a signer. The signed path composes them (byte-identical behavior for existing callers); the wallet path exports the template and re-imports a signed PSBT.

**Verified empirically this session** against the project's exact transaction shape (1 P2TR key-spend input with `tapInternalKey`, change output first, `OP_RETURN <32-byte hash>` last, `allowUnknownOutputs: true`):

| Probe | Result |
|-------|--------|
| `template.toPSBT(0)` | valid PSBT, base64 prefix `cHNidP8`, 308 chars for this shape |
| `Transaction.fromPSBT(bytes)` **without** `allowUnknownOutputs` | parses fine (the flag guards `addOutput`, not PSBT parsing) |
| wallet: `fromPSBT` -> `sign(secret)` -> `toPSBT(0)`; app: `fromPSBT` -> `finalize()` -> `extract()` | succeeds |
| resulting txid vs the fully-local `buildSingletonRegistrationTx` path | **identical** |
| resulting raw hex vs the local path | **differs** (schnorr aux randomness changes the witness; txid excludes the witness) |
| `finalize()` on an unsigned PSBT | throws `finalize/taproot: unknown input` |
| garbage bytes into `fromPSBT` | throws `Reader(magic): bytes: cannot find terminator` |
| a raw signed tx (not a PSBT) into `fromPSBT` | throws `Reader(magic): magic: invalid value` |

The load-bearing consequence: **do not validate the returned PSBT by comparing raw hex.** Compare `tx.unsignedTx` (the witness-free template bytes) against the template the page built. `get unsignedTx(): Bytes` works on an unfinalized transaction; `get id()` does **not** (it throws `Transaction is not finalized`).

**Validation predicate mapping to the five UI-SPEC outcomes:**

| UI-SPEC string | Predicate |
|----------------|-----------|
| `That doesn't look like a PSBT. Expected base64 text or a .psbt file.` | `Transaction.fromPSBT` throws |
| `That PSBT doesn't match the transaction this page created. Download it again and sign that one.` | `bytesToHex(tx.unsignedTx) !== expectedTemplateHex` |
| `That PSBT isn't signed yet.` | template matches **and** `!tx.getInput(0).tapKeySig` |
| `That transaction's fee is {fee} sats, well above the expected {expected} sats.` | `tx.fee > REGISTRATION_FEE_SATS` (only reachable if the template check is relaxed; see below) |
| `This signed transaction checks out: it pays {amount} sats to your registration address with a {fee} sat fee.` | template matches, `tapKeySig` present, `finalize()` succeeds |

Order matters: check parse, then template match, then signature presence, then finalize. Note that a strict `unsignedTx` comparison already subsumes the fee check, because any fee change alters the change output and therefore the template. Keep the fee string anyway as a defence-in-depth branch if the planner chooses a looser structural comparison (per-field: input outpoint, output count, output scripts, `OP_RETURN` payload) instead of exact bytes. The research recommendation is the strict byte comparison for the primary check plus a rendered fee derived from `tx.fee` for the success copy, since `get fee(): bigint` is available and returned `1000n` correctly in the probe.

`tx.getOutputAddress(0, network)` returned the expected `tb1p...` address, so the success copy's "to your registration address" claim can be rendered from the PSBT itself rather than from remembered state.

### Pattern 9: The ToS acceptance artifact reuses the existing hash-and-store toolchain

**What:** A canonical acceptance record, hashed the way the app already hashes updates, signed with the participant's existing key, stored in the existing content-addressed store, referenced by hash in the UI.

The app already has every piece: a canonical hashing helper (`updateHashBytes` in `packages/shared`), the participant's `SchnorrKeyPair` in the browser, `MemoryArtifactStore` / `FileSystemArtifactStore` with hex-keyed writes and a public `GET /cas/*` read (`packages/service/src/store.ts`), and the `CopyField` primitive for surfacing a hash. The recommended record shape:

```typescript
// packages/shared/src/tos.ts (new)
export interface TermsAcceptance {
  '@context': string;          // reuse the sidecar context constant
  type: 'ParticipationTermsAcceptance';
  serviceDid: string;
  cohortId: string;
  /** sha256 of the exact terms text the participant was shown, hex. */
  termsHash: string;
  participantDid: string;
  acceptedAt: string;          // ISO 8601
}
```

The participant signs the canonical bytes of that object with their DID's key and POSTs `{ acceptance, signature }` to a public route; the service verifies the signature against the DID's key using the same `resolveBtcr2SenderPk` machinery the transport already uses for envelope auth, verifies `termsHash` matches its current terms, stores the artifact, and returns its hash.

Three constraints. **Bind the terms hash, not just the text**, so a later terms edit cannot retroactively change what a stored acceptance means. **Verify server-side**, because an unverified stored blob is not a proof of anything. And **treat the artifact format as costly to change** (the CONTEXT itself flags this): freeze the field set in a spec test the way the public DTOs are frozen.

D-19's honest limit stands and must be stated in copy and in `docs/`: the protocol has **no** message type that could carry acceptance (the complete list is `COHORT_ADVERT`, `COHORT_OPT_IN`, `COHORT_OPT_IN_ACCEPT`, `COHORT_READY`, `SUBMIT_UPDATE`, `SUBMIT_NONINCLUDED`, `DISTRIBUTE_AGGREGATED_DATA`, `VALIDATION_ACK`, `AUTHORIZATION_REQUEST`, `NONCE_CONTRIBUTION`, `AGGREGATED_NONCE`, `SIGNATURE_AUTHORIZATION`, `FALLBACK_AUTHORIZATION_REQUEST`, `FALLBACK_SIGNATURE`; `[VERIFIED: @did-btcr2/aggregation@0.4.0 src/core/messages/constants.ts]`), so a headless client that speaks the protocol joins without the step.

### Pattern 10: Test peers are in-process `createParticipant` spawns

**What:** Spawn N `createParticipant` instances against the service's own base URL, tagged so the monitor can badge them.

The Phase 1 filler loop is genuinely gone: `demo-server.ts` retains a `fillers?: number` field documented as kept "only so existing callers that pass `fillers: 0` still compile", with no machinery behind it. `[VERIFIED: packages/service/src/demo-server.ts:73-76]` The reusable pattern is the e2e harnesses, which construct peers directly. Two details:

- **Badging** needs the peer's DID to reach the monitor. The cleanest seam is a per-service set of test-peer DIDs written at spawn time and read by the monitor's member projection, mirroring how `seatedRosterKeys` is scoped per `createService` call. Do not try to infer test-peer status from the protocol; nothing in the advert or opt-in distinguishes them, which is correct (they are real participants).
- **Teardown** must be bounded. Each peer holds an SSE subscription. Tear them down on cohort settle and on `service.stop()`, and reuse the existing `stopController.signal` that `index.ts` already threads into the funding wait (`index.ts:608`) so `service.stop()` cleans them up on the established path.

D-17's "live-mode test peers participate for real" is accurate and carries real consequences: on a live service the peers' DIDs are genuinely anchored, and each will need its own registration funding to complete a first update. The confirm copy already says this; the planner should make sure the peer's post-cohort registration is either performed or honestly skipped rather than silently failing.

### Anti-Patterns to Avoid

- **Matching on error message text to classify a terminal cause.** `terminalReason` in the participant store already does this for display, and Phase 5 must not extend the technique to server-side fate classification. Use the intent registry (Pattern 1) and, on the client, a dedicated boolean input (Pitfall 5).
- **Re-deriving `ServiceMode` when the kill switch engages.** The monitor caches it at construction; mutating it would make the health strip lie about how the service booted.
- **Reusing `IN_FLIGHT_PHASES` for the Finalize-now predicate.** It is wider than the library's signing set and would offer a button that throws.
- **Extending the frozen public DTOs.** `DirectoryCohortDTO` is byte-frozen with an explicit key-set pin (`monitor.spec.ts:629-631`). The paused bit belongs on `ServiceStatusDTO` only, and the canceled fate is operator-only plus the narrow new public fate read.
- **Adding a browser dependency for two URL shapes.** See Don't Hand-Roll.
- **Rendering operator-supplied text as markup.** Terms text and service name are operator-controlled strings shown to anonymous participants. Both must be plain auto-escaped React text content (the UI-SPEC says so; ASVS V5 agrees).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PSBT serialization and parsing | A BIP-174 encoder/decoder | `@scure/btc-signer` `Transaction.toPSBT()` / `Transaction.fromPSBT()` | Already installed, already builds this exact transaction, and the round trip is empirically confirmed to reproduce the identical txid. |
| Taproot key-spend signing and finalization | BIP-341 sighash + tweak code | `tx.sign(secret)` / `tx.finalize()` / `tx.extract()` | The existing `buildSingletonRegistrationTx` already relies on scure applying the BIP-341 tweak internally; the PSBT path must not diverge. |
| Fee computation for the returned PSBT | Manual input-sum minus output-sum | `tx.fee` (verified to return `1000n` for the project's shape) | Handles the `witnessUtxo` amount lookup correctly. |
| Cohort advert message construction for the re-publish | A hand-rolled `BaseMessage` literal | `createCohortAdvertMessage` from `@did-btcr2/aggregation/core` | The message body must match what `session.advertise` produces, or participants will reject or misparse it. The factory is exported at runtime (confirmed by import). |
| Envelope signing for a re-published advert | `signEnvelope` by hand | `transport.publishRepeating(msg, did, 0)` | The transport signs the envelope itself and installs the slot atomically; calling `signEnvelope` yourself duplicates logic and skips the slot install. |
| An esplora client in the browser | Importing `@did-btcr2/bitcoin` into `packages/web` | ~20 lines of `fetch` in the existing `lib/tx-client.ts` | The override needs exactly two URL shapes plus a genesis probe. The package is not currently a web dependency, ships an RPC client too, and would enlarge a bundle that already needs `vite-plugin-node-polyfills`. |
| A settings persistence layer | JSON on disk, SQLite, anything durable | The in-memory holder plus honest restart copy | D-08 and D-12 lock this; durability is DUR-01 (v2). Adding persistence here quietly changes the product's stated state model. |
| Per-cohort TTL enforcement inside the runner | Forking or monkey-patching the library | An app-side timer that declares `'window-expired'` then calls `stopCohort` | The standing constraint is "reference consumer, not a fork". Pattern 1 gives this for free once cancel is built. |
| Canonical JSON hashing for the acceptance record | A bespoke serializer | The same canonicalization `updateHashBytes` uses | Two canonicalizations in one codebase is how proof formats silently diverge. |

**Key insight:** every capability in this phase is a composition of primitives the repository already owns. The failure mode for Phase 5 is not "missing library" but "wrong seam": calling a library primitive without first recording why, mutating cached derived state, or extending a frozen DTO. The research position is therefore aggressively subtractive - zero new dependencies, and the effort spent instead on the intent registry and the advert repair.

---

## Runtime State Inventory

Phase 5 is not a rename or migration, but it does change runtime state semantics, so the inventory is answered explicitly rather than omitted.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** No database, no ORM, no driver anywhere in the workspace (confirmed against `.claude/CLAUDE.md` "no database" and the dependency lists). The only durable write path is `FileSystemArtifactStore`, which is content-addressed by hash, so a new artifact type (the ToS acceptance) is purely additive and collides with nothing. | Code only. No data migration. |
| Live service config | **None external.** The service holds no configuration in any third-party UI or database; everything is env plus in-memory. The new settings holder is itself in-memory and resets on restart by design (D-08/D-12). | None. |
| OS-registered state | **None.** No Task Scheduler, pm2, launchd, or systemd registration in the repo. Deployment is Docker plus compose (`Dockerfile`, `docker-compose.yml`). | None. |
| Secrets and env vars | Existing reads that Phase 5 touches: `SERVICE_NAME`, `BROADCAST`, `LIVE`, `RECOVERY_KEY`, `COHORT_TTL_MS`, `PHASE_TIMEOUT_MS`, `FUNDING_WINDOW_MS`, `AUTO_FALLBACK`, `OPERATOR_PASSWORD`. **None is renamed.** New seeds (defaults for beacon type, n, k, terms text) are additive and must follow the established `numericKnob` NaN-guard pattern (`demo-server.ts:253`, the WR-04 lesson) rather than a bare `Number()`. | Add new vars only; document in `docs/DEPLOY.md` and `docker-compose.yml`. |
| Build artifacts / installed packages | `packages/*/dist` exists and is stale relative to source (for example `packages/service/dist/operator-cohorts.d.ts` still carries the pre-Phase-5 DTO). The `tsc -b` composite build regenerates it; `pnpm test` runs `tsc -b` first, so this self-heals. | None beyond the normal build. |

**The canonical question:** after every file is updated, what runtime systems still hold old state? Answer: **only the transport's `#currentAdvert` slot**, and only transiently. That is not stale data from a rename; it is live protocol state that cancel actively invalidates, and Pattern 3 repairs it. Everything else in this service is either env-seeded at boot or derived per read.

---

## Common Pitfalls

### Pitfall 1: `stopCohort` emits nothing, so the monitor never sees a cancel

**What goes wrong:** The canceled cohort produces no chip, no ended record, no activity entry. It simply disappears from the console.

**Why it happens:** `monitor.ts` is built entirely from `runner.on(...)` handlers (`opt-in-received`, `participant-accepted`, `keygen-complete`, `update-received`, `validation-received`, `message-rejected`, `signing-started`, `nonce-received`, `fallback-started`, `signing-complete`, `cohort-failed`, plus broadcaster frames). `stopCohort` fires none of them:

```typescript
// Source: @did-btcr2/aggregation@0.4.0 src/service/service-runner.ts:573-580
stopCohort(cohortId: string): void {
  const ctx = this.#contexts.get(cohortId);
  if(!ctx || ctx.settled) return;
  ctx.settled = true;
  this.#disposeCohort(ctx);
  this.session.removeCohort(cohortId);
  ctx.reject(new AggregationServiceError(`Cohort ${cohortId} stopped.`, 'COHORT_STOPPED', { cohortId }));
}
// contrast #failCohort (:555-563) which calls this.emit('error', err)
```

**How to avoid:** add `noteCanceled(cohortId)` to the `CohortMonitor` interface and call it from the cancel action **before** `stopCohort`, exactly mirroring the existing `noteFunding` / `noteEsploraObservation` push seams that already exist for facts the runner does not emit.

**Warning signs:** a cancel e2e that asserts only "the cohort left the directory" will pass while the console shows nothing. Assert on the ended record and the chip.

### Pitfall 2: A cancel silently files as `expired`

**What goes wrong:** The operator cancels and the console shows an `Expired` row with the reason `Cohort abc-123 stopped.` - a machine string, and the wrong fate per D-05.

**Why it happens:** `settleCompletion`'s reject branch is fate-blind; it calls `rememberTerminal(cohortId, config, reasonString(err))` for every rejection (`operator-cohorts.ts:325-342`).

**How to avoid:** Pattern 1's intent branch. Also widen `OperatorCohortDTO.state` from `'draft' | 'advertised' | 'expired'` to include `'canceled'`, and update the two other places that construct expired rows (`listCohorts`'s `expiredDtos` map) plus the web row mapper.

**Warning signs:** grep for `state: 'expired'` and for `'expired'` in `packages/web/src/lib/operator-rows.ts`; every site must be visited in one change.

### Pitfall 3: Canceling one cohort un-advertises the others

**What goes wrong:** With cohorts A and B both open and A advertised most recently, canceling A leaves B listed in the directory but unjoinable. A participant picks B, the browser opens the SSE stream, receives no `COHORT_ADVERT`, and `shouldJoin` never fires. The UI sits at "connecting" with no error, because nothing failed.

**Why it happens:** the three verified transport facts in Pattern 3 (one slot, replay-only-current, stop-clears-slot) plus `createParticipant`'s advert-driven join (`packages/participant/src/index.ts:303-311`).

**How to avoid:** Pattern 3's re-publish, wired to every settle path (cancel, `signing-complete`, `cohort-failed`), not just cancel.

**Warning signs:** the hermetic e2e must cover the two-cohort case specifically. A single-cohort cancel test will never surface this. Suggested assertion: advertise A then B, cancel B, then join A with a **freshly constructed** participant (a pre-existing one already holds the advert and will pass regardless).

### Pitfall 4: `triggerFallback` throws before signing, and the throw is not a 500

**What goes wrong:** `Finalize now` offered on a filling cohort returns a 500 with a raw library message.

**Why it happens:** `session.startFallbackSigning` runs first and throws `COHORT_NOT_FOUND` or a no-signing-session error; `triggerFallback` deliberately does not catch it, so the latch is not poisoned by a bad-phase call (`service-runner.ts:494-500`).

**How to avoid:** gate the button on `FINALIZABLE_PHASES` client-side **and** guard the route server-side, returning 409 with the UI-SPEC action-error copy. Never let a library message reach the browser as a 400/500 body (the established discipline in `validateDraft`, which pre-guards so "a raw library throw can never be the 400 body").

**Warning signs:** the idempotent no-op path (unknown, settled, or already committed) returns `undefined` **without** throwing, so a double-click yields a 200 with nothing having happened. Decide deliberately whether that reads as success (recommended: yes, it is idempotent by design) and make the copy match.

### Pitfall 5: The canceled narration re-triggers the stall copy

**What goes wrong:** A participant whose cohort is canceled mid-signing sees `This service stalled while collecting updates.` - the exact misattribution 04 D-45 was created to fix.

**Why it happens:** `terminalReason` (`packages/web/src/stores/participant.ts:894-937`) is a regex-over-the-error-string classifier. Its first branch fires on `submittedButUnsigned && !validationRequested && unexplained`. A cancel after submit but before `validation-requested`, with an unexplained reason, satisfies all three.

**How to avoid:** add a `canceled: boolean` field to `terminalReason`'s input and check it **first**, above the stall branch, returning the UI-SPEC's `The operator canceled this cohort.` Do not add a `/cancel/` regex to the existing chain; the whole point of D-45 was to stop keying narration on message text.

**Warning signs:** the fix is unit-testable as a pure function (it is already exported for exactly that reason). Require a test that feeds `{ canceled: true, steps: { submit: 'done', sign: 'pending' }, validationRequested: false }` and asserts the cancel copy, since that is the precise input that currently produces stall copy.

### Pitfall 6: The paused bit breaks a frozen pin

**What goes wrong:** `tsc` passes, tests fail on two exact-shape assertions.

**Why it happens:** `ServiceStatusDTO` is pinned by key set and by full equality:

```typescript
// packages/service/tests/monitor.spec.ts:634
expect(Object.keys(status).sort()).toEqual(['network', 'openCohorts', 'up'].sort());
// packages/service/src/operator-cohorts.spec.ts:568
expect(await status.json()).toEqual({ up: true, network: ACTIVE_NETWORK, openCohorts: 0 });
```

**How to avoid:** migrate **every** site in the same change. The complete list, verified by repo-wide grep for `openCohorts`:

| File | Line | What |
|------|------|------|
| `packages/service/src/operator-cohorts.ts` | 166-170, 524 | the interface and its single construction site |
| `packages/service/src/hono-adapter.ts` | 267 | the no-operator-surface fallback literal |
| `packages/service/tests/monitor.spec.ts` | 634 | key-set pin |
| `packages/service/src/operator-cohorts.spec.ts` | 568 | full-equality pin |
| `packages/web/src/lib/operator.ts` | 100-108 | `ServiceStatus` client type |
| `e2e/operator-cohort.ts` | 81-86 | harness type |

The four `openCohorts` value assertions elsewhere in the specs are value-only and unaffected. `DirectoryCohortDTO` stays byte-frozen (its own key-set pin is at `monitor.spec.ts:629-631`).

### Pitfall 7: Per-draft timing windows that the library cannot honor

**What goes wrong:** an operator sets a 60-minute discovery window on a draft, the service boots with `COHORT_TTL_MS` at 30 minutes, and the cohort dies at 30.

**Why it happens:** `cohortTtlMs` and `phaseTimeoutMs` are per-runner constructor options armed once per cohort at advertise and never reset (`service-runner.ts:78-88`, `#startTimers` at `:426-437`). `advertRepeatIntervalMs` is likewise per-runner, and `advertTtlMs` is per-transport. **No timing value in `aggregation@0.4.0` is per-cohort.**

**How to avoid:** app-side enforcement only, and only downward. A per-draft discovery window arms an app timer that declares `'window-expired'` then calls `stopCohort`. Validate `perDraftWindow <= runnerCohortTtlMs` at draft-save time and reject with an honest message rather than accepting a value the service cannot keep. The funding window is different: it is app-owned (`funding-watch.ts` plus the `remainingCohortTtlMs` clamp in `index.ts:600-608`), so a genuine per-cohort value works there, provided the 04 D-38 clamp still computes `min(window, remainingTtl - slack)` and still throws its specific reason before either library timer.

### Pitfall 8: The esplora override weakens a guard rail by accident

**What goes wrong:** a participant sets an endpoint and the mainnet real-funds acknowledgment stops firing, or a mis-set endpoint silently swallows a real broadcast.

**Why it happens:** the mainnet gate lives at the top of `register()` in the participant store (`participant.ts:1885-1897`) and is keyed on `resolveNetwork(get().network)`, which comes from `GET /v1/config`. If the override path is added as a **separate** code path rather than a parameter to the existing one, the gate is easy to bypass.

**How to avoid:** keep exactly one `register()` and one broadcast call site; the endpoint is a parameter, never a branch that duplicates the flow. The ADR 0010 guard, the re-entrancy guard, and the funding check must all execute identically in both modes. D-20's "broadcast via the override is opt-in within the opt-in" then reduces to a single boolean threaded into one call.

### Pitfall 9: Validating the returned PSBT by comparing raw bytes

**What goes wrong:** every externally-signed PSBT is rejected as mismatched.

**Why it happens:** empirically confirmed this session: the round-tripped transaction has an **identical txid** but **different raw hex** than the locally-signed one, because BIP-340 signing uses auxiliary randomness and the witness therefore differs. The txid excludes witness data, so it matches.

**How to avoid:** compare `tx.unsignedTx` (Pattern 8). Do not compare `extract()` output, and do not call `.id` before `finalize()` (it throws `Transaction is not finalized`).

### Pitfall 10: ToS acceptance presented as protocol-enforced

**What goes wrong:** documentation or copy implies participants cannot join without accepting, which is false and is exactly the kind of overclaim this project's honesty discipline exists to prevent.

**Why it happens:** the app-level join UI genuinely does block, so it feels enforced from inside the browser.

**How to avoid:** the protocol message list carries no acceptance field (verified above), and `createParticipant` opts in from the advert with no app involvement. State the limit in the settings help text, in the participant-side caption (both already specified in the UI-SPEC), and in `docs/DEPLOY.md`.

---

## Code Examples

### Cancel a cohort, end to end (service side)

```typescript
// Composition inside createService; every symbol below is verified to exist.
// runner.stopCohort:       @did-btcr2/aggregation@0.4.0 src/service/service-runner.ts:573
// monitor.noteFunding:     packages/service/src/monitor.ts:397 (the seam this mirrors)
// settleCompletion:        packages/service/src/operator-cohorts.ts:325

function cancelCohort(cohortId: string): 'ok' | 'unknown' {
  const config = advertised.get(cohortId);
  if (!config) return 'unknown';

  // 1. Declare intent BEFORE the library call (stopCohort emits nothing).
  intents.declare(cohortId, 'canceled');

  // 2. Capture the fate at event time (04 D-23) so a session-GC'd cohort still projects.
  monitor?.noteCanceled(cohortId);

  // 3. Drop protocol state. Rejects the completion with COHORT_STOPPED; the
  //    settleCompletion reject branch reads the intent and files 'canceled'.
  runner.stopCohort(cohortId);

  // 4. Retire the funding watch: 'funded' is a terminal DISPLAY state (04-08), and a
  //    canceled cohort must also terminate the watch or publicFunding keeps claiming
  //    the cohort awaits funding forever (the WR-01 lesson at monitor.ts:1148-1155).
  retireFundingWatch(cohortId);

  // 5. Repair the transport's single advert slot (Pitfall 3).
  republishNewestOpenAdvert();

  return 'ok';
}
```

### The PSBT split (shared side)

```typescript
// packages/shared/src/index.ts, refactoring buildSingletonRegistrationTx (:650-728).
// The template builder is everything up to (but not including) sign()/finalize().

/** Build the unsigned registration transaction template. */
export function buildRegistrationTemplate(opts: {
  keys: SchnorrKeyPair;
  utxo: RegistrationUtxo;
  updateHash: Uint8Array;
  network?: NetworkConfig;
  fee?: bigint;
}): Transaction {
  // ... all existing guards VERBATIM (fee positive, fee <= MAX_REGISTRATION_FEE_SATS,
  //     value >= fee + P2TR_DUST_SATS, updateHash.length === 32) ...
  const pay = p2tr(internalKey, undefined, network.scureNetwork);
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({
    txid: opts.utxo.txid,
    index: opts.utxo.vout,
    witnessUtxo: { amount: value, script: pay.script },
    tapInternalKey: pay.tapInternalKey,
  });
  tx.addOutput({ script: pay.script, amount: value - fee });               // change FIRST
  tx.addOutput({ script: Script.encode(['RETURN', opts.updateHash]), amount: 0n }); // signal LAST
  return tx;
}

/** Existing behavior, now composed: byte-identical for every current caller. */
export function buildSingletonRegistrationTx(opts: {...}): RegistrationTx {
  const tx = buildRegistrationTemplate(opts);
  tx.sign(opts.keys.raw.secret!);
  tx.finalize();
  return { rawHex: bytesToHex(tx.extract()), txid: tx.id, fee, change };
}

/** Wallet path, step 1: hand out the unsigned PSBT. */
export function exportRegistrationPsbt(opts: {...}): { base64: string; templateHex: string } {
  const tx = buildRegistrationTemplate(opts);
  return {
    base64: base64Encode(tx.toPSBT(0)),
    templateHex: bytesToHex(tx.unsignedTx),   // the comparison anchor for step 2
  };
}
```

### Validating the returned PSBT (browser side)

```typescript
// packages/web/src/lib/psbt.ts (new) - a PURE function, unit-testable with no DOM.
// Every predicate below was executed against the project's tx shape this session.

export type PsbtVerdict =
  | { ok: true; feeSats: bigint; paysSats: bigint; toAddress: string | undefined; rawHex: string }
  | { ok: false; reason: 'unparseable' | 'mismatched' | 'unsigned' | 'fee-out-of-band' };

export function validateSignedPsbt(
  psbtBytes: Uint8Array,
  templateHex: string,
  expectedFeeSats: bigint,
  network: BTC_NETWORK,
): PsbtVerdict {
  let tx: Transaction;
  try {
    tx = Transaction.fromPSBT(psbtBytes, { allowUnknownOutputs: true });
  } catch {
    return { ok: false, reason: 'unparseable' };   // throws "Reader(magic): ..."
  }
  // unsignedTx is witness-free, so it is stable across signing. Never compare extract().
  if (bytesToHex(tx.unsignedTx) !== templateHex) {
    return { ok: false, reason: 'mismatched' };
  }
  if (!tx.getInput(0).tapKeySig) {
    return { ok: false, reason: 'unsigned' };      // finalize() would throw here
  }
  if (tx.fee > expectedFeeSats) {
    return { ok: false, reason: 'fee-out-of-band' };
  }
  tx.finalize();
  return {
    ok: true,
    feeSats: tx.fee,
    paysSats: tx.getOutput(0).amount ?? 0n,
    toAddress: tx.getOutputAddress(0, network),
    rawHex: bytesToHex(tx.extract()),
  };
}
```

### Direct esplora reads (browser side)

```typescript
// packages/web/src/lib/tx-client.ts, extended. Paths verified against
// @did-btcr2/bitcoin@0.8.0 src/client/rest/protocol.ts:138-141 and :89-91,
// which are the exact routes the server-side proxy calls.

export interface ChainEndpoint {
  /** Absolute esplora base URL, or undefined to use the coordinator proxy. */
  esploraBase?: string;
  /** Opt-in within the opt-in (D-20): route broadcast through the override too. */
  broadcastDirect?: boolean;
}

export async function fetchUtxos(
  baseUrl: string, address: string, ep: ChainEndpoint = {},
): Promise<Utxo[]> {
  const url = ep.esploraBase
    ? `${trim(ep.esploraBase)}/address/${encodeURIComponent(address)}/utxo`
    : `${trim(baseUrl)}/v1/tx/utxos/${encodeURIComponent(address)}`;
  // ... identical error handling; a CORS rejection arrives as a TypeError (status 0)
}

export async function broadcastTx(
  baseUrl: string, rawHex: string, ep: ChainEndpoint = {},
): Promise<string> {
  if (ep.esploraBase && ep.broadcastDirect) {
    // esplora returns the txid as PLAIN TEXT, not JSON. This asymmetry with the
    // proxy's { txid } body is the one real difference between the two paths.
    const res = await fetch(`${trim(ep.esploraBase)}/tx`, {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: rawHex,
    });
    if (!res.ok) throw new TxProxyError(await res.text(), res.status);
    return (await res.text()).trim();
  }
  // ... existing proxy path unchanged
}

/** Network-mismatch guard (D-20): block 0's hash uniquely identifies the chain. */
export async function probeChain(esploraBase: string): Promise<string> {
  const res = await fetch(`${trim(esploraBase)}/block-height/0`, {
    headers: { accept: 'text/plain' },
  });
  if (!res.ok) throw new TxProxyError(`HTTP ${res.status}`, res.status);
  return (await res.text()).trim();
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SSE telemetry channel (`/dashboard/events`) | Polled gated snapshot on `GET /v1/operator/cohorts` | Phase 4, plan 04-02; ADR 0016 supersedes ADR 0004 | Every new lifecycle fact must ride the existing polled read, not a new stream. Do not add an SSE channel for operator actions. |
| Boot-time perpetual auto-advertise loop | Two operator-driven `advertiseCohort` call sites only | Phase 1, plan 01-03 | Makes the pause gate trivially small and correct (Pattern 4). Also means the `FILLERS` env is inert residue. |
| Phase sets duplicated in four files | `packages/shared/src/phases.ts` single source of truth | Phase 4, plan 04-08 (the WR-05 review finding) | The "three mirrored places" hazard from 04-08 is already fixed for **phases**. It is not fixed for **fates**, which still live in `monitor.ts` plus `operator-cohorts.ts` plus the web row mapper; the canceled fate must touch all three. |
| Specs co-located in `src/` | New specs in `packages/*/tests/` | Phase 4, plan 04-01 | Every new spec this phase goes in `tests/`, outside `src/`. Existing co-located specs stay where they are unless the plan is editing them anyway. |
| `advertRepeatIntervalMs` assumed honored | Known-inert: `HttpServerTransport.publishRepeating` ignores it | Phase 4 live UAT; documented in `04-LIVE-UAT-CHECKLIST.md` | Reinforces that any advert refresh must be an explicit app-side re-publish (Pattern 3), never a reliance on the library's repeat cadence. |
| One-shot advert with a 5-minute library default TTL | `advertTtlMs` threaded from `cohortTtlMs`, finite-positive guarded, typed via `HttpServerTransportConfig` | Phase 4, plan 04-08 | A re-published advert automatically inherits the correct, longer TTL, because `publishRepeating` recomputes `expiresAtMs` from the transport's configured value. |

**Deprecated / outdated in the upstream libraries as installed:**

- `AggregationServiceRunnerOptions.advertRepeatIntervalMs` and `DEFAULT_ADVERT_REPEAT_INTERVAL_MS`: documented but inert on the HTTP transport. Do not surface either as an operator setting.
- `TxOpts.allowUnknownOutputs` has a deprecated sibling in `@scure/btc-signer@1.8.1`'s type surface; use the non-deprecated spelling.
- The `fillers?: number` field on `DemoServerOptions`: compile-compatibility residue with no machinery. Do not build test peers on it (D-17, planning note 7).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Coldcard signs Taproot P2TR key-spend from stable firmware v5.5.0+, and renders an "unparseable script" warning (rather than rejecting) for the `OP_RETURN` output; Sparrow supports the full PSBT round trip. `[ASSUMED - WebSearch only, classified LOW by the confidence seam]` | Pattern 8 / D-21 | Low. The PSBT the app emits is standards-correct regardless (empirically round-tripped), so a wallet incompatibility is a user-facing support issue, not a design defect. It does mean the UI-SPEC's "compatible with Sparrow/Coldcard 5.5+/Ledger 2.x" claim should not be repeated as fact in shipped copy without the owner testing at least one wallet. Recommend a UAT step. |
| A2 | Ledger Bitcoin app 2.x signs this transaction shape. `[ASSUMED - not verified this session]` | D-21 | Low, same reasoning as A1. Ledger historically restricts `OP_RETURN` outputs more tightly than Coldcard, so this is the likelier of the two to fail. Do not name Ledger in shipped copy. |
| A3 | The genesis block hash from `GET {esplora}/block-height/0` is available on all esplora deployments a participant would plausibly use (mempool.space, Blockstream, self-hosted electrs). `[ASSUMED - the route exists in the protocol client, but per-deployment availability is untested]` | Pattern 7 | Medium. If unavailable on some host, the network guard cannot run. Mitigation: treat a failed chain probe as "cannot verify" and refuse the endpoint with honest copy, rather than proceeding unguarded. |
| A4 | Adding `AbortSignal`-driven teardown for test peers via the existing `stopController` is sufficient to reclaim their SSE subscriptions. `[ASSUMED - the pattern is verified in use for the funding wait; its applicability to participant runners is inferred]` | Pattern 10 | Low. Worst case is a leaked subscription until process exit on a rehearsal-only feature. Verify with a peer-count assertion in the hermetic e2e. |
| A5 | The UI-SPEC's E9 unresolved item (mixed broadcast modes visible at once) is adequately explained by the per-cohort drill-down disclosure, so no dedicated badge is needed. `[ASSUMED - carried forward from the UI-SPEC, which explicitly hands this to the planner]` | Pattern 6 | Low. Cosmetic; revisit only if an operator reads it as a bug. |

---

## Open Questions

1. **Where does the ToS acceptance artifact live, and is it public?**
   - What we know: `MemoryArtifactStore` / `FileSystemArtifactStore` with hex-keyed writes and a public unauthenticated `GET /cas/*` read already exist and are the natural home. CONTEXT explicitly leaves storage location to Claude's discretion but locks the DID-signed requirement.
   - What is unclear: whether an acceptance record should be world-readable. It contains a participant DID, a cohort id, a timestamp, and a terms hash. That is a public statement by design (it is a proof the participant agreed), but it is also a per-participant record on an otherwise anonymous surface, and `GET /cas/*` is unauthenticated.
   - Recommendation: store in the artifact store keyed by hash, serve it through the existing `GET /cas/*` read (hash-addressed, so it is unguessable without the reference), and show the reference only to the accepting participant and to the operator. Do not add it to any listing endpoint. Flag it for the owner during discussion if the planner wants a stronger posture.

2. **Does canceling need to notify already-connected participants faster than the directory poll?**
   - What we know: no protocol message can carry a cancel; participants learn via the directory poll's `postSeatCohortGone` predicate, which requires two consecutive gone reads (`POST_SEAT_GONE_CONFIRMATIONS = 2`).
   - What is unclear: the resulting latency (two poll intervals) against operator expectation.
   - Recommendation: accept it. The new public fate read (`GET /v1/cohort-fate/:id`) can be checked once the gone streak triggers, upgrading the copy from the honest fallback to the specific attribution without changing the timing. Do not shorten the streak; it exists to win a race against cohort-complete (the 03-07 CR-01 fix).

3. **Should the per-draft discovery window be built at all, given it can only shorten?**
   - What we know: the library offers no per-cohort TTL; app-side enforcement can only cut a cohort short of the runner's `cohortTtlMs`.
   - What is unclear: whether a shorten-only control satisfies D-11's intent or reads as a broken knob.
   - Recommendation: build it with an explicit validation ceiling and honest help copy naming the service maximum. If the phase runs long, this is the cleanest thing to drop from the D-22 CORE tier without losing criterion 3, since draft editing plus create-form defaults already close it.

4. **Do test peers on a live cohort need their own registration funding?**
   - What we know: D-17 says live test peers "participate for real"; a KEY first update needs a funded singleton beacon address and a confirmed registration before resolve reflects the update (the ADR 0007 chicken-and-egg, restated in Phase 4's `firstUpdateResolveNote`).
   - What is unclear: whether the operator is expected to fund each throwaway peer.
   - Recommendation: peers co-sign the cohort (which is the rehearsal value) and their post-cohort registration is honestly skipped with a console note, rather than silently failing or demanding N extra funding steps. Confirm with the owner if this reads as incomplete rehearsal.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 22 | everything | yes | v22.22.2 | none needed |
| pnpm 11.4.0 | workspace build | yes | 11.4.0 | none needed |
| tsx | e2e harnesses, `pnpm demo` | yes | v4.22.4 | none needed |
| vitest | unit suite | yes | resolved via workspace | none needed |
| TypeScript composite build (`tsc -b`) | gates every test run | yes | 5.9.3 | none needed |
| `@did-btcr2/*` pinned versions | protocol | yes | aggregation 0.4.0, method 0.51.0, bitcoin 0.8.0, keypair 0.13.1, common 9.1.0, smt 0.3.0 | none needed |
| `@scure/btc-signer` | PSBT leg | yes | 1.8.1 | none needed |
| `playwright-core` headless Chromium | browser capstones | present as a dependency; not exercised this session | ^1.61.1 | browser e2e is local-only and already Phase 6 CI debt |
| Polar / regtest node | live UAT (`pnpm uat:live`) | not probed (owner-operated, out-of-process) | - | hermetic fixture path is the default for every automated gate |
| An external Bitcoin wallet (Sparrow / Coldcard) | manual PSBT verification | not available in this environment | - | the round trip is proven programmatically; wallet interop needs a human UAT step |

**Missing dependencies with no fallback:** none. Every automated gate this phase adds runs hermetically.

**Missing dependencies with fallback:** wallet interop for the PSBT leg (A1/A2). Recommend the planner add a non-blocking UAT item rather than a blocking checkpoint, since the phase's correctness does not depend on it and D-21 is in the SLIP-FIRST tier.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^2 (root-level, no config file; workspace defaults) |
| Config file | none - `vitest run` from the repo root discovers `**/*.spec.ts` |
| Quick run command | `npx vitest run <path>` (a single file typically completes in under 1s) |
| Full suite command | `pnpm test` (= `tsc -b && vitest run`) |
| Current baseline | **522 tests, 40 files, all passing, 8.27s** (measured this session) |
| Spec location convention | NEW specs go in `packages/*/tests/`, outside `src/` (Phase 4 convention, project MEMORY `feedback-tests-outside-src`) |

### Phase Requirements to Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SVC-04 | Cancel files a `canceled` fate, never `expired` | unit | `npx vitest run packages/service/tests/cohort-cancel.spec.ts` | Wave 0 |
| SVC-04 | Cancel emits a monitor ended record and activity entry (proves Pitfall 1 is closed) | unit | `npx vitest run packages/service/tests/cohort-cancel.spec.ts` | Wave 0 |
| SVC-04 | A canceled cohort leaves the public directory and drops the open count | unit | `npx vitest run packages/service/src/operator-cohorts.spec.ts` | exists, extend |
| SVC-04 | Canceling the slot-owning cohort leaves a sibling still joinable (Pitfall 3) | e2e | `pnpm e2e:operator -- --cancel` (new leg on `e2e/operator-cohort.ts`) | Wave 0 |
| SVC-04 | Cancel retires the funding watch so `publicFunding` stops claiming awaiting | unit | `npx vitest run packages/service/tests/funding-watch.spec.ts` | exists, extend |
| SVC-04 | `Finalize now` outside the signing phases is refused with 409, not 500 | unit | `npx vitest run packages/service/tests/lifecycle-routes.spec.ts` | Wave 0 |
| SVC-04 | `Finalize now` inside signing commits the fallback (idempotent on repeat) | e2e | `pnpm e2e:fallback` (extend with an operator-triggered leg) | exists, extend |
| SVC-04 | Pause blocks advertise and re-advertise, and nothing else | unit | `npx vitest run packages/service/tests/pause.spec.ts` | Wave 0 |
| SVC-04 | `/v1/status` carries the paused bit; all six pin sites migrated | unit | `npx vitest run packages/service/tests/monitor.spec.ts packages/service/src/operator-cohorts.spec.ts` | exists, migrate |
| SVC-04 | Draft edit applies the same validation as create, byte-identical strings | unit | `npx vitest run packages/service/src/operator-cohorts.spec.ts` | exists, extend |
| SVC-04 | Settings save as a set: one bad field applies none (UI-SPEC E8) | unit | `npx vitest run packages/service/tests/runtime-settings.spec.ts` | Wave 0 |
| SVC-04 | Settings are read once at `createDraft`, never re-read at advertise (D-13) | unit | `npx vitest run packages/service/tests/runtime-settings.spec.ts` | Wave 0 |
| SVC-04 | Every new mutating route 401s for an anonymous caller before any lookup | unit | `npx vitest run packages/service/src/operator-boot.spec.ts` | exists, extend |
| SVC-04 | A per-draft discovery window above the runner TTL is rejected at save | unit | `npx vitest run packages/service/src/operator-cohorts.spec.ts` | exists, extend |
| SVC-04 (D-02) | `terminalReason` returns the cancel copy and NOT the stall copy for a mid-signing cancel | unit | `npx vitest run packages/web/tests/terminal-reason.spec.ts` | Wave 0 |
| D-14 | Kill switch downgrades NEW cohorts only; a cohort advertised before it keeps broadcasting | unit | `npx vitest run packages/service/tests/kill-switch.spec.ts` | Wave 0 |
| D-14 | No route can set `broadcastDisabled` back to false | unit | `npx vitest run packages/service/tests/kill-switch.spec.ts` | Wave 0 |
| D-15 | Dismiss removes an ended record and only that record | unit | `npx vitest run packages/service/tests/monitor.spec.ts` | exists, extend |
| D-16 | `SERVICE_NAME` edit shows on `/v1/config` additively; network fields byte-identical | unit | `npx vitest run packages/service/src/config.spec.ts` | exists, extend |
| D-17 | Test peers seat, are badged, and tear down on cohort settle | e2e | `pnpm e2e:operator -- --test-peers` | Wave 0 |
| esplora override | Direct-mode URL shapes match the proxy's esplora routes | unit | `npx vitest run packages/web/tests/tx-client.spec.ts` | Wave 0 |
| esplora override | A chain-mismatch probe refuses the endpoint and does not fall back silently | unit | `npx vitest run packages/web/tests/tx-client.spec.ts` | Wave 0 |
| esplora override | Mainnet acknowledgment gate fires identically in both modes (Pitfall 8) | unit | `npx vitest run packages/web/src/stores/participant.spec.ts` | exists, extend |
| PSBT leg | `buildSingletonRegistrationTx` output is unchanged after the template refactor | unit | `npx vitest run packages/shared/src/registration.spec.ts` | exists, extend |
| PSBT leg | Full round trip reproduces the locally-signed txid | unit | `npx vitest run packages/shared/tests/psbt.spec.ts` | Wave 0 |
| PSBT leg | Each of the five validation verdicts is produced by its own predicate | unit | `npx vitest run packages/web/tests/psbt.spec.ts` | Wave 0 |
| ToS | Acceptance signature verifies server-side; a wrong-key signature is refused | unit | `npx vitest run packages/service/tests/tos.spec.ts` | Wave 0 |
| ToS | A terms edit does not alter the meaning of a stored acceptance (hash binding) | unit | `npx vitest run packages/service/tests/tos.spec.ts` | Wave 0 |
| ToS | Terms text renders as escaped text, never markup | unit | `npx vitest run packages/web/tests/terms.spec.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run <the spec files that task touched>` plus `pnpm typecheck`.
- **Per wave merge:** `pnpm test` (full 522+ suite, `tsc -b` gated) plus `pnpm lint` plus `pnpm --filter @btcr2-aggregation/web build` (the vite build must stay clean; it is not covered by vitest).
- **Phase gate:** full suite green, plus the hermetic e2e set (`pnpm e2e:operator`, `pnpm e2e:monitor`, `pnpm e2e:browse`, `pnpm e2e:kofn`, `pnpm e2e:fallback`), plus the new cancel and test-peer legs, before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `packages/service/tests/cohort-cancel.spec.ts` - cancel fate, monitor record, directory removal
- [ ] `packages/service/tests/lifecycle-routes.spec.ts` - 401/404/409 semantics for every new gated route
- [ ] `packages/service/tests/pause.spec.ts` - the two-call-site gate and the untouched surfaces
- [ ] `packages/service/tests/runtime-settings.spec.ts` - all-or-nothing save, env-source tracking, read-once-at-draft
- [ ] `packages/service/tests/kill-switch.spec.ts` - new-cohorts-only, one-way
- [ ] `packages/service/tests/tos.spec.ts` - signature verification and hash binding
- [ ] `packages/shared/tests/psbt.spec.ts` - round-trip txid parity
- [ ] `packages/web/tests/psbt.spec.ts` - the five validation verdicts
- [ ] `packages/web/tests/tx-client.spec.ts` - direct-mode URLs and the chain guard
- [ ] `packages/web/tests/terminal-reason.spec.ts` - the cancel-vs-stall discrimination (Pitfall 5)
- [ ] `packages/web/tests/terms.spec.ts` - escaped rendering
- [ ] New e2e legs on `e2e/operator-cohort.ts`: `--cancel` (including the two-cohort advert-slot case) and `--test-peers`

No framework install is needed; vitest and the harness runner are both present and green.

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`, `security_block_on: high`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing operator password + `timingSafeEqual` comparison + login throttle (`packages/service/src/operator-auth.ts:48-51, 122`). Phase 5 adds **no** new authentication mechanism; every new operator route mounts inside the existing block. |
| V3 Session Management | yes | Existing httpOnly, `SameSite=Strict` session cookie with a server-tracked store and TTL (ADR 0015). Unchanged. New routes inherit `requireOperator`. |
| V4 Access Control | yes | Route placement is the control. Every mutating route goes **after** `app.use('/v1/operator/*', requireSameOrigin())` and `app.use('/v1/operator/*', requireOperator(...))` (`hono-adapter.ts:356, 364`). Hono matches in registration order, so placement is load-bearing. The new public fate read goes in the public block and must be non-oracle. |
| V5 Input Validation | yes | Guard-clause validation returning user-facing strings, mirroring `validateDraft` (`operator-cohorts.ts:243-264`): shape-guard `:id` params with the existing `/^[0-9a-zA-Z-]{1,64}$/` before any lookup; `bodyLimit` on every new POST/PUT/PATCH body (the established 4 KiB for small JSON); numeric knobs through the NaN-guarded `numericKnob` pattern. |
| V6 Cryptography | yes | No new primitives. ToS acceptance signing reuses the participant's existing schnorr key and the app's existing canonical hash; verification reuses `resolveBtcr2SenderPk`. PSBT signing is `@scure/btc-signer`. Nothing is hand-rolled. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| An anonymous caller reaches a new lifecycle route (cancel, pause, settings, kill switch, test peers, dismiss) | Elevation of Privilege | Register **after** both prefix guards; add an explicit 401-before-lookup assertion for each new route in `operator-boot.spec.ts`, matching the shipped pattern for the monitoring read. |
| CSRF on a new mutating route | Tampering | `requireSameOrigin()` already covers the whole `/v1/operator/*` prefix, layered on `SameSite=Strict`. Nothing new required, but a GET must never mutate. |
| Existence oracle via the new public fate read | Information Disclosure | Answer `{ canceled: false }` for unknown, evicted, and never-existed ids alike, exactly as `/v1/anchor` and `/v1/funding` do. Never 404. |
| Unbounded growth from an operator-triggerable action | Denial of Service | Every new per-cohort map (intents, test-peer DIDs) gets the same bounded-24 oldest-first eviction every existing per-cohort map uses, and is cleared on settle. The `fundingViews` unbounded-map finding (04 review WR-02) is the precedent for why this is treated as a real concern here. |
| Unbounded test-peer spawning | Denial of Service | Cap the peer count at the cohort's remaining seats (which is inherently bounded by n) and refuse when zero. Gate behind operator auth. |
| Stored XSS via operator-supplied terms text or service name rendered to anonymous participants | Tampering / Information Disclosure | Render as plain auto-escaped React text content only; never `dangerouslySetInnerHTML`, never a link target. Bound the stored length server-side. This is the single highest-value new control this phase, because terms text is the first long operator-authored string shown to strangers. |
| SSRF via the participant esplora endpoint | Information Disclosure | The fetch happens in the **browser**, not the server, so this is not server SSRF. But validate the scheme is `https:` (reject `http:`, `file:`, `javascript:`) before any fetch, and surface the malformed-URL copy. Never proxy the participant's endpoint through the service. |
| A malicious PSBT tricking a participant into signing away funds | Tampering | The app never signs on the wallet path; the participant's own wallet does. The app's duty is the reverse: validate the **returned** PSBT against the exact template it created (`unsignedTx` byte comparison) so a tampered PSBT can never reach broadcast. Pattern 8's ordering enforces this. |
| Broadcast of a PSBT that bypasses the mainnet guard | Tampering | Route both signing modes through the single `register()` path so the ADR 0010 acknowledgment executes identically (Pitfall 8). |
| Header injection via the export filename | Tampering | Already mitigated for the existing export by building the filename only from the shape-validated id; any new download route must do the same. |
| Secret persistence on the paste-import path | Information Disclosure | Never write imported key material or a pasted PSBT to `localStorage` / `sessionStorage` / IndexedDB; keep it in component or store state only, and clear on teardown. The UI-SPEC's ephemeral warning must be backed by this being actually true. |

---

## Sources

### Primary (HIGH confidence)

Installed library source and types, read directly this session:

- `node_modules/.pnpm/@did-btcr2+aggregation@0.4.0_typescript@5.9.3/.../src/service/service-runner.ts` - `stopCohort` (:573-580), `triggerFallback` (:491-506), `#SIGNING_PHASES` (:257-261), `advertiseCohort` (:320-361), `#startAdvertRepeat` / `#stopAdvertRepeating` (:415-440), `#disposeCohort` (:373-380), `#failCohort` (:555-563), timing options (:32-109)
- `.../src/service/http-server.ts` - `publishRepeating` and the single advert slot (:287-310), broadcast-subscriber replay (:484-502), `advertTtlMs` (:74, 181)
- `.../src/service/service.ts` - `advertise` INVALID_PHASE guard (:271-296), `startFallbackSigning` preconditions (:838-846)
- `.../src/core/messages/constants.ts` - the complete protocol message-type list (no cancel or acceptance type)
- `.../src/core/signer.d.ts` and `.../src/participant/participant-runner.ts:144` - the `AggregationSigner` seam and its hard-wiring
- `.../@did-btcr2+bitcoin@0.8.0/src/client/rest/protocol.ts` - esplora REST paths (:71-141), `src/client/http.ts` - fetch-based executor
- `node_modules/.pnpm/@scure+btc-signer@1.8.1/.../transaction.d.ts` - `fromPSBT` / `toPSBT` / `unsignedTx` / `fee` / `isFinal` / `finalize` / `extract` (:121-167)
- **Empirical PSBT round-trip execution** against the project's exact transaction shape, this session (two probe scripts, both run to completion, results tabulated in Pattern 8; scripts removed afterward)

Application source, read directly this session:

- `packages/service/src/operator-cohorts.ts` (full), `monitor.ts`, `index.ts`, `hono-adapter.ts`, `operator-auth.ts`, `demo-server.ts`
- `packages/shared/src/index.ts:590-728` (registration tx builder), `packages/shared/src/phases.ts`
- `packages/web/src/lib/tx-client.ts` (full), `lib/anchor.ts` (full), `lib/sidecar.ts` (full), `lib/operator.ts`, `stores/participant.ts:878-940, 1875-1960`, `ui/primitives.tsx`
- `packages/participant/src/index.ts` (advert-driven join)
- Repo-wide grep for `openCohorts` (the complete `/v1/status` pin list) and `buildSingletonRegistrationTx`
- `pnpm test` baseline run: 522 tests, 40 files, green, 8.27s

Planning artifacts:

- `.planning/phases/05-operator-cohort-lifecycle-control/05-CONTEXT.md`, `05-UI-SPEC.md` (approved)
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/config.json`
- `.planning/scoping/{participant-esplora-override,external-signers,tos-payments-notifications}.md`
- `./.claude/CLAUDE.md` (project constraints)

### Secondary (MEDIUM confidence)

- None. Nothing in this research rests on a single unverified secondary source.

### Tertiary (LOW confidence)

- WebSearch on the 2026 wallet PSBT landscape (Coldcard firmware versions, `OP_RETURN` warning behavior, Sparrow round trip). Classified LOW by the confidence seam and isolated as A1/A2 in the Assumptions Log. Sources: [COLDCARD Version History](https://coldcard.com/docs/version-history/), [COLDCARD Middle Ground Guide](https://coldcard.com/docs/middle-ground/), [Sparrow Wallet Features](https://sparrowwallet.com/features/), [Bitcoin Taproot Wallet Support Tracker](https://www.spark.money/tools/bitcoin-taproot-wallet-support), [Sparrow Documentation](https://www.sparrowwallet.com/docs/)

---

## Project Constraints (from CLAUDE.md)

The planner must verify every plan against these. They carry the same authority as locked decisions.

| Constraint | Source | Phase 5 implication |
|------------|--------|---------------------|
| Tech stack is established; do not churn without reason | Constraints | Zero new dependencies is the correct posture, and the UI-SPEC's "no icon library, no shadcn" holds. |
| Consume published `@did-btcr2/*`; this is a consumer app, not a library fork | Constraints | Never patch or vendor the library. Every gap (silent `stopCohort`, single advert slot, no per-cohort TTL, no seat release) is worked around app-side or documented honestly. |
| Config-driven network, never hardcoded | Constraints | The esplora override's network guard compares against `GET /v1/config`, never a constant. Any new chain-dependent value goes through `packages/shared/src/networks.ts`. |
| Real-money paths are opt-in behind guard rails | Constraints, ADR 0010 | Kill switch is disable-only; override broadcast is opt-in within opt-in; no runtime enable of live or broadcast. |
| Single-box self-host model, one coordinator process | Constraints, ADR 0014 | All new state is per-`createService` closure state, never a module singleton. |
| No unauthenticated mutating or control surface | Constraints, ADR 0015 | Every new action route mounts after both prefix guards. |
| All relative imports use explicit `.js` extensions | Import Organization | Applies to every new module. |
| `import type` for type-only imports | Import Organization | Applies throughout. |
| Guard clauses that throw with a descriptive, prefixed message; no custom Error subclasses | Error Handling | New validators follow `validateDraft`'s shape and return user-facing 400 strings. |
| Side-effect listeners are fire-and-forget with `.catch()` logging; a failure must never disturb the protocol | Error Handling | The advert re-publish, the monitor `noteCanceled`, and the test-peer spawn all follow this. |
| Routes that call out return generic 502/400 to callers while logging the real error | Error Handling | The new fate read, settings routes, and any esplora-adjacent server route. |
| Comment density: document non-obvious rationale, edge cases, and ADR links; use `{@link}` cross-references | Comments and Documentation | Especially the intent registry and the advert re-publish, both of which encode non-obvious library behavior. |
| Tests go in `tests/` outside `src/`; existing co-located specs stay | project MEMORY `feedback-tests-outside-src` | Every Wave 0 spec above is placed accordingly. |
| **NEVER use the em-dash character** in any authored output | global CLAUDE.md, MEMORY, UI-SPEC | This document contains none. Every plan, task action, and UI string must also contain none, at the source. |
| Commits must be unsigned (`git -c commit.gpgsign=false commit`); no `Co-Authored-By` trailer | global CLAUDE.md, MEMORY | Applies to the RESEARCH commit and every execution commit. |
| Do not produce COVERAGE.md; the api_coverage gate is inactive and false-positives on this repo | MEMORY | No coverage artifact this phase. |
| Naming: lowercase-hyphenated modules, PascalCase components, camelCase values, SCREAMING_SNAKE constants | Naming Patterns | Applies to every new file listed in Recommended Project Structure. |

---

## Metadata

**Confidence breakdown:**

- Library control surface (`stopCohort`, `triggerFallback`, advert slot, timing options): **HIGH** - read from the installed source with line numbers, cross-checked against the shipped `.d.ts`, and consistent with the six upstream limits Phase 4's live UAT independently documented.
- PSBT round trip and validation predicates: **HIGH** - empirically executed against the project's exact transaction shape, not inferred from documentation. Every predicate in the validation table was observed producing its stated result.
- Application seams (route placement, fate taxonomy, pin sites, participant terminal path): **HIGH** - read from the current source, with the `/v1/status` pin list produced by exhaustive grep rather than recollection.
- Esplora REST contract: **HIGH** - taken from the protocol client the server proxy already consumes, so the direct path is provably equivalent.
- ToS artifact shape: **MEDIUM** - the toolchain is verified present, but the record shape is a design proposal within Claude's discretion, and CONTEXT itself flags the format as costly to change.
- Wallet interop for the PSBT leg: **LOW** - WebSearch only, isolated as A1/A2, does not affect design correctness.

**Research date:** 2026-07-28
**Valid until:** 2026-08-27 for the library and application findings (the `@did-btcr2/*` versions are pinned, so these do not drift without a deliberate bump). 2026-08-04 for the wallet-landscape assumptions, which are the only fast-moving claim here.
