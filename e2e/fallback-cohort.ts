import { pathToFileURL } from 'node:url';
import { createParticipant, type Participant } from '@btcr2-aggregation/participant';
import { createService } from '@btcr2-aggregation/service';
import { buildCohortConfig, createIdentity } from '@btcr2-aggregation/shared';

/**
 * Phase-2 gap capstone (F1c, ADR 042 k-of-n script-path fallback).
 *
 * n-of-n MuSig2 stays the PRIMARY, cheaper, more private spend and the normal
 * outcome; this harness proves the two halves of the fallback contract over the real
 * HTTP surface, no chain, no new dependency:
 *
 *   Leg A (KEY-PATH DEFAULT): with a generous phase-stall window and every co-signer
 *   present, an advertised n-of-n cohort co-signs the optimistic key path and
 *   `signing-complete` reports a 64-byte aggregated signature with `path` `key-path`
 *   (or absent). Activating `autoFallbackOnStall` does NOT change the happy path - the
 *   fallback never fires because nothing stalls.
 *
 *   Leg B (FORCED SIGNING STALL -> SCRIPT-PATH FALLBACK): a fresh service booted with
 *   `autoFallbackOnStall: true` and a SHORT phase-stall window. All n participants
 *   finalize keygen (n-of-n keygen needs all n), then exactly ONE drops the instant it
 *   reaches its first signing event, so the optimistic round can never collect n
 *   contributions and STALLS. The short phase timeout fires DURING signing, the runner
 *   triggers the k-of-n fallback (`fallback-started`), and the remaining k = n-1
 *   participants auto-approve the `fallback-requested` (the participant runner's default
 *   `onApproveSigning`) and sign the script path. `signing-complete` then reports
 *   `path === 'script-path'` instead of the cohort hard-failing.
 *
 * Hermetic by construction: the offline/fixture beacon-tx path (no `live`, no `bitcoin`
 * connection, no esplora, no `LIVE`). On-chain validity is IRRELEVANT here - nothing is
 * broadcast and the fixture prevout is a bare key-path P2TR output - so the proof is the
 * PROTOCOL reaching Complete via the script path (`fallback-started` + a `script-path`
 * result), not a spendable transaction. If the library instead REJECTS a script-path
 * spend over the bare key-path fixture prevout (it would surface as `cohort-failed`),
 * this harness records that as an explicit finding rather than silently passing: it would
 * mean the fixture tx must commit the same fallback tapleaf as the real beacon address.
 *
 * Cohort-driving note: this capstone advertises directly via `runner.advertiseCohort`
 * (the same call the operator route makes internally, D-17) rather than the full
 * login -> create -> advertise dance, because the fallback mechanism, not the auth
 * boundary, is what is under test here (the auth boundary is pinned by e2e/operator).
 */

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

export interface FallbackCohortOptions {
  /** Port to listen on (default 0 = ephemeral loopback). */
  port?: number;
  /** Overall run timeout in ms for each leg's signing (default 30000). */
  timeoutMs?: number;
  /** Suppress progress logging (default false). */
  quiet?: boolean;
}

/** The service `signing-complete` outcome or a `cohort-failed` reason, whichever comes first. */
type LegBOutcome =
  | { readonly ok: true; readonly path?: 'key-path' | 'script-path'; readonly sigLen: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Leg A: the deterministic key-path default. Every co-signer present, a generous stall
 * window, so the optimistic n-of-n round completes and the fallback never fires.
 */
async function runKeyPathLeg(
  options: FallbackCohortOptions,
  log: (msg: string) => void,
  fail: (problem: string) => void,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  // n-of-n with n = 2: minimal deterministic happy path.
  const N = 2;

  // A generous phase-stall window so a slow round never trips the fallback; the point of
  // this leg is that with no stall the outcome is the optimistic key path.
  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(N, 'CASBeacon'),
    autoFallbackOnStall: true,
    phaseTimeoutMs: 30_000,
    cohortTtlMs: 60_000,
  });

  let fallbackFired = false;
  service.runner.on('fallback-started', () => {
    fallbackFired = true;
  });
  let sigLen = -1;
  let resultPath: 'key-path' | 'script-path' | undefined;
  const signingComplete = new Promise<void>((resolve) => {
    service.runner.on('signing-complete', (result) => {
      sigLen = result.signature.length;
      resultPath = result.path;
      resolve();
    });
  });
  service.runner.on('error', (err) => log(`[legA][service] error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`[legA] service listening on ${baseUrl}`);

  const participants: Participant[] = [];
  try {
    // Advertise the n-of-n cohort directly (the operator route's own call, D-17).
    const advert = service.runner.advertiseCohort(buildCohortConfig(N, 'CASBeacon'));
    // Swallow the completion promise's settlement here; the harness observes events.
    advert.completion.catch(() => undefined);
    log(`[legA] advertised n-of-n cohort ${advert.cohortId} (n=${N})`);

    const identities = Array.from({ length: N }, () => createIdentity());
    for (const identity of identities) {
      participants.push(createParticipant({ identity, baseUrl }));
    }
    await Promise.all(participants.map((participant) => participant.start()));
    log(`[legA] ${participants.length} participants started; co-signing the optimistic key path...`);

    await withTimeout(signingComplete, timeoutMs, '[legA] key-path signing');

    if (sigLen !== 64) {
      fail(`[legA] expected a 64-byte aggregated key-path signature, got ${sigLen}`);
    }
    // Absent path is treated as key-path for backward compat (see AggregationResult).
    if (resultPath !== undefined && resultPath !== 'key-path') {
      fail(`[legA] expected the optimistic key path (key-path or absent), got path='${resultPath}'`);
    }
    if (fallbackFired) {
      fail('[legA] the k-of-n fallback fired on the happy path; it must only fire on a signing stall');
    }
    if (
      sigLen === 64 &&
      (resultPath === undefined || resultPath === 'key-path') &&
      !fallbackFired
    ) {
      log(`[legA][ok] deterministic n-of-n key path: 64-byte aggregated signature, no fallback (path='${resultPath ?? 'absent'}')`);
    }
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

/**
 * Leg B: a forced signing-phase stall recovers via the k-of-n script path. All n
 * participants finalize keygen; one drops the instant it reaches signing, so the
 * optimistic round stalls and the short phase timeout triggers the fallback.
 */
async function runScriptPathLeg(
  options: FallbackCohortOptions,
  log: (msg: string) => void,
  fail: (problem: string) => void,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  // n-of-n with n = 3 so the k-of-n fallback (k = n-1 = 2) is a genuine 2-of-3, not a
  // trivial 1-of-1: one participant drops, the remaining two sign the script path.
  const N = 3;
  // Short per-phase stall window: keygen/update/validation phases each complete well
  // under this over in-process loopback, so it only fires once signing stalls (no phase
  // change while the optimistic round waits for the missing nonce). The overall cohort
  // TTL stays generous so the cohort is not killed before the fallback can complete.
  const STALL_MS = 800;

  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(N, 'CASBeacon'),
    autoFallbackOnStall: true,
    phaseTimeoutMs: STALL_MS,
    cohortTtlMs: 60_000,
  });

  let fallbackFired = false;
  service.runner.on('fallback-started', () => {
    fallbackFired = true;
    log('[legB] service emitted fallback-started (optimistic round stalled; falling back to k-of-n)');
  });
  // Race the two terminal service signals: whichever settles first is the leg's outcome.
  const legBOutcome = new Promise<LegBOutcome>((resolve) => {
    service.runner.on('signing-complete', (result) => {
      resolve({ ok: true, path: result.path, sigLen: result.signature.length });
    });
    service.runner.on('cohort-failed', ({ reason }) => {
      resolve({ ok: false, reason });
    });
  });
  service.runner.on('error', (err) => log(`[legB][service] error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`[legB] service listening on ${baseUrl}`);

  const participants: Participant[] = [];
  try {
    const advert = service.runner.advertiseCohort(buildCohortConfig(N, 'CASBeacon'));
    advert.completion.catch(() => undefined);
    log(`[legB] advertised n-of-n cohort ${advert.cohortId} (n=${N}); k-of-n fallback = ${N - 1}-of-${N}`);

    const identities = Array.from({ length: N }, () => createIdentity());
    for (const identity of identities) {
      participants.push(createParticipant({ identity, baseUrl }));
    }

    // The remaining k = N-1 participants (indices 1..N-1) must reach cohort-complete via
    // the fallback; the dropped participant (index 0) never does.
    const survivorsComplete = participants.slice(1).map(
      (participant, i) =>
        new Promise<void>((resolve) => {
          participant.runner.on('cohort-complete', () => {
            log(`[legB] survivor participant ${i + 1} reached cohort-complete via the fallback`);
            resolve();
          });
        }),
    );

    // Force the stall: participant 0 drops the instant it reaches its FIRST signing event.
    // By then keygen + update-submit + validation are already done (signing-requested
    // fires only after those phases), so the n-of-n aggregate key is finalized and every
    // update is collected - only participant 0's signing nonce is withheld, which stalls
    // the optimistic round precisely in the SIGNING phase where autoFallbackOnStall acts.
    // stop() detaches the transport handlers synchronously, so even if the default
    // approve-signing callback resolves it can no longer send the nonce.
    let dropped = false;
    participants[0].runner.on('signing-requested', () => {
      if (dropped) {
        return;
      }
      dropped = true;
      log('[legB] participant 0 dropping on signing-requested to stall the optimistic n-of-n round');
      participants[0].stop();
    });
    participants.forEach((participant, i) => {
      participant.runner.on('cohort-failed', ({ reason }) => log(`[legB][participant ${i}] cohort-failed: ${reason}`));
      participant.runner.on('error', (err) => log(`[legB][participant ${i}] error: ${err.message}`));
    });

    await Promise.all(participants.map((participant) => participant.start()));
    log(`[legB] ${participants.length} participants started; forcing a signing-phase stall...`);

    // Synchronize on the HARD terminal service event (signing-complete or cohort-failed),
    // never a bare timeout - the fallback path must be the thing that settles the cohort.
    const outcome = await withTimeout(legBOutcome, timeoutMs, '[legB] fallback signing');

    if (!outcome.ok) {
      // The library rejected the fallback instead of completing it. Surface it as a
      // finding rather than silently passing (see the header note): on the fixture path
      // this most likely means the bare key-path fixture prevout does not commit the
      // fallback tapleaf, so the fixture tx would need to mirror the real beacon address.
      fail(
        `[legB] cohort FAILED instead of falling back to the script path: ${outcome.reason}. ` +
          'If this is a script-path/prevout rejection, the fixture beacon tx must commit the same ' +
          'ADR 042 fallback tapleaf as the real beacon address (beacon-address.ts) for a hermetic proof.',
      );
      return;
    }
    if (!fallbackFired) {
      fail('[legB] signing completed but the service never emitted fallback-started (the fallback did not drive it)');
    }
    if (outcome.path !== 'script-path') {
      fail(`[legB] expected a script-path fallback result, got path='${outcome.path ?? 'absent'}' (sig length ${outcome.sigLen})`);
    }

    // The remaining k = N-1 participants must complete via the fallback.
    try {
      await withTimeout(Promise.all(survivorsComplete), 15_000, '[legB] survivor completion');
    } catch (err) {
      fail(`[legB] the ${N - 1} surviving participants did not all reach cohort-complete: ${(err as Error).message}`);
    }

    if (fallbackFired && outcome.path === 'script-path') {
      log(`[legB][ok] forced signing stall recovered via the ${N - 1}-of-${N} script-path fallback (path='script-path')`);
    }
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

/**
 * Leg C (OPERATOR-TRIGGERED FALLBACK, SVC-04 / D-01): the same forced signing stall as Leg B, but
 * the fallback is driven by the operator's own `POST /v1/operator/cohorts/:id/finalize` call
 * rather than by the runner's automatic stall timer.
 *
 * The phase-stall window is deliberately LONG (60s, far beyond the leg's own timeout), so if the
 * cohort anchors on the script path it can only be because the operator's gated route drove it.
 * That is the whole point: this leg proves the wrapped verb reaches the real library primitive and
 * genuinely salvages a stall, which no unit spec can show (a hermetic cohort passes through the
 * signing phases in milliseconds, so a spec can only pin the guard, with the library call stubbed
 * out - see `packages/service/tests/lifecycle-routes.spec.ts`).
 *
 * The cohort is created and advertised through the REAL operator routes (not `advertiseCohort`
 * directly, unlike Legs A and B), because `finalizeCohort` only knows cohorts that went through
 * the operator surface. Cookie handling mirrors `e2e/operator-cohort.ts`: Node's fetch has no
 * cookie jar, so the harness captures the `operator_session` Set-Cookie on login and echoes it.
 * `operatorCookieSecure: false` lets it round-trip over plain http on loopback.
 *
 * It also asserts the two REFUSAL semantics against a live service, so the browser can trust the
 * predicate it renders: a pre-signing cohort is answered 409 (never 500, and never with a library
 * string), and an anonymous call is 401.
 */
async function runOperatorFinalizeLeg(
  options: FallbackCohortOptions,
  log: (msg: string) => void,
  fail: (problem: string) => void,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  // n = 3 so the k-of-n fallback (k = n-1 = 2) is a genuine 2-of-3: one participant drops and the
  // remaining two sign the script path.
  const N = 3;
  const OPERATOR_PASSWORD = 'correct-horse-battery-staple';
  // Long enough that the automatic stall timer CANNOT be what drives this leg.
  const NEVER_STALLS_MS = 60_000;

  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(N, 'CASBeacon'),
    // The fallback must be ENABLED (it is what `triggerFallback` commits to, and validateDraft
    // refuses a k < n draft on a service that disabled it) - but with the stall window above it
    // never fires on its own inside this leg.
    autoFallbackOnStall: true,
    phaseTimeoutMs: NEVER_STALLS_MS,
    cohortTtlMs: 120_000,
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
  });

  let fallbackFired = false;
  service.runner.on('fallback-started', () => {
    fallbackFired = true;
    log('[legC] service emitted fallback-started (driven by the operator finalize call)');
  });
  const legCOutcome = new Promise<LegBOutcome>((resolve) => {
    service.runner.on('signing-complete', (result) => {
      resolve({ ok: true, path: result.path, sigLen: result.signature.length });
    });
    service.runner.on('cohort-failed', ({ reason }) => {
      resolve({ ok: false, reason });
    });
  });
  service.runner.on('error', (err) => log(`[legC][service] error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`[legC] service listening on ${baseUrl}`);

  const participants: Participant[] = [];
  try {
    /* ---- Login: capture and echo the operator_session cookie. ---- */
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (loginRes.status !== 200 || !setCookie) {
      fail(`[legC] operator login should be 200 with a session cookie, got ${loginRes.status}`);
      return;
    }
    const cookie = setCookie.split(';')[0];

    /* ---- Create + advertise through the real operator routes (k = n-1). ---- */
    const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ beaconType: 'CASBeacon', size: N, threshold: N - 1 }),
    });
    if (createRes.status !== 201) {
      fail(`[legC] create draft should be 201, got ${createRes.status}`);
      return;
    }
    const draft = (await createRes.json()) as { draftId: string };
    const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (advertiseRes.status !== 200) {
      fail(`[legC] advertise should be 200, got ${advertiseRes.status}`);
      return;
    }
    const cohortId = ((await advertiseRes.json()) as { draftId: string }).draftId;
    log(`[legC] advertised cohort ${cohortId} (n=${N}); k-of-n fallback = ${N - 1}-of-${N}`);

    /* ---- Refusal semantics on a live, PRE-SIGNING cohort (RESEARCH Pitfall 4). ---- */
    const anonymous = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortId}/finalize`, { method: 'POST' });
    await anonymous.text();
    if (anonymous.status !== 401) {
      fail(`[legC] an anonymous finalize should be 401, got ${anonymous.status}`);
    }
    const tooEarly = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortId}/finalize`, {
      method: 'POST',
      headers: { cookie },
    });
    const tooEarlyBody = (await tooEarly.json()) as { error?: string };
    if (tooEarly.status !== 409) {
      fail(`[legC] finalizing a pre-signing cohort should be 409, got ${tooEarly.status}`);
    }
    if (/INVALID_PHASE|startFallbackSigning/i.test(tooEarlyBody.error ?? '')) {
      fail(`[legC] the 409 body leaked the library's own message: ${tooEarlyBody.error}`);
    }
    if (fallbackFired) {
      fail('[legC] a REFUSED finalize must not have committed the fallback path');
    }
    log(`[legC][ok] refusals: anonymous 401, pre-signing 409 ("${tooEarlyBody.error}")`);

    /* ---- Drive the cohort into a stalled signing round. ---- */
    const identities = Array.from({ length: N }, () => createIdentity());
    for (const identity of identities) {
      participants.push(createParticipant({ identity, baseUrl }));
    }
    const survivorsComplete = participants.slice(1).map(
      (participant, i) =>
        new Promise<void>((resolve) => {
          participant.runner.on('cohort-complete', () => {
            log(`[legC] survivor participant ${i + 1} reached cohort-complete via the fallback`);
            resolve();
          });
        }),
    );

    // Participant 0 drops the instant it reaches signing (identical to Leg B), so the optimistic
    // n-of-n round can never collect n contributions and sits in a signing phase. `stalled`
    // resolves at that moment, which is when the cohort first becomes finalizable.
    let dropped = false;
    const stalled = new Promise<void>((resolve) => {
      participants[0].runner.on('signing-requested', () => {
        if (dropped) {
          return;
        }
        dropped = true;
        log('[legC] participant 0 dropping on signing-requested to stall the optimistic n-of-n round');
        participants[0].stop();
        resolve();
      });
    });
    participants.forEach((participant, i) => {
      participant.runner.on('error', (err) => log(`[legC][participant ${i}] error: ${err.message}`));
    });

    await Promise.all(participants.map((participant) => participant.start()));
    await withTimeout(stalled, timeoutMs, '[legC] reaching the stalled signing round');

    /* ---- The operator finalizes NOW, instead of waiting out the (60s) stall timer. ---- */
    const finalizeRes = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortId}/finalize`, {
      method: 'POST',
      headers: { cookie },
    });
    const finalizeBody = await finalizeRes.text();
    if (finalizeRes.status !== 200) {
      fail(`[legC] the operator finalize should be 200 once signing has started, got ${finalizeRes.status} ${finalizeBody}`);
      return;
    }
    log('[legC] operator called POST /v1/operator/cohorts/:id/finalize -> 200');

    const outcome = await withTimeout(legCOutcome, timeoutMs, '[legC] operator-driven fallback signing');
    if (!outcome.ok) {
      fail(`[legC] cohort FAILED instead of anchoring on the operator-driven fallback: ${outcome.reason}`);
      return;
    }
    if (!fallbackFired) {
      fail('[legC] signing completed but the service never emitted fallback-started');
    }
    if (outcome.path !== 'script-path') {
      fail(`[legC] expected a script-path fallback result, got path='${outcome.path ?? 'absent'}'`);
    }
    try {
      await withTimeout(Promise.all(survivorsComplete), 15_000, '[legC] survivor completion');
    } catch (err) {
      fail(`[legC] the ${N - 1} surviving participants did not all reach cohort-complete: ${(err as Error).message}`);
    }

    /* ---- The operator's own action is attributed in the gated activity ring (T-05-03-04). ---- */
    const detailRes = await fetch(`${baseUrl}/v1/operator/cohorts/${cohortId}`, { headers: { cookie } });
    const detail = (await detailRes.json()) as { activity: { text: string }[]; fallback: { used: boolean } };
    const attributed = detail.activity.filter((a) => a.text === 'Operator triggered the k-of-n fallback.');
    if (attributed.length !== 1) {
      fail(
        `[legC] the activity ring should carry exactly ONE operator-finalize entry, got ${attributed.length} ` +
          '(the runner emits fallback-started for the stall timer too, so the actor must be recorded once)',
      );
    }
    if (!detail.fallback.used) {
      fail('[legC] the gated detail read should report the cohort took the k-of-n fallback path');
    }

    if (fallbackFired && outcome.path === 'script-path' && attributed.length === 1) {
      log(
        `[legC][ok] the OPERATOR drove the ${N - 1}-of-${N} script-path fallback through the gated route ` +
          '(the automatic stall timer never fired: its window was 60s)',
      );
    }
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

/**
 * Drive the fallback legs against the hermetic (offline/fixture) path and return the
 * list of problems (empty = pass).
 *
 * `operatorOnly` runs ONLY Leg C (the `e2e:fallback:operator` script), mirroring how
 * `e2e/operator-cohort.ts` dispatches its `--monitor` / `--cancel` legs; the default runs the
 * whole suite, so the `e2e:fallback` gate covers the operator-triggered path too.
 */
export async function runFallbackCohort(
  options: FallbackCohortOptions & { operatorOnly?: boolean } = {},
): Promise<string[]> {
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  if (options.operatorOnly) {
    await runOperatorFinalizeLeg(options, log, fail);
    return problems;
  }

  await runKeyPathLeg(options, log, fail);
  await runScriptPathLeg(options, log, fail);
  await runOperatorFinalizeLeg(options, log, fail);

  return problems;
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  const operatorOnly = process.argv.includes('--operator');
  const problems = await runFallbackCohort({ quiet, operatorOnly });
  if (problems.length > 0) {
    console.error('\nE2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  if (operatorOnly) {
    console.log(
      '\nOPERATOR FALLBACK E2E PASSED: an operator advertised a k-of-n cohort through the gated ' +
        'routes, a co-signer dropped mid-signing, and the operator finalized the stalled round ' +
        'themselves via POST /v1/operator/cohorts/:id/finalize - the cohort anchored on the ADR 042 ' +
        'script path with the automatic stall timer still 60s away, the refusals were honest (401 ' +
        'anonymous, 409 pre-signing with no library string in the body), and the action was ' +
        'attributed exactly once in the gated activity ring (SVC-04, D-01).',
    );
    return 0;
  }
  console.log(
    '\nE2E PASSED: n-of-n MuSig2 stays the deterministic default outcome (Leg A: a 64-byte ' +
      'aggregated key-path signature, no fallback), a forced signing-phase stall recovers ' +
      'via the ADR 042 k-of-n script-path fallback (Leg B: fallback-started + a script-path result) ' +
      'instead of failing the cohort, AND the OPERATOR can drive that same fallback on demand ' +
      'through the gated finalize route instead of waiting out the stall timer (Leg C) - over real ' +
      'HTTP, no chain, no new dependency.',
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
