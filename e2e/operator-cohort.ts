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
  /** `'canceled'` is the operator-initiated end (SVC-04, D-05), distinct from an expiry. */
  state: 'draft' | 'advertised' | 'expired' | 'canceled';
  /** Short reason present only on terminal (`'expired'` / `'canceled'`) rows (F2, D-05). */
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
  /** Advertising drain mode (SVC-04, Phase 5 D-07): new cohorts are not being offered. */
  paused: boolean;
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
  /** True for a member this service spawned as an operator test peer (SVC-04, D-17). */
  testPeer?: boolean;
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
  chip:
    | 'filling'
    | 'co-signing'
    | 'needs-funding'
    // The two honest UNCONFIRMED completions (05-AUDIT entry 9): signed, but nothing confirmed
    // on-chain. Both legs below are hermetic, so `co-signed` is what they actually settle on.
    | 'co-signed'
    | 'co-signed-fallback'
    | 'fallback'
    | 'anchored'
    | 'canceled'
    | 'failed';
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
 * submitted, and the list read's `monitoring` sibling settles the cohort into the honest
 * `co-signed` ended taxonomy (hermetic, so nothing anchors and the anchored counter stays at
 * zero). This is the hermetic, CI-facing evidence of record for the monitoring read model (the
 * live end-to-end funding proof is the owner's opt-in `pnpm uat:live` walkthrough).
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

    // (2) The list read's monitoring sibling settles the cohort into the honest ended taxonomy
    //     (D-23): this leg drives a HERMETIC key-path co-sign, so the terminal fate is `co-signed`
    //     (the co-sign succeeded; no broadcaster ever published the beacon tx, so nothing could
    //     confirm). `anchored` is reserved for a CONFIRMED anchor (Phase 4 D-18, 05-AUDIT entry 9).
    let ended: OperatorListWithMonitoringDTO;
    try {
      ended = await pollUntil(
        async () => {
          const res = await fetch(`${baseUrl}/v1/operator/cohorts`, { headers: { cookie } });
          return (await res.json()) as OperatorListWithMonitoringDTO;
        },
        (body) => (body.monitoring?.rows ?? []).some((r) => r.cohortId === cohortId && r.chip === 'co-signed'),
        timeoutMs,
        '[monitor] summary chip settles to co-signed',
      );
    } catch (err) {
      fail(`[monitor] summary read never settled the cohort into the co-signed ended taxonomy: ${err instanceof Error ? err.message : err}`);
      return problems;
    }
    if (!ended.monitoring) {
      fail('[monitor] the list read should carry the additive `monitoring` sibling when the monitor is wired');
    } else if (ended.monitoring.metrics.anchored !== 0) {
      // An HONESTY invariant, not a completion check: this service publishes nothing, so it must
      // report zero anchored cohorts however many it completes. Completion is proven by the chip
      // poll immediately above, which only settles once the co-sign has finished.
      fail(
        `[monitor] a hermetic service anchors nothing, so the anchored metric must stay 0, got ` +
          `${ended.monitoring.metrics.anchored}`,
      );
    }
    if (problems.length === 0) {
      log(`[ok] monitor: the gated reads reflected members + submissions and settled cohort ${cohortId} as co-signed`);
    }

    return problems;
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

/**
 * The SVC-04 cancel leg: prove the operator can end an advertised cohort and that doing so
 * does NOT take its siblings' joinability down with it.
 *
 * The two-cohort shape is load-bearing, not incidental. `HttpServerTransport` holds exactly
 * ONE advert slot, replays only that slot to a NEW SSE subscriber, and clears it when the
 * slot-owning cohort is disposed - so canceling the most recently advertised cohort (B) leaves
 * its sibling (A) listed in the public directory yet invisible to anyone connecting afterwards.
 * A single-cohort cancel test passes while that defect is live, so this leg advertises A, then
 * B (B takes the slot), cancels B, and then constructs a FRESH participant filtered to A. The
 * participant must be freshly constructed: one started before the cancel already holds A's
 * advert and would seat regardless, which is exactly the false green this leg exists to avoid.
 *
 * Hermetic by construction (no live, no chain): both cohorts are size 2 and only one
 * participant joins A, so nothing reaches signing and the assertions never race a completion.
 */
export async function runCancelLeg(options: OperatorCohortOptions = {}): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(THRESHOLD, 'CASBeacon'),
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
  });
  service.runner.on('error', (err) => log(`[cancel] service error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`[cancel] service listening on ${baseUrl}`);

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
      fail(`[cancel] operator login should be 200 with a session cookie, got ${loginRes.status}`);
      return problems;
    }
    const cookie = setCookie.split(';')[0];

    /** Create a draft and advertise it; returns the LIVE cohort id. */
    const createAndAdvertise = async (label: string): Promise<string> => {
      const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ beaconType: 'CASBeacon', size: THRESHOLD, threshold: THRESHOLD }),
      });
      const draft = (await createRes.json()) as OperatorCohortDTO;
      const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
        method: 'POST',
        headers: { cookie },
      });
      const advertised = (await advertiseRes.json()) as OperatorCohortDTO;
      log(`[cancel] advertised cohort ${label} as ${advertised.draftId}`);
      return advertised.draftId;
    };

    // A first, then B: B is the most recently advertised, so B owns the transport advert slot.
    const cohortA = await createAndAdvertise('A');
    const cohortB = await createAndAdvertise('B');

    const before = (await (await fetch(`${baseUrl}/v1/status`)).json()) as ServiceStatusDTO;
    if (before.openCohorts !== 2) {
      fail(`[cancel] two advertised cohorts should report openCohorts 2, got ${before.openCohorts}`);
    }

    /* ---- Cancel B through the gated route. ---- */
    const cancelRes = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortB}/cancel`, {
      method: 'POST',
      headers: { cookie },
    });
    if (cancelRes.status !== 200) {
      fail(`[cancel] cancel should be 200, got ${cancelRes.status}`);
      return problems;
    }
    await cancelRes.text();

    // B leaves the participant directory immediately and the open count drops to exactly A.
    const directory = await withTimeout(
      pollUntil(
        async () => (await (await fetch(`${baseUrl}/v1/directory`)).json()) as DirectoryCohortDTO[],
        (rows) => !rows.some((d) => d.cohortId === cohortB),
        10_000,
        '[cancel] canceled cohort leaves /v1/directory',
      ),
      12_000,
      '[cancel] directory poll',
    );
    if (!directory.some((d) => d.cohortId === cohortA)) {
      fail(`[cancel] the sibling cohort ${cohortA} must stay in /v1/directory after ${cohortB} is canceled`);
    }
    const after = (await (await fetch(`${baseUrl}/v1/status`)).json()) as ServiceStatusDTO;
    if (after.openCohorts !== 1) {
      fail(`[cancel] after canceling one of two cohorts openCohorts should be 1, got ${after.openCohorts}`);
    }
    log('[assert] cancel: the canceled cohort left /v1/directory and openCohorts dropped to 1');

    /* ---- The operator sees a distinct canceled fate, never an expiry or a failure. ---- */
    const listed = (await (
      await fetch(`${baseUrl}/v1/operator/cohorts`, { headers: { cookie } })
    ).json()) as OperatorListWithMonitoringDTO;
    const canceledRow = listed.cohorts.find((c) => c.draftId === cohortB);
    if (!canceledRow) {
      fail(`[cancel] canceled cohort ${cohortB} should still be listed to the operator`);
    } else if (canceledRow.state !== 'canceled') {
      fail(`[cancel] canceled cohort ${cohortB} should be state 'canceled', got '${canceledRow.state}'`);
    } else if (canceledRow.reason !== 'canceled by the operator') {
      fail(`[cancel] canceled cohort should carry the fixed operator reason, got '${canceledRow.reason ?? ''}'`);
    }
    const chipRow = (listed.monitoring?.rows ?? []).find((r) => r.cohortId === cohortB);
    if (chipRow?.chip !== 'canceled') {
      fail(`[cancel] the monitoring row for ${cohortB} should carry the 'canceled' chip, got '${chipRow?.chip ?? 'none'}'`);
    }
    if (listed.monitoring && listed.monitoring.metrics.failed !== 0) {
      fail(`[cancel] a deliberate cancel must not count as a failure, got failed=${listed.monitoring.metrics.failed}`);
    }
    log("[assert] cancel: the operator list shows the canceled fate with its own chip and no failure count");

    /* ---- A STRANGER can learn the cancel, over real HTTP, with no session (SVC-04, D-02). ---- */
    // This is the whole participant-facing half of the cancel slice: the protocol carries no
    // cancel message, so a seated participant can only ask this read. It runs here with NO cookie
    // header at all, because a browser that was never logged in is exactly the caller it serves.
    const fateOf = async (id: string): Promise<{ status: number; body: unknown }> => {
      const res = await fetch(`${baseUrl}/v1/cohort-fate/${id}`);
      return { status: res.status, body: await res.json() };
    };
    const canceledFate = await fateOf(cohortB);
    if (canceledFate.status !== 200 || JSON.stringify(canceledFate.body) !== JSON.stringify({ canceled: true })) {
      fail(
        `[cancel] the anonymous fate read for the canceled cohort ${cohortB} should be 200 {"canceled":true}, ` +
          `got ${canceledFate.status} ${JSON.stringify(canceledFate.body)}`,
      );
    }
    // The live sibling and an id this service never issued must both read false, and must read
    // IDENTICALLY: the route carries one bit of attribution and no way to probe this service.
    const liveFate = await fateOf(cohortA);
    const unknownFate = await fateOf('a-cohort-id-this-service-never-issued');
    if (JSON.stringify(liveFate) !== JSON.stringify(unknownFate)) {
      fail(
        `[cancel] the live cohort and an unknown id must answer identically, got ` +
          `${JSON.stringify(liveFate)} vs ${JSON.stringify(unknownFate)}`,
      );
    }
    if (JSON.stringify(unknownFate.body) !== JSON.stringify({ canceled: false })) {
      fail(`[cancel] an unknown id should read {"canceled":false}, got ${JSON.stringify(unknownFate.body)}`);
    }
    log('[assert] cancel: an anonymous caller reads the canceled fact, and learns nothing else about this service');

    /* ---- The sibling cohort is still genuinely joinable (the advert-slot repair). ---- */
    // FRESHLY constructed AFTER the cancel: a participant started earlier already holds A's
    // advert and would seat even with the single-advert-slot defect live.
    const participant = createParticipant({ identity: createIdentity(), baseUrl, cohortId: cohortA });
    participant.runner.on('error', (err) => log(`[cancel] participant error: ${err.message}`));
    participants.push(participant);
    await participant.start();
    log(`[cancel] fresh participant started, filtered to the sibling cohort ${cohortA}`);

    try {
      await withTimeout(
        pollUntil(
          async () => {
            const res = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortA}`, { headers: { cookie } });
            return (await res.json()) as MonitorDetailDTO;
          },
          (detail) => detail.seatsJoined >= 1,
          15_000,
          '[cancel] the fresh participant seats in the sibling cohort',
        ),
        timeoutMs,
        '[cancel] sibling seat poll',
      );
    } catch (err) {
      fail(
        `[cancel] the sibling cohort ${cohortA} never seated a freshly constructed participant after ` +
          `${cohortB} was canceled (the transport advert slot was not repaired): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return problems;
    }
    if (problems.length === 0) {
      log(`[ok] cancel: ${cohortB} was canceled with its own fate and the sibling ${cohortA} still seats new participants`);
    }

    return problems;
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

/**
 * The SVC-04 pause leg: prove that advertising DRAIN MODE is a drain and not a kill switch, end to
 * end over real HTTP.
 *
 * The distinction is the whole product claim, and it is only provable from the outside. A pause
 * that quietly took the public directory down with it would look identical from the gated side
 * (the operator sees "paused" either way), so this leg asserts the participant-facing half:
 *
 *  1. `GET /v1/status` reports `paused: true` while STILL reporting `openCohorts: 1`. Those two
 *     facts together are exactly what the public paused notice renders, and they are the reason
 *     the server serves a paused bit at all - a paused service and an idle one both show zero open
 *     cohorts, so the bit cannot be inferred from the count.
 *  2. A FRESHLY constructed participant still seats in the cohort advertised BEFORE the pause. A
 *     participant started earlier already holds the advert and would seat regardless, which is the
 *     false green this leg exists to avoid (the same discipline as the cancel leg above).
 *  3. A NEW advertise is refused with 409, never a silent no-op and never a false 200: the
 *     operator must be able to tell "I am draining" from "that draft is gone".
 *  4. Resume restores both the public bit and the ability to advertise.
 *
 * Hermetic by construction (no live, no chain): the cohort is size 2 and only one participant
 * joins, so nothing reaches signing and the assertions never race a completion.
 */
export async function runPauseLeg(options: OperatorCohortOptions = {}): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(THRESHOLD, 'CASBeacon'),
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
  });
  service.runner.on('error', (err) => log(`[pause] service error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`[pause] service listening on ${baseUrl}`);

  const participants: ReturnType<typeof createParticipant>[] = [];
  try {
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (loginRes.status !== 200 || !setCookie) {
      fail(`[pause] operator login should be 200 with a session cookie, got ${loginRes.status}`);
      return problems;
    }
    const cookie = setCookie.split(';')[0];

    /** Create a draft; returns its draft id. */
    const createDraft = async (): Promise<string> => {
      const res = await fetch(`${baseUrl}/v1/operator/cohorts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ beaconType: 'CASBeacon', size: THRESHOLD, threshold: THRESHOLD }),
      });
      return ((await res.json()) as OperatorCohortDTO).draftId;
    };

    /* ---- Advertise cohort A BEFORE the pause. ---- */
    const draftA = await createDraft();
    const advertiseA = await fetch(`${baseUrl}/v1/operator/cohorts/${draftA}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (advertiseA.status !== 200) {
      fail(`[pause] advertising before the pause should be 200, got ${advertiseA.status}`);
      return problems;
    }
    const cohortA = ((await advertiseA.json()) as OperatorCohortDTO).draftId;
    log(`[pause] advertised cohort A as ${cohortA} while running`);

    // A draft created before the pause, left un-advertised, so the refusal below has a real target.
    const draftB = await createDraft();

    /* ---- Pause. ---- */
    const pauseRes = await fetch(`${baseUrl}/v1/operator/advertising/pause`, {
      method: 'POST',
      headers: { cookie },
    });
    if (pauseRes.status !== 200) {
      fail(`[pause] pause should be 200, got ${pauseRes.status}`);
      return problems;
    }
    const pauseBody = (await pauseRes.json()) as { paused?: unknown };
    if (pauseBody.paused !== true) {
      fail(`[pause] pause should return the resulting state paused:true, got ${JSON.stringify(pauseBody)}`);
    }

    /* ---- The public claim: paused, yet STILL offering what is already open. ---- */
    const paused = (await (await fetch(`${baseUrl}/v1/status`)).json()) as ServiceStatusDTO;
    if (paused.paused !== true) {
      fail(`[pause] GET /v1/status should report paused:true while paused, got ${String(paused.paused)}`);
    }
    if (paused.openCohorts !== 1) {
      fail(
        `[pause] a paused service must STILL count the cohort advertised before the pause: ` +
          `expected openCohorts 1, got ${paused.openCohorts}`,
      );
    }
    const listedWhilePaused = (await (
      await fetch(`${baseUrl}/v1/directory`)
    ).json()) as DirectoryCohortDTO[];
    if (!listedWhilePaused.some((d) => d.cohortId === cohortA)) {
      fail(`[pause] the pre-pause cohort ${cohortA} must stay in /v1/directory while paused`);
    }
    log('[assert] pause: /v1/status reports paused:true AND openCohorts 1, and the cohort is still listed');

    /* ---- A new advertise is refused LOUDLY (409), and the draft survives the refusal. ---- */
    const refused = await fetch(`${baseUrl}/v1/operator/cohorts/${draftB}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (refused.status !== 409) {
      fail(`[pause] advertising while paused should be refused with 409, got ${refused.status}`);
    } else {
      const body = (await refused.json()) as { error?: string };
      if (!body.error) {
        fail('[pause] the 409 refusal should carry an app-authored reason, got an empty body');
      }
    }
    const afterRefusal = (await (
      await fetch(`${baseUrl}/v1/operator/cohorts`, { headers: { cookie } })
    ).json()) as OperatorListWithMonitoringDTO;
    const survivingDraft = afterRefusal.cohorts.find((c) => c.draftId === draftB);
    if (survivingDraft?.state !== 'draft') {
      fail(
        `[pause] a refused advertise must leave the draft a draft (never consumed), ` +
          `got '${survivingDraft?.state ?? 'missing'}'`,
      );
    }
    log('[assert] pause: a new advertise was refused 409 with a reason, and the draft survived');

    /* ---- A FRESH participant can still join the pre-pause cohort while paused. ---- */
    const participant = createParticipant({ identity: createIdentity(), baseUrl, cohortId: cohortA });
    participant.runner.on('error', (err) => log(`[pause] participant error: ${err.message}`));
    participants.push(participant);
    await participant.start();
    log(`[pause] fresh participant started while paused, filtered to ${cohortA}`);

    try {
      await withTimeout(
        pollUntil(
          async () => {
            const res = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortA}`, { headers: { cookie } });
            return (await res.json()) as MonitorDetailDTO;
          },
          (detail) => detail.seatsJoined >= 1,
          15_000,
          '[pause] a fresh participant seats in the pre-pause cohort while paused',
        ),
        timeoutMs,
        '[pause] seat poll',
      );
    } catch (err) {
      fail(
        `[pause] pause is DRAIN MODE, not a kill switch: a freshly constructed participant must still ` +
          `seat in cohort ${cohortA}, which was advertised before the pause: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return problems;
    }
    log('[assert] pause: a freshly constructed participant seated in the pre-pause cohort while paused');

    /* ---- Resume restores both the public bit and the ability to advertise. ---- */
    const resumeRes = await fetch(`${baseUrl}/v1/operator/advertising/resume`, {
      method: 'POST',
      headers: { cookie },
    });
    if (resumeRes.status !== 200) {
      fail(`[pause] resume should be 200, got ${resumeRes.status}`);
      return problems;
    }
    const resumeBody = (await resumeRes.json()) as { paused?: unknown };
    if (resumeBody.paused !== false) {
      fail(`[pause] resume should return paused:false, got ${JSON.stringify(resumeBody)}`);
    }
    const running = (await (await fetch(`${baseUrl}/v1/status`)).json()) as ServiceStatusDTO;
    if (running.paused !== false) {
      fail(`[pause] GET /v1/status should report paused:false after resume, got ${String(running.paused)}`);
    }
    const readvertised = await fetch(`${baseUrl}/v1/operator/cohorts/${draftB}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (readvertised.status !== 200) {
      fail(`[pause] advertising after resume should be 200 again, got ${readvertised.status}`);
    } else {
      await readvertised.text();
    }
    log('[assert] pause: resume restored paused:false and the same draft then advertised successfully');

    if (problems.length === 0) {
      log('[ok] pause: drain mode paused NEW cohorts only and resume restored advertising');
    }

    return problems;
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

/**
 * The SVC-04 test-peer leg (D-17): prove the SOLO-REHEARSAL story end to end over the real gated
 * route and the real participant transport.
 *
 * One operator, no second human: advertise a 3-seat cohort, add ONE test peer (the partial fill,
 * UI-SPEC E11), then fill the remaining seats, and watch the peers seat, submit, and co-sign the
 * cohort to completion exactly as strangers would. The two facts a unit spec cannot prove are
 * asserted here: the peers really do reach `signing-complete` over the real HTTP transport, and
 * every peer is torn down when the cohort settles, counted rather than inferred.
 *
 * Hermetic: no `live`, no `bitcoin`, no esplora - the fixture beacon-tx path, exactly like the
 * other legs in this file. The peers are real participants either way; on a live service they
 * would co-sign a real transaction, which is why the console's confirm says so before the act.
 */
export async function runTestPeersLeg(options: OperatorCohortOptions = {}): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  /** Three seats, so ONE peer leaves the cohort genuinely partly filled before the rest arrive. */
  const SEATS = 3;

  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(SEATS, 'CASBeacon'),
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
  });
  service.runner.on('error', (err) => log(`[testpeers] service error: ${err.message}`));

  let signedCohortId = '';
  const signingComplete = new Promise<void>((resolve) => {
    service.runner.on('signing-complete', (result) => {
      signedCohortId = result.cohortId;
      resolve();
    });
  });

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`[testpeers] service listening on ${baseUrl}`);

  try {
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (loginRes.status !== 200 || !setCookie) {
      fail(`[testpeers] operator login should be 200 with a session cookie, got ${loginRes.status}`);
      return problems;
    }
    const cookie = setCookie.split(';')[0];

    /* ---- The anonymous negative: the spawn route is gated BEFORE any cohort lookup. ---- */
    const anonymous = await fetch(`${baseUrl}/v1/operator/cohorts/never-existed/test-peers`, {
      method: 'POST',
    });
    await anonymous.text();
    if (anonymous.status !== 401) {
      fail(`[testpeers] an anonymous spawn must be 401 before any lookup, got ${anonymous.status}`);
    }

    /* ---- Advertise a 3-seat cohort. ---- */
    const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ beaconType: 'CASBeacon', size: SEATS, threshold: SEATS }),
    });
    if (createRes.status !== 201) {
      fail(`[testpeers] create draft should be 201, got ${createRes.status}`);
      return problems;
    }
    const draft = (await createRes.json()) as OperatorCohortDTO;
    const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (advertiseRes.status !== 200) {
      fail(`[testpeers] advertise should be 200, got ${advertiseRes.status}`);
      return problems;
    }
    const cohortId = ((await advertiseRes.json()) as OperatorCohortDTO).draftId;
    log(`[testpeers] advertised cohort ${cohortId} with ${SEATS} seats`);

    const readDetail = async (): Promise<MonitorDetailDTO> => {
      const res = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortId}`, { headers: { cookie } });
      return (await res.json()) as MonitorDetailDTO;
    };

    /* ---- Add ONE test peer: the cohort is left partly filled (UI-SPEC E11 partial). ---- */
    const oneRes = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortId}/test-peers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ count: 1 }),
    });
    if (oneRes.status !== 200) {
      fail(`[testpeers] adding one test peer should be 200, got ${oneRes.status}`);
      return problems;
    }
    const oneBody = (await oneRes.json()) as { spawned?: number };
    if (oneBody.spawned !== 1) {
      fail(`[testpeers] the route should report exactly 1 spawned peer, got ${JSON.stringify(oneBody)}`);
    }
    try {
      const partial = await withTimeout(
        pollUntil(readDetail, (d) => d.seatsJoined >= 1, 15_000, '[testpeers] the first peer seats'),
        timeoutMs,
        '[testpeers] partial seat poll',
      );
      if (partial.seatsJoined !== 1) {
        fail(`[testpeers] one added peer should leave 1 of ${SEATS} seats taken, got ${partial.seatsJoined}`);
      }
      if (partial.capacity !== SEATS) {
        fail(`[testpeers] the served capacity should stay ${SEATS}, got ${partial.capacity}`);
      }
    } catch (err) {
      fail(`[testpeers] the first test peer never seated: ${err instanceof Error ? err.message : String(err)}`);
      return problems;
    }
    log(`[assert] test peers: one peer seated, cohort partly filled at 1/${SEATS}`);

    /* ---- Fill the REMAINING seats with no body at all: the console's own request. ---- */
    const restRes = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortId}/test-peers`, {
      method: 'POST',
      headers: { cookie },
    });
    if (restRes.status !== 200) {
      fail(`[testpeers] filling the remaining seats should be 200, got ${restRes.status}`);
      return problems;
    }
    const restBody = (await restRes.json()) as { spawned?: number };
    if (restBody.spawned !== SEATS - 1) {
      fail(
        `[testpeers] an empty body should fill exactly the ${SEATS - 1} remaining seats, ` +
          `got ${JSON.stringify(restBody)}`,
      );
    }

    /* ---- The peers co-sign the cohort to completion, exactly as strangers would. ---- */
    try {
      await withTimeout(signingComplete, timeoutMs, '[testpeers] cohort signing');
    } catch (err) {
      fail(
        `[testpeers] the operator's own test peers must co-sign the cohort to completion: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return problems;
    }
    if (signedCohortId !== cohortId) {
      fail(`[testpeers] the cohort that signed (${signedCohortId}) is not the advertised one (${cohortId})`);
    }
    log(`[assert] test peers: the operator's own peers co-signed cohort ${cohortId} to completion`);

    /* ---- Every seated member is BADGED as a test peer in the gated detail read. ---- */
    const settled = await readDetail();
    const seated = settled.members.filter((m) => m.status === 'seated');
    if (seated.length !== SEATS) {
      fail(`[testpeers] the detail read should show ${SEATS} seated members, got ${seated.length}`);
    }
    const badged = seated.filter((m) => m.testPeer === true);
    if (badged.length !== seated.length) {
      fail(
        `[testpeers] every seated member of this cohort was added by the operator, so all ` +
          `${seated.length} must read testPeer:true; only ${badged.length} did`,
      );
    }
    log(`[assert] test peers: all ${badged.length} seated members are badged as test peers`);

    /* ---- The list read settles the cohort into the honest co-signed ended taxonomy. ---- */
    // Hermetic and key-path, like the monitoring leg above: the rehearsal really co-signs, and it
    // publishes nothing, so `co-signed` is the fate a no-broadcast service actually produces.
    try {
      await withTimeout(
        pollUntil(
          async () => {
            const res = await fetch(`${baseUrl}/v1/operator/cohorts`, { headers: { cookie } });
            return (await res.json()) as OperatorListWithMonitoringDTO;
          },
          (body) => (body.monitoring?.rows ?? []).some((r) => r.cohortId === cohortId && r.chip === 'co-signed'),
          timeoutMs,
          '[testpeers] summary chip settles to co-signed',
        ),
        timeoutMs,
        '[testpeers] co-signed poll',
      );
    } catch (err) {
      fail(
        `[testpeers] the rehearsed cohort never settled as co-signed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    /* ---- NO peer outlives its cohort: counted, never inferred. ---- */
    if (service.testPeers.activeCount !== 0) {
      fail(
        `[testpeers] every test peer must be torn down when its cohort settles, but ` +
          `${service.testPeers.activeCount} are still running`,
      );
    }
    log('[assert] test peers: zero peers still running after the cohort settled');

    /* ---- A repeat spawn on a cohort with nothing left to fill is refused, never a silent 200. ---- */
    const repeat = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortId}/test-peers`, {
      method: 'POST',
      headers: { cookie },
    });
    await repeat.text();
    // 409 while the settled cohort is still in the session (full), 404 once it has left it. Both
    // are honest refusals; a 200 would mean an operator could spawn peers into a finished cohort.
    if (repeat.status !== 409 && repeat.status !== 404) {
      fail(`[testpeers] a repeat spawn on a finished cohort should be refused, got ${repeat.status}`);
    }

    if (problems.length === 0) {
      log('[ok] test peers: one operator rehearsed a whole cohort alone, and left no peer running');
    }

    return problems;
  } finally {
    await service.stop();
  }
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  // `--monitor` runs ONLY the SVC-03 fixture monitoring leg (the `e2e:monitor` script); the
  // default runs the full operator suite (auth boundary + on-demand driver + expiry) AND the
  // monitoring leg, so the extended `e2e:operator` gate covers the monitoring read model too.
  const monitorOnly = process.argv.includes('--monitor');
  // `--cancel` runs ONLY the SVC-04 cancel leg (the `e2e:cancel` script); it also joins the
  // default suite so the extended `e2e:operator` gate covers the lifecycle verb too.
  const cancelOnly = process.argv.includes('--cancel');
  // `--pause` runs ONLY the SVC-04 drain-mode leg (the `e2e:pause` script); it also joins the
  // default suite so the extended `e2e:operator` gate covers advertising pause too.
  const pauseOnly = process.argv.includes('--pause');
  // `--test-peers` runs ONLY the SVC-04 test-peer leg (the `e2e:testpeers` script); it also joins
  // the default suite so the extended `e2e:operator` gate covers the solo-rehearsal path too.
  const testPeersOnly = process.argv.includes('--test-peers');
  const problems = monitorOnly
    ? await runMonitorLeg({ quiet })
    : cancelOnly
      ? await runCancelLeg({ quiet })
      : pauseOnly
        ? await runPauseLeg({ quiet })
        : testPeersOnly
          ? await runTestPeersLeg({ quiet })
          : [
              ...(await runOperatorCohort({ quiet })),
              ...(await runExpiryLeg({ quiet })),
              ...(await runMonitorLeg({ quiet })),
              ...(await runCancelLeg({ quiet })),
              ...(await runPauseLeg({ quiet })),
              ...(await runTestPeersLeg({ quiet })),
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
        'the honest co-signed ended taxonomy, with the anchored counter still at zero because a ' +
        'hermetic service publishes nothing (SVC-03, D-47 fixture leg).',
    );
    return 0;
  }
  if (cancelOnly) {
    console.log(
      '\nCANCEL E2E PASSED: an operator advertised two cohorts and canceled the most recently ' +
        'advertised one; it left the public directory and the open count immediately, was filed to ' +
        'the operator with its own canceled fate and neutral chip (never a failure), and the ' +
        'still-open sibling cohort seated a FRESHLY constructed participant afterwards - proving ' +
        'the transport single-advert-slot repair (SVC-04, D-01/D-05). An ANONYMOUS caller then ' +
        'read the canceled fact from GET /v1/cohort-fate with no session, while the live sibling ' +
        'and an id this service never issued answered identically (SVC-04, D-02).',
    );
    return 0;
  }
  if (pauseOnly) {
    console.log(
      '\nPAUSE E2E PASSED: an operator paused advertising and the service DRAINED rather than ' +
        'stopping - GET /v1/status reported paused:true while still listing and counting the ' +
        'cohort advertised before the pause, a FRESHLY constructed participant still seated in ' +
        'it, a new advertise was refused with a 409 that left the draft intact, and resume ' +
        'restored both the public bit and the ability to advertise (SVC-04, D-06/D-07).',
    );
    return 0;
  }
  if (testPeersOnly) {
    console.log(
      '\nTEST PEERS E2E PASSED: one operator advertised a 3-seat cohort, added a single test ' +
        'peer (leaving it partly filled), then filled the remaining seats from the gated route; ' +
        'the peers seated, submitted, and co-signed the cohort to completion over the real HTTP ' +
        'transport, every seated member read badged as a test peer in the gated detail read, and ' +
        'zero peers were still running once the cohort settled (SVC-04, D-17).',
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
      'submissions, and the list read settles the cohort into the honest co-signed ended ' +
      'taxonomy while the anchored counter stays at zero, D-47); ' +
      'PLUS the SVC-04 cancel leg (canceling the slot-owning one of two advertised cohorts files a ' +
      'distinct canceled fate and leaves the sibling still joinable to a freshly constructed ' +
      'participant).',
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
