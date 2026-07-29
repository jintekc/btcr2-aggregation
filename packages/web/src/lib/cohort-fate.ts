/**
 * Browser client for the PUBLIC cohort-fate read `GET /v1/cohort-fate/:id` (SVC-04, D-02).
 *
 * The third anonymous sibling beside {@link file://./anchor.ts} and {@link file://./funding.ts},
 * and it exists for a reason none of the protocol channels can serve: the aggregation protocol
 * has NO message type that could carry an operator's cancel to a seated participant. They learn
 * their cohort is gone only by its absence from the directory, which is honest but says nothing
 * about why. This read carries the one bit that turns "the cohort ended and this service didn't
 * say why" into "the operator canceled this cohort".
 *
 * Anonymous by construction: `credentials: 'omit'` (the anchor/funding/directory precedent), so
 * a participant's public read never carries an operator session cookie.
 *
 * Two design rules, both about not inventing certainty (T-05-10-04):
 *
 * 1. It NEVER throws. Every failure - unreachable service, non-2xx, malformed body - returns the
 *    neutral `unreachable` result, and the caller renders the inherited honest fallback. A
 *    network fault must never be able to fabricate an accusation against an operator.
 * 2. The canceled fact must be a REAL boolean `true`. Anything else (a string, a number, a
 *    missing key) reads as not canceled, because a specific attribution is a positive claim.
 */

/** The `GET /v1/cohort-fate/:id` body, mirroring the service `CohortFateDTO`. */
export interface CohortFateDTO {
  /**
   * True ONLY when the service holds a retained terminal record whose fate is the operator's
   * deliberate cancel. Unknown, evicted, never-existed, expired, failed, completed, live, and
   * draft cohorts all read `false`, so the read is not an existence oracle.
   */
  canceled: boolean;
}

/**
 * The result of one fate read. Discriminated rather than a bare boolean so "the service said
 * not canceled" and "we could not ask" stay distinguishable at the call site - they lead to the
 * same copy today, but collapsing them would make a future difference impossible to express.
 */
export type CohortFateResult = { kind: 'ok'; canceled: boolean } | { kind: 'unreachable' };

/** Same-origin fetch timeout, matching the anchor/funding/config client budget. */
const TIMEOUT_MS = 8000;

/**
 * Read whether `cohortId` was canceled by the operator of the coordinator at `baseUrl`.
 * PUBLIC and anonymous. Called ONCE, after the post-seat gone streak has already declared the
 * cohort dead - never on a poll loop, so it adds no recurring anonymous load (T-05-10-03) and
 * cannot change the timing of the streak it follows (03-07 CR-01).
 */
export async function fetchCohortFate(baseUrl: string, cohortId: string): Promise<CohortFateResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/cohort-fate/${encodeURIComponent(cohortId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (!res.ok) {
    return { kind: 'unreachable' };
  }
  try {
    const body = (await res.json()) as Partial<CohortFateDTO>;
    // Strict `=== true`: only a real boolean true is an attribution.
    return { kind: 'ok', canceled: body?.canceled === true };
  } catch {
    return { kind: 'unreachable' };
  }
}
