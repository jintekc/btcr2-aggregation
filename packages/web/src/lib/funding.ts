/**
 * Browser client for the PUBLIC funding-signal read `GET /v1/funding/:cohortId`
 * (LIVE-01, D-44). Like the anchor read ({@link file://./anchor.ts}), this is a NEW,
 * ADDITIVE, anonymous sibling read - it does NOT touch the frozen public anchor read or
 * the directory DTO. It carries a single non-oracle bit: whether a live (on-chain)
 * cohort is still awaiting the operator's beacon funding after seats filled.
 *
 * Anonymous by construction: `credentials: 'omit'` (the anchor.ts / directory.ts
 * precedent) so a seated participant polling for the funding signal never sends an
 * operator session cookie. An unknown or hermetic cohort answers the same
 * `{ awaitingFunding: false }` as a funded one (no existence oracle, no amounts, no
 * keys), so the store treats "not awaiting funding" as a valid public answer.
 */

/** The `GET /v1/funding/:cohortId` body, mirroring the service `publicFunding` projection. */
export interface FundingDTO {
  /**
   * True ONLY while a live+broadcast cohort is still waiting for its operator to fund the
   * beacon address (the funding state is waiting / awaiting-confirmation). A hermetic cohort,
   * a funded/dead-end cohort, and an unknown cohortId all read `false`.
   */
  awaitingFunding: boolean;
}

/** Same-origin fetch timeout, matching the anchor/operator/config client budget. */
const TIMEOUT_MS = 8000;

/**
 * Read the last-known funding signal for `cohortId` from the coordinator at `baseUrl`.
 * PUBLIC: `credentials: 'omit'` so the anonymous cohort page never sends a session
 * cookie. Throws on a non-2xx / unreachable service (the poll caller swallows these as a
 * transient miss, never a terminal); an unknown/hermetic cohort is a normal
 * `200 { awaitingFunding: false }` answer, not an error.
 */
export async function fetchFunding(baseUrl: string, cohortId: string): Promise<FundingDTO> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/funding/${encodeURIComponent(cohortId)}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/funding failed: HTTP ${res.status}`);
  }
  return (await res.json()) as FundingDTO;
}
