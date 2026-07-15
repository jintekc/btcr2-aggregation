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
 * Drive both fallback legs against the hermetic (offline/fixture) path and return the
 * list of problems (empty = pass).
 */
export async function runFallbackCohort(options: FallbackCohortOptions = {}): Promise<string[]> {
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  await runKeyPathLeg(options, log, fail);
  await runScriptPathLeg(options, log, fail);

  return problems;
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  const problems = await runFallbackCohort({ quiet });
  if (problems.length > 0) {
    console.error('\nE2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nE2E PASSED: n-of-n MuSig2 stays the deterministic default outcome (Leg A: a 64-byte ' +
      'aggregated key-path signature, no fallback), AND a forced signing-phase stall now recovers ' +
      'via the ADR 042 k-of-n script-path fallback (Leg B: fallback-started + a script-path result) ' +
      'instead of failing the cohort - over real HTTP, no chain, no new dependency.',
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
