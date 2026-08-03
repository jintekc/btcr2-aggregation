---
phase: 05-operator-cohort-lifecycle-control
reviewed: 2026-08-03T00:00:00Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - packages/service/src/runtime-settings.ts
  - packages/service/src/hono-adapter.ts
  - packages/service/src/index.ts
  - packages/service/src/config.spec.ts
  - packages/service/tests/lifecycle-routes.spec.ts
  - packages/service/tests/runtime-settings.spec.ts
  - packages/web/src/stores/operator.ts
  - packages/web/src/lib/operator.ts
  - packages/web/src/components/operator/SettingsView.tsx
  - packages/web/tests/operator.spec.ts
  - packages/web/tests/settings.spec.ts
  - docs/DEPLOY.md
findings:
  critical: 0
  warning: 6
  info: 6
  total: 12
status: issues_found
---

# Phase 5: Code Review Report (re-review after gap-closure round 5)

**Reviewed:** 2026-08-03
**Depth:** deep (cross-file: holder to route to served DTO to store to component; session lifecycle across `probe` / `signIn` / `signOut` / `expireSession` into all three gated read paths; boot seeding into the settings snapshot and its two browser consumers)
**Files Reviewed:** 12 (the round-5 delta `67b64c1..HEAD`, traced into `packages/service/src/demo-server.ts`, `packages/web/src/components/operator/OperatorConsole.tsx`, `packages/web/src/components/operator/CreateCohortForm.tsx`, `packages/web/src/components/operator/CohortDetail.tsx`, `packages/web/src/App.tsx`)
**Status:** issues_found

## Summary

Baseline reproduced locally: `vitest run` over the four changed spec files is 4 files / 219 tests green, and `tsc -b` is clean over the whole workspace. Every round-5 claim was checked against the shipped code and against executed repros rather than against the plan summaries.

**All five round-5 targets are genuinely closed**, and the blocker is closed properly rather than papered over:

- **CR-02 (blocker) is FIXED, and the derivation is real.** `SETTINGS_BODY_LIMIT_BYTES` is computed from `MAX_TERMS_CHARS` (`runtime-settings.ts:420-421`) and consumed by the route (`hono-adapter.ts:917-920`). I re-measured the worst legal console body independently rather than re-running the repo's arithmetic: a terms document at the cap made entirely of escape-forcing control characters, plus a 200 character name of the same, encodes to 121369 bytes against a 124096 byte budget. The 6 bytes per UTF-16 code unit multiplier is a true worst case, not a guess.
- **WR-06 is FIXED as written.** `sessionRound` is an identity, it is bumped on all four session-boundary paths, and the `refreshCohorts` guard compares it. The ABA rows in `operator.spec.ts` are real, and the anti-vacuity rows (a read issued BY the new session still writes; a new session's failed read still raises the banner) are the right shape.
- **WR-07, IN-03 and IN-04 are FIXED.** Refused seed NAMES ride the gated snapshot only, `/v1/config` is byte-identical for a service that refused something (pinned), the dead `HonoAppOptions.serviceName` path is deleted with no remaining callers (`tsc -b` green), and the retained whole-minute guard is pinned across the hostile-seed table.

The round nevertheless leaves the console's session handling **half-corrected, and one of the two gaps is in the exact lines round 5 rewrote**. `refreshCohorts` now discards a dead session's ANSWER but still acts on a dead session's `401`, so a stale unauthorized read from an ended session logs a brand new, healthy session straight back out with a message that is false (WR-08, reproduced). And the session-identity rule the round wrote into the store's own documentation ("Any guard that must decide whether an answer still belongs to the session that asked compares this, never `auth` alone") was applied to exactly one of the three gated read paths, so `pollDetail` still paints a dead session's cohort detail into a live one and `loadSettings` has no session guard at all (WR-09, both reproduced).

Two smaller defects sit inside the WR-07 fix's own copy (WR-10, IN-05): the new caption tells the operator that a refused seed can only be repaired by editing the environment and restarting, on the one surface that can repair it immediately.

## Narrative Findings (AI reviewer)

## Critical Issues

None open. CR-02's verification is under "Verification of the round-5 fixes" below.

## Warnings

### WR-08 (WARNING, NEW): A stale `401` from an ENDED session signs the NEXT session out, and the code's own comment says this cannot happen

**File:** `packages/web/src/stores/operator.ts:942-952` (the unauthorized branch, deliberately placed ahead of the round guard at `:975-977`), same shape at `:1359-1368` (`pollDetail`) and `:1277-1281` (`loadSettings`)

**Issue:**

Round 5 made `refreshCohorts` discard a dead session's ANSWER. It left the dead session's `401` acting on whoever is signed in now:

```ts
const askedInRound = get().auth === 'logged-in' ? get().sessionRound : undefined;
const result = await fetchOperatorCohorts(baseUrl);
if (result.kind === 'unauthorized') {
  get().expireSession();          // no round comparison at all
  return;
}
```

The comment defending that order (`:946-949`) states:

> Deliberately AHEAD of the round guard below, matching `pollDetail`. A guard may precede only a branch whose subject is narrower than its own; here both are session-scoped, so neither order changes what happens

The second clause is false, and it is false for exactly the reason WR-06 was filed. A `401` is evidence about the ASKING session, never about the session that happens to be live when the answer lands. Both branches are session-scoped, but they are scoped to DIFFERENT sessions.

The sequence needs nothing unusual, and the store's own comment supplies the premise: the console polls every 4000 ms against an 8000 ms timeout, so "two reads are routinely outstanding at once". When the operator's session expires server-side, BOTH outstanding reads answer `401`. The first is correct and expires the session. The operator signs straight back in (the same password-manager fill WR-06 is written around). The second `401`, issued by the session that already died, then lands and expires the new one.

Reproduced against the shipped store, no source modified:

```
$ bun /tmp/aba-401.ts
after first 401   auth: logged-out round: 2 error: "Your operator session ended. ..."
after re-login    auth: logged-in  round: 3 error: undefined
after stale 401   auth: logged-out round: 4 error: "Your operator session ended. ..."
```

What the operator sees: they sign in, the console paints, and within a second or two it throws them back to the login screen claiming "Your operator session ended" about a session that is alive and whose cookie the service would have accepted. `expireSession` clears the whole gated slice on the way out, so an open drill-down, an unsaved draft-edit form and the settings snapshot all go with it. It fails CLOSED, so this is not an authentication weakness; it is a false statement to the operator plus lost console state, on the console's least forgiving screen.

The same hole is open on `pollDetail` (`:1359-1368`) and `loadSettings` (`:1277-1281`), whose comments make the same "session-scoped, so it is fine" argument.

**Fix:** expire only the session that ASKED. The round is already captured for exactly this kind of decision.

```ts
if (result.kind === 'unauthorized') {
  // A 401 is evidence about the session that ASKED. `logged-in` to `logged-out` to `logged-in`
  // is the same string and a different session, and an answer to a dead session's question must
  // not end a live one (review WR-08).
  if (askedInRound !== undefined && get().sessionRound === askedInRound) {
    get().expireSession();
  }
  return;
}
```

`pollDetail` and `loadSettings` need the same capture-and-compare (see WR-09, which wants the capture there anyway). Pin it with a row that mirrors the ABA block: stage two reads under session A, answer the first `401`, sign back in, answer the second `401`, and assert `auth` is still `logged-in` with no `SESSION_EXPIRED` message.

### WR-09 (WARNING, NEW): The session-identity rule was applied to one of three gated read paths, and the other two still cross sessions

**File:** `packages/web/src/stores/operator.ts:1348-1387` (`pollDetail`, cohort guard only), `:1275-1289` (`loadSettings`, no guard of any kind), `:1291-1320` (`saveSettings`, same shape), with the latch it defeats at `packages/web/src/components/operator/OperatorConsole.tsx:65-69`

**Issue:**

`sessionRound`'s own docstring (`:355-369`) states the rule as general law: "Any guard that must decide whether an answer still belongs to the session that asked compares this, never `auth` alone." Only `refreshCohorts` complies.

**`pollDetail`** guards on the cohort id and nothing else, so the ABA sequence survives whenever the operator re-opens the cohort they were already watching:

```
$ bun /tmp/aba-detail.ts
after expiry  auth: logged-out view: {"kind":"list"} detail: none
after late ok auth: logged-in round: 3
  detail painted: true members: [{"did":"did:btcr2:SESSION-A-SECRET",...}]
  detailCohortId: COHORT-X lastUpdated set: true detailStale: false
```

That slot is not a summary: it carries member DIDs and pubkeys, raw signed updates, co-sign progress, the funding view (beacon address, recovery-key state, the mainnet real-money bits) and the activity ring, plus a `lastUpdated` stamp the new session never earned, which the drill-down renders as its freshness clock.

**`loadSettings` is worse, because it has no guard at all**, not even the status check the round-4 code had. A late ok read writes the settings slice into a signed-out console:

```
$ bun /tmp/aba-settings.ts
after expiry  auth: logged-out settings: cleared
after late ok auth: logged-in round: 3 settingsStatus: idle
  settings painted: true name: SESSION-A SERVICE terms: SESSION-A TERMS dropped: ["TERMS_TEXT"]
```

And that write is not transient, because it defeats the shell's once-per-session latch. `OperatorConsole` re-reads settings only while `settings === undefined` (`OperatorConsole.tsx:65-69`), so a dead session's answer landing in the gap makes the new session skip its own read entirely:

```
$ bun /tmp/latch.ts
settings defined after the dead read landed: true
shell would re-read? false
create form opens on: {"beaconType":"SMTBeacon","sizeText":"9","thresholdText":"9"}
```

The new operator then creates cohorts from the previous session's defaults (`CreateCohortForm.tsx:32-45,94-102`) and, until they happen to open Settings, never sees a value this service reported to them. Round 5 also widened what that slice carries: `droppedSeeds` is boot provenance about the operator's own environment, and it now crosses the same boundary.

**Fix:** apply the rule the round wrote down, to each path's own subject, AND to the session in every case.

```ts
// pollDetail
const askedFor = view.cohortId;
const askedInRound = get().auth === 'logged-in' ? get().sessionRound : undefined;
...
const current = get().view;
if (askedInRound === undefined || get().sessionRound !== askedInRound) { return; }
if (current.kind !== 'detail' || current.cohortId !== askedFor) { return; }
```

`loadSettings` and `saveSettings` need the capture and the comparison before their `set`. Add the two missing rows to `packages/web/tests/operator.spec.ts`: a detail poll that outlives its session and re-opens the same cohort, and a settings read that lands after an expiry (asserting both that `settings` stays undefined and that the shell would still re-read).

### WR-10 (WARNING, NEW): The refused-seed caption tells the operator to edit the environment and restart, on the one surface that can fix it now

**File:** `packages/web/src/components/operator/SettingsView.tsx:69-80` (both cost strings), rendered at `:478-480` under the two editable fields at `:291-309` and `:409-432`, against `packages/web/src/stores/operator.ts:184-185` (`SETTINGS_MODEL_LINE`)

**Issue:**

The new third caption reads, in full:

> TERMS_TEXT was set at boot, but this service refused it as too long, so the join flow has no terms step at all, and this service refuses every acceptance, **until the value is shortened and this service restarts**.

The bolded clause is false, and it is rendered directly beneath the textarea that falsifies it. `applySettings` accepts a terms document up to `MAX_TERMS_CHARS` (`runtime-settings.ts:912-915`) and, since CR-02, the route carries it, so the operator can type participation terms into the field above the caption, click Save, and have the SVC-05 acceptance gate enforcing again in this session, with no environment edit and no restart. The same overclaim is in the `serviceName` cost ("the display name stays unset until the value is shortened and this service restarts").

The caption also contradicts the sentence two cards above it on the same screen: "Changes here apply to this running service only, and a restart returns every value to its environment default." One paragraph says a restart is the remedy; the other says a restart is what UNDOES the remedy. Both are on screen at once.

The consequence is proportionate to what WR-07 was about: the disclosure exists to get the operator to act, and it points them at the slower of the two actions while implying the faster one does not exist. For the terms in particular that is time with the acceptance gate off.

**Fix:** split the two facts the sentence conflates. What the refusal costs RIGHT NOW, and what it costs after a restart.

```ts
termsText: {
  variable: 'TERMS_TEXT',
  cost:
    'the join flow has no terms step at all and this service refuses every acceptance. ' +
    'Set the terms below to restore it for this session, and shorten TERMS_TEXT so a restart keeps it',
},
```

Keep the em-dash-free contract-copy row in `settings.spec.ts` (it already enumerates both strings) and add an assertion that neither cost sentence claims a restart is required.

### WR-03 (WARNING, carried, out of scope by owner decision): `validateDraft` still accepts a non-whole-minute window, so the wedge survives on the per-draft path

**File:** `packages/service/src/operator-cohorts.ts:714-731`, consumed at `operator-cohorts.ts:1153,1224`, with the browser half at `packages/web/src/components/operator/DraftEditForm.tsx:129-152`

**Issue:** unchanged from rounds 3 and 4. The holder's `validateWindow` (`runtime-settings.ts:790-798`) enforces `ms % ONE_MINUTE_MS === 0`; `validateDraft` enforces only integrality and the one-minute floor while throwing the SAME two constants, so `POST /v1/operator/cohorts` with `discoveryWindowMs: 90000` is still stored and that draft can never be edited again from the console. The related default-path observation (a stock boot seeds `defaultDiscoveryWindowMs` and `discoveryWindowCeilingMs` from the same `cohortTtlMs`, so `armWindowTimer` never arms and the cohort lapses under the library's generic expired fate) also stands.

**Fix:** unchanged (one shared `windowProblem` predicate called by both validators), plus a decision on whether the default window should be strictly shorter than the TTL.

**Status:** out of scope by owner decision, carried for the planning record.

### WR-04 (WARNING, carried, out of scope by owner decision): The provenance barrier stops at `LifecycleActions`

**File:** `packages/web/src/components/operator/LifecycleActions.tsx:144-159` (barrier present), `packages/web/src/components/operator/CohortDetail.tsx:308-341,157-205` (barrier absent)

**Issue:** unchanged. `TestPeerAction` and `FundingStage` reason about the shared `detail` slot while acting on a `cohortId` prop, with nothing recording which cards are meant to be protected. WR-09 raises the stakes slightly: the shared slot can now hold another SESSION's document, not just another cohort's.

**Fix:** unchanged (derive `provenDetail` once at the top of `CohortDetail`).

**Status:** out of scope by owner decision, carried for the planning record.

### WR-05 (WARNING, carried, out of scope by owner decision): `lastUpdated` carries two different freshness facts

**File:** `packages/web/src/stores/operator.ts:541-542,1001,1386`, cleared at `:1334,1344`, read at `packages/web/src/components/operator/HealthStrip.tsx:66,102-103`, `ServiceControls.tsx:202`, `CohortDetail.tsx:311,335-339`

**Issue:** unchanged. One field is stamped by a LIST read and by a DETAIL poll and cleared by drill-down navigation, while three consumers read it as three different clocks. Round 5 touched both writers again without splitting it.

**Fix:** unchanged (split into `listUpdated` and `detailUpdated`).

**Status:** out of scope by owner decision, carried for the planning record.

## Info

### IN-05 (INFO, NEW): Once the operator edits a refused field, the caption goes back to asserting that the environment set nothing

**File:** `packages/web/src/components/operator/SettingsView.tsx:95-98` (the precedence rationale), `:478-481` (the branch), `:47-49` (`sourceCaption`), pinned at `packages/web/tests/settings.spec.ts:176-188`

**Issue:** the precedence decision reads:

> a field the operator has already CHANGED this session holds a value they chose, so the refusal is history about a boot value nothing on screen renders any more, and the existing changed caption is the honest one

The premise is false. The changed caption DOES render the boot value: `sourceCaption(true, envDefaultText(undefined))` produces `changed this session (environment default: not set)`. So the moment the operator types terms into a field whose `TERMS_TEXT` seed this service refused, the console goes back to making the exact affirmative false statement WR-07 was filed about, on the same field, in a different sentence. The spec row at `settings.spec.ts:176-188` pins it (`expect(markup).toContain('changed this session')` with `text: SOURCE_UNSET`).

It is INFO rather than WARNING because the operator has already acted on that field and the claim is accidentally right about what a restart yields (the seed will be refused again, so the field will indeed be unset). What is lost is the reason to go and fix the environment file, which is the harm the fix's own docstring calls "worse than getting a value wrong".

**Fix:** carry the refusal into the changed branch rather than suppressing it, for example `changed this session (environment default: refused, see TERMS_TEXT)`, or keep the precedence and change the rationale to say what is actually true.

### IN-06 (INFO, NEW): The one number in the new derivation that is still chosen is justified against a case that is not the worst one

**File:** `packages/service/src/runtime-settings.ts:376-383` (`SETTINGS_BODY_HEADROOM_BYTES` and its rationale), measured at `packages/service/tests/runtime-settings.spec.ts` (`encodedBodyBytes`), asserted in `docs/DEPLOY.md:352`

**Issue:** the headroom's docstring says "The whole non-terms body the console posts measures 184 bytes today (six short fields, all of them numbers, an enum or a 200-character name), so this is roughly twenty times what it needs." Measured against the same worst-case encoding rule the terms multiplier is derived from, the non-terms body is 1369 bytes, not 184, because a 200 character service name of control characters costs 1200. So the headroom is roughly three times what it needs, not twenty, and the whole budget clears the worst legal console body by 2727 bytes rather than by the margin the comment implies:

```
limit                         124096
ascii terms + short name      20173
ctrl terms  + ctrl name 200   121369
```

Nothing is broken today. The coupling worth recording is that the module now has one derived limit and one chosen one sitting beside each other: raise `MAX_SERVICE_NAME_CHARS` past roughly 682 and CR-02 re-opens through the NAME field, with the whole suite green, because the new measurement block varies only the terms encoding and always uses a 200 character ASCII name. `docs/DEPLOY.md:352` also now claims "that character count is the only limit either path applies", which is a byte budget short of true.

**Fix:** derive the headroom too, from the fields it has to carry, so both caps move together.

```ts
const SETTINGS_BODY_HEADROOM_BYTES =
  MAX_SERVICE_NAME_CHARS * WORST_CASE_TERMS_BYTES_PER_CODE_UNIT + 2048; // name at worst encoding, plus punctuation
```

Then add a name-at-worst-encoding row to the measurement block, and soften the DEPLOY.md sentence to name the byte budget it is really describing.

### IN-07 (INFO, NEW): `probe` takes a fresh round for a session that is already live, so a tab switch silently drops one list read

**File:** `packages/web/src/stores/operator.ts:781-800` (`probe`), against its own contract at `:355-369`, driven by `packages/web/src/components/operator/OperatorConsole.tsx:43-45` and `packages/web/src/App.tsx:112-117`

**Issue:** `sessionRound`'s docstring claims "a round identifies exactly one session, live or ended". `probe` bumps on every landing of `logged-in`, including when the SAME session is already signed in, so a round really identifies a probe-or-sign-in EVENT. `OperatorConsole` is mounted conditionally on the operator tab (`App.tsx:113`), so every switch away and back re-runs `probe`, retires the live session's round, and discards any list read that was in flight across the switch. Today the cost is one skipped update (no stale banner, no wrong data) because the poll re-fires 4000 ms later; the reason to record it is that the field's stated meaning and its behavior differ, and WR-08/WR-09 both want to lean on that meaning.

**Fix:** bump only on a transition into a live session (`if (get().auth !== 'logged-in') { ... }`), or correct the docstring to say the round identifies a session START rather than a session.

### IN-08 (INFO, NEW): `CreateServiceOptions.serviceName` still documents itself as a constant with no edit surface

**File:** `packages/service/src/index.ts:426-433`, consumed at `:670`

**Issue:** the option's docstring says "A boot-time constant ... Display text only (no edit surface, no markup)". Since D-16 the name is runtime-editable behind `PUT /v1/operator/settings`, and after round 5 this option's ONLY consumer is the holder seed at `:670`, so it is a seed, not a constant. Round 5 edited the lines immediately below it (removing the `createHonoApp` threading) and left the neighbouring claim contradicting the shipped behavior, in a codebase whose convention is that these comments are the contract.

**Fix:** reword to "boot SEED for the runtime settings holder (runtime-editable, D-16)", matching the block directly beneath it that already describes the other six seeds that way.

### IN-01 (INFO, carried, out of scope by owner decision): `numericKnob` coerces environment strings with bare `Number()`

**File:** `packages/service/src/runtime-settings.ts:110`

**Issue:** unchanged. `DEFAULT_SIZE=0x10` stores 16, `DEFAULT_SIZE=1e3` stores 1000, `PORT=+8080` stores 8080, each silently, each passing `Number.isInteger`.

**Fix:** unchanged (shape-guard the string form before coercing).

**Status:** out of scope by owner decision, carried for the planning record.

### IN-02 (INFO, carried, out of scope by owner decision): `parseWindow` has no upper bound

**File:** `packages/web/src/lib/cohort-form.ts:52-61`, reaching `packages/service/src/operator-cohorts.ts:867-889`

**Issue:** unchanged. Not reachable on the documented deploy path (`demo-server.ts` always resolves a TTL); recorded as latent.

**Fix:** unchanged (bound the parser, and refuse a delay above `2_147_483_647` in `armWindowTimer` explicitly).

**Status:** out of scope by owner decision, carried for the planning record.

## Known-deferred findings (owner scoped OUT in earlier rounds)

Re-observed and confirmed still present. Recorded here rather than as new discoveries:

- **Prior WR-5:** the endpoint verdict cache is still never cleared in shipped code (`clearEndpointCache` has callers only in `packages/web/tests/tx-client.spec.ts`).
- **Prior WR-6:** `packages/web/src/lib/tx-client.ts` still carries no `AbortSignal.timeout`.
- **Prior IN-1:** `verdictCache` is still an unbounded module-level singleton keyed by participant-typed input.
- **W4 carried items** (`/cas` prototype-pollution 500, seat cap) unchanged.

## Verification of the round-5 fixes

- **CR-02 (blocker): FIXED, and derived rather than chosen.** `SETTINGS_BODY_LIMIT_BYTES` lives beside the cap it comes from (`runtime-settings.ts:385-421`) and the route consumes it (`hono-adapter.ts:917-920`). I measured the worst legal console body independently: 121369 bytes against a 124096 byte budget, with the 6 bytes per UTF-16 code unit multiplier confirmed as a true bound (control characters escape to six ASCII characters; every other class is cheaper, and a surrogate pair costs four bytes across two code units). The route-level rows are the right shape: a full console-shaped patch at the cap is accepted (status asserted NOT 413 AND the stored value asserted, so a route that accepted and dropped would fail), a three-byte script at the cap is the anti-vacuity control that kills the smaller multiplier, the rename-with-terms-stored row is the operator's actual complaint, one character past the cap now earns the FIELD's message naming the limit, and the 413 row was raised rather than deleted so the streaming bound stays proven. The three numbers that disagreed now agree, and `docs/DEPLOY.md:348-358,513` matches observed behavior (with the one overclaim noted in IN-06).
- **WR-06: FIXED as written.** `sessionRound` is bumped in `signIn` (200 only), `probe` (`logged-in` only), `signOut` and `expireSession`, and the guard compares identity plus status. The ABA rows cover both ways a session can end, assert across the whole gated slice rather than one field, and are guarded against vacuity by the still-writes row and the still-raises-the-banner row. What the fix does NOT cover is the `401` direction of the same race (WR-08) and the two sibling read paths (WR-09).
- **WR-07: FIXED in substance.** `droppedSeeds` carries NAMES only (asserted against the serialized snapshot, so a carrier stashing the text elsewhere fails), is served only behind the operator gate, adds nothing to `/v1/config` (asserted with an exact `toEqual` against a clean service, not a key-set check), records nothing in the operator-actions ring, and is a fresh array per read. `SettingsFieldKey` keeps `SETTING_LABELS` and `recordSettingsChanges` walking exactly the seven settings, and `tsc -b` proves the narrowing compiles rather than being cast past. The residual defects are in the CAPTION copy, not the carrier (WR-10, IN-05).
- **IN-03: FIXED.** `HonoAppOptions.serviceName` is gone, `createService` no longer threads it, `/v1/config` reads the holder alone, `config.spec.ts` moved its row onto `holderApp` while keeping the served-body assertion byte for byte, and no other `createHonoApp` caller passed the option (28 call sites checked, `tsc -b` green). The bound now holds by construction rather than by shadowing.
- **IN-04: FIXED.** The retained last-write guard is pinned across `HOSTILE_SEEDS` by an observable property (at most one whole-minute line about `defaultDiscoveryWindowMs`, plus the stored value asserted whole-minute), so a future second writer that makes it fire turns the row red instead of landing silently.

---

_Reviewed: 2026-08-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
