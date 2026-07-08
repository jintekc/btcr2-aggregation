/**
 * Browser client for the operator auth routes (HOST-01, ADR 0015).
 *
 * Mirrors {@link file://./config.ts} `fetchNetworkConfig`: a plain same-origin `fetch`
 * with a bounded timeout, no new dependency. The session cookie is httpOnly, so this
 * module never reads or stores it (and never stores the password after the call) -
 * login state is derived from {@link sessionProbe}, not from `document.cookie`.
 */

const TIMEOUT_MS = 8000;

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

/**
 * POST the operator password to `/v1/operator/login`. Returns the HTTP status so the
 * store can branch: 200 = signed in, 401 = wrong password, 429 = throttled, 404 =
 * console disabled (no operator password set at boot).
 */
export async function login(baseUrl: string, password: string): Promise<number> {
  const res = await fetch(endpoint(baseUrl, '/v1/operator/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.status;
}

/** POST `/v1/operator/logout`; the server invalidates the session and clears the cookie. */
export async function logout(baseUrl: string): Promise<void> {
  await fetch(endpoint(baseUrl, '/v1/operator/logout'), {
    method: 'POST',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** The three states the session probe can resolve to. */
export type SessionState = 'logged-in' | 'logged-out' | 'disabled';

/**
 * GET `/v1/operator/session`: 200 = a live session, 401 = no/invalid session, 404 =
 * the console is disabled (fail-closed boot, D-07). Never reads the httpOnly cookie.
 */
export async function sessionProbe(baseUrl: string): Promise<SessionState> {
  const res = await fetch(endpoint(baseUrl, '/v1/operator/session'), {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 200) {
    return 'logged-in';
  }
  if (res.status === 404) {
    return 'disabled';
  }
  return 'logged-out';
}

/** Beacon types an operator may draft (mirrors the service DTO; no service dep). */
export type OperatorBeaconType = 'CASBeacon' | 'SMTBeacon';

/** The operator-safe cohort DTO returned by the gated cohort routes (SVC-01). */
export interface OperatorCohortDTO {
  draftId: string;
  beaconType: OperatorBeaconType;
  network: string;
  threshold: number;
  capacity: number;
  state: 'draft';
}

/** The create-draft body posted to `POST /v1/operator/cohorts`. */
export interface DraftInput {
  beaconType: OperatorBeaconType;
  threshold: number;
  capacity: number;
}

/** Discriminated create result so the store can surface a 400's specific message. */
export type CreateDraftResult = { ok: true; dto: OperatorCohortDTO } | { ok: false; error: string };

/**
 * POST a cohort draft. On 201 returns the created DTO; on any non-201 (notably the
 * 400 validation path) surfaces the server's specific `error` message so the create
 * form can render it verbatim (the two numeric validation strings are the UI-SPEC copy).
 */
export async function createDraft(baseUrl: string, input: DraftInput): Promise<CreateDraftResult> {
  const res = await fetch(endpoint(baseUrl, '/v1/operator/cohorts'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 201) {
    return { ok: true, dto: (await res.json()) as OperatorCohortDTO };
  }
  let error = 'Could not create the cohort. Try again.';
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === 'string' && body.error) {
      error = body.error;
    }
  } catch {
    // Non-JSON body (e.g. a 413 text) falls back to the generic message above.
  }
  return { ok: false, error };
}

/** GET the operator's own cohorts (drafts now; advertised entries once plan 03 lands). */
export async function listCohorts(baseUrl: string): Promise<OperatorCohortDTO[]> {
  const res = await fetch(endpoint(baseUrl, '/v1/operator/cohorts'), {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/operator/cohorts failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { cohorts: OperatorCohortDTO[] };
  return body.cohorts;
}

/** DELETE (discard) an un-advertised draft by id. */
export async function discardDraft(baseUrl: string, id: string): Promise<void> {
  await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}
