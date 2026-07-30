---
phase: 05
reviewed: 2026-07-30T00:00:00Z
depth: standard
status: issues
files_reviewed: 94
findings:
  critical: 1
  warning: 7
  info: 5
  total: 13
---

# Phase 5: Code Review Report

**Reviewed:** 2026-07-30
**Depth:** standard
**Files Reviewed:** 94 (the phase-05 key-file union from `/tmp/review-scope.txt`)
**Status:** issues_found

## Summary

Reviewed the phase-05 surface: the service lifecycle modules (`operator-cohorts.ts`,
`runtime-settings.ts`, `cohort-intent.ts`, `advert-republish.ts`, `test-peers.ts`,
`acceptance-ledger.ts`, `hono-adapter.ts`, `index.ts`, `monitor.ts`, `store.ts`,
`demo-server.ts`), the shared additions (`phases.ts`, `tos.ts`, `networks.ts`), and the web
operator console plus the participant-side chain-endpoint, PSBT, terms and fate-attribution
paths.

Baseline: `pnpm typecheck` (`tsc -b`) is clean and `vitest run` is 68/68 files, 1169/1169 tests
green. Every finding below is something the suite does not cover, and four of them are
reproduced with executable evidence in the finding body.

The auth and anti-oracle posture holds up under inspection: every mutating route is registered
inside the `operatorAuth` block after both prefix guards, the four anonymous reads
(`/v1/anchor`, `/v1/funding`, `/v1/cohort-fate`, `/v1/terms/acceptance`) each carry a cheap
shape guard before any lookup and answer one uniform body, and the kill switch genuinely has no
enable counterpart anywhere in the holder or the route table. The `cohortKeepsLiveWiring`
predicate is applied at all three money legs and fails closed.

The concerns are concentrated elsewhere:

1. One client-side state race lets the highest-stakes confirmation ladder run at the wrong rung
   against the wrong cohort (CR-1).
2. Two independent boot-config values that the service accepts without complaint wedge the
   gated settings surface so that no setting at all can be saved (WR-2, WR-3).
3. The participant chain guard's primary safety verdict, `mismatch`, is unreachable on the
   project's default network (WR-1).

## Critical Issues

### CR-1: A stale detail poll can arm the cheap cancel ceremony against a funded cohort

**File:** `packages/web/src/stores/operator.ts:1252-1272` (`pollDetail`), with the consequence at
`packages/web/src/components/operator/CohortDetail.tsx:377` and
`packages/web/src/components/operator/LifecycleActions.tsx:129-169, 239-285`

**Issue:**

`pollDetail` reads `get().view` once, at the top, then writes the response into the shared
`detail` slot unconditionally after the `await`:

```ts
async pollDetail(baseUrl) {
  const { view } = get();
  if (view.kind !== 'detail') { return; }
  const result = await fetchCohortDetail(baseUrl, view.cohortId);
  ...
  set({ detail: result.value, detailStale: false, lastUpdated: Date.now() });
}
```

There is no abort controller and no re-check of the view after the await. `openCohort` clears
`detail` and re-points the view, and `CohortDetail`'s effect re-keys on `cohortId`, but neither
cancels nor invalidates a request already in flight for the previous cohort. The stale response
therefore lands in `detail` while `view.cohortId` names a different cohort. The window is the
remaining latency of that request, bounded by the client's 8000 ms timeout.

That is not merely a cosmetic mis-render, because the drill-down splits its two inputs:

- `LifecycleActions` receives `cohortId` as a **prop** (`view.cohortId`, cohort B) and reads
  `detail` from the **store** (cohort A).
- `cancelAvailability(detail)`, `cancelRung(detail)`, `finalizeAvailability(detail)`,
  `detail.seatsJoined` and `detail.funding?.recoveryKeyState` are all derived from A.
- `onConfirm` fires `cancelCohort(baseUrl, cohortId)`, which targets **B**.

So if A is an unfunded or hermetic cohort and B is funded, `cancelRung(A)` returns 3 and
`CancelConfirm` renders the rung-3 panel: no `typeToConfirm` gate, no
`RECOVERY_THROWAWAY` / `RECOVERY_OPERATOR_HELD` disclosure, and A's seat count in the sentence.
A single click then cancels the funded cohort B. That is precisely the outcome the D-03 ceremony
ladder exists to prevent, and the consequence is stranded Bitcoin at B's beacon address under a
throwaway recovery key.

The same stale `detail` also mis-drives `finalizeAvailability` (offering or hiding `Finalize
now` on the wrong cohort's phase) and `FundingStage` (which renders A's beacon address and
`bitcoin:` funding instruction under B's heading, at `CohortDetail.tsx:466`).

**Fix:** re-check the view after the await, and drop an answer that no longer matches the open
cohort. Two lines, and it also makes the existing `closeCohort` path exact:

```ts
async pollDetail(baseUrl) {
  const { view } = get();
  if (view.kind !== 'detail') {
    return;
  }
  const askedFor = view.cohortId;
  const result = await fetchCohortDetail(baseUrl, askedFor);
  // The answer is about ONE cohort. If the operator has since navigated away, it is not an
  // answer about what is on screen, so it must not be painted there (the participant store's
  // `fetchCohortFate` round guard, applied to the drill-down poll).
  const now = get().view;
  if (now.kind !== 'detail' || now.cohortId !== askedFor) {
    return;
  }
  ...
}
```

Belt and braces worth adding beside it: have `LifecycleActions` refuse to render its controls
when the served detail cannot be tied to `cohortId`, rather than trusting that the store slot
and the prop always agree.

## Warnings

### WR-1: The `mismatch` chain verdict is unreachable on the default network

**File:** `packages/web/src/lib/esplora.ts:154-189` (`classifyEndpoint`), with the orchestration at
`packages/web/src/lib/esplora.ts:227-261` (`checkEndpoint`)

**Issue:**

`classifyEndpoint` refuses an unverified second marker before it ever tries to identify the
observed chain:

```ts
if (ours.distinguishingBlock && observed.distinguishing === undefined) {
  return { kind: 'unreachable' };
}
const theirName = identifyChain(observed);
```

`checkEndpoint` only probes the second marker when block zero **already matches ours**
(`esplora.ts:248`). So for any `ourNetwork` in the signet family, an endpoint on a different
chain family never gets a second probe, arrives with `distinguishing === undefined`, and is
classified `unreachable`.

`mutinynet` is `DEFAULT_NETWORK` and carries a `distinguishingBlock`; `signet` does too
(`packages/shared/src/networks.ts:115-143, 178`). Reproduced:

```
$ bun /tmp/probe.ts
mainnet endpoint on mutinynet -> {"kind":"unreachable"}
checkEndpoint -> {"kind":"unreachable"}
```

Consequence: a participant on the project's default network who pastes a mainnet, testnet3,
testnet4 or regtest esplora endpoint is shown `Couldn't reach that endpoint.`
(`ChainEndpointPanel.tsx:50`) instead of `That endpoint is on Bitcoin mainnet, but this service
is on Mutinynet (signet). It was not used.` (`ChainEndpointPanel.tsx:55-57`). They are sent to
check their host when the host is fine and the network is wrong. The module docstring names
"FIRST, the endpoint must be on the RIGHT CHAIN" as the whole point of the guard, and the E16
copy set carries four distinct messages precisely so the participant knows what to do next.

The endpoint is still refused, so this is a diagnosis defect rather than a trust hole, which is
why it is a warning and not a blocker.

**Fix:** identify the chain from block zero first, and require the second marker only when the
genesis already matches ours (which is the only case where it is load-bearing):

```ts
const theirName = identifyChain(observed);
if (theirName === null && input.probe.genesis !== ours.genesisHash) {
  // A different block zero is already conclusive: no second marker can rescue it.
  return { kind: 'mismatch', theirNetwork: UNRECOGNIZED_CHAIN, ourNetwork: ours.label };
}
if (ours.distinguishingBlock && observed.distinguishing === undefined) {
  return { kind: 'unreachable' };
}
```

Add a `classifyEndpoint` row per foreign family (mainnet, testnet4, regtest) against
`ourNetwork: 'mutinynet'`; today's rows only exercise the signet-versus-signet case, which is
why this shipped green.

### WR-2: A non-integer `DEFAULT_SIZE` or `DEFAULT_THRESHOLD` seed wedges every settings save

**File:** `packages/service/src/runtime-settings.ts:77-93` (`numericKnob`), consumed at
`packages/service/src/runtime-settings.ts:318-322` and re-read at
`packages/service/src/runtime-settings.ts:489-500`

**Issue:**

`numericKnob` validates finiteness and a lower bound only:

```ts
if (!Number.isFinite(n) || n < minimum) { warn(...); return fallback; }
return n;
```

It never checks integrality. `applySettings`, however, re-reads the STORED value for every
absent patch key and validates it with `Number.isInteger`. A fractional seed therefore passes
boot silently and then fails every subsequent save as a set, including saves of fields the
operator did touch. Reproduced:

```
$ bun /tmp/rs.ts
warns: []
stored size: 2.5 stored discovery: 90000
rename-only save -> Cohort size must be at least 1 signer.
name after save: undefined
```

The operator's only runtime configuration surface is now unusable, and the message names a
field they never edited. `createDraft` is hit too: `withServiceDefaults`
(`operator-cohorts.ts:1138-1150`) fills the absent size with `2.5` and `validateDraft` throws
`SIZE_ERROR` on every create.

This is the exact defect class the discovery-window clamp docstring
(`runtime-settings.ts:349-371`) states it closed: "an over-ceiling stored value refused every
save as a set, including saves of fields the operator did touch: a rename failed behind an
error about a window they never set." The ceiling dimension was fixed; the integrality
dimension was not.

**Fix:** give `numericKnob` an integrality option and use it for the four seeds whose consumers
demand whole numbers, so a malformed value warns and falls back at boot exactly like every other
malformed knob:

```ts
export function numericKnob(
  name: string,
  raw: string | number | undefined,
  fallback: number | undefined,
  warn: (msg: string) => void,
  minimum = 1,
  integer = false,
): number | undefined {
  ...
  if (!Number.isFinite(n) || n < minimum || (integer && !Number.isInteger(n))) {
    warn(`ignoring malformed ${name}="${String(raw)}"; using ${fallback ?? 'the built-in default'}`);
    return fallback;
  }
  return n;
}
```

Then pass `integer: true` for `defaultSize`, `defaultThreshold`, and both window seeds. The
invariant worth pinning in a spec is stronger than the knob: **no seed this holder accepts may
be a value `applySettings` would reject.**

### WR-3: A legal window seed round-trips into the forms as a fractional minute and blocks every save

**File:** `packages/web/src/lib/cohort-form.ts:52-66` (`parseWindow` / `msToMinutesText`), consumed
at `packages/web/src/components/operator/SettingsView.tsx:68-78, 173-186` and
`packages/web/src/components/operator/DraftEditForm.tsx`

**Issue:**

`numericKnob` accepts any finite ms at or above `ONE_MINUTE_MS`, so
`DEFAULT_DISCOVERY_WINDOW_MS=90000` is a perfectly legal boot value that stores and serves
cleanly. The console then seeds the field with `msToMinutesText(90000)` = `"1.5"`, and
`parseWindow("1.5")` returns `{ kind: 'invalid' }` because it mirrors the server's whole-minute
guard. Reproduced:

```
$ bun /tmp/cf.ts
field text seeded from the served snapshot: "1.5"
parsed back: {"kind":"invalid"}
form verdict for a rename-only save: Discovery window must be a whole number of minutes, at least 1.
```

`SettingsView.submit` runs `validateCohortForm` over the whole form before it will post
(`SettingsView.tsx:173-186`), so the operator cannot save the service name, the terms, the
beacon type or anything else until they manually retype a field they never set. The same seed
reaches `DraftEditForm` through `OperatorCohortDTO.defaultDiscoveryWindowMs`, so editing a
draft is blocked the same way.

This is independent of WR-2 (that one is about non-integer ms, this one about ms that are
integral but not a whole number of minutes), and both close with the same rule.

**Fix:** make the minute granularity part of what the service will accept, rather than
something only the browser enforces. Either quantize the seed at the holder (round down to a
whole minute with a loud warning, mirroring the discovery-window ceiling clamp) or reject a
non-whole-minute seed through the `integer`-aware `numericKnob` above with
`minimum: ONE_MINUTE_MS` plus a `% ONE_MINUTE_MS === 0` check. The rule to hold is that any ms
value this service will serve must round-trip through `msToMinutesText` -> `parseWindow` without
becoming `invalid`.

### WR-4: `GET /cas/:kind/:hash` resolves prototype-inherited keys and 500s an anonymous request

**File:** `packages/service/src/store.ts:321-327, 344-358`

**Issue:**

`KIND_BY_SEGMENT` is a plain object literal, so the lookup walks `Object.prototype`:

```ts
const kind = KIND_BY_SEGMENT[c.req.param('kind')];
if (!kind) { return c.json({ error: 'unknown artifact kind' }, 404); }
```

`__proto__`, `constructor`, `toString`, `valueOf` and friends all return a truthy non-`ArtifactKind`
value and pass the guard. `MemoryArtifactStore` absorbs it (a fresh sub-map, then a miss, then
404), but `FileSystemArtifactStore` hands it to `node:path.join` and throws. Reproduced against
the real Hono app:

```
filesystem  /cas/__proto__/aabbcc -> 500
TypeError: The "paths[1]" property must be of type string, got object
  at #file (packages/service/src/store.ts:152:22)
```

An anonymous caller therefore gets a 500 and a stack trace in the operator's log on every
request, on the store implementation the docstring calls "the natural default for a self-hosted
aggregator that pins its cohorts' artifacts". It also breaks the uniform-refusal posture the
rest of the public surface holds to.

**Fix:** make the lookup own-property only, so the segment set really is the five names:

```ts
const KIND_BY_SEGMENT = new Map<string, ArtifactKind>(ARTIFACT_KINDS.map((k) => [k, k]));
// ...
const kind = KIND_BY_SEGMENT.get(c.req.param('kind'));
```

A `Map` also removes the hand-maintained second copy of `ARTIFACT_KINDS`, so a sixth namespace
cannot be added to one and forgotten in the other.

### WR-5: The endpoint verdict cache is never cleared in shipped code, so the retry cannot work

**File:** `packages/web/src/lib/esplora.ts:196-201, 236-260`

**Issue:**

`checkEndpoint` caches every verdict, including the failures:

```ts
const cached = verdictCache.get(key);
if (cached) { return cached; }
...
verdictCache.set(key, verdict);
```

`clearEndpointCache` exists and its docstring says it is "Used by tests and by an explicit
re-check", but a repo-wide grep finds callers only in `packages/web/tests/tx-client.spec.ts`.
Neither `useChainEndpoint` nor `clearChainEndpoint` in the participant store touches it.

So an endpoint that was momentarily down, rate-limited, or behind a cold TLS handshake that
tripped the 8000 ms budget is recorded `unreachable` for the lifetime of the page, and the
panel's `Use this endpoint` button (`ChainEndpointPanel.tsx:36`) becomes a no-op returning the
same cached sentence. The participant's only recourse is a full page reload, which also destroys
their in-memory identity.

**Fix:** treat an explicit `Use this endpoint` click as an explicit re-check. Either drop that
key before probing, or cache only `ok` verdicts (the stated goal, "a dead or refusing endpoint
is probed once rather than on every chain read", is about the per-read path, and only `ok`
verdicts are consulted there):

```ts
async useChainEndpoint(raw) {
  set({ chainEndpointProbing: true, chainEndpointVerdict: null });
  // An explicit click is an explicit re-check: a transient failure must not be permanent.
  forgetEndpointVerdict(raw, get().network);
  const verdict = await checkEndpoint(raw, get().network);
  ...
}
```

### WR-6: The two chain calls carry no timeout, so a hung participant endpoint wedges registration

**File:** `packages/web/src/lib/tx-client.ts:82-91, 111-120`

**Issue:**

`fetchUtxos` and `broadcastTx` are the only network clients in `packages/web/src/lib` with no
`AbortSignal.timeout(...)`. Every sibling (`config.ts:68`, `operator.ts:12`, `anchor`,
`funding`, `cohort-fate.ts:41`, and `esplora.ts:37` itself) carries the 8000 ms budget, and
`fetchNetworkConfig`'s docstring spells out why: "a coordinator that accepts the connection but
never sends a response ... would otherwise hang this promise with no default browser timeout,
leaving the caller stuck."

That reasoning is strictly stronger here, because PART-05 makes both URLs
**participant-supplied and arbitrary** (`tx-client.ts:79-81, 108-110`). A third-party esplora
that accepts the socket and never answers leaves `register()` parked at
`regStatus: 'broadcasting'` (`stores/participant.ts:2435, 2485`) or `'checking'` with the
re-entrancy guard held, and there is no cancel control on that surface. `exportPsbt` has the
same exposure through its own `psbtExporting` guard (`stores/participant.ts:2514-2531`).

**Fix:** add the shared budget to both, matching every other client in the package:

```ts
res = await fetch(url, {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
```

A broadcast probably deserves a longer budget than a read; pick two named constants rather than
one, but neither should be unbounded.

### WR-7: The test-peer seat cap holds only for serial calls

**File:** `packages/service/src/test-peers.ts:371-393` (`addTestPeersFor`), with the seat reader at
`packages/service/src/index.ts:1322-1360`

**Issue:**

`addTestPeersFor` reads the live seat count, computes `remainingSeats`, and then awaits the
spawn. Nothing marks the cohort as having a spawn in flight:

```ts
const seats = deps.seats(cohortId);
const remainingSeats = Math.max(0, seats.capacity - seats.seatsJoined);
if (remainingSeats === 0) { return 'no-seats'; }
const result = await deps.registry.spawn({ cohortId, requested, remainingSeats });
```

Two concurrent `POST /v1/operator/cohorts/:id/test-peers` requests both observe the same
remaining count and each spawn up to that many peers. Worse, the seats do not fill
synchronously: a peer takes a seat only after its SSE opt-in round-trips, so even ONE request
whose peers are still seating leaves the next request reading the pre-spawn count.

`test-peers.ts:22-26` and `hono-adapter.ts:992-993` both state the invariant as absolute ("no
request can grow the spawn beyond n", T-05-09-02). It holds serially only. The surplus peers
are then silently dropped by the library's own opt-in surplus behaviour (a documented upstream
limit), but they have already opened two SSE subscriptions each and are held in `handles` until
the cohort settles, which is a leaked-connection multiplier on an operator-triggerable action.

The route is operator-gated, so this is a robustness and honesty defect rather than an
unauthenticated DoS.

**Fix:** hold a per-cohort in-flight marker in the registry and subtract already-spawned peers
from the remaining count, so the cap is enforced against what this service has actually
committed rather than against what the session has finished seating:

```ts
const remainingSeats = Math.max(
  0,
  seats.capacity - seats.seatsJoined - deps.registry.pendingFor(cohortId),
);
```

Either that, or serialize per cohort with a promise chain in `createTestPeers.spawn`. Whichever
is chosen, the docstring's absolute claim should be softened to match what the code enforces.

## Info

### IN-1: `verdictCache` is an unbounded module-level singleton

**File:** `packages/web/src/lib/esplora.ts:196`

**Issue:** every distinct `base|network` key is retained forever, and the key is
participant-typed. Every other retained structure in this codebase is explicitly bounded
oldest-first (`MAX_TERMINAL`, `MAX_INTENTS`, `MAX_ACCEPTANCES`, `MAX_TEST_PEER_DIDS`,
`ACTIVITY_RING_SIZE`). This one is not, and it is also module-scoped rather than per-store,
which is the singleton shape the service side deliberately avoids everywhere.

**Fix:** bound it with the same delete-then-set idiom (a couple of dozen entries is generous for
one page session), or move it into the participant store slice so it dies with the round.

### IN-2: `parseWindow` accepts hex, exponent and signed numeric forms as minute values

**File:** `packages/web/src/lib/cohort-form.ts:52-61`

**Issue:** `Number(text)` means `"0x10"` parses as 16 minutes, `"1e3"` as 1000, and `"+5"` as 5.
The field is labelled `(minutes)` and the message promises "a whole number of minutes", so these
are quietly accepted values the operator did not mean to type.

**Fix:** shape-guard before coercing, so the parser accepts what the label describes:

```ts
if (!/^\d+$/.test(text.trim())) {
  return { kind: 'invalid' };
}
```

### IN-3: `onFinalize`'s first monitoring call sits outside its own try/catch

**File:** `packages/service/src/index.ts:1296-1303`

**Issue:**

```ts
onFinalize: (cohortId: string) => {
  monitor.noteOperatorAction(cohortId, OPERATOR_FINALIZED_TEXT);
  try {
    monitor.noteOperatorAction(finalizedCohortText(cohortId));
  } catch (err) { ... }
},
```

The first call is unguarded while its identical sibling one line below is guarded, and both
`onCancel` and `onSpawned` guard every call. It is harmless today only because
`finalizeCohort` wraps the whole `opts.onFinalize?.()` invocation
(`operator-cohorts.ts:1385-1390`), which means the asymmetry reads as an oversight rather than a
decision and would become a real hole the moment the hook is called from anywhere else.

**Fix:** move the first call inside the existing `try`, matching `onCancel`.

### IN-4: The funding-window setting is silently omitted whenever the health read has not landed

**File:** `packages/web/src/components/operator/SettingsView.tsx:142-143, 89-101`

**Issue:** `broadcasts` is `mode === 'live'`, and `mode` is `useOperator((s) => s.health?.mode)`,
which is `undefined` before the first successful list read and after `expireSession` /
`signOut`. So "the service is not broadcasting" and "we have not been told yet" collapse into
the same branch: the field is not rendered and `defaultFundingWindowMs` is dropped from the
patch. The omission direction is safe (the stored default is left alone rather than cleared),
but this is exactly the "make no claim you were not told" rule that `HealthStrip` follows with
its `Checking mode` state, and the settings form does not.

**Fix:** render the field's slot with a `Checking mode` caption while `mode === undefined`,
rather than rendering the non-broadcasting layout.

### IN-5: `advertised` and `advertisedWindows` carry no bound of their own

**File:** `packages/service/src/operator-cohorts.ts:808, 840`

**Issue:** both are pruned only by `settleCompletion`, which runs when the completion promise
settles. Every other per-cohort map in the phase (`terminal`, `dismissedCanceled`,
`windowTimers`, `intents`, the `index.ts` side tables, the monitor's maps) carries an explicit
oldest-first cap as the backstop for a cohort that reaches no terminal path. These two rely
entirely on a runner-level `cohortTtlMs` being configured; a `createService` call that omits it
(which the option's own docstring says leaves cohorts pending forever) gives them unbounded
growth under an operator-triggerable action.

**Fix:** route both through the same `rememberBounded` idiom `index.ts` already exports the
pattern for, so the backstop matches every sibling structure.

---

_Reviewed: 2026-07-30_
_Reviewer: gsd-code-reviewer_
_Depth: standard_
