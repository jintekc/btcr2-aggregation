---
phase: 04-operator-cohort-monitoring
reviewed: 2026-07-27T00:00:00Z
depth: standard
files_reviewed: 52
files_reviewed_list:
  - docs/adr/0015-operator-authentication.md
  - docs/adr/0016-polled-monitoring-read-model.md
  - docs/DEPLOY.md
  - e2e/browser-operator.ts
  - e2e/browser-participant-cohort.ts
  - e2e/live-mock-cohort.ts
  - e2e/live-uat.ts
  - e2e/operator-cohort.ts
  - packages/service/src/anchor-state.ts
  - packages/service/src/broadcast.spec.ts
  - packages/service/src/broadcast.ts
  - packages/service/src/config.spec.ts
  - packages/service/src/demo-server.ts
  - packages/service/src/funding-watch.ts
  - packages/service/src/hono-adapter.ts
  - packages/service/src/index.ts
  - packages/service/src/monitor.ts
  - packages/service/src/operator-auth.spec.ts
  - packages/service/src/operator-auth.ts
  - packages/service/src/operator-boot.spec.ts
  - packages/service/src/operator-cohorts.spec.ts
  - packages/service/src/operator-cohorts.ts
  - packages/service/src/resolve.ts
  - packages/service/src/static-site.ts
  - packages/service/src/tx.ts
  - packages/service/tests/create-service-advert-ttl.spec.ts
  - packages/service/tests/funding-watch.spec.ts
  - packages/service/tests/live-boot.spec.ts
  - packages/service/tests/monitor.spec.ts
  - packages/service/tests/operator-cohorts-display.spec.ts
  - packages/service/tests/resolve-unconfirmed.spec.ts
  - packages/service/tests/tx-funding-wait.spec.ts
  - packages/web/src/components/browse/ServiceIdentityHeader.tsx
  - packages/web/src/components/cohort/CohortPage.tsx
  - packages/web/src/components/cohort/CompletionSummary.tsx
  - packages/web/src/components/LogPanel.tsx
  - packages/web/src/components/operator/CohortDetail.tsx
  - packages/web/src/components/operator/FundingStage.tsx
  - packages/web/src/components/operator/HealthStrip.tsx
  - packages/web/src/components/operator/OperatorCohortList.tsx
  - packages/web/src/components/operator/OperatorConsole.tsx
  - packages/web/src/components/operator/OperatorStageTimeline.tsx
  - packages/web/src/lib/config.ts
  - packages/web/src/lib/directory.ts
  - packages/web/src/lib/funding.ts
  - packages/web/src/lib/operator.ts
  - packages/web/src/stores/operator.ts
  - packages/web/src/stores/participant.spec.ts
  - packages/web/src/stores/participant.ts
  - packages/web/src/ui/primitives.tsx
  - packages/web/tests/directory-labels.spec.ts
  - packages/web/tests/first-update-note.spec.ts
  - packages/web/tests/operator.spec.ts
  - packages/web/tests/participant-seats.spec.ts
findings:
  critical: 2
  warning: 8
  info: 0
  total: 10
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-07-27
**Depth:** standard
**Files Reviewed:** 52
**Status:** issues_found

## Summary

Reviewed the operator monitoring phase adversarially, focused on the areas prior fleets
were least likely to have covered: cross-file contract drift between the server fold and
the client render, security of the new operator/public routes, resource lifecycle on
`service.stop()`, and mode-honest copy. The known-and-accepted upstream limitations,
the WR-01/WR-02 Phase-1 carry-forwards, and the bundle-size advisory were excluded per
the review brief.

Auth ordering is correct (`requireSameOrigin` then `requireOperator` mounted on the
`/v1/operator/*` prefix ahead of every gated route; login is body-limited and throttled
before parse). The public `/v1/anchor/:id` and `/v1/funding/:id` reads are genuinely
non-oracle and shape-guarded, the export `Content-Disposition` is built only from the
already-validated id, and `static-site.ts` correctly 404s `/v1/*` rather than shadowing
an unmounted operator route with the SPA shell (so `sessionProbe`'s 404 -> `disabled`
mapping is sound).

The two blockers are both **contract drift between correct server code and the client
that consumes it**: the monitor computes an honest `serviceHealth()` and an honest ended-cohort
taxonomy, and in both cases the browser throws the answer away and renders something else.
The health strip claims "Hermetic" on a service that is broadcasting real Bitcoin
transactions, and a cohort that successfully anchors disappears from the operator's cohort
list entirely (taking its drill-down and its JSON export with it). Neither is caught by the
existing e2e, which never navigates back from the drill-down and only runs hermetically.

The warnings cluster around the new live path: unbounded per-cohort maps, a funding wait
that keeps hitting esplora after `service.stop()`, a NaN env value that turns the boot
invariant off and makes the service emit a false "could not observe the chain" verdict, and
a fourth, divergent copy of the phase-set constant that the codebase itself declares must
stay in lockstep.

## Critical Issues

### CR-01: The operator health strip claims "Hermetic" on a live, broadcasting service

**File:** `packages/web/src/components/operator/HealthStrip.tsx:49-52`
**Also:** `packages/service/src/monitor.ts:1096-1110` (computed, never served),
`packages/service/src/hono-adapter.ts:402-407` (the merged operator read that should carry it)

**Issue:** `HealthStrip` hardcodes the broadcast mode:

```ts
// Mode is fixed to hermetic until the live-path plan 04-06 threads the real mode through the
// monitoring payload; the esplora chip below is gated on a live mode, so it stays hidden here.
const mode: ServiceMode = 'hermetic';
```

Plan 04-06 shipped the funding stage but never threaded the mode. The server side is complete
and unit-tested (`monitor.serviceHealth()` returns `{ mode, esploraReachable }`, and
`index.ts:795` flips the esplora bit from the funding watch), but `serviceHealth` is
**never exposed over HTTP** - a grep across the repo finds it only in `monitor.ts`, its own
`export` in `index.ts`, and `tests/monitor.spec.ts`. No route serves it and no client reads it.

Consequences, all of which the project's own "mode-honest UI copy" rule forbids:

1. An operator running `LIVE=1 BROADCAST=1` on **mainnet** sees a chip that says "Hermetic"
   at the top of every console screen, i.e. "this service does not touch the chain", while it
   is broadcasting real beacon transactions and asking them to fund real addresses. This is
   the single most consequential piece of copy on the operator surface and it is inverted.
2. D-43's esplora-reachability disclosure is unreachable: `isLive` is always `false`, so the
   "Esplora reachable" chip never renders in any mode, and a mid-flight esplora outage is
   invisible on the strip even though `noteEsploraObservation` is faithfully recording it.
3. `serviceHealth()` / `ServiceHealthDTO` are dead exported server code with passing unit
   tests, which is exactly the shape that makes a defect look "done".

The hermetic browser e2e (`e2e/browser-operator.ts`) cannot catch this: it only ever runs on
the fixture path, where "Hermetic" happens to be the right answer.

**Fix:** Serve the health in the already-merged gated read and consume it, rather than adding
a new route:

```ts
// packages/service/src/hono-adapter.ts
app.get('/v1/operator/cohorts', (c) =>
  c.json({
    cohorts: operatorCohorts.listCohorts(),
    monitoring: monitor
      ? { rows: monitor.summary(), metrics: monitor.serviceMetrics(), health: monitor.serviceHealth() }
      : undefined,
  }),
);
```

```ts
// packages/web/src/lib/operator.ts
export interface ServiceHealthDTO { mode: 'hermetic' | 'live-no-broadcast' | 'live'; esploraReachable: boolean | 'n/a'; }
export interface OperatorCohortsDTO {
  cohorts: OperatorCohortDTO[];
  monitoring?: { rows: CohortSummaryDTO[]; metrics: ServiceMetricsDTO; health: ServiceHealthDTO };
}
```

```tsx
// packages/web/src/components/operator/HealthStrip.tsx
const health = useOperator((s) => s.health);
// Until the first read lands, render no mode claim at all rather than presuming hermetic.
const mode = health?.mode;
const isLive = mode !== undefined && LIVE_MODES.includes(mode);
...
{mode ? <Badge tone="neutral">{MODE_LABEL[mode]}</Badge> : <Badge tone="neutral">Checking mode</Badge>}
{isLive ? (
  <Badge tone={health.esploraReachable === true ? 'good' : 'bad'}>
    {health.esploraReachable === true ? 'Esplora reachable' : 'Esplora unreachable'}
  </Badge>
) : null}
```

Store the health alongside `rows`/`metrics` in `refreshCohorts` (and clear it in `signOut`).
Add a live-mode assertion to `e2e/live-mock-cohort.ts` (or a component/store spec) so the
mode chip is pinned to the served value, not to a constant.

---

### CR-02: A cohort that successfully anchors vanishes from the operator cohort list (and takes its drill-down and export with it)

**File:** `packages/web/src/components/operator/OperatorCohortList.tsx:245-252`
**Also:** `packages/service/src/operator-cohorts.ts:528-554` (`listCohorts`),
`packages/service/src/operator-cohorts.ts:365-382` (`settleCompletion`),
`packages/service/src/monitor.ts:1152-1203` (`summary`, whose ended rows are discarded)

**Issue:** The list renders by iterating the operator's OWN cohorts and using the monitoring
rows only as a lookup:

```ts
const rowByCohort = new Map(rows.map((r) => [r.cohortId, r]));
for (const cohort of cohorts) {
  const chip = chipForCohort(cohort, rowByCohort.get(cohort.draftId));
  grouped[groupForChip(chip)].push(cohort);
}
```

But `listCohorts()` cannot return a successfully-completed cohort:

- `settleCompletion`'s success branch does `advertised.delete(cohortId)` with **no terminal
  record** (terminal records are created only when the completion *rejects*).
- `listCohorts()` = drafts + `directory()` + terminal(`expired`), and `directory()` requires
  both an `advertised` entry and a phase in `DISPLAY_PHASES`.

So the moment a cohort anchors, it leaves `cohorts` permanently. `monitor.summary()` still
emits its `anchored` / `fallback` / `failed` ended row, the client fetches it, and the render
loop silently drops it because there is no matching `cohorts` entry. Concretely:

1. The metrics row increments `anchored: 1` while **zero rows** exist for it. The operator sees
   a counter with nothing behind it.
2. The `CHIP` entries `anchored`, `failed`, `fallback` and the whole `groupForChip` "attention"
   branch for `failed`/`fallback` are **unreachable dead code**; the "Ended" group can only ever
   contain `expired` records, because `chipForCohort` short-circuits on `cohort.state`.
3. Drill-downs are SPA-internal with no routed URLs (D-03), reachable only from a list row. A
   cohort's per-cohort record, activity ring, and `Download monitoring record (JSON)` export
   therefore become **permanently unreachable the instant it succeeds** - the export is the one
   durable artifact of the run, and it is only offered while the operator is already inside the
   drill-down.
4. This directly contradicts the server module's own contract: `monitor.ts:288-296` states the
   ended record exists "so a cohort ... still projects an honest bounded fate instead of
   vanishing without a trace", and it is well covered at the monitor level
   (`tests/monitor.spec.ts:641-722`). Nothing tests the join, and `e2e/browser-operator.ts`
   never clicks "Back to cohorts", so the gap is invisible to the gate.

**Fix:** Render the union of the operator cohorts and the monitoring rows, keyed by id, so an
ended row with no operator-list counterpart still produces a row:

```tsx
const cohortById = new Map(cohorts.map((c) => [c.draftId, c]));
const grouped: Record<GroupKey, RenderRow[]> = { attention: [], active: [], drafts: [], ended: [] };

for (const cohort of cohorts) {
  const chip = chipForCohort(cohort, rowByCohort.get(cohort.draftId));
  grouped[groupForChip(chip)].push({ kind: 'cohort', cohort, row: rowByCohort.get(cohort.draftId) });
}
// Ended monitoring rows the operator list no longer carries (a cohort that ANCHORED leaves
// listCohorts: settleCompletion prunes it and mints no terminal record). Render them from the
// monitoring row alone so an anchored/failed cohort keeps its row, drill-down, and export.
for (const row of rows) {
  if (cohortById.has(row.cohortId)) continue;
  grouped[groupForChip(row.chip)].push({ kind: 'monitoring', row });
}
```

`CohortRow` needs a monitoring-only variant (id + chip + seats + reason; no beaconType/network/
threshold, which the monitoring DTO does not carry - render those fields conditionally rather
than inventing them). Keep `onOpen` wired for these rows so the drill-down and export stay
reachable. Extend `e2e/browser-operator.ts` with a "Back to cohorts" step asserting the anchored
row is present after completion.

## Warnings

### WR-01: The public funding signal keeps reporting `awaitingFunding: true` after the cohort has terminally lapsed

**File:** `packages/service/src/monitor.ts:1137-1150`
**Issue:** `publicFunding` returns `true` for any view whose `state` is `waiting` or
`awaiting-confirmation`, and never consults `view.terminal`. `index.ts:804-820` folds the
terminal verdict in as `{ ...last, terminal: 'window-closed' | 'blind-lapse' }` while leaving
`state` at its last-known (typically `waiting`) value. So after a cohort has failed for want
of funding, the anonymous `GET /v1/funding/:cohortId` read keeps telling every caller the
cohort is still awaiting funding - indefinitely, since nothing prunes `fundingViews`. Any
participant polling that id (`packages/web/src/stores/participant.ts:1322-1342`) renders
"Waiting for the operator to fund this cohort's beacon address" for a cohort that is already
dead. Their own `cohort-failed` teardown usually wins the race, but the public read itself is
dishonest and is the surface a second observer or a re-opened tab hits.
**Fix:**
```ts
const view = fundingViews.get(cohortId);
const awaitingFunding =
  view !== undefined &&
  view.terminal === undefined && // a lapsed cohort is no longer awaiting anything
  (view.state === 'waiting' || view.state === 'awaiting-confirmation');
```

### WR-02: Unbounded per-cohort maps on the live path (three in `createService`, one in the monitor with a comment claiming the opposite)

**File:** `packages/service/src/index.ts:540, 738, 741`; `packages/service/src/monitor.ts:629-633`
**Issue:** Every other per-cohort map in this phase is explicitly bounded at 24 with
oldest-first eviction (`MAX_MONITORED`, `MAX_TERMINAL`, `ACTIVITY_RING_SIZE`,
`anchor-state.ts` `remember`). These four are not:

- `advertisedAt` (`index.ts:540`): one entry per `cohort-advertised`, never deleted.
- `fundingWatches` (`index.ts:738`): deleted only in the `cohort-failed` handler. A cohort
  that SUCCEEDS leaves its (retired) handle in the map forever.
- `lastFundingView` (`index.ts:741`): written on every watch tick, never deleted on any path.
- `fundingViews` (`monitor.ts:633`), whose comment asserts "Unbounded is fine: one entry per
  live cohort, and the live cohort set is itself bounded by the runner's session." That is
  false: nothing removes an entry when a cohort leaves the session, and `index.ts:813` writes
  one more entry at `cohort-failed`. The claim is load-bearing (it is the stated reason no
  bound was added) and it does not hold.

Each entry retains a `FundingView` (beacon address, explorer URL, flags). On a long-lived
self-hosted service this is unbounded growth driven by an operator-triggerable action, in a
module family that treats exactly this as a DoS concern (T-04-01-02 / T-04-02-03 / T-06-02).
**Fix:** Delete `fundingWatches`/`lastFundingView`/`advertisedAt` entries on both terminal
paths (add a `signing-complete` cleanup beside the existing `cohort-failed` one), and bound
`fundingViews` with the same `remember`-and-evict idiom already used for `ended`:
```ts
function rememberFunding(cohortId: string, view: FundingView): void {
  fundingViews.delete(cohortId);
  fundingViews.set(cohortId, view);
  while (fundingViews.size > MAX_TERMINAL) {
    const oldest = fundingViews.keys().next().value;
    if (oldest === undefined) break;
    fundingViews.delete(oldest);
  }
}
```
and correct the comment on `fundingViews` either way.

### WR-03: The authoritative funding wait is not abortable, so it keeps hitting esplora after `service.stop()`

**File:** `packages/service/src/tx.ts:79-142` (`waitForFunding`), `packages/service/src/tx.ts:55-62` (`fundingSleep`)
**Issue:** `service.stop()` (`index.ts:888-903`) carefully aborts the broadcast confirm poll
and every display funding watch, but `waitForFunding` takes no `AbortSignal`: `fundingSleep`
has no signal parameter and the loop's only exit conditions are `funded` / `dead-end` / the
deadline. After `stop()` the in-flight `onProvideTxData` promise keeps calling
`bitcoin.rest.address.getUtxos()` every `fundingPollIntervalMs` for up to the full funding
window (default 12 min; 15 min in the live-UAT harness). The unref'd timer means the process
can still exit, but a stopped service continues issuing outbound esplora requests, and a test
that stops and restarts services leaks network I/O across cases. The comment
("the runner settles the cohort on stop") explains why the promise is abandoned but not why the
polling continues.
**Fix:** Thread the same controller `index.ts` already owns for the display watches:
```ts
export interface LiveTxConfig {
  // ...
  /** Aborts the funding wait (wired to `service.stop()`), mirroring the display watch. */
  signal?: AbortSignal;
}

while (Date.now() - start < deadlineMs) {
  if (live.signal?.aborted) {
    throw new Error('live beacon tx: the service stopped while waiting for funding');
  }
  ...
  await fundingSleep(pollIntervalMs, live.signal);
}
```
Reuse the cancelable `delay` idiom from `funding-watch.ts:194-215` for `fundingSleep`.

### WR-04: A malformed `FUNDING_WINDOW_MS` silently disables the boot invariant and makes the service emit a false "could not observe the chain" verdict

**File:** `packages/service/src/demo-server.ts:341-355`
**Also:** `packages/service/src/funding-watch.ts:138-155`, `packages/service/src/tx.ts:95, 137-141`
**Issue:** `Number(process.env.FUNDING_WINDOW_MS)` yields `NaN` for any non-numeric value
(`FUNDING_WINDOW_MS=12m`, a stray quote, a typo). Trace it:

1. `if (useBroadcast && phaseTimeoutMs <= fundingWindowMs)` - any comparison against `NaN` is
   `false`, so the D-38 fail-fast boot invariant is silently skipped. The service boots.
2. `computeFundingDeadline({ configuredWindowMs: NaN, ... })` -> `windowLeg = NaN` ->
   `Math.min(NaN, ttlLeg) = NaN`, and `Number.isFinite(ttlLeg) && ttlLeg < NaN` is `false`, so
   no truncation is disclosed either.
3. `while (Date.now() - start < NaN)` is `false` on the first evaluation, so `waitForFunding`
   **never polls once**, falls straight through with `lastObservationOk = false`, and throws the
   blind-lapse message: *"the funding window ... ended while this service could not observe the
   chain, so whether it was funded is unknown; check the address on a block explorer before
   reusing it."*

That message is a lie in the strictest sense the D-39 honesty rule cares about: the service did
not fail to observe the chain, it never tried. Every cohort dies instantly with a verdict that
sends the operator to a block explorer to investigate a non-existent chain problem. This is a
new Phase-4 env knob, distinct from the known WR-02 carry-forward, though it is the same class:
`OPERATOR_SESSION_TTL_MS` (`demo-server.ts:384-386`) has the identical hazard with a worse
outcome - `expiresAt = Date.now() + NaN` makes `Date.now() > NaN` always false, so **sessions
never expire**, and `maxAge: Math.floor(NaN / 1000)` emits an invalid `Max-Age=NaN` cookie
attribute.

Note `advertTtlMs` already has exactly the right guard (`index.ts:525-528`, with a dedicated
NaN spec at `tests/create-service-advert-ttl.spec.ts:90`), so the pattern is established and
was simply not applied to the new knobs.
**Fix:** Add a shared numeric-env parser and use it for every `Number(process.env.*)` in
`demo-server.ts`:
```ts
/** Parse a positive-integer env knob; a malformed/non-positive value falls back to `fallback`. */
function envMs(name: string, raw: string | undefined, fallback: number | undefined): number | undefined {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[demo] ignoring malformed ${name}="${raw}"; using ${fallback ?? 'the built-in default'}`);
    return fallback;
  }
  return n;
}
```
Apply to `FUNDING_WINDOW_MS`, `OPERATOR_SESSION_TTL_MS`, `COHORT_TTL_MS`, `PHASE_TIMEOUT_MS`,
`MIN_PARTICIPANTS`, and `PORT`. Defensively, also make `computeFundingDeadline` coerce a
non-finite `configuredWindowMs` to `Infinity` so a programmatic caller cannot reproduce the
false blind-lapse.

### WR-05: The drill-down stage timeline uses a fourth, divergent copy of the phase set and shows "Submissions" while a cohort is mid-co-sign

**File:** `packages/web/src/components/operator/OperatorStageTimeline.tsx:33-35`
**Issue:** `CO_SIGN_PHASES` here is `{SigningStarted, NoncesCollected, AwaitingPartialSigs}` -
it omits the four funding-wait phases (`UpdatesCollected`, `DataDistributed`, `Validated`,
`FallbackRequested`) that `operator-cohorts.ts:96-104`, `monitor.ts:102-110`, and
`web/src/lib/directory.ts:45-53` were all deliberately widened to include (the SVC-JOIN-2
fix). On a **hermetic** cohort sitting in `Validated` / `UpdatesCollected` /
`DataDistributed` with nonces not yet observed, `deriveOperatorStage` bumps only to
`submissions`, so the drill-down's primary visual anchor reports the cohort is collecting
submissions while it is actually mid-signing. On the live path the `detail.funding` bump masks
it; on the hermetic path (the default, and the one the e2e exercises) it is visible.

More broadly: the phase set now exists in four places with no shared source and no test that
pins them equal, while `monitor.ts:89-91` states the sets "MUST stay in lockstep or the console
contradicts the public directory". `directory-labels.spec.ts` and
`operator-cohorts-display.spec.ts` each re-declare their own literal array, so a fifth copy
drifting would go green.
**Fix:** Include the funding-wait phases in `CO_SIGN_PHASES`, and remove the duplication at the
same time by exporting one set from `@btcr2-aggregation/shared` (it is already the home of the
cross-package network/cohort vocabulary):
```ts
// packages/shared/src/index.ts
export const OPEN_PHASES = new Set<string>(['Advertised', 'CohortSet', 'CollectingUpdates']);
export const IN_FLIGHT_PHASES = new Set<string>([
  'SigningStarted', 'NoncesCollected', 'AwaitingPartialSigs',
  'UpdatesCollected', 'DataDistributed', 'Validated', 'FallbackRequested',
]);
```
and import it in `operator-cohorts.ts`, `monitor.ts`, `web/src/lib/directory.ts`, and
`OperatorStageTimeline.tsx`. If a shared export is undesirable, add a lockstep spec that
imports all copies and asserts set equality.

### WR-06: The per-cohort JSON export fails silently on a 401 or a fault

**File:** `packages/web/src/lib/operator.ts:399-426`; `packages/web/src/components/operator/CohortDetail.tsx:340`
**Issue:** `downloadExport` returns `false` on any non-ok response or thrown fetch, and the
caller discards it: `onClick={() => void downloadExport(baseUrl, cohortId)}`. When the operator
session has expired (the exact case D-16 built a whole discriminated `FetchResult` vocabulary
for), clicking "Download monitoring record (JSON)" does **nothing at all**: no download, no
error, no re-login, no log line. The operator has no way to distinguish "the export failed"
from "my browser ignored the click", and the session-expiry path that every other operator
read handles is bypassed here.

Secondary: `URL.revokeObjectURL(url)` runs in a `finally` in the same tick as `a.click()`.
Firefox and Safari can abort a download whose object URL is revoked before the transfer starts;
MDN's own example defers the revoke.
**Fix:** Give the export the same discriminated result as the other gated reads and route a 401
through the store's session-expiry branch:
```ts
export async function downloadExport(baseUrl: string, id: string): Promise<FetchResult<true>> {
  let res: Response;
  try { res = await fetch(/* ... */); } catch { return { kind: 'unreachable' }; }
  if (res.status === 401) return { kind: 'unauthorized' };
  if (!res.ok) return { kind: 'unreachable' };
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `cohort-${id}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  // Defer the revoke: revoking in the same tick can abort the transfer in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { kind: 'ok', value: true };
}
```
Add an `exportCohort(baseUrl, id)` store action that surfaces `SESSION_EXPIRED` on
`unauthorized` and a bad-tone message on `unreachable`. The same applies to `discardDraft`
(`lib/operator.ts:429-435`), which ignores its response entirely, so a failed discard looks
identical to a successful one until the next list refresh.

### WR-07: The live-UAT harness hardcodes a default operator password and disables the `Secure` cookie flag

**File:** `e2e/live-uat.ts:75, 108`
**Issue:** `const operatorPassword = process.env.OPERATOR_PASSWORD ?? 'live-uat';` combined with
`operatorCookieSecure: false`, and the password is then printed to stdout. Exposure is limited
(the harness pins `host: '127.0.0.1'` and is opt-in), but this is a committed default
credential for an operator control plane in a repo whose top constraint is "no unauthenticated
mutating/control surface", and the harness boots the real product path with `BROADCAST=1`. A
future edit that lifts the host binding (or a run behind a permissive local proxy / a shared
dev box) turns it into an open control plane with a documented password.
**Fix:** Require the password explicitly rather than defaulting it:
```ts
const operatorPassword = process.env.OPERATOR_PASSWORD;
if (!operatorPassword) {
  throw new Error('live-uat: set OPERATOR_PASSWORD (no default is provided for an operator control plane)');
}
```
Keep `operatorCookieSecure: false` (correct for plain-http localhost) but assert the bind host
is loopback in the same guard so the insecure-cookie mode cannot ride an off-host bind.

### WR-08: Deploy config still advertises the retired `/dashboard/events` telemetry feed

**File:** `docker-compose.yml:42` (drift introduced by this phase's ADR-0016 retirement; `docs/DEPLOY.md` is already clean)
**Issue:** The `OPERATOR_PASSWORD` comment block still tells the self-hoster that without a
password "the operator console, mutating cohort routes, and /dashboard/events are disabled".
`/dashboard/events` no longer exists in any form (ADR 0016 supersedes ADR 0004;
`dashboard-sse.ts` and `stores/dashboard.ts` were deleted in this phase). A self-hoster reading
compose as the env reference is told about a route they can neither enable nor reach, and it
implies an SSE surface still exists to secure.
**Fix:** Update the comment to name the surfaces that actually exist:
```yaml
      # ... the operator console, the mutating cohort routes, and the gated monitoring
      # reads (GET /v1/operator/cohorts and /v1/operator/cohorts/:id) are disabled with a
      # loud boot warning. Never commit a real password.
```
While there, add the `SERVICE_NAME`, `BROADCAST`, `FUNDING_WINDOW_MS`, and
`LIVE_CHANGE_ADDRESS` knobs (all documented in `docs/DEPLOY.md:253-265`) so compose stays the
complete env reference it claims to be.

---

_Reviewed: 2026-07-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
