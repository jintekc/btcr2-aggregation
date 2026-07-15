---
phase: 02-participant-discovery-browse-and-pick-join
reviewed: 2026-07-15T23:10:29Z
depth: deep
files_reviewed: 15
files_reviewed_list:
  - packages/service/src/operator-cohorts.ts
  - packages/service/src/operator-cohorts.spec.ts
  - packages/service/src/index.ts
  - packages/service/src/hono-adapter.ts
  - packages/web/src/lib/operator.ts
  - packages/web/src/lib/directory.ts
  - packages/web/src/stores/operator.ts
  - packages/web/src/components/operator/CreateCohortForm.tsx
  - packages/web/src/components/browse/CohortRow.tsx
  - packages/web/src/components/operator/OperatorCohortList.tsx
  - packages/web/src/components/browse/DirectoryList.spec.ts
  - e2e/operator-cohort.ts
  - e2e/browse-join-cohort.ts
  - e2e/kofn-cohort.ts
  - package.json
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: issues_found
---

# Phase 2: Code Review Report (plan 02-08 / gap G-02-1, k-of-n cohort model)

**Reviewed:** 2026-07-15T23:10:29Z
**Depth:** deep
**Files Reviewed:** 15
**Status:** issues_found (3 info, 0 blocker, 0 warning)

## Summary

This review supersedes the earlier gap-closure review at the same path. It targets the two-field
k-of-n cohort model: cohort size n (`minParticipants == maxParticipants == n`) plus signing
threshold k (`fallbackThreshold = k`), with the optimistic n-of-n MuSig2 spend unchanged and k as
the ADR-042 stall-fallback floor.

I traced every focus area adversarially and each holds up:

- **Server validation (`validateDraft`, operator-cohorts.ts:234-255) is airtight against a
  hand-crafted body.** `k = threshold ?? size` correctly defaults both `undefined` and `null` to n
  (both nullish); `0 ?? size` correctly stays 0 and is rejected. `Number.isInteger(k)` rejects
  string `'2'`, boolean, array, object, `Infinity`/`NaN` (from `1e309`), `-0`, and floats; the
  `[1, size]` bound rejects 0, negatives, and `> size`. The guard runs BEFORE `buildCohortConfig`,
  so the library's own `fallbackThreshold` guard (shared/index.ts:352-361) is only a backstop and a
  raw library throw is never the 400 body. THRESHOLD_ERROR is byte-identical across
  operator-cohorts.ts:84, CreateCohortForm.tsx:10, and the spec at :86. The fallback-off guard
  (Decision 4) rejects `k < size` when `autoFallbackOnStall` is off and is threaded consistently
  from `createService` into both the runner and `createOperatorCohorts` (index.ts:432 and :549), so
  the runner's fallback capability and the operator surface's over-promise gate can never diverge.
- **Atomic DTO flip (T-KOFN-05) is complete.** All four emit sites carry `threshold = k` with the
  `?? minParticipants` defensive coalesce: createDraft DTO (:392), `directory()` (:360-361),
  `readvertiseExpired` (:454-455), and the `listCohorts` expired branch (:480). `advertiseDraft`
  copies the draft DTO (:421-422) and `listCohorts`'s advertised branch maps `directory()` output,
  so both inherit the flip. No reader interprets `threshold` as n: `isJoinable`, `statusLabel`, and
  `CohortRow` all key seat/fullness logic on `capacity` (= n), never on `threshold`.
- **min == max == n pin is verbatim** (createDraft :383 `config.maxParticipants = size` after
  `buildCohortConfig`, which sets only `minParticipants`). The config-contract spec
  (operator-cohorts.spec.ts:480-497) pins `min === max === 3 && fallbackThreshold === 2`. Only
  `fallbackThreshold` carries k (T-KOFN-04, no phantom seat).
- **Display honesty holds.** `cosignValue`/`cosignCaption` (directory.ts:98-112) render `k-of-n` and
  the k==n / k<n captions the spec asserts. No em-dash (U+2014) in any changed file (grep clean);
  `MetricLabel` uses `font-semibold` (600), no `font-medium` (500) in changed components; the two
  `font-medium` hits are in KeyGenPanel/JoinIdentityStep, both out of scope for this diff.
- **e2e/kofn-cohort.ts is false-green-proof.** n=4/k=2 is genuinely distinguishable from the
  library's implicit n-1=3 default; Leg 1 hard-gates on `fallback-started` + `path === 'script-path'`
  + both survivors' `cohort-complete` (via `Promise.all`), and a broken k-thread would surface as
  `cohort-failed` and fail loudly. Leg 2 (1 survivor < k) asserts `cohort-failed` with a
  `/fallback/i` reason. The Leg 2 pass/fail is driven SOLELY by the service-side
  `signing-complete` vs `cohort-failed` race; participant-side `cohort-complete` events feed only
  `survivorsComplete`/`survivorCompletions`, which Leg 2 never inspects (guarded by `if (outcome.ok)`
  and the Leg 2 branch reads only `outcome`). Even a regression that made the service emit
  `signing-complete` in Leg 2 would correctly FAIL the leg. See IN-01 for the benign counter smell.
- **Security: no new unauthenticated mutating surface.** The create/advertise/readvertise routes are
  registered inside the `if (operatorAuth) { ... if (operatorCohorts) { ... } }` block in
  hono-adapter.ts, after `requireSameOrigin` + `requireOperator` prefix guards, so they inherit the
  session gate and CSRF check unchanged. `/v1/directory` and `/v1/status` remain public reads.

No blocker or warning-severity defects were found. The three info items below are minor.

## Narrative Findings (AI reviewer)

### Info

#### IN-01: `survivorsComplete` counter in kofn-cohort.ts is non-idempotent

**File:** `e2e/kofn-cohort.ts:256-258` (increment) and `:343`, `:348` (Leg 1 use)
**Issue:** `survivorsComplete += 1` fires on every participant `cohort-complete` event. The prompt's
own observation that a survivor logged `cohort-complete` twice confirms this event can fire more than
once per participant, so the counter can exceed the true distinct-survivor count. It is used in Leg 1
as `if (survivorsComplete < K)` (:343) and in the success log (:349). This is harmless in practice
because `withTimeout(Promise.all(survivorCompletions), 15_000)` (:298) is the real gate and requires
each distinct survivor promise to resolve, so a double-emit by one survivor cannot mask a missing
survivor. But the counter is redundant/misleading as a secondary gate, and the underlying double-emit
(a survivor reporting `cohort-complete` while the cohort ultimately fails in Leg 2) is a latent
participant-side semantic smell worth noting, though it originates in `@did-btcr2/aggregation`
(out of this diff's scope), not in the reviewed code.
**Fix:** Track distinct survivors with a `Set<participantIndex>` and derive the count from `.size`,
or drop the counter entirely and rely on the `Promise.all(survivorCompletions)` gate that already
proves each survivor completed:
```ts
const survivors = new Set<number>();
// in the handler: survivors.add(dropCount + i);
// then: if (survivors.size < K) fail(...);
```

#### IN-02: create-form threshold field can silently desync from size (k < n by accident)

**File:** `packages/web/src/components/operator/CreateCohortForm.tsx:35-36`
**Issue:** `thresholdText` is initialized to the constant `'2'` independently of `sizeText` (also
`'2'`). The design's "defaults k = n" only holds at the initial mount value. If the operator raises
the size (e.g. to 5) without touching the threshold field, the form submits `{ size: 5, threshold: 2 }`
- an unintended k<n cohort. On a fallback-enabled service this is accepted and advertised as `2-of-5`;
on a fallback-off service it is rejected with FALLBACK_OFF_ERROR. The value is visible in its own
field with help copy, so this is not a correctness bug, but the "unanimous by default" intent is
easy to defeat silently.
**Fix:** Either keep the threshold in lockstep with size until the operator explicitly edits it (track
a `thresholdTouched` flag and mirror `sizeText` into `thresholdText` while untouched), or clamp/warn
in `submit()` when `threshold < size` and the operator has not changed the threshold field.

#### IN-03: createDraft surfaces any `buildCohortConfig` throw verbatim as the 400 body

**File:** `packages/service/src/hono-adapter.ts:337-340` (catch-all) with
`packages/service/src/operator-cohorts.ts:382`
**Issue:** The create route returns `err.message` verbatim on any throw from `createDraft`.
`validateDraft` guards the known bad-input cases (beacon type, size, threshold, fallback-off) with
UI-SPEC copy, so those are intentional. But `buildCohortConfig` can still throw for other reasons
(e.g. an invalid `recoveryKey`, shared/index.ts:339-350), and that internal message would become the
400 body. In practice `recoveryKey` is server-supplied (from the cohort config, not the form), so an
untrusted caller cannot influence it - hence info, not warning. Worth a defensive note so a future
form field that reaches `buildCohortConfig` does not inadvertently leak an internal error string.
**Fix:** Keep validated user-facing throws distinguishable from library throws (e.g. a sentinel error
type or a whitelist of the known messages), returning a generic "could not create cohort" for
anything else while logging the detail server-side, mirroring the resolve/tx routes' generic-502
pattern.

---

_Reviewed: 2026-07-15T23:10:29Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
