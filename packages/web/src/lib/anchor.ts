/**
 * Browser client for the PUBLIC anchor-status read `GET /v1/anchor/:cohortId`
 * (PART-04, D-20/D-21). Anchor facts are public chain data, so this is anonymous by
 * construction: `credentials: 'omit'` (the {@link file://./directory.ts} precedent) so
 * the participant surface never sends an operator session cookie on this read.
 *
 * The DTO mirrors the service `AnchorReadDTO` (`packages/service/src/anchor-state.ts`):
 * an `enabled` mode-honesty bit (true only on a broadcasting service), a `state` that
 * folds the transient BeaconBroadcaster frames into a last-known value, and the public
 * chain facts (`txid`, derived `explorerUrl`, a GENERIC failure `reason`). An unknown
 * cohort answers `{ enabled, state: 'none' }` (never a 404), so the store treats
 * "no anchor facts" as a valid public answer rather than an existence oracle.
 */

/** The `bitcoin:`-anchoring lifecycle a cohort's beacon tx passes through. */
export type AnchorLifecycle = 'none' | 'broadcast' | 'confirmed' | 'failed';

/**
 * The `GET /v1/anchor/:cohortId` body, mirroring the service `AnchorReadDTO`.
 *
 * - `enabled` is the D-07 mode bit: `false` on the hermetic (no-broadcast) default, so
 *   the client renders signed/complete rather than claiming an on-chain anchor.
 * - `state` is `'none'` for an unknown/never-broadcast/evicted cohort.
 * - `txid`/`explorerUrl` appear once a cohort has a broadcast/confirmed frame.
 * - `reason` is a GENERIC failure summary, present only on `state: 'failed'`.
 */
export interface AnchorDTO {
  enabled: boolean;
  state: AnchorLifecycle;
  txid?: string;
  explorerUrl?: string;
  reason?: string;
}

/** Same-origin fetch timeout, matching the operator/config client budget. */
const TIMEOUT_MS = 8000;

/**
 * Read the last-known anchor state for `cohortId` from the coordinator at `baseUrl`.
 * PUBLIC: `credentials: 'omit'` so the anonymous cohort page never sends a session
 * cookie. Throws on a non-2xx / unreachable service (the poll caller counts these as
 * the D-24 unreachable signal, never a terminal by itself); an unknown cohort is a
 * normal `200 { state: 'none' }` answer, not an error.
 */
export async function fetchAnchor(baseUrl: string, cohortId: string): Promise<AnchorDTO> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/anchor/${encodeURIComponent(cohortId)}`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/anchor failed: HTTP ${res.status}`);
  }
  return (await res.json()) as AnchorDTO;
}
