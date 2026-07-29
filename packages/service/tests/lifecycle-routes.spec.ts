import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, FINALIZABLE_PHASES, resolveNetwork } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import type { Participant } from '@btcr2-aggregation/participant';
import { createCohortIntents } from '../src/cohort-intent.js';
import {
  addedTestPeersText,
  canceledCohortText,
  createCohortMonitor,
  finalizedCohortText,
  operatorAddedTestPeersText,
} from '../src/monitor.js';
import {
  addTestPeersFor,
  createTestPeers,
  NO_SEATS_REASON,
  type CohortSeats,
  type TestPeerFactory,
} from '../src/test-peers.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from '../src/operator-auth.js';
import {
  createOperatorCohorts,
  NOT_SIGNING_REASON,
  type OperatorCohortDTO,
} from '../src/operator-cohorts.js';
import { createRuntimeSettings } from '../src/runtime-settings.js';

/**
 * The single home for the ROUTE-SEMANTICS matrix of every gated cohort-lifecycle route this
 * phase adds (SVC-04): `POST /v1/operator/cohorts/:id/cancel` (05-01) and
 * `POST /v1/operator/cohorts/:id/finalize` (05-03). Each route is asserted across the same five
 * outcomes - 401 anonymously (BEFORE any cohort-id lookup), 400 for a malformed id, 404 for an
 * unknown id, 409 for a refused action, and 200 for the happy path - so a later lifecycle verb
 * has one obvious place to join and one obvious shape to match.
 *
 * The load-bearing property for finalize is RESEARCH Pitfall 4: `runner.triggerFallback` calls
 * `session.startFallbackSigning` FIRST, which THROWS when the cohort has no signing session or
 * sits outside the library's three signing phases. So availability is a PHASE PREDICATE checked
 * before the library call, never a try/catch around it, and a refusal is a 409 carrying an
 * app-authored reason - never a 500, and never the library's own `INVALID_PHASE` message.
 *
 * How the signing phase is reached here: driving a real hermetic cohort all the way into
 * `SigningStarted` needs n real participants and then completes in milliseconds, so a unit spec
 * could never hold a cohort mid-signing without racing. This harness therefore keeps EVERYTHING
 * real (a real runner, a real transport, the real gated Hono app, real drafts advertised through
 * the real operator routes) and overrides exactly two seams: the observed cohort PHASE, and
 * `runner.triggerFallback`, which is counted rather than executed. That is precisely what makes
 * the guard testable - the spy proves the library call is NOT reached on a pre-signing cohort -
 * while the genuine end-to-end library path is proven by `pnpm e2e:fallback:operator`.
 *
 * Every test calls `runner.stop()` so the runner's advert republish timer never leaks.
 */

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';

/** The exact UI-SPEC activity-ring line for an operator-triggered fallback. */
const FINALIZE_ACTIVITY_TEXT = 'Operator triggered the k-of-n fallback.';

/**
 * Build an operator-enabled app wired exactly as `index.ts` wires it for the lifecycle verbs:
 * one intent registry shared by the actions and the settlement, one monitoring fold, and both
 * event-time hooks (`onCancel` / `onFinalize`).
 *
 * `setPhase` installs an observed phase for a cohort id; every other id keeps the real state
 * machine's answer. `fallbackCalls` records the ids `finalizeCohort` handed to the library.
 */
function lifecycleApp() {
  const identity = createIdentity(resolveNetwork(ACTIVE_NETWORK));
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  transport.registerActor(identity.did, identity.keys);
  const runner = new AggregationServiceRunner({
    transport,
    did: identity.did,
    keys: identity.keys,
    onProvideTxData: async () => {
      throw new Error('signing not exercised in this spec');
    },
  });
  transport.start();

  // Seam 1: the observed phase. Only ids explicitly staged here are overridden, so the real
  // state machine still answers for every other cohort (and for an unknown id).
  const staged = new Map<string, string>();
  const realGetCohortPhase = runner.session.getCohortPhase.bind(runner.session);
  runner.session.getCohortPhase = ((cohortId: string) =>
    staged.get(cohortId) ?? realGetCohortPhase(cohortId)) as typeof runner.session.getCohortPhase;

  // Seam 2: the library call itself, counted rather than executed (the pre-guard spy).
  const fallbackCalls: string[] = [];
  runner.triggerFallback = async (cohortId: string): Promise<void> => {
    fallbackCalls.push(cohortId);
  };

  const sessions = createSessionStore(60_000);
  const operatorAuth: OperatorAuthConfig = {
    sessions,
    throttle: createLoginThrottle({ maxAttempts: 1000, windowMs: 5 * 60_000 }),
    expectedPassword: PASSWORD,
    cookieSecure: false,
    sessionTtlMs: 60_000,
  };
  const intents = createCohortIntents();
  // The test-peer registry is built BEFORE the monitor, because `index.ts` hands the monitor its
  // live badge set at construction; a registry built afterwards would badge nothing.
  const spawnedPeerDids: string[] = [];
  let peerSeq = 0;
  const createPeer: TestPeerFactory = ({ identity }) =>
    ({
      start: async (): Promise<void> => {
        spawnedPeerDids.push(identity.did);
      },
      stop: (): void => {},
    }) as unknown as Participant;
  const testPeerRegistry = createTestPeers({
    baseUrl: () => 'http://127.0.0.1:9999',
    createPeer,
    createPeerIdentity: () => {
      peerSeq += 1;
      return {
        did: `did:example:test-peer-${peerSeq}`,
        keys: {} as ReturnType<typeof createIdentity>['keys'],
      };
    },
  });
  const monitor = createCohortMonitor(runner, undefined, undefined, undefined, undefined, testPeerRegistry.dids);
  // The runtime holder is wired exactly as `index.ts` wires it, so the settings routes below are
  // asserted against the real gated block rather than a bespoke app.
  const settings = createRuntimeSettings({ serviceName: 'Acme Aggregation', defaultSize: 2, defaultThreshold: 2 });
  const operatorCohorts = createOperatorCohorts({
    activeNetwork: ACTIVE_NETWORK,
    runner,
    autoFallbackOnStall: true,
    intents,
    settings,
    // Both hooks mirror `index.ts`: the per-cohort activity line PLUS the service-level
    // operator-actions entry, which is the one that survives the cohort's record being dismissed.
    onCancel: (cohortId: string) => {
      monitor.noteCanceled(cohortId);
      monitor.noteOperatorAction(canceledCohortText(cohortId));
    },
    onFinalize: (cohortId: string) => {
      monitor.noteOperatorAction(cohortId, FINALIZE_ACTIVITY_TEXT);
      monitor.noteOperatorAction(finalizedCohortText(cohortId));
    },
  });
  // The test-peer action, wired with the REAL verdict logic (`addTestPeersFor`) and the REAL
  // registry built above, over a fake participant factory: the route matrix must assert the
  // shipping arithmetic, not a re-typed copy of it, while staying free of ports and protocol.
  //
  // Seat facts come from the live session; `setSeats` stages a cohort's seats so the full-cohort
  // 409 row does not need n real participants to reach it.
  const stagedSeats = new Map<string, CohortSeats>();
  const testPeers = {
    addTestPeers: (cohortId: string, requested?: number) =>
      addTestPeersFor(
        {
          seats: (id: string): CohortSeats | undefined => {
            const forced = stagedSeats.get(id);
            if (forced) {
              return forced;
            }
            const cohort = runner.session.getCohort(id);
            return cohort
              ? { seatsJoined: cohort.participants.length, capacity: cohort.minParticipants }
              : undefined;
          },
          registry: testPeerRegistry,
          onSpawned: (id: string, spawned: number) => {
            monitor.noteOperatorAction(id, operatorAddedTestPeersText(spawned));
            monitor.noteOperatorAction(addedTestPeersText(spawned, id));
          },
        },
        cohortId,
        requested,
      ),
  };

  const app = createHonoApp(transport, {
    operatorAuth,
    operatorCohorts,
    monitor,
    runtimeSettings: settings,
    networkName: ACTIVE_NETWORK,
    testPeers,
  });
  return {
    app,
    runner,
    monitor,
    operatorCohorts,
    settings,
    fallbackCalls,
    testPeerRegistry,
    spawnedPeerDids,
    setPhase: (cohortId: string, phase: string) => staged.set(cohortId, phase),
    setSeats: (cohortId: string, seats: CohortSeats) => stagedSeats.set(cohortId, seats),
  };
}

/** POST a login and return the bare `operator_session=<id>` cookie for gated requests. */
async function login(app: ReturnType<typeof lifecycleApp>['app']): Promise<string> {
  const res = await app.request('/v1/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

/** Create a draft and advertise it in one step; returns the LIVE cohort id. */
async function createAndAdvertise(
  app: ReturnType<typeof lifecycleApp>['app'],
  cookie: string,
  size = 2,
): Promise<string> {
  const created = await app.request('/v1/operator/cohorts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ beaconType: 'CASBeacon', size, threshold: size }),
  });
  const draft = (await created.json()) as OperatorCohortDTO;
  const advertised = await app.request(`/v1/operator/cohorts/${draft.draftId}/advertise`, {
    method: 'POST',
    headers: { cookie },
  });
  return ((await advertised.json()) as OperatorCohortDTO).draftId;
}

/** Let a completion rejection drive `settleCompletion` on the next microtask turn. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('FINALIZABLE_PHASES mirrors the library signing set, never the wider in-flight set', () => {
  it('holds exactly the three signing phases the library salvages a stall from', () => {
    expect([...FINALIZABLE_PHASES].sort()).toEqual(
      ['AwaitingPartialSigs', 'NoncesCollected', 'SigningStarted'].sort(),
    );
  });

  it('excludes the four funding-wait phases, which IN_FLIGHT_PHASES deliberately includes', () => {
    // Reusing IN_FLIGHT_PHASES here would offer Finalize now on a cohort where the library call
    // throws: 04-08 widened that set with the funding-wait phases for the directory, not for this.
    for (const phase of ['UpdatesCollected', 'DataDistributed', 'Validated', 'FallbackRequested']) {
      expect(FINALIZABLE_PHASES.has(phase)).toBe(false);
    }
  });
});

describe('finalizeCohort guards on the phase BEFORE touching the library (RESEARCH Pitfall 4)', () => {
  it('returns "ok" and commits the fallback path for a cohort in a signing phase', async () => {
    const { app, runner, operatorCohorts, fallbackCalls, setPhase } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    setPhase(cohortId, 'SigningStarted');

    await expect(operatorCohorts.finalizeCohort(cohortId)).resolves.toBe('ok');
    expect(fallbackCalls).toEqual([cohortId]);

    runner.stop();
  });

  it('accepts every one of the three signing phases', async () => {
    for (const phase of FINALIZABLE_PHASES) {
      const { app, runner, operatorCohorts, fallbackCalls, setPhase } = lifecycleApp();
      const cookie = await login(app);
      const cohortId = await createAndAdvertise(app, cookie);
      setPhase(cohortId, phase);

      await expect(operatorCohorts.finalizeCohort(cohortId)).resolves.toBe('ok');
      expect(fallbackCalls).toHaveLength(1);

      runner.stop();
    }
  });

  it('returns "not-signing" for a filling, pre-signing cohort and NEVER calls the library', async () => {
    const { app, runner, operatorCohorts, fallbackCalls } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    // No phase staged: a freshly advertised cohort really is at `Advertised`.

    await expect(operatorCohorts.finalizeCohort(cohortId)).resolves.toBe('not-signing');
    // The spy is the proof: the guard runs BEFORE the call, so no library error can escape.
    expect(fallbackCalls).toEqual([]);

    runner.stop();
  });

  it('returns "not-signing" for the funding-wait phases (the wider in-flight set is not reused)', async () => {
    for (const phase of ['UpdatesCollected', 'DataDistributed', 'Validated', 'FallbackRequested']) {
      const { app, runner, operatorCohorts, fallbackCalls, setPhase } = lifecycleApp();
      const cookie = await login(app);
      const cohortId = await createAndAdvertise(app, cookie);
      setPhase(cohortId, phase);

      await expect(operatorCohorts.finalizeCohort(cohortId)).resolves.toBe('not-signing');
      expect(fallbackCalls).toEqual([]);

      runner.stop();
    }
  });

  it('returns "unknown" for a never-advertised cohort id', async () => {
    const { app, runner, operatorCohorts, fallbackCalls } = lifecycleApp();
    await login(app);

    await expect(operatorCohorts.finalizeCohort('never-existed')).resolves.toBe('unknown');
    expect(fallbackCalls).toEqual([]);

    runner.stop();
  });

  it('returns "unknown" for an ALREADY-SETTLED cohort id (indistinguishable from unknown)', async () => {
    const { app, runner, operatorCohorts, fallbackCalls } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    expect(operatorCohorts.cancelCohort(cohortId)).toBe('ok');
    await settle();

    await expect(operatorCohorts.finalizeCohort(cohortId)).resolves.toBe('unknown');
    expect(fallbackCalls).toEqual([]);

    runner.stop();
  });

  it('is idempotent: a second finalize resolves "ok" and appends no duplicate activity entry', async () => {
    const { app, runner, monitor, operatorCohorts, setPhase } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    setPhase(cohortId, 'SigningStarted');

    await expect(operatorCohorts.finalizeCohort(cohortId)).resolves.toBe('ok');
    await expect(operatorCohorts.finalizeCohort(cohortId)).resolves.toBe('ok');

    // `triggerFallback` is idempotent by design (it no-ops for a cohort already committed to a
    // path), so a double-click reads as success - but the operator's activity record must not
    // claim the action happened twice.
    const entries = monitor
      .detail(cohortId)
      .activity.filter((a) => a.text === FINALIZE_ACTIVITY_TEXT);
    expect(entries).toHaveLength(1);

    runner.stop();
  });

  it('maps a late library rejection to "not-signing" rather than letting it escape', async () => {
    const { app, runner, operatorCohorts, setPhase } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    setPhase(cohortId, 'SigningStarted');
    // A phase race: the cohort left the signing phase between the guard and the call.
    runner.triggerFallback = async () => {
      throw new Error('Cannot start fallback for cohort x: phase is Complete.');
    };

    await expect(operatorCohorts.finalizeCohort(cohortId)).resolves.toBe('not-signing');

    runner.stop();
  });
});

describe('POST /v1/operator/cohorts/:id/finalize route semantics', () => {
  it('401s with no session cookie, BEFORE any cohort-id lookup', async () => {
    const { app, runner, fallbackCalls } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    // An EXISTING id and a never-existed id must be indistinguishable to an anonymous caller.
    const existing = await app.request(`/v1/operator/cohorts/${cohortId}/finalize`, { method: 'POST' });
    const missing = await app.request('/v1/operator/cohorts/never-existed/finalize', { method: 'POST' });
    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await existing.text()).toBe(await missing.text());
    expect(fallbackCalls).toEqual([]);

    runner.stop();
  });

  it('400s a malformed cohort id before any lookup', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/cohorts/bad_id/finalize', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(400);

    runner.stop();
  });

  it('404s an unknown cohort id with a body that reveals nothing', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/cohorts/never-existed/finalize', {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown cohort' });

    runner.stop();
  });

  it('409s a pre-signing cohort with the app-authored reason, never a 500 or a library string', async () => {
    const { app, runner, fallbackCalls } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    const res = await app.request(`/v1/operator/cohorts/${cohortId}/finalize`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(NOT_SIGNING_REASON);
    // The library's own thrown text must never reach a caller (T-05-03-02).
    expect(body.error).not.toMatch(/INVALID_PHASE|startFallbackSigning|Cohort .* not found/i);
    expect(fallbackCalls).toEqual([]);

    runner.stop();
  });

  it('200s a cohort in a signing phase and reaches the library exactly once', async () => {
    const { app, runner, fallbackCalls, setPhase } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    setPhase(cohortId, 'NoncesCollected');

    const res = await app.request(`/v1/operator/cohorts/${cohortId}/finalize`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fallbackCalls).toEqual([cohortId]);

    runner.stop();
  });

  it('records the operator action in the cohort activity ring with a server wall-clock stamp', async () => {
    const { app, runner, monitor, setPhase } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    setPhase(cohortId, 'AwaitingPartialSigs');

    await app.request(`/v1/operator/cohorts/${cohortId}/finalize`, { method: 'POST', headers: { cookie } });

    const entry = monitor.detail(cohortId).activity.find((a) => a.text === FINALIZE_ACTIVITY_TEXT);
    expect(entry).toBeDefined();
    expect(typeof entry?.t).toBe('number');

    runner.stop();
  });
});

describe('POST /v1/operator/cohorts/:id/cancel route semantics (05-01, pinned here too)', () => {
  it('401s with no session cookie, BEFORE any cohort-id lookup', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    const existing = await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, { method: 'POST' });
    const missing = await app.request('/v1/operator/cohorts/never-existed/cancel', { method: 'POST' });
    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await existing.text()).toBe(await missing.text());

    runner.stop();
  });

  it('400s a malformed cohort id before any lookup', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/cohorts/bad_id/cancel', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(400);

    runner.stop();
  });

  it('404s an unknown cohort id with a body that reveals nothing', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/cohorts/never-existed/cancel', {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown cohort' });

    runner.stop();
  });

  it('200s a live cohort, and a second cancel of the same id 404s (already settled)', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    const first = await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    await settle();

    const second = await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(second.status).toBe(404);

    runner.stop();
  });
});

describe('GET and PUT /v1/operator/settings route semantics (05-07, ADR 0015)', () => {
  /** PUT a settings body through the real gated route. */
  function putSettings(
    app: ReturnType<typeof lifecycleApp>['app'],
    cookie: string,
    body: unknown,
    raw = false,
  ): Promise<Response> {
    return app.request('/v1/operator/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: raw ? (body as string) : JSON.stringify(body),
    });
  }

  it('401s BOTH verbs for an anonymous caller (the gate runs before any handler)', async () => {
    const { app, runner, settings } = lifecycleApp();

    const read = await app.request('/v1/operator/settings');
    const write = await putSettings(app, '', { serviceName: 'Pwned' });
    expect(read.status).toBe(401);
    expect(write.status).toBe(401);
    // Nothing was applied: the refused write never reached `applySettings`.
    expect(settings.serviceName.value).toBe('Acme Aggregation');

    runner.stop();
  });

  it('serves the full field set with sources for an operator session', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/settings', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, { value?: unknown; changed: boolean }>;
    expect(Object.keys(body).sort()).toEqual(
      [
        'defaultBeaconType',
        'defaultDiscoveryWindowMs',
        'defaultFundingWindowMs',
        'defaultSize',
        'defaultThreshold',
        'serviceName',
        'termsText',
      ].sort(),
    );
    expect(body.serviceName.value).toBe('Acme Aggregation');
    expect(body.serviceName.changed).toBe(false);

    runner.stop();
  });

  it('413s a body over the 4 KiB limit before it is parsed', async () => {
    const { app, runner, settings } = lifecycleApp();
    const cookie = await login(app);

    const res = await putSettings(app, cookie, JSON.stringify({ termsText: 'x'.repeat(8 * 1024) }), true);
    expect(res.status).toBe(413);
    expect(settings.termsText.value).toBeUndefined();

    runner.stop();
  });

  it('400s a non-JSON body and an invalid field, carrying the user-facing message', async () => {
    const { app, runner, settings } = lifecycleApp();
    const cookie = await login(app);

    const notJson = await putSettings(app, cookie, 'not json at all', true);
    expect(notJson.status).toBe(400);

    const invalid = await putSettings(app, cookie, { serviceName: 'Renamed', defaultSize: 0 });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()) as { error: string }).toEqual({
      error: 'Cohort size must be at least 1 signer.',
    });
    // All-or-nothing: the VALID sibling field in the same body was not applied either.
    expect(settings.serviceName.value).toBe('Acme Aggregation');
    expect(settings.defaultSize.value).toBe(2);

    runner.stop();
  });

  it('200s a valid save and answers with the NEW snapshot', async () => {
    const { app, runner, settings } = lifecycleApp();
    const cookie = await login(app);

    const res = await putSettings(app, cookie, {
      serviceName: 'Acme (maintenance)',
      defaultSize: 4,
      defaultThreshold: 3,
      termsText: 'Be excellent to each other.',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, { value?: unknown; envDefault?: unknown; changed: boolean }>;
    expect(body.serviceName.value).toBe('Acme (maintenance)');
    expect(body.serviceName.envDefault).toBe('Acme Aggregation');
    expect(body.serviceName.changed).toBe(true);
    expect(body.defaultSize.value).toBe(4);
    expect(settings.termsText.value).toBe('Be excellent to each other.');

    runner.stop();
  });
});

describe('DELETE /v1/operator/ended/:id route semantics (SVC-04, D-15)', () => {
  it('401s with no session cookie, BEFORE any lookup', async () => {
    const { app, runner, monitor } = lifecycleApp();
    monitor.noteCanceled('some-cohort');

    // An id with a real ended record and a never-existed id must be indistinguishable anonymously.
    const existing = await app.request('/v1/operator/ended/some-cohort', { method: 'DELETE' });
    const missing = await app.request('/v1/operator/ended/never-existed', { method: 'DELETE' });
    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await existing.text()).toBe(await missing.text());
    // Nothing was dismissed.
    expect(monitor.summary().some((r) => r.cohortId === 'some-cohort')).toBe(true);

    runner.stop();
  });

  it('400s an id failing the shape guard, even with a valid session', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/ended/not%20a%20valid%20id', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(res.status).toBe(400);

    runner.stop();
  });

  it('404s an unknown id', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/ended/never-existed', { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(404);

    runner.stop();
  });

  it('200s a real ended record, and a repeat then 404s (the record is gone)', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    // Cancel first so there is a real ended record with a real fate behind it.
    await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, { method: 'POST', headers: { cookie } });
    await settle();
    expect(monitor.summary().some((r) => r.cohortId === cohortId)).toBe(true);

    const first = await app.request(`/v1/operator/ended/${cohortId}`, { method: 'DELETE', headers: { cookie } });
    expect(first.status).toBe(200);
    expect(monitor.summary().some((r) => r.cohortId === cohortId)).toBe(false);

    const second = await app.request(`/v1/operator/ended/${cohortId}`, { method: 'DELETE', headers: { cookie } });
    expect(second.status).toBe(404);

    runner.stop();
  });

  it('leaves the public directory and the operator cohort list untouched by a dismissal', async () => {
    const { app, runner, monitor, operatorCohorts } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, { method: 'POST', headers: { cookie } });
    await settle();

    const directoryBefore = JSON.stringify(operatorCohorts.directory());
    await app.request(`/v1/operator/ended/${cohortId}`, { method: 'DELETE', headers: { cookie } });

    // Dismissal is telemetry-only (D-15): the public directory is byte-identical, and the
    // dismissal is recorded in the operator log rather than anywhere a stranger can see.
    expect(JSON.stringify(operatorCohorts.directory())).toBe(directoryBefore);
    expect(monitor.operatorActions().map((e) => e.text)).toContain(
      `Dismissed the record for cohort ${cohortId.slice(0, 8)}.`,
    );

    runner.stop();
  });
});

describe('the operator actions log rides the existing gated monitoring read (ADR 0016)', () => {
  it('serves operatorActions as an additive sibling key beside rows/metrics/health', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);
    monitor.noteOperatorAction('Paused advertising.');

    const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cohorts: unknown[];
      monitoring?: { rows: unknown[]; metrics: unknown; health?: unknown; operatorActions?: { text: string }[] };
    };
    expect(body.monitoring?.operatorActions?.map((e) => e.text)).toEqual(['Paused advertising.']);
    // Additive: every pre-existing key is still served.
    expect(Array.isArray(body.cohorts)).toBe(true);
    expect(Array.isArray(body.monitoring?.rows)).toBe(true);
    expect(body.monitoring?.metrics).toBeDefined();
    expect(body.monitoring?.health).toBeDefined();

    runner.stop();
  });

  it('records pause, resume, cancel, and finalize as self-contained sentences', async () => {
    const { app, runner, monitor, setPhase } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    await app.request('/v1/operator/advertising/pause', { method: 'POST', headers: { cookie } });
    await app.request('/v1/operator/advertising/resume', { method: 'POST', headers: { cookie } });
    setPhase(cohortId, 'SigningStarted');
    await app.request(`/v1/operator/cohorts/${cohortId}/finalize`, { method: 'POST', headers: { cookie } });
    await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, { method: 'POST', headers: { cookie } });
    await settle();

    const short = cohortId.slice(0, 8);
    expect(monitor.operatorActions().map((e) => e.text)).toEqual([
      'Paused advertising.',
      'Resumed advertising.',
      `Triggered the k-of-n fallback on cohort ${short}.`,
      `Canceled cohort ${short}.`,
    ]);

    runner.stop();
  });

  it('records a settings change by name, and records nothing for a save that changed nothing', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);
    const save = (body: unknown): Promise<Response> =>
      app.request('/v1/operator/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      });

    await save({ serviceName: 'Acme (maintenance)' });
    expect(monitor.operatorActions().map((e) => e.text)).toEqual(['Changed the service name.']);

    // A save that re-sends the value the service already holds changed nothing, so it says nothing.
    await save({ serviceName: 'Acme (maintenance)' });
    expect(monitor.operatorActions()).toHaveLength(1);

    runner.stop();
  });
});

describe('POST /v1/operator/cohorts/:id/test-peers route semantics (05-09)', () => {
  it('401s with no session cookie, BEFORE any cohort-id lookup', async () => {
    const { app, runner, spawnedPeerDids } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    // An EXISTING id and a never-existed id must be indistinguishable to an anonymous caller: on a
    // live cohort this route makes participants that co-sign real money (T-05-09-01).
    const existing = await app.request(`/v1/operator/cohorts/${cohortId}/test-peers`, { method: 'POST' });
    const missing = await app.request('/v1/operator/cohorts/never-existed/test-peers', { method: 'POST' });
    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await existing.text()).toBe(await missing.text());
    expect(spawnedPeerDids).toEqual([]);

    runner.stop();
  });

  it('400s a malformed cohort id before any lookup', async () => {
    const { app, runner, spawnedPeerDids } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/cohorts/bad_id/test-peers', {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(400);
    expect(spawnedPeerDids).toEqual([]);

    runner.stop();
  });

  it('404s an unknown cohort id with the SAME opaque body cancel and finalize use', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/cohorts/never-existed/test-peers', {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown cohort' });

    runner.stop();
  });

  it('409s a cohort with no seats left, carrying the exact reason the console renders', async () => {
    const { app, runner, spawnedPeerDids, setSeats } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    setSeats(cohortId, { seatsJoined: 2, capacity: 2 });

    const res = await app.request(`/v1/operator/cohorts/${cohortId}/test-peers`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: NO_SEATS_REASON });
    // Refused means refused: an operator-triggered spawn cannot grow past n (T-05-09-02).
    expect(spawnedPeerDids).toEqual([]);

    runner.stop();
  });

  it('200s with the spawned count and fills every remaining seat when no body is sent', async () => {
    const { app, runner, spawnedPeerDids } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie, 3);

    const res = await app.request(`/v1/operator/cohorts/${cohortId}/test-peers`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ spawned: 3 });
    expect(spawnedPeerDids).toHaveLength(3);

    runner.stop();
  });

  it('honors a smaller requested count, leaving the cohort partly filled', async () => {
    const { app, runner, spawnedPeerDids } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie, 4);

    const res = await app.request(`/v1/operator/cohorts/${cohortId}/test-peers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ count: 2 }),
    });
    expect(await res.json()).toEqual({ spawned: 2 });
    expect(spawnedPeerDids).toHaveLength(2);

    runner.stop();
  });

  it('CAPS a request larger than the remaining seats rather than honoring it', async () => {
    const { app, runner, spawnedPeerDids } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie, 2);

    const res = await app.request(`/v1/operator/cohorts/${cohortId}/test-peers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ count: 10_000 }),
    });
    expect(await res.json()).toEqual({ spawned: 2 });
    expect(spawnedPeerDids).toHaveLength(2);

    runner.stop();
  });

  it('400s a count that is not a whole number of at least 1', async () => {
    for (const count of [0, -1, 'two', null]) {
      const { app, runner, spawnedPeerDids } = lifecycleApp();
      const cookie = await login(app);
      const cohortId = await createAndAdvertise(app, cookie);

      const res = await app.request(`/v1/operator/cohorts/${cohortId}/test-peers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ count }),
      });
      expect(res.status).toBe(400);
      expect(spawnedPeerDids).toEqual([]);

      runner.stop();
    }
  });

  it('records BOTH the per-cohort activity line and the service-level entry, once', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie, 2);
    const short = cohortId.slice(0, 8);

    await app.request(`/v1/operator/cohorts/${cohortId}/test-peers`, {
      method: 'POST',
      headers: { cookie },
    });

    expect(monitor.detail(cohortId).activity.map((a) => a.text)).toContain('Operator added 2 test peers.');
    expect(monitor.operatorActions().map((e) => e.text)).toEqual([
      `Added 2 test peers to cohort ${short}.`,
    ]);

    runner.stop();
  });

  it('badges exactly the spawned members in the gated detail read', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie, 2);

    await app.request(`/v1/operator/cohorts/${cohortId}/test-peers`, {
      method: 'POST',
      headers: { cookie },
    });
    // The peers here are fakes, so seat them into the fold directly; the real seating path is
    // proven end to end by `pnpm e2e:testpeers`.
    runner.emit('participant-accepted', { cohortId, participantDid: 'did:example:test-peer-1' });
    runner.emit('participant-accepted', { cohortId, participantDid: 'did:example:a-real-stranger' });

    const res = await app.request(`/v1/operator/cohorts/${cohortId}`, { headers: { cookie } });
    const members = ((await res.json()) as { members: { did: string; testPeer?: boolean }[] }).members;
    expect(members.find((m) => m.did === 'did:example:test-peer-1')?.testPeer).toBe(true);
    expect(members.find((m) => m.did === 'did:example:a-real-stranger')?.testPeer).toBeUndefined();

    runner.stop();
  });
});
