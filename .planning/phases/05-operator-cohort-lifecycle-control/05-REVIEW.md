---
phase: 05-operator-cohort-lifecycle-control
reviewed: 2026-08-03T00:00:00Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - packages/service/src/runtime-settings.ts
  - packages/service/tests/runtime-settings.spec.ts
  - packages/service/src/demo-server.ts
  - packages/web/src/stores/operator.ts
  - packages/web/tests/operator.spec.ts
  - docs/DEPLOY.md
findings:
  critical: 1
  warning: 5
  info: 4
  total: 10
status: issues_found
---

# Phase 5: Code Review Report (re-review after gap-closure round 4)

**Reviewed:** 2026-08-03
**Depth:** deep (cross-file: holder to `createService` to `hono-adapter` route to `SettingsView` patch builder; store to `OperatorConsole` poll loop; docs against the code they describe)
**Files Reviewed:** 6 (the round-4 file set, traced into `packages/service/src/index.ts`, `packages/service/src/hono-adapter.ts`, `packages/service/src/operator-cohorts.ts`, `packages/service/tests/lifecycle-routes.spec.ts`, `packages/web/src/components/operator/SettingsView.tsx`, `packages/web/src/components/operator/OperatorConsole.tsx`, `packages/web/src/lib/operator.ts`)
**Status:** issues_found

## Summary

Baseline reproduced locally: `vitest run packages/web/tests/operator.spec.ts packages/service/tests/runtime-settings.spec.ts` is 2 files / 110 tests green. The round-4 diff against `27bc519` is 6 files; `demo-server.ts` is comments only, and `packages/service` was untouched by 05-32, both confirmed by reading the diff.

All three round-4 targets were verified against the shipped code and against executed repros, not against the plan summaries. Two are genuinely closed; one is closed only for the band it was written about.

- **CR-01 is fixed as written.** `textKnob` (`runtime-settings.ts:363-382`) drops and warns rather than truncating, both seeds route through it, and a boot with a 5000 character name plus a 100000 character terms document now warns twice, stores neither, and leaves a size-only save working. Verified by running the module.
- **WR-01 is fixed for the case it described, and NOT for the ABA case the fix's own wording claims.** The guard compares an auth STATUS, not a session identity, so a read issued by a dead session still writes if the operator signs back in before it lands. Reproduced against the shipped store. Recorded as WR-06.
- **WR-02 is fixed.** The `COHORT_TTL_MS=90000` boot now prints exactly one warning, that warning is true, and it names `COHORT_TTL_MS` and `DEFAULT_DISCOVERY_WINDOW_MS` rather than only an internal field. I re-derived the reorder proof independently: flooring is monotone and the ceiling is quantized first, so for a seed at or below the ceiling both orders yield the floored seed, and for a seed above it both yield the ceiling. Value-preserving confirmed.

The round also left a BLOCKER standing. `textKnob` closed the "over 20000 characters" door into the settings wedge, but the same wedge is still wide open through the gated route's 4 KiB body limit at roughly 3900 characters, and round 4's own DEPLOY.md edit now tells operators that 20000 is a supported value. That is CR-02, and it means the CR-01 harm (every settings save refused behind a message about a field the operator never touched) survives with a realistic terms document.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-02 (BLOCKER): A terms document over roughly 3900 characters still wedges every settings save, and round 4's docs now advertise 20000

**File:** `packages/service/src/hono-adapter.ts:898-905` (the 4 KiB route limit), `packages/service/src/runtime-settings.ts:301,774-777` (the 20000 character holder cap), `packages/web/src/components/operator/SettingsView.tsx:88-105` (the patch always carries the terms), `docs/DEPLOY.md:351-355,509` (the round-4 claim), pinned as correct at `packages/service/tests/lifecycle-routes.spec.ts:577-582`

**Issue:**

Three different limits govern one field, and they do not agree:

| Path | Limit | Enforced where |
|---|---|---|
| `TERMS_TEXT` boot seed | 20000 characters, dropped above | `textKnob`, `runtime-settings.ts:615-623` |
| `applySettings` | 20000 characters, refused above | `runtime-settings.ts:774-777` |
| `PUT /v1/operator/settings` | 4096 BYTES of whole request body | `bodyLimit`, `hono-adapter.ts:904` |

The console posts the WHOLE form on every save, by design (`settingsPatch` at `SettingsView.tsx:88-105` always includes `termsText: form.termsText`, seeded from the served snapshot at `formFromSnapshot`, line 77). So the body carries the stored terms whether or not the operator touched them. Measured against the real patch shape:

```
$ bun -e '...'
patch overhead without terms: 184 bytes
terms 3900 chars -> body 4084 bytes -> accepted
terms 4000 chars -> body 4184 bytes -> 413 request too large
terms 8000 chars -> body 8184 bytes -> 413 request too large
terms 20000 chars -> body 20184 bytes -> 413 request too large
```

The 413 is not a hypothetical: `packages/service/tests/lifecycle-routes.spec.ts:577-582` already pins it for an 8 KiB terms body against the real gated app, and treats it as correct behavior.

The operator consequence is exactly the CR-01 harm, unchanged, at a value 05-31 explicitly made storable. Set `TERMS_TEXT` to a 5000 character participation document (roughly 850 words, well inside the documented cap). The holder accepts and serves it. The join flow works. Then the operator opens Settings to rename the service, and the save is refused with `request too large`, a message that names no field, no limit and no remedy. Every later save fails the same way, whichever field they edit, until the service is restarted with shorter terms. `applySettings`'s own terms cap and its carefully worded message (`Participation terms must be 20000 characters or fewer.`) are unreachable over HTTP: no request that could trip them survives the body limit.

Round 4 made this worse in the documentation. `docs/DEPLOY.md:351-355`, added by 05-31, states:

> The terms are capped at **20000 characters** (roughly 3500 words), on both paths that set them. A runtime save above the cap is refused with the limit named.

Both sentences are false. The cap is not the binding limit on either runtime path, and a runtime save above roughly 3900 characters is refused with `request too large`, not with the limit named. `docs/DEPLOY.md:509` repeats the 20000 figure for `TERMS_TEXT` with no mention of the save consequence, so an operator following the reference lands directly in the wedge.

This also undercuts the invariant 05-31 wrote into the source in capitals. The rule as stated is "no seed this holder ACCEPTS may be a value `applySettings` would REFUSE". `applySettings` accepts 20000, so the holder does too, and the surface that CALLS `applySettings` refuses at 3900. The invariant is true of the holder in isolation and false of the system.

**Fix:** make the three numbers one number, derived once, the same rule 05-31 applied when it put `textKnob` beside `numericKnob` instead of in `demo-server.ts`. Either direction closes it; the first preserves the shipped 20000 product decision.

```ts
// runtime-settings.ts, exported beside MAX_TERMS_CHARS.
/**
 * The settings body budget: the terms cap plus generous headroom for every other field and for
 * JSON escaping. The ROUTE limit must be derived from the field cap, never chosen independently,
 * or the cap the holder documents becomes unreachable and its refusal message becomes dead code.
 */
export const SETTINGS_BODY_LIMIT_BYTES = MAX_TERMS_CHARS * 2 + 4096;
```

```ts
// hono-adapter.ts:904
bodyLimit({ maxSize: SETTINGS_BODY_LIMIT_BYTES, onError: (c) => c.json({ error: 'request too large' }, 413) }),
```

The alternative, if the 4 KiB budget is the value worth keeping, is to lower `MAX_TERMS_CHARS` to something that fits under it, and to change `textKnob`'s `TERMS_TEXT` bound and both DEPLOY.md figures in the same edit so all four agree.

Pin it where it broke: add a `lifecycle-routes.spec.ts` row that PUTs a full console-shaped patch (`serviceName`, `defaultBeaconType`, `defaultSize`, `defaultThreshold`, both windows) carrying a terms document at exactly `MAX_TERMS_CHARS`, and assert the status is NOT 413, so the field cap is what answers. Keep the existing 413 row, raising its body past the new limit, so the streaming bound stays proven. Then correct `docs/DEPLOY.md:351-355` and `:509`.

## Warnings

### WR-06 (WARNING): The `refreshCohorts` guard compares an auth STATUS, not a session, so a dead session's answer still repaints a new session

**File:** `packages/web/src/stores/operator.ts:899,926-928`, with the untested gap at `packages/web/tests/operator.spec.ts:402-680`

**Issue:**

05-32 added the guard the round-3 report asked for, and it closes the case that report reproduced. It does not close the case its own comment claims:

```ts
// Both halves are wanted: the capture rejects an answer to a question no live session asked,
// and the re-check rejects an answer that outlived the session that did ask.
if (!askedWhileLive || get().auth !== 'logged-in') {
  return;
}
```

`askedWhileLive` is a boolean derived from a STATUS, and the re-check compares that same status. `logged-in` to `logged-out` to `logged-in` is ABA: nothing in the store carries a session identity or a round counter, so an answer that genuinely outlived its session passes both halves the moment a NEW session is signed in. Compare the shipped precedent it cites: `pollDetail` (line 1308, 1326-1329) captures a cohort ID and compares IDENTITY, which is why that guard is sound.

Reproduced against the shipped store, no source modified:

```
$ bun /tmp/aba.ts
after expiry   auth: logged-out cohorts: 0
after late ok  auth: logged-in cohorts: 1 health: {"mode":"live","esploraReachable":true,"paused":false} metrics: {"open":1,...} lastUpdated set: true
```

The window is the ordinary one the fix's own comment describes: 4000 ms poll, 8000 ms timeout. The sequence is a session expiry, an operator signing straight back in (a password manager fill is a second or two), and the previous session's read landing into the new one. The new session then renders the old session's cohort list, metrics, operator log, cohort defaults and the broadcast-mode chip, and gets a `lastUpdated` stamp it never earned, so the health strip captions all of it as fresh. That is the same claim about whether this service can move money that the fix's comment names as the reason the guard exists, and `SESSION_EXPIRED` still promises the operator that "Monitoring rebuilds from this service's state after you sign in".

The new spec block is thorough about everything it covers, including a genuine anti-vacuity control (the still-writes row and the still-raises-the-banner row). It has no ABA row, which is why this passed green.

**Fix:** guard on identity, not status, exactly as `pollDetail` does.

```ts
/** Monotonic session round: bumped on every sign-in and on every path that ends a session. */
sessionRound: number;
```

Bump it in `signIn` (on 200), in `probe` (on `logged-in`), in `expireSession` and in `signOut`, then:

```ts
const askedIn = get().auth === 'logged-in' ? get().sessionRound : undefined;
const result = await fetchOperatorCohorts(baseUrl);
if (result.kind === 'unauthorized') { get().expireSession(); return; }
// Identity, not status: `logged-in` to `logged-out` to `logged-in` is the same string and a
// different session, and a list read is evidence about exactly one of them.
if (askedIn === undefined || get().sessionRound !== askedIn || get().auth !== 'logged-in') { return; }
```

Add the missing row to `packages/web/tests/operator.spec.ts`: stage a slow ok, expire the session with a fast 401, sign back in, settle the slow read, and assert the gated slice and `lastUpdated` are still empty.

### WR-07 (WARNING): Dropping an over-long `TERMS_TEXT` silently disables the SVC-05 acceptance gate, and the console then captions the empty field as the environment default

**File:** `packages/service/src/runtime-settings.ts:615-623`, read at `packages/service/src/hono-adapter.ts:631,802`, captioned at `packages/web/src/components/operator/SettingsView.tsx:43-50,348`

**Issue:**

The drop-rather-than-truncate choice is right, and the reasoning in `textKnob`'s docstring about DID-signed acceptance of a mutilated document is correct. The DISCLOSURE around it is not finished, and terms are not an ordinary display field: they are a gate.

With the terms dropped, `hono-adapter.ts:307` sees no terms and refuses every acceptance, `GET /v1/config` omits the key, and the web join flow has no terms step. An operator who configured a DID-signed acceptance requirement is now running a service that does not require it. The only record of that is one `console.warn` line at boot.

The console gives them nothing to notice it with, and worse, gives them a false fact. `textKnob` returns `undefined`, `field()` sets `value` and `envDefault` to the same `undefined`, so `project()` computes `changed: false` (line 636) and `SourceCaption` renders `SOURCE_ENV_DEFAULT` (`SettingsView.tsx:43-45,372-377`). The settings surface therefore tells the operator that this service's ENVIRONMENT DEFAULT for the terms is unset, when the environment set 100000 characters of terms. That is the same class of dishonest caption the module's own clamp comment (lines 548-557) identifies as a defect worth fixing: "The gated settings read served the over-ceiling number with `changed: false`, so the console captioned as this service's `env default` a window the runner's own TTL would overrule."

The numeric seeds share the pattern (a malformed `DEFAULT_SIZE` falls back to 2 and captions as `env default`), which is why this is a WARNING rather than a BLOCKER. The stakes differ: falling back to a cohort size of 2 is a visible default, while falling back to no terms turns an enforcement control off.

**Fix:** keep the drop, surface it. The cheapest honest version is to carry the boot degradations into the served snapshot the console already renders:

```ts
/** Seeds this service REFUSED at boot, so the console can caption a dropped field honestly. */
readonly droppedSeeds: readonly string[];
```

Populated by `textKnob` (and, if the same treatment is wanted, by `numericKnob`), served on `GET /v1/operator/settings`, and rendered by `SourceCaption` as a bad-tone line in place of `env default` naming the variable and what it cost. Failing that, record it through the operator-actions log so it appears somewhere an operator looks after boot. Pin the caption in `SettingsView`'s spec so a dropped field can never render as `env default` again.

### WR-03 (WARNING, carried, out of scope by owner decision): `validateDraft` still accepts a non-whole-minute window, so the wedge survives on the per-draft path

**File:** `packages/service/src/operator-cohorts.ts:714-731`, consumed at `operator-cohorts.ts:1153,1224`, with the browser half at `packages/web/src/components/operator/DraftEditForm.tsx:129-152`

**Issue:** unchanged from round 3 and re-verified. The holder's `validateWindow` (`runtime-settings.ts:652-660`) enforces `ms % ONE_MINUTE_MS === 0`; `validateDraft` (`operator-cohorts.ts:716-721`) enforces only integrality and the one-minute floor, and throws the SAME two constants. `POST /v1/operator/cohorts` with `discoveryWindowMs: 90000` is still accepted and stored, `msToMinutesText` renders it `"1.5"`, `parseWindow` calls that invalid, and `validateCohortForm` runs over the whole form, so that draft can never be edited again from the console.

One observation added this round, because round 4 made it easier to check. The related off-by-one (`validateDraft`'s ceiling is `>`, `armWindowTimer` refuses to arm at `>=`, `operator-cohorts.ts:871`) is not an edge case reachable only by an operator typing the TTL exactly. It is the DEFAULT path: `index.ts:674` seeds `defaultDiscoveryWindowMs` from `opts.cohortTtlMs`, `:680` seeds `discoveryWindowCeilingMs` from the same value, and `createDraft` fills an absent window from the stored default (`operator-cohorts.ts:1153,775`). Verified:

```
default==ttl stored: 1800000   save to ttl -> undefined (accepted)
```

So on a stock boot every draft inherits a discovery window equal to the cohort TTL, `armWindowTimer` returns early, no app timer is armed, and the cohort lapses under the library's generic expired fate rather than the app's `window-expired` reason. `armWindowTimer`'s own docstring argues this is deliberate and harmless, which is defensible for the timer; the terminal-reason difference is what is worth deciding on record.

**Fix:** unchanged from round 3 (one shared `windowProblem` predicate called by both validators), plus a decision on whether the default window should be strictly shorter than the TTL so the app's own reason can fire.

**Status:** out of scope by owner decision, carried for the planning record.

### WR-04 (WARNING, carried, out of scope by owner decision): The provenance barrier stops at `LifecycleActions`

**File:** `packages/web/src/components/operator/LifecycleActions.tsx:144-159` (barrier present), `packages/web/src/components/operator/CohortDetail.tsx:308-341,157-205` (barrier absent)

**Issue:** unchanged from round 3. `TestPeerAction` takes `cohortId` as a prop, reasons about `remaining` and `live` derived from the shared `detail` slot, and fires `addTestPeers(baseUrl, cohortId)` behind a confirm that says test peers "co-sign for real and their DIDs are anchored on {network}". `FundingStage` has the same split. Not a live bug while `pollDetail`'s round guard holds, but a defense-in-depth inconsistency with nothing recording which cards are meant to be protected.

**Fix:** unchanged from round 3 (derive `provenDetail` once at the top of `CohortDetail`).

**Status:** out of scope by owner decision, carried for the planning record.

### WR-05 (WARNING, carried, out of scope by owner decision): `lastUpdated` carries two different freshness facts

**File:** `packages/web/src/stores/operator.ts:519-520,952,1337`, cleared at `:1285,1295`, read at `packages/web/src/components/operator/HealthStrip.tsx:66,102-103`, `ServiceControls.tsx:202`, `CohortDetail.tsx:311,335-339`

**Issue:** unchanged from round 3, and 05-32 touched the field without splitting it, so all three mismatched consumers stand. One field is stamped by a LIST read (line 952) and by a DETAIL poll (line 1337) and cleared by drill-down navigation, while `HealthStrip` uses it to date `health` (list-only), `ServiceControls` uses its presence as "a read has landed this session", and `CohortDetail` reads it as the detail clock.

**Fix:** unchanged from round 3 (split into `listUpdated` and `detailUpdated`).

**Status:** out of scope by owner decision, carried for the planning record.

## Info

### IN-03 (INFO): `createHonoApp` keeps an unbounded second `serviceName` path, so the new "lives once" comment is true only by shadowing

**File:** `packages/service/src/demo-server.ts:398-406` (the round-4 comment), `packages/service/src/index.ts:1373`, `packages/service/src/hono-adapter.ts:442,630`

**Issue:** the comment added by 05-31 says the length bound "lives once inside `createRuntimeSettings`, where every seed path meets". `createHonoApp` still takes its own `serviceName` option, `createService` still threads the raw unbounded value into it (`index.ts:1373`), and `/v1/config` resolves `runtimeSettings ? runtimeSettings.serviceName.value : serviceName` (`hono-adapter.ts:630`). Production is safe because `createService` always constructs the holder, so the fallback is unreachable there, but it is live for any direct `createHonoApp` caller (`config.spec.ts:18-22` is one) and it serves an unbounded name. A guard that holds by shadowing is a guard a future refactor can drop without failing anything.

**Fix:** either delete the `serviceName` option from `createHonoApp` and require the holder, or route the fallback through the same bound. If the option stays for the test-only shape, say so in its docstring rather than in `demo-server.ts`.

### IN-04 (INFO): The retained last-write guard is dead on every reachable path

**File:** `packages/service/src/runtime-settings.ts:576-586`

**Issue:** after the reorder, `clampedDiscoveryWindowMs` is either the already-quantized ceiling or the already-floored seed, so the third `floorToWholeMinute` call can never change a value or emit a line. The comment says exactly this and argues for keeping it as the place the invariant is enforced, which is a reasonable position; the cost is dead code that no test can distinguish from its own deletion.

**Fix:** keep it and pin it (assert over `HOSTILE_SEEDS` that this call is a no-op, so a future second writer that makes it fire is a visible change), or delete it and move its reasoning to the clamp.

### IN-01 (INFO, carried, out of scope by owner decision): `numericKnob` coerces environment strings with bare `Number()`

**File:** `packages/service/src/runtime-settings.ts:110`

**Issue:** unchanged. `DEFAULT_SIZE=0x10` stores 16, `DEFAULT_SIZE=1e3` stores 1000, `PORT=+8080` stores 8080, each silently, each passing `Number.isInteger`. The server-side twin of IN-02.

**Fix:** unchanged from round 3 (shape-guard the string form before coercing).

**Status:** out of scope by owner decision, carried for the planning record.

### IN-02 (INFO, carried, out of scope by owner decision): `parseWindow` has no upper bound

**File:** `packages/web/src/lib/cohort-form.ts:52-61`, reaching `packages/service/src/operator-cohorts.ts:867-889`

**Issue:** unchanged. `parseWindow('99999999')` yields 5.99e12 ms, accepted by `validateDraft` as an integer; `armWindowTimer` only skips arming when a `cohortTtlMs` is configured, so a `createService` caller that omits it reaches `setTimeout` with an overflowing delay. Not reachable on the documented deploy path (`demo-server.ts:268` always resolves a TTL). Recorded as latent.

**Fix:** unchanged from round 3 (bound the parser, and refuse a delay above `2_147_483_647` in `armWindowTimer` explicitly).

**Status:** out of scope by owner decision, carried for the planning record.

## Known-deferred findings (owner scoped OUT in earlier rounds)

Re-observed and confirmed still present. Recorded here rather than as new discoveries:

- **Prior WR-5:** the endpoint verdict cache is still never cleared in shipped code. `clearEndpointCache` (`packages/web/src/lib/esplora.ts:219`) has callers only in `packages/web/tests/tx-client.spec.ts`.
- **Prior WR-6:** `packages/web/src/lib/tx-client.ts` still carries no `AbortSignal.timeout`, so the two participant-supplied chain calls remain unbounded.
- **Prior IN-1:** `verdictCache` (`packages/web/src/lib/esplora.ts:216`) is still an unbounded module-level singleton keyed by participant-typed input.
- **W4 carried items** (`/cas` proto-pollution 500, seat cap) unchanged.

## Verification of the round-4 fixes

- **CR-01: FIXED as written, and superseded by CR-02.** Verified by running the shipped module: a 5000 character `SERVICE_NAME` plus a 100000 character `TERMS_TEXT` produce two distinct warnings naming both lengths and the consequence, store neither value, and leave `applySettings({ defaultSize: 3 })` succeeding. Boundary checked at exactly 200 and exactly 20000 (stored, silent) and at 201 (dropped, one warning). The spec's `expectHolderInvariants` free-text loop is real rather than vacuous because the at-ceiling rows would fail a helper that dropped everything. The bound is enforced on the production read path: `/v1/config` prefers the holder (`hono-adapter.ts:630`) and the terms-acceptance route reads the holder per request (`:802`). What the fix does NOT cover is the route-limit door into the same wedge, at a value 05-31 made storable and DEPLOY.md now recommends (CR-02).
- **WR-01: FIXED for the described case, NOT for the ABA case.** The fast-401-then-slow-ok race is genuinely closed and the new spec block proves it across the gated slice, the freshness pair, the sign-out variant, the pre-await half and a negative control on the D-25 banner. The guard's subject is a status rather than an identity, so a re-sign-in inside the 8000 ms window still admits a dead session's write (WR-06, reproduced).
- **WR-02: FIXED.** `COHORT_TTL_MS=90000` now prints exactly one warning, it is true of the number it names, and it names `DEFAULT_DISCOVERY_WINDOW_MS` and `COHORT_TTL_MS`. The reorder proof was re-derived independently and holds on all four cases; the spec's property row over `HOSTILE_SEEDS` (stored value unchanged, never longer than the seed) is the right shape of evidence for "only the warnings moved", and the still-clamps row is a real anti-vacuity control. The remaining label (`defaultDiscoveryWindowMs=...`) is an internal field name, but the appended `Set it with ...` clause makes the line actionable, which was the substance of the finding.
- **demo-server.ts:** comments only, confirmed against the diff. The claim inside those comments is what IN-03 qualifies.
- **docs/DEPLOY.md:** the `SERVICE_NAME`, `DEFAULT_DISCOVERY_WINDOW_MS` and `COHORT_TTL_MS` rows now match observed behavior (each verified by running the holder). The `TERMS_TEXT` row and the new terms paragraph do not (CR-02).

---

_Reviewed: 2026-08-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
