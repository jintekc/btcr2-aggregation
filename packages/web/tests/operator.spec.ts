import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchCohortDetail,
  type CohortDetailDTO,
  type OperatorCohortsDTO,
  type SettingsSnapshotDTO,
} from '../src/lib/operator';
import {
  useOperator,
  actionFailedWith,
  ACTION_FAILED,
  ADVERTISED_OK,
  ADVERTISE_FAILED,
  EXPORT_FAILED,
  READVERTISED_OK,
  READVERTISE_FAILED,
  SESSION_EXPIRED,
  SETTINGS_SAVED_OK,
  UNREACHABLE,
  type OperatorState,
} from '../src/stores/operator';

/**
 * Hermetic coverage of the monitoring drill-down tracer end (SVC-03, D-16/D-25/D-03):
 * the discriminated `fetchCohortDetail` result, the store's 401-vs-unreachable poll
 * branching, and the SPA-internal drill-down view state. Runs in the root vitest node
 * env like `stores/participant.spec.ts`, stubbing global `fetch` per test. No DOM, no
 * component render: this is the lib + store contract the later drill-down plans build on.
 *
 * NEW spec file lives under `packages/web/tests/` (tests-outside-src convention), so it
 * imports the modules under test via `../src/...`.
 */

const BASE = 'http://svc.test';

const SAMPLE_DETAIL: CohortDetailDTO = {
  exists: true,
  members: [{ did: 'did:example:alice', status: 'seated', since: 1, round: 'seated' }],
  seatsJoined: 1,
  capacity: 3,
  phase: 'CollectingUpdates',
  submissions: [{ did: 'did:example:alice', submitted: false }],
  coSign: { noncesReceived: 0, total: 3, awaitingPartialSigs: false },
  anchor: { enabled: false, state: 'none' },
  fallback: { used: false },
  activity: [],
};

/**
 * A SECOND cohort's detail, visibly different from {@link SAMPLE_DETAIL} in both its seat count
 * and its phase. The two differences are the point: a concurrent-poll assertion comparing two
 * identical documents would pass no matter which one landed.
 */
const OTHER_DETAIL: CohortDetailDTO = {
  ...SAMPLE_DETAIL,
  members: [{ did: 'did:example:bob', status: 'seated', since: 2, round: 'seated' }],
  seatsJoined: 3,
  capacity: 3,
  phase: 'SigningStarted',
  submissions: [{ did: 'did:example:bob', submitted: true }],
};

/**
 * The session-identity fields a live console carries, as a SHAPE rather than as numbers (review
 * WR-11). A seeded round and a round a real `signIn` took are different values, so what the seeded
 * shape pins is the relationship: a signed-in console records the round it is live in, and a
 * signed-out one records no live session at all.
 */
function sessionIdentityShape(state: OperatorState): Record<string, unknown> {
  return {
    auth: state.auth,
    holdsALiveSession: typeof state.liveSessionRound === 'number',
    liveSessionIsTheCurrentRound: state.liveSessionRound === state.sessionRound,
  };
}

/** Reset the operator store to a signed-in, list-view baseline before each test. */
function resetStore(): void {
  useOperator.setState({
    auth: 'logged-in',
    // Seeded to what a real `signIn` produces for a live console (review WR-11): a session that is
    // live records the round it is live in. A seeded live console carrying no live-session round is
    // a console no real path could produce, and it would silently disarm every guard that reads it.
    liveSessionRound: useOperator.getState().sessionRound,
    error: undefined,
    view: { kind: 'list' },
    detail: undefined,
    detailCohortId: undefined,
    detailStale: false,
    lastUpdated: undefined,
    // Cleared too, so a health assertion never inherits a previous test's served mode.
    health: undefined,
    actionError: undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCohortDetail', () => {
  it('returns { kind: "ok", value } on 200', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify(SAMPLE_DETAIL), { status: 200 })),
    );
    const result = await fetchCohortDetail(BASE, 'c1');
    expect(result).toEqual({ kind: 'ok', value: SAMPLE_DETAIL });
  });

  it('returns { kind: "unauthorized" } on 401', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('no', { status: 401 })));
    expect(await fetchCohortDetail(BASE, 'c1')).toEqual({ kind: 'unauthorized' });
  });

  it('returns { kind: "unreachable" } on a thrown network error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')));
    expect(await fetchCohortDetail(BASE, 'c1')).toEqual({ kind: 'unreachable' });
  });

  it('returns { kind: "unreachable" } on a non-401 non-ok status', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('boom', { status: 500 })));
    expect(await fetchCohortDetail(BASE, 'c1')).toEqual({ kind: 'unreachable' });
  });
});

describe('operator store drill-down view state', () => {
  beforeEach(resetStore);

  it('openCohort sets the detail view; closeCohort returns to the list', () => {
    useOperator.getState().openCohort('cohort-1');
    expect(useOperator.getState().view).toEqual({ kind: 'detail', cohortId: 'cohort-1' });
    useOperator.getState().closeCohort();
    expect(useOperator.getState().view).toEqual({ kind: 'list' });
  });
});

describe('operator store pollDetail branching', () => {
  beforeEach(resetStore);

  it('routes a 401 poll to the logged-out state with the session-expired copy (D-16)', async () => {
    useOperator.getState().openCohort('cohort-1');
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('no', { status: 401 })));
    await useOperator.getState().pollDetail(BASE);
    expect(useOperator.getState().auth).toBe('logged-out');
    expect(useOperator.getState().error).toBe(SESSION_EXPIRED);
  });

  it('freezes the last-known detail on an unreachable poll (D-25), never clearing it', async () => {
    useOperator.getState().openCohort('cohort-1');
    // First an ok poll to populate the detail.
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify(SAMPLE_DETAIL), { status: 200 })),
    );
    await useOperator.getState().pollDetail(BASE);
    expect(useOperator.getState().detail).toEqual(SAMPLE_DETAIL);

    // Then an unreachable poll: the detail stays (frozen) and a stale flag is set.
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')));
    await useOperator.getState().pollDetail(BASE);
    expect(useOperator.getState().detail).toEqual(SAMPLE_DETAIL);
    expect(useOperator.getState().detailStale).toBe(true);
    // An unreachable poll does NOT drop the session (distinct from 401).
    expect(useOperator.getState().auth).toBe('logged-in');
  });

  it('stores the fetched detail on an ok poll and clears the stale flag', async () => {
    useOperator.getState().openCohort('cohort-1');
    useOperator.setState({ detailStale: true });
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify(SAMPLE_DETAIL), { status: 200 })),
    );
    await useOperator.getState().pollDetail(BASE);
    expect(useOperator.getState().detail).toEqual(SAMPLE_DETAIL);
    expect(useOperator.getState().detailCohortId).toBe('cohort-1');
    expect(useOperator.getState().detailStale).toBe(false);
    expect(typeof useOperator.getState().lastUpdated).toBe('number');
  });
});

/**
 * The concurrent drill-down poll race (`05-VERIFICATION.md` Gap 1, review CR-1).
 *
 * `pollDetail` reads the open cohort id BEFORE its await and, until this block existed, wrote the
 * answer into the shared `detail` slot afterwards with no re-check. `openCohort` re-points the view
 * and clears `detail`, but nothing cancels or invalidates a request already in flight for the
 * PREVIOUS cohort, so the window is that request's remaining latency (bounded by the client's
 * 8000 ms timeout).
 *
 * The harm is not a cosmetic mis-render. `LifecycleActions` takes the cohort it will ACT on as a
 * prop and reads the data it REASONS about from this store slot, so a late answer about an unfunded
 * cohort A can arm the cheap rung-3 ceremony while one click cancels the funded cohort B on screen.
 *
 * The whole suite covered `pollDetail`'s three answer branches thoroughly, and every one of those
 * rows is load-bearing about what each ANSWER means. What no row did was ask a SECOND question
 * while the first was still in flight, which is why this shipped through a 1169-test gate.
 */
describe('operator store pollDetail concurrency (Gap 1: an answer belongs to ONE cohort)', () => {
  beforeEach(resetStore);

  /** A promise plus its settle handles, so a row controls exactly WHEN an answer lands. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /**
   * Answer PER COHORT rather than globally, so the race is staged deterministically.
   *
   * The request URL is `/v1/operator/cohorts/{id}`, so the stub reads the id back out of it and
   * hands over the promise this row owns. Settle ORDER is the thing under test, so nothing here
   * uses a timer: a timer would turn the row into a race about the test runner instead.
   */
  function stubPerCohort(answers: Record<string, Promise<Response>>): void {
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      const id = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
      const staged = answers[id];
      if (!staged) {
        return Promise.reject(new Error(`no staged answer for cohort ${id}`));
      }
      return staged;
    });
  }

  /** An ok response carrying one cohort's served document. */
  function ok(value: CohortDetailDTO): Response {
    return new Response(JSON.stringify(value), { status: 200 });
  }

  /**
   * The operator's actual sequence: open A, start its poll, navigate to B, settle B, and only
   * THEN let A's late answer arrive. Returns both polls so a row can await them.
   */
  function stageRace(a: Promise<Response>, b: Promise<Response>): { pollA: Promise<void>; pollB: Promise<void> } {
    stubPerCohort({ 'cohort-a': a, 'cohort-b': b });
    useOperator.getState().openCohort('cohort-a');
    const pollA = useOperator.getState().pollDetail(BASE);
    useOperator.getState().openCohort('cohort-b');
    const pollB = useOperator.getState().pollDetail(BASE);
    return { pollA, pollB };
  }

  it('discards a LATE answer about a cohort the operator has already navigated away from', async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    const { pollA, pollB } = stageRace(a.promise, b.promise);

    b.resolve(ok(OTHER_DETAIL));
    await pollB;
    // A's answer lands LAST, which is the whole race.
    a.resolve(ok(SAMPLE_DETAIL));
    await pollA;

    const s = useOperator.getState();
    // Both facts, not just the document: asserting the document alone would pass against an
    // implementation that painted the right data under the wrong cohort's name.
    expect(s.detail).toEqual(OTHER_DETAIL);
    expect(s.detailCohortId).toBe('cohort-b');
    // And it is genuinely the OTHER cohort's document, not a coincidence of identical fixtures.
    expect(s.detail?.seatsJoined).toBe(3);
    expect(s.detail?.phase).toBe('SigningStarted');
  });

  it('does not mark the cohort in view stale when the STALE poll is the one that failed', async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    const { pollA, pollB } = stageRace(a.promise, b.promise);

    // B reads successfully FIRST, so this row cannot pass against a view that was never fresh.
    b.resolve(ok(OTHER_DETAIL));
    await pollB;
    expect(useOperator.getState().detailStale).toBe(false);

    a.reject(new Error('network down'));
    await pollA;

    const s = useOperator.getState();
    // Freshness is a fact about the cohort being WATCHED, never about whichever request failed.
    expect(s.detailStale).toBe(false);
    expect(s.detail).toEqual(OTHER_DETAIL);
    expect(s.detailCohortId).toBe('cohort-b');
  });

  it('STILL expires the session on a stale 401, because an expiry is not cohort-scoped', async () => {
    // The one branch the guard deliberately does not cover. A 401 is true no matter which cohort
    // asked, and deferring it would leave the operator working a dead session for another tick.
    const a = deferred<Response>();
    const b = deferred<Response>();
    const { pollA, pollB } = stageRace(a.promise, b.promise);

    b.resolve(ok(OTHER_DETAIL));
    await pollB;

    a.resolve(new Response('no', { status: 401 }));
    await pollA;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    // The expiry path clears the whole gated slice, provenance included.
    expect(s.detail).toBeUndefined();
    expect(s.detailCohortId).toBeUndefined();
  });

  it('leaves the non-race path unchanged, so the guard did not simply disable the poll', async () => {
    const b = deferred<Response>();
    stubPerCohort({ 'cohort-b': b.promise });
    useOperator.getState().openCohort('cohort-b');
    useOperator.setState({ detailStale: true });
    const poll = useOperator.getState().pollDetail(BASE);
    b.resolve(ok(OTHER_DETAIL));
    await poll;

    const s = useOperator.getState();
    expect(s.detail).toEqual(OTHER_DETAIL);
    expect(s.detailCohortId).toBe('cohort-b');
    expect(s.detailStale).toBe(false);
    expect(typeof s.lastUpdated).toBe('number');
  });
});

/**
 * The provenance is PAIRED with the data it describes (Gap 1, missing item 1).
 *
 * A provenance id that outlives the detail it names is worse than none: it is a stale claim that
 * the next component to read the slot would believe. So every site that clears `detail` clears the
 * provenance in the SAME object literal, and these rows drive the three an operator can reach.
 */
describe('operator store detail provenance clearing (Gap 1)', () => {
  beforeEach(resetStore);

  /** Land a real served detail for `id`, through the shipped poll rather than a hand-set field. */
  async function landDetail(id: string): Promise<void> {
    useOperator.getState().openCohort(id);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(SAMPLE_DETAIL), { status: 200 })));
    await useOperator.getState().pollDetail(BASE);
    expect(useOperator.getState().detailCohortId).toBe(id);
  }

  it('closeCohort drops the detail and its provenance together', async () => {
    await landDetail('cohort-1');
    useOperator.getState().closeCohort();
    expect(useOperator.getState().detail).toBeUndefined();
    expect(useOperator.getState().detailCohortId).toBeUndefined();
  });

  it('openCohort onto a DIFFERENT cohort drops both, so no id outlives its document', async () => {
    await landDetail('cohort-1');
    useOperator.getState().openCohort('cohort-2');
    expect(useOperator.getState().detail).toBeUndefined();
    expect(useOperator.getState().detailCohortId).toBeUndefined();
  });

  it('expireSession drops both with the rest of the gated slice', async () => {
    await landDetail('cohort-1');
    useOperator.getState().expireSession();
    expect(useOperator.getState().detail).toBeUndefined();
    expect(useOperator.getState().detailCohortId).toBeUndefined();
  });

  it('signOut drops both with the rest of the gated slice', async () => {
    await landDetail('cohort-1');
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('ok', { status: 200 })));
    await useOperator.getState().signOut(BASE);
    expect(useOperator.getState().detail).toBeUndefined();
    expect(useOperator.getState().detailCohortId).toBeUndefined();
  });
});

/**
 * Ending a session is ONE act, so the two paths that end one clear ONE list (review IN-11).
 *
 * `expireSession` cleared five fields fewer than `signOut` (`createStatus`, `formError`,
 * `advertiseStatus`, `advertisingId`, `advertiseMessage`), so a failed advertise message from one
 * session rendered on the next session's create form and a green confirmation from one session
 * captioned another session's cohort list. Both surfaces are hidden while logged out, which is why
 * the review files it as info rather than as a leak, but a divergence between two implementations
 * of one act is a defect whose next instance is not predictable from this one.
 *
 * The parity row below is the shape that buys the property: it compares the WHOLE state after each
 * ending path, excluding by NAME exactly the three fields that differ deliberately, so a field
 * added to one path later fails here rather than diverging quietly.
 */
describe('operator store session-ending parity (review IN-11)', () => {
  beforeEach(resetStore);

  /** A served settings snapshot, staged so an expiry has something real to drop. */
  const DIRTY_SETTINGS: SettingsSnapshotDTO = {
    serviceName: { value: 'Previous session service', envDefault: 'Previous session service', changed: false },
    defaultBeaconType: { value: 'CASBeacon', envDefault: 'CASBeacon', changed: false },
    defaultSize: { value: 3, envDefault: 3, changed: false },
    defaultThreshold: { value: 3, envDefault: 3, changed: false },
    defaultDiscoveryWindowMs: { value: 600_000, envDefault: 600_000, changed: false },
    defaultFundingWindowMs: { value: 900_000, envDefault: 900_000, changed: false },
    termsText: { value: 'Previous session terms', envDefault: 'Previous session terms', changed: false },
  };

  /**
   * Every field a session-ending path is expected to clear, staged to a value that is visibly NOT
   * its cleared one. Typed as `Partial<OperatorState>` so a misspelled key is a compile error
   * rather than a silent `undefined` that would make the parity comparison pass by coincidence.
   */
  const DIRTY: Partial<OperatorState> = {
    auth: 'logged-in',
    error: undefined,
    cohorts: [
      {
        draftId: 'draft-1',
        beaconType: 'CASBeacon',
        network: 'regtest',
        threshold: 2,
        capacity: 3,
        joined: 1,
        state: 'advertised',
      },
    ],
    rows: [{ cohortId: 'cohort-1', chip: 'filling', seatsJoined: 1, capacity: 3, phase: 'CollectingUpdates' }],
    metrics: { open: 1, inFlight: 0, anchored: 0, failed: 0 },
    health: { mode: 'live', esploraReachable: true, paused: false },
    defaults: { discoveryWindowMs: 600_000, fundingWindowMs: 900_000 },
    listStale: true,
    createStatus: 'error',
    formError: 'Could not advertise the draft. Try again.',
    editingDraftId: 'draft-1',
    editStatus: 'error',
    editError: 'Cohort size must be at least 1 signer.',
    advertiseStatus: 'error',
    advertisingId: 'draft-1',
    advertiseMessage: 'Advertised.',
    actionError: 'Could not export the record. Try again.',
    pauseBusy: true,
    pauseMessage: 'Advertising paused.',
    pauseError: 'Could not pause advertising. Try again.',
    operatorActions: [{ id: 1, t: 5, level: 'info', text: 'previous session paused advertising' }],
    broadcastBusy: true,
    broadcastError: 'Could not stand broadcasting down. Try again.',
    dismissing: 'cohort-1',
    settings: DIRTY_SETTINGS,
    settingsStatus: 'error',
    settingsError: 'Service name is too long.',
    settingsMessage: 'Settings saved.',
    view: { kind: 'detail', cohortId: 'cohort-1' },
    cancelling: 'cohort-1',
    finalizing: 'cohort-1',
    addingTestPeers: 'cohort-1',
    testPeerError: 'Could not add test peers. Try again.',
    detail: SAMPLE_DETAIL,
    detailCohortId: 'cohort-1',
    detailStale: true,
    lastUpdated: 1234,
  };

  /** Put the console into the same populated, dirty state before each ending path. */
  function stageDirty(): void {
    useOperator.setState(DIRTY);
  }

  /**
   * The whole state minus the three fields the two paths differ on DELIBERATELY: the auth status
   * (identical today, but each path sets its own), the round (each path takes its own next number),
   * and the error copy (undefined for a deliberate sign-out, the session-expired line for an
   * expiry). Excluding by name rather than comparing a hand-listed subset is the point: an
   * unlisted field added to one path later shows up here as a difference.
   */
  function withoutSessionFacts(state: OperatorState): Record<string, unknown> {
    const rest: Record<string, unknown> = { ...state };
    for (const name of ['auth', 'sessionRound', 'error'] satisfies Array<keyof OperatorState>) {
      delete rest[name];
    }
    return rest;
  }

  it('clears the SAME fields whether a session ended by expiry or by deliberate sign-out', async () => {
    stageDirty();
    useOperator.getState().expireSession();
    const afterExpiry = withoutSessionFacts(useOperator.getState());

    stageDirty();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 204 })));
    await useOperator.getState().signOut(BASE);
    const afterSignOut = withoutSessionFacts(useOperator.getState());

    expect(afterExpiry).toEqual(afterSignOut);
  });

  it('drops a create-form error and an advertise confirmation raised under the ENDED session', async () => {
    // Both raised through the SHIPPED paths rather than seeded, so the row names the harm (one
    // session's transient copy rendering on the next session's forms) rather than the mechanism.
    vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/advertise')) {
        return Promise.resolve(new Response(JSON.stringify({ draftId: 'cohort-live' }), { status: 200 }));
      }
      if (url.endsWith('/v1/operator/cohorts') && method === 'POST') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Cohort size must be at least 1 signer.' }), { status: 400 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ cohorts: [] }), { status: 200 }));
    });

    await useOperator.getState().advertise(BASE, 'draft-1');
    await useOperator.getState().submitDraft(BASE, { beaconType: 'CASBeacon', size: 0, threshold: 0 });

    // Staged state confirmed before the act, so the assertions below cannot pass vacuously.
    expect(useOperator.getState().advertiseMessage).toBeDefined();
    expect(useOperator.getState().formError).toBe('Cohort size must be at least 1 signer.');
    expect(useOperator.getState().createStatus).toBe('error');

    useOperator.getState().expireSession();

    const s = useOperator.getState();
    expect(s.advertiseMessage).toBeUndefined();
    expect(s.formError).toBeUndefined();
    expect(s.createStatus).toBe('idle');
  });

  it('drops an in-flight advertise marker, so no row spins under the next session', async () => {
    // The other two of the five. An advertise that is still in flight is the only state in which
    // `advertiseStatus` and `advertisingId` are both set, and starting one clears the create-form
    // error the row above raises, which is why these two are pinned in their own row.
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
    void useOperator.getState().advertise(BASE, 'draft-1');
    expect(useOperator.getState().advertiseStatus).toBe('advertising');
    expect(useOperator.getState().advertisingId).toBe('draft-1');

    useOperator.getState().expireSession();

    const s = useOperator.getState();
    expect(s.advertiseStatus).toBe('idle');
    expect(s.advertisingId).toBeUndefined();
  });
});

/**
 * Review CR-01: the health strip's mode chip must render the SERVED mode, never a client-side
 * constant. A `LIVE=1 BROADCAST=1` service displaying "Hermetic" tells the operator this service
 * does not touch the chain while it broadcasts real Bitcoin transactions. These pin the store leg
 * (the served `monitoring.health` reaching `state.health`); the strip reads that field directly
 * and renders "Checking mode" while it is undefined.
 */
describe('operator store health (served broadcast mode, D-17/D-43)', () => {
  beforeEach(resetStore);

  /** A merged list-read body with an optional `monitoring` sibling. */
  function listBody(monitoring?: Record<string, unknown>): string {
    return JSON.stringify({ cohorts: [], ...(monitoring ? { monitoring } : {}) });
  }

  it('stores the served live mode + esplora reachability from the merged list read', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          listBody({
            rows: [],
            metrics: { open: 0, inFlight: 0, anchored: 0, failed: 0 },
            health: { mode: 'live', esploraReachable: true, paused: false },
          }),
          { status: 200 },
        ),
      ),
    );
    await useOperator.getState().refreshCohorts(BASE);
    expect(useOperator.getState().health).toEqual({ mode: 'live', esploraReachable: true, paused: false });
  });

  it('leaves health undefined when the service serves no health (never presumes hermetic)', async () => {
    // A fail-closed / older service omits `monitoring.health`. The strip must say "Checking mode"
    // rather than default to a mode the service never reported.
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(listBody({ rows: [], metrics: { open: 0, inFlight: 0, anchored: 0, failed: 0 } }), {
          status: 200,
        }),
      ),
    );
    await useOperator.getState().refreshCohorts(BASE);
    expect(useOperator.getState().health).toBeUndefined();
  });

  it('clears the stored mode on a session expiry so the next session re-reads it', async () => {
    useOperator.setState({ health: { mode: 'live', esploraReachable: false, paused: false } });
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('no', { status: 401 })));
    await useOperator.getState().refreshCohorts(BASE);
    expect(useOperator.getState().health).toBeUndefined();
    expect(useOperator.getState().auth).toBe('logged-out');
    expect(useOperator.getState().error).toBe(SESSION_EXPIRED);
  });
});

/**
 * The concurrent LIST-read race (`05-VERIFICATION.md` W5, review WR-01).
 *
 * Round 3 gave `pollDetail` a round guard and left `refreshCohorts` without one, so the list read
 * wrote `cohorts`, `rows`, `metrics`, `health`, `operatorActions`, `defaults` and the freshness pair
 * with no re-check that the session that ASKED is still the session that is running.
 *
 * The window is ordinary, not exotic: `OperatorConsole.tsx` polls the list every 4000 ms and
 * `lib/operator.ts` gives each read an 8000 ms timeout, so two reads are routinely in flight at
 * once. If the fast one 401s and the slow one succeeds, `expireSession` runs first and the late ok
 * write puts the whole gated slice back, including the broadcast-mode chip, which is a claim about
 * whether this service can move money. `signOut` has the identical exposure.
 *
 * `pollDetail` is only INCIDENTALLY immune: `expireSession` sets `view` back to the list, and its
 * cohort-keyed guard rejects on that. Closing the asymmetry is the point of this block.
 */
describe('operator store refreshCohorts concurrency (W5: a list answer belongs to ONE session)', () => {
  beforeEach(resetStore);

  /** A promise plus its settle handles, so a row controls exactly WHEN an answer lands. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /**
   * Answer the list read PER CALL, in staged order, so the settle ORDER is the thing under test
   * rather than a property of the runner. Nothing here uses a timer, for the same reason the
   * drill-down race block above uses none.
   *
   * The logout POST is answered separately so a `signOut` row does not consume a staged list
   * answer, which would silently shift every later read onto the wrong promise. The login POST is
   * answered on the same reasoning (05-34): the ABA rows below sign back IN mid-race, and a login
   * that consumed a staged list answer would move every later read onto the wrong promise in
   * exactly the same way. Its follow-up list read (`signIn` fires one) is NOT special-cased: that
   * read is a real read by the new session and takes the next staged answer like any other.
   */
  function stubListQueue(answers: Array<Promise<Response>>): void {
    let next = 0;
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/operator/logout')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.endsWith('/v1/operator/login')) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      const staged = answers[next];
      next += 1;
      if (!staged) {
        return Promise.reject(new Error(`no staged answer for list read #${next}`));
      }
      return staged;
    });
  }

  /**
   * A visibly non-empty served body: every field the ok branch writes is present and distinct from
   * the cleared post-expiry state, so an assertion cannot pass by coincidence.
   */
  const POPULATED: OperatorCohortsDTO = {
    cohorts: [
      {
        draftId: 'draft-1',
        beaconType: 'CASBeacon',
        network: 'regtest',
        threshold: 2,
        capacity: 3,
        joined: 1,
        state: 'advertised',
      },
    ],
    monitoring: {
      rows: [{ cohortId: 'cohort-1', chip: 'filling', seatsJoined: 1, capacity: 3, phase: 'CollectingUpdates' }],
      metrics: { open: 1, inFlight: 0, anchored: 0, failed: 0 },
      health: { mode: 'live', esploraReachable: true, paused: false },
      operatorActions: [{ id: 1, t: 5, level: 'info', text: 'advertised cohort-1' }],
    },
    defaults: { discoveryWindowMs: 600_000, fundingWindowMs: 900_000 },
  };

  /** An ok list response carrying {@link POPULATED}. */
  function okList(): Response {
    return new Response(JSON.stringify(POPULATED), { status: 200 });
  }

  /**
   * Seed the gated slice `resetStore` does not touch, so each row asserts against emptiness it set
   * for itself rather than emptiness inherited from whatever ran before it.
   */
  function seedEmptySlice(auth: 'logged-in' | 'logged-out'): void {
    useOperator.setState({
      auth,
      // Consistent with the auth it seeds, which is what a real path produces (review WR-11): a
      // signed-in console records the round it is live in, a signed-out one records no live
      // session. Staging fidelity, not an accommodation of the guard.
      liveSessionRound: auth === 'logged-in' ? useOperator.getState().sessionRound : undefined,
      error: undefined,
      cohorts: [],
      rows: [],
      metrics: undefined,
      health: undefined,
      operatorActions: [],
      defaults: undefined,
      listStale: false,
      lastUpdated: undefined,
    });
  }

  /**
   * The reproduced race: two reads started while signed in, the FIRST answering 401 and the SECOND
   * answering ok, settled in that order. Returns both so a row can await them.
   */
  function stageExpiryRace(): { fast: ReturnType<typeof deferred<Response>>; slow: ReturnType<typeof deferred<Response>>; first: Promise<void>; second: Promise<void> } {
    const fast = deferred<Response>();
    const slow = deferred<Response>();
    stubListQueue([fast.promise, slow.promise]);
    seedEmptySlice('logged-in');
    const first = useOperator.getState().refreshCohorts(BASE);
    const second = useOperator.getState().refreshCohorts(BASE);
    return { fast, slow, first, second };
  }

  it('discards a list answer that outlived the session that asked it (fast 401, slow ok)', async () => {
    const { fast, slow, first, second } = stageExpiryRace();

    fast.resolve(new Response('no', { status: 401 }));
    await first;
    expect(useOperator.getState().auth).toBe('logged-out');

    // The slow read's answer lands LAST, which is the whole race.
    slow.resolve(okList());
    await second;

    const s = useOperator.getState();
    // Several fields, not one: a fix that guarded the list and left the health strip writable
    // would repaint the broadcast-mode chip and still pass a single-field assertion.
    expect(s.cohorts).toEqual([]);
    expect(s.rows).toEqual([]);
    expect(s.metrics).toBeUndefined();
    expect(s.health).toBeUndefined();
    expect(s.operatorActions).toEqual([]);
    expect(s.defaults).toBeUndefined();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
  });

  it('leaves the freshness pair exactly as the expiry left it, so no dead session earns a stamp', async () => {
    const { fast, slow, first, second } = stageExpiryRace();

    fast.resolve(new Response('no', { status: 401 }));
    await first;
    expect(useOperator.getState().listStale).toBe(false);
    expect(useOperator.getState().lastUpdated).toBeUndefined();

    slow.resolve(okList());
    await second;

    const s = useOperator.getState();
    // Asserted explicitly rather than inferred from the cleared list: the freshness pair is what
    // the health strip renders, and a stamp the current session never earned is its own lie.
    expect(s.listStale).toBe(false);
    expect(s.lastUpdated).toBeUndefined();
  });

  it('still writes everything a live-session read always wrote, so the guard did not disable the poll', async () => {
    stubListQueue([Promise.resolve(okList())]);
    seedEmptySlice('logged-in');
    // Stale first, so clearing the banner is proven rather than inherited.
    useOperator.setState({ listStale: true });

    await useOperator.getState().refreshCohorts(BASE);

    const s = useOperator.getState();
    expect(s.cohorts).toEqual(POPULATED.cohorts);
    expect(s.rows).toEqual(POPULATED.monitoring?.rows);
    expect(s.metrics).toEqual(POPULATED.monitoring?.metrics);
    expect(s.health).toEqual(POPULATED.monitoring?.health);
    expect(s.operatorActions).toEqual(POPULATED.monitoring?.operatorActions);
    expect(s.defaults).toEqual(POPULATED.defaults);
    expect(s.listStale).toBe(false);
    expect(typeof s.lastUpdated).toBe('number');
  });

  it('discards a list answer that outlived an explicit sign-out, leaving the CLEAN signed-out state', async () => {
    const slow = deferred<Response>();
    stubListQueue([slow.promise]);
    seedEmptySlice('logged-in');

    // A poll issued just before the operator clicks Sign out, still outstanding when the
    // `finally` clause clears the gated slice.
    const read = useOperator.getState().refreshCohorts(BASE);
    await useOperator.getState().signOut(BASE);
    expect(useOperator.getState().auth).toBe('logged-out');

    slow.resolve(okList());
    await read;

    const s = useOperator.getState();
    expect(s.cohorts).toEqual([]);
    expect(s.rows).toEqual([]);
    expect(s.metrics).toBeUndefined();
    expect(s.health).toBeUndefined();
    expect(s.operatorActions).toEqual([]);
    expect(s.defaults).toBeUndefined();
    expect(s.listStale).toBe(false);
    expect(s.lastUpdated).toBeUndefined();
    // The point of the row is that a dead session's answer changes NOTHING, not that it changes
    // something harmless: a deliberate sign-out must not end up wearing the expiry banner.
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBeUndefined();
  });

  it('does not raise the staleness banner when the failed read belongs to a session that has ended', async () => {
    const fresh = deferred<Response>();
    const slow = deferred<Response>();
    const expiring = deferred<Response>();
    stubListQueue([fresh.promise, slow.promise, expiring.promise]);
    seedEmptySlice('logged-in');

    // A successful read FIRST, so this row asserts that a FRESH state stayed fresh rather than
    // that an empty one stayed empty.
    const readFresh = useOperator.getState().refreshCohorts(BASE);
    fresh.resolve(okList());
    await readFresh;
    expect(useOperator.getState().listStale).toBe(false);
    expect(typeof useOperator.getState().lastUpdated).toBe('number');

    const readSlow = useOperator.getState().refreshCohorts(BASE);
    const readExpiring = useOperator.getState().refreshCohorts(BASE);
    expiring.resolve(new Response('no', { status: 401 }));
    await readExpiring;
    expect(useOperator.getState().auth).toBe('logged-out');

    slow.reject(new Error('network down'));
    await readSlow;

    // Freshness is a fact about a list THIS session is watching, never about whichever request
    // happened to fail, so a signed-out console has nothing to be stale about.
    expect(useOperator.getState().listStale).toBe(false);
  });

  it('writes nothing for an answer to a question no live session asked (the pre-await half)', async () => {
    const answer = deferred<Response>();
    stubListQueue([answer.promise]);
    seedEmptySlice('logged-out');

    // A read issued while nobody is signed in: a poll tick the console had not torn down yet.
    const read = useOperator.getState().refreshCohorts(BASE);
    // A NEW session signs in while that answer is still in flight. `signIn` and `probe` both set
    // `auth` synchronously before their own read, so this is the state they leave behind.
    useOperator.setState({ auth: 'logged-in' });
    answer.resolve(okList());
    await read;

    const s = useOperator.getState();
    expect(s.cohorts).toEqual([]);
    expect(s.rows).toEqual([]);
    expect(s.metrics).toBeUndefined();
    expect(s.health).toBeUndefined();
    expect(s.operatorActions).toEqual([]);
    expect(s.defaults).toBeUndefined();
    expect(s.listStale).toBe(false);
    expect(s.lastUpdated).toBeUndefined();
    // The guard refused the WRITE, not the session: the new sign-in is left to read for itself.
    expect(s.auth).toBe('logged-in');
  });

  it('still raises the staleness banner for a LIVE session read that could not reach the service', async () => {
    // The negative control on scope: a guard that over-refused would silently disable the D-25
    // freeze-and-banner path, and every assertion above would still pass.
    const answer = deferred<Response>();
    stubListQueue([answer.promise]);
    seedEmptySlice('logged-in');

    const read = useOperator.getState().refreshCohorts(BASE);
    answer.reject(new Error('network down'));
    await read;

    expect(useOperator.getState().listStale).toBe(true);
    expect(useOperator.getState().auth).toBe('logged-in');
  });

  /**
   * The ABA sequence (review WR-06), which every row above leaves uncovered.
   *
   * Each of the seven rows above ends on a console that is signed OUT, so all seven are satisfied
   * by a guard that only asks "is anyone signed in". The case an ordinary operator hits is the one
   * that RETURNS to the state it left: a session expires, they sign straight back in (a
   * password-manager fill is a second or two, well inside the 4000 ms poll against the 8000 ms
   * client timeout), and the PREVIOUS session's answer lands into the new one. `logged-in` to
   * `logged-out` to `logged-in` is the same string and a different session, so only a comparison
   * on a session IDENTITY can tell the two apart.
   */
  const PASSWORD = 'operator-password';

  /**
   * Stage the ABA race: session A starts a slow read, session A ends (either way it can end), then
   * the operator signs back in as session B. Returns A's still-outstanding read so a row settles it.
   *
   * Session B's own follow-up read (`signIn` fires one) is staged and deliberately left IN FLIGHT:
   * these rows assert about what A's answer does to B, not about what B reads for itself, and a
   * settled B read would write the very fields the assertions are about.
   */
  async function stageSignBackIn(endedBy: 'expiry' | 'sign-out'): Promise<{
    slow: ReturnType<typeof deferred<Response>>;
    slowRead: Promise<void>;
  }> {
    const slow = deferred<Response>();
    const expiring = deferred<Response>();
    const sessionBOwnRead = deferred<Response>();
    stubListQueue(
      endedBy === 'expiry'
        ? [slow.promise, expiring.promise, sessionBOwnRead.promise]
        : [slow.promise, sessionBOwnRead.promise],
    );
    seedEmptySlice('logged-in');

    const slowRead = useOperator.getState().refreshCohorts(BASE);
    if (endedBy === 'expiry') {
      const expiringRead = useOperator.getState().refreshCohorts(BASE);
      expiring.resolve(new Response('no', { status: 401 }));
      await expiringRead;
    } else {
      await useOperator.getState().signOut(BASE);
    }
    expect(useOperator.getState().auth).toBe('logged-out');

    await useOperator.getState().signIn(BASE, PASSWORD);
    expect(useOperator.getState().auth).toBe('logged-in');
    return { slow, slowRead };
  }

  it('discards a list answer from a session that ENDED even though a NEW session is now signed in', async () => {
    const { slow, slowRead } = await stageSignBackIn('expiry');

    // Session A's answer lands into session B, which is the whole race.
    slow.resolve(okList());
    await slowRead;

    const s = useOperator.getState();
    // Several fields, not one: a fix that guarded the list and left the health strip writable would
    // repaint the broadcast-mode chip, which is a claim about whether this service can move money.
    expect(s.cohorts).toEqual([]);
    expect(s.rows).toEqual([]);
    expect(s.metrics).toBeUndefined();
    expect(s.health).toBeUndefined();
    expect(s.operatorActions).toEqual([]);
    expect(s.defaults).toBeUndefined();
    // Asserted LOGGED IN, unlike every row above: the point is that the protection holds while a
    // session is live, not only while none is.
    expect(s.auth).toBe('logged-in');
  });

  it('leaves the new session with no freshness stamp it did not earn (the ABA sequence)', async () => {
    const { slow, slowRead } = await stageSignBackIn('expiry');
    expect(useOperator.getState().lastUpdated).toBeUndefined();

    slow.resolve(okList());
    await slowRead;

    // The freshness pair is what the health strip captions the console with. A stamp earned by a
    // dead session's answer would tell the new operator that another session's data is fresh.
    expect(useOperator.getState().lastUpdated).toBeUndefined();
    expect(useOperator.getState().listStale).toBe(false);
  });

  it('still writes everything for a read issued BY the new session and landing under it', async () => {
    // The anti-vacuity control that matters most here: without it, the two rows above would pass
    // against a guard that simply stopped writing after any sign-in.
    const sessionBOwnRead = deferred<Response>();
    stubListQueue([sessionBOwnRead.promise, Promise.resolve(okList())]);
    seedEmptySlice('logged-out');

    // `signIn` fires its own follow-up read; leave that one in flight so the read under test is
    // unambiguously the one this row issues.
    await useOperator.getState().signIn(BASE, PASSWORD);
    useOperator.setState({ listStale: true });

    await useOperator.getState().refreshCohorts(BASE);

    const s = useOperator.getState();
    expect(s.cohorts).toEqual(POPULATED.cohorts);
    expect(s.rows).toEqual(POPULATED.monitoring?.rows);
    expect(s.metrics).toEqual(POPULATED.monitoring?.metrics);
    expect(s.health).toEqual(POPULATED.monitoring?.health);
    expect(s.operatorActions).toEqual(POPULATED.monitoring?.operatorActions);
    expect(s.defaults).toEqual(POPULATED.defaults);
    expect(s.listStale).toBe(false);
    expect(typeof s.lastUpdated).toBe('number');
  });

  it('discards a list answer that outlived a SIGN-OUT, once a new session has signed back in', async () => {
    // The sign-out half of ABA. Both ways a session can end are now covered against the returning
    // sequence, matching how the rows above cover both against the simple one.
    const { slow, slowRead } = await stageSignBackIn('sign-out');

    slow.resolve(okList());
    await slowRead;

    const s = useOperator.getState();
    expect(s.cohorts).toEqual([]);
    expect(s.rows).toEqual([]);
    expect(s.metrics).toBeUndefined();
    expect(s.health).toBeUndefined();
    expect(s.operatorActions).toEqual([]);
    expect(s.defaults).toBeUndefined();
    expect(s.lastUpdated).toBeUndefined();
    expect(s.listStale).toBe(false);
    // The dead session's answer changed NOTHING, rather than changing something harmless: the new
    // session is left signed in with a clean slate to read for itself.
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
  });

  /**
   * The 401 half of the same ABA sequence (review WR-08).
   *
   * Round 5 made this read discard a dead session's ANSWER and left it acting on a dead session's
   * REFUSAL. The premise is the store's own: the console polls every 4000 ms against an 8000 ms
   * client timeout, so two reads are routinely outstanding. When the session expires server-side
   * BOTH answer 401. The first is correct and ends the session; the operator signs straight back
   * in; the second, issued by a session that is already dead, ends the new one, with a message that
   * is false about a cookie this service would still accept.
   */
  it('discards a 401 issued by a session that ENDED rather than signing the NEW session out (review WR-08)', async () => {
    const { slow, slowRead } = await stageSignBackIn('expiry');
    const round = useOperator.getState().sessionRound;
    // Session B's own gated slice, as its first read would leave it. Asserted field by field after
    // the stale 401 lands, because `expireSession` clears the WHOLE slice on its way out: a row
    // that only checked `auth` would pass against a guard that logged the operator back in while
    // throwing away the drill-down, the log and the served mode.
    useOperator.setState({
      cohorts: POPULATED.cohorts,
      rows: POPULATED.monitoring?.rows ?? [],
      metrics: POPULATED.monitoring?.metrics,
      health: POPULATED.monitoring?.health,
      operatorActions: POPULATED.monitoring?.operatorActions ?? [],
      defaults: POPULATED.defaults,
    });

    // Session A's UNAUTHORIZED answer lands into session B, which is the whole race.
    slow.resolve(new Response('no', { status: 401 }));
    await slowRead;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
    expect(s.sessionRound).toBe(round);
    expect(s.cohorts).toEqual(POPULATED.cohorts);
    expect(s.rows).toEqual(POPULATED.monitoring?.rows);
    expect(s.metrics).toEqual(POPULATED.monitoring?.metrics);
    expect(s.health).toEqual(POPULATED.monitoring?.health);
    expect(s.operatorActions).toEqual(POPULATED.monitoring?.operatorActions);
    expect(s.defaults).toEqual(POPULATED.defaults);
  });

  it('STILL expires the session when the 401 answers the session that is live right now', async () => {
    // The anti-vacuity control on the row above: without it, a guard that simply stopped expiring
    // would satisfy every ABA assertion in this file while leaving a dead session's console
    // rendering as though it were live.
    const answer = deferred<Response>();
    stubListQueue([answer.promise]);
    seedEmptySlice('logged-in');

    const read = useOperator.getState().refreshCohorts(BASE);
    answer.resolve(new Response('no', { status: 401 }));
    await read;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
  });

  it('expires nothing for a 401 landing into a console with no live session at all', async () => {
    // The absent-capture half: a read issued while nobody was signed in has no session to speak
    // about, so its refusal must not match a value a LATER session holds. This is what pins the
    // capture as an identity rather than a defaulted number.
    const answer = deferred<Response>();
    stubListQueue([answer.promise]);
    seedEmptySlice('logged-out');

    const read = useOperator.getState().refreshCohorts(BASE);
    // A new session signs in while that answer is still in flight, exactly as the pre-await row
    // above stages it.
    useOperator.setState({ auth: 'logged-in' });
    answer.resolve(new Response('no', { status: 401 }));
    await read;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
  });

  /**
   * Answer only the AUTH routes, leaving any list read hanging in flight. The coverage rows below
   * are about the round a session start or end takes, not about what that session reads afterwards,
   * and a settled list read would write state those rows have no reason to speak about.
   */
  function stubAuthOnly(options: { session?: number; login?: number }): void {
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/operator/session')) {
        return Promise.resolve(new Response(null, { status: options.session ?? 401 }));
      }
      if (url.endsWith('/v1/operator/login')) {
        return Promise.resolve(new Response(null, { status: options.login ?? 200 }));
      }
      if (url.endsWith('/v1/operator/logout')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return new Promise<Response>(() => {});
    });
  }

  it('starts a new session on a fresh round (the operator signs in)', async () => {
    stubAuthOnly({ login: 200 });
    // Captured immediately before the action and compared against, never against a literal: the
    // rule is that the round MOVES, so these rows survive any change to the initial value.
    const before = useOperator.getState().sessionRound;
    await useOperator.getState().signIn(BASE, PASSWORD);
    expect(useOperator.getState().auth).toBe('logged-in');
    expect(useOperator.getState().sessionRound).not.toBe(before);
  });

  it('starts a returning session on a fresh round (a probe finds a live session)', async () => {
    stubAuthOnly({ session: 200 });
    // Seeded holding NO live session before the probe, which is the case this row has always
    // named: a returning operator arrives at a console that is not signed in, carrying a cookie
    // this service still accepts. A correction to the staging, not an accommodation of the guard -
    // the two assertions below are unchanged.
    seedEmptySlice('logged-out');
    const before = useOperator.getState().sessionRound;
    await useOperator.getState().probe(BASE);
    expect(useOperator.getState().auth).toBe('logged-in');
    expect(useOperator.getState().sessionRound).not.toBe(before);
  });

  it('keeps the round when a probe merely CONFIRMS the session already signed in (review IN-07)', async () => {
    // `OperatorConsole` is mounted conditionally on the operator tab, so every switch away and back
    // re-runs `probe` against the SAME live session. That crosses no session boundary, so retiring
    // the round there would make the field identify a probe EVENT rather than the session its own
    // docstring names, and three guards in this plan compare it.
    stubAuthOnly({ session: 200 });
    seedEmptySlice('logged-in');
    const before = useOperator.getState().sessionRound;
    await useOperator.getState().probe(BASE);
    expect(useOperator.getState().auth).toBe('logged-in');
    expect(useOperator.getState().sessionRound).toBe(before);
  });

  it('lets a list read started before a CONFIRMING probe still write when it lands (review IN-07)', async () => {
    // The observable consequence of the row above. Without the transition condition the probe
    // retires the live session's round, so a read that was in flight across the tab switch is
    // discarded and the console skips one update.
    //
    // The one case this row does not itself cover, recorded here when it was still open: an answer
    // landing INSIDE the probe's own `checking` window, which `refreshCohorts` then discarded
    // because its guard carried a status clause the other three gated reads did not. That clause is
    // gone (review IN-10) and the window is covered by the row directly below, so the observation
    // stands and its caveat no longer does. Nothing in this row's own assertions changed.
    const slow = deferred<Response>();
    const probeOwnRead = deferred<Response>();
    const staged = [slow.promise, probeOwnRead.promise];
    let next = 0;
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/operator/session')) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      const answer = staged[next];
      next += 1;
      return answer ?? Promise.reject(new Error(`no staged answer for list read #${next}`));
    });
    seedEmptySlice('logged-in');

    const read = useOperator.getState().refreshCohorts(BASE);
    // The operator switches away from the operator tab and back, re-mounting the console, which
    // re-runs the probe. The probe's OWN follow-up read is staged and left in flight, so the read
    // under test is unambiguously the one this row issued.
    await useOperator.getState().probe(BASE);
    expect(useOperator.getState().auth).toBe('logged-in');

    slow.resolve(okList());
    await read;

    const s = useOperator.getState();
    expect(s.cohorts).toEqual(POPULATED.cohorts);
    expect(s.rows).toEqual(POPULATED.monitoring?.rows);
    expect(s.metrics).toEqual(POPULATED.monitoring?.metrics);
    expect(s.health).toEqual(POPULATED.monitoring?.health);
    expect(s.operatorActions).toEqual(POPULATED.monitoring?.operatorActions);
    expect(s.defaults).toEqual(POPULATED.defaults);
    expect(typeof s.lastUpdated).toBe('number');
  });

  it('writes an ok list answer that lands INSIDE a confirming probe\'s checking window (review IN-10)', async () => {
    // The window the row above recorded as deliberately left open, closed here rather than carried
    // a second time. It only acquired teeth once the probe stopped bumping the round on a confirming
    // landing (review IN-07): from then on an ok answer landing while a probe was in flight was
    // dropped by THIS read alone and written normally by the drill-down poll and both settings
    // calls, which are fed by the same session and compare the same round.
    const slow = deferred<Response>();
    const probeAnswer = deferred<Response>();
    const probeOwnRead = deferred<Response>();
    const staged = [slow.promise, probeOwnRead.promise];
    let next = 0;
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/operator/session')) {
        return probeAnswer.promise;
      }
      const answer = staged[next];
      next += 1;
      return answer ?? Promise.reject(new Error(`no staged answer for list read #${next}`));
    });
    seedEmptySlice('logged-in');
    const round = useOperator.getState().sessionRound;

    const read = useOperator.getState().refreshCohorts(BASE);
    // The console re-mounts on a tab switch and its probe is still IN FLIGHT, so `auth` reads
    // `checking`: that status is the probe's own first statement, not a fact about the session.
    const probing = useOperator.getState().probe(BASE);
    expect(useOperator.getState().auth).toBe('checking');

    slow.resolve(okList());
    await read;

    const s = useOperator.getState();
    expect(s.cohorts).toEqual(POPULATED.cohorts);
    expect(s.rows).toEqual(POPULATED.monitoring?.rows);
    expect(s.metrics).toEqual(POPULATED.monitoring?.metrics);
    expect(s.health).toEqual(POPULATED.monitoring?.health);
    expect(s.operatorActions).toEqual(POPULATED.monitoring?.operatorActions);
    expect(s.defaults).toEqual(POPULATED.defaults);
    expect(typeof s.lastUpdated).toBe('number');

    // And the probe confirms the SAME session, so no boundary was crossed while the answer landed:
    // the round comparison the guard kept had already proved that.
    probeAnswer.resolve(new Response(null, { status: 200 }));
    await probing;
    expect(useOperator.getState().auth).toBe('logged-in');
    expect(useOperator.getState().sessionRound).toBe(round);
  });

  /**
   * Answer the session probe PER CALL from a staged queue, so a row controls exactly when each of
   * two OVERLAPPING probes lands. Everything else hangs in flight, including the list read each
   * live probe fires: these rows are about the round two probes take between them, not about what
   * they read afterwards.
   */
  function stubProbeQueue(answers: Array<Promise<Response>>): void {
    let next = 0;
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/operator/session')) {
        const staged = answers[next];
        next += 1;
        return staged ?? Promise.reject(new Error(`no staged answer for probe #${next}`));
      }
      if (url.endsWith('/v1/operator/logout')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.endsWith('/v1/operator/login')) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return new Promise<Response>(() => {});
    });
  }

  /** A live answer from the session probe. */
  function liveProbeAnswer(): Response {
    return new Response(null, { status: 200 });
  }

  it('crosses ONE session boundary when two probes OVERLAP on a live session (review WR-11)', async () => {
    // `main.tsx` enables React StrictMode, which double-invokes mount effects in development, so
    // `OperatorConsole`'s mount probe fires twice on every console mount; in a production build a
    // fast tab toggle does the same. The second probe enters while the first is in flight, reads
    // `checking` (the first probe's own first assignment), and concludes no session was live.
    const first = deferred<Response>();
    const second = deferred<Response>();
    stubProbeQueue([first.promise, second.promise]);
    seedEmptySlice('logged-in');
    const before = useOperator.getState().sessionRound;

    const p1 = useOperator.getState().probe(BASE);
    const p2 = useOperator.getState().probe(BASE);
    first.resolve(liveProbeAnswer());
    second.resolve(liveProbeAnswer());
    await Promise.all([p1, p2]);

    expect(useOperator.getState().auth).toBe('logged-in');
    expect(useOperator.getState().sessionRound).toBe(before);
  });

  it('lets a list read started before TWO overlapping probes still write when it lands (review WR-11)', async () => {
    // The observable consequence of the row above, and the assertion the shipped IN-07 row already
    // claims: a read in flight across a tab switch must survive it. Under a double probe the round
    // moved, so the read was discarded and the console skipped an update.
    const slow = deferred<Response>();
    const firstProbe = deferred<Response>();
    const secondProbe = deferred<Response>();
    let nextProbe = 0;
    const probeAnswers = [firstProbe.promise, secondProbe.promise];
    let listAnswered = false;
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/operator/session')) {
        const staged = probeAnswers[nextProbe];
        nextProbe += 1;
        return staged ?? Promise.reject(new Error(`no staged answer for probe #${nextProbe}`));
      }
      if (!listAnswered) {
        listAnswered = true;
        return slow.promise;
      }
      // Each live probe fires its own follow-up list read; leaving those in flight keeps the read
      // under test unambiguously the one this row issued.
      return new Promise<Response>(() => {});
    });
    seedEmptySlice('logged-in');

    const read = useOperator.getState().refreshCohorts(BASE);
    const p1 = useOperator.getState().probe(BASE);
    const p2 = useOperator.getState().probe(BASE);
    firstProbe.resolve(liveProbeAnswer());
    secondProbe.resolve(liveProbeAnswer());
    await Promise.all([p1, p2]);
    expect(useOperator.getState().auth).toBe('logged-in');

    slow.resolve(okList());
    await read;

    const s = useOperator.getState();
    expect(s.cohorts).toEqual(POPULATED.cohorts);
    expect(s.rows).toEqual(POPULATED.monitoring?.rows);
    expect(s.metrics).toEqual(POPULATED.monitoring?.metrics);
    expect(s.health).toEqual(POPULATED.monitoring?.health);
    expect(s.operatorActions).toEqual(POPULATED.monitoring?.operatorActions);
    expect(s.defaults).toEqual(POPULATED.defaults);
    expect(typeof s.lastUpdated).toBe('number');
  });

  it('takes EXACTLY one round when two overlapping probes find a session on a console holding none', async () => {
    // The other half of the property: one session started, so one round was taken. A returning
    // operator must still get a fresh round (the shipped row above), and must not get two.
    const first = deferred<Response>();
    const second = deferred<Response>();
    stubProbeQueue([first.promise, second.promise]);
    seedEmptySlice('logged-out');
    const before = useOperator.getState().sessionRound;

    const p1 = useOperator.getState().probe(BASE);
    const p2 = useOperator.getState().probe(BASE);
    first.resolve(liveProbeAnswer());
    second.resolve(liveProbeAnswer());
    await Promise.all([p1, p2]);

    expect(useOperator.getState().auth).toBe('logged-in');
    expect(useOperator.getState().sessionRound).toBe(before + 1);
  });

  it('narrates a deliberate SIGN-OUT landing mid-probe as a sign-out, never as an expiry', async () => {
    // This row is why the probe decides from a STORED fact rather than from a status snapshot taken
    // before its own first assignment. A snapshot would say a session was live, `signOut` would end
    // it, and the probe landing afterwards would tell the operator their session EXPIRED about a
    // session they themselves just ended. The stored fact has already been cleared by `signOut`, so
    // the probe correctly does nothing.
    const answer = deferred<Response>();
    stubProbeQueue([answer.promise]);
    seedEmptySlice('logged-in');

    const p = useOperator.getState().probe(BASE);
    await useOperator.getState().signOut(BASE);
    answer.resolve(new Response(null, { status: 401 }));
    await p;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBeUndefined();
  });

  it('seeds the same session-identity shape a real signIn produces, so a forgetful seed fails HERE', async () => {
    // The footgun the stored fact buys: three `setState` helpers stage a signed-in console, and a
    // seed that forgot the live-session field would silently disarm every guard that reads it. This
    // row compares the shape rather than the numbers: a seeded round and a real one are different
    // values, and the property is that a live console records the round it is live in.
    stubAuthOnly({ login: 200 });
    await useOperator.getState().signIn(BASE, PASSWORD);
    const real = sessionIdentityShape(useOperator.getState());

    seedEmptySlice('logged-in');
    expect(sessionIdentityShape(useOperator.getState())).toEqual(real);

    resetStore();
    expect(sessionIdentityShape(useOperator.getState())).toEqual(real);

    // Non-vacuity: the shape a signed-out console carries is the OTHER one, so the comparison above
    // is not two copies of the same trivially-true pair.
    seedEmptySlice('logged-out');
    expect(sessionIdentityShape(useOperator.getState())).not.toEqual(real);
  });

  it('retires the round of the session an EXPIRY ended', () => {
    seedEmptySlice('logged-in');
    const before = useOperator.getState().sessionRound;
    useOperator.getState().expireSession();
    expect(useOperator.getState().auth).toBe('logged-out');
    expect(useOperator.getState().sessionRound).not.toBe(before);
  });

  it('retires the round of the session a deliberate SIGN-OUT ended', async () => {
    stubAuthOnly({});
    seedEmptySlice('logged-in');
    const before = useOperator.getState().sessionRound;
    await useOperator.getState().signOut(BASE);
    expect(useOperator.getState().auth).toBe('logged-out');
    expect(useOperator.getState().sessionRound).not.toBe(before);
  });

  it('takes no round where no session becomes live (throttled, disabled and rejected sign-ins, and a probe that finds none)', async () => {
    // The landed code bumps ONLY where a session becomes live, and this row is what keeps it that
    // way. A bump placed one branch too wide would retire a round no session ever held: harmless
    // today, and exactly the kind of thing that becomes load-bearing once a second guard compares
    // a round without also checking the status.
    for (const login of [429, 404, 401]) {
      stubAuthOnly({ login });
      const before = useOperator.getState().sessionRound;
      await useOperator.getState().signIn(BASE, PASSWORD);
      expect(useOperator.getState().auth).not.toBe('logged-in');
      expect(useOperator.getState().sessionRound).toBe(before);
    }
    for (const session of [401, 404]) {
      stubAuthOnly({ session });
      const before = useOperator.getState().sessionRound;
      await useOperator.getState().probe(BASE);
      expect(useOperator.getState().auth).not.toBe('logged-in');
      expect(useOperator.getState().sessionRound).toBe(before);
    }
  });

  it('still raises the staleness banner for a read the NEW session issued and could not complete', async () => {
    // The scope control on the strengthened guard: it must refuse answers from a session that has
    // ENDED and nothing else. An over-refusing guard would silently disable the D-25 banner for
    // every session that signed in after another one ended, and every ABA row above would still
    // pass.
    const sessionBOwnRead = deferred<Response>();
    const failing = deferred<Response>();
    stubListQueue([sessionBOwnRead.promise, failing.promise]);
    seedEmptySlice('logged-out');

    await useOperator.getState().signIn(BASE, PASSWORD);
    const read = useOperator.getState().refreshCohorts(BASE);
    failing.reject(new Error('network down'));
    await read;

    expect(useOperator.getState().listStale).toBe(true);
    expect(useOperator.getState().auth).toBe('logged-in');
  });
});

/**
 * The session-identity rule applied to the OTHER gated reads (review WR-08 and WR-09).
 *
 * `sessionRound`'s docstring states the rule as general law, and round 5 applied it to
 * `refreshCohorts` alone. `pollDetail` compared the cohort and nothing else, so a dead session's
 * drill-down document repainted into a live session that reopened the same cohort id, carrying
 * member DIDs and pubkeys, raw signed updates, the funding view and a freshness stamp the new
 * session never earned. `loadSettings` and `saveSettings` compared nothing at all, and the settings
 * write is not transient: `OperatorConsole` re-reads settings only while the snapshot is undefined,
 * so a dead session's answer landing in that gap makes the new session skip its own read and open
 * the create form on a previous session's defaults.
 *
 * These rows live here, beside the other session rows, rather than in `settings.spec.ts`, which
 * owns the settings SURFACE and its copy. The store's session discipline belongs with the store.
 */
describe('operator store session identity across every gated read (review WR-08/WR-09)', () => {
  beforeEach(resetStore);

  const PASSWORD = 'operator-password';

  /**
   * Session A's settings snapshot, visibly distinct in every field a caption reads, so a row cannot
   * pass because two fixtures happened to agree. `droppedSeeds` is included deliberately: it is
   * boot provenance about the operator's own environment, and round 5 widened this slice to carry
   * it across the same boundary.
   */
  const SESSION_A_SETTINGS: SettingsSnapshotDTO = {
    serviceName: { value: 'Session A Aggregation', envDefault: 'Session A Aggregation', changed: false },
    defaultBeaconType: { value: 'SMTBeacon', envDefault: 'SMTBeacon', changed: false },
    defaultSize: { value: 9, envDefault: 9, changed: false },
    defaultThreshold: { value: 9, envDefault: 9, changed: false },
    defaultDiscoveryWindowMs: { value: 600_000, envDefault: 600_000, changed: false },
    defaultFundingWindowMs: { value: 900_000, envDefault: 900_000, changed: false },
    termsText: { value: 'Session A terms', envDefault: 'Session A terms', changed: false },
    droppedSeeds: ['TERMS_TEXT'],
  };

  /** A promise plus its settle handles, so a row controls exactly WHEN an answer lands. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /**
   * Route by URL rather than by call order, because these rows drive TWO different gated reads plus
   * the auth routes in one sequence. Anything unstaged hangs in flight: the LIST read in particular
   * (the console's poll, and the one `signIn` fires for the new session) would otherwise write the
   * very fields some of these rows assert on.
   */
  function stubGated(options: { detail?: Record<string, Promise<Response>>; settings?: Array<Promise<Response>> }): void {
    let nextSettings = 0;
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/operator/login')) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (url.endsWith('/v1/operator/logout')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.endsWith('/v1/operator/settings')) {
        const staged = options.settings?.[nextSettings];
        nextSettings += 1;
        return staged ?? new Promise<Response>(() => {});
      }
      if (url.includes('/v1/operator/cohorts/')) {
        const id = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
        return options.detail?.[id] ?? Promise.reject(new Error(`no staged answer for cohort ${id}`));
      }
      return new Promise<Response>(() => {});
    });
  }

  /** A live session holding no settings snapshot, which is where the console's shell latch starts. */
  function seedLive(): void {
    useOperator.setState({
      auth: 'logged-in',
      // What a real `signIn` produces for a live console (review WR-11): the round it is live in.
      liveSessionRound: useOperator.getState().sessionRound,
      error: undefined,
      settings: undefined,
      settingsStatus: 'idle',
      settingsError: undefined,
      settingsMessage: undefined,
    });
  }

  /** An ok response carrying one cohort's served document. */
  function okDetail(value: CohortDetailDTO): Response {
    return new Response(JSON.stringify(value), { status: 200 });
  }

  /** End session A and sign session B in, which is the ABA sequence every row below stages. */
  async function signBackIn(): Promise<void> {
    useOperator.getState().expireSession();
    await useOperator.getState().signIn(BASE, PASSWORD);
    expect(useOperator.getState().auth).toBe('logged-in');
  }

  it('pollDetail discards a 401 issued by an ENDED session rather than signing the NEW session out', async () => {
    const a = deferred<Response>();
    stubGated({ detail: { 'cohort-x': a.promise } });
    seedLive();
    useOperator.getState().openCohort('cohort-x');
    const poll = useOperator.getState().pollDetail(BASE);

    await signBackIn();
    useOperator.getState().openCohort('cohort-x');
    const round = useOperator.getState().sessionRound;

    a.resolve(new Response('no', { status: 401 }));
    await poll;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
    expect(s.sessionRound).toBe(round);
    // The expiry path sends the console back to the list, so the drill-down the new session opened
    // is part of what a stale refusal would have taken with it.
    expect(s.view).toEqual({ kind: 'detail', cohortId: 'cohort-x' });
  });

  it('pollDetail STILL expires the session when the 401 answers the session that is live right now', async () => {
    // The anti-vacuity control: a guard that stopped expiring altogether would satisfy the row
    // above and leave a dead session's drill-down on screen.
    const a = deferred<Response>();
    stubGated({ detail: { 'cohort-x': a.promise } });
    seedLive();
    useOperator.getState().openCohort('cohort-x');
    const poll = useOperator.getState().pollDetail(BASE);

    a.resolve(new Response('no', { status: 401 }));
    await poll;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    expect(s.view).toEqual({ kind: 'list' });
  });

  it('loadSettings discards a 401 issued by an ENDED session', async () => {
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const read = useOperator.getState().loadSettings(BASE);

    await signBackIn();
    const round = useOperator.getState().sessionRound;

    a.resolve(new Response('no', { status: 401 }));
    await read;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
    expect(s.sessionRound).toBe(round);
  });

  it('loadSettings STILL expires the session when the 401 answers the live session', async () => {
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const read = useOperator.getState().loadSettings(BASE);

    a.resolve(new Response('no', { status: 401 }));
    await read;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
  });

  it('saveSettings discards a 401 issued by an ENDED session', async () => {
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const save = useOperator.getState().saveSettings(BASE, { serviceName: 'Renamed by session A' });

    await signBackIn();
    const round = useOperator.getState().sessionRound;

    a.resolve(new Response('', { status: 401 }));
    await save;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
    expect(s.sessionRound).toBe(round);
  });

  it('saveSettings STILL expires the session when the 401 answers the live session', async () => {
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const save = useOperator.getState().saveSettings(BASE, { serviceName: 'Renamed' });

    a.resolve(new Response('', { status: 401 }));
    await save;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
  });

  it('pollDetail refuses a document from an ENDED session even when the new session REOPENS the same cohort', async () => {
    // The cohort guard alone cannot see this: the operator reopens the cohort they were already
    // watching, so the id matches and the answer paints. What lands is member DIDs and pubkeys, raw
    // signed updates, co-sign progress and the funding view, from a session that has ended.
    const a = deferred<Response>();
    stubGated({ detail: { 'cohort-x': a.promise } });
    seedLive();
    useOperator.getState().openCohort('cohort-x');
    const poll = useOperator.getState().pollDetail(BASE);

    await signBackIn();
    useOperator.getState().openCohort('cohort-x');

    a.resolve(okDetail(OTHER_DETAIL));
    await poll;

    const s = useOperator.getState();
    expect(s.detail).toBeUndefined();
    expect(s.detailCohortId).toBeUndefined();
    // The freshness stamp is refused with the body: it is the drill-down's own clock, and a stamp
    // the new session never earned captions another session's data as fresh.
    expect(s.lastUpdated).toBeUndefined();
    expect(s.detailStale).toBe(false);
  });

  it('pollDetail STILL paints a same-session answer about the open cohort', async () => {
    // The anti-vacuity control beside the row above, paired with it rather than grouped at the end.
    const a = deferred<Response>();
    stubGated({ detail: { 'cohort-x': a.promise } });
    seedLive();
    useOperator.getState().openCohort('cohort-x');
    useOperator.setState({ detailStale: true });
    const poll = useOperator.getState().pollDetail(BASE);

    a.resolve(okDetail(OTHER_DETAIL));
    await poll;

    const s = useOperator.getState();
    expect(s.detail).toEqual(OTHER_DETAIL);
    expect(s.detailCohortId).toBe('cohort-x');
    expect(s.detailStale).toBe(false);
    expect(typeof s.lastUpdated).toBe('number');
  });

  it('pollDetail STILL freezes and flags a same-session unreachable read', async () => {
    // The second half of the control: a guard that over-refused would silently disable the D-25
    // freeze-and-banner path for the drill-down, and every refusal row above would still pass.
    const first = deferred<Response>();
    const second = deferred<Response>();
    stubGated({ detail: { 'cohort-x': first.promise } });
    seedLive();
    useOperator.getState().openCohort('cohort-x');
    const ok = useOperator.getState().pollDetail(BASE);
    first.resolve(okDetail(OTHER_DETAIL));
    await ok;

    stubGated({ detail: { 'cohort-x': second.promise } });
    const failing = useOperator.getState().pollDetail(BASE);
    second.reject(new Error('network down'));
    await failing;

    const s = useOperator.getState();
    expect(s.detailStale).toBe(true);
    expect(s.detail).toEqual(OTHER_DETAIL);
    expect(s.auth).toBe('logged-in');
  });

  it('loadSettings refuses a snapshot from an ENDED session, leaving the shell free to re-read', async () => {
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const read = useOperator.getState().loadSettings(BASE);

    await signBackIn();

    a.resolve(new Response(JSON.stringify(SESSION_A_SETTINGS), { status: 200 }));
    await read;

    const s = useOperator.getState();
    expect(s.settings).toBeUndefined();
    // The shell's own once-per-session condition (`OperatorConsole.tsx:65-69`), computed here rather
    // than described. That effect re-reads settings only while the snapshot is undefined, so a dead
    // session's answer landing in the gap made the new session skip its own read entirely and open
    // the create form on a previous session's defaults. Asserting the boolean pins the latch
    // without a DOM, and without editing the component, which is correct as written.
    expect(s.auth === 'logged-in' && s.settings === undefined).toBe(true);
  });

  it('loadSettings STILL populates the snapshot for the session that asked', async () => {
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const read = useOperator.getState().loadSettings(BASE);

    a.resolve(new Response(JSON.stringify(SESSION_A_SETTINGS), { status: 200 }));
    await read;

    const s = useOperator.getState();
    expect(s.settings).toEqual(SESSION_A_SETTINGS);
    expect(s.settingsStatus).toBe('idle');
    expect(s.settingsError).toBeUndefined();
  });

  it('loadSettings STILL shows the unreachable posture for the session that asked', async () => {
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const read = useOperator.getState().loadSettings(BASE);

    a.reject(new Error('network down'));
    await read;

    const s = useOperator.getState();
    expect(s.settingsStatus).toBe('error');
    // The shipped unreachable copy, matched on its own words rather than through a new export: this
    // plan adds no exported symbol.
    expect(s.settingsError).toContain('Could not reach the service');
    expect(s.auth).toBe('logged-in');
  });

  it('saveSettings refuses a served snapshot from an ENDED session', async () => {
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const save = useOperator.getState().saveSettings(BASE, { serviceName: 'Session A rename' });

    await signBackIn();

    a.resolve(new Response(JSON.stringify(SESSION_A_SETTINGS), { status: 200 }));
    await save;

    const s = useOperator.getState();
    expect(s.settings).toBeUndefined();
    expect(s.settingsMessage).toBeUndefined();
    expect(s.settingsError).toBeUndefined();
  });

  it('saveSettings refuses a REJECTION aimed at an ended session, so no error lands in a console that never saved', async () => {
    // The rejection branch writes too, and a service's 400 about a value the previous operator
    // typed is a message the new one cannot act on.
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const save = useOperator.getState().saveSettings(BASE, { serviceName: '' });

    await signBackIn();

    a.resolve(new Response(JSON.stringify({ error: 'Cohort size must be at least 1 signer.' }), { status: 400 }));
    await save;

    const s = useOperator.getState();
    expect(s.settingsError).toBeUndefined();
    expect(s.settingsStatus).toBe('idle');
  });

  it('saveSettings STILL writes the served snapshot and the saved message for the session that saved', async () => {
    const a = deferred<Response>();
    stubGated({ settings: [a.promise] });
    seedLive();
    const save = useOperator.getState().saveSettings(BASE, { serviceName: 'Session A rename' });

    a.resolve(new Response(JSON.stringify(SESSION_A_SETTINGS), { status: 200 }));
    await save;

    const s = useOperator.getState();
    expect(s.settings).toEqual(SESSION_A_SETTINGS);
    expect(s.settingsMessage).toBe(SETTINGS_SAVED_OK);
    expect(s.settingsStatus).toBe('idle');
  });
});

/**
 * A probe that DISCOVERS a session has ended must END it (review CR-03).
 *
 * `OperatorConsole` is mounted conditionally on the operator tab, so switching away and back
 * re-runs `probe`. If the cookie expired while the operator was on the participant tab, where
 * nothing polls and so no 401 is ever seen, the probe is what discovers it, and the discovery used
 * to set a status string and nothing else. The next sign-in then opened on the previous session's
 * cohort list, served health chip, operator-actions log and drill-down document (member DIDs,
 * pubkeys, raw signed updates, the funding view), and the console shell's once-per-session settings
 * latch never re-read at all, so the create form ran on a previous session's defaults indefinitely.
 *
 * Every row here drives the SHIPPED paths into a populated state rather than seeding fields, so
 * what is asserted cleared is state a real session really accumulated.
 */
describe('operator store probe-discovered session end (review CR-03)', () => {
  beforeEach(resetStore);

  const PASSWORD = 'operator-password';

  /** The settings snapshot the populated session reads, distinct from every other fixture here. */
  const STAGED_SETTINGS: SettingsSnapshotDTO = {
    serviceName: { value: 'Ended session service', envDefault: 'Ended session service', changed: false },
    defaultBeaconType: { value: 'SMTBeacon', envDefault: 'SMTBeacon', changed: false },
    defaultSize: { value: 4, envDefault: 4, changed: false },
    defaultThreshold: { value: 4, envDefault: 4, changed: false },
    defaultDiscoveryWindowMs: { value: 600_000, envDefault: 600_000, changed: false },
    defaultFundingWindowMs: { value: 900_000, envDefault: 900_000, changed: false },
    termsText: { value: 'Ended session terms', envDefault: 'Ended session terms', changed: false },
  };

  /** A visibly non-empty list body, so every cleared field is proven cleared rather than absent. */
  const STAGED_LIST = {
    cohorts: [
      {
        draftId: 'draft-1',
        beaconType: 'CASBeacon',
        network: 'regtest',
        threshold: 2,
        capacity: 3,
        joined: 1,
        state: 'advertised',
      },
    ],
    monitoring: {
      rows: [{ cohortId: 'cohort-1', chip: 'filling', seatsJoined: 1, capacity: 3, phase: 'CollectingUpdates' }],
      metrics: { open: 1, inFlight: 0, anchored: 0, failed: 0 },
      health: { mode: 'live', esploraReachable: true, paused: false },
      operatorActions: [{ id: 1, t: 5, level: 'info', text: 'ended session paused advertising' }],
    },
    defaults: { discoveryWindowMs: 600_000, fundingWindowMs: 900_000 },
  };

  /** A promise plus its settle handles, so a row controls exactly WHEN an answer lands. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /**
   * Answer every gated read this block uses, with the session probe answered from a staged queue so
   * a row decides what the probe discovers (and, for the overlapping rows, exactly when).
   */
  function stubService(probeAnswers: Array<Promise<Response>>): void {
    let nextProbe = 0;
    vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/operator/session')) {
        const staged = probeAnswers[nextProbe];
        nextProbe += 1;
        return staged ?? Promise.reject(new Error(`no staged answer for probe #${nextProbe}`));
      }
      if (url.endsWith('/v1/operator/login')) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (url.endsWith('/v1/operator/logout')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.endsWith('/v1/operator/settings') && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(new Response(JSON.stringify(STAGED_SETTINGS), { status: 200 }));
      }
      if (url.endsWith('/v1/operator/cohorts')) {
        return Promise.resolve(new Response(JSON.stringify(STAGED_LIST), { status: 200 }));
      }
      if (url.includes('/v1/operator/cohorts/')) {
        return Promise.resolve(new Response(JSON.stringify(SAMPLE_DETAIL), { status: 200 }));
      }
      return new Promise<Response>(() => {});
    });
  }

  /**
   * Sign in and drive the console into the state a working session really reaches: a settled list
   * read, an open drill-down holding a served document, and a settings snapshot. Asserted non-empty
   * here so no row below can pass because nothing was staged.
   */
  async function stagePopulatedSession(): Promise<void> {
    await useOperator.getState().signIn(BASE, PASSWORD);
    await useOperator.getState().refreshCohorts(BASE);
    useOperator.getState().openCohort('cohort-1');
    await useOperator.getState().pollDetail(BASE);
    await useOperator.getState().loadSettings(BASE);

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.cohorts).toEqual(STAGED_LIST.cohorts);
    expect(s.health).toEqual(STAGED_LIST.monitoring.health);
    expect(s.operatorActions).toEqual(STAGED_LIST.monitoring.operatorActions);
    expect(s.detail).toEqual(SAMPLE_DETAIL);
    expect(s.settings).toEqual(STAGED_SETTINGS);
    expect(s.view).toEqual({ kind: 'detail', cohortId: 'cohort-1' });
    expect(typeof s.lastUpdated).toBe('number');
  }

  /** Every gated field the console renders, asserted cleared by name rather than by a shape. */
  function expectGatedSliceEmpty(): void {
    const s = useOperator.getState();
    expect(s.cohorts).toEqual([]);
    expect(s.rows).toEqual([]);
    expect(s.metrics).toBeUndefined();
    expect(s.health).toBeUndefined();
    expect(s.operatorActions).toEqual([]);
    expect(s.settings).toBeUndefined();
    expect(s.detail).toBeUndefined();
    expect(s.detailCohortId).toBeUndefined();
    expect(s.lastUpdated).toBeUndefined();
    expect(s.defaults).toBeUndefined();
    expect(s.view).toEqual({ kind: 'list' });
  }

  it('ends the session it discovers has ended, clearing the whole gated slice', async () => {
    stubService([
      Promise.resolve(new Response(null, { status: 401 })),
    ]);
    await stagePopulatedSession();
    const before = useOperator.getState().sessionRound;

    await useOperator.getState().probe(BASE);

    expectGatedSliceEmpty();
    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    expect(s.sessionRound).not.toBe(before);
  });

  it('leaves the console shell free to re-read settings for the NEXT session (the latch)', async () => {
    // The shell's own once-per-session condition (`OperatorConsole.tsx:65-69`), computed here rather
    // than described: that effect re-reads settings only while the snapshot is undefined, so a
    // retained snapshot made the new session skip its own read entirely and open the create form on
    // a previous session's defaults, indefinitely rather than transiently.
    stubService([
      Promise.resolve(new Response(null, { status: 401 })),
    ]);
    await stagePopulatedSession();

    await useOperator.getState().probe(BASE);
    await useOperator.getState().signIn(BASE, PASSWORD);

    const s = useOperator.getState();
    expect(s.auth === 'logged-in' && s.settings === undefined).toBe(true);
  });

  it('clears the slice on a transport FAULT without ever claiming an expiry', async () => {
    // A network fault is not evidence a session ended, so the copy must stay the unreachable line:
    // a probe that narrated a fault as an expiry would satisfy every clearing row here and would be
    // its own regression. It equally must not hand the gated slice to whoever signs in next.
    stubService([Promise.reject(new Error('network down'))]);
    await stagePopulatedSession();

    await useOperator.getState().probe(BASE);

    expectGatedSliceEmpty();
    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toContain('Could not reach the service');
    expect(s.error).not.toBe(SESSION_EXPIRED);
  });

  it('clears the slice on the fail-closed answer AND keeps the disabled notice', async () => {
    // A service restarted without an operator password still owes the operator that notice, and it
    // lands AFTER the slice has gone rather than instead of it.
    stubService([
      Promise.resolve(new Response(null, { status: 404 })),
    ]);
    await stagePopulatedSession();

    await useOperator.getState().probe(BASE);

    expectGatedSliceEmpty();
    const s = useOperator.getState();
    expect(s.auth).toBe('disabled');
    expect(s.error).toBeUndefined();
  });

  it('clears NOTHING when the probe merely confirms the session already live', async () => {
    // The anti-vacuity control, beside the ending it must not perform: a routing that ended a
    // session on every probe would satisfy all three rows above.
    stubService([
      Promise.resolve(new Response(null, { status: 200 })),
    ]);
    await stagePopulatedSession();
    const before = useOperator.getState().sessionRound;
    const detail = useOperator.getState().detail;

    await useOperator.getState().probe(BASE);

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.sessionRound).toBe(before);
    expect(s.cohorts).toEqual(STAGED_LIST.cohorts);
    expect(s.settings).toEqual(STAGED_SETTINGS);
    expect(s.detail).toEqual(detail);
    expect(s.view).toEqual({ kind: 'detail', cohortId: 'cohort-1' });
  });

  it('ends NOTHING when a probe finds no session on a console holding none', async () => {
    // The second control: a console that never had a session must not be told one expired, and its
    // round must not move. Staged through a real sign-out rather than by seeding a status.
    stubService([
      Promise.resolve(new Response(null, { status: 401 })),
    ]);
    await stagePopulatedSession();
    await useOperator.getState().signOut(BASE);
    const before = useOperator.getState().sessionRound;

    await useOperator.getState().probe(BASE);

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBeUndefined();
    expect(s.sessionRound).toBe(before);
  });

  it('still gives a RETURNING session a fresh round after a probe ended the previous one', async () => {
    // The third control: the ending must not cost the next session its own identity.
    stubService([
      Promise.resolve(new Response(null, { status: 401 })),
      Promise.resolve(new Response(null, { status: 200 })),
    ]);
    await stagePopulatedSession();

    await useOperator.getState().probe(BASE);
    const ended = useOperator.getState().sessionRound;
    await useOperator.getState().probe(BASE);

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.sessionRound).not.toBe(ended);
  });

  it('ends the session EXACTLY once when two overlapping probes both discover it has ended', async () => {
    // Where the stored live-session fact of the previous task stops being tidiness and becomes
    // load-bearing: without it the second probe would end an already-ended session and land the
    // session-expired copy on a console that has already moved on.
    const first = deferred<Response>();
    const second = deferred<Response>();
    stubService([first.promise, second.promise]);
    await stagePopulatedSession();
    const before = useOperator.getState().sessionRound;

    const p1 = useOperator.getState().probe(BASE);
    const p2 = useOperator.getState().probe(BASE);
    first.resolve(new Response(null, { status: 401 }));
    second.resolve(new Response(null, { status: 401 }));
    await Promise.all([p1, p2]);

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.sessionRound).toBe(before + 1);
  });
});

/**
 * Review WR-06: the gated per-cohort JSON export failed SILENTLY. `downloadExport` returned a
 * bare boolean the caller discarded, so on an expired session (the exact case the discriminated
 * FetchResult vocabulary was built for, D-16) clicking `Download monitoring record (JSON)` did
 * nothing at all: no download, no error, no re-login, no log line. These pin the store action's
 * two failure branches.
 */
describe('operator store exportCohort (D-34 export, review WR-06)', () => {
  beforeEach(resetStore);

  it('routes a 401 export through the SAME honest re-login path as a gated read', async () => {
    useOperator.getState().openCohort('cohort-1');
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('no', { status: 401 })));
    await useOperator.getState().exportCohort(BASE, 'cohort-1');
    expect(useOperator.getState().auth).toBe('logged-out');
    expect(useOperator.getState().error).toBe(SESSION_EXPIRED);
    expect(useOperator.getState().view).toEqual({ kind: 'list' });
  });

  it('surfaces a bad-tone message on an unreachable export instead of a silent no-op', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await useOperator.getState().exportCohort(BASE, 'cohort-1');
    expect(useOperator.getState().actionError).toBe(EXPORT_FAILED);
    // A transport fault is NOT a session change: the operator stays signed in.
    expect(useOperator.getState().auth).toBe('logged-in');
  });
});

/**
 * The two LIFECYCLE verbs, which until now no test invoked at all (`05-AUDIT-2.md` entry 4).
 *
 * `05-02-SUMMARY.md:133-137` recorded the 401 path as code-verified with no store-level
 * harness, and deferred it to a browser walkthrough that was never added. So replacing
 * `get().expireSession(); return;` in either verb with a generic `actionError` assignment
 * would have shipped green, and the console would have gone on showing a drill-down of a
 * cohort to an operator who is in fact logged out and can no longer act on any of it.
 *
 * Four facts per 401 row, and the set is what makes it a real pin. The auth state alone would
 * pass a change that logged the operator out but left the stale drill-down open, which is the
 * exact consequence entry 4 names; the busy flag alone would pass one that cleared the button
 * and left the session claim untouched.
 *
 * The 404 and the 409 rows are not padding. They are what proves the 401 branch is a BRANCH
 * rather than the only path a failure can take, and the 409 pins the asymmetry 05-03
 * deliberately built: cancel's 404 is an opaque anti-oracle answer that explains nothing on
 * purpose, while finalize's 409 explains a phase race the operator could not have seen, so one
 * passes the server's reason through and the other must not.
 */
describe('operator store cancelCohort and finalizeCohort (SVC-04, D-16, audit entry 4)', () => {
  beforeEach(resetStore);

  /** Answer every request with one status and body, as the gated route would. */
  function stubStatus(status: number, body = 'no'): void {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(body, { status })));
  }

  it('routes a mid-session 401 on CANCEL through the one shared session-expiry path', async () => {
    useOperator.getState().openCohort('cohort-1');
    useOperator.setState({ cancelling: 'cohort-1' });
    stubStatus(401);
    await useOperator.getState().cancelCohort(BASE, 'cohort-1');
    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    // The drill-down closes with the session: a stale detail view of a cohort this operator can
    // no longer see or act on is worse than no view at all.
    expect(s.view).toEqual({ kind: 'list' });
    // No control is left claiming to be mid-cancel when the next sign-in renders.
    expect(s.cancelling).toBeUndefined();
  });

  it('routes a mid-session 401 on FINALIZE through the same path, clearing its own flag', async () => {
    useOperator.getState().openCohort('cohort-1');
    useOperator.setState({ finalizing: 'cohort-1' });
    stubStatus(401);
    await useOperator.getState().finalizeCohort(BASE, 'cohort-1');
    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    expect(s.view).toEqual({ kind: 'list' });
    expect(s.finalizing).toBeUndefined();
  });

  it('narrates the opaque cancel 404 as nothing more than a failed action', async () => {
    // The route answers one indistinguishable 404 for unknown, never-advertised and
    // already-settled, precisely so it is not an existence oracle. The console must not dress
    // that up into a claim: the session is untouched, nothing about the cohort changed, and no
    // optimistic chip is painted, because the Canceled fate only ever arrives from the served
    // projection.
    useOperator.getState().openCohort('cohort-1');
    stubStatus(404, 'unknown cohort');
    await useOperator.getState().cancelCohort(BASE, 'cohort-1');
    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
    expect(s.actionError).toBe(ACTION_FAILED);
    expect(s.cancelling).toBeUndefined();
    // The drill-down stays exactly where it was, and no cohort fact was invented.
    expect(s.view).toEqual({ kind: 'detail', cohortId: 'cohort-1' });
    expect(s.cohorts).toEqual([]);
    expect(s.detail).toBeUndefined();
  });

  it('preserves the server\'s own reason on a refused (409) finalize', async () => {
    // The deliberate asymmetry with cancel above. A refused finalize is usually a RACE, the
    // polled phase having gone stale between the render and the click, so the operator is told
    // which of the honest reasons applies rather than a bare "that didn't work".
    useOperator.getState().openCohort('cohort-1');
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'cohort is not in a signing phase' }), {
          status: 409,
        }),
      ),
    );
    await useOperator.getState().finalizeCohort(BASE, 'cohort-1');
    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.actionError).toBe(actionFailedWith('cohort is not in a signing phase'));
    expect(s.actionError).toContain('cohort is not in a signing phase');
    // Still a refusal, so nothing about the cohort changed and the busy flag is released.
    expect(s.actionError).toContain('Nothing about this cohort changed.');
    expect(s.finalizing).toBeUndefined();
  });
});

/**
 * Review WR-12: the console's PRIMARY action, and the one beside it, are the only two gated verbs
 * in this store that collapsed every non-ok answer into one sentence.
 *
 * Two consequences, both of which these rows pin. An expired session was narrated as a transient
 * failure worth retrying, on the button an operator presses more than any other, instead of the one
 * honest re-login D-16 makes the single meaning of a 401. And the service's own paused-advertising
 * refusal (D-06, a 409 carrying an app-authored reason) was replaced by the same generic line, on
 * exactly the race the disabled-button reason exists to prevent: advertising paused between the
 * render and the click.
 *
 * The two verbs are separate call sites, so each crossing is pinned twice, once per verb: a fix
 * applied to one is no evidence at all about the other.
 */
describe('operator store advertise and readvertise (review WR-12)', () => {
  beforeEach(resetStore);

  /** Answer every request with one status and body, as a gated route would. */
  function stubStatus(status: number, body = 'no'): void {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(body, { status })));
  }

  /**
   * The service's own paused-advertising refusal, byte-identical to `ADVERTISING_PAUSED_REASON` in
   * `packages/service/src/operator-cohorts.ts`, which `pause.spec.ts` pins there. Both advertise
   * routes answer it with a 409.
   */
  const PAUSED_REASON = 'advertising is paused on this service';

  /** A 409 carrying the app-authored reason, exactly as both advertise routes answer it. */
  function stubPaused(): void {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ error: PAUSED_REASON }), { status: 409 })),
    );
  }

  /**
   * Answer the advertise POST with one response and every following list read with a served list,
   * so a SUCCESS row exercises the whole path (the confirmation, the re-read, and, for advertise,
   * the drill-down) rather than stopping at the first branch.
   */
  function stubAdvertiseThenList(advertiseBody: string, list: unknown): void {
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.includes('/advertise') || url.includes('/readvertise')) {
        return Promise.resolve(new Response(advertiseBody, { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(list), { status: 200 }));
    });
  }

  it('takes an EXPIRED session to the one honest re-login rather than inviting a retry (advertise)', async () => {
    stubStatus(401);

    await useOperator.getState().advertise(BASE, 'draft-1');

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    // No control is left claiming to be mid-advertise when the next sign-in renders.
    expect(s.advertiseStatus).toBe('idle');
    expect(s.advertisingId).toBeUndefined();
  });

  it('takes an EXPIRED session to the one honest re-login on RE-ADVERTISE too', async () => {
    // The second call site. The two verbs are separate branches, so a fix applied to one is no
    // evidence at all about the other, which is why this is a row and not a parameter.
    stubStatus(401);

    await useOperator.getState().readvertise(BASE, 'cohort-expired');

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    expect(s.advertiseStatus).toBe('idle');
    expect(s.advertisingId).toBeUndefined();
  });

  it('renders the SERVICE\'S own paused reason on a refused (409) advertise, in the slot the list renders', async () => {
    stubPaused();

    await useOperator.getState().advertise(BASE, 'draft-1');

    const s = useOperator.getState();
    expect(s.actionError).toBe(actionFailedWith(PAUSED_REASON));
    expect(s.actionError).toContain(PAUSED_REASON);
    // The create form's validation field is NOT where this lands: it renders only while the New
    // cohort form is open, so a failure written there is invisible on the surface with the button.
    expect(s.formError).toBeUndefined();
    // A refusal is not a session change, and nothing about the draft or the list moved.
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
    expect(s.cohorts).toEqual([]);
    expect(s.advertisingId).toBeUndefined();
  });

  it('renders the SERVICE\'S own paused reason on a refused (409) re-advertise', async () => {
    stubPaused();

    await useOperator.getState().readvertise(BASE, 'cohort-expired');

    const s = useOperator.getState();
    expect(s.actionError).toBe(actionFailedWith(PAUSED_REASON));
    expect(s.formError).toBeUndefined();
    expect(s.auth).toBe('logged-in');
    expect(s.cohorts).toEqual([]);
    expect(s.advertisingId).toBeUndefined();
  });

  it('keeps the VERB-SPECIFIC sentence when the service answers no without a reason (advertise)', async () => {
    // The 404 for a draft this service does not hold. The sentence is preserved byte for byte
    // rather than replaced by the shared action line, because it names which action failed and the
    // shared line cannot: the cohort list carries several one-shot actions raising into one slot.
    stubStatus(404, 'unknown draft');

    await useOperator.getState().advertise(BASE, 'draft-1');

    expect(useOperator.getState().actionError).toBe(ADVERTISE_FAILED);
    expect(ADVERTISE_FAILED).toBe('Could not advertise the draft. Try again.');
    expect(useOperator.getState().auth).toBe('logged-in');
  });

  it('keeps the VERB-SPECIFIC sentence when the service answers no without a reason (re-advertise)', async () => {
    stubStatus(404, 'unknown expired cohort');

    await useOperator.getState().readvertise(BASE, 'cohort-expired');

    expect(useOperator.getState().actionError).toBe(READVERTISE_FAILED);
    expect(READVERTISE_FAILED).toBe('Could not re-advertise the cohort. Try again.');
    expect(useOperator.getState().auth).toBe('logged-in');
  });

  it('keeps a service that could not be REACHED distinguishable from one that said no', async () => {
    // Two different things for the operator to go and check, so they stay two sentences. A helper
    // that folded a thrown fetch into the answered-no branch would pass every row above.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));

    await useOperator.getState().advertise(BASE, 'draft-1');

    const s = useOperator.getState();
    expect(s.actionError).toBe(UNREACHABLE);
    expect(s.actionError).not.toBe(ADVERTISE_FAILED);
    // A transport fault is not a session change either.
    expect(s.auth).toBe('logged-in');
  });

  it('STILL confirms, re-reads, and opens the drill-down on the id the RESPONSE carried', async () => {
    // The anti-vacuity control, and the one that pins a shipped property with no row until now:
    // advertise mints a NEW cohort id server-side and deletes the draft, so opening the draft id
    // would poll a cohort the monitor has no entry for.
    const served = { cohorts: [], monitoring: { rows: [], metrics: { open: 1, inFlight: 0, anchored: 0, failed: 0 } } };
    stubAdvertiseThenList(JSON.stringify({ draftId: 'cohort-live' }), served);

    await useOperator.getState().advertise(BASE, 'draft-1');

    const s = useOperator.getState();
    expect(s.advertiseMessage).toBe(ADVERTISED_OK);
    expect(s.actionError).toBeUndefined();
    expect(s.advertiseStatus).toBe('idle');
    expect(s.advertisingId).toBeUndefined();
    expect(s.view).toEqual({ kind: 'detail', cohortId: 'cohort-live' });
    // The re-read happened: the served metrics could only have arrived through `refreshCohorts`.
    expect(s.metrics).toEqual({ open: 1, inFlight: 0, anchored: 0, failed: 0 });
  });

  it('STILL confirms and re-reads on a successful RE-advertise', async () => {
    const served = { cohorts: [], monitoring: { rows: [], metrics: { open: 2, inFlight: 0, anchored: 0, failed: 0 } } };
    stubAdvertiseThenList(JSON.stringify({ ok: true }), served);

    await useOperator.getState().readvertise(BASE, 'cohort-expired');

    const s = useOperator.getState();
    expect(s.advertiseMessage).toBe(READVERTISED_OK);
    expect(s.actionError).toBeUndefined();
    expect(s.advertiseStatus).toBe('idle');
    expect(s.advertisingId).toBeUndefined();
    expect(s.metrics).toEqual({ open: 2, inFlight: 0, anchored: 0, failed: 0 });
    // Re-advertising leaves the operator on the list: no NEW cohort id was minted to open.
    expect(s.view).toEqual({ kind: 'list' });
  });
});

/**
 * Review IN-09: `sessionRound`'s docstring states the session-identity rule as GENERAL LAW ("any
 * guard that must decide whether an answer still belongs to the session that asked compares this,
 * never `auth` alone"), and until this plan four call sites of fifteen followed it. The eleven
 * action verbs called the shared expiry path with no capture and no comparison, so a 401 answering
 * an action the PREVIOUS session started signed the current session out, behind a message that is
 * false about a cookie this service would still accept.
 *
 * The window is narrower than a poll's (one click and one round trip rather than two reads
 * permanently outstanding), which is why the review filed it as info. What makes it worth closing
 * is the review's own argument: a rule written down as general law is a claim about every call site
 * it names, and nine call sites not following it leave the next reader unable to tell a deliberate
 * exemption from a missed site.
 *
 * Each verb FAMILY gets a pair. The ABA row proves the comparison narrows WHOSE 401 counts; the
 * anti-vacuity row beside it proves it never narrowed WHETHER a real expiry counts, which is the
 * failure a shared helper could otherwise hide everywhere at once.
 */
describe('operator store session identity across every gated ACTION (review IN-09)', () => {
  beforeEach(resetStore);

  const PASSWORD = 'operator-password';

  /** A promise plus its settle handles, so a row controls exactly WHEN an answer lands. */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  /**
   * Route by URL FRAGMENT, because these rows drive one gated action plus the auth routes in one
   * sequence. Anything unstaged hangs in flight, the LIST read in particular (the one `signIn`
   * fires for the new session), which would otherwise write the very fields these rows assert on.
   */
  function stubAction(staged: Record<string, Promise<Response>>): void {
    vi.stubGlobal('fetch', (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/v1/operator/login')) {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      if (url.endsWith('/v1/operator/logout')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      for (const [fragment, answer] of Object.entries(staged)) {
        if (url.includes(fragment)) {
          return answer;
        }
      }
      return new Promise<Response>(() => {});
    });
  }

  /** A live session, exactly as a real `signIn` leaves one (review WR-11). */
  function seedLive(): void {
    useOperator.setState({
      auth: 'logged-in',
      liveSessionRound: useOperator.getState().sessionRound,
      error: undefined,
      actionError: undefined,
      pauseError: undefined,
      editError: undefined,
    });
  }

  /**
   * Session B's own gated slice, as its first read would leave it. Asserted field by field after a
   * stale 401 lands, because `expireSession` clears the WHOLE slice on its way out: a row that only
   * checked `auth` would pass against a guard that logged the operator back in while throwing away
   * the cohort list, the served mode and the metrics.
   */
  const SESSION_B_SLICE = {
    cohorts: [
      {
        draftId: 'draft-b',
        beaconType: 'CASBeacon' as const,
        network: 'regtest',
        threshold: 2,
        capacity: 3,
        joined: 1,
        state: 'advertised' as const,
      },
    ],
    metrics: { open: 1, inFlight: 0, anchored: 0, failed: 0 },
    health: { mode: 'live' as const, esploraReachable: true, paused: false },
  };

  /** End session A and sign session B in, which is the ABA sequence every pair below stages. */
  async function signBackIn(): Promise<void> {
    useOperator.getState().expireSession();
    await useOperator.getState().signIn(BASE, PASSWORD);
    expect(useOperator.getState().auth).toBe('logged-in');
    useOperator.setState(SESSION_B_SLICE);
  }

  /** Assert session B survived a dead session's refusal with everything it holds. */
  function expectSessionBUntouched(round: number): void {
    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
    expect(s.sessionRound).toBe(round);
    expect(s.cohorts).toEqual(SESSION_B_SLICE.cohorts);
    expect(s.metrics).toEqual(SESSION_B_SLICE.metrics);
    expect(s.health).toEqual(SESSION_B_SLICE.health);
  }

  it('cancelCohort discards a 401 issued by an ENDED session rather than signing the NEW session out', async () => {
    const a = deferred<Response>();
    stubAction({ '/cancel': a.promise });
    seedLive();
    const act = useOperator.getState().cancelCohort(BASE, 'cohort-1');

    await signBackIn();
    const round = useOperator.getState().sessionRound;

    a.resolve(new Response('no', { status: 401 }));
    await act;

    expectSessionBUntouched(round);
  });

  it('cancelCohort STILL expires the session when the 401 answers the session that is live right now', async () => {
    // The anti-vacuity control on the row above, and on the whole one-shot cohort-action family: a
    // shared helper that quietly stopped expiring would satisfy every ABA row in this file at once
    // while leaving a dead session's console rendering as though it were live.
    const a = deferred<Response>();
    stubAction({ '/cancel': a.promise });
    seedLive();
    const act = useOperator.getState().cancelCohort(BASE, 'cohort-1');

    a.resolve(new Response('no', { status: 401 }));
    await act;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    // This verb's own in-flight marker goes with the session, so nothing claims to be mid-cancel.
    expect(s.cancelling).toBeUndefined();
  });

  it('the advertising toggle discards a 401 issued by an ENDED session', async () => {
    // The service-toggle family, whose verbs are the ones an operator reaches for while draining.
    const a = deferred<Response>();
    stubAction({ '/advertising/pause': a.promise });
    seedLive();
    const act = useOperator.getState().pauseAdvertising(BASE);

    await signBackIn();
    const round = useOperator.getState().sessionRound;

    a.resolve(new Response('no', { status: 401 }));
    await act;

    expectSessionBUntouched(round);
    // The new session's controls card is left alone too: no failure copy from a dead session.
    expect(useOperator.getState().pauseError).toBeUndefined();
  });

  it('the advertising toggle STILL expires the session for a 401 that answers the LIVE session', async () => {
    const a = deferred<Response>();
    stubAction({ '/advertising/pause': a.promise });
    seedLive();
    const act = useOperator.getState().pauseAdvertising(BASE);

    a.resolve(new Response('no', { status: 401 }));
    await act;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    expect(s.pauseBusy).toBe(false);
  });

  it('saveDraftEdit discards a 401 issued by an ENDED session', async () => {
    // The form family. Its 401 branch is the one that can take an OPEN edit form down with it, so a
    // stale refusal would close a form the new session opened for a draft it is mid-way through.
    const a = deferred<Response>();
    stubAction({ '/v1/operator/cohorts/draft-1': a.promise });
    seedLive();
    useOperator.getState().beginEdit('draft-1');
    const act = useOperator.getState().saveDraftEdit(BASE, 'draft-1', { beaconType: 'CASBeacon', size: 3, threshold: 3 });

    await signBackIn();
    useOperator.getState().beginEdit('draft-b');
    const round = useOperator.getState().sessionRound;

    a.resolve(new Response('no', { status: 401 }));
    await act;

    expectSessionBUntouched(round);
    // The new session's own open edit form survives a dead session's refusal.
    expect(useOperator.getState().editingDraftId).toBe('draft-b');
  });

  it('saveDraftEdit STILL expires the session for a 401 that answers the LIVE session', async () => {
    const a = deferred<Response>();
    stubAction({ '/v1/operator/cohorts/draft-1': a.promise });
    seedLive();
    useOperator.getState().beginEdit('draft-1');
    const act = useOperator.getState().saveDraftEdit(BASE, 'draft-1', { beaconType: 'CASBeacon', size: 3, threshold: 3 });

    a.resolve(new Response('no', { status: 401 }));
    await act;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    expect(s.editingDraftId).toBeUndefined();
    expect(s.editStatus).toBe('idle');
  });

  it('advertise discards a 401 issued by an ENDED session', async () => {
    // The advertise family, which only acquired a 401 branch at all in task 1 of this plan.
    const a = deferred<Response>();
    stubAction({ '/advertise': a.promise });
    seedLive();
    const act = useOperator.getState().advertise(BASE, 'draft-1');

    await signBackIn();
    const round = useOperator.getState().sessionRound;

    a.resolve(new Response('no', { status: 401 }));
    await act;

    expectSessionBUntouched(round);
    // And the new session is told nothing about an action it never took.
    expect(useOperator.getState().actionError).toBeUndefined();
  });

  it('advertise STILL expires the session for a 401 that answers the LIVE session', async () => {
    const a = deferred<Response>();
    stubAction({ '/advertise': a.promise });
    seedLive();
    const act = useOperator.getState().advertise(BASE, 'draft-1');

    a.resolve(new Response('no', { status: 401 }));
    await act;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-out');
    expect(s.error).toBe(SESSION_EXPIRED);
    expect(s.advertiseStatus).toBe('idle');
    expect(s.advertisingId).toBeUndefined();
  });

  it('expires nothing for a 401 landing into a console that held NO live session when it asked', async () => {
    // The absent-capture half, matching the shipped list-read row of the same shape: an action
    // issued while nobody was signed in has no session to speak about, so its refusal must not
    // match a value a LATER session holds. This is what pins the capture as an identity rather than
    // a defaulted number.
    const a = deferred<Response>();
    stubAction({ '/cancel': a.promise });
    useOperator.setState({ auth: 'logged-out', liveSessionRound: undefined, error: undefined });
    const act = useOperator.getState().cancelCohort(BASE, 'cohort-1');

    // A new session signs in while that refusal is still in flight.
    useOperator.setState({ auth: 'logged-in', liveSessionRound: useOperator.getState().sessionRound });
    a.resolve(new Response('no', { status: 401 }));
    await act;

    const s = useOperator.getState();
    expect(s.auth).toBe('logged-in');
    expect(s.error).toBeUndefined();
  });
});
