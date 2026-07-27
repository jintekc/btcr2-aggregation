import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCohortDetail, type CohortDetailDTO } from '../src/lib/operator';
import { useOperator, EXPORT_FAILED, SESSION_EXPIRED } from '../src/stores/operator';

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

/** Reset the operator store to a signed-in, list-view baseline before each test. */
function resetStore(): void {
  useOperator.setState({
    auth: 'logged-in',
    error: undefined,
    view: { kind: 'list' },
    detail: undefined,
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
    expect(useOperator.getState().detailStale).toBe(false);
    expect(typeof useOperator.getState().lastUpdated).toBe('number');
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
            health: { mode: 'live', esploraReachable: true },
          }),
          { status: 200 },
        ),
      ),
    );
    await useOperator.getState().refreshCohorts(BASE);
    expect(useOperator.getState().health).toEqual({ mode: 'live', esploraReachable: true });
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
    useOperator.setState({ health: { mode: 'live', esploraReachable: false } });
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('no', { status: 401 })));
    await useOperator.getState().refreshCohorts(BASE);
    expect(useOperator.getState().health).toBeUndefined();
    expect(useOperator.getState().auth).toBe('logged-out');
    expect(useOperator.getState().error).toBe(SESSION_EXPIRED);
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
