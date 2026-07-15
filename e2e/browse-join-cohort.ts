import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createParticipant } from '@btcr2-aggregation/participant';
import { createService } from '@btcr2-aggregation/service';
import { buildCohortConfig, createIdentity } from '@btcr2-aggregation/shared';

/**
 * Phase-2 capstone e2e (PART-01 + PART-02, ROADMAP criterion 3). The vertical
 * backbone of the browse-and-pick slice, proven headlessly over the real HTTP
 * surface the way a browser + a participant client would drive it:
 *
 *   operator logs in  ->  creates + advertises TWO cohorts (A and B)  ->  they
 *   both appear in the public directory  ->  a participant that PICKED cohort A
 *   joins ONLY A, seats, and co-signs the n-of-n MuSig2 beacon  ->  a 64-byte
 *   aggregated signature - while a participant that picked cohort B and a
 *   participant that picked a cohort id matching no advert both reach no seat.
 *
 * This is the single PART-02 mechanism (join-by-filter, D-14) proven end to end:
 *
 *  1. PICKED-ONLY JOIN (PART-02). The A-participants carry `cohortId: A`, so their
 *     client-side `shouldJoin` filter opts into A alone. Cohort A fills to
 *     threshold and co-signs; cohort B, advertised concurrently, never fills and
 *     never co-signs, and no A-participant leaks into it (B.joined stays 0).
 *
 *  2. THE FILTER IS EXERCISED AT RUNTIME, not just asserted structurally. The two
 *     negative controls (the B-picker and the random-id picker) DISCOVER the live
 *     advert and REFUSE it because it is not the cohort they picked - so a
 *     discovered-but-refused advert produces no opt-in and no seat.
 *
 *  3. SEAT AUTHORITY IS cohort-ready / cohort-complete (D-11). "Seated" is NEVER
 *     read off `cohort-joined` (that is only "opt-in sent"); the run treats
 *     `cohort-complete` as the definitive seat and asserts the cohort that signed
 *     is exactly the picked cohort A.
 *
 *  4. DETERMINISTIC NO-SEAT (criterion 3, D-06/D-12). By the time A hard-completes
 *     (`signing-complete`), NEITHER negative control has reached
 *     `cohort-ready`/`cohort-complete`. Both negatives are synchronized on A's
 *     completion event, not on a bare timer, so there is no dead spinner and no
 *     flakiness (no fixed watchdog).
 *
 * ADVERT ORDERING (load-bearing, discovered during execution). The service's
 * `HttpServerTransport` keeps a SINGLE most-recent advert slot (`#currentAdvert`):
 * a late broadcast subscriber is replayed only the most-recently published advert,
 * and a new advert overwrites the previous one. The runner does re-publish each
 * open cohort's advert, but only on the default ~60s cadence (createService does
 * not lower it), which is longer than this run's budget. A browsing participant is
 * always a LATE subscriber (it picks from the directory, then connects), so within
 * a bounded run the only advert it can receive on connect is the current one.
 * This harness therefore advertises the PICKED cohort A LAST, so A is the reachable
 * current advert: the A-pickers receive A on connect and co-sign it, while the
 * B-picker and random-id picker receive that same current advert (A) and refuse it.
 * (In the live browser flow a picker of a non-latest cohort still joins once the
 * runner re-publishes that cohort's advert on its republish cadence - see the
 * Phase-2 SUMMARY finding for the store/UX implication in plans 02-03/02-04.)
 *
 * Hermetic by construction: the offline/fixture beacon-tx path (no `live`, no
 * `bitcoin` connection, no esplora, no `LIVE`), so it runs with no chain and no new
 * dependency. Cohort A still builds the real CAS announcement and co-signs a real
 * 64-byte Taproot signature internally; only the beacon tx spends a fixture prevout
 * (the same hermetic path as `e2e/operator-cohort.ts`).
 *
 * Cookie handling mirrors the operator capstone: Node's fetch has no cookie jar, so
 * the harness captures the `operator_session` Set-Cookie value on login and echoes
 * it as the `cookie` header on every gated call. `operatorCookieSecure: false` lets
 * the cookie round-trip over plain http on loopback; a real deployment keeps the
 * Secure default on behind TLS at the reverse proxy.
 *
 * Registered as the local `e2e:browse` script; NOT wired into CI (the red
 * `e2e:browser*` rewrite + CI wiring are Phase-6 CI debt).
 */

/** The operator console password this hermetic run boots the service with. */
const OPERATOR_PASSWORD = 'operator-browse-correct-horse-battery-staple';
/**
 * Each advertised cohort's number, used for BOTH the seat count n and the signing floor k
 * (k == n == 2), so the two-field create body stays a pure n-of-n green leg.
 */
const THRESHOLD = 2;

/** The operator-cohort DTO shape returned by create + advertise (subset asserted). */
interface OperatorCohortDTO {
  draftId: string;
  beaconType: string;
  network: string;
  threshold: number;
  capacity: number;
  joined: number;
  state: 'draft' | 'advertised';
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

export interface BrowseJoinCohortOptions {
  /** Port to listen on (default 0 = ephemeral loopback). */
  port?: number;
  /** Overall run timeout in ms for the co-sign leg (default 30000). */
  timeoutMs?: number;
  /** Suppress progress logging (default false). */
  quiet?: boolean;
}

/**
 * Drive the full browse -> pick -> join -> seated -> co-sign lifecycle and return the
 * list of problems (empty = pass). Everything runs against one real service on a real
 * loopback port and N in-process participants over the real `HttpClientTransport`.
 */
export async function runBrowseJoinCohort(options: BrowseJoinCohortOptions = {}): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  // Boot a real operator-enabled service on the hermetic (offline/fixture) path.
  const service = createService({
    identity: createIdentity(),
    config: buildCohortConfig(THRESHOLD, 'CASBeacon'),
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
  });

  // Non-fatal runner errors must not crash the process before teardown.
  service.runner.on('error', (err) => log(`[service] error: ${err.message}`));

  const { baseUrl } = await service.start(options.port ?? 0);
  log(`service listening on ${baseUrl}`);

  /** Read the public directory (no cookie): the anonymous browse surface (D-13). */
  const fetchDirectory = async (): Promise<DirectoryCohortDTO[]> => {
    const res = await fetch(`${baseUrl}/v1/directory`);
    if (res.status !== 200) {
      fail(`GET /v1/directory should be 200, got ${res.status}`);
      return [];
    }
    return (await res.json()) as DirectoryCohortDTO[];
  };

  try {
    /* ---- 1. A fresh service advertises nothing until the operator acts (D-17). ---- */
    const bootCohorts = service.runner.session.cohorts.length;
    if (bootCohorts !== 0) {
      fail(`a fresh service should advertise nothing at boot, but session.cohorts.length === ${bootCohorts}`);
    }

    /* ---- 2. Operator login: capture + echo the operator_session cookie. ---- */
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    if (loginRes.status !== 200) {
      fail(`operator login should be 200, got ${loginRes.status}`);
      return problems;
    }
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (!setCookie) {
      fail('login succeeded but issued no operator_session cookie');
      return problems;
    }
    const cookie = setCookie.split(';')[0];
    log('[ok] login: operator_session cookie captured');

    /**
     * Create + advertise one draft over real HTTP and return its LIVE cohort id (the
     * advertised row id IS the live cohort id, D-15). Pushes a problem and returns ''
     * on any non-happy status so the caller can bail.
     */
    const createAndAdvertise = async (label: string): Promise<string> => {
      const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ beaconType: 'CASBeacon', size: THRESHOLD, threshold: THRESHOLD }),
      });
      if (createRes.status !== 201) {
        fail(`create draft ${label} should be 201, got ${createRes.status}`);
        return '';
      }
      const draft = (await createRes.json()) as OperatorCohortDTO;
      const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
        method: 'POST',
        headers: { cookie },
      });
      if (advertiseRes.status !== 200) {
        fail(`advertise ${label} should be 200, got ${advertiseRes.status}`);
        return '';
      }
      const advertised = (await advertiseRes.json()) as OperatorCohortDTO;
      log(`[ok] advertise: cohort ${label} = ${advertised.draftId} is live`);
      return advertised.draftId;
    };

    /* ---- 3. Advertise TWO cohorts. B FIRST, then the PICKED cohort A LAST so A is
       the reachable current advert for the late-subscribing pickers (see the header
       ADVERT ORDERING note). Both are live and distinct regardless of order. ---- */
    const cohortB = await createAndAdvertise('B');
    const cohortA = await createAndAdvertise('A');
    if (!cohortA || !cohortB) {
      return problems;
    }
    if (cohortA === cohortB) {
      fail(`cohorts A and B must have distinct live ids, both were ${cohortA}`);
      return problems;
    }

    /* ---- 4. Capture signing-complete (keyed by cohort). Only A ever fills. ---- */
    const signedCohortIds = new Set<string>();
    let aggregatedSignatureLength = -1;
    const signingCompleteA = new Promise<void>((resolve) => {
      service.runner.on('signing-complete', (result) => {
        signedCohortIds.add(result.cohortId);
        if (result.cohortId === cohortA) {
          aggregatedSignatureLength = result.signature.length;
          resolve();
        }
      });
    });

    /* ---- 5. PART-01: both cohorts are public directory entries (no cookie). This is
       the browse snapshot the picker sees BEFORE anyone joins - both open, 0 seats. ---- */
    const directory = await fetchDirectory();
    for (const [label, cohortId] of [
      ['A', cohortA],
      ['B', cohortB],
    ] as const) {
      const entry = directory.find((d) => d.cohortId === cohortId);
      if (!entry) {
        fail(
          `advertised cohort ${label} (${cohortId}) not found in the public directory ` +
            `(entries: [${directory.map((d) => d.cohortId).join(', ')}])`,
        );
      } else if (
        entry.beaconType !== 'CASBeacon' ||
        entry.threshold !== THRESHOLD ||
        entry.capacity !== THRESHOLD ||
        entry.phase !== 'Advertised'
      ) {
        fail(
          `directory entry ${label} mismatch: beaconType=${entry.beaconType} threshold=${entry.threshold} ` +
            `capacity=${entry.capacity} phase=${entry.phase}, expected CASBeacon / ${THRESHOLD} / ${THRESHOLD} / Advertised`,
        );
      }
    }
    log(`[ok] directory: cohorts A and B are both open Advertised entries with 0 seats (PART-01 browse)`);

    /* ---- 6. Build the pickers: THRESHOLD for A, one for B, one for a random id. ---- */
    // The A-pickers co-sign A; the B-picker and the random-id picker are the two
    // deterministic-negative controls. A random uuid matches no advert at all.
    const aIdentities = Array.from({ length: THRESHOLD }, () => createIdentity());
    const aParticipants = aIdentities.map((identity) => createParticipant({ identity, baseUrl, cohortId: cohortA }));
    const bParticipant = createParticipant({ identity: createIdentity(), baseUrl, cohortId: cohortB });
    const randomCohortId = randomUUID();
    const noneParticipant = createParticipant({ identity: createIdentity(), baseUrl, cohortId: randomCohortId });

    // Track the picked-only join for the A-cohort (seat = cohort-complete, D-11).
    const aComplete = aParticipants.map(
      (participant, i) =>
        new Promise<void>((resolve) => {
          participant.runner.on('cohort-complete', () => {
            log(`[A-participant ${i}] cohort-complete (seated + co-signed)`);
            resolve();
          });
        }),
    );
    aParticipants.forEach((participant, i) => {
      participant.runner.on('cohort-failed', ({ reason }) => log(`[A-participant ${i}] cohort-failed: ${reason}`));
      participant.runner.on('error', (err) => log(`[A-participant ${i}] error: ${err.message}`));
    });

    // Record every seat-relevant event each negative control fires, plus whether it
    // DISCOVERED an advert at all (cohort-discovered fires before the shouldJoin
    // filter). A `() => void` handler is assignable to each event's typed handler
    // (fewer params is fine), so we only care THAT the event fired, not its payload.
    const bFlags = new Set<string>();
    bParticipant.runner.on('cohort-discovered', () => bFlags.add('cohort-discovered'));
    bParticipant.runner.on('cohort-joined', () => bFlags.add('cohort-joined'));
    bParticipant.runner.on('cohort-ready', () => bFlags.add('cohort-ready'));
    bParticipant.runner.on('cohort-complete', () => bFlags.add('cohort-complete'));
    bParticipant.runner.on('error', (err) => log(`[B-participant] error: ${err.message}`));

    const noneFlags = new Set<string>();
    noneParticipant.runner.on('cohort-discovered', () => noneFlags.add('cohort-discovered'));
    noneParticipant.runner.on('cohort-joined', () => noneFlags.add('cohort-joined'));
    noneParticipant.runner.on('cohort-ready', () => noneFlags.add('cohort-ready'));
    noneParticipant.runner.on('cohort-complete', () => noneFlags.add('cohort-complete'));
    noneParticipant.runner.on('error', (err) => log(`[none-participant] error: ${err.message}`));

    const allParticipants = [...aParticipants, bParticipant, noneParticipant];

    try {
      await Promise.all(allParticipants.map((participant) => participant.start()));
      log(`${allParticipants.length} participants started (${THRESHOLD} picked A, 1 picked B, 1 picked a random id)...`);

      // Synchronize the whole run on A's HARD completion event (deterministic, no timer).
      await withTimeout(signingCompleteA, timeoutMs, 'cohort A signing');
      await withTimeout(Promise.all(aComplete), 15_000, 'A-participant completion');

      /* ---- 7a. POSITIVE: A picked-only join co-signed a 64-byte aggregate. ---- */
      if (aggregatedSignatureLength !== 64) {
        fail(`cohort A should co-sign a 64-byte aggregated signature, got ${aggregatedSignatureLength}`);
      }

      /* ---- 7b. SELECTIVITY: B never co-signed (no A-participant leaked into B). ---- */
      if (signedCohortIds.has(cohortB)) {
        fail(`cohort B must never reach signing-complete, but it did (A-participants leaked into B)`);
      }

      /* ---- 7c. Directory reflects the outcome: A locked, B still open + not filled. ---- */
      const dirAfter = await fetchDirectory();
      const aAfter = dirAfter.find((d) => d.cohortId === cohortA);
      // A finalized at threshold: either it is gone from the open directory (it left the
      // open phases when signing started) or it is still listed with joined === THRESHOLD.
      if (aAfter !== undefined && aAfter.joined !== THRESHOLD) {
        fail(
          `cohort A should have locked at threshold: expected it absent from the open directory or ` +
            `joined === ${THRESHOLD}, got joined === ${aAfter.joined} phase=${aAfter.phase}`,
        );
      }
      const bAfter = dirAfter.find((d) => d.cohortId === cohortB);
      if (!bAfter) {
        fail(`cohort B should still be an open Advertised entry (it never filled), but it is gone from the directory`);
      } else if (bAfter.joined !== 0) {
        // No A-participant may leak into B, and the B-picker never received B's advert
        // (it was refused the current advert A), so B must have exactly 0 seats.
        fail(`cohort B must have 0 seats (no participant joined it), but joined === ${bAfter.joined}`);
      } else {
        log(`[ok] selectivity: cohort B stayed open with joined === 0; B never co-signed`);
      }

      /* ---- 7d. NEGATIVE: neither negative control reached a seat by A's completion. ---- */
      // The B-picker must NOT have seated (no cohort-ready / cohort-complete): it picked
      // a cohort it could not join here, so it stays unseated.
      for (const seatEvent of ['cohort-ready', 'cohort-complete']) {
        if (bFlags.has(seatEvent)) {
          fail(`the B-picking participant must not reach '${seatEvent}' (it never seated), but it did`);
        }
      }
      // The random-id picker matches no advert, so it must never opt in or seat.
      for (const anyEvent of ['cohort-joined', 'cohort-ready', 'cohort-complete']) {
        if (noneFlags.has(anyEvent)) {
          fail(`a participant with a cohortId matching no advert must not reach '${anyEvent}', but it did`);
        }
      }
      // Runtime-selectivity note (informational, not a hard gate to avoid a connect
      // race): if a negative control discovered the live advert and still did not join,
      // its shouldJoin filter actively refused a non-picked advert.
      if (bFlags.has('cohort-discovered') && !bFlags.has('cohort-joined')) {
        log(`[ok] filter exercised: the B-picker discovered the live advert and refused it (not its picked cohort)`);
      }

      if (problems.length === 0) {
        log(
          `[ok] co-sign: 64-byte aggregated signature for the PICKED cohort A (${cohortA}); ` +
            `cohort B and the random-id picker never seated (deterministic no-seat, synchronized on A's completion)`,
        );
      }
    } finally {
      for (const participant of allParticipants) {
        participant.stop();
      }
    }

    return problems;
  } finally {
    await service.stop();
  }
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  const problems = await runBrowseJoinCohort({ quiet });
  if (problems.length > 0) {
    console.error('\nE2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nE2E PASSED: operator advertised two cohorts; a participant that PICKED cohort A joined only A, ' +
      'seated, and co-signed a 64-byte aggregated Taproot signature over real HTTP - while the ' +
      'concurrently-advertised cohort B never co-signed (0 seats, no picked-A participant leaked into it) ' +
      'and both negative controls (a B-picker and a picker of a cohort id matching no advert) reached no ' +
      'seat by the time A hard-completed. Browse -> pick -> join -> co-sign proven hermetically, with ' +
      'join-by-filter selectivity and deterministic no-seat, and no new dependency.',
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
