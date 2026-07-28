import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { createCohortIntents } from '../src/cohort-intent.js';
import { createCohortMonitor } from '../src/monitor.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from '../src/operator-auth.js';
import {
  createOperatorCohorts,
  type DirectoryCohortDTO,
  type OperatorCohortDTO,
  type ServiceStatusDTO,
} from '../src/operator-cohorts.js';

/**
 * Hermetic coverage of the operator CANCEL action (SVC-04, D-01/D-04/D-05), built on the
 * `operator-cohorts.spec.ts` harness idiom: an in-memory operator-enabled app over a REAL
 * runner (no port, no chain), login once to capture the session cookie, then drive the gated
 * cancel route and assert the fate lands in every place the operator can see it.
 *
 * The load-bearing property under test is that `runner.stopCohort` is SILENT (it emits no
 * runner event at all) and that both fate consumers are nevertheless correct, because the
 * cancel DECLARES its intent into the {@link createCohortIntents} registry before making the
 * library call. The proof that this is intent-driven and not message-driven is the last
 * describe block: a whole-runner `stop()` rejects through the SAME channel with a different
 * code, and must still file `expired`.
 *
 * Every test calls `runner.stop()` so the runner's advert republish timer never leaks.
 */

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';

/** The exact operator-facing reason a canceled terminal record carries (D-05). */
const CANCELED_REASON = 'canceled by the operator';
/** The exact UI-SPEC activity-ring line for an operator cancel (E12/E13). */
const CANCELED_ACTIVITY_TEXT = 'Operator canceled this cohort.';

/**
 * Build an operator-enabled app wired exactly as `index.ts` wires it for the cancel path: one
 * intent registry shared by the cancel action and the settlement, one monitoring fold, and the
 * `onCancel` hook that captures the fate AT EVENT TIME (before the cohort leaves the session).
 * `onProvideTxData` is a stub because no cohort here reaches signing.
 */
function cancelApp() {
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
  const sessions = createSessionStore(60_000);
  const operatorAuth: OperatorAuthConfig = {
    sessions,
    throttle: createLoginThrottle({ maxAttempts: 1000, windowMs: 5 * 60_000 }),
    expectedPassword: PASSWORD,
    cookieSecure: false,
    sessionTtlMs: 60_000,
  };
  const intents = createCohortIntents();
  const monitor = createCohortMonitor(runner);
  const operatorCohorts = createOperatorCohorts({
    activeNetwork: ACTIVE_NETWORK,
    runner,
    autoFallbackOnStall: true,
    intents,
    onCancel: (cohortId: string) => monitor.noteCanceled(cohortId),
  });
  const app = createHonoApp(transport, {
    operatorAuth,
    operatorCohorts,
    monitor,
    networkName: ACTIVE_NETWORK,
  });
  return { app, runner, monitor, operatorCohorts };
}

/** POST a login and return the bare `operator_session=<id>` cookie for gated requests. */
async function login(app: ReturnType<typeof cancelApp>['app']): Promise<string> {
  const res = await app.request('/v1/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

/** Create a draft and advertise it in one step; returns the LIVE cohort id. */
async function createAndAdvertise(
  app: ReturnType<typeof cancelApp>['app'],
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

/** Read the operator cohort list (the gated read the console polls). */
async function listCohorts(
  app: ReturnType<typeof cancelApp>['app'],
  cookie: string,
): Promise<OperatorCohortDTO[]> {
  const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
  return ((await res.json()) as { cohorts: OperatorCohortDTO[] }).cohorts;
}

/** Let the completion rejection drive `settleCompletion` on the next microtask turn. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('createCohortIntents (the per-service intent registry)', () => {
  it('declares, reads back, and clears an intent', () => {
    const intents = createCohortIntents();
    expect(intents.read('a')).toBeUndefined();
    intents.declare('a', 'canceled');
    expect(intents.read('a')).toBe('canceled');
    intents.clear('a');
    expect(intents.read('a')).toBeUndefined();
  });

  it('keeps two registries in one process completely independent (never a module singleton)', () => {
    const first = createCohortIntents();
    const second = createCohortIntents();
    first.declare('shared-id', 'canceled');
    expect(first.read('shared-id')).toBe('canceled');
    expect(second.read('shared-id')).toBeUndefined();
  });

  it('bounds retention at 24 with oldest-first eviction', () => {
    const intents = createCohortIntents();
    for (let i = 0; i < 30; i += 1) {
      intents.declare(`cohort-${i}`, 'canceled');
    }
    // The 6 oldest were evicted; the newest 24 survive.
    expect(intents.read('cohort-0')).toBeUndefined();
    expect(intents.read('cohort-5')).toBeUndefined();
    expect(intents.read('cohort-6')).toBe('canceled');
    expect(intents.read('cohort-29')).toBe('canceled');
  });

  it('refreshes a re-declared cohort so it is not the entry evicted', () => {
    const intents = createCohortIntents();
    intents.declare('oldest', 'canceled');
    for (let i = 0; i < 23; i += 1) {
      intents.declare(`filler-${i}`, 'window-expired');
    }
    // Re-declaring moves `oldest` to the end of the insertion order.
    intents.declare('oldest', 'canceled');
    intents.declare('overflow', 'canceled');
    expect(intents.read('oldest')).toBe('canceled');
    expect(intents.read('filler-0')).toBeUndefined();
  });
});

describe('cancelCohort files a distinct canceled fate (D-05)', () => {
  it('lists the canceled cohort as state "canceled" with the fixed reason, never "expired"', async () => {
    const { app, runner, operatorCohorts } = cancelApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    expect(operatorCohorts.cancelCohort(cohortId)).toBe('ok');
    await settle();

    const cohorts = await listCohorts(app, cookie);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].draftId).toBe(cohortId);
    expect(cohorts[0].state).toBe('canceled');
    // The fixed contract string, NOT the library's raw `Cohort {id} stopped.` machine message.
    expect(cohorts[0].reason).toBe(CANCELED_REASON);
    expect(cohorts[0].reason).not.toMatch(/stopped/i);

    runner.stop();
  });

  it('removes the canceled cohort from the public directory and drops the open count', async () => {
    const { app, runner, operatorCohorts } = cancelApp();
    const cookie = await login(app);
    const first = await createAndAdvertise(app, cookie);
    const second = await createAndAdvertise(app, cookie);

    const before = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
    expect(before.openCohorts).toBe(2);

    expect(operatorCohorts.cancelCohort(second)).toBe('ok');
    await settle();

    const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
    expect(directory.map((d) => d.cohortId)).toEqual([first]);
    const after = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
    expect(after.openCohorts).toBe(1);

    runner.stop();
  });

  it('captures the fate at event time in the monitoring fold: a canceled chip and an activity entry', async () => {
    const { app, runner, monitor, operatorCohorts } = cancelApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    operatorCohorts.cancelCohort(cohortId);
    await settle();

    // The ENDED record survives the session GC that `stopCohort` performs, because the fate
    // was snapshotted while the cohort was still live (D-23).
    const row = monitor.summary().find((r) => r.cohortId === cohortId);
    expect(row?.chip).toBe('canceled');
    expect(row?.phase).toBe('ended');
    expect(row?.capacity).toBe(2);

    const activity = monitor.detail(cohortId).activity.map((a) => a.text);
    expect(activity).toContain(CANCELED_ACTIVITY_TEXT);

    runner.stop();
  });

  it('counts a cancel as neither anchored nor failed (an operator decision is not a failure)', async () => {
    const { app, runner, monitor, operatorCohorts } = cancelApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    operatorCohorts.cancelCohort(cohortId);
    await settle();

    const metrics = monitor.serviceMetrics();
    expect(metrics.anchored).toBe(0);
    expect(metrics.failed).toBe(0);
    expect(metrics.open).toBe(0);
    expect(metrics.inFlight).toBe(0);

    runner.stop();
  });

  it('is idempotent in the fold: a second noteCanceled adds no duplicate record or log line', async () => {
    const { app, runner, monitor, operatorCohorts } = cancelApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    operatorCohorts.cancelCohort(cohortId);
    await settle();
    monitor.noteCanceled(cohortId);

    expect(monitor.summary().filter((r) => r.cohortId === cohortId)).toHaveLength(1);
    const lines = monitor.detail(cohortId).activity.filter((a) => a.text === CANCELED_ACTIVITY_TEXT);
    expect(lines).toHaveLength(1);

    runner.stop();
  });
});

describe('cancelCohort edge semantics (boundary)', () => {
  it('reads "unknown" for an id that was never advertised', async () => {
    const { app, runner, operatorCohorts } = cancelApp();
    await login(app);
    expect(operatorCohorts.cancelCohort('does-not-exist')).toBe('unknown');
    runner.stop();
  });

  it('reads "unknown" on a second cancel of the same cohort (already settled)', async () => {
    const { app, runner, operatorCohorts } = cancelApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    expect(operatorCohorts.cancelCohort(cohortId)).toBe('ok');
    await settle();
    expect(operatorCohorts.cancelCohort(cohortId)).toBe('unknown');

    // And exactly ONE ended row exists for that id (no double-filing).
    const cohorts = await listCohorts(app, cookie);
    expect(cohorts.filter((c) => c.draftId === cohortId)).toHaveLength(1);

    runner.stop();
  });

  it('leaves a draft untouched: cancel is an ADVERTISED-cohort verb, discard is the draft verb', async () => {
    const { app, runner, operatorCohorts } = cancelApp();
    const cookie = await login(app);
    const created = await app.request('/v1/operator/cohorts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ beaconType: 'CASBeacon', size: 2 }),
    });
    const draft = (await created.json()) as OperatorCohortDTO;

    expect(operatorCohorts.cancelCohort(draft.draftId)).toBe('unknown');
    const cohorts = await listCohorts(app, cookie);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].state).toBe('draft');

    runner.stop();
  });
});

describe('POST /v1/operator/cohorts/:id/cancel (route semantics)', () => {
  it('401s with no session cookie, before any cohort-id lookup', async () => {
    const { app, runner } = cancelApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    // A real (existing) id and a never-existed id are indistinguishable to an anonymous
    // caller: both are rejected by the session gate with the same 401 (T-05-01-01).
    const existing = await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, { method: 'POST' });
    const missing = await app.request('/v1/operator/cohorts/never-existed/cancel', { method: 'POST' });
    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);

    // ...and the cohort is untouched: an anonymous POST cannot end it.
    const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
    expect(directory.map((d) => d.cohortId)).toEqual([cohortId]);

    runner.stop();
  });

  it('400s a malformed cohort id before any lookup', async () => {
    const { app, runner } = cancelApp();
    const cookie = await login(app);
    const res = await app.request('/v1/operator/cohorts/bad%20id/cancel', {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: 'invalid cohort id' });
    runner.stop();
  });

  it('404s an unknown cohort id with a body that reveals nothing', async () => {
    const { app, runner } = cancelApp();
    const cookie = await login(app);
    const res = await app.request('/v1/operator/cohorts/does-not-exist/cancel', {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: 'unknown cohort' });
    runner.stop();
  });

  it('200s a live advertised cohort and files the canceled fate through the route', async () => {
    const { app, runner } = cancelApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    const res = await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await settle();

    const cohorts = await listCohorts(app, cookie);
    expect(cohorts[0].state).toBe('canceled');

    // A second POST for the now-settled cohort is the same 404 as a never-existed id.
    const again = await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(again.status).toBe(404);

    runner.stop();
  });
});

describe('the fate is classified from the intent registry, never the rejection message', () => {
  it('files a whole-runner stop() as expired, not canceled', async () => {
    const { app, runner } = cancelApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    // `runner.stop()` rejects every outstanding cohort through the SAME completion channel a
    // cancel uses, with a different error code. No intent was declared, so the settlement must
    // fall through to the pre-existing expired behavior: a shutdown is not an operator cancel.
    runner.stop();
    await settle();

    const cohorts = await listCohorts(app, cookie);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].draftId).toBe(cohortId);
    expect(cohorts[0].state).toBe('expired');
    expect(cohorts[0].reason).not.toBe(CANCELED_REASON);
    expect(cohorts[0].reason).toBeTruthy();
  });

  it('files an idle-cohort stall as expired while a cancel of its sibling reads canceled', async () => {
    const { app, runner, operatorCohorts } = cancelApp();
    const cookie = await login(app);
    const stalled = await createAndAdvertise(app, cookie);
    const canceled = await createAndAdvertise(app, cookie);

    // Stop the first WITHOUT declaring an intent (exactly what a stall/TTL lapse looks like to
    // the settlement), and cancel the second through the operator action.
    runner.stopCohort(stalled);
    expect(operatorCohorts.cancelCohort(canceled)).toBe('ok');
    await settle();

    const cohorts = await listCohorts(app, cookie);
    expect(cohorts.find((c) => c.draftId === stalled)?.state).toBe('expired');
    expect(cohorts.find((c) => c.draftId === canceled)?.state).toBe('canceled');

    runner.stop();
  });
});
