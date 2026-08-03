import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, FINALIZABLE_PHASES, resolveNetwork } from '@btcr2-aggregation/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Participant } from '@btcr2-aggregation/participant';
import { createCohortIntents } from '../src/cohort-intent.js';
import {
  addedTestPeersText,
  BROADCAST_DISABLED_TEXT,
  canceledCohortText,
  createCohortMonitor,
  dismissedRecordText,
  finalizedCohortText,
  operatorAddedTestPeersText,
  PAUSED_ADVERTISING_TEXT,
  RESUMED_ADVERTISING_TEXT,
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
import {
  createRuntimeSettings,
  MAX_TERMS_CHARS,
  SETTINGS_BODY_LIMIT_BYTES,
  type RuntimeSettingsSeed,
} from '../src/runtime-settings.js';

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
function lifecycleApp(settingsSeed: Partial<RuntimeSettingsSeed> = {}) {
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
  // asserted against the real gated block rather than a bespoke app. `settingsSeed` overrides the
  // shipped seed for the rows that need a boot this holder REFUSED something at; every existing
  // caller passes nothing and gets exactly the holder it always got.
  const settings = createRuntimeSettings({
    serviceName: 'Acme Aggregation',
    defaultSize: 2,
    defaultThreshold: 2,
    ...settingsSeed,
  });
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
        // RESHAPED, not loosened (`05-REVIEW.md` WR-07): the served snapshot now also carries the
        // boot seeds this service REFUSED, by name. The exact sorted-equality discipline is the
        // whole value of this row and it stays; only the expected set moved.
        'droppedSeeds',
        'serviceName',
        'termsText',
      ].sort(),
    );
    expect(body.serviceName.value).toBe('Acme Aggregation');
    expect(body.serviceName.changed).toBe(false);

    runner.stop();
  });

  /**
   * WHAT A REFUSED BOOT SEED IS NOW ACCOUNTED FOR, over the real gated route (`05-REVIEW.md` WR-07).
   *
   * `textKnob` drops an over-long free-text seed rather than truncating it, which is right, and then
   * left the console captioning the resulting emptiness as `env default`: the environment set a
   * hundred thousand characters of participation terms and the settings surface said the
   * environment set nothing. For the terms the drop also turns the SVC-05 acceptance gate off, so
   * the disclosure has to reach the operator on a surface they actually read.
   */
  describe('a refused boot seed is disclosed BEHIND the gate and nowhere else', () => {
    /** Boot a service whose `TERMS_TEXT` seed this holder refused, silencing the boot warning. */
    function droppedTermsApp(): ReturnType<typeof lifecycleApp> {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        return lifecycleApp({ termsText: 'x'.repeat(100_000) });
      } finally {
        spy.mockRestore();
      }
    }

    it('carries the refused variable NAME on an authenticated operator read', async () => {
      const { app, runner } = droppedTermsApp();
      const cookie = await login(app);

      const res = await app.request('/v1/operator/settings', { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { droppedSeeds: string[]; termsText: { value?: string } };
      expect(body.droppedSeeds).toEqual(['TERMS_TEXT']);
      // The field itself is still honestly empty; the record says WHY.
      expect(body.termsText.value).toBeUndefined();
      // NAMES only, asserted against the serialized body so a carrier that stashed the refused text
      // anywhere else in the object fails here rather than passing a field-level check.
      expect(JSON.stringify(body)).not.toContain('xxxx');

      runner.stop();
    });

    it('adds NOTHING to the anonymous GET /v1/config, key for key or byte for byte', async () => {
      // Which boot values this service refused is operator provenance about the operator's own
      // environment. The public body a stranger reads must be indistinguishable from the body of a
      // service that refused nothing, which an exact `toEqual` states and a key-set check does not.
      const dropped = droppedTermsApp();
      const clean = lifecycleApp();

      const droppedBody = await (await dropped.app.request('/v1/config')).json();
      const cleanBody = await (await clean.app.request('/v1/config')).json();
      expect(droppedBody).toEqual(cleanBody);
      expect(JSON.stringify(droppedBody)).not.toContain('droppedSeeds');

      dropped.runner.stop();
      clean.runner.stop();
    });

    it('records nothing in the operator-actions log, and a later save still records what moved', async () => {
      // A boot fact is not an operator action: that ring is session-scoped and `signOut` clears it,
      // so a refusal filed there would be misattributed to whoever signed in first and lost at
      // their sign-out. This row is also what proves the settings-label TYPE narrowing was not a
      // narrowing of BEHAVIOR: the log still names exactly the settings whose values moved.
      const { app, runner, monitor } = droppedTermsApp();
      const cookie = await login(app);
      expect(monitor.operatorActions()).toEqual([]);

      const res = await app.request('/v1/operator/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ serviceName: 'Acme (maintenance)' }),
      });
      expect(res.status).toBe(200);
      expect(monitor.operatorActions().map((e) => e.text)).toEqual(['Changed the service name.']);

      runner.stop();
    });
  });

  /**
   * The EXACT body shape the console posts, built the way `settingsPatch` in
   * `packages/web/src/components/operator/SettingsView.tsx` builds it: every field the surface
   * renders, on every save, including the stored terms whether or not the operator touched that
   * field. That is the deliberate all-or-nothing contract (D-12, UI-SPEC E8 `partial`) and it is
   * the whole reason a byte budget sized for one field bites every field.
   *
   * The rows below assert against THIS shape rather than a minimal one on purpose: the property
   * that matters is that the request an operator's browser actually sends is accepted, not that
   * some smaller request is.
   */
  function consolePatch(termsText: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      serviceName: 'Acme Aggregation',
      defaultBeaconType: 'CASBeacon',
      defaultSize: 2,
      defaultThreshold: 2,
      defaultDiscoveryWindowMs: null,
      defaultFundingWindowMs: null,
      termsText,
      ...overrides,
    };
  }

  it('accepts a FULL console save carrying a terms document at the stored ceiling (SC3, review CR-02)', async () => {
    // The gap, stated as a row. The holder stores 20000 characters and `docs/DEPLOY.md` advertises
    // that it does, while the route's own 4 KiB budget refused every save once the stored terms
    // passed roughly 3900 characters, whichever field the operator had edited.
    //
    // THREE assertions, because each alone passes against a wrong fix: a status check alone passes
    // against a route that accepted the body and then dropped the field, and a stored-value check
    // alone would not notice the 413 this row exists to end.
    const { app, runner, settings } = lifecycleApp();
    const cookie = await login(app);
    const atCeiling = 'x'.repeat(MAX_TERMS_CHARS);

    const res = await putSettings(app, cookie, consolePatch(atCeiling));
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(200);
    expect(settings.termsText.value).toHaveLength(MAX_TERMS_CHARS);
    expect(settings.termsText.value).toBe(atCeiling);

    runner.stop();
  });

  it('accepts the same save with the terms written in a three-byte-per-character script', async () => {
    // The ANTI-VACUITY control for the derivation. Without this row a budget sized for ASCII alone
    // satisfies every other row in this block, and the gap survives untouched for any operator who
    // writes their own participation terms in their own language, which is the one class of
    // operator who would ever find it. `MAX_TERMS_CHARS` bounds UTF-16 code units, so this document
    // is exactly at the cap while costing three UTF-8 bytes per unit.
    const { app, runner, settings } = lifecycleApp();
    const cookie = await login(app);
    const atCeiling = '漢'.repeat(MAX_TERMS_CHARS);

    const res = await putSettings(app, cookie, consolePatch(atCeiling));
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(200);
    expect(settings.termsText.value).toBe(atCeiling);

    runner.stop();
  });

  it('renames the service while a ceiling-length terms document is already stored', async () => {
    // The operator's actual complaint, stated as a row: set real terms once, then come back to
    // change something unrelated. Before the fix this second save was refused as a set, and so was
    // every save after it, until the process restarted with shorter terms.
    const { app, runner, settings } = lifecycleApp();
    const cookie = await login(app);
    const atCeiling = 'x'.repeat(MAX_TERMS_CHARS);
    expect(settings.applySettings({ termsText: atCeiling })).toBeUndefined();

    const res = await putSettings(app, cookie, consolePatch(atCeiling, { serviceName: 'Acme (maintenance)' }));
    expect(res.status).toBe(200);
    expect(settings.serviceName.value).toBe('Acme (maintenance)');
    expect(settings.termsText.value).toBe(atCeiling);

    runner.stop();
  });

  it("makes the holder's own terms refusal reachable over HTTP, naming the limit", async () => {
    // The half that proves the fix did more than raise a number. One character past the cap is now
    // answered by the FIELD's limit, carrying a sentence that names the field, the limit and
    // therefore the remedy, instead of `request too large`, which names none of the three.
    const { app, runner, settings } = lifecycleApp();
    const cookie = await login(app);

    const res = await putSettings(app, cookie, consolePatch('x'.repeat(MAX_TERMS_CHARS + 1)));
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: `Participation terms must be ${MAX_TERMS_CHARS} characters or fewer.`,
    });
    expect(settings.termsText.value).toBeUndefined();

    runner.stop();
  });

  it('413s a body over the derived settings limit before it is parsed', async () => {
    // RESHAPED, not loosened (review CR-02): the exact 413 assertion and the exact nothing-was-
    // applied assertion this row shipped with, over a body raised past the NEW boundary. The bound
    // moved because it is now derived from the field cap; it was not removed. A body over the
    // budget is still refused DURING streaming, before `c.req.json()` ever buffers it.
    const { app, runner, settings } = lifecycleApp();
    const cookie = await login(app);

    const oversized = JSON.stringify({ termsText: 'x'.repeat(SETTINGS_BODY_LIMIT_BYTES + 1024) });
    expect(oversized.length).toBeGreaterThan(SETTINGS_BODY_LIMIT_BYTES);
    const res = await putSettings(app, cookie, oversized, true);
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

  // NOTE: the operator cohort LIST is exactly what a dismissal now clears (05-19, audit defect 4);
  // that changed half is pinned by the `listCohorts()` rows in the describe block below. This case
  // keeps its original assertions byte-identical because their staying green unedited is what
  // proves a dismissal still cannot reach the PUBLIC surface.
  it('leaves the public directory untouched by a dismissal', async () => {
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

/**
 * The dismissal clears BOTH ended-record sources (05-19, `05-AUDIT.md` entries 4 and 6).
 *
 * The console's Ended group is a UNION: the monitoring fold holds an ended record, and the
 * operator cohort list holds a terminal record carrying the cohort's fate. The route used to
 * delete only the first, so a canceled row answered 200 and came straight back on the next list
 * read, and an expired row whose monitoring record never existed answered 404 while the row
 * persisted. Every row here re-reads `listCohorts()`, which is the axis the shipped cases missed.
 */
describe('DELETE /v1/operator/ended/:id clears BOTH ended-record sources (05-19, D-15)', () => {
  /**
   * Count the operator-actions entries whose text is exactly this cohort's dismissal line.
   *
   * Read BEFORE and AFTER the route DELETE, never as an absolute count. An absolute count is
   * unsatisfiable in the terminal-record-only sub-case below, because its setup calls
   * `monitor.dismissEnded` directly and that method records its own action before returning, so a
   * correct fix would read 2. A `toContain` check is worse in a different way: the setup already
   * put that exact text in the ring, so containment passes whether or not the route appended at
   * all, which is to say it measures nothing about the route. The delta measures only what the
   * route did.
   */
  function dismissalCount(monitor: ReturnType<typeof lifecycleApp>['monitor'], cohortId: string): number {
    return monitor.operatorActions().filter((e) => e.text === dismissedRecordText(cohortId)).length;
  }

  it('drops a dismissed CANCELED cohort from the operator cohort list, not just from the monitor', async () => {
    const { app, runner, monitor, operatorCohorts } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, { method: 'POST', headers: { cookie } });
    await settle();
    // Both sources hold a record: the monitoring ended row AND the terminal record the console's
    // Ended group actually renders the canceled row from.
    expect(monitor.summary().some((r) => r.cohortId === cohortId)).toBe(true);
    expect(operatorCohorts.listCohorts().some((r) => r.draftId === cohortId)).toBe(true);

    // This sub-case needs no interleave: the cancel that staged the state already appended
    // `canceledCohortText(cohortId)`, so the ring's tail differs from the text the route appends.
    const before = dismissalCount(monitor, cohortId);
    const res = await app.request(`/v1/operator/ended/${cohortId}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(200);

    expect(monitor.summary().some((r) => r.cohortId === cohortId)).toBe(false);
    expect(operatorCohorts.listCohorts().some((r) => r.draftId === cohortId)).toBe(false);
    expect(dismissalCount(monitor, cohortId) - before).toBe(1);

    runner.stop();
  });

  it('200s a cohort holding a TERMINAL record but no monitoring ended record, and drops its row', async () => {
    const { app, runner, monitor, operatorCohorts } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, { method: 'POST', headers: { cookie } });
    await settle();
    // Reproduce the app-side WINDOW-EXPIRY state: only a terminal record, no monitoring ended
    // record. The real path is not driven here because the per-draft discovery window has a
    // sixty-second floor, so a genuine window expiry cannot be reached inside a unit spec - which
    // is precisely why this sub-case went uncovered and answered 404 with the row still on screen.
    expect(monitor.dismissEnded(cohortId)).toBe(true);
    expect(monitor.summary().some((r) => r.cohortId === cohortId)).toBe(false);
    expect(operatorCohorts.listCohorts().some((r) => r.draftId === cohortId)).toBe(true);

    // The interleave is LOAD-BEARING, not tidiness: `recordServiceAction` returns early when the
    // incoming text is byte-identical to the ring's LAST entry (monitor.ts:954-958, deliberate so
    // an idempotent verb clicked twice records once), and `dismissedRecordText` is a pure function
    // of the id (monitor.ts:122). The direct `monitor.dismissEnded` above therefore left exactly
    // the text the route is about to append sitting as the tail, and with nothing in between a
    // CORRECT route append is suppressed and the delta below reads 0. Cancelling a second cohort
    // appends `canceledCohortText(otherId)`, which differs, so the tail moves and the append lands.
    // Remove this and the row starts failing against a correct implementation.
    //
    // The adjacency is an artifact of THIS setup and not a production shape: on the real
    // window-expiry path the monitor never held an ended record for the cohort at all
    // (`runner.stopCohort` emits no runner event, so only a terminal record is minted), so nothing
    // can precede the route's own append and the entry is genuinely once per dismissal.
    const otherId = await createAndAdvertise(app, cookie);
    await app.request(`/v1/operator/cohorts/${otherId}/cancel`, { method: 'POST', headers: { cookie } });
    await settle();

    const before = dismissalCount(monitor, cohortId);
    const res = await app.request(`/v1/operator/ended/${cohortId}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(200);
    expect(operatorCohorts.listCohorts().some((r) => r.draftId === cohortId)).toBe(false);
    expect(dismissalCount(monitor, cohortId) - before).toBe(1);

    runner.stop();
  });

  it('refuses a cohort still in an in-flight phase, from BOTH sources', async () => {
    const { app, runner, monitor, operatorCohorts, setPhase } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    // The setup is load-bearing and must NOT be "simplified" back to advertise-then-DELETE. Both
    // halves look up their record BEFORE they check the phase (`!ended.has(id)` at monitor.ts:1490
    // and the equivalent lookup at the top of `forgetTerminal`), so a live cohort with no records
    // refuses one layer earlier for a different reason: the route 404s, "nothing was removed" is
    // trivially true, and a `forgetTerminal` with NO phase guard at all passes unchanged. Cancel
    // and settle so BOTH records exist, then stage an in-flight observed phase, so the input
    // actually reaches the guard this row exists to certify.
    await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, { method: 'POST', headers: { cookie } });
    await settle();
    setPhase(cohortId, 'SigningStarted');

    const res = await app.request(`/v1/operator/ended/${cohortId}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(404);
    expect(operatorCohorts.listCohorts().some((r) => r.draftId === cohortId)).toBe(true);
    expect(monitor.summary().some((r) => r.cohortId === cohortId)).toBe(true);

    runner.stop();
  });

  it('404s an id neither source knows, with the same opaque body as a known-but-refused one', async () => {
    const { app, runner } = lifecycleApp();
    const cookie = await login(app);

    const res = await app.request('/v1/operator/ended/never-existed-at-all', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    // Widening the route to a second source must not widen what a caller can learn: the body is
    // the same opaque line it always was, so the route is no more of an existence oracle than it
    // was when the monitor was its only source.
    expect(await res.json()).toEqual({ error: 'unknown ended cohort' });

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

/**
 * The three route-level "changed nothing, record nothing" guards (05-AUDIT-2.md entry 13, defect
 * #2): `hono-adapter.ts` reads the prior state BEFORE calling pause / resume / disable-broadcast,
 * and records an operator action only on a real transition.
 *
 * ## The trap, which is the whole reason these sequences look the way they do
 *
 * The obvious test is two identical actions back to back. It is worthless here. The operator-actions
 * ring in `monitor.ts` skips a consecutive duplicate ITSELF, so `pause -> pause` yields one entry
 * with the route guard present AND with it deleted. Every existing sequence in the repo has that
 * shape, including `kill-switch.spec.ts`'s "is idempotent and appends ONE operator-action entry",
 * so all three guards were indistinguishable from having no guard at all.
 *
 * So each row below drives a DIFFERENT recorded action BETWEEN the two identical ones. That breaks
 * the ring's consecutive-duplicate skip (the two entries would no longer be adjacent), which leaves
 * the route guard as the only thing that can keep the count at one.
 *
 * Each row COUNTS occurrences of its own entry text rather than checking the array length, so the
 * interleaved action landing in between cannot change the answer.
 *
 * What shipping without these would have cost: the operator-actions log is the audit trail for who
 * stood broadcasting down and when. A guard lost to a refactor fills it with bogus duplicates, so
 * the record of a one-way money-movement decision stops being a record of decisions.
 */
describe('a repeated no-op toggle records NOTHING, proven against the ring own duplicate skip (audit #2)', () => {
  /** How many entries in the service-level log carry exactly this text. */
  function countEntries(monitor: ReturnType<typeof lifecycleApp>['monitor'], text: string): number {
    return monitor.operatorActions().filter((e) => e.text === text).length;
  }

  /** A settings rename: a recorded service-level action that is not any of the three toggles. */
  function rename(
    app: ReturnType<typeof lifecycleApp>['app'],
    cookie: string,
    name: string,
  ): Promise<Response> {
    return app.request('/v1/operator/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ serviceName: name }),
    });
  }

  it('pauses, records something ELSE, then pauses again: still ONE pause entry', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);

    await app.request('/v1/operator/advertising/pause', { method: 'POST', headers: { cookie } });
    // The interleave. Without it the ring alone answers "one" whether or not the route guard exists.
    await rename(app, cookie, 'Acme (draining)');
    const repeat = await app.request('/v1/operator/advertising/pause', { method: 'POST', headers: { cookie } });

    // The route is idempotent, so the repeat still succeeds and still reports the end state.
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ paused: true });
    expect(countEntries(monitor, PAUSED_ADVERTISING_TEXT)).toBe(1);
    // The interleaved action really did land in between, so the two pauses were not adjacent.
    expect(monitor.operatorActions().map((e) => e.text)).toEqual([
      PAUSED_ADVERTISING_TEXT,
      'Changed the service name.',
    ]);

    runner.stop();
  });

  it('records a pause on every GENUINE transition, so the row above is not passing vacuously', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);

    await app.request('/v1/operator/advertising/pause', { method: 'POST', headers: { cookie } });
    await app.request('/v1/operator/advertising/resume', { method: 'POST', headers: { cookie } });
    await app.request('/v1/operator/advertising/pause', { method: 'POST', headers: { cookie } });

    // TWO pauses, because the operator really did pause twice. The guard is about state, not about
    // suppressing repeated text: a service paused, resumed and paused again has two pauses to show.
    expect(countEntries(monitor, PAUSED_ADVERTISING_TEXT)).toBe(2);
    expect(countEntries(monitor, RESUMED_ADVERTISING_TEXT)).toBe(1);

    runner.stop();
  });

  it('resumes an already-unpaused service twice around another action: NO resume entry at all', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);

    // The service boots unpaused, so both of these are no-ops.
    await app.request('/v1/operator/advertising/resume', { method: 'POST', headers: { cookie } });
    await rename(app, cookie, 'Acme (running)');
    const repeat = await app.request('/v1/operator/advertising/resume', { method: 'POST', headers: { cookie } });

    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ paused: false });
    expect(countEntries(monitor, RESUMED_ADVERTISING_TEXT)).toBe(0);
    expect(monitor.operatorActions().map((e) => e.text)).toEqual(['Changed the service name.']);

    runner.stop();
  });

  it('records a resume on a genuine transition, so the zero above is about the guard', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);

    await app.request('/v1/operator/advertising/pause', { method: 'POST', headers: { cookie } });
    await app.request('/v1/operator/advertising/resume', { method: 'POST', headers: { cookie } });

    expect(countEntries(monitor, RESUMED_ADVERTISING_TEXT)).toBe(1);

    runner.stop();
  });

  it('disables broadcast, cancels a cohort, then disables again: still ONE kill-switch entry', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    await app.request('/v1/operator/broadcast/disable', { method: 'POST', headers: { cookie } });
    // A cancel is the interleaved action here: a recorded operator action of a different kind
    // entirely, so nothing about it can be confused with a broadcast toggle.
    await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, { method: 'POST', headers: { cookie } });
    const repeat = await app.request('/v1/operator/broadcast/disable', { method: 'POST', headers: { cookie } });

    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toEqual({ broadcastDisabled: true });
    expect(countEntries(monitor, BROADCAST_DISABLED_TEXT)).toBe(1);
    expect(monitor.operatorActions().map((e) => e.text)).toEqual([
      BROADCAST_DISABLED_TEXT,
      canceledCohortText(cohortId),
    ]);

    runner.stop();
  });

  it('records the kill switch on its ONE genuine transition, so the row above is not vacuous', async () => {
    const { app, runner, monitor } = lifecycleApp();
    const cookie = await login(app);

    await app.request('/v1/operator/broadcast/disable', { method: 'POST', headers: { cookie } });

    // There is deliberately no counterpart route, so one transition is all this switch will ever
    // have; the entry existing at all is what makes the interleaved row above measure something.
    expect(countEntries(monitor, BROADCAST_DISABLED_TEXT)).toBe(1);

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
