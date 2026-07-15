---
phase: 02-participant-discovery-browse-and-pick-join
reviewed: 2026-07-15T18:38:13Z
depth: deep
files_reviewed: 17
files_reviewed_list:
  - e2e/browse-join-cohort.ts
  - e2e/fallback-cohort.ts
  - e2e/operator-cohort.ts
  - package.json
  - packages/service/src/demo-server.ts
  - packages/service/src/hono-adapter.ts
  - packages/service/src/index.ts
  - packages/service/src/live-tx.spec.ts
  - packages/service/src/operator-cohorts.spec.ts
  - packages/service/src/operator-cohorts.ts
  - packages/service/src/tx.ts
  - packages/shared/src/cohort-config.spec.ts
  - packages/shared/src/index.ts
  - packages/web/src/components/operator/CreateCohortForm.tsx
  - packages/web/src/components/operator/OperatorCohortList.tsx
  - packages/web/src/lib/operator.ts
  - packages/web/src/stores/operator.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 2: Code Review Report (gap-closure F1a/F1b/F2/F1c)

**Reviewed:** 2026-07-15T18:38:13Z
**Depth:** deep (cross-file: import graph + call chains)
**Files Reviewed:** 17
**Status:** issues_found

> Supersedes the initial Phase 2 review (2026-07-14). This pass covers only the
> gap-closure diff from base `d991d5c`.

## Summary

This gap-closure diff collapses the operator cohort model to a single n-of-n size
(F1a/F1b), adds a discovery-window lifetime plus surfaced-expiry + a gated re-advertise
route (F2), and activates the ADR-042 k-of-n script-path fallback with a fixture-tx change
so the hermetic prevout commits both spend paths (F1c).

The four security/correctness focus areas hold up under adversarial tracing:

- **min == max == n is unbypassable.** `validateDraft` reads only `{ beaconType, size }`
  from the untrusted body; `createDraft` builds the config from `size` alone and then forces
  `config.maxParticipants = size` (operator-cohorts.ts:313-320). No request field can inject
  `minParticipants`/`maxParticipants`; `buildCohortConfig` sets `minParticipants = size`.
  Extra body fields are silently ignored.
- **The re-advertise route inherits both guards.** `POST /v1/operator/cohorts/:id/readvertise`
  is registered inside `if (operatorAuth) { ... if (operatorCohorts) { ... } }`, after
  `app.use('/v1/operator/*', requireSameOrigin())` and `requireOperator()`
  (hono-adapter.ts:299-365). The e2e pins the no-cookie 401 (operator-cohort.ts:389-394;
  operator-cohorts.spec.ts:389-393). No unauthenticated mutating surface is added.
- **The terminal record set is bounded.** `MAX_TERMINAL = 24` with oldest-first eviction
  (operator-cohorts.ts:216, 241-250); Map insertion order gives a correct FIFO evict.
- **fallbackThreshold bounds are [1, participants]** (shared/index.ts:352-361) and n-of-n
  stays primary: `autoFallbackOnStall` defaults off in the library/createService and the
  operator path never passes a `fallbackThreshold`, so the optimistic key path is the normal
  outcome.
- **The tx.ts fixture change does not weaken the LIVE path.** Only the `if (!live)` fixture
  branch changed (tx.ts:67-78); the live branch still calls `buildAggregationBeaconTx`
  unchanged (tx.ts:117-129). `buildFixtureTxData`'s `beaconOutput` is optional and legacy
  callers keep the bare-key output (shared/index.ts:530-553).

No blockers. Three warnings and three info items follow.

## Warnings

### WR-01: Advertise / re-advertise failures surface in the wrong UI component

**File:** `packages/web/src/stores/operator.ts:180-183, 202-205` (rendered by `packages/web/src/components/operator/CreateCohortForm.tsx:49,88`)
**Issue:** On a failed `advertise`/`readvertise`, the store writes the error into `formError`
("Could not advertise the draft. Try again." / `UNREACHABLE`). But `formError` is only
rendered by `CreateCohortForm` (`shownError = clientError ?? formError`), not by
`OperatorCohortList`/`CohortRow` where the failing action lives. A failed Advertise on a
draft row therefore paints its error banner in the "Create a cohort" form, disconnected from
the row the operator clicked, and the row's `advertiseStatus: 'error'` is never shown. This
is an incorrect error surface: the operator gets no feedback next to the action that failed.
**Fix:** Route advertise/re-advertise failures to an action-scoped field (e.g.
`advertiseError?: string`) rendered inside `CohortRow`, and stop overloading `formError`
(whose own JSDoc scopes it to "the create form"):
```ts
// operator.ts advertise() failure branch
set({ advertiseStatus: 'error', advertisingId: undefined,
      advertiseError: 'Could not advertise the draft. Try again.' });
```
then render `advertiseError` in `CohortRow`.

### WR-02: A `null` / non-object create body yields a raw TypeError as the 400 message

**File:** `packages/service/src/operator-cohorts.ts:194-203` (route `packages/service/src/hono-adapter.ts:325-340`)
**Issue:** `validateDraft` starts with `const { beaconType, size } = input;`. The route only
guards non-JSON (catch → clean 400); a syntactically valid body of `null` (or a JSON
string/number) parses fine, then destructuring `null` throws `TypeError: Cannot destructure
property 'beaconType' of 'null'`. The route `catch` returns `c.json({ error: err.message },
400)`, so the caller receives an internal JS error string as the "validation" message. Still
a 400, but it leaks internal error text and breaks the guard-clause / user-facing-message
convention used by every other branch.
**Fix:** Guard the shape first, guard-clause style:
```ts
function validateDraft(input: DraftInput) {
  if (typeof input !== 'object' || input === null) {
    throw new Error('operator: expected a JSON body { beaconType, size }');
  }
  const { beaconType, size } = input;
  ...
}
```

### WR-03: An advertised cohort is invisible in the operator list during the signing phases

**File:** `packages/service/src/operator-cohorts.ts:397-407` (via `directory()` at 287-309; `OPEN_PHASES` at 62)
**Issue:** `listCohorts` derives its advertised rows from `directory()`, which lists only
cohorts whose phase is in `OPEN_PHASES` (`Advertised`, `CohortSet`, `CollectingUpdates`).
Once a cohort transitions into signing (`SigningStarted` and later) it is no longer in
`OPEN_PHASES`, and it is not yet pruned (success) or moved to `terminal` (reject), so it
appears in neither `advertisedDtos` nor `expiredDtos`: the cohort disappears from the
operator's own "Your cohorts" list for the whole signing window, then reappears only as gone
(success) or `expired` (stall/TTL). On the LIVE path that window can be up to `phaseTimeoutMs`
(defaulted to 30 min here), so an operator watching an in-flight cohort sees it vanish. This
is adjacent to F2's "never silently vanish" intent. (Pre-existing from Phase 1's
directory-derived list; the F2 work reinforces the invariant it violates without closing it.)
**Fix:** List in-flight advertised cohorts from the `advertised` map keyed by live id (with
the current phase) and reserve the `OPEN_PHASES` filter for the public `directory()` only.
Deferring to Phase 4 (operator monitoring) is acceptable only if explicitly tracked.

## Info

### IN-01: Stranded JSDoc block attached to `MAX_TERMINAL` instead of the function it describes

**File:** `packages/service/src/operator-cohorts.ts:205-216`
**Issue:** Two `/**` blocks stack before `const MAX_TERMINAL`. The first (205-210, "Build the
per-service operator cohort surface. `drafts` is closure state ...") documents
`createOperatorCohorts`, but the F2 edit inserted `MAX_TERMINAL` between it and the function,
so the doc is now attached to the constant and `createOperatorCohorts` (218) is undocumented.
**Fix:** Move the 205-210 block down to immediately above `export function createOperatorCohorts`,
leaving only the `MAX_TERMINAL` block (211-216) on the constant.

### IN-02: No upper bound on cohort `size`

**File:** `packages/service/src/operator-cohorts.ts:199-201`
**Issue:** `validateDraft` accepts any integer `size >= 1`. An authenticated operator can
create and advertise a cohort with an absurd `n` (e.g. millions); it becomes an `n`-of-`n`
cohort that can never fill and expires on the stall timer, and the number flows into the
public directory's `threshold`/`capacity`. Operator-gated, so low risk, but there is no sane
ceiling.
**Fix:** Add an upper guard (`size > MAX_COHORT_SIZE`) with a user-facing message in the same
guard-clause block.

### IN-03: Advertise / re-advertise routes have no handler-level try/catch

**File:** `packages/service/src/hono-adapter.ts:353-365`
**Issue:** `advertiseDraft`/`readvertiseExpired` call `runner.advertiseCohort(...)`
synchronously; the create route wraps its call in try/catch, but advertise and re-advertise
do not. If `advertiseCohort` throws, the operator gets an opaque Hono 500 instead of a clean
error, and on advertise the draft is left un-deleted. Not reachable with the current
single-size config, but inconsistent with the create route and brittle if the runner's
validation tightens.
**Fix:** Wrap both handlers in the same try/catch → `c.json({ error }, ...)` pattern the
create route uses.

---

_Reviewed: 2026-07-15T18:38:13Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
