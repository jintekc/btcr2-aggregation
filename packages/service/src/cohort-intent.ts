/**
 * Per-service cohort INTENT registry (SVC-04, D-05, RESEARCH Pattern 1): why a cohort is
 * about to be stopped, DECLARED BEFORE the library call that stops it.
 *
 * This module exists because `AggregationServiceRunner.stopCohort` is SILENT. It emits no
 * runner event at all: it flips `ctx.settled`, disposes the cohort, calls
 * `session.removeCohort`, and rejects the cohort's completion promise, with no
 * `this.emit(...)` anywhere in its body (every OTHER terminal path emits `'error'` and
 * usually `'cohort-failed'` first). Every fate consumer in this app learns cohort outcomes
 * from a `runner.on(...)` handler ({@link file://./monitor.ts}) or from the completion
 * rejection ({@link file://./operator-cohorts.ts} `settleCompletion`), so a naive
 * `stopCohort` call would produce NO monitoring record and would be filed as an ordinary
 * `expired` cohort. Both outcomes contradict D-05: an operator-initiated cancel is a
 * deliberate, distinct fate, never a stall and never a failure.
 *
 * Classifying by the rejection's MESSAGE TEXT is forbidden, and this registry is what
 * replaces it. `stopCohort` rejects with an `AggregationServiceError` carrying code
 * `COHORT_STOPPED` and the message `Cohort {id} stopped.`, but the whole-runner `stop()`
 * rejects through the SAME channel with `RUNNER_STOPPED` and a different message, and a
 * service shutdown must never be narrated to the operator as a cancel. Matching on strings
 * is exactly the technique the Phase 4 D-45 stall-copy fix was created to stop; the registry
 * is the out-of-band channel that carries the intent honestly instead.
 *
 * The registry is deliberately GENERIC over the reasons an app-side actor ends a cohort, so
 * the per-draft discovery-window timer (which can only ever SHORTEN the runner's per-runner
 * TTL, RESEARCH Pitfall 7) rides the same seam with a `'window-expired'` tag.
 *
 * Two properties are load-bearing, both copied from the proven per-cohort map idiom in
 * {@link file://./anchor-state.ts}:
 * - It is a per-service closure factory, NEVER a module singleton, mirroring the
 *   closure-scoped Maps in `createAnchorState` / `createCohortMonitor` /
 *   `createOperatorCohorts`, so two services in one process (tests) never share intents.
 * - The Map is bounded at {@link MAX_INTENTS} with oldest-first (insertion-order) eviction
 *   and is cleared on settle, so an operator-triggerable action cannot grow it without
 *   limit (T-05-01-03, DoS; the Phase 4 review WR-02 precedent).
 */

/**
 * Why an app-side actor is about to stop a cohort. `'canceled'` is the operator's explicit
 * Cancel action (D-01/D-05); `'window-expired'` is the app-enforced per-draft discovery
 * window lapsing (D-11), which the library cannot express per cohort.
 */
export type CohortIntent = 'canceled' | 'window-expired';

/** The declare / read / clear surface both fate consumers share. */
export interface CohortIntentRegistry {
  /**
   * Record why this cohort is about to be stopped. MUST be called BEFORE
   * `runner.stopCohort`, because that call rejects the completion promise and the reject
   * branch is what reads this tag.
   */
  declare(cohortId: string, intent: CohortIntent): void;
  /** Read a declared intent. `undefined` means the cohort died on its own (stall / TTL). */
  read(cohortId: string): CohortIntent | undefined;
  /** Drop the tag once the fate has been folded, so it can never be read twice. */
  clear(cohortId: string): void;
}

/**
 * Upper bound on retained intent tags (mirrors the `MAX_TERMINAL` / `MAX_MONITORED` = 24
 * bound every other per-cohort map in this service uses). A tag normally lives for a single
 * microtask turn (declared just before `stopCohort`, cleared by the settlement), so this cap
 * is purely the backstop for a tag whose settlement never runs (a service stopped mid-cancel).
 */
const MAX_INTENTS = 24;

/**
 * Build a per-service intent registry. Closure-scoped state, never a module singleton, so
 * two services in one process hold completely independent intents.
 */
export function createCohortIntents(): CohortIntentRegistry {
  const intents = new Map<string, CohortIntent>();

  return {
    declare(cohortId: string, intent: CohortIntent): void {
      // Delete-then-set moves the key to the END of the insertion order (the anchor-state
      // `remember` idiom), so a freshly declared intent is never the entry evicted.
      intents.delete(cohortId);
      intents.set(cohortId, intent);
      while (intents.size > MAX_INTENTS) {
        const oldest = intents.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        intents.delete(oldest);
      }
    },

    read(cohortId: string): CohortIntent | undefined {
      return intents.get(cohortId);
    },

    clear(cohortId: string): void {
      intents.delete(cohortId);
    },
  };
}
