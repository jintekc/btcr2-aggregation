---
phase: 05-operator-cohort-lifecycle-control
reviewed: 2026-08-03T18:30:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - packages/web/src/stores/operator.ts
  - packages/web/src/components/operator/SettingsView.tsx
  - packages/service/src/runtime-settings.ts
  - packages/service/src/index.ts
  - packages/web/tests/operator.spec.ts
  - packages/web/tests/settings.spec.ts
  - packages/service/tests/runtime-settings.spec.ts
  - docs/DEPLOY.md
findings:
  critical: 1
  warning: 5
  info: 8
  total: 14
status: issues_found
---

# Phase 5: Code Review Report (re-review after gap-closure round 6)

**Reviewed:** 2026-08-03
**Depth:** deep (cross-file: holder caps to route body limit to served DTO to caption; the whole operator session lifecycle from `probe` / `signIn` / `signOut` / `expireSession` into all four gated read paths and the nine one-shot action paths; boot seeding into `GET /v1/config`)
**Files Reviewed:** 8 (the round-6 delta `90cc28e..HEAD`, traced into `packages/service/src/hono-adapter.ts`, `packages/web/src/lib/operator.ts`, `packages/web/src/components/operator/OperatorConsole.tsx`, `packages/web/src/App.tsx`, `packages/web/src/main.tsx`, `packages/service/src/demo-server.ts`)
**Status:** issues_found

## Summary

Baseline reproduced locally: `vitest run` over the three changed spec files is 3 files / 192 tests green. Every round-5 finding was checked against the shipped code, and every claim in this report that could be executed was executed against the unmodified store rather than argued from the source.

**All seven round-5 targets are genuinely closed.** WR-08 now carries a real capture-and-compare on all four gated reads, WR-09 guards `pollDetail`, `loadSettings` and `saveSettings` on the session as well as their own subject, WR-10 splits the cost from the remedy and names the in-session repair first, IN-05 carries the refusal into the changed caption's parenthetical, IN-06 derives the whole byte budget from both caps through an exported function the spec exercises over cap PAIRS, IN-07 makes the probe bump a transition, and IN-08 rewords the `serviceName` option to the seed it actually is. The arithmetic was re-derived independently: the largest legal console body is 121369 bytes against a 122224 byte budget, 855 bytes of slack, matching the docstring byte for byte. The new spec rows are non-vacuous, each refusal row is paired with a still-writes control, and the settings-surface rows now seed a live session instead of the impossible `checking` console they used to stage.

The round nevertheless **leaves the widest door of the WR-08/WR-09 defect class standing, and it is in the exact method round 6 rewrote**. `probe` is the one path that can discover a session has ENDED without a `401` from a read, and it neither retires the round nor clears the gated slice. Reproduced with no source modified: after the probe finds the cookie dead, the next sign-in opens on the previous session's cohort list, metrics, operator-actions log, broadcast-mode chip and drill-down document (member DIDs included), and the shell's once-per-session settings latch never re-reads at all, so the new session's create form runs on the old session's defaults. This is not a race. It is a tab switch after an idle expiry (CR-03).

Second, the IN-07 transition condition is decided from a snapshot taken before the probe's round trip, so two overlapping probes still bump the round and still discard the in-flight read the fix's own spec row pins. React StrictMode is enabled in `main.tsx`, which double-invokes the mount effect in development, so this fires on every console mount in dev (WR-11). Reproduced.

Third, `advertise` and `readvertise` still collapse a `401` into "Could not advertise the draft. Try again.", so two of the console's most-used buttons violate the D-16 rule the rest of the store now holds (WR-12).

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-03 (BLOCKER, NEW): `probe` ends a session without retiring its round or clearing its state, so the next sign-in opens on the previous session's console

**File:** `packages/web/src/stores/operator.ts:813-817` (the `logged-out` / `disabled` branch) and `:818-822` (the transport-fault branch), against the field contract at `:361-368`, driven by `packages/web/src/components/operator/OperatorConsole.tsx:43-45` and `packages/web/src/App.tsx:113-114`, with the latch it defeats at `OperatorConsole.tsx:64-69`

**Issue:**

`sessionRound`'s docstring, edited in this round, states the rule the three new guards lean on:

> Bumped on every path that makes a session LIVE ... and on every path that ENDS one (`signOut`, `expireSession`).

There is a third path that ends one, and it is in this same method. `OperatorConsole` is mounted conditionally on the operator tab, so a switch away and back re-runs `probe`. If the session cookie expired while the operator was on the participant tab (where nothing polls, so no `401` is ever seen), the probe is what discovers it, and the discovery does nothing except set a string:

```ts
} else {
  // `logged-out` and `disabled` start no session, so neither takes a round: a round retired
  // by a probe no session ever held would be a number that identifies nothing.
  set({ auth: state });
}
```

The comment reasons about a session that never existed. It is also reached when a live session just died, and on that path the reasoning is inverted: a session ended, its round is not retired, its gated slice is not cleared, and `view` is not reset. `signIn` clears none of that either (`:825-844`), so the next session inherits all of it.

Reproduced against the shipped store, no source modified:

```
$ bun /tmp/probe-logout.ts
after probe   auth: logged-out round: 1
  retained cohorts: [{"id":"A-COHORT"}] health: {"mode":"live","network":"mainnet"}
  retained settings: {"serviceName":{"value":"SESSION-A SERVICE",...}}
  retained detail: {"members":[{"did":"did:btcr2:SESSION-A-SECRET"}]} lastUpdated: 1234
after signIn  auth: logged-in round: 2
  session B renders cohorts: [{"id":"A-COHORT"}]
  session B renders health chip: {"mode":"live","network":"mainnet"}
  session B renders operator log: [{"text":"session A paused advertising"}]
  session B settings defined? true -> shell re-reads? false
  session B settings name: SESSION-A SERVICE
```

Four consequences, in order of how long they last:

1. **The settings snapshot never refreshes for the new session.** `OperatorConsole.tsx:64-69` re-reads settings only while `settings === undefined`. It is defined, so the latch never fires, and the create form opens on a previous session's defaults indefinitely (until the operator happens to open the Settings view, whose own mount effect re-reads). This is the exact harm WR-09's fix cites as its reason for existing, reached with no race at all.
2. **The health strip renders a previous session's broadcast mode.** If the service was restarted between the two sessions (the ordinary reason a cookie stops being accepted), the mode chip is a claim about whether this service can move Bitcoin, carried over from a boot that is gone. It is corrected only when `signIn`'s list read lands.
3. **The drill-down opens straight onto the dead session's document.** `view` is not reset, so if the operator was in a cohort detail when the probe ran, session B mounts `CohortDetail` on session A's members, pubkeys, signed updates and funding view, with a `lastUpdated` freshness stamp session B never earned.
4. **An in-flight read issued by the dead session still writes**, because the round it captured still matches. Only `refreshCohorts` has a status check to save it; `pollDetail`, `loadSettings` and `saveSettings` compare the round alone (by design, per the round-6 comments):

```
$ bun /tmp/probe-logout2.ts
after probe auth: logged-out round: 1 view: {"kind":"detail","cohortId":"COHORT-X"}
A detail painted into a signed-out console? true detailCohortId: COHORT-X lastUpdated set: true
after signIn auth: logged-in round: 2 view: {"kind":"detail","cohortId":"COHORT-X"}
  session B opens straight onto: {"members":[{"did":"did:btcr2:SESSION-A-SECRET"}]}
```

The transport-fault branch at `:818-822` has the same retention with a different truth value: a network fault is not evidence the session ended, so it must not claim an expiry, but it must still not hand the gated slice to whoever signs in next.

This fails closed against the SERVICE (every route still refuses the dead cookie), so it is not an authentication weakness. It is the console asserting facts about a session that no longer exists, on the surface whose own copy promises the opposite ("Monitoring rebuilds from this service's state after you sign in"), plus one wrong value (the settings snapshot) that persists rather than self-healing.

**Fix:** make ending a session one operation with one implementation, and call it from the third path too. The round bump and the slice clear must not be separable, which is precisely how they got separated here.

```ts
async probe(baseUrl) {
  const wasLive = get().auth === 'logged-in';
  set({ auth: 'checking', error: undefined });
  try {
    const state = await sessionProbe(baseUrl);
    if (state === 'logged-in') {
      // ... unchanged (the IN-07 transition branch)
      return;
    }
    if (wasLive) {
      // A live session ENDED, discovered here rather than by a read's 401. It is the same fact
      // `expireSession` exists for, so it takes the same path: the round is retired and the whole
      // gated slice goes with it, which is what the SESSION_EXPIRED copy already promises.
      get().expireSession();
      if (state === 'disabled') {
        // The service rebooted without an operator password: keep the fail-closed notice, but
        // only AFTER the slice has been cleared.
        set({ auth: 'disabled', error: undefined });
      }
      return;
    }
    set({ auth: state });
  } catch {
    if (wasLive) {
      // A transport fault is not evidence the session ended, so it must not claim an expiry; but
      // the gated slice still must not be inherited by whoever signs in next.
      get().expireSession();
    }
    set({ auth: 'logged-out', error: UNREACHABLE });
  }
}
```

Consider also clearing the gated slice on a successful `signIn` as defence in depth: a session that has read nothing should render nothing.

Pin it with two rows in `packages/web/tests/operator.spec.ts`, beside the existing probe rows: a probe answering 401 on a console holding a live session, asserting the round is retired, `view` is back to `{kind:'list'}` and every gated field (`cohorts`, `rows`, `metrics`, `health`, `operatorActions`, `settings`, `detail`, `lastUpdated`) is cleared; and a follow-up asserting `auth === 'logged-in' && settings === undefined` after the next `signIn`, which is the shell latch condition the existing WR-09 row already computes that way.

## Warnings

### WR-11 (WARNING, NEW): The IN-07 transition test is decided from a pre-await snapshot, so two overlapping probes still bump the round and still discard the read the fix pins

**File:** `packages/web/src/stores/operator.ts:795` (`wasLive`, captured before the `checking` assignment) consumed at `:799-812`, driven by `packages/web/src/components/operator/OperatorConsole.tsx:43-45` under `packages/web/src/main.tsx:6-10` (`StrictMode`)

**Issue:**

`probe`'s first statement takes `auth` away from `logged-in`. The fix captures `wasLive` before that, which is correct for one probe and wrong for two: a second probe entering while the first is in flight reads `checking`, concludes no session was live, and bumps the round when it lands. React StrictMode is enabled at `main.tsx:6-10`, and React double-invokes mount effects in development, so `OperatorConsole.tsx:43-45` fires `probe` twice on every mount in dev. In a production build the same overlap needs only a fast tab toggle (each mount fires a probe; the second reads `checking` if the first has not answered).

Reproduced against the shipped store:

```
$ bun /tmp/double-probe.ts
after two confirming probes round: 8 (was 7, IN-07 says it must stay 7)
in-flight list read applied? false (IN-07 row claims it must apply)
```

Both assertions of the shipped spec row "lets a list read started before a CONFIRMING probe still write when it lands" are false under a double probe. The cost is the same one IN-07 measured (one discarded list read, self-healing on the next 4000 ms poll tick), so this is not a data-correctness defect; what it costs is the guarantee. The round-6 code and its spec both now describe a property the app's own dev configuration violates on every mount, and CR-03's fix would make that property load-bearing rather than merely tidy.

**Fix:** decide the transition from a fact a concurrent probe cannot erase, rather than from the transient `auth` status. Either dedupe (hold the in-flight probe promise in the store and return it to a second caller), or record the live session explicitly:

```ts
// set beside every round bump that STARTS a session, cleared by `signOut` / `expireSession`
liveSessionRound?: number;

// in probe, at landing:
if (state === 'logged-in') {
  if (get().liveSessionRound === undefined) {
    set({ auth: state, sessionRound: get().sessionRound + 1, liveSessionRound: get().sessionRound + 1 });
  } else {
    set({ auth: state });
  }
  void get().refreshCohorts(baseUrl);
}
```

Add a row that runs two overlapping probes against a live session and asserts the round is unchanged and the in-flight list read still writes, which is the shipped row plus one extra `probe` call.

### WR-12 (WARNING, NEW, pre-existing code): `advertise` and `readvertise` turn an expired session into "try again", so two of the console's most-used buttons break the one-honest-re-login rule

**File:** `packages/web/src/stores/operator.ts:1089-1117` and `:1119-1139`, over `packages/web/src/lib/operator.ts:1105-1116` and `:1123-1130`

**Issue:**

Every other gated call in this store discriminates a `401` (the four reads, plus discard, export, cancel, finalize, add-test-peers, pause, resume, disable-broadcast, dismiss, save-draft-edit). These two do not: the API helpers collapse every non-ok status into `null` / `false`, so the store's else branch runs:

```ts
set({ advertiseStatus: 'error', advertisingId: undefined,
      formError: 'Could not advertise the draft. Try again.' });
```

On an expired session the operator is told to retry an action that can never succeed, on the primary action of the whole console, instead of being taken to the login screen with the honest `SESSION_EXPIRED` copy that D-16 makes the single meaning of a `401`. The list poll does correct it within one 4000 ms tick when the operator is on the list view (which is where these buttons live), so the wrong copy is transient. What is not transient is `formError`: `expireSession` does not clear it (see IN-11), so the stale "Could not advertise the draft. Try again." renders on the NEXT session's create form.

The same helpers also swallow a `409` from the paused-advertising gate (D-06) into the same generic sentence, where the service authored a specific reason.

**Fix:** give both helpers the discriminated result shape the other thirteen already use (`{kind:'ok'|'unauthorized'|'refused'|'unreachable'}`), route `unauthorized` through `get().expireSession()` and `refused` through `actionFailedWith(reason)`, exactly as `finalizeCohort` (`:1193-1217`) already does. Pin with a row per verb: a 401 advertise leaves `auth === 'logged-out'` with `SESSION_EXPIRED`, and a 409 renders the service's reason.

### WR-03 (WARNING, carried, out of scope by owner decision): `validateDraft` still accepts a non-whole-minute window, so the wedge survives on the per-draft path

**File:** `packages/service/src/operator-cohorts.ts:714-731`, consumed at `operator-cohorts.ts:1153,1224`, with the browser half at `packages/web/src/components/operator/DraftEditForm.tsx:129-152`

**Issue:** unchanged from rounds 3, 4 and 5. The holder's `validateWindow` (`runtime-settings.ts:834-842`) enforces `ms % ONE_MINUTE_MS === 0`; `validateDraft` enforces only integrality and the one-minute floor while throwing the SAME two constants, so `POST /v1/operator/cohorts` with `discoveryWindowMs: 90000` is still stored and that draft can never be edited again from the console.

**Fix:** unchanged (one shared `windowProblem` predicate called by both validators).

**Status:** out of scope by owner decision, carried for the planning record.

### WR-04 (WARNING, carried, out of scope by owner decision): The provenance barrier stops at `LifecycleActions`

**File:** `packages/web/src/components/operator/LifecycleActions.tsx:144-159` (barrier present), `packages/web/src/components/operator/CohortDetail.tsx:308-341,157-205` (barrier absent)

**Issue:** unchanged. `TestPeerAction` and `FundingStage` reason about the shared `detail` slot while acting on a `cohortId` prop. CR-03 raises the stakes again: that slot can hold a document from a session that has ENDED, and now reaches the new session on mount rather than only through a race.

**Fix:** unchanged (derive `provenDetail` once at the top of `CohortDetail`).

**Status:** out of scope by owner decision, carried for the planning record.

### WR-05 (WARNING, carried, out of scope by owner decision): `lastUpdated` carries two different freshness facts

**File:** `packages/web/src/stores/operator.ts:549-550,1036,1478`, cleared at `:1406,1416`, read at `packages/web/src/components/operator/HealthStrip.tsx:66,102-103`, `ServiceControls.tsx:202`, `CohortDetail.tsx:311,335-339`

**Issue:** unchanged. One field is stamped by a LIST read and by a DETAIL poll and cleared by drill-down navigation, while three consumers read it as three different clocks. Round 6 touched both writers again (both now sit behind session guards) without splitting it, and CR-03's repro shows the stamp surviving a session boundary.

**Fix:** unchanged (split into `listUpdated` and `detailUpdated`).

**Status:** out of scope by owner decision, carried for the planning record.

## Info

### IN-09 (INFO, NEW): The session-identity rule is now held by the four READS and by none of the nine one-shot actions

**File:** `packages/web/src/stores/operator.ts:726` (`runAdvertisingToggle`), `:1078-1080` (`saveDraftEdit`), `:1146`, `:1160`, `:1175`, `:1199`, `:1224`, `:1257`, `:1277`

**Issue:** each of these calls `get().expireSession()` on a `401` with no capture and no comparison, which is the shape WR-08 was filed about. The window is far narrower than a poll's (one click plus one round trip, versus two reads permanently outstanding), and the round-6 plan fenced these paths on the record, so this is recorded rather than raised. Worth keeping visible for one reason: the store's own docstring states the rule as general law ("Any guard that must decide whether an answer still belongs to the session that asked compares this"), and nine call sites do not follow it, so the next reader cannot tell the exemption from an omission.

**Fix:** when CR-03 is fixed, fold the capture into a shared helper (`expireIfStillAsking(askedInRound)`) and use it on the action paths too, or state the exemption in the docstring.

### IN-10 (INFO, NEW): `refreshCohorts` is the only gated read that also compares `auth`, and IN-07 gave that asymmetry teeth

**File:** `packages/web/src/stores/operator.ts:1010` versus `:1329`, `:1351`, `:1465`

**Issue:** before this round every probe bumped the round, so all four reads dropped answers that landed during a probe window. Now a confirming probe leaves the round intact, and the extra `get().auth !== 'logged-in'` clause makes `refreshCohorts` alone discard an ok answer landing inside the probe's `checking` window, where a detail, settings or save answer writes normally. The spec comment at `operator.spec.ts` records the window honestly ("this plan leaves it exactly as it was"); recorded here because after WR-11 and CR-03 the four guards should read as one rule with one composition, and today they do not.

**Fix:** drop the status clause (the round comparison already proves the session did not end) or add it to the other three, and say in the docstring which was chosen.

### IN-11 (INFO, NEW): `expireSession` leaves five fields that `signOut` clears, so one session's transient copy renders on the next one's forms

**File:** `packages/web/src/stores/operator.ts:909-949` against `:846-907`

**Issue:** `signOut` clears `createStatus`, `formError`, `advertiseStatus`, `advertisingId` and `advertiseMessage`; `expireSession` clears none of the five. A `formError` from a failed advertise (WR-12) or a green `advertiseMessage` from a successful one therefore survives an expiry and renders on the next session's create form and cohort list. Both surfaces are hidden while logged out, so nothing is visible in between, which is why this is INFO and not a warning.

**Fix:** make the two clear the same set. The cleanest form is one `GATED_SLICE_RESET` object spread by both, so a field added to one can never be missed by the other, which is also what CR-03's fix needs.

### IN-12 (INFO, NEW): The route's comment still says the budget is computed from the terms cap alone

**File:** `packages/service/src/hono-adapter.ts:905-914`, over `packages/service/src/runtime-settings.ts:462-465`

**Issue:** the comment reads "It is computed from `MAX_TERMS_CHARS` in `runtime-settings.ts`", which was true in round 5 and is not true now: 05-38 made the budget carry `MAX_SERVICE_NAME_CHARS` as well, which is the whole point of IN-06's fix. In a codebase whose convention is that these comments are the contract, the one comment at the consuming end is the one a future reader checks first.

**Fix:** reword to "derived from BOTH string caps through `settingsBodyLimitBytes`".

### IN-13 (INFO, NEW): The WR-10 correction stopped at the console caption; the boot warnings and DEPLOY.md still name the slow repair as the only one

**File:** `packages/service/src/runtime-settings.ts:786-788` and `:800-804` (the two `consequence` clauses), `docs/DEPLOY.md:510,516`, against `packages/web/src/components/operator/SettingsView.tsx:95-110`

**Issue:** WR-10's premise was that a refused seed can be repaired in the running session, and round 6 corrected exactly one of the three places that state the repair. The boot warnings still end "until the value is shortened" ("the display name is left unset until the value is shortened", "the terms are left unset ... until the value is shortened"), and `DEPLOY.md:510` still says "the name is left unset until you shorten it" while `DEPLOY.md:516` says "the join flow has no terms step until you shorten it". Both DEPLOY rows do go on to say the value is runtime-editable, so the docs are incomplete rather than false; the boot lines are the same overclaim WR-10 named, in the place an operator reads first.

**Fix:** carry the split into both `consequence` clauses (state the cost, then "set it from the operator settings surface to restore it for this session") and tighten the two DEPLOY sentences to match, so the three statements of one fact stop diverging.

### IN-14 (INFO, NEW): The derived budget charges the TRIMMED length, while `applySettings` trims before it bounds

**File:** `packages/service/src/runtime-settings.ts:416-421` and `:956-959`, enforced at `packages/service/src/hono-adapter.ts:918`

**Issue:** `applySettings` runs `trimToUndefined` first and bounds what is left, so a value with large leading or trailing whitespace can be legal to the holder and still exceed the route budget. Measured with the spec's own body shape: a 20000 character document padded with 200000 spaces encodes to 420169 bytes against the 122224 byte limit, so it is refused 413 ("request too large", naming no field) for a value the holder would have accepted. Not reachable from the console in any realistic use, and unchanged from the previous budget, so this is a note rather than a defect: it is recorded because the module's stated rule is that no value one layer accepts may be refused by another, and the derivation quantifies the stored length rather than the transmitted one.

**Fix:** if it is ever worth closing, bound the JSON string field before trimming (or state in the derivation's docstring that the budget is over the trimmed value, which is the decision actually taken).

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

Each one checked in the shipped code and, where behavior was claimed, executed.

- **WR-08: FIXED on all four gated reads.** `refreshCohorts` (`operator.ts:963,983-985`), `pollDetail` (`:1433,1446-1448`), `loadSettings` (`:1312,1318-1320`) and `saveSettings` (`:1346,1351,1370-1375`) each capture the asking session before the await and expire only on a match. The capture is an identity (`auth === 'logged-in' ? sessionRound : undefined`), so a read issued while nobody was signed in cannot match a later session's round, and that absent-capture case has its own row. Each refusal row is paired with a still-expires control, so a guard that simply stopped expiring would fail. The `catch` in `saveSettings` is scoped too, which the finding did not ask for and which is right.
- **WR-09: FIXED, and the guards are composed correctly.** `pollDetail` now compares the session AND the cohort, in that order, with the reasoning for both recorded (`:1458-1467`). `loadSettings` guards ahead of BOTH writing branches, so a dead session's answer moves neither the snapshot nor the error posture. `saveSettings` computes one `stillAsking` read by all four branches, including the rejection branch, which is the one a narrower fix would have missed. The spec asserts the shell latch as a computed boolean (`auth === 'logged-in' && settings === undefined`) rather than describing it, which is the right pin for a component condition without a DOM.
- **WR-10: FIXED, and the split is real.** `RefusedSeed` gains a third member, the two costs no longer mention a restart (pinned by a row asserting `/restart/i` does not match either cost), and each remedy names the in-session repair first and the environment edit second (pinned per field, including that the remedy reaches the composed caption). The terms remedy stays about the acceptance gate and the name remedy about the label, so neither loss is dressed in the other's words. Residual: the same sentence in the boot warnings and DEPLOY.md was not carried (IN-13).
- **IN-05: FIXED, and the pin was flipped rather than deleted.** `SourceCaption` supplies `refusedEnvDefaultText(dropped)` to the changed caption's parenthetical, so a refused field the operator has edited reads `changed this session (environment default: refused, see TERMS_TEXT)` instead of asserting the environment set nothing. The old negative assertion (`not.toContain('TERMS_TEXT')`) became a positive one, and the anti-vacuity row proves a genuinely unset boot value still reads `not set` and never says `refused`. The bad-tone styling is asserted absent on that branch, so precedence is pinned as well as content.
- **IN-06: FIXED, and derived rather than re-measured.** `settingsBodyLimitBytes` is exported as a FUNCTION and the spec exercises it over cap PAIRS including 700, 5000 and a swapped pair, with a name-blind derivation used as the anti-vacuity control, so a derivation that dropped either term goes red. The one remaining chosen number is measured (`bare` asserted at 169 bytes) and both caps are pinned against retyped literals in exactly one place. I re-derived the whole budget independently: `(200 + 20000) * 6 + 1024 = 122224`, the largest legal console body (both string fields at their cap in the six-byte escape class) is 121369 bytes, slack 855, matching the docstring. The new budget is SMALLER than round 5's 124096 and still bounds every legal body, so nothing that used to be accepted is now refused. `docs/DEPLOY.md:351-358` now describes the byte budget honestly instead of claiming the character cap is the only limit.
- **IN-07: FIXED for a single probe, not for concurrent ones.** `wasLive` is captured before the `checking` assignment, with the trap written down, and both the confirming-probe row and the read-survives-the-probe row are the right shape. It does not hold when two probes overlap, which the app's own StrictMode makes routine in development (WR-11).
- **IN-08: FIXED, and verified against the wire.** `CreateServiceOptions.serviceName` now documents itself as a boot seed for the holder. Traced: `index.ts:675` passes it into `createRuntimeSettings` and nothing else consumes it, and `hono-adapter.ts:635` reads `runtimeSettings?.serviceName.value` per request, so the claim that a rename applies without a restart is true of the shipped code.

---

_Reviewed: 2026-08-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
