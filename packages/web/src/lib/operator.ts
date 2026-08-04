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
  /**
   * The operator's EXPLICIT per-draft discovery window in ms (Phase 5 D-11), present only on a
   * draft row and only when they set one. ABSENT means "this draft uses the service default",
   * which is exactly what an empty field in the edit form means, so the two agree without a
   * sentinel value and an empty box is never mistaken for "no window at all".
   */
  discoveryWindowMs?: number;
  /** The operator's explicit per-draft funding window in ms; absent means the service default. */
  fundingWindowMs?: number;
  /**
   * This service's OWN discovery-window default in ms as it stood when the draft was created, so
   * the `Leave it empty to use this service's default of {n} min.` help can name a real number.
   */
  defaultDiscoveryWindowMs?: number;
  /** This service's own funding-window default in ms at draft time; see {@link defaultDiscoveryWindowMs}. */
  defaultFundingWindowMs?: number;
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
  /**
   * OPTIONAL per-cohort discovery window in MILLISECONDS (Phase 5 D-11). The console field is in
   * minutes and converts on the way out; omitting the key means "use this service's default",
   * never "no window", which is why an empty field sends nothing rather than a 0.
   */
  discoveryWindowMs?: number;
  /** OPTIONAL per-cohort funding window in ms; omitted means this service's default. */
  fundingWindowMs?: number;
}

/**
 * This service's CURRENT cohort-timing defaults (Phase 5 D-11), served additively on the gated
 * list read. A DRAFT row carries its own captured defaults (what that draft will actually use);
 * this is what a cohort created RIGHT NOW would inherit, which is the only honest source for the
 * create form's `Leave it empty to use this service's default of {n} min.` help.
 *
 * Both keys are optional: a service that sets no window default serves neither, and the help then
 * omits the number rather than inventing one.
 */
export interface CohortDefaultsDTO {
  discoveryWindowMs?: number;
  fundingWindowMs?: number;
}

/**
 * Discriminated create result so the store can surface a 400's specific message.
 *
 * It carries `unauthorized` as a third member for the reason stated once on
 * {@link UpdateDraftResult}: a create is reachable from a console the operator may have left open
 * past their session, so a 401 must take the one honest re-login path rather than being rendered as
 * a validation failure (review WR-14).
 */
export type CreateDraftResult =
  | { ok: true; dto: OperatorCohortDTO }
  | { ok: false; error: string }
  | { ok: false; unauthorized: true };

/**
 * POST a cohort draft. On a 401 reports the session expiry; on 201 returns the created DTO; on any
 * other non-201 (notably the 400 validation path) surfaces the server's specific `error` message so
 * the create form can render it verbatim (the two numeric validation strings are the UI-SPEC copy).
 *
 * The 401 is checked FIRST, exactly as {@link updateDraft} orders its own checks. Before that it
 * fell through to the message branch, so the service's generic `operator authentication required`
 * denial was lifted verbatim into the slot that otherwise holds `Cohort size must be at least 1
 * signer.`, and the session was never ended (review WR-14).
 */
export async function createDraft(baseUrl: string, input: DraftInput): Promise<CreateDraftResult> {
  const res = await fetch(endpoint(baseUrl, '/v1/operator/cohorts'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) {
    return { ok: false, unauthorized: true };
  }
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
 * The result of editing a draft in place (SVC-04 criterion 3, Phase 5 D-10). It mirrors
 * {@link CreateDraftResult} exactly, for the same reason: the server's own validation copy is the
 * backstop the inline error slot renders VERBATIM, so a rule the client does not mirror yet still
 * reaches the operator in the service's words rather than as a generic "that didn't work".
 *
 * Both results carry `unauthorized` as a third member, for one reason stated here once: an edit,
 * and a create, are both reachable from a console the operator may have left open past their
 * session, so a 401 must take the one honest re-login path rather than being rendered as a
 * validation failure.
 *
 * This docstring previously claimed the create result did not need the member, and that claim was
 * false in a way that shipped: a 401 on create rendered the service's own denial string as create
 * form validation copy and ended no session (review WR-14).
 */
export type UpdateDraftResult =
  | { ok: true; dto: OperatorCohortDTO }
  | { ok: false; error: string }
  | { ok: false; unauthorized: true };

/**
 * PATCH a draft's shape in place. On 200 returns the updated DTO; on a 401 reports the session
 * expiry; on ANY other non-ok status the server's own `error` string is surfaced verbatim when the
 * body parses as JSON carrying one, and the generic line is used only when it does not.
 *
 * That last clause is worth stating precisely, because it is easy to read this as 400-only. It is
 * not: the 404 a non-draft id earns (D-13) carries `{ error: 'unknown draft' }`, so an operator who
 * saves a draft that has since been advertised, ended, or discarded reads the service's own
 * `unknown draft` rather than `Could not save the changes. Try again.`. The 413 is the case that
 * really does fall through, because its body is not JSON.
 *
 * Whether `unknown draft` is the right sentence for an operator staring at a stale edit form is a
 * COPY question, not a wiring one, and it is deliberately left open here. The server body is pinned
 * where it is emitted (`packages/service/tests/draft-edit.spec.ts`), so a reword is a decision
 * somebody has to make on purpose rather than something that can drift.
 */
export async function updateDraft(
  baseUrl: string,
  id: string,
  input: DraftInput,
): Promise<UpdateDraftResult> {
  // Deliberately NOT try/caught here, exactly like {@link createDraft}: a network-level failure
  // throws and the store's own catch renders its single shared unreachable line, so that copy has
  // one definition rather than one per client function.
  const res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) {
    return { ok: false, unauthorized: true };
  }
  if (res.ok) {
    return { ok: true, dto: (await res.json()) as OperatorCohortDTO };
  }
  let error = 'Could not save the changes. Try again.';
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
 * One runtime-adjustable setting as the gated read serves it (SVC-04 criterion 3, D-12).
 *
 * `value` and `envDefault` are OPTIONAL because JSON drops an undefined: an unset service name or
 * unset terms arrive as `{ changed: false }` with no value key at all. That is the honest wire
 * shape, and the console must render "not set" for it rather than an empty string that would read
 * as a value the operator chose.
 */
export interface SettingFieldDTO<T> {
  value?: T;
  envDefault?: T;
  /** Whether this field differs from what the environment set at boot; the caption's whole basis. */
  changed: boolean;
}

/**
 * Every runtime-adjustable setting with its source, from `GET /v1/operator/settings`. The console
 * renders each caption from THIS served data rather than comparing values locally: a caption is a
 * fact the service reported, not a guess the browser made about a boot value it never saw.
 */
export interface SettingsSnapshotDTO {
  serviceName: SettingFieldDTO<string>;
  defaultBeaconType: SettingFieldDTO<OperatorBeaconType>;
  defaultSize: SettingFieldDTO<number>;
  defaultThreshold: SettingFieldDTO<number>;
  defaultDiscoveryWindowMs: SettingFieldDTO<number>;
  defaultFundingWindowMs: SettingFieldDTO<number>;
  termsText: SettingFieldDTO<string>;
  /**
   * The environment variables whose boot seeds this service REFUSED as too long, by NAME only
   * (`05-REVIEW.md` WR-07). Never the refused value: the console needs the variable in order to
   * caption the field honestly, and nothing more.
   *
   * OPTIONAL and additive, matching the wire posture the fields above already document. An ABSENT
   * list means none refused, never unknown: "this service refused nothing" and "this service did
   * not tell me" render identically to an operator, and only one of them is worth a different
   * caption, so the console must not invent a distinction the wire does not carry.
   */
  droppedSeeds?: readonly string[];
}

/**
 * A settings save. Every key is optional: an ABSENT key leaves that setting exactly as it is, an
 * empty string CLEARS an optional text field, and an explicit `null` clears a window default. The
 * console posts every field it renders in ONE request, so the service can judge the set as a whole
 * and apply none of it on any rejection.
 */
export interface SettingsPatchDTO {
  serviceName?: string;
  defaultBeaconType?: OperatorBeaconType;
  defaultSize?: number;
  defaultThreshold?: number;
  defaultDiscoveryWindowMs?: number | null;
  defaultFundingWindowMs?: number | null;
  termsText?: string;
}

/**
 * The result of a settings save. It mirrors {@link UpdateDraftResult} exactly, for the same two
 * reasons: the SERVICE's own 400 message is the backstop the inline error slot renders verbatim
 * (so a rule the client does not mirror still reaches the operator in the service's words), and a
 * 401 on a console left open past its session must take the one honest re-login path rather than
 * being rendered as a validation failure.
 */
export type SaveSettingsResult =
  | { ok: true; snapshot: SettingsSnapshotDTO }
  | { ok: false; error: string }
  | { ok: false; unauthorized: true };

/**
 * GET the gated settings snapshot. Discriminated like every other gated read (D-16/D-25): a 401 is
 * a session expiry, a network/5xx fault is unreachable, and an ok read carries the snapshot.
 */
export async function fetchSettings(baseUrl: string): Promise<FetchResult<SettingsSnapshotDTO>> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, '/v1/operator/settings'), {
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
  try {
    return { kind: 'ok', value: (await res.json()) as SettingsSnapshotDTO };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * PUT the whole settings patch in ONE request. On 200 returns the service's NEW snapshot (never
 * the patch that was sent: a value the service normalized must display as the service holds it);
 * on a 400 returns the service's specific message; on a 401 reports the session expiry.
 *
 * Deliberately NOT try/caught here, exactly like {@link createDraft} and {@link updateDraft}: a
 * network-level failure throws and the store's own catch renders its single shared unreachable
 * line, so that copy has one definition rather than one per client function.
 */
export async function saveSettings(baseUrl: string, patch: SettingsPatchDTO): Promise<SaveSettingsResult> {
  const res = await fetch(endpoint(baseUrl, '/v1/operator/settings'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) {
    return { ok: false, unauthorized: true };
  }
  if (res.ok) {
    return { ok: true, snapshot: (await res.json()) as SettingsSnapshotDTO };
  }
  let error = 'Could not save the settings. Try again.';
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
  /**
   * True for a member the OPERATOR added as an in-process test peer (SVC-04, D-17). Optional on
   * the wire, and absent for every ordinary member, so an older service simply badges nothing
   * rather than the console presuming an answer it was not given.
   *
   * The service derives it from the per-service set of DIDs it spawned, never from anything on
   * the protocol wire, so a genuine external participant can never be labelled as the operator's
   * own. The console therefore renders the badge as a plain served fact.
   */
  testPeer?: boolean;
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
 * `co-signed` / `co-signed-fallback` (signed but NOT confirmed on-chain) / `fallback`
 * (CONFIRMED via the k-of-n script path) / `anchored` (CONFIRMED via the key path) /
 * `canceled` (the operator ended it deliberately, Phase 5 D-05) / `failed`.
 *
 * The four completion fates are a two-by-two: CONFIRMATION picks the row (`anchored`/`fallback`
 * versus `co-signed`/`co-signed-fallback`), the k-of-n SCRIPT PATH picks the column. Only the
 * confirmed pair counts toward the anchored metric (05-AUDIT entry 9).
 *
 * Each key maps to a fixed Badge/StatusDot tone, defined once in
 * {@link file://./operator-rows.ts} `CHIP_PRESENTATION`, where `canceled` is NEUTRAL: nothing
 * went wrong.
 */
export type CohortChip =
  | 'filling'
  | 'co-signing'
  | 'needs-funding'
  /** The key-path co-sign succeeded; this service published nothing or has seen no confirmation. */
  | 'co-signed'
  /** The same, for a co-sign that took the ADR-042 k-of-n script path. */
  | 'co-signed-fallback'
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
  /**
   * True while advertising is in DRAIN MODE (SVC-04, Phase 5 D-07). It rides this strip rather
   * than needing its own read because the console already polls the merged list read, so the
   * chip refreshes on the same tick as the mode chip. Server-side it is projected from the SAME
   * runtime holder value the advertise gate checks and the public `GET /v1/status` reports, so
   * what the console shows, what the public read claims, and what the service enforces are one
   * derivation rather than three that could disagree.
   *
   * Deliberately separate from {@link ServiceMode}: the mode is fixed at construction and says
   * how this service signs and broadcasts, where pause says whether it is offering new cohorts.
   */
  paused: boolean;
  /**
   * True once the operator engaged the one-way broadcast kill switch this session (SVC-04,
   * Phase 5 D-14). It rides BESIDE {@link mode}, which is never rewritten when it flips: this
   * service really did boot the way `mode` says, and its chain reads (resolve, anchor tracking)
   * really are still live. The health strip therefore renders a SECOND chip rather than changing
   * the mode chip, which would misreport how the service booted.
   *
   * Optional on the WIRE for the same reason {@link ServiceHealthDTO} itself is optional on
   * `monitoring`: a service built before this key existed serves health without it, and the
   * console must then make no broadcast-off claim rather than presuming one.
   */
  broadcastDisabled?: boolean;
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
  monitoring?: {
    rows: CohortSummaryDTO[];
    metrics: ServiceMetricsDTO;
    health?: ServiceHealthDTO;
    /**
     * The SERVICE-level operator actions log (SVC-04, D-14/D-15), oldest-first with server
     * wall-clock stamps. It rides this read rather than a stream of its own (ADR 0016), so the
     * log refreshes on the same tick as the rows, the metrics and the health chips.
     *
     * Optional on the wire like `health`: a service that serves none leaves the console showing
     * no log rather than an empty-log claim it was never told.
     */
    operatorActions?: ActivityEntryDTO[];
  };
  /**
   * This service's current cohort-timing defaults (D-11). Optional on the wire for the same reason
   * `monitoring.health` is: a service built before the key existed serves the read without it, and
   * the create form must then omit the default figure rather than presume one.
   */
  defaults?: CohortDefaultsDTO;
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
 * POST `/v1/operator/advertising/pause` (SVC-04, Phase 5 D-06). Gated + same-origin, and
 * discriminated exactly like {@link discardDraft} so a 401 takes the one honest re-login path
 * while a transient fault leaves the console's claim untouched.
 *
 * It returns the RESULTING paused state the service reported, not a bare success flag. That is
 * the whole point: the console renders what the SERVICE says, never what the browser assumed, so
 * a toggle that half-landed cannot leave the card claiming a state the gate is not enforcing. The
 * route is idempotent (the operator asks for an END STATE, not a flip), so a double-click or a
 * retried request resolves to the same value.
 */
export async function pauseAdvertising(baseUrl: string): Promise<FetchResult<boolean>> {
  return advertisingToggle(baseUrl, 'pause');
}

/** POST `/v1/operator/advertising/resume`; the exact mirror of {@link pauseAdvertising}. */
export async function resumeAdvertising(baseUrl: string): Promise<FetchResult<boolean>> {
  return advertisingToggle(baseUrl, 'resume');
}

/**
 * POST `/v1/operator/broadcast/disable` (SVC-04, Phase 5 D-14): engage the ONE-WAY broadcast kill
 * switch. Gated + same-origin, discriminated like {@link pauseAdvertising}, and it never throws.
 *
 * There is deliberately no `enableBroadcast` beside it, and there never will be: ADR 0010's
 * layered environment opt-in is the only path to money movement, so the runtime power points one
 * way only and the console copy tells the operator that a restart is the way back.
 *
 * It returns the RESULTING state the service reported, not a bare success flag, for the same
 * reason the advertising toggles do: the console renders what the SERVICE says, so a call that
 * half-landed can never leave the card claiming a mode the service is not enforcing.
 */
export async function disableBroadcast(baseUrl: string): Promise<FetchResult<boolean>> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, '/v1/operator/broadcast/disable'), {
      method: 'POST',
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
  try {
    const body = (await res.json()) as { broadcastDisabled?: unknown };
    if (typeof body.broadcastDisabled !== 'boolean') {
      // Never coerce: guessing here would reintroduce exactly the client-side claim the served
      // bit exists to eliminate, and this is the claim that says whether money can move.
      return { kind: 'unreachable' };
    }
    return { kind: 'ok', value: body.broadcastDisabled };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * The result of an add-test-peers call (SVC-04, Phase 5 D-17). It extends the shared
 * {@link FetchResult} vocabulary with the same `refused` member {@link FinalizeResult} carries,
 * and for the same reason: the server answers 409 when the cohort has no seats left, and it sends
 * the human reason with it.
 *
 * Preserving that reason matters because the console's rendered seat count is one poll old by the
 * time the operator clicks. A cohort that filled in between is a RACE, not a fault, and the
 * operator deserves to read the specific sentence rather than a bare "that didn't work".
 */
export type AddTestPeersResult = FetchResult<{ spawned: number }> | { kind: 'refused'; reason: string };

/**
 * POST `/v1/operator/cohorts/:id/test-peers` (SVC-04, Phase 5 D-17): fill a cohort's remaining
 * seats with in-process participants this service spawns, so one operator can rehearse the whole
 * loop alone. Gated + same-origin, discriminated like {@link finalizeCohort}, and it never throws.
 *
 * `count` is sent only when the caller asked for a specific number; omitting it is the "fill every
 * remaining seat" request, which is what the console's own control asks for. The service caps
 * whatever arrives at the cohort's real remaining seats, so this is a request, never a promise.
 *
 * A 404 (unknown, never advertised, or already settled) stays `unreachable`, matching cancel: the
 * action did not take and the server's 404 body is deliberately opaque.
 */
export async function addTestPeers(
  baseUrl: string,
  id: string,
  count?: number,
): Promise<AddTestPeersResult> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}/test-peers`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(count === undefined ? {} : { count }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.status === 401) {
    return { kind: 'unauthorized' };
  }
  if (res.status === 409) {
    // App-authored server-side (never a library string), so it is safe to render verbatim.
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
  if (!res.ok) {
    return { kind: 'unreachable' };
  }
  try {
    const body = (await res.json()) as { spawned?: unknown };
    // Never coerce a missing count into a number: the member list comes from the next served read
    // either way, and a fabricated count would be the one number on this screen nothing produced.
    return typeof body.spawned === 'number'
      ? { kind: 'ok', value: { spawned: body.spawned } }
      : { kind: 'unreachable' };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * DELETE `/v1/operator/ended/:id` (SVC-04, Phase 5 D-15): clear one ended cohort's record from
 * this console ahead of the bounded retention eviction. Gated + same-origin, discriminated like
 * {@link discardDraft}, and it never throws.
 *
 * A 404 (unknown id, already dismissed, or a cohort still live) maps to `unreachable`: from the
 * console's point of view the dismissal did not take, and the server's body is deliberately
 * opaque. Dismissal is telemetry-only server-side, so a failure leaves nothing to undo.
 */
export async function dismissEnded(baseUrl: string, id: string): Promise<FetchResult<true>> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/ended/${encodeURIComponent(id)}`), {
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
 * The shared body of the two advertising toggles. Both routes take no request body and answer
 * `{ paused: boolean }`; a body that somehow carries no boolean is treated as `unreachable`
 * rather than being coerced, because guessing here would reintroduce exactly the client-side
 * claim the served bit exists to eliminate.
 */
async function advertisingToggle(baseUrl: string, verb: 'pause' | 'resume'): Promise<FetchResult<boolean>> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/advertising/${verb}`), {
      method: 'POST',
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
  try {
    const body = (await res.json()) as { paused?: unknown };
    if (typeof body.paused !== 'boolean') {
      return { kind: 'unreachable' };
    }
    return { kind: 'ok', value: body.paused };
  } catch {
    return { kind: 'unreachable' };
  }
}

/**
 * The result of an advertise call (SVC-02, review WR-12). Built on the shared {@link FetchResult}
 * vocabulary exactly as {@link FinalizeResult} is, with TWO extra members rather than one, because
 * these routes have two failures that are neither a session problem nor a transport fault:
 *
 * - `refused` is the paused-advertising gate (SVC-04, D-06), which answers 409 with a reason the
 *   app authored server-side. Preserving it matters for the same reason it matters on a refused
 *   finalize and more so here: a paused advertise is precisely the race the disabled-button reason
 *   exists to prevent (advertising paused between the render and the click), so replacing the
 *   service's own sentence with a generic retry line tells the operator to retry the one thing this
 *   service is currently refusing on purpose.
 * - `declined` is any OTHER non-ok answer, chiefly the 404 for an unknown or already-advertised
 *   draft. It is kept apart from `unreachable` deliberately: a service that answered and said no
 *   and a service that could not be reached are different facts about the operator's own
 *   deployment, and the console says which one it observed.
 *
 * `ok` carries the LIVE cohort id. That id is deliberately the response DTO's `draftId`, which the
 * server sets to the NEW live cohort id: `advertiseDraft` calls `runner.advertiseCohort`, which
 * mints a fresh cohort id and deletes the draft, so the original draft id is stale the instant
 * advertise succeeds. Landing the drill-down on that stale id would poll a cohort the monitor has
 * no entry for (an empty "Seats: 0/0" page), so the caller MUST open the returned live id instead.
 * A 200 that names no live cohort is therefore `declined` rather than `ok`: there is no id to open.
 *
 * The name is not the bare word the service package already uses for its own advertise verdict. One
 * word with two meanings across the repo is exactly what this codebase's comments exist to prevent.
 */
export type AdvertiseActionResult =
  | FetchResult<string>
  | { kind: 'refused'; reason: string }
  | { kind: 'declined' };

/**
 * The result of a re-advertise call (SVC-02 F2, review WR-12). The exact mirror of
 * {@link AdvertiseActionResult} except that its `ok` member carries no id: re-advertising an
 * expired cohort leaves the operator on the list rather than in a drill-down (D-13 applies to a
 * freshly minted cohort), so the store has nothing to open.
 */
export type ReadvertiseActionResult =
  | FetchResult<true>
  | { kind: 'refused'; reason: string }
  | { kind: 'declined' };

/**
 * Read the app-authored refusal reason out of a 409 body, defensively, exactly as
 * {@link finalizeCohort} reads it: a body that somehow carries none still refuses, just without a
 * reason, rather than the console inventing one or rendering whatever arrived.
 */
async function refusalReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return typeof body.error === 'string' ? body.error : '';
  } catch {
    // Non-JSON body: refuse with no reason rather than inventing one.
    return '';
  }
}

/**
 * POST the advertise action for a draft (SVC-02). Gated + same-origin (the session cookie rides
 * `credentials: 'same-origin'`), discriminated like {@link finalizeCohort}, and it NEVER throws.
 */
export async function advertise(baseUrl: string, id: string): Promise<AdvertiseActionResult> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}/advertise`), {
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
    return { kind: 'refused', reason: await refusalReason(res) };
  }
  if (!res.ok) {
    return { kind: 'declined' };
  }
  let dto: { draftId?: unknown };
  try {
    dto = (await res.json()) as { draftId?: unknown };
  } catch {
    // The service answered 200 with something this console cannot read, which is a service that
    // said yes without naming the cohort to open. Treated as a refusal to name one, never as an ok
    // carrying an invented id.
    return { kind: 'declined' };
  }
  return typeof dto.draftId === 'string' && dto.draftId
    ? { kind: 'ok', value: dto.draftId }
    : { kind: 'declined' };
}

/**
 * POST the re-advertise action for an EXPIRED cohort (SVC-02, F2). Gated + same-origin, and
 * discriminated exactly like {@link advertise} above, because both routes are advertise actions:
 * both answer 401 before any lookup, both answer the SAME 409 when advertising is paused, and both
 * answer 404 for an id they do not hold.
 */
export async function readvertise(baseUrl: string, id: string): Promise<ReadvertiseActionResult> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}/readvertise`), {
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
    return { kind: 'refused', reason: await refusalReason(res) };
  }
  return res.ok ? { kind: 'ok', value: true } : { kind: 'declined' };
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
