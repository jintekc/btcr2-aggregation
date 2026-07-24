import { pathToFileURL } from 'node:url';
import { createParticipant } from '@btcr2-aggregation/participant';
import { createService } from '@btcr2-aggregation/service';
import { buildCohortConfig, createIdentity } from '@btcr2-aggregation/shared';

/**
 * Phase-1 capstone e2e (HOST-01 + SVC-01 + SVC-02, ROADMAP success criterion 4).
 *
 * One hermetic scenario that drives the WHOLE Phase-1 slice together over the real
 * HTTP surface, the way a browser + a participant client would:
 *
 *   operator logs in  ->  creates a draft  ->  advertises it  ->  headless
 *   participants discover it in the public directory, join, submit signed updates,
 *   and co-sign the n-of-n MuSig2 beacon  ->  a 64-byte aggregated signature.
 *
 * It also pins the two regressions this phase must never allow to silently return:
 *
 *  1. THE AUTH BOUNDARY (T-04-01). Before logging in it asserts the mandatory
 *     negatives: a wrong-password login is 401 with NO Set-Cookie, and an
 *     un-authenticated `GET /v1/operator/cohorts` and the gated monitoring read
 *     `GET /v1/operator/cohorts/:id` both 401. If a gated route ever regressed open,
 *     the gate fails here. (The booth-era `/dashboard/events` SSE feed is retired,
 *     D-02/D-19; its negative-auth evidence moved onto the gated monitoring read.)
 *
 *  2. THE ON-DEMAND-ONLY DRIVER (T-04-02, D-17). Immediately after boot it asserts
 *     `runner.session.cohorts.length === 0`: a fresh self-hosted service advertises
 *     NOTHING until the operator acts. The boot-time perpetual auto-advertise loop
 *     (and its in-process fillers) is gone; the only cohort that ever exists in this
 *     run is the one the operator advertised, and the run additionally checks that
 *     the cohort that reaches `signing-complete` is exactly that operator-advertised
 *     cohort id.
 *
 * Hermetic by construction: the offline/fixture beacon-tx path (no `live`, no
 * `bitcoin` connection, no esplora, no `LIVE`), so it runs inside the existing gate
 * with no chain and no new dependency. The cohort still builds the real CAS
 * announcement and co-signs a real 64-byte Taproot signature internally; only the
 * beacon tx spends a fixture prevout (same hermetic path as `e2e/headless-cohort.ts`).
 *
 * Cookie handling mirrors RESEARCH's note: Node's fetch has no cookie jar, so the
 * harness captures the `operator_session` Set-Cookie value on login and echoes it as
 * the `cookie` header on every gated call. `operatorCookieSecure: false` is set so the
 * cookie round-trips over plain http on loopback (RESEARCH Pitfall 2); a real
 * deployment leaves the Secure default on behind TLS at the reverse proxy.
 */

/** The operator console password this hermetic run boots the service with. */
const OPERATOR_PASSWORD = 'operator-e2e-correct-horse-battery-staple';
/** A deliberately-wrong password for the negative-auth assertion. */
const WRONG_PASSWORD = 'this-is-not-the-operator-password';
/**
 * The advertised cohort's number, used for BOTH the seat count n and the signing floor k
 * in this pure n-of-n leg (k == n == 2), so the two-field create body stays fully green.
 */
const THRESHOLD = 2;

/** The operator-cohort DTO shape returned by create + advertise (subset asserted). */
interface OperatorCohortDTO {
  /** Draft id while a draft; the LIVE cohort id once advertised. */
  draftId: string;
  beaconType: string;
  network: string;
  threshold: number;
  capacity: number;
  joined: number;
  state: 'draft' | 'advertised' | 'expired';
  /** Short reason present only on `state: 'expired'` rows (F2). */
  reason?: string;
}

/** The public directory entry shape (subset asserted). */
interface DirectoryCohortDTO {
  cohortId: string;
  beaconType: string;
  network: string;
  threshold: number;
  capacity: number;
  joined: number;
  phase: string;
}

/** The public service-status shape (subset asserted). */
interface ServiceStatusDTO {
  up: boolean;
  network: string;
  openCohorts: number;
}

/**
 * The gated per-cohort monitoring detail shape (subset asserted), served by
 * `GET /v1/operator/cohorts/:id` and backed by the {@link createCohortMonitor} fold. The
 * monitoring leg below asserts this read reflects real cohort activity (seated members,
 * who submitted) end to end over the hermetic fixture path (D-47 fixture leg, SVC-03).
 */
interface MonitorMemberDTO {
  did: string;
  status: 'pending' | 'seated';
  round: 'seated' | 'submitted' | 'validated' | 'nonce-sent' | 'rejected';
}
interface MonitorSubmissionDTO {
  did: string;
  submitted: boolean;
  /** Server wall-clock ms the update was received (present once submitted). */
  at?: number;
}
interface MonitorCoSignDTO {
  noncesReceived: number;
  total: number;
  awaitingPartialSigs: boolean;
}
interface MonitorDetailDTO {
  exists: boolean;
  members: MonitorMemberDTO[];
  seatsJoined: number;
  capacity: number;
  phase: string;
  submissions: MonitorSubmissionDTO[];
  coSign: MonitorCoSignDTO;
}

/** One monitoring summary chip row (subset), from the `monitoring.rows` sibling of the list read. */
interface MonitorSummaryRowDTO {
  cohortId: string;
  chip: 'filling' | 'co-signing' | 'needs-funding' | 'fallback' | 'anchored' | 'failed';
  seatsJoined: number;
  capacity: number;
}

/**
 * The operator cohort-list read (`GET /v1/operator/cohorts`) with its ADDITIVE `monitoring`
 * sibling (D-19): the summary chip `rows` + the service `metrics`, present whenever the
 * monitor is wired. The frozen operator `cohorts` array is unchanged.
 */
interface OperatorListWithMonitoringDTO {
  cohorts: OperatorCohortDTO[];
  monitoring?: {
    rows: MonitorSummaryRowDTO[];
    metrics: { open: number; inFlight: number; anchored: number; failed: number };
  };
}

/** Reject if `p` does not settle within `ms` (the timeout does not keep Node alive). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref();
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export interface OperatorCohortOptions {
  /** Port to listen on (default 0 = ephemeral loopback). */
  port?: number;
  /** Overall run timeout in ms for the co-sign leg (default 30000). */
  timeoutMs?: number;
  /** Suppress progress logging (default false). */
  quiet?: boolean;
}

/**
 * Drive the full authed on-demand-advertise lifecycle and return the list of problems
 * (empty = pass). Everything runs against one real service on a real loopback port and
 * N in-process participants over the real `HttpClientTransport`.
 */
export async function runOperatorCohort(options: OperatorCohortOptions = {}): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  // Boot a real operator-enabled service on the hermetic (offline/fixture) path. The
  // boot `config` seeds the runner's identity + active network (the operator's drafts
  // inherit that network, D-10); it is NOT advertised at boot - the removed-loop
  // assertion below proves that. `operatorCookieSecure: false` lets the session cookie
  // round-trip over plain http on loopback (Pitfall 2).
  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(THRESHOLD, 'CASBeacon'),
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
  });

  // Capture the aggregated MuSig2 result off the service's `signing-complete` event
  // (the operator route owns the cohort's completion promise internally, so the
  // service event is how the harness observes the 64-byte signature and the cohort id
  // that actually signed).
  let aggregatedSignatureLength = -1;
  let signedCohortId = '';
  const signingComplete = new Promise<void>((resolve) => {
    service.runner.on('signing-complete', (result) => {
      aggregatedSignatureLength = result.signature.length;
      signedCohortId = result.cohortId;
      resolve();
    });
  });
  // Non-fatal runner errors must not crash the process before teardown.
  service.runner.on('error', (err) => log(`[service] error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`service listening on ${baseUrl}`);

  try {
    /* ---- 1. Loop removed: a fresh service advertises nothing (D-17, T-04-02). ---- */
    const bootCohorts = service.runner.session.cohorts.length;
    if (bootCohorts !== 0) {
      fail(
        `a fresh service should advertise nothing until the operator acts, but ` +
          `runner.session.cohorts.length === ${bootCohorts} at boot (the auto-advertise loop is not gone)`,
      );
    } else {
      log('[assert] boot: session.cohorts.length === 0 (on-demand-only driver, loop removed)');
    }

    /* ---- 2. Negative auth (mandatory, T-04-01). ---- */
    // Wrong password -> 401 and NO session cookie issued.
    const wrongLogin = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: WRONG_PASSWORD }),
    });
    if (wrongLogin.status !== 401) {
      fail(`wrong-password login should be 401, got ${wrongLogin.status}`);
    }
    if (wrongLogin.headers.getSetCookie().length !== 0) {
      fail('wrong-password login must not issue a Set-Cookie');
    }
    await wrongLogin.text();

    // No cookie -> the gated operator cohort route 401s.
    const noCookieCohorts = await fetch(`${baseUrl}/v1/operator/cohorts`);
    if (noCookieCohorts.status !== 401) {
      fail(`GET /v1/operator/cohorts with no cookie should be 401, got ${noCookieCohorts.status}`);
    }
    await noCookieCohorts.text();

    // No cookie -> the gated per-cohort monitoring read 401s (the requireOperator prefix
    // guard runs BEFORE any cohort-id lookup, so an anonymous caller is rejected with 401
    // and never learns whether the cohort exists - no existence oracle, T-04-02-01).
    const noCookieMonitoring = await fetch(`${baseUrl}/v1/operator/cohorts/some-cohort`);
    if (noCookieMonitoring.status !== 401) {
      fail(`GET /v1/operator/cohorts/:id with no cookie should be 401, got ${noCookieMonitoring.status}`);
    }
    await noCookieMonitoring.text();
    log('[assert] negative auth: wrong-password 401 (no cookie), no-cookie /v1/operator/cohorts + /v1/operator/cohorts/:id 401');

    /* ---- 3. Login: capture and echo the operator_session cookie. ---- */
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    if (loginRes.status !== 200) {
      fail(`operator login should be 200, got ${loginRes.status}`);
      return problems;
    }
    // Node fetch has no cookie jar; grab the operator_session Set-Cookie and echo its
    // name=value pair (before the attributes) on every gated call.
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (!setCookie) {
      fail('login succeeded but issued no operator_session cookie');
      return problems;
    }
    const cookie = setCookie.split(';')[0];
    log('[ok] login: operator_session cookie captured');

    /* ---- 4. Create a draft (authed). ---- */
    const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ beaconType: 'CASBeacon', size: THRESHOLD, threshold: THRESHOLD }),
    });
    if (createRes.status !== 201) {
      fail(`create draft should be 201, got ${createRes.status}`);
      return problems;
    }
    const draft = (await createRes.json()) as OperatorCohortDTO;
    if (draft.state !== 'draft') {
      fail(`created cohort should be state 'draft', got '${draft.state}'`);
    }
    // The two numbers are surfaced independently (k == n here): capacity === n.
    if (draft.capacity !== THRESHOLD) {
      fail(`created draft capacity should be ${THRESHOLD} (n seats), got ${draft.capacity}`);
    }
    log(`[ok] create: draft ${draft.draftId} (${draft.beaconType} ${draft.threshold}-of-${draft.capacity})`);

    /* ---- 5. Advertise the draft (authed). ---- */
    const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (advertiseRes.status !== 200) {
      fail(`advertise should be 200, got ${advertiseRes.status}`);
      return problems;
    }
    const advertised = (await advertiseRes.json()) as OperatorCohortDTO;
    if (advertised.state !== 'advertised') {
      fail(`advertised cohort should be state 'advertised', got '${advertised.state}'`);
    }
    // Once advertised the row id IS the live cohort id (the drafts and live sets never
    // share an id space, D-15).
    const cohortId = advertised.draftId;
    log(`[ok] advertise: cohort ${cohortId} is live`);

    /* ---- 6. Public directory + status reflect the advertised cohort (no cookie). ---- */
    const dirRes = await fetch(`${baseUrl}/v1/directory`);
    if (dirRes.status !== 200) {
      fail(`GET /v1/directory should be 200, got ${dirRes.status}`);
    }
    const directory = (await dirRes.json()) as DirectoryCohortDTO[];
    const entry = directory.find((d) => d.cohortId === cohortId);
    if (!entry) {
      fail(
        `advertised cohort ${cohortId} not found in the public directory ` +
          `(entries: [${directory.map((d) => d.cohortId).join(', ')}])`,
      );
    } else if (entry.beaconType !== 'CASBeacon' || entry.threshold !== THRESHOLD || entry.capacity !== THRESHOLD) {
      fail(
        `directory entry mismatch: beaconType=${entry.beaconType} threshold=${entry.threshold} ` +
          `capacity=${entry.capacity}, expected CASBeacon / ${THRESHOLD} / ${THRESHOLD}`,
      );
    }
    const statusRes = await fetch(`${baseUrl}/v1/status`);
    const status = (await statusRes.json()) as ServiceStatusDTO;
    if (!status.up || status.openCohorts < 1) {
      fail(`GET /v1/status should report up with >= 1 open cohort, got ${JSON.stringify(status)}`);
    }
    log(`[ok] directory: cohort ${cohortId} is an open entry; status openCohorts=${status.openCohorts}`);

    /* ---- 7. Lifecycle: real participants discover, join, and co-sign. ---- */
    // The participants subscribe to the advert SSE and auto-join; the transport's
    // advert cache (5-min TTL) replays the already-published advert to them, so a
    // participant that starts after advertise still discovers the cohort.
    const identities = Array.from({ length: THRESHOLD }, () => createIdentity());
    const participants = identities.map((identity) => createParticipant({ identity, baseUrl }));
    const participantComplete = participants.map(
      (participant, i) =>
        new Promise<void>((resolve) => {
          participant.runner.on('cohort-complete', () => {
            log(`[participant ${i}] cohort-complete`);
            resolve();
          });
        }),
    );
    participants.forEach((participant, i) => {
      participant.runner.on('cohort-failed', ({ reason }) => log(`[participant ${i}] cohort-failed: ${reason}`));
      participant.runner.on('error', (err) => log(`[participant ${i}] error: ${err.message}`));
    });

    try {
      await Promise.all(participants.map((participant) => participant.start()));
      log(`${participants.length} participants started; driving the operator-advertised cohort...`);

      await withTimeout(signingComplete, timeoutMs, 'operator cohort signing');
      await withTimeout(Promise.all(participantComplete), 15_000, 'participant completion');

      if (aggregatedSignatureLength !== 64) {
        fail(`expected a 64-byte aggregated signature, got ${aggregatedSignatureLength}`);
      }
      // The cohort that signed MUST be the operator-advertised one (no phantom
      // auto-advertised cohort exists to sign; T-04-02 belt-and-suspenders).
      if (signedCohortId !== cohortId) {
        fail(
          `the cohort that reached signing-complete (${signedCohortId}) is not the operator-advertised ` +
            `cohort (${cohortId})`,
        );
      }
      if (problems.length === 0) {
        log(`[ok] co-sign: 64-byte aggregated signature for the operator-advertised cohort ${cohortId}`);
      }
    } finally {
      for (const participant of participants) {
        participant.stop();
      }
    }

    return problems;
  } finally {
    await service.stop();
  }
}

/** Poll `p` every `intervalMs` until `predicate` holds or the overall `ms` budget runs out. */
async function pollUntil<T>(
  produce: () => Promise<T>,
  predicate: (value: T) => boolean,
  ms: number,
  label: string,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + ms;
  let last: T = await produce();
  while (!predicate(last)) {
    if (Date.now() >= deadline) {
      throw new Error(`${label} not satisfied within ${ms}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await produce();
  }
  return last;
}

/**
 * The F2 expiry leg: prove an idle, unjoined advertised cohort is (1) torn down from the
 * PARTICIPANT directory when its single stall timer fires, but (2) surfaced to the
 * OPERATOR as `state: 'expired'` with a reason instead of vanishing, and (3) revivable
 * via the gated re-advertise route. Boots a fresh hermetic service with a deliberately
 * SHORT phaseTimeoutMs/cohortTtlMs so the idle-Advertised expiry is deterministic, and
 * starts NO participant (the cohort must expire from inactivity, not complete).
 */
export async function runExpiryLeg(options: OperatorCohortOptions = {}): Promise<string[]> {
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  // A short window makes the idle-Advertised expiry deterministic without a long wait:
  // the runner's single stall timer fires ~300ms after advertise with no participant
  // driving the cohort forward, rejecting the completion (the signal the operator surface
  // records as expired).
  const EXPIRY_MS = 300;
  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(THRESHOLD, 'CASBeacon'),
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
    phaseTimeoutMs: EXPIRY_MS,
    cohortTtlMs: EXPIRY_MS,
  });
  service.runner.on('error', (err) => log(`[service] error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`[expiry] service listening on ${baseUrl}`);

  try {
    // Login + capture the operator_session cookie (Node fetch has no cookie jar).
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (loginRes.status !== 200 || !setCookie) {
      fail(`[expiry] operator login should be 200 with a session cookie, got ${loginRes.status}`);
      return problems;
    }
    const cookie = setCookie.split(';')[0];

    // Create + advertise a cohort, then leave it completely idle (no participant).
    const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ beaconType: 'CASBeacon', size: THRESHOLD }),
    });
    const draft = (await createRes.json()) as OperatorCohortDTO;
    const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    const advertised = (await advertiseRes.json()) as OperatorCohortDTO;
    const expiredId = advertised.draftId;
    log(`[expiry] advertised idle cohort ${expiredId}; waiting for the stall timer to expire it...`);

    // Poll the operator list until the advertised row flips to state: 'expired'.
    const listExpired = await withTimeout(
      pollUntil(
        async () => {
          const res = await fetch(`${baseUrl}/v1/operator/cohorts`, { headers: { cookie } });
          const body = (await res.json()) as { cohorts: OperatorCohortDTO[] };
          return body.cohorts;
        },
        (cohorts) => cohorts.some((c) => c.draftId === expiredId && c.state === 'expired'),
        10_000,
        '[expiry] cohort flips to expired',
      ),
      12_000,
      '[expiry] expiry poll',
    );

    const expiredRow = listExpired.find((c) => c.draftId === expiredId);
    if (!expiredRow) {
      fail(`[expiry] cohort ${expiredId} never appeared as expired in the operator list`);
    } else {
      if (expiredRow.state !== 'expired') {
        fail(`[expiry] cohort ${expiredId} should be state 'expired', got '${expiredRow.state}'`);
      }
      if (!expiredRow.reason) {
        fail(`[expiry] expired cohort ${expiredId} should carry a non-empty reason`);
      }
    }

    // The participant directory must NOT show the expired cohort (it is genuinely gone
    // from the open set; expired is operator-only).
    const dirAfterExpiry = (await (await fetch(`${baseUrl}/v1/directory`)).json()) as DirectoryCohortDTO[];
    if (dirAfterExpiry.some((d) => d.cohortId === expiredId)) {
      fail(`[expiry] expired cohort ${expiredId} must NOT appear in the public /v1/directory`);
    }
    log('[assert] expiry: cohort absent from /v1/directory but surfaced to the operator as expired with a reason');

    // Re-advertise the expired cohort: a fresh advertised DTO, back in the directory.
    const readvertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${expiredId}/readvertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (readvertiseRes.status !== 200) {
      fail(`[expiry] re-advertise should be 200, got ${readvertiseRes.status}`);
      return problems;
    }
    const revived = (await readvertiseRes.json()) as OperatorCohortDTO;
    if (revived.state !== 'advertised') {
      fail(`[expiry] re-advertised cohort should be state 'advertised', got '${revived.state}'`);
    }
    const newCohortId = revived.draftId;
    const dirAfterReadvertise = (await (await fetch(`${baseUrl}/v1/directory`)).json()) as DirectoryCohortDTO[];
    if (!dirAfterReadvertise.some((d) => d.cohortId === newCohortId)) {
      fail(`[expiry] re-advertised cohort ${newCohortId} should be back in the public /v1/directory`);
    }
    if (problems.length === 0) {
      log(`[ok] expiry: cohort surfaced as expired, then re-advertised as ${newCohortId} back into the directory`);
    }

    return problems;
  } finally {
    await service.stop();
  }
}

/**
 * The SVC-03 fixture monitoring leg (D-47 fixture leg): boot a hermetic operator service, log
 * in, advertise a cohort, and let real headless participants join + co-sign it, THEN assert the
 * gated monitoring reads reflect that real activity end to end over the fixture path - the
 * per-cohort detail read (`GET /v1/operator/cohorts/:id`) shows the seated members and who
 * submitted, and the list read's `monitoring` sibling settles the cohort into the `anchored`
 * ended taxonomy. This is the hermetic, CI-facing evidence of record for the monitoring read
 * model (the live end-to-end funding proof is the owner's opt-in `pnpm uat:live` walkthrough).
 *
 * Robust-by-construction: the monitor folds every runner event into its OWN per-cohort entry at
 * event time (RESEARCH Pitfall 2), so the members/submissions/co-sign facts survive the session
 * GC that runs on completion. The leg therefore synchronizes on the service's HARD
 * signing-complete and then asserts the folded reads, rather than racing the near-instant
 * hermetic co-sign for a mid-flight snapshot.
 */
export async function runMonitorLeg(options: OperatorCohortOptions = {}): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  // A hermetic operator-enabled service; the monitor is wired inside createService whenever an
  // operatorPassword is set (no live/broadcast, so the funding stage is absent, D-47).
  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(THRESHOLD, 'CASBeacon'),
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
  });

  let signedCohortId = '';
  const signingComplete = new Promise<void>((resolve) => {
    service.runner.on('signing-complete', (result) => {
      signedCohortId = result.cohortId;
      resolve();
    });
  });
  service.runner.on('error', (err) => log(`[monitor] service error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`[monitor] service listening on ${baseUrl}`);

  const participants: ReturnType<typeof createParticipant>[] = [];
  try {
    // Login + capture the operator_session cookie (Node fetch has no cookie jar).
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (loginRes.status !== 200 || !setCookie) {
      fail(`[monitor] operator login should be 200 with a session cookie, got ${loginRes.status}`);
      return problems;
    }
    const cookie = setCookie.split(';')[0];

    // Create + advertise a cohort.
    const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ beaconType: 'CASBeacon', size: THRESHOLD, threshold: THRESHOLD }),
    });
    if (createRes.status !== 201) {
      fail(`[monitor] create draft should be 201, got ${createRes.status}`);
      return problems;
    }
    const draft = (await createRes.json()) as OperatorCohortDTO;
    const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (advertiseRes.status !== 200) {
      fail(`[monitor] advertise should be 200, got ${advertiseRes.status}`);
      return problems;
    }
    const cohortId = ((await advertiseRes.json()) as OperatorCohortDTO).draftId;
    log(`[monitor] advertised cohort ${cohortId}; driving real participants to generate monitored activity...`);

    // Real headless participants discover, join, submit, and co-sign - the SAME lifecycle
    // the operator would be monitoring, generating every event the fold records.
    const participantComplete: Promise<void>[] = [];
    for (let i = 0; i < THRESHOLD; i += 1) {
      const participant = createParticipant({ identity: createIdentity(), baseUrl });
      participant.runner.on('error', (err) => log(`[monitor] participant ${i} error: ${err.message}`));
      participants.push(participant);
      participantComplete.push(
        new Promise<void>((resolve) => participant.runner.on('cohort-complete', () => resolve())),
      );
    }
    await Promise.all(participants.map((p) => p.start()));
    await withTimeout(signingComplete, timeoutMs, '[monitor] cohort signing');
    await withTimeout(Promise.all(participantComplete), 15_000, '[monitor] participant completion');
    if (signedCohortId !== cohortId) {
      fail(`[monitor] the cohort that signed (${signedCohortId}) is not the advertised cohort (${cohortId})`);
    }

    // (1) The gated per-cohort detail read reflects the seated members + who submitted (D-30/D-31).
    let detail: MonitorDetailDTO;
    try {
      detail = await pollUntil(
        async () => {
          const res = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortId}`, { headers: { cookie } });
          return (await res.json()) as MonitorDetailDTO;
        },
        (d) => d.exists && d.seatsJoined === THRESHOLD && d.submissions.filter((s) => s.submitted).length === THRESHOLD,
        timeoutMs,
        '[monitor] detail read reflects seated members + submissions',
      );
    } catch (err) {
      fail(`[monitor] gated detail read never reflected the cohort activity: ${err instanceof Error ? err.message : err}`);
      return problems;
    }
    const seatedMembers = detail.members.filter((m) => m.status === 'seated');
    if (seatedMembers.length !== THRESHOLD) {
      fail(`[monitor] detail should show ${THRESHOLD} seated members, got ${seatedMembers.length}`);
    }
    const submitted = detail.submissions.filter((s) => s.submitted);
    if (submitted.length !== THRESHOLD) {
      fail(`[monitor] detail should show ${THRESHOLD} submissions, got ${submitted.length}`);
    }
    if (submitted.some((s) => typeof s.at !== 'number')) {
      fail('[monitor] each submitted row should carry a server wall-clock `at` stamp (D-22/D-30)');
    }
    if (detail.coSign.total !== THRESHOLD) {
      fail(`[monitor] co-sign total should be ${THRESHOLD} (the seated members), got ${detail.coSign.total}`);
    }
    log(`[assert] monitoring detail: ${seatedMembers.length} seated members, ${submitted.length} submissions, co-sign total ${detail.coSign.total}`);

    // (2) The list read's monitoring sibling settles the cohort into the `anchored` ended
    //     taxonomy (D-23): on the hermetic key-path co-sign the terminal fate is `anchored`
    //     (no broadcaster to flip it to failed), and the anchored metric counts it.
    let ended: OperatorListWithMonitoringDTO;
    try {
      ended = await pollUntil(
        async () => {
          const res = await fetch(`${baseUrl}/v1/operator/cohorts`, { headers: { cookie } });
          return (await res.json()) as OperatorListWithMonitoringDTO;
        },
        (body) => (body.monitoring?.rows ?? []).some((r) => r.cohortId === cohortId && r.chip === 'anchored'),
        timeoutMs,
        '[monitor] summary chip settles to anchored',
      );
    } catch (err) {
      fail(`[monitor] summary read never settled the cohort into the anchored ended taxonomy: ${err instanceof Error ? err.message : err}`);
      return problems;
    }
    if (!ended.monitoring) {
      fail('[monitor] the list read should carry the additive `monitoring` sibling when the monitor is wired');
    } else if (ended.monitoring.metrics.anchored < 1) {
      fail(`[monitor] the anchored metric should count the completed cohort, got ${ended.monitoring.metrics.anchored}`);
    }
    if (problems.length === 0) {
      log(`[ok] monitor: the gated reads reflected members + submissions and settled cohort ${cohortId} as anchored`);
    }

    return problems;
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  // `--monitor` runs ONLY the SVC-03 fixture monitoring leg (the `e2e:monitor` script); the
  // default runs the full operator suite (auth boundary + on-demand driver + expiry) AND the
  // monitoring leg, so the extended `e2e:operator` gate covers the monitoring read model too.
  const monitorOnly = process.argv.includes('--monitor');
  const problems = monitorOnly
    ? await runMonitorLeg({ quiet })
    : [
        ...(await runOperatorCohort({ quiet })),
        ...(await runExpiryLeg({ quiet })),
        ...(await runMonitorLeg({ quiet })),
      ];
  if (problems.length > 0) {
    console.error('\nE2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  if (monitorOnly) {
    console.log(
      '\nMONITOR E2E PASSED: an operator advertised a cohort, real participants joined + co-signed it ' +
        'hermetically, and the gated monitoring reads reflected that activity end to end - the per-cohort ' +
        'detail read showed the seated members and who submitted, and the list read settled the cohort into ' +
        'the anchored ended taxonomy (SVC-03, D-47 fixture leg).',
    );
    return 0;
  }
  console.log(
    '\nE2E PASSED: operator login -> create -> advertise -> real participants discovered the ' +
      'directory entry, joined, and co-signed a 64-byte aggregated Taproot signature over real ' +
      'HTTP - with the auth boundary (wrong-password + no-cookie negatives) and the on-demand-only ' +
      'driver (no cohorts at boot) both proven in the same hermetic run; PLUS the F2 expiry leg ' +
      '(an idle advertised cohort expires out of the participant directory but is surfaced to the ' +
      'operator as expired with a reason, and is then re-advertised back into the directory); PLUS ' +
      'the SVC-03 monitoring leg (the gated per-cohort detail read reflects the seated members and ' +
      'submissions, and the list read settles the cohort into the anchored ended taxonomy, D-47).',
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
