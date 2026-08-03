import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCohortDetail, type CohortDetailDTO, type OperatorCohortsDTO } from '../src/lib/operator';
import {
  useOperator,
  actionFailedWith,
  ACTION_FAILED,
  EXPORT_FAILED,
  SESSION_EXPIRED,
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

/** Reset the operator store to a signed-in, list-view baseline before each test. */
function resetStore(): void {
  useOperator.setState({
    auth: 'logged-in',
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
    const before = useOperator.getState().sessionRound;
    await useOperator.getState().probe(BASE);
    expect(useOperator.getState().auth).toBe('logged-in');
    expect(useOperator.getState().sessionRound).not.toBe(before);
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
