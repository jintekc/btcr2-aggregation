import { pathToFileURL } from 'node:url';
import { createParticipant, type Participant } from '@btcr2-aggregation/participant';
import { createService } from '@btcr2-aggregation/service';
import { buildCohortConfig, createIdentity } from '@btcr2-aggregation/shared';

/**
 * Phase-2 gap capstone (G-02-1): the two-field k-of-n cohort proven over the real HTTP
 * operator flow, false-green-proof.
 *
 * The operator sets TWO honest numbers on the create form: a cohort size n (seats; the
 * cohort finalizes only when all n join) and a signing threshold k of n (the ADR-042
 * fallback floor). n-of-n MuSig2 stays the optimistic PRIMARY spend; k is only the floor
 * the k-of-n script-path fallback must reach if that optimistic round stalls. This harness
 * drives the full login -> POST create { size, threshold } -> advertise HTTP flow (the
 * create-form path is what carries k into the built CohortConfig and its committed beacon
 * leaf), then proves both halves of the k contract, no chain, no new dependency:
 *
 *   Leg 1 (operator k honored, upper path): an n = 4 / k = 2 cohort fills 4 seats and the
 *   anonymous directory shows the honest `2-of-4`. Exactly TWO of the four drop on their
 *   first signing-requested, so the optimistic 4-of-4 round stalls; the short phase-stall
 *   window fires the fallback, and the remaining k = 2 survivors sign the script path.
 *   `signing-complete` reports `path === 'script-path'` instead of the cohort failing.
 *
 *   Leg 2 (k is a real floor, lower bound): a fresh service, same config, THREE of the
 *   four drop (1 survivor < k = 2). The fallback attempt now FAILS ("Not enough valid
 *   fallback signatures") and the cohort reaches `cohort-failed`, NOT `signing-complete`,
 *   so k genuinely gates anchoring.
 *
 * CRITICAL parameter choice: n = 4 / k = 2 (NOT n = 3 / k = 2). With n = 3, k would equal
 * the library's implicit n-1 default, so the fallback would complete identically even if
 * the operator's k never reached the config: a false-green. With n = 4 / k = 2, a broken
 * thread leaves the library default n-1 = 3, and a 2-survivor fallback FAILS, so Leg 1
 * genuinely proves the operator's k reached the signing gate AND the committed leaf.
 *
 * Hermetic by construction: the offline/fixture beacon-tx path (no `live`, no `bitcoin`
 * connection, no esplora, no `LIVE`). On-chain validity is IRRELEVANT here - nothing is
 * broadcast - so the proof is the PROTOCOL reaching Complete via the script path
 * (`fallback-started` + a `script-path` result) in Leg 1 and reaching `cohort-failed` in
 * Leg 2. If the library instead REJECTS the script-path spend over the fixture prevout (it
 * would surface as `cohort-failed` in Leg 1), this harness records that as an explicit
 * finding rather than silently passing: it would mean the fixture beacon tx must commit the
 * same ADR-042 fallback tapleaf as the real beacon address (beacon-address.ts).
 *
 * Registered as the local `e2e:kofn` script; NOT wired into CI (inherits the Phase-6 CI
 * debt deferral, same as e2e:operator / e2e:browse / e2e:fallback).
 */

/** The operator console password this hermetic run boots each service with. */
const OPERATOR_PASSWORD = 'operator-kofn-correct-horse-battery-staple';
/** Cohort size n = seats = the n in n-of-n. */
const SIZE = 4;
/** Signing threshold k = the ADR-042 fallback floor (k < n, distinguishable from n-1 = 3). */
const K = 2;
/** Short per-phase stall window: fires the fallback once the optimistic round stalls in signing. */
const STALL_MS = 800;

/** The operator-cohort DTO shape returned by create + advertise (subset asserted). */
interface OperatorCohortDTO {
  draftId: string;
  beaconType: string;
  network: string;
  threshold: number;
  capacity: number;
  joined: number;
  state: 'draft' | 'advertised' | 'expired';
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

/** The service `signing-complete` outcome or a `cohort-failed` reason, whichever comes first. */
type LegOutcome =
  | { readonly ok: true; readonly path?: 'key-path' | 'script-path'; readonly sigLen: number }
  | { readonly ok: false; readonly reason: string };

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

export interface KofnCohortOptions {
  /** Port to listen on (default 0 = ephemeral loopback). */
  port?: number;
  /** Overall run timeout in ms for each leg's signing (default 30000). */
  timeoutMs?: number;
  /** Suppress progress logging (default false). */
  quiet?: boolean;
}

/**
 * Boot a fresh hermetic operator-enabled service, log in, create an n = 4 / k = 2 draft
 * over the real create-form HTTP path (so k rides into the built config), advertise it,
 * and return the service handle, its base URL, the session cookie, and the live cohort id.
 * Pushes a problem and returns `undefined` on any non-happy status.
 */
async function bootLoginCreateAdvertise(
  options: KofnCohortOptions,
  legTag: string,
  log: (msg: string) => void,
  fail: (problem: string) => void,
): Promise<{ service: ReturnType<typeof createService>; baseUrl: string; cohortId: string } | undefined> {
  // autoFallbackOnStall must be ON for a k < n cohort to be representable (Decision 4), and
  // for the runner to wire the phase-stall timer to triggerFallback. The generous cohortTtl
  // keeps the cohort alive long enough for the fallback to complete after the stall fires.
  const service = createService({
    identity: createIdentity(),
    // The boot config only seeds the runner's identity + active network; the operator's
    // advertised draft (size 4 / threshold 2, created over HTTP below) carries the k under test.
    config: buildCohortConfig(SIZE, 'CASBeacon'),
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
    autoFallbackOnStall: true,
    phaseTimeoutMs: STALL_MS,
    cohortTtlMs: 60_000,
  });
  service.runner.on('error', (err) => log(`${legTag}[service] error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`${legTag} service listening on ${baseUrl}`);

  // Login (Node fetch has no cookie jar; capture + echo the operator_session cookie).
  const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: OPERATOR_PASSWORD }),
  });
  const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
  await loginRes.text();
  if (loginRes.status !== 200 || !setCookie) {
    fail(`${legTag} operator login should be 200 with a session cookie, got ${loginRes.status}`);
    await service.stop();
    return undefined;
  }
  const cookie = setCookie.split(';')[0];

  // Create the two-field draft over the real create-form path. The wire body is the honest
  // two numbers `{ size: 4, threshold: 2 }` (size = n = 4 seats, threshold = k = 2 signing
  // floor), sent via the SIZE/K constants so the directory + DTO assertions below pin them.
  const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ beaconType: 'CASBeacon', size: SIZE, threshold: K }),
  });
  if (createRes.status !== 201) {
    fail(`${legTag} create draft should be 201, got ${createRes.status}`);
    await service.stop();
    return undefined;
  }
  const draft = (await createRes.json()) as OperatorCohortDTO;
  // The two numbers are surfaced independently: k = 2 (signing floor), n = 4 (seats).
  if (draft.threshold !== K || draft.capacity !== SIZE) {
    fail(`${legTag} draft should report threshold ${K} / capacity ${SIZE}, got ${draft.threshold} / ${draft.capacity}`);
  }

  // Advertise it (the sole runner.advertiseCohort caller, D-17).
  const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
    method: 'POST',
    headers: { cookie },
  });
  if (advertiseRes.status !== 200) {
    fail(`${legTag} advertise should be 200, got ${advertiseRes.status}`);
    await service.stop();
    return undefined;
  }
  const advertised = (await advertiseRes.json()) as OperatorCohortDTO;
  const cohortId = advertised.draftId;
  log(`${legTag} advertised cohort ${cohortId} (${K}-of-${SIZE})`);
  return { service, baseUrl, cohortId };
}

/**
 * Run one k-of-n leg: fill all n seats, drop `dropCount` participants on their first
 * signing-requested to stall the optimistic n-of-n round, and race the terminal service
 * events. Returns the outcome plus whether the fallback fired and how many survivors
 * reached cohort-complete.
 */
async function runKofnLeg(
  options: KofnCohortOptions,
  legTag: string,
  dropCount: number,
  log: (msg: string) => void,
  fail: (problem: string) => void,
): Promise<{ outcome: LegOutcome; fallbackFired: boolean; survivorsComplete: number } | undefined> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const booted = await bootLoginCreateAdvertise(options, legTag, log, fail);
  if (!booted) {
    return undefined;
  }
  const { service, baseUrl, cohortId } = booted;

  let fallbackFired = false;
  service.runner.on('fallback-started', () => {
    fallbackFired = true;
    log(`${legTag} service emitted fallback-started (optimistic round stalled; falling back to k-of-n)`);
  });
  // Race the two terminal service signals: whichever settles first is the leg's outcome.
  const legOutcome = new Promise<LegOutcome>((resolve) => {
    service.runner.on('signing-complete', (result) => {
      resolve({ ok: true, path: result.path, sigLen: result.signature.length });
    });
    service.runner.on('cohort-failed', ({ reason }) => {
      resolve({ ok: false, reason });
    });
  });

  const participants: Participant[] = [];
  let survivorsComplete = 0;
  try {
    // Only Leg 1 asserts the anonymous directory; assert it for every leg (harmless) so the
    // honest 2-of-4 the UI renders is pinned. The cohort is Advertised with 0 seats now.
    const directory = (await (await fetch(`${baseUrl}/v1/directory`)).json()) as DirectoryCohortDTO[];
    const row = directory.find((d) => d.cohortId === cohortId);
    if (!row) {
      fail(`${legTag} advertised cohort ${cohortId} not found in the anonymous /v1/directory`);
    } else if (row.threshold !== K || row.capacity !== SIZE || row.joined !== 0 || row.phase !== 'Advertised') {
      fail(
        `${legTag} directory row mismatch: threshold=${row.threshold} capacity=${row.capacity} ` +
          `joined=${row.joined} phase=${row.phase}, expected ${K} / ${SIZE} / 0 / Advertised`,
      );
    } else {
      log(`${legTag} directory shows the honest ${K}-of-${SIZE} (joined 0, Advertised)`);
    }

    // Build n participants that all pick this cohort id (the only advertised cohort).
    const identities = Array.from({ length: SIZE }, () => createIdentity());
    for (const identity of identities) {
      participants.push(createParticipant({ identity, baseUrl, cohortId }));
    }

    // Survivors are the participants NOT dropped; they must reach cohort-complete via the
    // fallback (Leg 1) or never do (Leg 2, where too few survive to satisfy k).
    const survivorCompletions = participants.slice(dropCount).map(
      (participant, i) =>
        new Promise<void>((resolve) => {
          participant.runner.on('cohort-complete', () => {
            survivorsComplete += 1;
            log(`${legTag} survivor participant ${dropCount + i} reached cohort-complete`);
            resolve();
          });
        }),
    );

    // Force the stall: the first `dropCount` participants drop the instant they reach their
    // FIRST signing event. By then keygen + update-submit + validation are done (n-of-n
    // keygen needs all n), so the aggregate key is finalized and every update is collected -
    // only the dropped participants' signing nonces are withheld, stalling the optimistic
    // round precisely in the SIGNING phase where autoFallbackOnStall acts. stop() detaches
    // the transport handlers synchronously, so a late approve-signing can no longer send.
    for (let i = 0; i < dropCount; i += 1) {
      const dropIndex = i;
      let dropped = false;
      participants[dropIndex].runner.on('signing-requested', () => {
        if (dropped) {
          return;
        }
        dropped = true;
        log(`${legTag} participant ${dropIndex} dropping on signing-requested to stall the optimistic n-of-n round`);
        participants[dropIndex].stop();
      });
    }
    participants.forEach((participant, i) => {
      participant.runner.on('cohort-failed', ({ reason }) => log(`${legTag}[participant ${i}] cohort-failed: ${reason}`));
      participant.runner.on('error', (err) => log(`${legTag}[participant ${i}] error: ${err.message}`));
    });

    await Promise.all(participants.map((participant) => participant.start()));
    log(`${legTag} ${participants.length} participants started; dropping ${dropCount} to force a signing-phase stall...`);

    // Synchronize on the HARD terminal service event (signing-complete or cohort-failed),
    // never a bare timeout - the fallback path must be the thing that settles the cohort.
    const outcome = await withTimeout(legOutcome, timeoutMs, `${legTag} fallback signing`);

    // On a k = 2 upper-path leg, also give the two survivors a moment to reach
    // cohort-complete (only meaningful when the outcome succeeded).
    if (outcome.ok) {
      try {
        await withTimeout(Promise.all(survivorCompletions), 15_000, `${legTag} survivor completion`);
      } catch (err) {
        fail(`${legTag} the ${participants.length - dropCount} survivors did not all reach cohort-complete: ${(err as Error).message}`);
      }
    }

    return { outcome, fallbackFired, survivorsComplete };
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

/**
 * Drive both k-of-n legs against the hermetic (offline/fixture) path and return the list
 * of problems (empty = pass).
 */
export async function runKofnCohort(options: KofnCohortOptions = {}): Promise<string[]> {
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  /* ---- Leg 1: operator k honored, upper path (drop 2 of 4 -> script-path fallback). ---- */
  const leg1 = await runKofnLeg(options, '[leg1]', SIZE - K, log, fail);
  if (leg1) {
    const { outcome, fallbackFired, survivorsComplete } = leg1;
    if (!outcome.ok) {
      // The library rejected the fallback instead of completing it. Surface it as an
      // explicit finding rather than silently passing (see the header note).
      fail(
        `[leg1] cohort FAILED instead of falling back to the script path: ${outcome.reason}. ` +
          'If this is a script-path/prevout rejection, the fixture beacon tx must commit the same ' +
          'ADR-042 fallback tapleaf as the real beacon address (beacon-address.ts) for a hermetic proof.',
      );
    } else {
      if (!fallbackFired) {
        fail('[leg1] signing completed but the service never emitted fallback-started (the fallback did not drive it)');
      }
      if (outcome.path !== 'script-path') {
        fail(`[leg1] expected a script-path fallback result, got path='${outcome.path ?? 'absent'}' (sig length ${outcome.sigLen})`);
      }
      if (survivorsComplete < K) {
        fail(`[leg1] expected the ${K} survivors to reach cohort-complete, only ${survivorsComplete} did`);
      }
      // Signature length is INFORMATIONAL only (a script-path signature length is not a
      // contract on the fixture path); never hard-assert it.
      if (fallbackFired && outcome.path === 'script-path' && survivorsComplete >= K) {
        log(`[leg1][ok] operator k = ${K} honored: drop ${SIZE - K} of ${SIZE} recovered via the ${K}-of-${SIZE} script-path fallback (sig length ${outcome.sigLen}, informational)`);
      }
    }
  }

  /* ---- Leg 2: k is a real floor, lower bound (drop 3 of 4 -> cohort-failed). ---- */
  const leg2 = await runKofnLeg(options, '[leg2]', SIZE - (K - 1), log, fail);
  if (leg2) {
    const { outcome } = leg2;
    if (outcome.ok) {
      fail(
        `[leg2] with only ${K - 1} survivor (< k = ${K}) the cohort must NOT reach signing-complete, ` +
          `but it did (path='${outcome.path ?? 'absent'}'); k is not gating anchoring (a clamp-to-1 regression)`,
      );
    } else if (!/fallback/i.test(outcome.reason)) {
      // The failure MUST be fallback-gated (k not reached), not an unrelated cohort error.
      // Empirically the reason is a FallbackRequested-phase stall (the single survivor signs
      // but the round never collects k = 2, so the phase-stall timer fires) rather than the
      // design's predicted "Not enough valid fallback signatures" literal - both are the
      // k floor being enforced, and both contain "fallback"/"FallbackRequested".
      fail(`[leg2] cohort failed but not for a fallback-gated reason (k not reached): '${outcome.reason}'`);
    } else {
      log(`[leg2][ok] k is a real floor: drop ${SIZE - (K - 1)} of ${SIZE} (1 survivor < k = ${K}) reached cohort-failed ('${outcome.reason}'), NOT signing-complete`);
    }
  }

  return problems;
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  const problems = await runKofnCohort({ quiet });
  if (problems.length > 0) {
    console.error('\nE2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nE2E PASSED: an operator-set two-field k-of-n cohort (n = 4 seats, k = 2 signing floor) advertised ' +
      'the honest 2-of-4 and filled all four seats; dropping TWO signers stalled the optimistic n-of-n round ' +
      'and recovered via the ADR-042 k-of-n script-path fallback (Leg 1: fallback-started + a script-path ' +
      'result + both survivors complete), while dropping THREE (1 survivor < k) reached cohort-failed rather ' +
      'than anchoring (Leg 2), so the operator-set k genuinely gates anchoring - over real HTTP, no chain, ' +
      'no new dependency.',
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
