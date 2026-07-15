# k-of-n Cohort Design (gap G-02-1)

Status: verified design, ready for gap-closure planning
Produced: 2026-07-15, by a research + design + adversarial-verify workflow (4 research lenses,
1 synthesis, 3 adversarial verifiers). All verifier corrections are folded in below.
Consumed by: the G-02-1 gap-closure plan (02-08).

## Target model (user-confirmed at UAT Test 1)

The operator sets TWO numbers:

1. **Cohort size n** (seats). The cohort does NOT finalize/start signing until all n have joined.
   Mechanism: `minParticipants == maxParticipants == n` (already shipped by 02-05, keep verbatim).
2. **Signing threshold k**, `1 <= k <= n`: the minimum signers required for the cohort to anchor.
   Mechanism: `fallbackThreshold = k` on the CohortConfig (plumbing shipped by 02-07). The
   optimistic PRIMARY spend stays n-of-n MuSig2 (all n co-sign the cheap Taproot key path). If that
   round stalls mid-signing, the ADR-042 k-of-n script-path fallback completes as long as at least
   k of the n sign. There is NO genuine k-of-n PRIMARY in `@did-btcr2/aggregation@0.4.0`; k is the
   fallback floor.

Directory honesty: `joined/n seats` + a `k-of-n` co-sign figure (DTO `capacity = n`,
`threshold = k`). This restores the second number 02-05 removed, with correct semantics: the second
number is the signing floor k, NOT the removed phantom `maxParticipants` ceiling. No F1b
regression: every seat still fills (finalize-at-n), so both numbers stay truthful.

## Library facts (verified against the 0.4.0 .d.ts and dist)

- Finalize gates on `minParticipants`; `maxParticipants = n` blocks an n+1th opt-in, so signing
  starts at exactly the nth join. No `onReadyToFinalize` override needed.
- `fallbackThreshold` validated by the app to integer `[1, participants]`
  (`packages/shared/src/index.ts:352-361`) and by the library to `<= maxParticipants`
  (dist/cjs/index.js:344). Both bounds equal n under the min==max==n pin.
- When `fallbackThreshold` is UNSET the library derives **n-1 floored at 1**
  (dist/cjs/index.js:217 `advertised ?? Math.max(1, n-1)`) and commits THAT leaf into the beacon
  address (p2tr_ms leaf, :247). This matters twice (see Decisions and e2e below).
- `autoFallbackOnStall` wires the phase-stall timer (`phaseTimeoutMs`, 30-min default since 02-06)
  to `triggerFallback`; it fires ONLY on a SIGNING-phase stall. An idle Advertised stall still
  expires the cohort (02-06 surfaced expiry). `triggerFallback` latches `committedPath` before
  sending anything, so a late optimistic signature cannot race a competing spend.
- The script-path `AggregationResult` has `path: 'script-path'`; its `signature` length is NOT
  asserted anywhere today (fallback e2e asserts only `path`). Do not hard-assert `sigLen === 0`.
- Fallback completion gate: `accepted.size >= fallbackThreshold` (dist :1215-1222); fewer than k
  fallback signatures yields `Not enough valid fallback signatures` and cohort-failed.
- Fixture path: `buildFixtureTxData` (02-07 fix) spends the real beacon-address output computed
  from the SAME config, so a k<n leaf validates hermetically end to end.

## Decisions (resolved; the plan should treat these as settled)

1. **`threshold` is OPTIONAL on the wire, defaulting to `size` (k = n).** Backward-compatible with
   any `{ beaconType, size }` caller. The create form always sends both. Normalize with
   `const k = input.threshold ?? size` so `null` AND omitted both default to n, then guard
   integer `[1, size]` with the exact THRESHOLD_ERROR literal BEFORE `buildCohortConfig` (a raw
   library throw must never be the 400 body).
2. **createDraft ALWAYS sets `fallbackThreshold = k` explicitly, including k == n.** Honesty note
   (verifier-corrected, do not claim byte-identical): today's 4-arg call left the leaf at the
   library's implicit n-1, so a default cohort's committed beacon address CHANGES (n-1 leaf -> n
   leaf). This is deliberate: it closes a pre-existing honesty gap where the UI said "all signers
   required" while the committed script tree let n-1 anchor. Safe: no addresses are persisted, the
   fixture recomputes from config on both sides, LIVE derives fresh addresses, and no e2e asserts
   a specific address. Document this in the createDraft comment and the plan.
3. **THRESHOLD_ERROR literal (server + client identical):**
   `Signing threshold must be a whole number between 1 and the cohort size.`
4. **Fallback-off over-promise guard (T-KOFN-02 mitigation, upgraded to code):**
   `createOperatorCohorts` gains an `autoFallbackOnStall: boolean` option (threaded from
   `createService`, which receives it already). `validateDraft` REJECTS `k < size` when the
   fallback is disabled, with a clear 400 (e.g. `A signing threshold below the cohort size needs
   the stall fallback, which this service disabled (AUTO_FALLBACK=0).`). This makes "anchors with
   at least k of n" impossible to over-promise. k == n remains allowed either way.
5. **k == n accepted as the honest default** (caption degrades to "all signers required").
6. **e2e:kofn stays out of CI** (inherits the Phase-6 CI-debt deferral, same as e2e:operator).

## DTO mapping (canonical; flip every emit site atomically, T-KOFN-05)

- `capacity = n` = `config.maxParticipants ?? config.minParticipants` (unchanged).
- `threshold = k` = `config.fallbackThreshold ?? config.minParticipants` (defensive coalesce; the
  ?? arm is unreachable for new drafts since createDraft always sets k, but protects legacy
  configs from emitting `undefined-of-n`, T-KOFN-06).
- Emit sites in `operator-cohorts.ts`: (a) createDraft DTO (`threshold: k, capacity: size`);
  (b) `directory()` (currently `threshold: config.minParticipants`); (c) advertiseDraft copies
  the entry DTO, inherits (a) with no edit; (d) `readvertiseExpired` (the F2 re-advertise DTO);
  (e) the `listCohorts` expired branch (the F2 operator-list record). Sites (d) and (e) read the
  retained terminal record's config, which carries k because createDraft always set it.

## File-by-file changes

- `packages/service/src/operator-cohorts.ts`: THRESHOLD_ERROR const next to SIZE_ERROR;
  `DraftInput` gains `threshold?: number`; `validateDraft` normalizes `?? size`, guards
  `[1, size]`, and (Decision 4) rejects `k < size` when fallback is off; `createDraft` passes k as
  the `buildCohortConfig` 5th arg, keeps `config.maxParticipants = size` VERBATIM (T-KOFN-04), DTO
  `threshold: k, capacity: size`, log `${k}-of-${size}`; flip read paths (b)(d)(e) per the mapping;
  header/JSDoc rewritten to the two-field model (no em-dash character anywhere).
- `packages/service/src/index.ts`: thread `autoFallbackOnStall` (existing option) into
  `createOperatorCohorts` opts. No other change.
- `packages/service/src/hono-adapter.ts`: create-route comment + malformed-body 400 string ->
  `{ beaconType, size, threshold }`. No route-logic change.
- `packages/service/src/operator-cohorts.spec.ts` (TDD RED first): size=3/threshold=2 -> 201 with
  `capacity===3 && threshold===2`; threshold=4 (>size) -> 400 THRESHOLD_ERROR; threshold=0 -> 400;
  `{threshold: null}` -> 201 with k=n; `{threshold: '2'}` -> 400; size=0 -> 400 SIZE_ERROR kept;
  advertise/expiry/readvertise directory+list assertions on `threshold=2/capacity=3` (k<n draft);
  a config-contract assertion `fallbackThreshold <= maxParticipants === minParticipants === n`;
  the fallback-off guard: `k < size` with `autoFallbackOnStall: false` -> 400.
- `packages/web/src/lib/operator.ts`: `DraftInput` gains `threshold: number` (+ JSDoc: size = n
  seats, threshold = k signing floor). DTO interfaces unchanged (threshold now MEANS k).
- `packages/web/src/stores/operator.ts`: no behavior change (forwards the whole DraftInput);
  JSDoc touch only.
- `packages/web/src/components/operator/CreateCohortForm.tsx`: second Field
  `Signing threshold (k of n)` bound to `thresholdText` initialized from `sizeText` (defaults
  k = n); client guard mirrors THRESHOLD_ERROR exactly; submit `{ beaconType, size, threshold }`;
  relabel size Field to `Cohort size (seats)`.
  Help copy (verifier-corrected, states the unanimous norm AND the fallback condition):
  size: `Everyone in the cohort co-signs together, so this is the number of seats and the n in
  n-of-n. The cohort starts only once every seat is filled.`
  threshold: `Everyone co-signs first. If a signer stalls, the cohort can still anchor as long as
  at least this many of the n seats sign. Set it equal to the size to require everyone.`
- `packages/web/src/components/browse/CohortRow.tsx`: the value line drops the redundant
  `Co-sign:` prefix (the MetricLabel already renders CO-SIGN) and becomes
  `{row.threshold}-of-{row.capacity}`. Caption becomes conditional:
  k == n -> `all signers required`;
  k < n -> `all co-sign; anchors if at least {k} of {n} sign`.
  Header JSDoc `n-of-n` -> `k-of-n`. Seats line unchanged.
- `packages/web/src/components/operator/OperatorCohortList.tsx` (parity): a muted span
  `Co-sign: {cohort.threshold}-of-{cohort.capacity}` next to the seats span for all states, plus
  a tiny text-xs text-faint `fallback floor` hint when k < n (or the participant caption verbatim).
- `packages/web/src/components/browse/DirectoryList.spec.ts` (TDD RED): fixture threshold:2 /
  capacity:3 asserts `2-of-3` + the k<n caption; a k==n fixture asserts `all signers required`.
- `e2e/operator-cohort.ts` + `e2e/browse-join-cohort.ts`: create bodies gain
  `threshold: THRESHOLD` (k = n = 2, both legs stay pure n-of-n green); log strings become
  `{threshold}-of-{capacity}`; add `capacity === n` asserts.
- `e2e/kofn-cohort.ts` (NEW) + `package.json` script `e2e:kofn` (see below).
- `.planning/phases/02-.../02-UI-SPEC.md` line ~153: stale n-of-n co-sign copy -> the k-of-n label
  + honest caption; note the second number is the signing floor k, not the removed ceiling.

## The hermetic capstone: e2e/kofn-cohort.ts (verifier-corrected, false-green-proof)

CRITICAL parameter choice: **n = 4, k = 2** (NOT n=3/k=2). With n=3/k=2, k equals the library's
n-1 default, so the fallback would complete identically even if the operator's k never reached the
config: a false-green. With n=4/k=2, a broken thread leaves the library default n-1=3, and a
2-survivor fallback FAILS (`Not enough valid fallback signatures`), so the leg genuinely proves the
operator's k reached the signing gate AND the committed leaf.

Leg 1 (operator k honored, upper path): boot `createService` hermetic with `operatorPassword`,
`operatorCookieSecure: false`, `autoFallbackOnStall: true`, `phaseTimeoutMs: 800`, generous
`cohortTtlMs`. Login -> POST create `{ beaconType: 'CASBeacon', size: 4, threshold: 2 }` -> assert
201, `capacity === 4 && threshold === 2` (independent numbers) -> advertise -> GET /v1/directory
(anonymous) asserts the row shows `capacity 4 / threshold 2 / joined 0 / Advertised` (the honest
`2-of-4` the UI renders). Start FOUR participants picking that cohortId (fills 4/4, seats assert).
Drop TWO participants on their first `signing-requested` (after finalize, nonces withheld) so the
optimistic 4-of-4 round stalls; `autoFallbackOnStall` fires after ~800ms. Hard gate (race
signing-complete vs cohort-failed, withTimeout): `fallback-started` observed AND
`result.path === 'script-path'` AND both survivors reach `cohort-complete`. Signature length is
logged as informational only, never hard-asserted. On cohort-failed, fail loudly with the
fixture-prevout finding message (do not skip).

Leg 2 (k is a real floor, lower bound): fresh service, same config, drop THREE of the four on
signing-requested (1 survivor < k=2). Expect the fallback attempt to FAIL: assert cohort-failed
(reason contains the not-enough-fallback-signatures message), NOT signing-complete. This pins that
k genuinely gates anchoring (guards against a clamp-to-1 regression).

Idiom: mirror e2e/fallback-cohort.ts (problems list, withTimeout, module-prefixed logs, finally
teardown). package.json: `"e2e:kofn": "tsc -b && tsx e2e/kofn-cohort.ts"`, NOT wired into CI.

## Threats

| ID | Threat | Disposition |
|----|--------|-------------|
| T-KOFN-01 | Caption implies only k routinely sign | mitigate: caption states the unanimous norm (`all co-sign; anchors if at least k of n sign`); form help names the stall condition |
| T-KOFN-02 | k over-promise when the service runs with AUTO_FALLBACK=0 | mitigate IN CODE: validateDraft rejects k < size when fallback is off (Decision 4) |
| T-KOFN-03 | threshold>size / non-integer / null reaching buildCohortConfig raw throw | mitigate: normalize `?? size`, guard `[1, size]` with THRESHOLD_ERROR before build; library guard stays as backstop |
| T-KOFN-04 | Un-pinning min==max==n reintroduces the F1b phantom seat | mitigate: only `fallbackThreshold` carries k; config-contract unit assertion |
| T-KOFN-05 | Partial semantic flip (display changes, server mappers do not) | mitigate: all four server emit sites + web display in ONE plan; audit every DTO.threshold reader |
| T-KOFN-06 | `undefined-of-n` from a legacy config | mitigate: createDraft always sets k; read paths coalesce `?? minParticipants` |
| T-KOFN-07 | e2e false-green | mitigate: n=4/k=2 (distinguishable from the n-1 default) + the lower-bound leg + hard event race, no silent skip |

## Verification (the plan's gates)

`pnpm typecheck`; `pnpm test` (reworked operator-cohorts + cohort-config + new DirectoryList
fixtures); NEW `pnpm e2e:kofn` (both legs); `pnpm e2e:operator` + `pnpm e2e:browse` (two-field
bodies, k=n legs stay green); `pnpm e2e:fallback` unchanged; web `tsc --noEmit` + `vite build`;
`pnpm lint`; grep the diff for the em-dash character (zero) and for any leftover
`{row.threshold}-of-{row.threshold}` (zero).

## Suggested task breakdown (planner may regroup; keep TDD where behavior-adding)

1. (TDD) Server: threshold accept/validate/thread + DTO flip at all four emit sites + the
   fallback-off guard + config-contract assertion (spec RED, then operator-cohorts.ts +
   index.ts threading + hono-adapter strings GREEN).
2. (TDD) Web display: DirectoryList.spec RED for `2-of-3` + captions, then CohortRow +
   OperatorCohortList + CreateCohortForm + lib/operator.ts types GREEN; UI-SPEC copy touch.
3. e2e: update the two existing capstone bodies (k=n) + NEW e2e/kofn-cohort.ts (n=4/k=2, two
   legs) + package.json script; full gate re-run.
