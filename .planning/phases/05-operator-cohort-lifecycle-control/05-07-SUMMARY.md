---
phase: 05-operator-cohort-lifecycle-control
plan: 07
subsystem: operator-lifecycle
tags: [operator-console, runtime-settings, service-defaults, participation-terms, react, zustand, vitest, e2e]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 04)
    provides: the runtime settings holder with its declared field set, its all-or-nothing applySettings contract, and the read-per-request discipline (D-16)
  - phase: 05-operator-cohort-lifecycle-control (plan 05)
    provides: the Service controls card this surface is entered from, and the store idiom for a gated action with its own error field
  - phase: 05-operator-cohort-lifecycle-control (plan 06)
    provides: lib/cohort-form, the ONE pure module every cohort-shaping rule and string lives in, which this surface delegates to rather than growing a third copy
  - phase: 04-operator-monitoring-and-live-path
    provides: the discriminated FetchResult vocabulary and the SPA-internal view state the settings view extends to a third member
provides:
  - snapshot(), the served projection of every runtime-adjustable field with its value, its boot value, and whether it changed
  - GET and PUT /v1/operator/settings, both inside the gated block, with the 4 KiB body limit and an all-or-nothing 400
  - the additive termsText field on the anonymous GET /v1/config, the operator half of SVC-05
  - six new boot seeds (DEFAULT_BEACON_TYPE, DEFAULT_SIZE, DEFAULT_THRESHOLD, DEFAULT_DISCOVERY_WINDOW_MS, DEFAULT_FUNDING_WINDOW_MS, TERMS_TEXT)
  - createDraft reading this service's shape defaults exactly once, into that draft's own config
  - the TextArea primitive, used here by participation terms and later by the PSBT paste field
  - SettingsView, the third SPA-internal console view, with a source caption per field
affects: [05-08 broadcast kill switch, 05-13 participation terms at join]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The caption carries the fact, and the SERVICE supplies the fact: `changed` is served, never computed by comparing against a boot value the browser never saw"
    - "Resolve n and k as a PAIR: a default k taken against an operator-supplied n silently reshapes a cohort they described"
    - "An absent key means leave it alone, an empty string clears a text field, and an explicit null clears a number; a form that cannot clear a field it renders is lying"
    - "One read per holder per shell: two components fetching the same settings are two snapshots that can visibly disagree on one screen (the 05-05 status-poll lesson generalized)"
    - "A source comment must not spell the name of the thing a guard greps for, or the comment defeats the guard"

key-files:
  created:
    - packages/web/src/components/operator/SettingsView.tsx
    - packages/web/tests/settings.spec.ts
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/src/operator-cohorts.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/src/demo-server.ts
    - packages/service/src/index.ts
    - packages/service/tests/runtime-settings.spec.ts
    - packages/service/tests/lifecycle-routes.spec.ts
    - packages/service/src/config.spec.ts
    - packages/web/src/ui/primitives.tsx
    - packages/web/src/lib/operator.ts
    - packages/web/src/stores/operator.ts
    - packages/web/src/components/operator/OperatorConsole.tsx
    - packages/web/src/components/operator/ServiceControls.tsx
    - packages/web/src/components/operator/CreateCohortForm.tsx
    - packages/web/src/components/operator/HealthStrip.tsx
    - packages/web/src/components/browse/ServiceIdentityHeader.tsx

key-decisions:
  - "The source caption is built from the SERVED `changed` bit, never from a local comparison, because the browser is never told the boot value except by the same read that already answered the question"
  - "createDraft resolves n and k as a pair: an absent beacon type or an absent n takes the service default, but a SUPPLIED n keeps the shipped k = n rather than borrowing the service's k, which would turn a 5-seat request into 2-of-5"
  - "applySettings gained the same shorten-only discovery-window ceiling validateDraft enforces per draft, because a DEFAULT above the runner TTL hands an unenforceable window to every draft that inherits it"
  - "A cleared window default sends an explicit null rather than omitting the key, because an omitted key already means leave-it-alone and would silently discard the operator's edit"
  - "The create form's TIMING fields stay empty rather than being pre-filled from the served defaults: empty means inherit, and a pre-filled default would submit that number explicitly and freeze the cohort's window at today's value"
  - "The settings snapshot is loaded ONCE by the console shell, not by the create form, so the form and the settings view render from one snapshot rather than two reads of one holder that can disagree on screen"
  - "The funding-window default renders only when the served mode broadcasts, and its key is omitted from the patch entirely there, so a save never carries a value the operator was not shown"

requirements-completed: [SVC-04, SVC-05]

# Metrics
duration: ~30 min
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 07: Env-Seeds, Runtime-Overrides Service Settings Summary

**The operator now reconfigures what this running service offers, what it is called, and what participants must agree to, from a third console view that labels every value by its source, saves as a set so it can never show a half-saved state, and can never reach back into a cohort that already exists.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-29
- **Tasks:** 3 (task 1 TDD, so it has a RED then a GREEN commit) plus one guard-integrity fix
- **Files modified:** 18 (2 created, 16 modified)

## Accomplishments

- **Every value says where it came from, and the SERVICE says it.** `snapshot()` projects all seven runtime-adjustable fields with their current value, their boot value, and a `changed` bit derived per read. The console renders `env default` or `changed this session (environment default: {value})` from that served data rather than comparing locally, which matters because the browser is never told the boot value except by the same read that already answered the question. A field set BACK to its boot value reports `env default` again, so the caption never becomes a permanent claim about a value that is no longer changed. An absent boot value reads as `not set`, not as an empty string that would look like a value the operator chose.
- **The model is stated in words, directly under the heading.** `Environment variables set these at boot. Changes here apply to this running service only, and a restart returns every value to its environment default.` That sentence is the product decision made visible. Nothing here persists because durability is DUR-01, and an operator who is not told that would reasonably assume a saved setting survives a restart and discover otherwise from a service that silently reverted overnight.
- **A save is all-or-nothing on both sides of the wire.** The service validates every supplied field before applying any (the 05-04 contract, now reachable), the route maps a rejection to a 400 carrying the user-facing message, and the store writes no field locally either way. A rejected save therefore has nothing to roll back: every rendered field still shows what the service holds. The route test proves it by sending a VALID sibling field alongside an invalid one and asserting the valid one did not move.
- **The read-once rule is what makes a settings change safe, and it is now non-vacuous.** `createDraft` resolves a body's absent shape fields from the holder exactly once, into that draft's own `CohortConfig` and DTO, and nothing consults the holder for that cohort again. The spec creates a draft from the defaults, changes them, and asserts the draft's served shape is unchanged; then does the same after advertising. Before this plan those assertions could only have been written against values the holder never supplied, which is to say they would have passed against a service that re-read the holder on every advertise.
- **n and k resolve as a pair, never independently.** An absent beacon type or an absent n takes the service default, but a SUPPLIED n keeps the shipped `k = n`. Borrowing the service's k against an operator-supplied n would silently turn a 5-seat request into 2-of-5, which is a cohort they did not describe. There is a test whose only job is to pin that.
- **The settings surface inherited the shorten-only ceiling.** `applySettings` refuses a discovery-window default above this service's runner TTL, naming the real maximum in minutes through the same `discoveryWindowCeilingError` the draft validator uses. Without it the new `DEFAULT_DISCOVERY_WINDOW_MS` seed and the console field could both set a default the library silently overrules, handing an unenforceable window to every draft that inherits it, which is exactly the dishonesty 05-06 refused per cohort.
- **The terms ride the anonymous config read, additively, and absent means absent.** `GET /v1/config` carries `termsText` only when set, alongside `serviceName`, both read PER REQUEST from the holder. Empty or whitespace-only terms omit the key entirely, because "this operator set no terms" and "this operator set terms that say nothing" are different facts and the wire must keep them apart: 05-13's join flow decides whether a terms step exists at all from that distinction. The three frozen network fields are re-pinned byte-identical in `config.spec.ts` across the change.
- **Both operator-authored strings that reach a stranger are plain escaped text, and the guard that proves it still works.** Neither the service name nor the terms is ever rendered as markup or as a link target. Both render sites for the name carry a source comment recording the constraint, and the repo-wide grep for the raw-HTML escape hatch returns 0 across `packages/web/src`.
- **`TextArea` is a sibling of `Input`, not a new design language.** Its border, background, padding, text, placeholder, focus-ring and disabled classes are `Input`'s verbatim, so a later change to the input treatment cannot leave the two looking like different systems. The additions are a `min-h-32` floor and internal scrolling, so a long terms document scrolls inside the field rather than growing the card off-screen.
- **Validation delegates to `lib/cohort-form` rather than becoming a third copy.** This surface validates the SAME two numbers and the same two window formats the create and edit forms do, so it imports `validateCohortForm` and the four strings. That is the explicit handoff 05-06's Next Phase Readiness asked for, and the reason a rule can never be enforced on one of the three surfaces and not the others.
- **One snapshot per shell, not one per component.** The console shell loads the settings once on sign-in; the create form and the settings view both read it from the store. Two components fetching the same holder are two snapshots that can visibly disagree on one screen, which is the mistake 05-05 already corrected for the public status poll.

## Task Commits

Task 1 is TDD, so it has a RED then a GREEN commit:

1. **Task 1 (RED): failing spec for the gated settings surface** - `14393db` (test)
2. **Task 1 (GREEN): gated settings routes, read-once draft defaults, new env seeds** - `ff311cb` (feat)
3. **Task 2: the TextArea primitive and the Service settings console view** - `92fc6f7` (feat)
4. **Task 3: create-form defaults from the served snapshot, escaped operator text** - `bea6cc1` (feat)
5. **Guard-integrity fix: keep the raw-HTML absence grep meaningful** - `2084feb` (fix)

## Files Created/Modified

- `packages/service/src/runtime-settings.ts` - `SettingsSnapshot` plus the `snapshot()` reader built from the SAME `project` the per-field getters use; the `discoveryWindowCeilingMs` seed and its refusal in `applySettings`; `null`-clears semantics on both window keys of `SettingsPatch`.
- `packages/service/src/operator-cohorts.ts` - `withServiceDefaults`, the single read-once seam, applied on the create path only; `beaconType` and `size` made optional on `DraftInput` with the create/edit asymmetry documented; a `typeof` narrow in `validateDraft` so the absent case is refused by the guard that already refused a string.
- `packages/service/src/hono-adapter.ts` - gated `GET` and `PUT /v1/operator/settings` with the 4 KiB body limit and the JSON-parse guard; the additive `termsText` on `GET /v1/config`.
- `packages/service/src/index.ts` - six new `ServiceOptions` seeds, each an explicit override with the existing derivation as its fallback, plus the runner TTL threaded in as the discovery-window ceiling.
- `packages/service/src/demo-server.ts` - `DEFAULT_BEACON_TYPE` (validated against the two known types with a loud fallback), `DEFAULT_SIZE`, `DEFAULT_THRESHOLD`, `DEFAULT_DISCOVERY_WINDOW_MS`, `DEFAULT_FUNDING_WINDOW_MS` (all through `numericKnob`), and `TERMS_TEXT` (trim-to-undefined).
- `packages/service/tests/runtime-settings.spec.ts` - the snapshot block, the ceiling block, the additive-terms config block, and a real runner + operator-cohorts harness for the five read-once cases.
- `packages/service/tests/lifecycle-routes.spec.ts` - the runtime holder wired into the shared harness, and the settings-route rows of the semantics matrix (401 on both verbs, 413, 400 for non-JSON and for an invalid field, 200 with the new snapshot).
- `packages/service/src/config.spec.ts` - the additive terms assertion with the frozen network pin re-asserted, plus the cleared-key case.
- `packages/web/src/ui/primitives.tsx` - `TextArea`.
- `packages/web/src/lib/operator.ts` - `SettingFieldDTO` (value and envDefault optional, because JSON drops an undefined), `SettingsSnapshotDTO`, `SettingsPatchDTO`, `SaveSettingsResult`, `fetchSettings`, `saveSettings`.
- `packages/web/src/stores/operator.ts` - the `settings` view member, the four-field settings slice, `openSettings` / `closeSettings` / `loadSettings` / `saveSettings`, the three copy constants, and the slice cleared in both `signOut` and `expireSession`.
- `packages/web/src/components/operator/SettingsView.tsx` (new) - `sourceCaption`, `envDefaultText`, `windowEnvDefaultText`, `formFromSnapshot`, `settingsPatch`, and the view itself: three cards, seven fields, the model and next-cohort-only lines, and the save-as-a-set control.
- `packages/web/src/components/operator/OperatorConsole.tsx` - the third view branch (strip and controls card above it, like the other two) and the once-per-session settings load.
- `packages/web/src/components/operator/ServiceControls.tsx` - the `Service settings` ghost entry point, hidden while that view is already open.
- `packages/web/src/components/operator/CreateCohortForm.tsx` - `createFormDefaults` plus the shipped-literal fallbacks, and the re-seed effect keyed on snapshot identity.
- `packages/web/src/components/operator/HealthStrip.tsx` / `packages/web/src/components/browse/ServiceIdentityHeader.tsx` - the escaped-text source comments at both service-name render sites.
- `packages/web/tests/settings.spec.ts` (new, 18 tests) - the two caption formats, the minute conversions and the null-clear, the funding-key omission, the copy contract with a long-dash guard, the create-form resolver, and the store-level proof that a rejected save changes nothing.

## Decisions Made

- **The caption's `changed` bit is served, not computed.** A client-side comparison would need the boot value, which arrives on the same read that already carries the answer, so computing it locally adds a second source of truth for no gain.
- **The create form's timing fields stay empty.** See the deviation below: pre-filling them would submit an explicit window and freeze this cohort at today's default.
- **A cleared window default sends an explicit `null`.** An absent key already means "leave it alone", so omitting a cleared field would silently discard the operator's edit and the form would re-render the old value as though nothing was typed.
- **The funding-window default is absent, not disabled, on a non-broadcasting service.** A hermetic service never funds a beacon address, so the field would be a control over nothing; its key is omitted from the patch there too, so a save never carries a value the operator was not shown.
- **`updateDraft` does NOT inherit service defaults.** An edit reshapes a draft that already has a shape, so an absent field there is a malformed body rather than an invitation to inherit, and the create/edit validation parity tests (which all supply full bodies) are unaffected.
- **The settings entry point hides while the settings view is open.** An entry point to the surface you are already on is not a control.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-filling the create form's timing fields would have frozen every cohort's window**

- **Found during:** Task 3
- **Issue:** The plan says to seed "the initial beacon type, size, threshold, and both timing fields from the served settings snapshot rather than from hardcoded literals". Taken literally for the two timing fields, that breaks the contract 05-06 established and this plan restates: an EMPTY timing field means "use this service's default", and the field's own help reads `Leave it empty to use this service's default of {n} min.` A field pre-filled with the default figure submits that number EXPLICITLY, which is a different instruction: the draft records an operator-set window frozen at today's value, so a later change to the service default silently stops applying to cohorts the operator believed were inheriting it. It would also make the help text a lie about a field that is no longer empty.
- **Fix:** The two timing fields keep starting empty. They already render the real served default in their help through the `defaults` key 05-06 added to the gated list read, which is the same holder the settings snapshot reads, so the operator still sees the number without committing to it. The beacon type, size and threshold ARE seeded from the snapshot as the plan intends, because those three have no inherit-vs-explicit distinction: a cohort always has a beacon type and a shape.
- **Files modified:** packages/web/src/components/operator/CreateCohortForm.tsx
- **Verification:** the reason is recorded in a source comment at the two `useState('')` calls; `packages/web/tests/settings.spec.ts` pins the resolver over the three fields it does seed.
- **Committed in:** `bea6cc1`

**2. [Rule 2 - Missing Critical] A settings surface that cannot clear a field it renders**

- **Found during:** Task 2
- **Issue:** `SettingsPatch`'s window keys were `number | undefined`, and an absent key already means "leave this setting alone". An operator who emptied `Default funding window (minutes)` would therefore have their edit silently discarded, and the form would re-render the old value on the next snapshot as though they had typed nothing. The same surface offers `Leave it empty` semantics for the two text fields, so the inconsistency would read as a bug rather than a rule.
- **Fix:** Both window keys accept an explicit `null` meaning CLEAR, mapped to `undefined` in `applySettings`, mirroring the `null`-means-cleared idiom `DraftInput` already uses for its per-cohort windows. The client sends `null` for an emptied field.
- **Files modified:** packages/service/src/runtime-settings.ts, packages/web/src/lib/operator.ts, packages/web/src/components/operator/SettingsView.tsx
- **Verification:** `packages/web/tests/settings.spec.ts` asserts an emptied field produces `null` rather than an omitted key.
- **Committed in:** `92fc6f7`

**3. [Rule 2 - Missing Critical] The settings surface could set a discovery-window default this service cannot honor**

- **Found during:** Task 1
- **Issue:** 05-06 refuses a per-draft discovery window above the runner's cohort TTL, because the library arms that TTL at advertise and never resets it, so a longer window is a promise the service cannot keep. Nothing stopped the new `DEFAULT_DISCOVERY_WINDOW_MS` seed or the new console field from setting that same unenforceable value as the DEFAULT, which would then be inherited by every draft created afterwards: the exact dishonesty 05-06 exists to prevent, reintroduced one level up.
- **Fix:** `createRuntimeSettings` takes a `discoveryWindowCeilingMs` seed (threaded from `opts.cohortTtlMs` in `createService`, NaN-guarded like every other numeric seed), and `applySettings` refuses a default above it using the SAME exported `discoveryWindowCeilingError` the draft validator throws, so both refusals name the real service maximum in identical words.
- **Files modified:** packages/service/src/runtime-settings.ts, packages/service/src/index.ts
- **Verification:** two tests in `runtime-settings.spec.ts` (refused above the ceiling with the maximum named, accepted at or below it).
- **Committed in:** `ff311cb`

**4. [Rule 1 - Bug] The source comments defeated the grep that proves the constraint they describe**

- **Found during:** the plan-level verification block
- **Issue:** The comments added at both service-name render sites recorded the escaped-text rule by naming React's raw-HTML escape hatch. That made `grep -rc 'dangerouslySetInnerHTML' packages/web/src` match the comments describing the ban, so the acceptance criterion (and any future audit running the same grep) would have reported hits on a tree that uses it nowhere. A comment that defeats its own guard is worse than no comment: it converts a clean signal into one someone has to read past.
- **Fix:** Both comments say the same thing without the token ("the raw-HTML escape hatch"), and each notes why the name is withheld so the next author does not helpfully add it back.
- **Files modified:** packages/web/src/components/operator/HealthStrip.tsx, packages/web/src/components/browse/ServiceIdentityHeader.tsx
- **Verification:** `grep -rn 'dangerouslySetInnerHTML' packages/web/src` returns 0 matches.
- **Committed in:** `2084feb`

---

**Total deviations:** 4 auto-fixed (2 bugs, 2 missing critical)
**Impact on plan:** All four serve the plan's stated truths more faithfully than the literal instruction would have. No file was added beyond the plan's `files_modified` list except `SettingsView.tsx` and `settings.spec.ts`, both of which the plan names as artifacts. No interface a later plan references departed from the plan.

## Issues Encountered

- **No unit test covers the rendered composition of the settings view**, only its pure half plus the store contract. Whether three cards of seven fields, each with a help caption and a source caption, read well at a real viewport belongs to the phase's console walkthrough at the end-of-phase gate. This mirrors the same gap 05-06 recorded for the two cohort forms.
- **The `DEFAULT_*` env seeds are not exercised by any e2e leg.** They are plain reads through the shipped `numericKnob` and trim idioms, and their consumers (the holder, `createDraft`, the routes) are covered hermetically, but no test boots a service with those variables set. `e2e:config` is the natural home if a later plan wants that coverage.

## Known Stubs

None. Every control on this surface is wired end to end: each of the seven fields reaches the live gated `PUT` and a real in-memory mutation, the source captions render served data, the terms text reaches the anonymous `GET /v1/config` where 05-13's join flow will read it, the create form opens on values the service actually supplied, and the six env seeds reach `createRuntimeSettings` through `createService`. Nothing renders a control over a capability that is not behind it. The participation-terms JOIN step does not exist yet, which is 05-13's work and is stated honestly on the setting itself rather than hinted at by a placeholder.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/service/tests/runtime-settings.spec.ts packages/service/tests/lifecycle-routes.spec.ts packages/web/tests/settings.spec.ts` | 74 tests pass |
| `pnpm vitest run ... packages/service/src/config.spec.ts` (task 1 gate) | 65 tests pass |
| `pnpm test` (full suite, `tsc -b` gated) | 50 files, 755 tests pass |
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm --filter @btcr2-aggregation/web build` | clean (`tsc --noEmit` + `vite build`) |
| `pnpm e2e:config` | pass (runtime network injection + mainnet guard + recovery/IPFS legs) |
| `pnpm e2e:operator` | pass (full extended suite: auth, expiry, monitoring, cancel, pause legs) |
| `pnpm e2e:pause` | pass (drain mode paused NEW cohorts only; resume restored advertising) |
| `grep -rn 'dangerouslySetInnerHTML' packages/web/src` | 0 matches |
| `grep -c 'dangerouslySetInnerHTML' packages/web/src/components/operator/SettingsView.tsx` | 0 |
| `grep -c 'window.location' packages/web/src/components/operator/SettingsView.tsx` | 0 (no routed URL) |
| `grep -c 'export function TextArea' packages/web/src/ui/primitives.tsx` | 1, and its class string includes `min-h-32` |
| `grep -rlP '\x{2014}' packages/service/src packages/web/src` | no files |

## User Setup Required

None. Every new environment variable is optional and every one has the behavior this service already had as its fallback: a service booted without `DEFAULT_BEACON_TYPE`, `DEFAULT_SIZE`, `DEFAULT_THRESHOLD`, `DEFAULT_DISCOVERY_WINDOW_MS`, `DEFAULT_FUNDING_WINDOW_MS` or `TERMS_TEXT` behaves exactly as it did before, seeding its defaults from the runner's cohort config and timing options and serving no terms. The settings view renders only inside the authenticated console, which exists only on a service booted with `OPERATOR_PASSWORD`.

## Next Phase Readiness

- **05-13 has its server half already in place.** The terms text is set, bounded, stored, and served on the anonymous `GET /v1/config` beside the network the browser already reads on load, with an absent key meaning "no terms step at all". The participant store's `loadConfig` is where it lands; the honest-limit caption is already stated to the operator, so the join step does not need to re-litigate what enforcement means.
- **05-08's broadcast kill switch joins the `Service controls` card beside the settings entry point.** The card's controls row is `flex-wrap` at the shared gap and already carries three children, so a fourth wraps rather than pushing anything off-screen. `broadcastDisabled` is still the declared-but-unwired field 05-04 left it as; nothing in this plan touched it.
- **`SettingsSnapshot` is the shape any future runtime setting extends.** A new field needs an entry in the holder, a line in `snapshot()`, a field in `SettingsSnapshotDTO`, and a `Field` in the view; the caption, the all-or-nothing save, and the route need no change. `TextArea` is in place for the PSBT paste field the external-signer leg adds.
- **Carried concern, unchanged from 05-02 through 05-06:** a settled cohort (expired, canceled, finalized-then-anchored) still cannot be re-opened from the operator list, because `canOpen` is `isAdvertised || cohort === undefined`. This plan did not touch the ended group.
- **Carried upstream limit, unchanged:** the shorten-only discovery-window ceiling (now enforced at both the per-draft and the service-default level) exists only because no timing value in `aggregation@0.4.0` is per-cohort. If a future upstream release makes `cohortTtlMs` per-advertise, both guards become unnecessary; each is localized to one function.

## Self-Check: PASSED

- Created files verified present on disk: `packages/web/src/components/operator/SettingsView.tsx`, `packages/web/tests/settings.spec.ts`.
- Commits verified in git history: `14393db`, `ff311cb`, `92fc6f7`, `bea6cc1`, `2084feb`.
- Every task acceptance criterion re-run in this session, and the plan-level `<verification>` block re-run in full and green (including all three named e2e legs).

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*

