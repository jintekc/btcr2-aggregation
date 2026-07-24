# Phase 4: Operator Cohort Monitoring - Research

**Researched:** 2026-07-24
**Domain:** Server-side event-fold read models over the published `@did-btcr2/aggregation@0.4.0` runner, polled operator console UI (React 19 + Zustand 5), live Bitcoin funding/broadcast operability behind ADR 0010 guard rails
**Confidence:** HIGH (nearly all claims verified directly against the installed library `.d.ts` declarations and this repo's source)

## Summary

This phase is codebase-integration work, not new-technology work. Every library, pattern, and primitive it needs already exists in the repo or in the installed `@did-btcr2/*` packages; zero new dependencies are required. The research therefore focused on verifying the exact API surface the ~55 CONTEXT decisions lean on: the runner's event set and payloads, the session's per-cohort accessors, the phase enums, `selectSpendableUtxo` semantics, the broadcast lifecycle, and the precise consumers of the retiring dashboard-SSE channel.

The central verified findings: (1) the `AggregationServiceRunner` emits 14 typed events whose payloads carry participant identity everywhere EXCEPT the partial-signature leg and the `error` event - both audit claims (D-32, planning note 2) hold against `events.d.ts`; (2) the session (`runner.session`, an `AggregationService`) exposes rich per-cohort pull accessors (`pendingOptIns`, `collectedUpdates`, `validationProgress`, `getCohortPhase`, `getCohort`) that complement the event stream for snapshot building, but exposes NO route to the `BeaconSigningSession` object holding `partialSignatures`; (3) `selectSpendableUtxo` (exported from `@did-btcr2/method`, already imported by `tx.ts`) filters to confirmed UTXOs above the 546-sat dust floor and picks the DEEPEST, exactly as D-36's predicate rule requires; (4) the dashboard-SSE retirement fallout is exactly the four consumers planning note 1 lists, confirmed by grep; (5) `demo-server.ts` verifiably never passes `live`/`broadcast`/`changeAddress`/confirm knobs into `createService`, so D-35's env passthrough is a genuine gap, and the uncommitted `e2e/live-uat.ts` on disk contains the funding-wait wrapper and event tap D-48 formalizes.

**Primary recommendation:** Build the monitoring module as a new per-service closure factory (`createCohortMonitor` or similar) following the `anchor-state.ts` bounded-fold pattern, subscribing to ALL runner events plus broadcaster frames plus completion rejections, serving two gated polled reads (summary list merged with the existing operator list, per-cohort detail) mounted inside the existing `operatorAuth` block; land the funding wait as a wrapper around `makeProvideTxData`'s existing pre-flight, reusing its `selectSpendableUtxo` convention verbatim.

<user_constraints>
## User Constraints (from CONTEXT.md)

04-CONTEXT.md is the canonical, audit-corrected decision record (~55 decisions, two adversarial audit rounds). The planner MUST read it in full. The locked decisions are reproduced here by ID with their operative content; where CONTEXT.md carries longer audit-corrected wording (notably D-32, D-36, D-38, D-45), CONTEXT.md's text is authoritative and must not be re-derived from earlier discussion-log phrasings.

### Locked Decisions

**Monitoring surface shape (D-01..D-18)**
- D-01: Per-cohort drill-down is the monitoring surface; list rows open a full-view page; booth-era card wall retires.
- D-02: Dashboard tab, `DashboardView`, `CohortCard`, `MetricsStrip`, and the client-side SSE store retire (delete dead code). Event log survives as a per-cohort activity log in the drill-down.
- D-03: SPA-internal view state; NO routed URLs this phase.
- D-04: Live status chips on list rows (filling / signing / needs funding / fallback / failed / anchored) with warn/bad tones; no notification machinery.
- D-05: Drill-down layout: cohort-lifecycle stage timeline at top (mirrors participant StageTimeline), then concern sections: members, submissions, anchor detail, activity log.
- D-06: Service-level metrics: compact live-count row (open / in-flight / anchored / failed); no cumulative counters.
- D-07: Console is list-first; create form behind a New-cohort button; monitoring is the default view.
- D-08: List grouping by state: attention/active first, then drafts, then ended (anchored/failed/expired).
- D-09: Drafts keep the inline row treatment; drill-down exists for advertised+ cohorts only.
- D-10: Expired records sit in the ended group with expiry reason + the shipped Re-advertise row action; no drill-down for expired.
- D-11: Cross-cohort attention: warn-tone badge/count on the back link.
- D-12: Plain-first copy with raw protocol detail behind the technical expander.
- D-13: After advertising a draft, the operator lands in that cohort's drill-down.
- D-14: No dismissal of ended cohorts this phase (reversible).
- D-15: Quiet link to `/` opens the public directory in a new tab.
- D-16: Session expiry mid-monitoring: honest re-login redirect; requires NEW 401-vs-network discrimination plumbing.
- D-17: Always-visible compact health strip: live vs hermetic mode, active network, esplora reachability when live, IPFS on/off, freshness indicator, SERVICE_NAME.
- D-18: Operator anchor detail mirrors participant D-22: Signed, Broadcast (txid + explorer link), Confirmed; freeze at first confirmation; "Anchored" reserved for confirmed.

**Fresh-load truth / data path (D-19..D-27)**
- D-19: Server snapshot, polled: server-side monitoring module folds runner events into per-cohort DTOs; console polls gated reads every few seconds. `dashboard-sse.ts` and `/dashboard/events` retire. Costly reversibility: supersedes ADR 0004; a new ADR records it; committed test pins must migrate.
- D-20: Read shape: gated summary-list read (merged with/replacing the Phase 1 operator cohort-list read) + gated per-cohort detail read polled only while its drill-down is open.
- D-21: Per-cohort activity log is a server-side bounded ring buffer delivered in the detail DTO; survives fresh page loads.
- D-22: Log fidelity: ALL runner events (rejects, nonce progress, non-fatal errors) plus broadcaster frames, each server-stamped with wall-clock time.
- D-23: Ended cohorts (anchored/failed/expired) retained at a bounded cap mirroring anchor-state's 24, oldest evicted. Ended-record retention is CREATED by the monitoring module.
- D-24: Process restart: honest empty state + one plain line about in-memory state clearing.
- D-25: Poll failure: consecutive failures raise a "can't reach this service" banner with quiet auto-retry; displayed state freezes honestly; freshness indicator in the health strip.
- D-26: Public surfaces untouched: `DirectoryCohortDTO` byte-identical, public anchor read byte-untouched. All new detail is operator-gated only.
- D-27: Monitoring accumulator vs shipped anchor-state module: Claude's discretion (independent vs shared), hard constraint: public anchor read stays byte-untouched.
**Member/submission depth (D-28..D-34)**
- D-28: Member rows show full DID (shortened display + copy-full) plus onboarding model when known; pubkeys behind the technical expander only.
- D-29: Pending opt-ins are distinct from seated members.
- D-30: Submissions: who has / has not submitted, with timestamps; raw signed-update JSON behind the expander.
- D-31: Per-member round state on the member row: pending/seated, submitted, validated, nonce sent, rejected. Rejections also land in the activity log.
- D-32 (audit-corrected): Co-sign progress is per-participant where events carry identity. The partial-signature leg emits NO event and has no accessor: the drill-down honestly shows "all n nonces received, awaiting partial signatures" with NO per-member or k/n progress for that leg. File an upstream request for a `partial-sig-received` event; adopt when released. The adapter-tap workaround (counting SIGNATURE_AUTHORIZATION wire messages) was explicitly REJECTED.
- D-33: Fallback anchoring mirrors participant D-23: state plainly that the cohort anchored via the script-path fallback with k of n signatures; per-member inclusion marked where derivable.
- D-34: JSON export per cohort (owner divergence): a plain gated GET downloading the monitoring DTO + activity log; off-chain artifacts stay referenced by hash at `/cas/*`.

**Live-path enablement (D-35..D-46, audit-corrected final form)**
- D-35: `LIVE=1` keeps its current meaning. NEW `BROADCAST=1` (requires `LIVE=1`, refuses otherwise) passes `{live: true, broadcast: true}` into `createService`. Middle mode (live sign, no push) stays unexposed via env. `LIVE_CHANGE_ADDRESS` joins the passthrough set. Loud boot banner on live+broadcast boots. Health strip shows mode read-only. Costly reversibility: env vars are the operator-facing contract.
- D-36: Funding stage (watch-only, auto-detect): beacon address (copy + explorer link), THREE states (waiting / seen-in-mempool / funded-and-confirmed) plus a TERMINAL dead-end. Predicate rule (audit-critical): both advance and dead-end checks run the library's `selectSpendableUtxo` over the polled UTXO set and compare THE SELECTED UTXO against the suggested minimum; selection failure maps to waiting/awaiting-confirmation. Never an existence check.
- D-37: Suggested minimum = max(MIN_LIVE_FUNDING_SATS 2000, fee+outputs-derived need); dead-end fires when the SELECTED confirmed UTXO is below that one number; displayed ask, watch threshold, pre-flight floor, dead-end band are one consistent number.
- D-38 (audit-critical timer mechanics): env-tunable funding window, modest default (~10-15 min). Boot invariant covers the phase-timeout leg only (live+broadcast boot fail-fast-validates PHASE_TIMEOUT_MS > funding window). TTL leg is a per-cohort runtime clamp: the funding wait computes its deadline as min(configured window, remaining cohort TTL minus slack) and throws the specific "funding never arrived" reason from INSIDE onProvideTxData before either library timer fires. Clamped windows are disclosed honestly.
- D-39: Blind lapse honesty: terminal "funding never arrived" declared only when the final watch read was a successful empty observation; observation gaps get uncertainty-honest copy.
- D-40: Every live+broadcast boot without RECOVERY_KEY warns loudly; the funding stage ALWAYS shows recovery-key state (operator-held vs throwaway/unrecoverable). Mainnet adds the real-money line. ALLOW_MAINNET rails untouched.
- D-41: Bounded internal broadcast send retry: `attachBeaconBroadcast` retains the raw tx and retries the send with backoff for a bounded period before declaring terminal failure. No new HTTP surface. Exhaustion copy distinguishes "network unreachable at send time".
- D-42: Mainnet: warn-tone real-money line + honest change-routing line (change defaults to beacon address, timelocked; LIVE_CHANGE_ADDRESS redirects).
- D-43: Esplora unreachable mid-flight: health strip flips; affected cohorts' anchor/funding sections go stale-honest while retry/confirm machinery keeps working.
- D-44: Participant-side awaiting-funding copy + join-time live notice. Funding stage surfaces to the operator at keygen-complete (before the wait clock arms at Validated). Mid-round participant signal vehicle is planning's choice; the public anchor read stays byte-untouched.
- D-45 (audit-corrected): record the `validation-requested` participant event as a store fact. "Submitted + never validation-requested" = positive stall signal ("stalled collecting updates"); "submitted + validation-requested + unsigned" = uncertainty-honest "co-signing could not complete; this service didn't say why". Do NOT key stall copy on submitted-but-unsigned alone.
- D-46: Unconfirmed-signal resolve: guard service-side in the resolve path; return an honest retryable "a beacon signal is awaiting confirmation" outcome instead of a 500. No library fork.
**Proof + docs (D-47..D-54) and priority (D-55)**
- D-47: Hermetic CI-facing gate: monitoring e2e over the fixture path PLUS a hermetic mocked-chain LIVE funding leg (`createService({live: true, broadcast: true, bitcoin: statefulMock})` per the `e2e/live-mock-cohort.ts` pattern, `getUtxos` returning `[]` first then a confirmed above-minimum UTXO), so awaiting-funding -> funded auto-advance is exercised. The funding stage cannot exist on the fixture path.
- D-48: `e2e/live-uat.ts` is formalized as the repeatable opt-in live check (`pnpm uat:live` against Polar/regtest), RESHAPED: boot through the env-passthrough demo-server path, drop the getUtxos monkey-patch once the native funding stage exists, keep the runner-event tap and funding prompts.
- D-49: Local browser-level operator capstone (playwright-core: login, create, advertise, watch member/submission/co-sign/anchor states), mirroring `e2e:browser:participant`; CI wiring stays Phase 6 debt.
- D-50: Plans include a human live-UAT walkthrough checklist for the owner to run against Polar.
- D-51: SERVICE_NAME: boot-time env var displayed in the console health strip AND the public directory header. No edit surface. Carrier DTO is planning's choice.
- D-52: Extend `docs/DEPLOY.md` with an honest going-live section. Flagship live story is MUTINYNET; regtest/Polar is local development; hermetic remains the boot default.
- D-53: New ADR authored during execution documents the polled monitoring read model + dashboard-SSE retirement, supersedes ADR 0004, patches ADR 0015's rationale/route inventory.
- D-54: Three weak-fold todos become SCOPING one-pagers only under `.planning/`: participant esplora override; external signers (incl. PSBT registration-leg option); ToS/contracts/payments/notifications.
- D-55: SVC-03 monitoring AND live-path operability are jointly the non-negotiable core. Trimmings slip first: export (D-34), SERVICE_NAME (D-51), one-pagers (D-54).

### Claude's Discretion
- Exact poll intervals, DTO field inventories, env var names (FUNDING window var, BROADCAST spelling), retry/backoff constants, ring-buffer sizes.
- Monitoring accumulator topology (D-27): independent module vs shared accumulator with anchor-state; the three 24-cap stores (anchor-state, operator-cohorts expired, new monitoring ended) must not disagree inside the single merged read.
- Participant-side mid-round funding-signal vehicle (protocol SSE session vs a new additive public read) - NOT the frozen anchor read.
- SERVICE_NAME carrier DTO (`/v1/config` natural boot-constant carrier; `/v1/status` is exact-pinned).
- Exact copy strings, layout, spacing, visual treatment (04-UI-SPEC.md is the approved contract).
- Where the funding watch's polling loop lives and when it starts (address known at keygen-complete; wait clock arms at Validated).

### Planning notes from CONTEXT.md (audit-verified, MUST honor)
1. Dashboard-SSE retirement fallout migrates mechanically in the same change: `operator-boot.spec.ts` 404/401 pins on `/dashboard/events`, `broadcast.spec.ts` harness use of `bridgeRunnerToSse`, the `index.ts` re-export, `e2e/operator-cohort.ts` negative-auth 401 pin. Move negative-auth pins to the new gated snapshot reads.
2. The runner `error` event carries no cohortId; consume the completion channel (settleCompletion) for live failure reasons.
3. The operator store swallows fetch failures status-blind; D-16/D-25 need explicit 401-vs-network/5xx discrimination on the merged read and all mutating routes.
4. Formalize a requirement ID + success criteria for the live-path half (D-35..D-46).
5. Phase 5 contract debt: items parked to Phase 5 are not in Phase 5's written criteria; flag for Phase 5 discuss.
6. Anchored cohorts are pruned today with no record; the monitoring module creates the anchored/failed/expired taxonomy at event time (before library GC).
7. Library timer facts: phase timer resets on entering Validated; cohort TTL armed at advertise, never reset; #failCohort settles first-wins.
8. `selectSpendableUtxo` filters confirmed + above-dust, picks the DEEPEST UTXO; dust-only (<= 546) confirmed funding IS fixable by topping up; the 547..min band is not.
9. After the last nonce-received the runner emits nothing until signing-complete/fallback-started/cohort-failed; the signing session holding partialSignatures is unreachable through the public API.

### Deferred Ideas (OUT OF SCOPE)
- PRIORITY REVISIT next milestone (owner-flagged): multi-network cohorts + participant multi-cohort (PMG-01); current locks stand.
- Phase 5 absorption: runtime live/broadcast toggle, ended-cohort dismissal, SERVICE_NAME edit, operator test-peer control.
- Routed URLs (both sides at once, later); building the weak-three (one-pagers only this phase).
- Upstream adoption when released: partial-sig-received event (D-32); block_time unconfirmed-signal fix (D-46).
- Resolve-traffic telemetry; cross-cohort DID correlation; full artifact-bundle export; standalone OPERATOR.md; seat persistence (v2 DUR-01); the rejected adapter-tap partial-sig workaround.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SVC-03 | Operator can monitor a cohort in real time (members joined, pending DID-update submissions, co-sign progress, anchor status) | Verified runner event set + session accessors (below) supply every monitored fact except partial-sig progress (honest-limit copy per D-32); the `anchor-state.ts` bounded-fold pattern is the proven template; gated mount points exist in `hono-adapter.ts`'s operatorAuth block |
| (new, planner formalizes per planning note 4; suggest LIVE-01 or SVC-03b) | The live broadcast path is operable from the product itself: a real boot can enable live co-sign + broadcast behind guard rails, with a watch-only funding stage and honest failure copy | Verified: `demo-server.ts` never passes `live`/`broadcast` (gap confirmed); `createService` already accepts `live`/`broadcast`/`changeAddress`/`confirmPollIntervalMs`/`confirmTimeoutMs`; `selectSpendableUtxo` semantics confirmed; `e2e/live-uat.ts` funding-wait wrapper on disk as raw material |

**Success criteria (from ROADMAP.md):** (1) per-cohort live view of joins/seats; (2) pending submissions + co-sign progress through the MuSig2 round; (3) anchor status per cohort; (4) reachable only by the authenticated operator.
</phase_requirements>

## Project Constraints (from CLAUDE.md + MEMORY)

- **Stack is locked** (pnpm workspace, TS/ESM/Node >= 22, Hono, React 19 + Vite 8 + Tailwind v4 + Zustand 5, vitest + tsx e2e): "established, do not churn without reason." No new dependencies are needed this phase.
- **Consume published `@did-btcr2/*`** (`method@0.51.0`, `aggregation@0.4.0` caret): consumer app, never a library fork. D-32/D-46 upstream gaps are handled by honest copy + service-side guards, not patching.
- **Config-driven network, never hardcoded**: funding-stage explorer links, network chips, and mainnet lines all derive from the resolved `NetworkConfig` / `GET /v1/config`.
- **Real-money paths opt-in behind guard rails** (ADR 0010): `BROADCAST=1` is one more layer; hermetic zero-chain fixture stays the default.
- **No unauthenticated mutating/control surface**: all new detail reads + export mount INSIDE the operatorAuth block; public DTOs frozen (D-26).
- **Single-box in-memory model** (ADR 0014): monitoring state is per-`createService` closure state, honest about restart loss (D-24).
- **Relative imports use explicit `.js` extensions**; `import type` for type-only imports; guard-clause validation; `{@link}` TSDoc density matching existing files; ADR cross-references in comments.
- **NO em-dash character anywhere** (prose, UI copy, comments, commits); em-dashes in planning copy propagate into shipped strings and get checker-BLOCKED.
- **No Claude Co-Authored-By trailers in commits; GSD doc commits unsigned** (`git -c commit.gpgsign=false commit`).
- **NEW tests go in a `tests/` folder outside `src/`** (MEMORY: feedback-tests-outside-src). Existing co-located `*.spec.ts` files stay put; do not co-locate NEW spec files with source.
- **User handles CODE git; committing `.planning/` docs is authorized** (`commit_docs: true`).
- `pnpm test` = `tsc -b && vitest run` (typecheck gates every test run); `pnpm lint` = `eslint .`; web build must stay green (`vite build`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Monitoring event fold (runner events -> per-cohort DTOs, activity ring, ended retention) | API/Backend (`packages/service`, new module) | - | Events fire server-side on the runner; the browser must survive fresh loads (D-19/D-21) |
| Gated summary/detail/export reads | API/Backend (`hono-adapter.ts` operatorAuth block) | - | Auth is server-enforced (ADR 0015); public DTOs frozen (D-26) |
| Console rework (list-first, drill-down, health strip, chips) | Browser (`packages/web` operator components + store) | - | Pure presentation over polled reads; SPA-internal view state (D-03) |
| Poll loop + 401-vs-network discrimination | Browser (`stores/operator.ts` + `lib/operator.ts`) | API returns honest status codes | D-16/D-25 render decisions are client-side; the server just returns 401/5xx truthfully |
| Funding watch (UTXO polling, 3 states + dead-end) | API/Backend (service-side watch feeding the detail DTO) | Browser renders states | The watch must share `selectSpendableUtxo` + the clamp with the tx builder (D-36/D-38); chain I/O never runs from anonymous or browser paths |
| Funding wait clamp inside onProvideTxData | API/Backend (`tx.ts` / `index.ts` wiring) | - | Must throw before either library timer fires (D-38, planning note 7) |
| Live/broadcast boot enablement + banners + invariant | API/Backend (`demo-server.ts`) | - | Env is the operator contract (D-35); boot validation is fail-fast |
| Broadcast send retry | API/Backend (`broadcast.ts`) | - | D-41: no new HTTP surface; retains raw tx server-side |
| Unconfirmed-signal resolve guard | API/Backend (`resolve.ts`) | - | D-46: the throw happens server-side inside resolution driving |
| Stall-copy fix + join notice + awaiting-funding copy | Browser (`stores/participant.ts`, `CohortPage.tsx`) | Service supplies the funding signal (vehicle = discretion) | D-44/D-45 are participant-surface renders keyed on store facts |
| JSON export | API/Backend (gated GET) + Browser (download button) | - | D-34: serializes the server-held monitoring record |
| SERVICE_NAME | API/Backend (env -> carrier DTO) + Browser (strip + directory header) | - | Boot-time constant (D-51) |

## Standard Stack

### Core (all already installed; NO new packages this phase)

| Library | Version (verified installed) | Purpose | Why Standard |
|---------|------------------------------|---------|--------------|
| `@did-btcr2/aggregation` | 0.4.0 (pnpm store) | Runner events + session accessors = the monitoring module's input | Locked project constraint; consumer app |
| `@did-btcr2/method` | 0.51.0 | `selectSpendableUtxo`, `buildAggregationBeaconTx`, resolution machinery | Locked; `tx.ts` already imports both |
| `@did-btcr2/bitcoin` | 0.8.0 | `BitcoinConnection` esplora REST (UTXO reads for the funding watch, send/isConfirmed) | Locked; already the live-path connection |
| Hono | ^4 | New gated routes in `hono-adapter.ts` | Established adapter seam |
| Zustand | ^5.0.14 | Operator store growth (poll loop, drill-down state, 401 discrimination) | Established client state |
| React 19 + Tailwind v4 | ^19.2.7 / ^4.3.2 | Console rework from `ui/primitives.tsx` | Established; UI-SPEC forbids new component/icon libraries |
| vitest | ^2 | Unit tests (NEW tests in `tests/` folders outside `src/`) | Established gate |
| playwright-core | ^1.61.1 | D-49 browser operator capstone | Already used by `e2e:browser:participant` |
| tsx | ^4 | e2e harnesses incl. formalized `uat:live` | Established |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Polled snapshot reads (D-19, locked) | Keeping/extending the dashboard SSE | Rejected by owner decision: SSE has no fresh-load truth, EventSource cannot carry auth headers cleanly (ADR 0015 rationale being patched), and one data path beats two |
| Independent monitoring module (D-27 discretion) | Folding into `anchor-state.ts` / `operator-cohorts.ts` | Recommendation below: independent module consuming the same emitters; see Architecture Patterns |

**Installation:** none. `pnpm install` state is unchanged.

## Package Legitimacy Audit

No new external packages are installed this phase. All work composes from already-installed, already-vetted workspace dependencies (see `pnpm-lock.yaml`, committed and treated as the trusted base per CLAUDE.md).

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Verified Library Facts (aggregation@0.4.0, method@0.51.0, bitcoin@0.8.0)

All facts below were read directly from the installed `.d.ts` declarations under `node_modules/.pnpm/` this session. [VERIFIED: installed package type declarations]

### Runner event set (`dist/types/service/events.d.ts`) - the monitoring module's push inputs

| Event | Payload | Carries participant identity? |
|-------|---------|-------------------------------|
| `cohort-advertised` | `{cohortId}` | no |
| `opt-in-received` | `PendingOptIn {cohortId, participantDid, participantPk, communicationPk}` | YES (fires BEFORE the accept decision: this is D-29's pending-opt-in signal) |
| `participant-accepted` | `{cohortId, participantDid}` | YES (seated) |
| `keygen-complete` | `{cohortId, beaconAddress}` | no (D-44: funding stage surfaces here) |
| `update-received` | `{cohortId, participantDid}` | YES (D-30/D-31 submitted; NO timestamp in payload: the accumulator must wall-clock-stamp at receipt, which D-22 requires anyway) |
| `message-rejected` | `Rejection & {cohortId}` = `{from, code, reason, cohortId}` | YES (`from` = sender DID; codes: WRONG_VERSION, UPDATE_TOO_LARGE, UPDATE_VERIFICATION_FAILED, UPDATE_MALFORMED) |
| `data-distributed` | `{cohortId}` | no |
| `validation-received` | `{cohortId, participantDid, approved}` | YES (D-31 validated; `approved:false` is a per-member rejection) |
| `signing-started` | `{cohortId, sessionId}` | no |
| `fallback-started` | `{cohortId, sessionId}` | no (D-33 fallback disclosure trigger) |
| `nonce-received` | `{cohortId, participantDid}` | YES (D-32 nonce leg is per-member) |
| `signing-complete` | `AggregationResult {cohortId, signature, signedTx, path?: 'key-path'|'script-path'}` | no (`path` absent = key-path; `signature` EMPTY for script-path) |
| `cohort-failed` | `{cohortId, reason}` | no |
| `error` | `Error` (bare) | NO cohortId (planning note 2 CONFIRMED: use settleCompletion's rejection channel for attributed failure reasons) |

**Partial-sig gap CONFIRMED (D-32 / planning note 9):** between the last `nonce-received` and `signing-complete` / `fallback-started` / `cohort-failed` there is NO event. `AggregationService` exposes `getSigningSessionId(cohortId): string | undefined` (an id string only) and no accessor returning the `BeaconSigningSession` object whose `partialSignatures: Map<string, Uint8Array>` would be needed. Plans MUST NOT depend on per-member partial-sig progress.

### Session pull accessors (`runner.session`, `dist/types/service/service.d.ts`) - snapshot enrichment

| Accessor | Returns | Monitoring use |
|----------|---------|----------------|
| `session.cohorts` | `ReadonlyArray<AggregationCohort>` | live membership (already the directory's source of truth) |
| `getCohortPhase(id)` | `ServiceCohortPhaseType | undefined` | stage timeline / chips |
| `getCohort(id)` | `AggregationCohort | undefined` | `participants[]`, `participantKeys: Map<did, pk>`, `pendingUpdates: Map<did, SecuredDocument>` (raw signed updates for D-30's expander), `nonIncluded: Set<did>`, `validationAcks`/`validationRejections`, `beaconAddress`, `effectiveFallbackThreshold` |
| `pendingOptIns(id)` | `ReadonlyMap<string, PendingOptIn>` | D-29 pending vs seated distinction (pull-side) |
| `collectedUpdates(id)` | `ReadonlyMap<string, SecuredDocument>` | who submitted (no timestamps: stamp on event) |
| `validationProgress(id)` | `{approved, rejected, pending: ReadonlySet<string>, total}` | per-member validated state |
| `getResult(id)` | `AggregationResult | undefined` | path (key-path vs script-path) for D-33 |

**GC caveat:** `removeCohort` is called by the runner on completion/failure/expiry, so pull accessors go dark for ended cohorts. The monitoring module must capture ended-record facts AT EVENT TIME (planning note 6 confirmed by the API shape).

### Phases (`dist/types/core/phases.d.ts`)

`ServiceCohortPhaseType` = Created, Advertised, CohortSet, CollectingUpdates, UpdatesCollected, DataDistributed, Validated, SigningStarted, NoncesCollected, AwaitingPartialSigs, FallbackRequested, Complete, Failed. The repo already keys `OPEN_PHASES` / `IN_FLIGHT_PHASES` as string sets in `operator-cohorts.ts`; the drill-down timeline can map these to the operator stage set (advertise -> filling -> submissions -> co-signing -> funding (live) -> anchor) without importing the enum.

### Runner timers (`AggregationServiceRunnerOptions` docs)

- `cohortTtlMs`: "Overall wall-clock budget for each cohort, from advertise to signing-complete" - armed once, never reset. [VERIFIED]
- `phaseTimeoutMs`: "Reset automatically on every observed phase change" - so entering Validated grants a fresh full budget for the funding wait (planning note 7 leg 1 confirmed). [VERIFIED]
- `#failCohort` first-settlement-wins is private-implementation behavior; not visible in the `.d.ts`. The CONTEXT audit verified it against source; treat as [CITED: 04-CONTEXT.md planning note 7] (MEDIUM) and preserve D-38's design of throwing from inside `onProvideTxData` BEFORE either timer fires, which is safe under any settlement-ordering semantics.

### UTXO selection (`@did-btcr2/method` `dist/types/core/beacon/beacon.d.ts`)

- `selectSpendableUtxo(utxos: AddressUtxo[], address?: string): AddressUtxo` - filters to CONFIRMED UTXOs above `SPENDABLE_DUST_LIMIT_SATS = 546`, then picks the DEEPEST; throws `NO_SPENDABLE_BEACON_UTXO` with a message distinguishing all-unconfirmed from all-dust (maps cleanly to D-36's waiting vs awaiting-confirmation states). [VERIFIED]
- `AddressUtxo` (`@did-btcr2/bitcoin`) = `{txid, vout, value: number, status: TransactionStatus}` with `status.confirmed`. [VERIFIED]
- The dust floor is a coarse pre-filter, NOT fee coverage: the builders separately enforce `value <= feeSats` rejection (~775-1200 sats at 5 sat/vB). D-37's fee-derived component of the suggested minimum should mirror this builder-side need. [VERIFIED from the doc comment]

## Verified Codebase Facts (this repo, read this session)

- **`demo-server.ts` live-gap CONFIRMED:** the `createService` call (lines ~317-337) passes `bitcoin` but never `live`, `broadcast`, `changeAddress`, `confirmPollIntervalMs`, or `confirmTimeoutMs`. `useLive` only switches the injected connection between offline and esplora (resolve + tx proxy). D-35's env passthrough is a genuine, small wiring change. [VERIFIED: packages/service/src/demo-server.ts]
- **`createService` already accepts the full live surface:** `live`, `bitcoin`, `broadcast` (throws without `live`), `changeAddress`, `allowMainnet` (via `assertNetworkAllowed`), `confirmPollIntervalMs`, `confirmTimeoutMs`, `feeEstimator`. The `e2e/live-uat.ts` harness already boots exactly this combination. [VERIFIED: packages/service/src/index.ts]
- **`tx.ts` pre-flight:** `MIN_LIVE_FUNDING_SATS = 2000`; `makeProvideTxData`'s live branch does one `getUtxos` read, `selectSpendableUtxo` in try/catch (selection failure re-thrown with an operator-facing prefix), then the `< MIN_LIVE_FUNDING_SATS` dead-end throw whose message already encodes the "topping up cannot fix this" fact. The D-38 funding wait wraps around/inside this callback; the D-36 watch must reuse this exact selection + floor. [VERIFIED: packages/service/src/tx.ts]
- **`broadcast.ts` is one-shot:** `broadcastAndConfirm` calls `bitcoin.rest.transaction.send(rawHex)` exactly once; a send rejection propagates to `attachBeaconBroadcast`'s catch which emits `beacon-broadcast-failed`. Confirm poll: default 5000ms interval / 180000ms budget, AbortController-wired to `service.stop()`. D-41's bounded retry lands around the send (rawHex is already in scope to retain). [VERIFIED: packages/service/src/broadcast.ts]
- **`anchor-state.ts` is the fold template:** per-service closure factory, `MAX_TERMINAL = 24`, `remember()` re-sets the key to refresh insertion order (progressing cohorts are not evicted mid-life), non-oracle `{state:'none'}` default, explorer URL derived under try/catch. [VERIFIED: packages/service/src/anchor-state.ts]
- **`operator-cohorts.ts`:** `settleCompletion` already routes completion rejections into a bounded `terminal` map (expired-only, cap 24, reason string preserved) and prunes successful completions WITHOUT a record - confirming planning note 6 (anchored/failed records must be created by the new module). `listCohorts()` is the D-20 merge target. `advertiseDraft`/`readvertiseExpired` are the only advertise call sites. [VERIFIED]
- **`dashboard-sse.ts` consumers (planning note 1) CONFIRMED by grep:** `packages/service/src/index.ts` (re-export of `bridgeRunnerToSse` + `DashboardExtras`), `hono-adapter.ts` (import + `/dashboard/events` mount when `runner && operatorAuth`), `operator-boot.spec.ts` (404 pin line ~64, 401 pin line ~86), `broadcast.spec.ts` (uses `bridgeRunnerToSse` as harness), `e2e/operator-cohort.ts` (negative-auth pin), `packages/web/src/stores/dashboard.ts` + `components/dashboard/DashboardView.tsx` (the retiring client). `dashboard-sse.ts`'s `SERVICE_EVENTS` list and `serialize()` (hex-encodes pubkeys, `summarizeTx` guards `tx.fee` throwing on fixture inputs) are the reference for the new module's payload handling even as the SSE dies. [VERIFIED]
- **`hono-adapter.ts` mount order:** public reads (`/v1/config`, `/v1/directory`, `/v1/status`, `/v1/ipfs`, `/v1/anchor/:cohortId`) sit BEFORE the `if (operatorAuth)` block; inside it: `requireSameOrigin()` on `/v1/operator/*`, login, then `requireOperator` on `/v1/operator/*` AND `/dashboard/*`, then the cohort CRUD routes. New monitoring reads inherit both guards by mounting under `/v1/operator/*` inside this block. [VERIFIED]
- **`stores/operator.ts` status-blindness CONFIRMED (planning note 3):** `refreshCohorts` catches everything and keeps the last-known list; `lib/operator.ts` `listCohorts` throws a generic `Error` on any `!res.ok` with no 401 branch. Only login/session-probe currently discriminate statuses. D-16/D-25 need a discriminated result type (e.g. `{kind:'ok'|'unauthorized'|'unreachable'}`) on the merged read and mutating calls. [VERIFIED]
- **`e2e/live-uat.ts` (uncommitted, on disk):** contains the `getUtxos` monkey-patch funding-wait (beacon-address-scoped, FUND_WAIT_MS default 900s, 3s poll, progress logging), the `keygen-complete` FUND-THIS-ADDRESS prompt, the runner-event tap, and broadcaster mirrors, plus human-paced timeouts (`phaseTimeoutMs`/`cohortTtlMs` 1_800_000, `confirmTimeoutMs` 7_200_000) and the comment that the phase timeout "must comfortably exceed FUND_WAIT_MS" - the D-38 constraint in the wild. D-48 reshapes this: env-passthrough boot + native funding stage replaces the monkey-patch. [VERIFIED]
- **`e2e/live-mock-cohort.ts` `mockBitcoin`:** instrumented mock connection with call tallies; `getUtxos` currently returns one confirmed UTXO immediately. D-47 needs a stateful variant (`[]` first, confirmed later) - a small extension of this existing helper. [VERIFIED]
- **`resolve.ts` interception point for D-46:** `satisfyNeed`'s `NeedBeaconSignals` case fetches signals via `BeaconSignalDiscovery.indexer(...)` and `provide()`s them; the upstream Invalid Date throw (block_time undefined on mempool-resident signals) surfaces during subsequent resolver processing. Guard options: filter/detect unconfirmed signals at the `NeedBeaconSignals` seam before `provide()`, or catch the specific failure in `driveResolution` and map it to the retryable outcome. The route handler in `hono-adapter.ts` currently 502-generics all resolve failures, so the guard must produce a DISTINGUISHABLE outcome for the honest retryable body. [VERIFIED seam; exact upstream throw site is [ASSUMED] from Phase 3 UAT handoff]
- **UI raw material:** `ui/primitives.tsx` (Card, Button, Badge, StatusDot, SectionTitle, Mono, CopyField, Input, Select, Field), `LogPanel.tsx`, `components/cohort/StageTimeline.tsx`, the local `Expander` in `CompletionSummary.tsx` (to be promoted per UI-SPEC), operator components (`OperatorConsole`, `OperatorCohortList`, `CreateCohortForm`, `LoginPanel`, `PublicStatus`). [VERIFIED: ls + UI-SPEC cross-check]
- **`stores/participant.ts` D-45 seam:** a `validation-requested` listener already exists (line ~1117); D-45 records it as a store fact and rekeys the stall copy. The awaiting-funds machinery at lines ~1642-1664 is the registration-leg pattern (not the cohort funding wait). [VERIFIED]

## Architecture Patterns

### System Architecture Diagram (target state)

```text
                              PARTICIPANT (anonymous)                OPERATOR (session cookie)
                                      |                                       |
                    GET /v1/directory /v1/status /v1/anchor          POST /v1/operator/login
                    (byte-identical, D-26)                                    |
                                      |                    +------------------+------------------+
                                      v                    v                                     v
+---------------------------- hono-adapter.ts (one Hono app, one origin) ------------------------------+
|  public block (unchanged)      operatorAuth block: requireSameOrigin + requireOperator               |
|                                  GET /v1/operator/cohorts        <- merged summary read (D-20)       |
|                                  GET /v1/operator/cohorts/:id    <- detail read (poll while open)    |
|                                  GET /v1/operator/cohorts/:id/export  <- D-34 JSON download          |
|                                  (POST create/advertise/discard/readvertise unchanged)               |
|                                  [/dashboard/events DELETED, 401/404 pins migrated]                  |
+------------------------------------------------------------------------------------------------------+
                 ^ polled snapshots (one data path, D-19)
                 |
      +----------+-----------------------------------------------------------+
      |            MONITORING MODULE (new, per-createService closure)        |
      |  inputs:  runner events (ALL 14) --- broadcaster frames              |
      |           completion rejections (settleCompletion channel)           |
      |           funding-watch state transitions                            |
      |  state:   per-cohort fold (members, submissions, round state,        |
      |           anchor, funding) + activity ring (bounded)                 |
      |           + ended records (anchored/failed/expired, cap 24)          |
      +----------------+-------------------------+-------------------------+
                       |                         |
        AggregationServiceRunner        BeaconBroadcaster (live+broadcast only)
          .session accessors               ^ attachBeaconBroadcast (+ D-41 bounded send retry)
               ^                            |
               |                   signing-complete
    onProvideTxData (tx.ts)                 |
      D-38 funding WAIT (clamped) --- FUNDING WATCH (selectSpendableUtxo over
      throws "funding never arrived"        polled getUtxos; 3 states + dead-end)
               |                            |
               +---------- BitcoinConnection (esplora; offline stub on hermetic boots)
```

### Recommended module layout

```text
packages/service/src/
├── monitor.ts            # NEW: createCohortMonitor(...) fold + ring + ended retention + DTOs
├── funding-watch.ts      # NEW (or folded into monitor.ts): watch loop + state predicate
├── tx.ts                 # funding-wait clamp wraps the live branch of makeProvideTxData
├── broadcast.ts          # D-41 bounded send retry inside broadcastAndConfirm/attach
├── demo-server.ts        # BROADCAST=1 / LIVE_CHANGE_ADDRESS / FUNDING_WINDOW_MS passthrough,
│                         #   boot banner, RECOVERY_KEY warn, PHASE_TIMEOUT > window invariant
├── resolve.ts            # D-46 unconfirmed-signal guard
├── hono-adapter.ts       # new gated reads + export; dashboard-sse mount deleted
├── index.ts              # wiring + re-export cleanup (bridgeRunnerToSse removed)
└── dashboard-sse.ts      # DELETED
packages/service/tests/   # NEW spec files live here (tests-outside-src rule)
packages/web/src/
├── stores/operator.ts    # poll loop, view state, 401 discrimination
├── lib/operator.ts       # discriminated fetch results, new read/export endpoints
├── components/operator/  # list-first console, drill-down, health strip, funding stage
├── stores/dashboard.ts + components/dashboard/  # DELETED
└── ui/primitives.tsx     # Expander promoted (only permitted primitive addition)
```

### Pattern 1: Bounded event fold behind a polled read (the monitoring accumulator)

**What:** Subscribe once per service to every input emitter; fold frames into per-cohort mutable entries in insertion-ordered Maps with cap-and-evict; serve pure snapshot DTOs from `read()` functions. Exactly `anchor-state.ts` generalized.
**When to use:** the whole monitoring module (D-19/D-21/D-23).
**Key rules verified against existing code:**
- Per-service closure factory, never a module singleton (two services in one test process must not share state).
- `remember()` re-sets keys so progressing cohorts stay eviction-fresh.
- Reads are O(1)-ish pure projections; NEVER chain I/O on a request path.
- Wall-clock stamp (`Date.now()`) at event receipt (D-22); the library supplies no timestamps.
- Capture ended-record facts at event time (`cohort-failed`, `signing-complete`, completion rejection), because `removeCohort` GCs the session state afterward.

**Recommendation for D-27 (discretion):** an INDEPENDENT `monitor.ts` module that subscribes to the same runner/broadcaster the existing modules use, rather than entangling `anchor-state.ts` (public, frozen) or `operator-cohorts.ts` (advertise lifecycle). The merged summary read composes `operatorCohorts.listCohorts()` + monitor state at the route/DTO layer. The three 24-cap stores stay independent; the merged read must present ONE consistent row per cohort (monitor's ended record wins over operator-cohorts' expired record for display, with the expired reason folded in).

### Pattern 2: Funding watch predicate (D-36, one selection convention)

```typescript
// Source: mirrors packages/service/src/tx.ts pre-flight (verified this session)
import { selectSpendableUtxo } from '@did-btcr2/method';

function classifyFunding(utxos: AddressUtxo[], suggestedMinSats: number): FundingState {
  if (utxos.length === 0) return { state: 'waiting' };
  let selected: AddressUtxo;
  try {
    selected = selectSpendableUtxo(utxos, beaconAddress);
  } catch {
    // NO_SPENDABLE_BEACON_UTXO: all-unconfirmed maps to 'seen-awaiting-confirmation'
    // when any unconfirmed UTXO exists; all-dust stays 'waiting' (topping up over
    // dust IS fixable, planning note 8).
    return utxos.some((u) => !u.status.confirmed)
      ? { state: 'awaiting-confirmation' }
      : { state: 'waiting' };
  }
  // The SELECTED (deepest confirmed non-dust) UTXO is the one the builder spends.
  if (selected.value < suggestedMinSats) return { state: 'dead-end', selected }; // terminal (D-37)
  return { state: 'funded', selected };
}
```
The suggested minimum is computed ONCE (max of `MIN_LIVE_FUNDING_SATS` and the fee-derived need) and used for the displayed ask, the watch threshold, the pre-flight floor, and the dead-end band. D-39: a terminal window-lapse verdict requires the LAST successful observation to have been empty; track `lastObservationOk` alongside the state.

### Pattern 3: Funding wait clamp inside onProvideTxData (D-38)

```typescript
// Raw material: e2e/live-uat.ts getUtxos wrapper (verified on disk); reshape natively.
// Inside makeProvideTxData's live branch, BEFORE the existing pre-flight:
const deadlineMs = Math.min(configuredWindowMs, remainingCohortTtlMs - slackMs);
// poll getUtxos + classifyFunding until 'funded', or throw on lapse:
throw new Error('live beacon tx: funding never arrived for ' + beaconAddress + ' ...');
```
The throw settles that cohort's completion with the specific reason (routes through the library's failure path) BEFORE `phaseTimeoutMs` (fresh budget on entering Validated) or `cohortTtlMs` (armed at advertise) fires - which is why the clamp must subtract from REMAINING TTL, tracked from the cohort's advertise time. Boot invariant validates only PHASE_TIMEOUT_MS > window (fail-fast at demo-server boot when BROADCAST=1).

### Pattern 4: Discriminated fetch results for the poll loop (D-16/D-25, planning note 3)

```typescript
// lib/operator.ts: replace throw-on-!ok with a discriminated union
type FetchResult<T> = { kind: 'ok'; value: T } | { kind: 'unauthorized' } | { kind: 'unreachable' };
// store poll loop: 'unauthorized' -> auth:'logged-out' + session-expired copy (D-16);
// N consecutive 'unreachable' -> frozen state + banner + quiet retry (D-25);
// freshness timestamp updates only on 'ok'.
```

### Pattern 5: Polled detail read scoped to the open drill-down (D-20)

Summary read polls whenever the console is mounted and logged in; the detail read polls ONLY while its drill-down is open (start on open, stop on back). Poll interval discretion: participant-side precedent (Phase 2 D-05) is a few seconds; 3-5s fits both reads. Store keeps `view: {kind:'list'} | {kind:'detail'; cohortId}` (D-03, mirrors `participantView`).

### Anti-Patterns to Avoid
- **A second SSE channel or WebSocket** for monitoring: D-19 locked polled snapshots; ADR 0004 is being superseded, not re-implemented.
- **Tapping protocol wire messages at the HTTP adapter** to infer partial-sig progress: explicitly REJECTED (D-32).
- **Existence checks over the UTXO set** (`utxos.length > 0` or `.some(confirmed)`) as the funding predicate: must be the library's own selection (D-36).
- **Deriving monitoring membership from a parallel operator-written list**: derive from the live runner set + event folds (D-15 precedent).
- **Touching `DirectoryCohortDTO`, `GET /v1/anchor/:cohortId`, or any public DTO**: frozen byte-identical (D-26).
- **Rendering invented progress** (partial-sig counts, live confirmation counts): honesty rules Truths 6-8, D-32.
- **New mutating routes** (dismissal, lifecycle actions): Phase 5.
- **Co-locating NEW spec files with source**: new tests go in `tests/` directories.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Spendability decision | Custom confirmed/dust/depth logic | `selectSpendableUtxo` (method) | Watch and builder must NEVER disagree (D-36); the library encodes deepest-first + dust + confirmed |
| Beacon tx construction | Any tx assembly | `buildAggregationBeaconTx` + existing `makeProvideTxData` | Already correct for both spend paths |
| Broadcast + confirm | New broadcast plumbing | Extend `broadcastAndConfirm`/`attachBeaconBroadcast` in place | D-41 is a bounded retry around the existing send, not a new pipeline |
| Bounded retention | A new cache abstraction | The `remember()`/evict idiom from `anchor-state.ts`/`operator-cohorts.ts` | Proven, tested, DoS-bounded |
| Event payload serialization | New serializers | `dashboard-sse.ts`'s `serialize()`/`summarizeTx` logic (lift before deleting the file) | Handles Uint8Array pubkeys and the fixture-tx `fee` throw |
| Auth gating | Per-route checks | Existing `requireSameOrigin` + `requireOperator` prefix guards | ADR 0015; new reads inherit by mount location |
| UI primitives | New components/icons | `ui/primitives.tsx` + promoted `Expander` + `LogPanel` + StageTimeline pattern | UI-SPEC contract; no icon dependency permitted |

**Key insight:** every hard sub-problem in this phase already has a proven in-repo or in-library solution; the phase's risk is integration ordering (SSE retirement pins, timer clamp, three-store consistency), not novel construction.

## Common Pitfalls

### Pitfall 1: Deleting dashboard-sse breaks the committed CI gate mid-change
**What goes wrong:** `pnpm test` (tsc -b + vitest) fails because `operator-boot.spec.ts` pins 404/401 on `/dashboard/events`, `broadcast.spec.ts` imports `bridgeRunnerToSse` as its harness, and `index.ts` re-exports it; `e2e/operator-cohort.ts` pins the negative-auth 401.
**Why it happens:** the SSE channel is Phase 3 security evidence, not dead weight.
**How to avoid:** one atomic change (planning note 1): delete the module + mount + re-export, rewrite `broadcast.spec.ts` against the `BeaconBroadcaster` emitter directly, move the 404/401 negative-auth pins onto the NEW gated snapshot reads (they are the security evidence's new home), update `e2e/operator-cohort.ts`.
**Warning signs:** a plan that deletes `dashboard-sse.ts` in one task and migrates specs in another.

### Pitfall 2: Ended cohorts vanish because session state is GC'd before the snapshot
**What goes wrong:** the detail read returns nothing for anchored/failed cohorts; `getCohort()` is undefined.
**Why it happens:** the runner calls `session.removeCohort` on completion/failure/expiry (verified); pull accessors only cover live cohorts.
**How to avoid:** fold every fact needed for the ended record AT EVENT TIME (members, submissions, round states, anchor, reason) into the monitor's own entry; treat session accessors as enrichment for LIVE cohorts only.
**Warning signs:** DTO builders that call `session.getCohort()` for ended rows.

### Pitfall 3: Funding-wait throw loses the race against a library timer
**What goes wrong:** the operator sees a generic phase-timeout/TTL expiry instead of the specific "funding never arrived" reason; blind-lapse honesty (D-39) becomes impossible.
**Why it happens:** `#failCohort` settles first-wins; if `phaseTimeoutMs` or remaining TTL elapses before the wait throws, the library's reason wins.
**How to avoid:** boot invariant (PHASE_TIMEOUT_MS > window, fail-fast under BROADCAST=1) plus the per-cohort runtime clamp deadline = min(window, remaining TTL - slack); the wait ALWAYS throws before either timer can fire.
**Warning signs:** a fixed funding window with no TTL-remaining computation; missing boot validation.

### Pitfall 4: The `error` event has no cohortId
**What goes wrong:** activity-log entries or failure reasons get attributed to the wrong cohort or dropped.
**Why it happens:** `'error': [Error]` is bare (verified); only its 1:1-paired completion rejection carries the cohort.
**How to avoid:** log bare errors as service-level activity (or route to the currently-known context only when provable); take per-cohort failure REASONS from `settleCompletion`'s rejection and `cohort-failed.reason`.

### Pitfall 5: Funding stage assumed testable on the fixture path
**What goes wrong:** e2e for awaiting-funding -> funded never exercises the real code path.
**Why it happens:** `makeProvideTxData` short-circuits to the fixture tx when `live` is absent, and `offline-chain` always returns zero UTXOs (verified).
**How to avoid:** D-47's stateful mocked-chain leg (`live:true, broadcast:true, bitcoin: statefulMock` with `getUtxos` `[]`-then-funded) is the ONLY hermetic way to drive the watch's state machine.

### Pitfall 6: Status-blind polling turns session expiry into a frozen-forever console
**What goes wrong:** after cookie expiry every poll 401s, the catch swallows it, and the operator watches stale data indefinitely.
**Why it happens:** `refreshCohorts` currently catches all failures identically (verified).
**How to avoid:** discriminated results (Pattern 4); 401 routes to the D-16 re-login redirect; only network/5xx freezes with the D-25 banner.

### Pitfall 7: Public-surface drift while merging the summary read
**What goes wrong:** `DirectoryCohortDTO` or `/v1/status` changes shape as `listCohorts()` grows monitoring fields, breaking Phase 2/3 pins and D-26.
**How to avoid:** monitoring fields extend only the OPERATOR DTOs; add spec pins asserting the public DTOs byte-identical (mirror the Phase 3 anchor-read freeze evidence).

### Pitfall 8: Em-dashes or booth-framing in new UI strings
**What goes wrong:** checker-BLOCKED verification; HOST-03 regression.
**How to avoid:** all copy comes verbatim from 04-UI-SPEC.md's Copywriting Contract (already em-dash-free, operator-framed). Note existing store copy uses spaced hyphens (e.g. `ADVERTISED_OK`) - keep that convention; the UI-SPEC updated the advertise confirm to `Advertised. Now joinable in the directory.` (period form), so align when touching that string.

### Pitfall 9: Broadcast retry re-sends a confirmed or already-accepted tx as a failure
**What goes wrong:** retry loop misreads an esplora "already in mempool/chain" rejection as a send failure and declares terminal failure after backoff exhaustion, or double-emits lifecycle frames.
**Why it happens:** esplora `POST /tx` errors for duplicate submissions; the current one-shot code never faces this.
**How to avoid:** treat duplicate-acceptance style rejections as success where detectable; emit `beacon-broadcast` exactly once; keep frame SHAPES unchanged (anchor-state folds them, D-26); distinguish network-unreachable exhaustion in the reason string (D-41).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 22 | everything | yes (repo runs on it) | per engines pin | - |
| pnpm 11.4.0 | workspace | yes | pinned | - |
| Installed `@did-btcr2/*` packages | monitoring + live path | yes (verified in pnpm store) | aggregation 0.4.0, method 0.51.0, bitcoin 0.8.0 | - |
| playwright-core Chromium | D-49 capstone | yes (already used by `e2e:browser:participant`) | ^1.61.1 | local-only; CI wiring is Phase 6 debt |
| Polar / regtest + esplora | D-48 `uat:live`, D-50 human walkthrough | operator-run, external, opt-in only | - | NOT required by any gate; hermetic mock leg (D-47) covers CI |
| Public esplora (mutinynet) | flagship live story (docs) | external service, runtime-only | - | documented in DEPLOY.md; never a test dependency |

**Missing dependencies with no fallback:** none. The hermetic gate needs nothing external; live legs are explicitly opt-in and human-driven.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2 (units) + tsx-driven e2e harnesses + playwright-core (browser) |
| Config file | none dedicated; `pnpm test` = `tsc -b && vitest run` at repo root |
| Quick run command | `pnpm vitest run packages/service` (or a single spec path) |
| Full suite command | `pnpm test && pnpm lint && pnpm --filter @btcr2-aggregation/web build` |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|--------------|
| SVC-03 | Monitor fold: events -> DTOs, ring, ended retention, eviction | unit | `pnpm vitest run packages/service/tests/monitor.spec.ts` | NO - Wave 0 |
| SVC-03 | Gated reads 401 anonymous / 200 with session; export | unit (Hono `app.request`) | same file or `tests/monitor-routes.spec.ts` | NO - Wave 0 (pins migrate FROM operator-boot.spec) |
| SVC-03 | Monitoring e2e over the fixture path | e2e | `pnpm e2e:operator` (extended) or a new `e2e:monitor` | partial - extend `e2e/operator-cohort.ts` |
| SVC-03 crit 4 | Browser operator capstone | browser e2e (local) | new `e2e:browser:operator` script | NO - D-49 deliverable |
| LIVE-01 (new) | Funding predicate states incl. dead-end + dust-vs-band | unit | `tests/funding-watch.spec.ts` | NO - Wave 0 |
| LIVE-01 | Funding clamp throws specific reason before timers | unit (fake timers/short windows) | `tests/tx-funding-wait.spec.ts` | NO - Wave 0 |
| LIVE-01 | Broadcast send retry bounded + honest exhaustion | unit | extend `broadcast.spec.ts` (rewritten off `bridgeRunnerToSse`) | exists, needs rewrite |
| LIVE-01 | BROADCAST=1 env mapping + refusal without LIVE + boot invariant | unit | extend boot specs (`tests/`) | partial (`operator-boot.spec.ts`, `config.spec.ts` precedents) |
| LIVE-01 | Mocked-chain awaiting-funding -> funded auto-advance | e2e | new leg in `e2e/live-mock-cohort.ts` (`e2e:live:mock`) | exists, needs stateful mock |
| D-45/D-44 | Stall predicate rekey + join notice + waiting copy | unit | `packages/web/.../participant` tests (tests-outside-src for new files) | `participant.spec.ts` exists, extend carefully |
| D-46 | Unconfirmed-signal resolve returns retryable outcome, not 500 | unit | extend resolve specs (`tests/`) | `resolve.spec.ts` exists |
| D-26 | Public DTO freeze pins | unit | directory/anchor spec pins | partial - add explicit freeze assertions |

### Sampling Rate
- **Per task commit:** targeted `pnpm vitest run <touched-package-or-file>` + `tsc -b`
- **Per wave merge:** `pnpm test` (full unit + typecheck) + `pnpm --filter @btcr2-aggregation/web build`
- **Phase gate:** full suite + `pnpm lint` + fixture e2e legs (`e2e:operator`, `e2e:live:mock` extended) green before `/gsd-verify-work`; D-50 human live-UAT checklist is owner-run, not CI

### Wave 0 Gaps
- [ ] `packages/service/tests/` directory bootstrap (vitest picks up `*.spec.ts` anywhere; confirm include covers `tests/`)
- [ ] `monitor.spec.ts`, `funding-watch.spec.ts`, `tx-funding-wait.spec.ts` skeletons
- [ ] Stateful `mockBitcoin` extension in `e2e/live-mock-cohort.ts`
- [ ] `broadcast.spec.ts` harness rewrite (must land WITH the SSE deletion, Pitfall 1)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing cookie-session scheme (ADR 0015) unchanged; login throttle carried; WR-01 proxy-aware throttle stays a pre-public-deploy carry-forward |
| V3 Session Management | yes | httpOnly session cookie; NEW: 401 discrimination must NOT leak whether a cohort exists to an anonymous poller (gated reads 401 uniformly, no per-id oracle) |
| V4 Access Control | yes | All new reads + export mount inside `requireSameOrigin` + `requireOperator` prefix guards; public DTOs frozen (D-26); negative-auth pins migrate to the new reads (Phase 3 evidence continuity) |
| V5 Input Validation | yes | New GET routes take only a cohortId path param: validate shape cheaply before map lookups; export sets Content-Disposition safely (no user-controlled header content) |
| V6 Cryptography | yes (indirect) | Never hand-rolled; MuSig2/tx signing stays entirely in the library; RECOVERY_KEY is disclosed by STATE, never by value |
| V10 Malicious Code / SSRF | yes | Funding watch polls only the boot-resolved esplora host (config-driven network rule); no user-supplied URLs |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unbounded retention via anonymous or operator actions | DoS | Cap-and-evict (24-cap idiom) on ended records AND activity rings; ring size fixed per cohort |
| Internals disclosure through detail DTOs / activity log | Information Disclosure | Log carries event names + DIDs + generic reasons; raw esplora/policy errors stay server-side (502-generic convention); pubkeys hex-encoded but operator-gated only |
| Existence oracle on gated per-cohort reads | Information Disclosure | Anonymous callers get uniform 401 before any id lookup (guard order already ensures this) |
| CSRF on operator surface | Tampering | `requireSameOrigin` prefix guard inherited by all new routes (GET-only reads are additionally low-risk; export stays GET, no state change) |
| Funding dead-end / real-funds loss | Elevation-of-consequence | ADR 0010 layering: BROADCAST requires LIVE; mainnet requires ALLOW_MAINNET; loud banners; RECOVERY_KEY warn + stage disclosure (D-40/D-42) |
| Stale/false chain claims | Repudiation/honesty | Positive terminal claims only from observed facts (D-18/D-39); stale-honest freezes (D-25/D-43) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The upstream Invalid Date throw for mempool-resident signals originates in `@did-btcr2/method` signal processing after `provide()` (per Phase 3 UAT handoff); the exact throw site was not re-traced this session | Codebase Facts (D-46) | Guard placement may need to move from the `NeedBeaconSignals` seam to a catch in `driveResolution`; both options are in-repo, low blast radius |
| A2 | `#failCohort` settles first-wins (private implementation; CONTEXT audit verified against library source, not re-verifiable from `.d.ts`) | Verified Library Facts (timers) | D-38's design (throw before either timer) is safe under any ordering, so risk is copy accuracy only |
| A3 | Esplora duplicate-broadcast rejections are detectable enough to avoid false terminal failures in the D-41 retry (message-shape dependent per esplora implementation) | Pitfall 9 | Retry may occasionally report failure for an accepted tx; the confirm poll + anchor fold would still correct the record on confirmation |
| A4 | vitest's default include picks up new `packages/*/tests/*.spec.ts` without config changes | Validation Architecture | Wave 0 adds an explicit include if not; trivial |
| A5 | Large cohort-count list rendering without virtualization is acceptable (UI-SPEC unresolved item, single-box modest counts) | UI-SPEC carry-over | Revisit only if it bites; bounded retention caps the list |

## Open Questions

1. **Participant-side mid-round funding-signal vehicle (D-44, discretion)**
   - What we know: the frozen public anchor read is off-limits; candidates are the existing protocol SSE session (participant already holds a live transport session mid-round) or a new additive public read.
   - What's unclear: whether the library's participant transport surfaces a clean seam for an app-level notice without touching protocol internals.
   - Recommendation: planner picks the simplest honest vehicle; a tiny additive public GET (non-oracle, boolean-ish awaiting-funding state keyed by cohortId) mirrors the anchor-read precedent cleanly and avoids protocol-seam risk; the participant store already polls public reads post-seat.
2. **SERVICE_NAME carrier (D-51, discretion)**
   - `/v1/config` is the natural boot-constant carrier but is consumed by `fetchNetworkConfig` and pinned in specs; `/v1/status` is "exact-pinned" per CONTEXT. Adding an optional field to `/v1/config` is additive (existing pins likely assert fields present, not absence) - planner should verify `config.spec.ts` pin style before choosing.
3. **Live requirement ID naming (planning note 4)** - suggest LIVE-01 with success criteria distilled from D-35..D-46; REQUIREMENTS.md edit is part of planning output, not execution.

## Sources

### Primary (HIGH confidence)
- Installed `.d.ts` declarations, read this session: `@did-btcr2/aggregation@0.4.0` (`service/events.d.ts`, `service/service-runner.d.ts`, `service/service.d.ts`, `core/cohort.d.ts`, `core/phases.d.ts`, `core/signing-session.d.ts`, `participant/events.d.ts`), `@did-btcr2/method@0.51.0` (`core/beacon/beacon.d.ts`), `@did-btcr2/bitcoin@0.8.0` (`types.d.ts`)
- Repo source, read this session: `packages/service/src/{dashboard-sse,anchor-state,operator-cohorts,tx,broadcast,index,demo-server,resolve,hono-adapter}.ts`, `packages/web/src/{stores/operator.ts,lib/operator.ts}`, `e2e/{live-uat.ts,live-mock-cohort.ts}`, grep sweeps for SSE consumers and stall/funding seams
- `.planning/phases/04-operator-cohort-monitoring/04-CONTEXT.md` + `04-UI-SPEC.md` (approved contracts)

### Secondary (MEDIUM confidence)
- 04-CONTEXT.md audit findings cited where `.d.ts` cannot show private behavior (A2) or upstream internals (A1)

### Tertiary (LOW confidence)
- none (no web research was needed; the domain is fully in-repo/in-library)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - zero new packages; everything verified installed
- Library API facts: HIGH - read from installed declarations
- Architecture: HIGH - patterns generalize shipped, tested modules
- Pitfalls: HIGH for 1-8 (verified consumers/behavior); MEDIUM for 9 (esplora message shapes vary)
- Live-path timers/clamp: HIGH on the design constraint, MEDIUM on private settlement ordering (A2)

**Research date:** 2026-07-24
**Valid until:** ~2026-08-24 (stable: pinned library versions and in-repo facts; re-verify only if `@did-btcr2/*` versions bump)

