import { pathToFileURL } from 'node:url';
import { createParticipant } from '@btcr2-aggregation/participant';
import { createService } from '@btcr2-aggregation/service';
import {
  buildCohortConfig,
  createIdentity,
  type BeaconType,
  type Identity,
} from '@btcr2-aggregation/shared';

/** Which off-chain resolution artifact a participant received on `cohort-complete`. */
type CohortArtifact = 'cas' | 'smt' | 'none';

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
  /** Beacon type reported in this participant's `cohort-complete` payload. */
  beaconType: string;
  /** The off-chain artifact carried by `cohort-complete`: CAS map, SMT proof, or none. */
  artifact: CohortArtifact;
}

export interface HeadlessResult {
  /** Beacon type the cohort was configured with. */
  beaconType: BeaconType;
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
  /** Beacon type for the cohort (default CAS). */
  beaconType?: BeaconType;
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

/**
 * Classify the off-chain artifact in a `cohort-complete` payload. CAS cohorts
 * carry the full announcement map; SMT cohorts carry this DID's inclusion proof.
 * Structurally typed so the inferred `CohortCompleteInfo` matches without dragging
 * `@did-btcr2/aggregation` in as a direct e2e dependency.
 */
function deriveArtifact(info: {
  casAnnouncement?: Record<string, string>;
  smtProof?: unknown;
}): CohortArtifact {
  if (info.casAnnouncement) {
    return 'cas';
  }
  if (info.smtProof) {
    return 'smt';
  }
  return 'none';
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
 * Drive a full aggregation cohort (CAS or SMT, per `options.beaconType`) over the
 * real HTTP transport: one service on a real local port and N in-process
 * participants over `HttpClientTransport`, from cohort advert through MuSig2
 * keygen, update submission, validation, and signing, to a 64-byte aggregated
 * Taproot signature. No Bitcoin node and no broadcast (the beacon tx spends a
 * fixture prevout); the cohort still builds the real CAS announcement / SMT tree
 * internally, so each participant receives its true off-chain resolution artifact.
 */
export async function runHeadlessCohort(options: HeadlessOptions = {}): Promise<HeadlessResult> {
  const n = options.participants ?? 2;
  const beaconType: BeaconType = options.beaconType ?? 'CASBeacon';
  const timeoutMs = options.timeoutMs ?? 30000;
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);

  const serviceIdentity = createIdentity();
  const participantIdentities: Identity[] = Array.from({ length: n }, () => createIdentity());
  log(`service ${serviceIdentity.did}`);
  log(`beaconType ${beaconType}`);
  participantIdentities.forEach((id, i) => log(`participant ${i} ${id.did}`));

  const service = createService({
    identity: serviceIdentity,
    config: buildCohortConfig(n, beaconType),
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
    createParticipant({ identity, baseUrl, beaconType }),
  );
  const participantEvents: string[][] = participants.map(() => []);
  // The off-chain artifact each participant receives on `cohort-complete` (CAS
  // map vs SMT proof). Captured from the event payload, not the signing result.
  const participantArtifacts: Array<{ beaconType: string; artifact: CohortArtifact }> =
    participants.map(() => ({ beaconType: '', artifact: 'none' }));
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
        participant.runner.on('cohort-complete', (info) => {
          participantEvents[i].push('cohort-complete');
          participantArtifacts[i] = { beaconType: info.beaconType, artifact: deriveArtifact(info) };
          log(
            `[participant ${i}] cohort-complete ` +
              `(${info.beaconType}, artifact=${participantArtifacts[i].artifact})`,
          );
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
      beaconType,
      signatureLength: result.signature.length,
      hasSignedTx: Boolean(result.signedTx),
      serviceMilestones: orderedFirstOccurrences(serviceEvents, SERVICE_MILESTONES),
      participants: participants.map((_participant, i) => ({
        did: participantIdentities[i].did,
        milestones: orderedFirstOccurrences(participantEvents[i], PARTICIPANT_MILESTONES),
        beaconType: participantArtifacts[i].beaconType,
        artifact: participantArtifacts[i].artifact,
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
  const expectedArtifact: CohortArtifact = result.beaconType === 'SMTBeacon' ? 'smt' : 'cas';
  for (const participant of result.participants) {
    const actual = participant.milestones.join(' -> ');
    if (actual !== expectedParticipant) {
      problems.push(`participant ${participant.did} milestones: expected [${expectedParticipant}], got [${actual}]`);
    }
    if (participant.beaconType !== result.beaconType) {
      problems.push(
        `participant ${participant.did} beaconType: expected ${result.beaconType}, got ${participant.beaconType}`,
      );
    }
    if (participant.artifact !== expectedArtifact) {
      problems.push(
        `participant ${participant.did} artifact: expected ${expectedArtifact} for ${result.beaconType}, got ${participant.artifact}`,
      );
    }
  }
  return problems;
}

async function main(): Promise<number> {
  // `--smt` (or `--beacon=SMTBeacon`) drives an SMT cohort; default is CAS.
  const argv = process.argv.slice(2);
  const beaconType: BeaconType =
    argv.includes('--smt') || argv.includes('--beacon=SMTBeacon') ? 'SMTBeacon' : 'CASBeacon';

  const result = await runHeadlessCohort({ beaconType });
  const problems = checkResult(result);
  if (problems.length > 0) {
    console.error('\nE2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  const label = beaconType === 'SMTBeacon' ? 'SMT' : 'CAS';
  const artifact = beaconType === 'SMTBeacon' ? 'SMT inclusion proof' : 'CAS announcement';
  console.log(
    `\nE2E PASSED: full ${label} cohort -> 64-byte aggregated Taproot signature over real HTTP, ` +
      `each participant received its ${artifact}.`,
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
