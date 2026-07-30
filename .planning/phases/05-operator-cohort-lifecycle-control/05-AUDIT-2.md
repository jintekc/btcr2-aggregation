# Phase 5 second audit: test-coverage holes

**Status:** 24 confirmed defects, verified. Source of the gap plans that follow 05-20.

## How this was found

The phase-5 UAT was rewritten as 18 manual procedures. The owner pushed back: why hand-run
things a script could prove? A coverage triage answered that (17 of 18 "human-only" claims were
automatable), and in passing produced 32 claims that some mutation to shipped source would leave
the suite green. Those 32 were then verified independently, each confirmed one handed to a second
agent whose only job was to refute it. 27 survived, collapsing to 24 unique defects (three pairs
attack the same source line from two directions: #15/#21, #10/#22, #17/#23). Five were refuted.

Three findings were additionally verified by hand against the checkout before this document was
written: the `typeToConfirm` prop (#15), the absent server-side post-broadcast cancel guard (#8),
and the canceled-only carry in `forgetTerminal` (#19).

## The two structural causes

Everything below is a symptom of these two.

**1. `packages/web` has no DOM test environment.** No `jsdom`, no `happy-dom`, no
`@testing-library/*` anywhere in the repo, and no `vitest.config.*` or `vitest.workspace.*` at
all, so vitest runs every package under the default `node` environment. Not one React component
is ever rendered by a test. Every web spec therefore tests a pure predicate or an exported
constant, which is why a prop that is never passed, a label that is never asserted, and a guard
that is never rendered all ship green.

**2. `packages/web` is not typechecked by `pnpm test`.** The root `tsconfig.json` references
only `packages/shared`, `packages/service`, `packages/participant` and `e2e`. `pnpm test` is
`tsc -b && vitest run`, so web types are checked only by `pnpm --filter @btcr2-aggregation/web
build`, which is not part of the test gate. A web mutation that breaks types is invisible to
`pnpm test`.

Together these mean the operator console and the participant store are protected by neither
rendering nor typechecking during the gate that the phase treated as its green light.

## What this is NOT

The protocol, the auth boundary, and the server-side refusals are genuinely covered. This is a
copy-and-wiring coverage problem. No confirmed defect here is a live protocol bug: each is a
mutation that WOULD ship undetected, not a defect currently in the tree.

The `⚠` marks below are the ones that matter most for honesty: a gap plan among 05-15 through
05-20 explicitly claimed the behavior was made "load-bearing" or "asserted" and it was not.

---

## Confirmed holes

27 claims survived rebuttal; they collapse to **24 unique defects** (three pairs are the same source line attacked from two directions: #15/#21, #10/#22, #17/#23). Ordered by real severity as re-scored on rebuttal, phase-5-shipped behavior first within a tier.

**⚠ = a gap plan 05-15..05-20 explicitly claimed this was made "load-bearing"/"asserted" and did not.**

### High

1. **⚠ #15 + #21 - the type-to-confirm gate is not wired to any rung.** `packages/web/src/components/operator/LifecycleActions.tsx:238` - deleting `typeToConfirm={short}` ships undetected (and adding it to the rung-3 panel at `:252` ships undetected too). Consequence: the funded-cohort cancel (`cancelRung === 4`, reachable only when sats are observed at the beacon address) arms on the first click with no typed cohort id, so an operator can strand funds through a one-click ceremony; or an ordinary unfunded cancel gains friction it was designed not to have. `05-19-PLAN.md:34` and `05-19-SUMMARY.md:17` claim "the shipped type-to-confirm gate calls the tested predicate, so the seven assertions ... are load-bearing"; 05-19 pinned only the callee (`packages/web/src/ui/primitives.tsx`, via `packages/web/tests/lifecycle.spec.ts:251-275`), never the call site. Closing test: a `readFileSync` source-containment block over `LifecycleActions.tsx` in `packages/web/tests/lifecycle.spec.ts` asserting exactly one `typeToConfirm=` in the file and that it sits inside the `cancelRung(detail) === 4` branch.

2. **#8 - the post-broadcast cancel suppression is the only barrier and nothing pins it.** `packages/web/src/components/operator/LifecycleActions.tsx:151` - swapping the two JSX arms (or comparing against the in-union-but-unreachable `'unavailable'`) leaves `Cancel cohort` rendered on a cohort whose beacon tx is already on the wire. There is no server-side post-broadcast guard: `packages/service/src/operator-cohorts.ts:1309-1349` checks only `advertised.has(cohortId)` then calls `runner.stopCohort` unconditionally, and `packages/service/src/hono-adapter.ts:1199-1206` adds only an id-shape check. `CANCEL_LABEL` (`:44`) and `AFTER_BROADCAST` (`:46-47`) are unpinned by any copy test. Closing test: same `LIFECYCLE_ACTIONS_SRC` block, asserting `availability === 'broadcast' ?` is immediately followed by the `AFTER_BROADCAST` paragraph, in `packages/web/tests/lifecycle.spec.ts`.

3. **#18 - the participant store's chain-endpoint check never proves it passes OUR network.** `packages/web/src/stores/participant.ts:2624` - hardcoding `checkEndpoint(raw, 'regtest')` typechecks and leaves all six `useChainEndpoint` rows green, because `packages/web/tests/tx-client.spec.ts:564` sets `network: 'regtest'` for every one of them. Consequence: a mutinynet participant activates a regtest esplora and reads UTXOs and confirmations from the wrong chain, the exact failure `packages/web/src/lib/esplora.ts:4-12` exists to prevent, feeding `register()` funding reads and direct broadcast. Secondary: `packages/web/src/lib/esplora.ts:248` can drop the genesis-equality half of the two-marker gate with no verdict change anywhere. Closing test: one store row under `network: 'mutinynet'` stubbing regtest genesis, expecting `kind: 'mismatch'` naming `NETWORKS.mutinynet.label`, plus `expect(calls).toHaveLength(1)`, in `packages/web/tests/tx-client.spec.ts`.

4. **#16 - no test ever invokes `cancelCohort` or `finalizeCohort` on the operator store.** `packages/web/src/stores/operator.ts:1038` (and `:1062` for finalize) - replacing `get().expireSession(); return;` with a generic `actionError` ships undetected. Consequence: after a mid-session 401 on Cancel the console keeps showing a stale drill-down for an operator who is in fact logged out, instead of dropping to login with `SESSION_EXPIRED` and resetting `view` to `{kind:'list'}`. `05-02-SUMMARY.md:133-137` records this path as "code-verified... but there is no store-level harness", deferring it to a browser walkthrough `e2e/browser-operator.ts` never added. Closing test: mirror the `exportCohort` block at `packages/web/tests/operator.spec.ts:192-210` for cancel and finalize (stub 401; assert `auth`, `error`, `view`, `cancelling`).

5. **#14 - nothing stops a network fault from fabricating a cancel accusation.** `packages/web/src/stores/participant.ts:2158` - treating a non-`ok` fate read as canceled ships undetected, because the `if (baseUrl)` guard at `:2151` is never entered by any test (all nine `handlePostSeatSnapshot` calls pass one argument). Consequence: an unreachable or 500-ing service makes the participant console narrate `CANCELED_NARRATION` ("The operator canceled this cohort.") against a named operator, the precise invariant `packages/web/src/lib/cohort-fate.ts:17-19` documents. The round guard at `:2161` is equally unexercised. Closing test: `packages/web/src/stores/participant.spec.ts` - stub `fetch` to throw / 500 / non-JSON, call `handlePostSeatSnapshot([], 'http://svc.example')` twice, assert `canceled` stays false.

6. **#25 - the mode chip's copy and its independence from the kill switch are unguarded.** `packages/web/src/components/operator/HealthStrip.tsx:11` (`MODE_LABEL`, non-exported) and the JSX at `:94` - relabeling `live`, or rewriting `:94` to render `'Hermetic'` when `broadcastOff`, ships undetected. Consequence: the chip `HealthStrip.tsx:38-42` calls "the single most consequential piece of copy on this surface" can claim a hermetic service while the service is live with broadcasting stood down (D-14). The semantic feed (`monitor.serviceHealth` → wire → `state.health`) is genuinely covered; only the last hop is not. `05-VALIDATION.md:76` records T-05-08-03's verify method as `build`, which is itself the admission. Closing test: export `MODE_LABEL`, pin its three values plus the `'Checking mode'` fallback in `packages/web/tests/service-controls.spec.ts` beside `:218`, plus a source read proving the mode `Badge` expression depends only on `mode`.

### Medium

7. **#6 - `termsHashHex` has no known-answer vector.** `packages/shared/src/tos.ts:135` - swapping sha256 for any other 32-byte noble digest ships undetected; every assertion is shape-only or self-consistent (`packages/shared/tests/tos.spec.ts:47-77`, `packages/service/src/hono-adapter.ts:351`, `packages/web/tests/terms.spec.ts:150` all compare the function against itself). Consequence: a third party verifying a stored acceptance with standard SHA-256 mismatches, breaking the frozen proof format (SVC-05/D-19, `tos.ts:30`). Same for `termsAcceptanceSigningBytes` (`tos.ts:191`). Closing test: `expect(termsHashHex('')).toBe('e3b0c442...b855')` plus `expect(termsAcceptanceSigningBytes(r)).toEqual(hexToBytes(termsAcceptanceHashHex(r)))` in `packages/shared/tests/tos.spec.ts`.

8. **⚠ #19 - dismissing an EXPIRED cohort is never followed by a fate read.** `packages/service/src/operator-cohorts.ts:1455` - widening `record.fate === 'canceled'` to `record.fate` ships undetected; all three dismissal rows in `packages/service/tests/cohort-fate.spec.ts:295-360` cancel first. Consequence: `GET /v1/cohort-fate/<expired id>` answers `{"canceled":true}` to any anonymous participant after the operator dismisses the row, so a lapse reads as a deliberate cancel (D-02, ADR 0017:52). 05-19 built the `dismissedCanceled` carry (`05-19-SUMMARY.md:68`) and added rows for the canceled leg only. Closing test: advertise, `runner.stop()` + settle to file `expired`, DELETE `/v1/operator/ended/:id`, assert `anonymousFate` reads `{canceled:false}`, in `packages/service/tests/cohort-fate.spec.ts`.

9. **#13 - the page origin is never proven to reach the fate read.** `packages/web/src/stores/participant.ts:1746` - dropping the second argument typechecks (`:477` declares `baseUrl?`). No unit test ever calls the store's `start()`, so the whole cohort-ready poll closure at `:1719-1760` is unexecuted source, and `packages/web/src/App.tsx:21` is never rendered. Consequence: the cancel attribution silently degrades to `HONEST_TERMINAL_FALLBACK` forever. Closing test: same case as #14, asserting the stub saw `http://svc.example/v1/cohort-fate/abc` with `credentials:'omit'`.

10. **#29 - no test ever drives a SUCCESSFUL window edit.** `packages/service/src/operator-cohorts.ts:1231-1234` - a merge/preserve refactor of the conditional-spread ships undetected; every `updateDraft` call site passes no window key, and `discovery-window.spec.ts:197` throws in `validateDraft` before reaching the block. Consequence: an operator who clears a per-cohort discovery or funding window and saves silently keeps the old value, and "empty means use the service default" (`operator-cohorts.ts:762,:785`) becomes false. Closing test: `createDraft` with `discoveryWindowMs`, `updateDraft` with the key omitted, assert the returned DTO has it `undefined`, in `packages/service/tests/draft-edit.spec.ts` or `discovery-window.spec.ts`.

11. **#31 - `DraftEditForm` is never rendered or read by anything.** `packages/web/src/components/operator/DraftEditForm.tsx:129-130` - `useState('')` instead of `useState(msToMinutesText(draft.discoveryWindowMs))` ships undetected (and `packages/web` is not even in the root `tsc -b` project references). Consequence: a saved 5-minute window displays as empty ("use the default") and the next save discards it through `windowKeys` at `:136-150`. Closing test: extract seeding into an exported `formFromDraft` in `packages/web/src/lib/cohort-form.ts` (the exact `formFromSnapshot` precedent pinned at `packages/web/tests/settings.spec.ts:95-120`) and assert it in `packages/web/tests/cohort-form.spec.ts`. **Needs a small src refactor.**

12. **⚠ #5 - the boot seed of the discovery-window ceiling is unwired-testable.** `packages/service/src/index.ts:680` - deleting `discoveryWindowCeilingMs: opts.cohortTtlMs` ships undetected; all six ceiling rows hand-inject the knob into `createRuntimeSettings` (`packages/service/tests/runtime-settings.spec.ts:352-434`), and the route home builds a ceiling-free holder at `lifecycle-routes.spec.ts:132`. Consequence: an over-ceiling boot seed is served as this service's env default while no app timer arms, and `PUT /v1/operator/settings` accepts a window the runner's TTL overrules. `05-18-PLAN.md:112` names `index.ts` as "where ... the ceiling is provably available at seed time" and pins nothing there. Closing test: one row calling the real `createService({cohortTtlMs})` and reading the exposed `service.settings` (`packages/service/src/index.ts:515`), in `packages/service/tests/runtime-settings.spec.ts`; the runner-mocking recipe already exists at `create-service-advert-ttl.spec.ts:25-50`.

13. **#2 - three route-level "changed nothing, record nothing" guards are indistinguishable from no guard.** `packages/service/src/hono-adapter.ts:854-858` (pause), `:862-866` (resume), `:884-888` (broadcast disable) - deleting any of them ships undetected, because the monitor ring's own consecutive-duplicate skip (`packages/service/src/monitor.ts:1001-1004`) masks every existing sequence, including the false green at `packages/service/tests/kill-switch.spec.ts:305-317`. Consequence: the operator-actions log, which is the audit trail for who stood broadcasting down and when, gains bogus duplicate entries. Closing test: pause → a DIFFERENT recorded action → pause, then `expect(monitor.operatorActions().filter(e => e.text === 'Paused advertising.')).toHaveLength(1)`, in `packages/service/tests/lifecycle-routes.spec.ts` beside `:862`.

14. **#22 + #10 - the test-peers refusal copy and its disabled wiring have zero web-side coverage.** `packages/web/src/stores/operator.ts:337` (`NO_SEATS_LEFT_REASON`) can be reworded, and `packages/web/src/components/operator/CohortDetail.tsx:201` `disabled={remaining === 0}` can be deleted, both undetected. The only pins read the SEPARATE service constant (`packages/service/tests/test-peers.spec.ts:407`, `lifecycle-routes.spec.ts:963`), and `packages/web` does not depend on the service package. Consequence: UI-SPEC E11's byte-identity claim breaks, and the operator gets a clickable control that always 409s. The whole test-peer copy family (`operator.ts:312-331`) is in the same state, in contrast to the settings family pinned + em-dash-guarded at `packages/web/tests/settings.spec.ts:199-213`. Closing test: literal pin plus an em-dash guard over the eight constants, plus a source-containment pin on `CohortDetail.tsx` for `disabled={remaining === 0}`, in `packages/web/tests/service-controls.spec.ts`.

15. **⚠ #17 + #23 - no chip LABEL is pinned, only distinctness.** `packages/web/src/lib/operator-rows.ts:120` and `:125` - relabeling `'Signed'` to `'Anchored (co-signed)'`, `'Co-signed'`, or `'Done'` ships undetected; `packages/web/tests/operator-rows.spec.ts:164-171` asserts only set-size distinctness, truthiness and no long dash, and `ChipPresentation.label` is plain `string` (`operator-rows.ts:87`). Consequence: an unconfirmed co-sign can claim an on-chain anchor, the exact defect 05-20 was written to close. `05-20-PLAN.md:33` claims the tone, pulse **and label** of every chip are "ASSERTED, not eyeballed", and `:257` says the labels "are pinned distinct"; only distinctness shipped. Closing test: `expect(chipPresentation('co-signed').label).toBe('Signed')`, `.not.toMatch(/anchor/i)`, and the same for `'co-signed-fallback'` and `'co-signing'`, in `packages/web/tests/operator-rows.spec.ts`.

16. **#27 - the kill-switch button's mode guard is never rendered.** `packages/web/src/components/operator/ServiceControls.tsx:237` - deleting `broadcast === 'available' &&` ships undetected; `packages/web/tests/service-controls.spec.ts:160-181` tests only the pure selector, and no spec ever reads `ServiceControls.tsx`. Consequence: a danger-toned one-way control renders on hermetic and live-no-broadcast services, which is verbatim Test 1's fail signal (`05-UAT-PROCEDURES.md:302-303`, `:472-473`). Closing test: `if ((await page.getByRole('button', { name: 'Disable broadcast' }).count()) > 0) fail(...)` in `e2e/browser-operator.ts` after `:156`, reusing the idiom already at `:243`.

17. **#30 - the client-side threshold error copy is pinned only against itself.** `packages/web/src/lib/cohort-form.ts:34` - any reword ships undetected (`packages/web/tests/cohort-form.spec.ts:94` imports the constant it compares to; `:147-162` checks only for long dashes). The two independent literal pins are server-side only (`packages/service/src/operator-cohorts.spec.ts:92`, `packages/service/tests/runtime-settings.spec.ts:143`). Consequence: the "SAME message, byte for byte" contract (`05-UAT-PROCEDURES.md:581`, SVC-04 criterion 3) breaks. The RULE is covered; only the wording is not. Closing test: `expect(THRESHOLD_ERROR).toBe('Signing threshold must be a whole number between 1 and the cohort size.')` plus `SIZE_ERROR`, in `packages/web/tests/cohort-form.spec.ts`.

18. **#11 - the live-mode test-peer registration disclosure is unreachable from any test.** `packages/service/src/index.ts:1342-1344` - deleting the `mode === 'live'` guard OR the `noteOperatorAction` call ships undetected; `packages/service/tests/lifecycle-routes.spec.ts:158-179` re-types `onSpawned` and omits the branch entirely, and no spec calls `service.addTestPeers`. Consequence: either a false live-only caveat on hermetic runs, or a live operator silently believing their test peers' DIDs were registered when they were not. (Deleting only the call is caught by `pnpm lint`'s unused-import rule, which is not in `pnpm test`.) Closing test: build a `createService` with a broadcaster, POST the test-peers route, assert `monitor.detail(id).activity` contains `TEST_PEER_REGISTRATION_SKIPPED_TEXT`, plus the hermetic mirror asserting it does not, in `packages/service/tests/test-peers.spec.ts`.

19. **#28 (not phase-5) - the reflected-outcome arm has only a NEGATIVE assertion.** `packages/web/src/components/cohort/CompletionSummary.tsx:167-171` - renaming the sentence or deleting the arm makes `e2e/browser-participant-cohort.ts:255` (which FAILS if the copy appears, on a structurally hermetic run) *more* green. Consequence: a real live success degrades to the warn "not found yet" box. This is the honest-success half of the D-29 pair; the dishonest direction is guarded. Closing test: export the sentence and pin it hermetically, then a live regtest browser leg for real closure. **Needs new infrastructure.**

### Low

20. **#1 - `ADVERTISING_PAUSED_REASON` has no literal pin or leakage guard.** `packages/service/src/operator-cohorts.ts:216` - any rewording, including the raw-library-style string the JSDoc at `:205-212` says must never reach the wire, ships undetected (`pause.spec.ts:158,:182` compare symbolically; `e2e/operator-cohort.ts:1057-1060` checks truthiness only). Both siblings are guarded (`test-peers.spec.ts:407-411`, `lifecycle-routes.spec.ts:421`). Residual: `packages/web/src/components/operator/OperatorCohortList.tsx:181,:211` `disabled={isAdvertising || advertisingPaused}` has zero coverage. Closing test: literal pin + `not.toMatch(/Cannot |cohort .*:|phase is/i)` in `packages/service/tests/pause.spec.ts`; `LIST_SRC` containment in `packages/web/tests/operator-rows.spec.ts`.

21. **#7 - the terms-step empty-state guard is unpinned.** `packages/web/src/components/browse/TermsStep.tsx:87-89` - deleting `if (!termsStepVisible(termsText)) return null;` ships undetected; the existing source-containment block at `packages/web/tests/terms.spec.ts:155-181` greps for dangerous props, links and class names but not the guard. Consequence: a service with no terms shows an empty scroll box and an "I accept these terms." checkbox, a legal-looking prompt to accept nothing. Blast radius is bounded (`JoinIdentityStep.tsx:79-81` uses the same predicate, so Join stays enabled). Closing test: one `toMatch` line in the existing block.

22. **#20 - `DISMISS_BODY`'s first sentence is unpinned.** `packages/web/src/stores/operator.ts:260` - deleting "and its activity log" or " for this session" ships undetected; `packages/web/tests/service-controls.spec.ts:226-227` are `toContain` on sentences two and three, while the heading and both buttons around them get exact `toBe`. Consequence: the confirm reads as if the record were permanently destroyed server-side (D-15 / UI-SPEC E10). Closing test: promote `:226` to a full `toBe`.

23. **#32 - the PATCH 404 body is never read.** `packages/service/src/hono-adapter.ts:1150` - renaming `'unknown draft'` ships undetected (`packages/service/tests/draft-edit.spec.ts:342-348` asserts status only). The string reaches the UI verbatim via `packages/web/src/lib/operator.ts:243-245`. Side note: the JSDoc at `packages/web/src/lib/operator.ts:214-216` claims a 404 "falls back to the generic message"; the code renders `unknown draft` verbatim. Closing test: `expect(await res.json()).toEqual({ error: 'unknown draft' })` at `draft-edit.spec.ts:346`.

24. **#3 (not phase-5) - the operator console h1 is unasserted.** `packages/web/src/components/operator/OperatorConsole.tsx:130` - renaming it ships undetected, though `05-UAT-PROCEDURES.md:2431,:2608` cite that line as the observable proof of sign-in. Note the heading cannot discriminate signed-in from signed-out anyway (`LoginPanel.tsx:25` renders the identical string). Higher-value adjacent gap: `secure: cookieSecure` (`packages/service/src/operator-auth.ts:252`), defaulted true at `packages/service/src/index.ts:696`, is never exercised true by any of the 14 call sites, and `operator-auth.spec.ts:116-118` asserts HttpOnly/SameSite/Path but not Secure.


## Killed on rebuttal

- **#4 (settings `envDefault` projection)** - caught by `packages/service/tests/runtime-settings.spec.ts:318-321` (every field `toHaveProperty('envDefault')`), `:331`, and `lifecycle-routes.spec.ts:617`; dropping it from `project()` is also a type error (`runtime-settings.ts:102-106`). Residual doc defect only: an unset `termsText` serializes as `{"changed":false}`, so "each carrying value/envDefault/changed" is inaccurate about the wire.
- **#9 (signet/mutinynet genesis collision)** - caught by `packages/shared/src/networks.spec.ts:61-68`, plus `:51-59` and `:71-79`. Citation-completeness issue, not a hole.
- **#12 (test-peers 404 body)** - caught by `packages/service/tests/lifecycle-routes.spec.ts:947`; the settled and never-existed 404s are emitted from the single branch at `hono-adapter.ts:1021-1023`.
- **#24 (served health object)** - caught by `packages/service/tests/monitor.spec.ts:1000` and `:1015` (`toEqual` on the exact four-key object over a real `app.request`), `pause.spec.ts:375`, `kill-switch.spec.ts:275,:638`. Only a contrived key-specific override on the serving line survives.
- **#26 (`app.get('*')` → `app.all('*')`)** - impossible: `packages/service/src/static-site.ts:60-63` 404s any `/v1/` path method-independently; re-enable routes are caught by `kill-switch.spec.ts:328,:330` and mutators by `:233-234`.

## Needs a mutation run

Reading settled all 27, but three carry enough subtlety that the rebuttal itself asked for empirical confirmation. Run serially, reverting each before the next.

1. **#14 (caller guard):** in `packages/web/src/stores/participant.ts:2158` replace `if (fate.kind !== 'ok' || !fate.canceled) { return; }` with `const canceled = fate.kind !== 'ok' ? true : fate.canceled; if (!canceled) { return; }`. Run: `pnpm test` (predicted green).
2. **#21 (rung-3 gains the gate):** insert `typeToConfirm={short}` into the rung-3 `ConfirmPanel` after `packages/web/src/components/operator/LifecycleActions.tsx:252`. Run: `pnpm test && pnpm e2e:browser:operator` (predicted green). Then invert to **#15**: delete `typeToConfirm={short}` at `:238` and rerun.
3. **#29 (merge/preserve refactor):** in `packages/service/src/operator-cohorts.ts:1231-1234` replace the conditional-spread with `explicit: { ...drafts.get(draftId)!.windows.explicit, ...(discoveryWindowMs !== undefined ? { discoveryWindowMs } : {}), ...(fundingWindowMs !== undefined ? { fundingWindowMs } : {}) }`. Run: `pnpm test && pnpm lint` (predicted green on both; the variant keeps both destructured vars used).

## Grouped fix plan

Ordered by defects closed per file touched.

**`packages/web/tests/lifecycle.spec.ts` - closes 3 (#15, #21, #8).** Add one `LIFECYCLE_ACTIONS_SRC = readFileSync('../src/components/operator/LifecycleActions.tsx')` block (same idiom as `:250-254`): (a) `typeToConfirm=` occurs exactly once; (b) that occurrence sits inside the `cancelRung(detail) === 4` branch and not in the rung-3 body; (c) `availability === 'broadcast' ?` is immediately followed by the `AFTER_BROADCAST` paragraph; (d) pin `CANCEL_LABEL`, `AFTER_BROADCAST`, `RUNG3_HEADING`, `RUNG4_HEADING`, `KEEP_RUNNING` as exported copy constants, em-dash-free.

**`packages/web/tests/service-controls.spec.ts` - closes 3 (#25, #20, #22/#10).** Export `MODE_LABEL` from `HealthStrip.tsx` and pin its three values plus `'Checking mode'`; add a `HealthStrip.tsx` source read proving the mode `Badge` expression reads only `mode`. Promote `DISMISS_BODY` at `:226` to a full `toBe`. Pin `NO_SEATS_LEFT_REASON` and the seven other test-peer constants (`packages/web/src/stores/operator.ts:312-337`) with an em-dash guard in the shape of `settings.spec.ts:203-213`, plus a `CohortDetail.tsx` source read for `disabled={remaining === 0}` and `remaining === 0 ? NO_SEATS_LEFT_REASON`.

**`packages/web/src/stores/participant.spec.ts` - closes 2 (#13, #14).** One `describe` that seats the store, stubs `fetch`, and calls `handlePostSeatSnapshot(rows, 'http://svc.example')` twice: assert the fate URL and `credentials:'omit'`; assert `canceled === true` only on a 200 `{canceled:true}`; assert it stays false for thrown / 500 / non-JSON / `{canceled:'yes'}`; one row where `pickedCohortId` changes before the read resolves, pinning the round guard at `participant.ts:2161`.

**`packages/service/tests/draft-edit.spec.ts` - closes 2 (#29, #32).** A `createDraft(window)` → `updateDraft(no window key)` round trip asserting the key is gone from the DTO and from `listCohorts()`, plus its positive twin; and `expect(await res.json()).toEqual({ error: 'unknown draft' })` at `:346` (mirror onto the DELETE and advertise 404s in `operator-cohorts.spec.ts:253,:386`).

**`packages/web/tests/operator-rows.spec.ts` - closes 2 (#17/#23, #1 residual).** Exact-label rows for `co-signed`, `co-signed-fallback`, `co-signing`, `anchored`, plus `not.toMatch(/anchor/i)` on the unconfirmed pair. Extend the existing `LIST_SRC` block with `disabled={isAdvertising || advertisingPaused}` and the two reason spans.

**`packages/web/tests/cohort-form.spec.ts` - closes 2 (#30, #31).** Literal pins for `THRESHOLD_ERROR` and `SIZE_ERROR`; assertions for a new exported `formFromDraft` helper. **Requires a src refactor**: extract `DraftEditForm.tsx:126-130` seeding into `packages/web/src/lib/cohort-form.ts`.

**`packages/web/tests/tx-client.spec.ts` - closes 1 (#18).** A `network: 'mutinynet'` store row expecting `mismatch`, plus `calls.length` assertions on the accept and signet-family rows.

**`packages/web/tests/operator.spec.ts` - closes 1 (#16).** 401 rows for `cancelCohort` and `finalizeCohort` (auth/error/view/cancelling), plus the unreachable twin and finalize's 409 `refused` branch.

**`packages/service/tests/cohort-fate.spec.ts` - closes 1 (#19).** Dismiss an EXPIRED terminal record, then read the anonymous fate.

**`packages/service/tests/runtime-settings.spec.ts` - closes 1 (#5).** Boot a real `createService({cohortTtlMs})` and assert `service.settings` seeds/clamps and refuses over-ceiling saves.

**`packages/service/tests/lifecycle-routes.spec.ts` - closes 1 (#2).** Pause → distinct action → pause; the same shape for resume-on-unpaused and disable → cancel → disable.

**`packages/service/tests/pause.spec.ts` - closes 1 (#1).** Literal pin + library-leak guard for `ADVERTISING_PAUSED_REASON`.

**`packages/service/tests/test-peers.spec.ts` - closes 1 (#11).** Live-mode and hermetic pair over the real `createService` wiring.

**`packages/shared/tests/tos.spec.ts` - closes 1 (#6).** Known-answer vector for `termsHashHex` (empty string and a non-ASCII body) plus the `termsAcceptanceSigningBytes` identity.

**`packages/web/tests/terms.spec.ts` - closes 1 (#7).** One `toMatch` for the early return in the existing containment block.

**`e2e/browser-operator.ts` - closes 2 (#27, #3).** `count() === 0` for `Disable broadcast` on the hermetic boot, reusing the idiom at `:243`; a heading assertion after `:155` (only useful if the logged-in heading is first given copy distinct from `LoginPanel.tsx:25`). Optionally a pause leg closing #1's component residual.

**New infrastructure required:**
- **#28** needs a live regtest browser leg (a Chromium page bolted onto `e2e/live-uat.ts`) and a new `package.json` e2e script entry. Every existing browser harness is hermetic by construction, so the reflected arm cannot be reached today. Ship the cheap hermetic copy pin now and file the live leg.
- **#31** and any real render assertion for `TermsStep`, `LifecycleActions`, `ServiceControls`, `CohortDetail`, `HealthStrip` and `DraftEditForm` would need a DOM environment in `packages/web` (there is no vitest config anywhere in the repo). Every fix above is deliberately written to avoid that; if a jsdom env is ever added, roughly eight source-containment pins become real render tests.
- Note `packages/web` is **not** in the root `tsc -b` project references (root `tsconfig.json` lists shared/service/participant/e2e only), so `pnpm test` never typechecks the web package. That is why so many web mutations are type-invisible to the gate.

## Headline

This is a copy-and-wiring coverage problem, not a protocol one: the protocol, the auth boundary and the server-side refusals are genuinely covered, but almost every honesty claim Phase 5 shipped lives in an unrendered React component or an unpinned string constant, and `packages/web` is not even typechecked by `pnpm test`, so 24 mutations across the operator console and participant store ship green. Fix `packages/web/tests/lifecycle.spec.ts` first: one source-containment block over `LifecycleActions.tsx` closes the money-adjacent funded-cancel gate that `05-19-PLAN.md:34` already claimed was load-bearing, plus the post-broadcast cancel suppression that has no server-side backstop at all.