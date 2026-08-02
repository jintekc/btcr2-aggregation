---
phase: 05-operator-cohort-lifecycle-control
reviewed: 2026-08-02T00:00:00Z
depth: deep
files_reviewed: 10
files_reviewed_list:
  - packages/web/src/stores/operator.ts
  - packages/web/src/components/operator/LifecycleActions.tsx
  - packages/web/src/lib/esplora.ts
  - packages/service/src/runtime-settings.ts
  - packages/web/tests/operator.spec.ts
  - packages/web/tests/lifecycle.spec.ts
  - packages/web/tests/tx-client.spec.ts
  - packages/web/tests/cohort-form.spec.ts
  - packages/service/tests/runtime-settings.spec.ts
  - docs/DEPLOY.md
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
status: issues_found
---

# Phase 5: Code Review Report (re-review after gap-closure round 3)

**Reviewed:** 2026-08-02
**Depth:** deep (cross-file: store to component to route to holder, plus the callers of every changed module)
**Files Reviewed:** 10 (the round-3 file set, traced into `operator-cohorts.ts`, `index.ts`, `demo-server.ts`, `CohortDetail.tsx`, `ServiceControls.tsx`, `HealthStrip.tsx`, `DraftEditForm.tsx`, `SettingsView.tsx`, `participant.ts`, `cohort-form.ts`, `networks.ts`)
**Status:** issues_found

## Summary

Baseline: `pnpm typecheck` (`tsc -b`) clean; `vitest run packages/web/tests packages/service/tests/runtime-settings.spec.ts` is 21/21 files, 438/438 tests green.

The three round-3 fixes were verified against the code, not against the summaries:

- **Prior CR-1 (stale drill-down poll) is genuinely fixed.** `pollDetail` now captures `askedFor` before the await and re-checks `get().view` after it, with the 401 branch deliberately ahead of the guard. `detailCohortId` is written and cleared in the same `set` call as `detail` at all four sites (`pollDetail`, `openCohort`, `closeCohort`, `expireSession`/`signOut`). `packages/web/tests/operator.spec.ts` stages the race deterministically with per-cohort deferreds and carries a real anti-vacuity control.
- **Prior WR-1 (unreachable `mismatch` on the default network) is genuinely fixed.** `classifyEndpoint` now identifies the chain from block zero before demanding a second marker, and the registry contains exactly one ambiguous genesis (the mutinynet/signet pair), so the reorder cannot widen acceptance. The `accepts NOTHING new` matrix in `tx-client.spec.ts` drives every registry pairing both ways and is the right shape of proof.
- **Prior WR-2 and WR-3 are fixed for the numeric fields only.** `numericKnob` gained an opt-in integrality check and every window the holder stores is floored to a whole minute. Two residues remain: the same invariant is violated by the two free-text seeds (CR-01 below), and the per-draft validator was left with the weaker rule (WR-03 below).

The findings below are what the round did not close, plus two defects the round-3 changes introduced (WR-02, and the `TestPeerAction` half of WR-04). Four are reproduced with executable evidence.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01 (BLOCKER): The round's own stated invariant is false for `SERVICE_NAME` and `TERMS_TEXT`, and a long seed wedges every settings save

**File:** `packages/service/src/runtime-settings.ts:317-473` (seeding), `packages/service/src/runtime-settings.ts:566-627` (`applySettings`), with the env path at `packages/service/src/demo-server.ts:396,432` and the vacuous pin at `packages/service/tests/runtime-settings.spec.ts:755-772`

**Issue:**

Plan 05-30 shipped an invariant and wrote it into the source in capitals:

> THE INVARIANT `requireInteger` EXISTS FOR (`05-VERIFICATION.md` W3, review WR-2). No seed this holder ACCEPTS may be a value {@link RuntimeSettings.applySettings} would REFUSE.

That invariant holds for the numeric fields and the beacon type. It is false for the two free-text fields. The seeds are only trimmed:

```ts
const serviceName: FieldState<string | undefined> = field(trimToUndefined(seed.serviceName));
const termsText:   FieldState<string | undefined> = field(trimToUndefined(seed.termsText));
```

while `applySettings` applies `MAX_SERVICE_NAME_CHARS` (200) and `MAX_TERMS_CHARS` (20000) to `nextServiceName` / `nextTermsText` regardless of whether the value came from the patch or was re-read from storage for an absent key. `demo-server.ts` pipes `process.env.SERVICE_NAME` and `process.env.TERMS_TEXT` straight in with no bound.

Reproduced against the shipped module:

```
$ bun /tmp/rs2.ts
warns at boot: []
stored name length: 5000
stored terms length: 100000
rename-only save -> Participation terms must be 20000 characters or fewer.
size-only save   -> Service name must be 200 characters or fewer.
name after -> 5000
size after -> 2
terms-only boot, size save -> Participation terms must be 20000 characters or fewer.
```

Three consequences, and each is the exact harm the WR-2/WR-3 fix was written to end:

1. The whole gated settings surface refuses every save, silently, until restart. The message names a field the operator did not touch (a size change is refused with a sentence about the service name).
2. The boot is silent. Every other out-of-range seed in this module warns loudly and falls back; these two do neither.
3. `GET /v1/config` serves the unbounded text publicly, so the cap that `MAX_TERMS_CHARS` documents as protection against "unbounded in-memory text on a surface an operator can save repeatedly" is not enforced on the path that actually sets it in production (the environment).

`TERMS_TEXT` is the realistic trigger: 20000 characters is roughly 3500 words, and a genuine participation-terms document can exceed that. The operator sees their terms served correctly and then finds the console cannot save anything.

This shipped green because the spec block that claims to state the invariant as a property checks numbers only:

```ts
function expectHolderInvariants(settings: RuntimeSettings): void {
  expect(Number.isInteger(settings.defaultSize.value)).toBe(true);
  ...
  for (const window of [settings.defaultDiscoveryWindowMs.value, settings.defaultFundingWindowMs.value]) { ... }
}
```

`HOSTILE_SEEDS` has no string row at all. `docs/DEPLOY.md` documents no length bound for either variable either, so an operator has no way to know the limit before booting into it.

**Fix:** bound both seeds where every other malformed seed is bounded, with the same warn-and-fall-back posture, then extend the invariant predicate so the pin stops being vacuous.

```ts
/** Trim, collapse empty to undefined, and refuse an over-long seed the way every numeric seed is refused. */
function textKnob(name: string, raw: string | undefined, max: number, warn: (m: string) => void): string | undefined {
  const trimmed = trimToUndefined(raw);
  if (trimmed !== undefined && trimmed.length > max) {
    warn(`ignoring ${name}: ${trimmed.length} characters exceeds the ${max} this service stores`);
    return undefined;
  }
  return trimmed;
}

const serviceName: FieldState<string | undefined> =
  field(textKnob('SERVICE_NAME', seed.serviceName, MAX_SERVICE_NAME_CHARS, warn));
const termsText: FieldState<string | undefined> =
  field(textKnob('TERMS_TEXT', seed.termsText, MAX_TERMS_CHARS, warn));
```

and in `packages/service/tests/runtime-settings.spec.ts`:

```ts
// The invariant is about EVERY field the holder stores, not only the numeric ones.
for (const [text, max] of [
  [settings.serviceName.value, MAX_SERVICE_NAME_CHARS],
  [settings.termsText.value, MAX_TERMS_CHARS],
] as const) {
  if (text !== undefined) {
    expect(text.length).toBeLessThanOrEqual(max);
  }
}
```

plus two `HOSTILE_SEEDS` rows (`serviceName: 'x'.repeat(5000)`, `termsText: 'y'.repeat(100000)`), which fail today. Add both limits to the `SERVICE_NAME` and `TERMS_TEXT` rows of the `docs/DEPLOY.md` environment reference.

## Warnings

### WR-01 (WARNING): `refreshCohorts` has no round guard, so a late list read repopulates gated state after a session expiry or a sign-out

**File:** `packages/web/src/stores/operator.ts:890-926`, contrasted with the new guard at `packages/web/src/stores/operator.ts:1292-1309`

**Issue:**

Round 3 gave `pollDetail` a round guard. `refreshCohorts` did not get one, and its ok branch writes unconditionally:

```ts
const result = await fetchOperatorCohorts(baseUrl);
if (result.kind === 'unauthorized') { get().expireSession(); return; }
if (result.kind === 'unreachable')  { set({ listStale: true }); return; }
set({ cohorts: ..., rows: ..., metrics: ..., health: ..., operatorActions: ..., defaults: ..., listStale: false, lastUpdated: Date.now() });
```

The list poll fires every 4000 ms while the client timeout is 8000 ms, so two reads can be in flight at once. If the fast one 401s and the slow one succeeds, `expireSession` runs first and the late ok write puts the gated slice back. `signOut` has the identical exposure (a poll issued just before the click lands just after the clear). Reproduced against the shipped store:

```
$ bun /tmp/op.ts
after expiry  auth: logged-out cohorts: 0 health: undefined
after late ok auth: logged-out cohorts: 1 health: { mode: "live", esploraReachable: true, paused: false } metrics: { open: 1, ... } listStale: false
```

`pollDetail` is incidentally immune because `expireSession` sets `view` to `list` and its round guard rejects on that, which is exactly the asymmetry: the same class of stale write is now guarded on one path and not the other. The store's own docstrings claim otherwise (`expireSession` "clearing every gated slice", the sign-out comment "the next session must re-read it rather than render a stale mode claim against a service that may have been restarted into another mode"), and `SESSION_EXPIRED` promises the operator that "Monitoring rebuilds from this service's state after you sign in". After a late write the next sign-in renders the previous session's cohort list, metrics and broadcast-mode chip until the first read of the new session lands. The store already knows this pattern is needed: `advertise` guards `if (get().auth === 'logged-in')` before opening a drill-down.

**Fix:** apply the same shape of guard the round gave `pollDetail`, keyed on the session rather than the cohort.

```ts
async refreshCohorts(baseUrl) {
  const askedWhileSignedIn = get().auth === 'logged-in';
  const result = await fetchOperatorCohorts(baseUrl);
  if (result.kind === 'unauthorized') { get().expireSession(); return; }
  // An answer to a question the PREVIOUS session asked is not evidence about this one: a read
  // that lands after an expiry or a sign-out must not repopulate the gated slice.
  if (!askedWhileSignedIn || get().auth !== 'logged-in') { return; }
  ...
}
```

Add a row to `packages/web/tests/operator.spec.ts` in the shape of the existing concurrency block: stage a slow ok read and a fast 401, settle the 401 first, then the ok, and assert `cohorts`, `health` and `metrics` are still empty.

### WR-02 (WARNING): The clamp warning introduced by 05-30 states a false reason and names a knob that is not an environment variable

**File:** `packages/service/src/runtime-settings.ts:412-465`

**Issue:**

The quantizer runs at three points, and point 2 is deliberately placed AFTER the ceiling clamp. That ordering makes the clamp fire on a value that never exceeded the real ceiling, and the clamp's message then says something untrue. Observed in the suite's own output for the documented `COHORT_TTL_MS=90000` case (`packages/service/tests/runtime-settings.spec.ts:881`):

```
[settings] discoveryWindowCeilingMs=90000 is not a whole number of minutes; using 60000 instead, the longest whole-minute window at or below it
[settings] defaultDiscoveryWindowMs=90000 exceeds this service's cohort TTL; using 60000 instead, the longest discovery window this service can enforce
```

Both lines mislead:

- The cohort TTL is 90000. A value of 90000 does not exceed it. The clamp fired against the already-quantized ceiling (60000), not against the TTL, so the sentence names a rule the operator did not break.
- The operator never set `DEFAULT_DISCOVERY_WINDOW_MS`; it was derived from `COHORT_TTL_MS` at `index.ts:674`. They set one variable and are warned about two others, one of which (`discoveryWindowCeilingMs`) exists in no environment reference, no compose file, and no ADR.

`docs/DEPLOY.md:506` describes this case as producing "a boot warning naming both numbers", singular. It produces two, and the second is false.

The clamp comment justifies the ordering as "a value clamped to an already-quantized ceiling is whole by construction, and a value that was never clamped still needs its own floor", which is true but is not a reason to clamp before flooring: flooring first is equally correct (`floor(w) <= w`, and the ceiling is already whole), stores the identical value, and removes the spurious clamp entirely.

**Fix:** floor the seed before comparing it to the ceiling, and report the source variable rather than the internal field name.

```ts
// QUANTIZER POINT 2: floor the SEED first, so the clamp below only ever fires on a window that
// genuinely exceeds what this service can enforce, and its message stays true.
const flooredDiscoveryWindowMs = floorToWholeMinute('defaultDiscoveryWindowMs', seededDiscoveryWindowMs);
const resolvedDiscoveryWindowMs =
  flooredDiscoveryWindowMs !== undefined &&
  discoveryWindowCeilingMs !== undefined &&
  flooredDiscoveryWindowMs > discoveryWindowCeilingMs
    ? discoveryWindowCeilingMs
    : flooredDiscoveryWindowMs;
```

For the ceiling's own quantizer call, pass a name the operator can act on (`COHORT_TTL_MS (discovery-window ceiling)`), and pin the warning COUNT in the derived-boot spec row, which today asserts only the stored value.

### WR-03 (WARNING): `validateDraft` still accepts a non-whole-minute window, so the WR-3 wedge survives on the per-draft path

**File:** `packages/service/src/operator-cohorts.ts:716-721`, consumed at `operator-cohorts.ts:1172,1224`, with the browser half at `packages/web/src/components/operator/DraftEditForm.tsx:129-152`

**Issue:**

The holder now refuses a window that is integral but not a whole number of minutes:

```ts
if (!Number.isInteger(ms) || ms < ONE_MINUTE_MS || ms % ONE_MINUTE_MS !== 0) { return message; }
```

`validateDraft`, which guards the same two values on the per-cohort path and throws the SAME two constants, does not:

```ts
if (discoveryWindowMs !== undefined && (!Number.isInteger(discoveryWindowMs) || discoveryWindowMs < ONE_MINUTE_MS)) {
  throw new Error(DISCOVERY_WINDOW_ERROR);
}
```

So `POST /v1/operator/cohorts` with `discoveryWindowMs: 90000` is accepted and stored on the draft. `DraftEditForm` then seeds its minutes field with `msToMinutesText(90000)` = `"1.5"`, `parseWindow` calls that invalid, and `validateCohortForm` runs over the whole form before submit, so that draft can never be edited again from the console: a beacon-type change is refused behind a message about a window the operator may not have set. That is the same failure the holder's `validateWindow` docstring names verbatim ("The browser cannot produce such a value, but a headless operator client posting straight at the gated route can, and it would re-wedge the console the moment it landed"), left open one module away, behind the same shared error string. Two validators enforcing different rules under one sentence is also a drift hazard on its own: `DISCOVERY_WINDOW_ERROR` is now true of one call site and false of the other.

Related off-by-one worth closing in the same edit: `validateDraft` accepts `discoveryWindowMs === cohortTtlMs` (the ceiling check is `>`), while `armWindowTimer` refuses to arm at `windowMs >= opts.cohortTtlMs` (`operator-cohorts.ts:871`). A draft set to exactly the TTL is therefore accepted with a window this service then never enforces, and the cohort lapses with the library's generic expired fate rather than the app's `window-expired` reason. This is the same "captioned as configuration you can rely on" harm the 05-30 clamp comment describes.

**Fix:** move the whole-minute rule into one shared predicate and call it from both, so the two paths cannot disagree.

```ts
// operator-cohorts.ts, beside the two error constants that already live here.
export function windowProblem(ms: number | undefined, message: string): string | undefined {
  if (ms === undefined) { return undefined; }
  return Number.isInteger(ms) && ms >= ONE_MINUTE_MS && ms % ONE_MINUTE_MS === 0 ? undefined : message;
}
```

`validateDraft` throws on it, `runtime-settings.validateWindow` returns it. Add a `createDraft` spec row for `discoveryWindowMs: 90_000` (refused) and one for `discoveryWindowMs === cohortTtlMs`, whichever behavior is chosen for the boundary.

### WR-04 (WARNING): The provenance barrier stops at `LifecycleActions`; the other card that mixes a prop cohort with slot data is the live test-peer confirm

**File:** `packages/web/src/components/operator/LifecycleActions.tsx:144-159` (barrier present), `packages/web/src/components/operator/CohortDetail.tsx:308-341,157-205` (barrier absent)

**Issue:**

The round-3 reasoning for the second barrier is stated in the component itself: "This component receives the cohort it will ACT on as a prop and reads the data it REASONS about from a store slot shared by every drill-down". That description is true of `CohortDetail` as a whole and word for word of `TestPeerAction`, which receives `cohortId` as a prop, receives `remaining` and `live` computed by its parent from the shared `detail`, and fires `addTestPeers(baseUrl, cohortId)`. Its confirm is the one that says, on a live cohort, that the peers "co-sign for real and their DIDs are anchored on {network}". A count and a live flag from one cohort under a confirm that acts on another is the same substitution the barrier exists to refuse, at the same stakes (a real beacon transaction, real fees, DIDs anchored).

`FundingStage` has the same split: it renders `detail.funding.beaconAddress` and its funding instruction under the heading `Cohort {shortId(cohortId)}`, which is the exact consequence the prior CR-1 named.

This is not a live bug today, because the store's round guard closes the only write path into `detail`. It is a defense-in-depth inconsistency: the round decided that one barrier was not enough for the cancel ceremony and then left the two neighbours on the page trusting the single barrier, with nothing in a spec recording which of them is meant to be protected.

**Fix:** derive the provenance once at the top of `CohortDetail` and refuse the whole body rather than protecting one card.

```ts
const detailCohortId = useOperator((s) => s.detailCohortId);
// One barrier for the page: every section below reads the shared slot while every control acts on
// the prop, so an unattributed or foreign document is not evidence about this cohort.
const provenDetail = detail && detailCohortId === cohortId ? detail : undefined;
```

Then render from `provenDetail` throughout and drop the now-redundant condition from `LifecycleActions`, or keep it and let the two agree. Extend the `lifecycle.spec.ts` refusal block with one `TestPeerAction` row driven through `CohortDetail`.

### WR-05 (WARNING): `lastUpdated` carries two different freshness facts, so the health strip claims a freshness it has not got and the operator log claims to still be checking

**File:** `packages/web/src/stores/operator.ts:519-520,890-926,1245-1310`, read at `packages/web/src/components/operator/HealthStrip.tsx:66,102-103`, `packages/web/src/components/operator/ServiceControls.tsx:202`, `packages/web/src/components/operator/CohortDetail.tsx:311,335-339`

**Issue:**

One field is stamped by two unrelated reads (`refreshCohorts` at line 924 and `pollDetail` at line 1309) and cleared by drill-down navigation (`openCohort` line 1257, `closeCohort` line 1267). Three consumers read it as if it meant three different things:

1. `HealthStrip` renders "N s ago" and its tone from `lastUpdated` beside the mode, esplora and paused chips, all of which come from `health`, which only a LIST read refreshes. Inside a drill-down the list poll is stopped (`OperatorConsole.tsx:51-57` returns unless `view.kind === 'list'`), so the chips freeze while the detail poll keeps ticking the clock beside them. An operator watching a cohort for ten minutes sees "Live, 3s ago" over a broadcast-mode and esplora-reachability claim last read ten minutes ago. That is precisely the D-25 freshness honesty the field exists to serve.
2. `ServiceControls` computes `loaded` from `lastUpdated !== undefined`, with the comment "A read has landed for this session exactly when the list poll stamped its freshness clock". `openCohort` clears it, so opening any cohort flips the service-level `Operator actions` log to its `Checking operator actions` loading posture while the store still holds the entries, and `closeCohort` does it again on the way back for up to one list-poll interval.
3. `CohortDetail`'s own indicator reads "Live" as soon as any action taken from the drill-down (pause, resume, disable broadcast, dismiss) calls `refreshCohorts`, even if no detail read has ever landed for the open cohort.

**Fix:** split the field so each surface reads the clock for the data it is decorating.

```ts
/** Wall-clock (ms) of the last successful LIST read: the health strip and the operator log read this. */
listUpdated?: number;
/** Wall-clock (ms) of the last successful DETAIL poll for the open cohort. */
detailUpdated?: number;
```

`refreshCohorts` stamps `listUpdated` only, `pollDetail` stamps `detailUpdated` only, `openCohort` and `closeCohort` clear `detailUpdated` only, and both are cleared with the rest of the gated slice on expiry and sign-out. `HealthStrip` and `ServiceControls` read `listUpdated`; `CohortDetail` reads `detailUpdated`. Consider polling the list at a slower cadence while a drill-down is open rather than not at all, since the strip stays on screen there.

## Info

### IN-01 (INFO): `numericKnob` coerces environment strings with bare `Number()`, so hex and exponent forms are accepted as knob values

**File:** `packages/service/src/runtime-settings.ts:103`

**Issue:** `const n = typeof raw === 'number' ? raw : Number(raw);` means `DEFAULT_SIZE=0x10` is stored as 16, `DEFAULT_SIZE=1e3` as 1000, and `PORT=+8080` as 8080. Each passes `Number.isInteger` and each is silent. This is the server-side twin of deferred IN-2 (`parseWindow`), and the same shape guard closes both.

**Fix:** shape-guard the string form before coercing, so a knob accepts what its documentation describes:

```ts
if (typeof raw === 'string' && !/^\s*-?\d+(\.\d+)?\s*$/.test(raw)) {
  warn(`ignoring malformed ${name}="${raw}"; using ${fallback ?? 'the built-in default'}`);
  return fallback;
}
```

### IN-02 (INFO): `parseWindow` has no upper bound, and a huge window reaches `setTimeout` unclamped when no cohort TTL is configured

**File:** `packages/web/src/lib/cohort-form.ts:52-61`, reaching `packages/service/src/operator-cohorts.ts:867-889`

**Issue:** `parseWindow('99999999')` yields 5.99e12 ms, which `validateDraft` accepts as an integer. `armWindowTimer` skips arming only when `opts.cohortTtlMs` is set and the window is at or above it; a `createService` caller that omits `cohortTtlMs` (its own docstring notes that leaves cohorts pending forever) therefore reaches `setTimeout(fn, 5.99e12)`, which Node clamps to 1 ms with a `TimeoutOverflowWarning`, so the cohort is stopped almost immediately and filed as `window-expired`.

Not reachable on the documented deploy path: `demo-server.ts:268` always resolves `cohortTtlMs` to `DEFAULT_COHORT_TTL_MS` (30 min), and `validateDraft`'s ceiling refuses anything above it. Recorded as latent.

**Fix:** bound the parser at the source (a window longer than the largest TTL this service will ever run is not a value worth accepting), and make `armWindowTimer` refuse a delay above `2_147_483_647` explicitly rather than relying on a caller-supplied TTL to have excluded it.

## Known-deferred findings (owner scoped OUT of round 3)

Re-observed and confirmed still present. Recorded here rather than as new discoveries:

- **Prior WR-5:** the endpoint verdict cache is still never cleared in shipped code. `clearEndpointCache` (`packages/web/src/lib/esplora.ts:219`) has callers only in `packages/web/tests/tx-client.spec.ts`; `useChainEndpoint` (`packages/web/src/stores/participant.ts:2637-2656`) does not call it, so a transient failure is cached for the life of the page.
- **Prior WR-6:** `packages/web/src/lib/tx-client.ts` still contains no `AbortSignal.timeout`, so the two participant-supplied chain calls remain unbounded while every sibling client in the package carries the 8000 ms budget.
- **Prior IN-1:** `verdictCache` (`packages/web/src/lib/esplora.ts:216`) is still an unbounded module-level singleton keyed by participant-typed input.
- **Prior IN-2:** `parseWindow` still accepts hex, exponent and signed forms as minute values (see IN-02 above for the server-side twin).

## Verification of the round-3 fixes

- **Prior CR-1:** FIXED. Round guard and paired provenance verified at every write and clear site; the `LifecycleActions` refusal is verified rendered, with an anti-vacuity control and negative rows asserting empty markup rather than a missing label. Residual scope gap recorded as WR-04.
- **Prior WR-1:** FIXED. Genesis-first ordering verified against `packages/shared/src/networks.ts`: exactly one ambiguous genesis (mutinynet and signet), both carrying a `distinguishingBlock`, so no registry pairing can reach `ok` that could not before. The preserved "refuses rather than passing when a required second marker was not observed" row is correctly identified as the boundary of the new rule.
- **Prior WR-2:** FIXED for numeric seeds. Integrality is opt-in, the eleven existing call sites are unchanged, and the `PORT` minimum-zero case is pinned. Violated for string seeds (CR-01).
- **Prior WR-3:** FIXED on the settings path. Every window the holder serves is a whole minute, quantized at all three points, and the browser round trip is stated as a property in `cohort-form.spec.ts`. Not fixed on the per-draft path (WR-03), and the new clamp message is inaccurate (WR-02).

---

_Reviewed: 2026-08-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
