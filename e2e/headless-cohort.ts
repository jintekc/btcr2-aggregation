import { pathToFileURL } from 'node:url';
import { createParticipant } from '@btcr2-aggregation/participant';
import { createService } from '@btcr2-aggregation/service';
import { buildCohortConfig, createIdentity, type Identity } from '@btcr2-aggregation/shared';

/** Ordered service milestones the cohort must pass through. */
const SERVICE_MILESTONES = [
  'cohort-advertised',
  'opt-in-received',
  'keygen-complete',
  'signing-started',
  'signing-complete',
] as const;

/** Ordered participant milestones each participant must pass through. */
const PARTICIPANT_MILESTONES = [
  'cohort-discovered',
  'cohort-joined',
  'cohort-ready',
  'cohort-complete',
] as const;

export interface ParticipantResult {
  did: string;
  milestones: string[];
}

export interface HeadlessResult {
  /** Length in bytes of the aggregated MuSig2 signature (64 on success). */
  signatureLength: number;
  /** Whether the runner produced a signed transaction. */
  hasSignedTx: boolean;
  /** Service milestones, in first-occurrence order. */
  serviceMilestones: string[];
  /** Per-participant milestones, in first-occurrence order. */
  participants: ParticipantResult[];
}

export interface HeadlessOptions {
  /** Number of participants (default 2). */
  participants?: number;
  /** Port to listen on (default 0 = ephemeral). */
  port?: number;
  /** Overall run timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Suppress progress logging (default false). */
  quiet?: boolean;
}

/** Return the subset of `expected` that occurred, ordered by first occurrence. */
function orderedFirstOccurrences(events: string[], expected: readonly string[]): string[] {
  const firstIndex = new Map<string, number>();
  events.forEach((event, i) => {
    if (!firstIndex.has(event)) {
      firstIndex.set(event, i);
    }
  });
  return expected
    .filter((milestone) => firstIndex.has(milestone))
    .sort((a, b) => (firstIndex.get(a) ?? 0) - (firstIndex.get(b) ?? 0));
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

/**
 * Drive a full CAS aggregation cohort over the real HTTP transport: one service on
 * a real local port and N in-process participants over `HttpClientTransport`, from
 * cohort advert through MuSig2 keygen, update submission, validation, and signing,
 * to a 64-byte aggregated Taproot signature. No Bitcoin node and no broadcast (the
 * beacon tx spends a fixture prevout).
 */
export async function runHeadlessCohort(options: HeadlessOptions = {}): Promise<HeadlessResult> {
  const n = options.participants ?? 2;
  const timeoutMs = options.timeoutMs ?? 30000;
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);

  const serviceIdentity = createIdentity();
  const participantIdentities: Identity[] = Array.from({ length: n }, () => createIdentity());
  log(`service ${serviceIdentity.did}`);
  participantIdentities.forEach((id, i) => log(`participant ${i} ${id.did}`));

  const service = createService({
    identity: serviceIdentity,
    config: buildCohortConfig(n),
  });

  const serviceEvents: string[] = [];
  service.runner.on('cohort-advertised', () => {
    serviceEvents.push('cohort-advertised');
    log('[service] cohort-advertised');
  });
  service.runner.on('opt-in-received', () => serviceEvents.push('opt-in-received'));
  service.runner.on('keygen-complete', ({ beaconAddress }) => {
    serviceEvents.push('keygen-complete');
    log(`[service] keygen-complete, beacon ${beaconAddress}`);
  });
  service.runner.on('signing-started', () => serviceEvents.push('signing-started'));
  service.runner.on('signing-complete', () => {
    serviceEvents.push('signing-complete');
    log('[service] signing-complete');
  });
  service.runner.on('cohort-failed', ({ cohortId, reason }) =>
    log(`[service] cohort-failed ${cohortId}: ${reason}`),
  );
  service.runner.on('error', (err) => log(`[service] error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`service listening on ${baseUrl}`);

  const participants = participantIdentities.map((identity) =>
    createParticipant({ identity, baseUrl }),
  );
  const participantEvents: string[][] = participants.map(() => []);
  // Each participant's `cohort-complete` arrives over its inbox SSE a beat after
  // the service's `signing-complete`, so the run() promise can resolve before the
  // participants finish. Arm a completion promise per participant up front and
  // await them after run() so the final milestone is captured.
  const participantComplete: Array<Promise<void>> = [];
  participants.forEach((participant, i) => {
    participant.runner.on('cohort-discovered', () => participantEvents[i].push('cohort-discovered'));
    participant.runner.on('cohort-joined', () => participantEvents[i].push('cohort-joined'));
    participant.runner.on('cohort-ready', () => participantEvents[i].push('cohort-ready'));
    participantComplete.push(
      new Promise<void>((resolve) => {
        participant.runner.on('cohort-complete', () => {
          participantEvents[i].push('cohort-complete');
          log(`[participant ${i}] cohort-complete`);
          resolve();
        });
      }),
    );
    participant.runner.on('cohort-failed', ({ reason }) =>
      log(`[participant ${i}] cohort-failed: ${reason}`),
    );
    participant.runner.on('error', (err) => log(`[participant ${i}] error: ${err.message}`));
  });

  try {
    await Promise.all(participants.map((participant) => participant.start()));
    log(`${participants.length} participants started; driving cohort...`);

    const result = await withTimeout(service.runner.run(), timeoutMs, 'aggregation run');
    await withTimeout(Promise.all(participantComplete), 15000, 'participant completion');
    log(
      `result: signature ${result.signature.length} bytes, path ${result.path ?? 'key-path'}, ` +
        `signedTx ${result.signedTx ? 'present' : 'absent'}`,
    );

    return {
      signatureLength: result.signature.length,
      hasSignedTx: Boolean(result.signedTx),
      serviceMilestones: orderedFirstOccurrences(serviceEvents, SERVICE_MILESTONES),
      participants: participants.map((_participant, i) => ({
        did: participantIdentities[i].did,
        milestones: orderedFirstOccurrences(participantEvents[i], PARTICIPANT_MILESTONES),
      })),
    };
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

/** Assert the result matches the M1 definition of done. Returns problems (empty = pass). */
function checkResult(result: HeadlessResult): string[] {
  const problems: string[] = [];
  if (result.signatureLength !== 64) {
    problems.push(`expected a 64-byte signature, got ${result.signatureLength}`);
  }
  if (!result.hasSignedTx) {
    problems.push('expected a signed transaction, got none');
  }
  const expectedService = [...SERVICE_MILESTONES].join(' -> ');
  const actualService = result.serviceMilestones.join(' -> ');
  if (actualService !== expectedService) {
    problems.push(`service milestones: expected [${expectedService}], got [${actualService}]`);
  }
  const expectedParticipant = [...PARTICIPANT_MILESTONES].join(' -> ');
  for (const participant of result.participants) {
    const actual = participant.milestones.join(' -> ');
    if (actual !== expectedParticipant) {
      problems.push(`participant ${participant.did} milestones: expected [${expectedParticipant}], got [${actual}]`);
    }
  }
  return problems;
}

async function main(): Promise<number> {
  const result = await runHeadlessCohort();
  const problems = checkResult(result);
  if (problems.length > 0) {
    console.error('\nE2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nE2E PASSED: full CAS cohort -> 64-byte aggregated Taproot signature over real HTTP.',
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
