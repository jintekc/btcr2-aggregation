/**
 * Browser client for the operator auth routes (HOST-01, ADR 0015).
 *
 * Mirrors {@link file://./config.ts} `fetchNetworkConfig`: a plain same-origin `fetch`
 * with a bounded timeout, no new dependency. The session cookie is httpOnly, so this
 * module never reads or stores it (and never stores the password after the call) -
 * login state is derived from {@link sessionProbe}, not from `document.cookie`.
 */

import type { AnchorDTO } from './anchor';

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

/** The operator-safe cohort DTO returned by the gated cohort routes (SVC-01/SVC-02). */
export interface OperatorCohortDTO {
  /** Stable row id: the draft id while a draft, the live cohort id once advertised. */
  draftId: string;
  beaconType: OperatorBeaconType;
  network: string;
  threshold: number;
  capacity: number;
  /** Accepted participants so far; 0 for a draft. */
  joined: number;
  /**
   * `'draft'` un-advertised, `'advertised'` live in the directory, `'expired'` a
   * terminal record whose advertised cohort's completion ended on its own (stall / TTL /
   * stop), and `'canceled'` one the OPERATOR deliberately ended (SVC-04, Phase 5 D-05).
   * Both terminal states are surfaced to the operator (never silently deleted) and can be
   * re-advertised; neither is a participant-directory entry (F2). `'canceled'` is a
   * DISTINCT fate, never folded into `'expired'`: an operator's own decision must not read
   * as something that went wrong.
   */
  state: 'draft' | 'advertised' | 'expired' | 'canceled';
  /** Short human-readable reason, present on `'expired'` and `'canceled'` rows. */
  reason?: string;
}

/** One open cohort in the public directory (GET /v1/directory, SVC-02/D-14). */
export interface DirectoryCohortDTO {
  cohortId: string;
  beaconType: OperatorBeaconType;
  network: string;
  threshold: number;
  capacity: number;
  joined: number;
  phase: string;
}

/** The public service status (GET /v1/status, D-09): up / active network / open count. */
export interface ServiceStatus {
  up: boolean;
  network: string;
  openCohorts: number;
  /**
   * True while the service is in advertising DRAIN MODE (SVC-04, Phase 5 D-07): it is not
   * offering NEW cohorts, while everything already advertised keeps running. It exists because
   * a paused service and an idle one both report zero open cohorts, so the public directory
   * must be able to say "this operator has quiesced" rather than implying the service is dead.
   */
  paused: boolean;
}

/**
 * The create-draft body posted to `POST /v1/operator/cohorts` (G-02-1). Two honest
 * numbers: `size` = n = seats (the n in n-of-n; the cohort finalizes only when all n join)
 * and `threshold` = k = the signing floor (the ADR-042 fallback threshold, `1 <= k <= n`).
 * The DTOs returned by the routes keep their shape (their `threshold` now MEANS k).
 */
export interface DraftInput {
  beaconType: OperatorBeaconType;
  size: number;
  threshold: number;
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

/**
 * Discriminated result of a gated monitoring read (SVC-03, D-16/D-25). The store branches
 * on `kind` to tell a session-expiry (`unauthorized` -> honest re-login, D-16) apart from
 * a transient network/5xx fault (`unreachable` -> freeze the last-known view, D-25) - the
 * discrimination the status-blind Phase 1 fetch helpers lacked (RESEARCH planning note 3).
 */
export type FetchResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'unauthorized' }
  | { kind: 'unreachable' };

/**
 * The per-member round state (mirrors the service `MemberRound`, D-31): a forward
 * progression `seated` -> `submitted` -> `validated` -> `nonce-sent`, with `rejected` the
 * off-path terminal. The drill-down maps each to a fixed-tone chip.
 */
export type MemberRound = 'seated' | 'submitted' | 'validated' | 'nonce-sent' | 'rejected';

/**
 * One member in a cohort's monitoring projection (mirrors the service `CohortMemberDTO`).
 * `status` distinguishes a pending opt-in from a seated member (D-29); `since` is the
 * server wall-clock stamp (ms) the member was first observed (D-22); `round` is the
 * per-member co-sign progress (D-31); the pubkeys ride the Technical detail expander only
 * (D-28), absent for a member first seen on a later round event.
 */
export interface CohortMemberDTO {
  did: string;
  status: 'pending' | 'seated';
  since: number;
  round: MemberRound;
  participantPk?: string;
  communicationPk?: string;
}

/**
 * One submission row (mirrors the service `SubmissionDTO`, D-30): whether a seated member
 * has submitted their signed update and, if so, the server wall-clock time (`at`); `raw`
 * carries the signed-update body for the `Raw signed update` expander, present only for a
 * live cohort whose pending updates the session still holds.
 */
export interface SubmissionDTO {
  did: string;
  submitted: boolean;
  at?: number;
  raw?: unknown;
}

/**
 * Honest co-sign progress (mirrors the service `CoSignDTO`, D-32): nonces `k` of `n`
 * received, plus `awaitingPartialSigs` for the partial-signature leg that emits no event.
 * There is deliberately NO partial-signature count here (the unobservable leg is never
 * invented).
 */
export interface CoSignDTO {
  noncesReceived: number;
  total: number;
  awaitingPartialSigs: boolean;
}

/**
 * Whether this cohort took the ADR-042 k-of-n fallback (mirrors the service `FallbackDTO`,
 * D-33): `used` plus `k`/`n` when derivable from the live cohort.
 */
export interface FallbackDTO {
  used: boolean;
  k?: number;
  n?: number;
}

/** Tone of one activity-ring entry (mirrors the service `ActivityLevel` / the client LogLevel). */
export type ActivityLevel = 'info' | 'good' | 'warn' | 'bad';

/**
 * One activity-ring entry (mirrors the service `ActivityEntryDTO`, D-21/D-22). `t` is the
 * SERVER wall-clock time (ms), so the drill-down's LogPanel renders it as a wall-clock stamp,
 * not the participant-side elapsed offset.
 */
export interface ActivityEntryDTO {
  id: number;
  t: number;
  level: ActivityLevel;
  text: string;
}

/**
 * The four honest funding states (mirrors the service `FundingStateName`, D-36): `waiting` (no
 * spendable UTXO yet), `awaiting-confirmation` (a candidate UTXO is in the mempool), `funded` (the
 * selected confirmed UTXO meets the minimum), `dead-end` (the selected confirmed UTXO is below the
 * minimum band, terminal).
 */
export type FundingStateName = 'waiting' | 'awaiting-confirmation' | 'funded' | 'dead-end';

/**
 * The operator funding view for a live+broadcast cohort (mirrors the service `FundingView`, D-36
 * through D-43). Carries the honest funding `state`, the ONE suggested minimum (D-37), the beacon
 * address (+ explorer URL) the operator funds, the always-shown recovery-key state (D-40), the
 * mainnet real-money + change-routing bits (D-42), the truncated-window disclosure when the wait
 * clamped the window (D-38), and the esplora-stale bit for an observation gap (D-43). Present ONLY
 * for a live+broadcast cohort; absent on a hermetic cohort and before the first watch reading.
 */
export interface FundingView {
  state: FundingStateName;
  suggestedMinSats: number;
  beaconAddress: string;
  explorerUrl?: string;
  recoveryKeyState: 'operator-held' | 'throwaway';
  mainnet: boolean;
  changeAddressRedirected: boolean;
  truncatedWindowMin?: number;
  esploraStale: boolean;
  /** Terminal lapse outcome once the cohort failed for want of funding: `window-closed` (clean lapse) or `blind-lapse` (observation gap, D-38/D-39). */
  terminal?: 'window-closed' | 'blind-lapse';
}

/**
 * The gated per-cohort monitoring detail (mirrors the service `CohortDetailDTO`, D-26).
 * The full drill-down depth: members (pending vs seated, round state, pubkeys), submissions
 * (who/when + raw), honest co-sign progress, the operator anchor view (a hermetic service
 * reads `{ enabled: false, state: 'none' }`), the fallback flag, the bounded activity ring, and
 * the optional funding view (live+broadcast only). `exists` is false for an unknown/evicted
 * cohort (non-oracle).
 */
export interface CohortDetailDTO {
  exists: boolean;
  members: CohortMemberDTO[];
  seatsJoined: number;
  capacity: number;
  phase: string;
  submissions: SubmissionDTO[];
  coSign: CoSignDTO;
  anchor: AnchorDTO;
  fallback: FallbackDTO;
  activity: ActivityEntryDTO[];
  /** The operator funding view; present ONLY for a live+broadcast cohort with a funding reading (D-36). */
  funding?: FundingView;
  /**
   * The cohort's DELIBERATE terminal fate (SVC-04, D-01/D-05), present only as `'canceled'`. It
   * drives the stage timeline's terminal Canceled marker; every other ending is already narrated
   * by `anchor`, so this is deliberately not a general "how did it end" field.
   */
  fate?: 'canceled';
}

/**
 * GET the gated per-cohort monitoring detail (SVC-03). NEVER throws: the store needs to
 * tell 401 (session expired, D-16) apart from a network/5xx fault (freeze, D-25), so this
 * maps `res.status === 401` -> `unauthorized`, `res.ok` -> `ok`, and any thrown error or
 * other non-ok status -> `unreachable`. The session cookie rides `credentials:
 * 'same-origin'` (the read is operator-gated); the timeout mirrors the other calls.
 */
export async function fetchCohortDetail(baseUrl: string, id: string): Promise<FetchResult<CohortDetailDTO>> {
  try {
    const res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}`), {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) {
      return { kind: 'unauthorized' };
    }
    if (!res.ok) {
      // A non-401 non-ok (e.g. 500/502) is a transient fault, not a session change:
      // freeze the last-known view rather than logging the operator out (D-25).
      return { kind: 'unreachable' };
    }
    return { kind: 'ok', value: (await res.json()) as CohortDetailDTO };
  } catch {
    // A thrown fetch (network down, timeout, abort) is unreachable, never unauthorized.
    return { kind: 'unreachable' };
  }
}

/**
 * The live status-chip key for one monitoring row (mirrors the service `CohortChip`, D-04).
 * A live cohort reads `filling` / `co-signing`; `needs-funding` is the live-cohort funding
 * placeholder the live-path plan 04-06 populates; an ended cohort reads its terminal fate
 * `fallback` (anchored via the k-of-n script path) / `anchored` / `canceled` (the operator
 * ended it deliberately, Phase 5 D-05) / `failed`. The client maps each key to a fixed
 * Badge/StatusDot tone (the UI-SPEC tone map), where `canceled` is NEUTRAL: nothing went wrong.
 */
export type CohortChip =
  | 'filling'
  | 'co-signing'
  | 'needs-funding'
  | 'fallback'
  | 'anchored'
  | 'canceled'
  | 'failed';

/**
 * One monitoring row for the operator cohort list (mirrors the service `CohortSummaryDTO`,
 * D-06). Carries the live status `chip`, the seat count + capacity, the raw phase (or
 * `'ended'` for a retained terminal record), and a short failure `reason` on a failed row.
 */
export interface CohortSummaryDTO {
  cohortId: string;
  chip: CohortChip;
  seatsJoined: number;
  capacity: number;
  phase: string;
  reason?: string;
  /**
   * The SERVER wall-clock time (ms) this cohort ended, stamped at event time like every other
   * monitoring timestamp (04 D-22). Present ONLY on a retained ended row, so the console can say
   * WHEN a fate landed (`Canceled by the operator at {time}.`) instead of implying it just
   * happened. Absent on a live row, and absent from a service built before the field existed -
   * in which case the console renders the row without a time rather than inventing one.
   */
  at?: number;
}

/**
 * Service-level live counts for the operator metrics row (mirrors the service
 * `ServiceMetricsDTO`, D-06): `open` (joinable/filling), `inFlight` (mid co-sign),
 * `anchored` (successfully anchored, including the k-of-n fallback path), and `failed`
 * (terminal). Derived from the live set + the bounded retained records, never a since-boot
 * cumulative counter.
 */
export interface ServiceMetricsDTO {
  open: number;
  inFlight: number;
  anchored: number;
  failed: number;
}

/**
 * The broadcast mode this service actually runs in (mirrors the service `ServiceMode`, D-17):
 * `hermetic` is the fixture co-sign path (no chain at all), `live-no-broadcast` builds a real tx
 * against a live esplora without pushing it, and `live` broadcasts on-chain.
 */
export type ServiceMode = 'hermetic' | 'live-no-broadcast' | 'live';

/**
 * The service health projection (mirrors the service `ServiceHealthDTO`, D-17/D-43): the honest
 * broadcast `mode` plus the last esplora observation. `esploraReachable` is `'n/a'` on the
 * hermetic path (no esplora is ever contacted), and the last observed reading on a live path.
 *
 * This is the payload the health strip's mode chip renders. Before review CR-01 the server
 * computed it and served it nowhere, so the strip claimed "Hermetic" on a live, broadcasting
 * service; it now rides {@link OperatorCohortsDTO.monitoring}.
 */
export interface ServiceHealthDTO {
  mode: ServiceMode;
  esploraReachable: boolean | 'n/a';
}

/**
 * The merged `GET /v1/operator/cohorts` read model (D-06/D-26). `cohorts` is the operator's
 * own draft/advertised/expired list (byte-identical to before); the NEW `monitoring` sibling
 * key carries the summary chip rows + service-level metrics from the per-service fold, present
 * only when a monitor is wired (a fail-closed boot omits it).
 *
 * `monitoring.health` is optional on the WIRE (review CR-01): a service built before the health
 * key existed serves `monitoring` without it, and the strip must render "Checking mode" rather
 * than presume a mode it was never told.
 */
export interface OperatorCohortsDTO {
  cohorts: OperatorCohortDTO[];
  monitoring?: { rows: CohortSummaryDTO[]; metrics: ServiceMetricsDTO; health?: ServiceHealthDTO };
}

/**
 * GET the operator's own cohorts PLUS the monitoring summary, discriminated like
 * {@link fetchCohortDetail} (SVC-03, D-16/D-25): the store must tell a session-expiry (401 ->
 * honest re-login, D-16) apart from a transient network/5xx fault (freeze the last-known list,
 * D-25). NEVER throws: `res.status === 401` -> `unauthorized`, `res.ok` -> `ok`, any thrown
 * error or other non-ok status -> `unreachable`. Same-origin (the read is operator-gated).
 */
export async function fetchOperatorCohorts(baseUrl: string): Promise<FetchResult<OperatorCohortsDTO>> {
  try {
    const res = await fetch(endpoint(baseUrl, '/v1/operator/cohorts'), {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) {
      return { kind: 'unauthorized' };
    }
    if (!res.ok) {
      return { kind: 'unreachable' };
    }
    return { kind: 'ok', value: (await res.json()) as OperatorCohortsDTO };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * Download the gated per-cohort monitoring export as a JSON file (SVC-03, D-34). Fetches the
 * gated route with the session cookie (`credentials: 'same-origin'`, the read is
 * operator-gated), then turns the response into a blob and triggers a client download named
 * from the cohort id. The server sets the authoritative `Content-Disposition` filename; the
 * client `download` name is a best-effort mirror built from the same id.
 *
 * Discriminated like the other gated reads (review WR-06). It previously returned a bare boolean
 * the caller discarded, so on an expired session - the exact case the {@link FetchResult}
 * vocabulary was built for (D-16) - clicking `Download monitoring record (JSON)` did NOTHING:
 * no download, no error, no re-login, no log line, and no way to tell a failed export from a
 * click the browser ignored.
 */
export async function downloadExport(baseUrl: string, id: string): Promise<FetchResult<true>> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}/export`), {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 401) {
    return { kind: 'unauthorized' };
  }
  if (!res.ok) {
    return { kind: 'unreachable' };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cohort-${id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // DEFER the revoke (review WR-06): revoking in the same tick as `click()` can abort a download
  // whose transfer has not started yet in Firefox and Safari. MDN's own example defers it too.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { kind: 'ok', value: true };
}

/**
 * DELETE (discard) an un-advertised draft by id. Discriminated like the reads (review WR-06):
 * the response was previously ignored entirely, so a failed discard looked identical to a
 * successful one until the next list refresh silently showed the draft still there.
 */
export async function discardDraft(baseUrl: string, id: string): Promise<FetchResult<true>> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 401) {
    return { kind: 'unauthorized' };
  }
  return res.ok ? { kind: 'ok', value: true } : { kind: 'unreachable' };
}

/**
 * POST the cancel action for a live cohort (SVC-04, Phase 5 D-01/D-04). Gated + same-origin (the
 * session cookie rides `credentials: 'same-origin'`; the whole `/v1/operator/*` prefix also sits
 * behind the same-origin guard, so a cross-site page cannot drive this).
 *
 * Discriminated exactly like {@link discardDraft}, and for the same reason: the caller MUST be
 * able to tell an expired session (401 -> the one honest re-login path, D-16) from a transient
 * fault (-> the action-error line, with nothing about the cohort changed). It NEVER throws and
 * never returns a bare boolean a caller could discard, because a destructive action that fails
 * silently is indistinguishable from one that worked.
 *
 * A 404 (unknown, never-advertised, or already-settled cohort) maps to `unreachable`: from the
 * console's point of view the action did not take, and the server deliberately answers one
 * indistinguishable 404 for all three cases.
 */
export async function cancelCohort(baseUrl: string, id: string): Promise<FetchResult<true>> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}/cancel`), {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 401) {
    return { kind: 'unauthorized' };
  }
  return res.ok ? { kind: 'ok', value: true } : { kind: 'unreachable' };
}

/**
 * The result of a finalize call (SVC-04, D-01). It extends the shared {@link FetchResult}
 * vocabulary with ONE extra member, `refused`, because this action has a refusal that is neither
 * a session problem nor a fault: the server answers 409 when the cohort's signing round has not
 * started, and it sends a human reason with it.
 *
 * Preserving that reason follows the {@link CreateDraftResult} precedent (the create form renders
 * the server's own validation copy verbatim) and matters more here than it does for cancel, whose
 * 404 body is deliberately opaque: a refused finalize is usually a RACE (the console's polled
 * phase went stale between the render and the click), and the operator deserves to be told which
 * of the two honest reasons applies rather than a bare "that didn't work".
 */
export type FinalizeResult = FetchResult<true> | { kind: 'refused'; reason: string };

/**
 * POST the finalize action for a cohort whose signing round has stalled (SVC-04, D-01). Gated +
 * same-origin, discriminated like {@link cancelCohort}, and it NEVER throws.
 *
 * A 409 becomes `refused` carrying the server's reason. A 404 (unknown, never-advertised, or
 * already-settled) stays `unreachable`, matching cancel: from the console's point of view the
 * action did not take, and the server's 404 body is deliberately opaque.
 */
export async function finalizeCohort(baseUrl: string, id: string): Promise<FinalizeResult> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}/finalize`), {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 401) {
    return { kind: 'unauthorized' };
  }
  if (res.status === 409) {
    // The refusal reason is app-authored server-side (never a library string), so it is safe to
    // render; a body that somehow carries none still refuses, just without a reason.
    let reason = '';
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string') {
        reason = body.error;
      }
    } catch {
      // Non-JSON body: refuse with no reason rather than inventing one.
    }
    return { kind: 'refused', reason };
  }
  return res.ok ? { kind: 'ok', value: true } : { kind: 'unreachable' };
}

/**
 * POST the advertise action for a draft (SVC-02). Gated + same-origin (the session cookie rides
 * `credentials: 'same-origin'`). Returns the LIVE cohort id on success, or `null` when the server
 * did not accept it (so the store can surface the transient success message and land the operator
 * in the correct drill-down, D-13).
 *
 * The returned id is deliberately the response DTO's `draftId`, which the server sets to the NEW
 * live cohort id: `advertiseDraft` calls `runner.advertiseCohort`, which mints a fresh cohort id
 * and deletes the draft, so the original draft id is stale the instant advertise succeeds. Landing
 * the drill-down on that stale id would poll a cohort the monitor has no entry for (an empty
 * "Seats: 0/0" page), so the caller MUST open the returned live id instead.
 */
export async function advertise(baseUrl: string, id: string): Promise<string | null> {
  const res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}/advertise`), {
    method: 'POST',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    return null;
  }
  const dto = (await res.json()) as { draftId?: unknown };
  return typeof dto.draftId === 'string' && dto.draftId ? dto.draftId : null;
}

/**
 * POST the re-advertise action for an EXPIRED cohort (SVC-02, F2). Gated + same-origin
 * (the session cookie rides `credentials: 'same-origin'`); returns whether the server
 * accepted it (200) so the store can surface the transient success message and refresh.
 */
export async function readvertise(baseUrl: string, id: string): Promise<boolean> {
  const res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}/readvertise`), {
    method: 'POST',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res.ok;
}

/**
 * GET the public service status (D-09). PUBLIC by construction: `credentials: 'omit'`
 * so the anonymous status card never sends the operator session cookie.
 */
export async function fetchStatus(baseUrl: string): Promise<ServiceStatus> {
  const res = await fetch(endpoint(baseUrl, '/v1/status'), {
    headers: { accept: 'application/json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/status failed: HTTP ${res.status}`);
  }
  return (await res.json()) as ServiceStatus;
}

/**
 * GET the public cohort directory (SVC-02/D-14). PUBLIC: `credentials: 'omit'` so the
 * anonymous surface can browse the open cohorts without a session (Phase 2 consumes it).
 */
export async function fetchDirectory(baseUrl: string): Promise<DirectoryCohortDTO[]> {
  const res = await fetch(endpoint(baseUrl, '/v1/directory'), {
    headers: { accept: 'application/json' },
    credentials: 'omit',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/directory failed: HTTP ${res.status}`);
  }
  return (await res.json()) as DirectoryCohortDTO[];
}
