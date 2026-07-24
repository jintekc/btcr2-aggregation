# Phase 4: Operator Cohort Monitoring - Pattern Map

**Mapped:** 2026-07-24
**Files analyzed:** 20 (new + modified + deleted)
**Analogs found:** 18 / 20 (2 files have no in-repo analog; both are honest-copy/scoping deliverables)

This map is grounded in the audit-verified facts of 04-CONTEXT.md and 04-RESEARCH.md. Every backend fold, watch predicate, gated route, and store poll below copies a proven in-repo pattern. The phase's risk is integration ordering (SSE-retirement pins, funding clamp, three-store consistency), not novel construction: the planner should treat each analog as the literal starting point.

Line numbers reference the files as read this session.

## File Classification

### Backend (packages/service)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/service/src/monitor.ts` (NEW) | service (per-service closure factory) | event-driven fold -> polled read | `packages/service/src/anchor-state.ts` + `operator-cohorts.ts` | exact (pattern generalized from two shipped folds) |
| `packages/service/src/funding-watch.ts` (NEW, may fold into monitor.ts) | service | streaming (poll loop) -> state predicate | `packages/service/src/tx.ts` pre-flight + `broadcast.ts` poll loop | role+flow match |
| `packages/service/src/tx.ts` (MOD) | service | request-response (onProvideTxData callback) | itself (extend the live branch in place) | in-place |
| `packages/service/src/broadcast.ts` (MOD) | service | event-driven (broadcast + confirm) | itself (bounded retry around the existing send) | in-place |
| `packages/service/src/demo-server.ts` (MOD) | config / entry point | boot | itself (env passthrough beside existing `useLive`/`allowMainnet`) | in-place |
| `packages/service/src/resolve.ts` (MOD) | service | request-response (resolve driver) | itself (guard the `NeedBeaconSignals` seam) | in-place |
| `packages/service/src/hono-adapter.ts` (MOD) | route/adapter | request-response | its own gated `/v1/operator/*` block (lines 331-399) | exact |
| `packages/service/src/index.ts` (MOD) | provider (composition root) | wiring | itself (side-effect listener wiring + re-export cleanup) | in-place |
| `packages/service/src/dashboard-sse.ts` (DELETE) | - | - | - | retire (D-02/D-19); migrate consumers per planning note 1 |

### Frontend (packages/web)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/web/src/lib/operator.ts` (MOD) | utility (fetch client) | request-response | itself (add discriminated results + new read/export endpoints) | in-place |
| `packages/web/src/stores/operator.ts` (MOD) | store (Zustand) | polled state machine | itself + `stores/participant.ts` poll/view pattern | in-place |
| `packages/web/src/components/operator/CohortDetail.tsx` (NEW) | component | request-response (renders polled DTO) | `components/operator/OperatorCohortList.tsx` + `components/cohort/StageTimeline.tsx` | role match |
| `packages/web/src/components/operator/HealthStrip.tsx` (NEW) | component | request-response | `components/operator/PublicStatus.tsx` | role+flow match |
| `packages/web/src/components/operator/FundingStage.tsx` (NEW) | component | request-response | `components/operator/PublicStatus.tsx` + anchor-detail treatment | role match |
| `packages/web/src/components/operator/OperatorConsole.tsx` (MOD) | component | view-state routing | itself (list-first shell + New-cohort button) | in-place |
| `packages/web/src/stores/participant.ts` (MOD) | store | polled state machine | itself (validation-requested listener ~line 1117) | in-place |
| `packages/web/src/components/cohort/CohortPage.tsx` (MOD) | component | request-response | itself (stall copy + join notice) | in-place |
| `packages/web/src/components/dashboard/*` + `stores/dashboard.ts` (DELETE) | - | - | - | retire (D-02) |

### Tests + e2e

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/service/tests/monitor.spec.ts` (NEW) | test | - | `packages/service/src/anchor-state.spec.ts` | role match (NEW tests live in `tests/`, not co-located) |
| `packages/service/tests/funding-watch.spec.ts` (NEW) | test | - | `packages/service/src/live-tx.spec.ts` | role match |
| `packages/service/tests/tx-funding-wait.spec.ts` (NEW) | test | - | `packages/service/src/live-tx.spec.ts` | role match |
| `packages/service/src/broadcast.spec.ts` (MOD) | test | - | itself (rewrite off `bridgeRunnerToSse` onto the `BeaconBroadcaster` emitter) | in-place (Pitfall 1) |
| `e2e/live-mock-cohort.ts` (MOD) | test harness | - | itself (stateful `[]`-then-funded `mockBitcoin`) | in-place |
| `e2e/live-uat.ts` (FORMALIZE) | test harness | - | itself (uncommitted; reshape to env-passthrough boot) | in-place |
| `e2e/browser-operator.ts` (NEW) | test harness | - | `e2e/browser-cohort.ts` | role match |

**No analog (use RESEARCH.md / honest-copy conventions):** the D-54 scoping one-pagers under `.planning/` (pure docs) and the new ADR superseding 0004 (follows the `docs/adr/000N-*.md` sequence, not a code pattern).

## Pattern Assignments

### `packages/service/src/monitor.ts` (NEW - service, event-driven fold -> polled read)

**Primary analog:** `packages/service/src/anchor-state.ts` (the bounded-fold template)
**Secondary analog:** `packages/service/src/operator-cohorts.ts` (settleCompletion + terminal record + listCohorts merge target)

**Closure-factory + bounded-evict pattern to copy** (`anchor-state.ts` lines 93-127):
```typescript
export function createAnchorState(broadcaster?: BeaconBroadcaster, network?: NetworkConfig): AnchorState {
  const enabled = Boolean(broadcaster);
  const entries = new Map<string, AnchorEntry>();

  /** Store/refresh a cohort's entry, evicting the oldest record past the cap. */
  function remember(cohortId: string, entry: AnchorEntry): void {
    // Re-set moves the key to the end of insertion order, so a progressing cohort stays fresh.
    entries.delete(cohortId);
    entries.set(cohortId, entry);
    while (entries.size > MAX_TERMINAL) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  if (broadcaster) {
    broadcaster.on('beacon-broadcast', ({ cohortId, txid }) => remember(cohortId, { state: 'broadcast', txid }));
    // ... one subscribe per input event ...
  }
  return { read(cohortId) { /* pure O(1) projection, non-oracle default */ } };
}
```

**Rules this file MUST carry from the analogs (verified this session):**
- `const MAX_TERMINAL = 24;` (anchor-state.ts:70, operator-cohorts.ts:298) - reuse the cap for ended records AND per-cohort activity rings (D-23).
- Per-service closure factory, never a module singleton (anchor-state.ts:18-22 rationale) - two services in one test process must not share state.
- Wall-clock stamp (`Date.now()`) at event receipt: the runner supplies NO timestamps (D-22; research verified `update-received` has no timestamp).
- Capture ended-record facts AT EVENT TIME on `cohort-failed` / `signing-complete` / the completion rejection, because `session.removeCohort` GCs live accessors afterward (Pitfall 2; planning note 6).
- Non-oracle read default (anchor-state.ts:131-133): unknown/never-existed/evicted read identically.
- Explorer URL derived under local try/catch (anchor-state.ts:139-145) so a bad network never throws on a read.

**Failure-reason channel to consume** (`operator-cohorts.ts` lines 346-363, `settleCompletion`): the `error` runner event carries NO cohortId (research-verified), so take per-cohort failure reasons from the completion-promise rejection exactly as `settleCompletion` already does. The monitoring summary read MERGES with `operatorCohorts.listCohorts()` (operator-cohorts.ts:509-535) at the route/DTO layer - do NOT fork a parallel cohort list (D-15).

**Serializer reference:** lift `dashboard-sse.ts`'s `serialize()` / `summarizeTx` (hex-encodes Uint8Array pubkeys, guards the fixture-tx `fee` throw) BEFORE deleting that file - it is the reference for payload shapes.

---

### `packages/service/src/funding-watch.ts` (NEW - service, poll loop -> state predicate)

**Analog:** `packages/service/src/tx.ts` pre-flight (lines 80-115) - the ONE selection convention the watch must reuse.

**Selection + floor logic to copy verbatim in shape** (`tx.ts` lines 96-115):
```typescript
import { selectSpendableUtxo } from '@did-btcr2/method';
// ...
let selected;
try {
  selected = selectSpendableUtxo(utxos, beaconAddress);
} catch (err) {
  // NO_SPENDABLE_BEACON_UTXO: library reason distinguishes all-unconfirmed vs all-dust.
}
if (selected.value < MIN_LIVE_FUNDING_SATS) {
  // Topping up CANNOT fix this: the builder always spends the DEEPEST UTXO (dead-end, D-37).
}
```

**Predicate rule (audit-critical, D-36):** both the advance check and the dead-end check run `selectSpendableUtxo` over the polled UTXO set and compare THE SELECTED UTXO against the suggested minimum. NEVER an existence check (`utxos.length` / `.some(confirmed)`). Map states: empty -> `waiting`; selection failure with any unconfirmed -> `awaiting-confirmation`; selection failure all-dust -> `waiting` (topping over dust is fixable, planning note 8); selected `< min` -> terminal `dead-end`; selected `>= min` -> `funded`. See RESEARCH Pattern 2 for the exact `classifyFunding` skeleton.

**Suggested minimum** = `max(MIN_LIVE_FUNDING_SATS, fee-derived need)` where `export const MIN_LIVE_FUNDING_SATS = 2000;` (tx.ts:37). ONE number drives displayed ask, watch threshold, pre-flight floor, and dead-end band (D-37).

**Poll-loop + cancelable-sleep pattern** (`broadcast.ts` lines 99-159): copy the `delay(ms, signal)` unref'd/abortable sleep (broadcast.ts:99-122) and the `while (Date.now() < deadline && !signal?.aborted)` loop (broadcast.ts:151-159) for the watch's polling cadence. Track `lastObservationOk` alongside state for D-39 blind-lapse honesty (a terminal "funding never arrived" verdict requires the LAST read to be a successful empty observation).

---

### `packages/service/src/tx.ts` (MOD - funding wait clamp inside onProvideTxData)

**In-place extension** of `makeProvideTxData`'s live branch (lines 80-129). The D-38 funding WAIT wraps the existing pre-flight: before `buildAggregationBeaconTx`, poll + `classifyFunding` until `funded`, or throw the specific reason on lapse.

**Clamp mechanics (audit-critical, D-38, planning note 7):**
```typescript
const deadlineMs = Math.min(configuredWindowMs, remainingCohortTtlMs - slackMs);
// throw from INSIDE this callback BEFORE phaseTimeoutMs (fresh budget on entering Validated)
// or cohortTtlMs (armed at advertise, never reset) can fire, so the specific reason wins #failCohort:
throw new Error('live beacon tx: funding never arrived for ' + beaconAddress + ' ...');
```
The existing dead-end throw (tx.ts:105-115) already encodes the "topping up cannot fix this" copy - preserve its wording for D-37's dead-end state.

---

### `packages/service/src/broadcast.ts` (MOD - bounded send retry, D-41)

**In-place** around the single send in `broadcastAndConfirm` (line 143: `const txid = await bitcoin.rest.transaction.send(rawHex);`). Today one-shot; wrap with bounded backoff retry retaining `rawHex` (already in scope). Reuse the `delay(ms, signal)` helper (lines 99-122) for backoff.

**Pitfall 9 (must honor):** treat esplora duplicate-acceptance rejections ("already in mempool/chain") as success; emit `beacon-broadcast` exactly ONCE; keep the `BeaconAnchorEvents` frame SHAPES (lines 12-28) byte-unchanged (anchor-state folds them, D-26); distinguish "network unreachable at send time" in the exhaustion reason string.

---

### `packages/service/src/demo-server.ts` (MOD - boot env passthrough, D-35/D-38/D-40)

**In-place** beside the existing env resolution (verified this session):
```typescript
const useLive = opts.live ?? process.env.LIVE === '1';            // line 238 (unchanged meaning)
const allowMainnet = opts.allowMainnet ?? process.env.ALLOW_MAINNET === '1'; // line 243
const recoveryKey = opts.recoveryKey ?? process.env.RECOVERY_KEY;  // line 255
```
The `createService({...})` call (lines 317-337) TODAY passes `bitcoin` but never `live`/`broadcast`/`changeAddress`/confirm knobs (research-verified gap). Add: `BROADCAST=1` (requires `LIVE=1`, refuse otherwise) -> pass `{live: true, broadcast: true}`; `LIVE_CHANGE_ADDRESS` into `changeAddress`; a `FUNDING_WINDOW_MS`-style var. Copy the loud-banner + guard-rail idiom already present for mainnet (lines 244-260, the `log(...)` real-money warnings) for the live+broadcast boot banner and the RECOVERY_KEY-absent warn (D-40). Add the fail-fast boot invariant `PHASE_TIMEOUT_MS > funding window` (D-38). Env vars are the operator contract (costly reversibility) - name them carefully and document in DEPLOY.md (D-52).

---

### `packages/service/src/hono-adapter.ts` (MOD - new gated reads + export; delete SSE mount)

**Analog:** its own operator block (lines 331-399, read this session). New reads inherit `requireSameOrigin()` + `requireOperator(...)` purely by mounting INSIDE `if (operatorAuth) { ... }` AFTER the prefix guards (lines 332, 340). Registration order is load-bearing (Hono matches in order).

**Gated-read pattern to copy** (lines 375-379):
```typescript
app.get('/v1/operator/cohorts', (c) => c.json({ cohorts: operatorCohorts.listCohorts() }));
app.delete('/v1/operator/cohorts/:id', (c) => {
  const ok = operatorCohorts.discardDraft(c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'unknown draft' }, 404);
});
```
Add: `GET /v1/operator/cohorts/:id` (detail read, poll while drill-down open), `GET /v1/operator/cohorts/:id/export` (D-34 JSON download - set Content-Disposition, no user-controlled header content). Merge the monitoring summary into the existing `GET /v1/operator/cohorts` (D-20). Validate the `:id` param cheaply BEFORE map lookups (cf. the anchor read's `/^[0-9a-zA-Z-]{1,64}$/` guard, line 317); return uniform 401 before any id lookup for anonymous callers (no existence oracle).

**Deletion:** remove the `/dashboard/events` mount (lines 405-412) and the `dashboard-sse` import. Move the Phase 3 negative-auth 401 evidence onto the new gated reads (planning note 1). Public block (lines 246-321) stays byte-untouched (D-26).

---

### `packages/service/src/index.ts` (MOD - wiring + re-export cleanup)

**In-place.** Wire `createCohortMonitor(...)` as a side-effect listener alongside the existing `createAnchorState` / `attachBeaconBroadcast` / `settleCompletion` wiring (per Component Responsibilities). Remove the `bridgeRunnerToSse` / `DashboardExtras` re-export (planning note 1). Fire-and-forget `.catch()` discipline: a monitoring listener failure must never disturb the protocol (existing house rule).

---

### `packages/service/src/resolve.ts` (MOD - unconfirmed-signal guard, D-46)

**In-place** at the `satisfyNeed` `NeedBeaconSignals` seam (research-verified). Detect the mempool-resident-signal condition (upstream `@did-btcr2/method` Invalid Date throw) and return an honest retryable outcome ("a beacon signal is awaiting confirmation - resolve again after it confirms") instead of a 500. The route handler currently 502-generics all resolve failures, so the guard must produce a DISTINGUISHABLE outcome. No library fork (adopt the upstream fix when released).

---

### `packages/web/src/lib/operator.ts` (MOD - discriminated fetch results, D-16/D-25)

**Analog:** itself. Today `listCohorts` throws a generic Error on `!res.ok` (lines 149-160, no 401 branch). Replace with a discriminated union (RESEARCH Pattern 4):
```typescript
type FetchResult<T> = { kind: 'ok'; value: T } | { kind: 'unauthorized' } | { kind: 'unreachable' };
```
Follow the EXISTING status-branching precedent already in this file (`sessionProbe` lines 48-61 maps 200/404/else; `login` lines 21-30 returns status). Keep the same-origin `credentials: 'same-origin'` + `AbortSignal.timeout(TIMEOUT_MS)` conventions (lines 10, 27). Add the detail-read + export endpoints mirroring the existing `endpoint(baseUrl, path)` helper (line 12).

---

### `packages/web/src/stores/operator.ts` (MOD - poll loop, view state, 401 discrimination)

**Analog:** itself + `stores/participant.ts`. Today `refreshCohorts` (lines 144-152) swallows ALL failures status-blind - the exact D-16/D-25 gap (planning note 3, research-verified). Rekey it onto the discriminated result: `unauthorized` -> `auth: 'logged-out'` + session-expired copy (D-16); N consecutive `unreachable` -> frozen state + banner + quiet retry (D-25); freshness timestamp updates only on `ok`.

**View-state pattern to add** (mirrors `participantView`, D-03/D-20): `view: {kind:'list'} | {kind:'detail'; cohortId}`; the detail read polls ONLY while a drill-down is open (start on open, stop on back). Reuse the existing transient-message idiom (lines 174-182, the `setTimeout` self-clearing `advertiseMessage`) for confirmations. Keep the copy conventions already in the file: spaced hyphens not em-dashes (line 35 `ADVERTISED_OK`), and the `UNREACHABLE` string (line 44).

---

### `packages/web/src/components/operator/*` (NEW/MOD - console rework)

**Analogs (verified present):** `OperatorConsole.tsx`, `OperatorCohortList.tsx`, `CreateCohortForm.tsx`, `LoginPanel.tsx`, `PublicStatus.tsx`, plus `components/cohort/StageTimeline.tsx` and `LogPanel.tsx`. Build ALL new components from `ui/primitives.tsx` (Card, Button, Badge, StatusDot, SectionTitle, Mono, CopyField, Input, Select, Field) - no new component/icon library (UI-SPEC contract). The drill-down stage timeline mirrors `components/cohort/StageTimeline.tsx`; the activity log reuses `LogPanel.tsx`; member DID display uses the Mono/CopyField shortened-display + copy-full treatment (D-28); the plain-first + technical `Expander` (promoted from `CompletionSummary.tsx`) hosts pubkeys/raw JSON (D-12/D-28/D-30). Exact copy comes verbatim from 04-UI-SPEC.md (em-dash-free).

---

### `packages/web/src/stores/participant.ts` + `components/cohort/CohortPage.tsx` (MOD - D-44/D-45)

**In-place.** A `validation-requested` listener already exists (~line 1117, research-verified). D-45: record it as a store fact and rekey the stall copy - "submitted + never validation-requested" = positive "stalled collecting updates"; "submitted + validation-requested + unsigned" = "co-signing could not complete; this service didn't say why". Do NOT key stall copy on submitted-but-unsigned alone (the predicate that misfired in UAT). D-44: add the join-time live notice + awaiting-funding waiting copy. The public anchor read (`lib/anchor.ts`) stays byte-untouched - the mid-round funding-signal vehicle is a planning choice (protocol SSE session vs a tiny additive public read; RESEARCH Open Question 1 recommends the additive read).

---

### Tests (NEW in `packages/service/tests/`, MOD `broadcast.spec.ts`)

**NEW spec files live in `packages/service/tests/`, NOT co-located** (MEMORY: feedback-tests-outside-src). Analog test style: `anchor-state.spec.ts` (fold + eviction assertions), `live-tx.spec.ts` (mock-connection live-path assertions). `broadcast.spec.ts` MUST be rewritten off `bridgeRunnerToSse` onto the `BeaconBroadcaster` emitter directly IN THE SAME CHANGE as the SSE deletion (Pitfall 1). Migrate `operator-boot.spec.ts` 404/401 pins and `e2e/operator-cohort.ts` negative-auth 401 pin onto the new gated reads.

---

## Shared Patterns

### Bounded in-memory retention (cap-and-evict)
**Source:** `packages/service/src/anchor-state.ts:97-110` and `operator-cohorts.ts:326-335` (`rememberTerminal`)
**Apply to:** the monitoring module's ended-record store AND every per-cohort activity ring.
```typescript
const MAX_TERMINAL = 24;
function remember(cohortId: string, entry: Entry): void {
  entries.delete(cohortId);          // re-set keeps a progressing cohort eviction-fresh
  entries.set(cohortId, entry);
  while (entries.size > MAX_TERMINAL) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}
```
Three 24-cap stores now coexist (anchor-state, operator-cohorts expired, new monitoring ended); the merged summary read must present ONE consistent row per cohort (monitor's ended record wins for display; the expired reason folds in) - Claude's discretion topology (D-27).

### Per-service closure factory (no module singletons)
**Source:** `anchor-state.ts:93`, `operator-cohorts.ts:300`, and the `index.ts` `seatedRosterKeys`/`genesisStaging` scoping
**Apply to:** `monitor.ts`, `funding-watch.ts` - all state is closure-scoped so two services in one test process never share it.

### Operator gating by mount location (ADR 0015)
**Source:** `hono-adapter.ts:331-340` (`if (operatorAuth) { requireSameOrigin(); ...; requireOperator(...) }`)
**Apply to:** every new monitoring read + the export. They inherit both guards by mounting inside the block after the prefix guards. Public DTOs (`/v1/directory`, `/v1/status`, `/v1/anchor/:cohortId`) stay byte-frozen (D-26).

### Opt-in behind loud guard rails (ADR 0010)
**Source:** `demo-server.ts:243-260` (mainnet opt-in `log(...)` warnings)
**Apply to:** `BROADCAST=1` layering, the live+broadcast boot banner, and the RECOVERY_KEY-absent warn (D-35/D-40/D-42).

### Fire-and-forget side-effect listeners
**Source:** `operator-cohorts.ts:346-363` (`settleCompletion` trailing `.catch()`); the `index.ts` persist/broadcast listeners
**Apply to:** the monitoring listener and the funding watch - a failure there must NEVER disturb the protocol.

### Cancelable, unref'd poll loop
**Source:** `broadcast.ts:99-159` (`delay(ms, signal)` + the `while (Date.now() < deadline && !signal?.aborted)` loop)
**Apply to:** the funding watch poll loop and the broadcast send-retry backoff.

### Truthful, mode-honest copy (repo-wide hard rule)
**Source:** `anchor-state.ts:42-57` DTO doc (generic failure reason, `enabled` mode bit, non-oracle `state:'none'`); `operator.ts` store copy constants
**Apply to:** all funding-stage, anchor-detail, and stall copy. Positive terminal claims only from observed facts (D-18/D-39); "Anchored" only when confirmed; NO em-dash characters anywhere (checker-blocked; use spaced hyphens as the existing store copy does).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/todos/.../` D-54 scoping one-pagers (3) | docs | - | Decision one-pagers (problem/options/scope/dependencies); pure planning prose, no code pattern |
| `docs/adr/00NN-polled-monitoring-read-model.md` (NEW ADR, D-53) | docs | - | Follows the `docs/adr/000N-*.md` sequence + supersedes-header convention (see 0004/0010/0015), not a source-code analog |

The library facts these lean on (partial-sig gap D-32, unconfirmed-signal D-46) are handled by honest copy + service-side guards, never a library fork - RESEARCH.md is the reference for the exact API surface.

## Metadata

**Analog search scope:** `packages/service/src/` (anchor-state, operator-cohorts, tx, broadcast, hono-adapter, demo-server), `packages/web/src/{lib,stores,components/operator,components/dashboard}/`, `e2e/`.
**Files scanned this session:** anchor-state.ts, operator-cohorts.ts, tx.ts, broadcast.ts, hono-adapter.ts (mount blocks), lib/operator.ts, stores/operator.ts, demo-server.ts (env), plus directory listings for web operator/dashboard components and service specs.
**Pattern extraction date:** 2026-07-24
