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
 *     un-authenticated `GET /v1/operator/cohorts` and `GET /dashboard/events` both
 *     401. If a gated route ever regressed open, the gate fails here.
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
/** The single cohort size n: both the seat count and the n in n-of-n for the advertised cohort. */
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

    // No cookie -> the gated live telemetry feed 401s (the guard runs before the SSE
    // stream ever opens, so this returns a normal 401 body, not a hanging stream).
    const noCookieDashboard = await fetch(`${baseUrl}/dashboard/events`);
    if (noCookieDashboard.status !== 401) {
      fail(`GET /dashboard/events with no cookie should be 401, got ${noCookieDashboard.status}`);
    }
    await noCookieDashboard.text();
    log('[assert] negative auth: wrong-password 401 (no cookie), no-cookie /v1/operator/cohorts + /dashboard/events 401');

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
      body: JSON.stringify({ beaconType: 'CASBeacon', size: THRESHOLD }),
    });
    if (createRes.status !== 201) {
      fail(`create draft should be 201, got ${createRes.status}`);
      return problems;
    }
    const draft = (await createRes.json()) as OperatorCohortDTO;
    if (draft.state !== 'draft') {
      fail(`created cohort should be state 'draft', got '${draft.state}'`);
    }
    log(`[ok] create: draft ${draft.draftId} (${draft.beaconType} ${draft.threshold}-of-${draft.threshold})`);

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
    } else if (entry.beaconType !== 'CASBeacon' || entry.threshold !== THRESHOLD) {
      fail(
        `directory entry mismatch: beaconType=${entry.beaconType} threshold=${entry.threshold}, ` +
          `expected CASBeacon / ${THRESHOLD}`,
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

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  const problems = [...(await runOperatorCohort({ quiet })), ...(await runExpiryLeg({ quiet }))];
  if (problems.length > 0) {
    console.error('\nE2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nE2E PASSED: operator login -> create -> advertise -> real participants discovered the ' +
      'directory entry, joined, and co-signed a 64-byte aggregated Taproot signature over real ' +
      'HTTP - with the auth boundary (wrong-password + no-cookie negatives) and the on-demand-only ' +
      'driver (no cohorts at boot) both proven in the same hermetic run; PLUS the F2 expiry leg ' +
      '(an idle advertised cohort expires out of the participant directory but is surfaced to the ' +
      'operator as expired with a reason, and is then re-advertised back into the directory).',
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
