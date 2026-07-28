import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { createCohortIntents } from '../src/cohort-intent.js';
import { createCohortMonitor } from '../src/monitor.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createRuntimeSettings } from '../src/runtime-settings.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from '../src/operator-auth.js';
import {
  ADVERTISING_PAUSED_REASON,
  createOperatorCohorts,
  type DirectoryCohortDTO,
  type OperatorCohortDTO,
  type ServiceStatusDTO,
} from '../src/operator-cohorts.js';

/**
 * Hermetic coverage of the advertising PAUSE (SVC-04, D-06 through D-09): drain mode.
 *
 * Two claims are load-bearing and each is pinned below by a POSITIVE and a NEGATIVE surface.
 *
 * The gate is COMPLETE: `advertiseDraft` and `readvertiseExpired` are the only two callers of
 * `runner.advertiseCohort` in the whole app (the boot-time auto-advertise loop was deleted in
 * Phase 1), so checking the flag in exactly those two places blocks every path by which a NEW
 * cohort could come into existence. Nothing else needs a check, and adding one elsewhere would
 * silently widen pause into something it is not.
 *
 * The gate is NARROW: pause is drain mode, NOT a kill switch. Cohorts already advertised keep
 * filling, in-flight cohorts run to completion, and every other surface - drafts, cancel,
 * finalize, the operator list, the public directory, the public status, the gated monitoring
 * read - behaves exactly as it does on a running service. The explicit negative-surface block
 * below asserts that narrowness rather than assuming it, because a pause that quietly took the
 * public directory down with it would look identical from the advertise side.
 *
 * The `paused` bit on `GET /v1/status` and the gate read the SAME holder value, so the public
 * claim and the enforced behavior cannot drift (the single-derivation discipline `openCount()`
 * already uses). The tests below assert both facts off one pause.
 */

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';

/**
 * Build an operator-enabled app wired exactly as `index.ts` wires it, over a REAL runner so the
 * advertise path and the live-set-derived public reads are genuinely exercised. The runtime
 * settings holder is the same object the gate, the status bit, and the health strip all read.
 */
function pauseApp() {
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
  const settings = createRuntimeSettings({});
  const intents = createCohortIntents();
  const monitor = createCohortMonitor(runner, undefined, undefined, undefined, settings);
  const operatorCohorts = createOperatorCohorts({
    activeNetwork: ACTIVE_NETWORK,
    runner,
    autoFallbackOnStall: true,
    intents,
    settings,
    onCancel: (cohortId: string) => monitor.noteCanceled(cohortId),
  });
  const app = createHonoApp(transport, {
    operatorAuth,
    operatorCohorts,
    monitor,
    runtimeSettings: settings,
    networkName: ACTIVE_NETWORK,
  });
  return { app, runner, monitor, operatorCohorts, settings };
}

/** POST a login and return the bare `operator_session=<id>` cookie for gated requests. */
async function login(app: ReturnType<typeof pauseApp>['app']): Promise<string> {
  const res = await app.request('/v1/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

/** Create a draft through the real gated route and return its DTO. */
async function createDraft(
  app: ReturnType<typeof pauseApp>['app'],
  cookie: string,
  body: unknown = { beaconType: 'CASBeacon', size: 2 },
): Promise<OperatorCohortDTO> {
  const res = await app.request('/v1/operator/cohorts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  return (await res.json()) as OperatorCohortDTO;
}

/** POST the gated advertise route for a draft id. */
function advertise(app: ReturnType<typeof pauseApp>['app'], cookie: string, id: string): Promise<Response> {
  return app.request(`/v1/operator/cohorts/${id}/advertise`, { method: 'POST', headers: { cookie } });
}

/** POST the gated re-advertise route for a terminal cohort id. */
function readvertise(app: ReturnType<typeof pauseApp>['app'], cookie: string, id: string): Promise<Response> {
  return app.request(`/v1/operator/cohorts/${id}/readvertise`, { method: 'POST', headers: { cookie } });
}

/** POST the gated pause / resume routes. */
function advertising(
  app: ReturnType<typeof pauseApp>['app'],
  action: 'pause' | 'resume',
  cookie?: string,
): Promise<Response> {
  return app.request(`/v1/operator/advertising/${action}`, {
    method: 'POST',
    ...(cookie ? { headers: { cookie } } : {}),
  });
}

/** Read the operator's own cohort list. */
async function listCohorts(
  app: ReturnType<typeof pauseApp>['app'],
  cookie: string,
): Promise<OperatorCohortDTO[]> {
  const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
  const body = (await res.json()) as { cohorts: OperatorCohortDTO[] };
  return body.cohorts;
}

describe('pause blocks the two advertise call sites and nothing else', () => {
  it('refuses advertiseDraft with a paused verdict, leaving the draft a draft', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      const cookie = await login(app);
      const draft = await createDraft(app, cookie);
      settings.pause();

      const res = await advertise(app, cookie, draft.draftId);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: ADVERTISING_PAUSED_REASON });

      // The draft SURVIVES a refused advertise: a paused advertise is a refusal, never a
      // half-applied action that consumed the draft.
      const rows = await listCohorts(app, cookie);
      expect(rows).toHaveLength(1);
      expect(rows[0].draftId).toBe(draft.draftId);
      expect(rows[0].state).toBe('draft');
      // Nothing was advertised, so the public surface saw nothing at all.
      expect((await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[]).toEqual([]);
    } finally {
      runner.stop();
    }
  });

  it('refuses readvertiseExpired the same way, leaving the expired record expired', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      const cookie = await login(app);
      const draft = await createDraft(app, cookie);
      const advertised = (await (await advertise(app, cookie, draft.draftId)).json()) as OperatorCohortDTO;
      const cohortId = advertised.draftId;

      // Expire it the way the runner does (a stall / TTL lapse rejects the completion).
      runner.stopCohort(cohortId);
      await new Promise((r) => setTimeout(r, 20));
      expect((await listCohorts(app, cookie)).find((c) => c.draftId === cohortId)?.state).toBe('expired');

      settings.pause();
      const res = await readvertise(app, cookie, cohortId);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: ADVERTISING_PAUSED_REASON });

      // The terminal record is still there and still re-advertisable once advertising resumes.
      const stillExpired = (await listCohorts(app, cookie)).find((c) => c.draftId === cohortId);
      expect(stillExpired?.state).toBe('expired');

      settings.resume();
      const revived = await readvertise(app, cookie, cohortId);
      expect(revived.status).toBe(200);
    } finally {
      runner.stop();
    }
  });

  it('is the ONLY gate: exactly two runner.advertiseCohort call sites exist to guard', async () => {
    // A behavioral echo of the acceptance-criterion grep: with the flag on, no path through the
    // operator surface can produce a live cohort. Both call sites are covered by the two tests
    // above; this asserts the negative end state across both in one pass.
    const { app, runner, settings } = pauseApp();
    try {
      const cookie = await login(app);
      const first = await createDraft(app, cookie);
      const second = await createDraft(app, cookie, { beaconType: 'SMTBeacon', size: 3 });
      settings.pause();
      expect((await advertise(app, cookie, first.draftId)).status).toBe(409);
      expect((await advertise(app, cookie, second.draftId)).status).toBe(409);
      expect(runner.session.cohorts).toHaveLength(0);
    } finally {
      runner.stop();
    }
  });
});

describe('pause is drain mode: every other surface is untouched (D-06/D-09)', () => {
  it('leaves a cohort advertised BEFORE the pause open, listed, counted, and joinable', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      const cookie = await login(app);
      const draft = await createDraft(app, cookie);
      const advertised = (await (await advertise(app, cookie, draft.draftId)).json()) as OperatorCohortDTO;
      const cohortId = advertised.draftId;

      settings.pause();

      // Still in the public directory, still in the JOINABLE tier (its phase is Advertised, the
      // only tier the join gate accepts), and still counted by the public open count. Pause
      // never retracts what is already offered - full quiesce is pause PLUS a cancel each.
      const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
      expect(directory).toHaveLength(1);
      expect(directory[0].cohortId).toBe(cohortId);
      expect(directory[0].phase).toBe('Advertised');
      const status = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
      expect(status.openCohorts).toBe(1);
      expect(status.paused).toBe(true);
    } finally {
      runner.stop();
    }
  });

  it('keeps createDraft, discardDraft, the operator list, and the gated monitoring read working', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      const cookie = await login(app);
      settings.pause();

      // Drafts can still be prepared while the service is quiet - that is the point of drain
      // mode rather than a kill switch.
      const draft = await createDraft(app, cookie);
      expect(draft.state).toBe('draft');
      expect(await listCohorts(app, cookie)).toHaveLength(1);

      const detail = await app.request(`/v1/operator/cohorts/${draft.draftId}`, { headers: { cookie } });
      expect(detail.status).toBe(200);

      const discarded = await app.request(`/v1/operator/cohorts/${draft.draftId}`, {
        method: 'DELETE',
        headers: { cookie },
      });
      expect(discarded.status).toBe(200);
      expect(await listCohorts(app, cookie)).toHaveLength(0);
    } finally {
      runner.stop();
    }
  });

  it('keeps cancel and finalize working on a cohort advertised before the pause', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      const cookie = await login(app);
      const draft = await createDraft(app, cookie);
      const advertised = (await (await advertise(app, cookie, draft.draftId)).json()) as OperatorCohortDTO;
      const cohortId = advertised.draftId;

      settings.pause();

      // Finalize refuses on its OWN grounds (the cohort is not signing), never with the paused
      // reason: the pause gate must not leak into a verb it does not govern.
      const finalize = await app.request(`/v1/operator/cohorts/${cohortId}/finalize`, {
        method: 'POST',
        headers: { cookie },
      });
      expect(finalize.status).toBe(409);
      expect((await finalize.json()) as { error: string }).not.toEqual({ error: ADVERTISING_PAUSED_REASON });

      const cancel = await app.request(`/v1/operator/cohorts/${cohortId}/cancel`, {
        method: 'POST',
        headers: { cookie },
      });
      expect(cancel.status).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
      expect((await listCohorts(app, cookie)).find((c) => c.draftId === cohortId)?.state).toBe('canceled');
    } finally {
      runner.stop();
    }
  });

  it('keeps the public reads answering, and the directory DTO byte-frozen', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      const cookie = await login(app);
      const draft = await createDraft(app, cookie);
      await advertise(app, cookie, draft.draftId);
      settings.pause();

      const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
      // The paused signal rides ServiceStatusDTO ONLY: the public per-cohort DTO gains nothing,
      // so a participant's cohort rows are byte-identical paused or running.
      expect(Object.keys(directory[0]).sort()).toEqual(
        ['beaconType', 'capacity', 'cohortId', 'joined', 'network', 'phase', 'threshold'].sort(),
      );
    } finally {
      runner.stop();
    }
  });
});

describe('the paused bit is ONE derivation shared with the gate (D-07)', () => {
  it('reports paused on GET /v1/status while paused and false after resume', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      const running = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
      expect(running.paused).toBe(false);

      settings.pause();
      const paused = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
      expect(paused.paused).toBe(true);

      settings.resume();
      const resumed = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
      expect(resumed.paused).toBe(false);
    } finally {
      runner.stop();
    }
  });

  it('carries the paused bit on the ServiceStatusDTO key set (migrated pin)', () => {
    const { runner, operatorCohorts } = pauseApp();
    try {
      const status = operatorCohorts.status();
      expect(Object.keys(status).sort()).toEqual(['network', 'openCohorts', 'paused', 'up'].sort());
    } finally {
      runner.stop();
    }
  });

  it('answers the no-operator-surface status fallback with the paused bit too', async () => {
    // A service booted without an operator password has no cohort surface at all, but its
    // status read must still carry the same key set: a headless client parses ONE shape.
    const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
    const app = createHonoApp(transport, { networkName: ACTIVE_NETWORK });
    const status = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
    expect(Object.keys(status).sort()).toEqual(['network', 'openCohorts', 'paused', 'up'].sort());
    expect(status.paused).toBe(false);
  });

  it('feeds the operator health strip from the SAME holder the gate reads', async () => {
    const { app, runner, settings, monitor } = pauseApp();
    try {
      const cookie = await login(app);
      expect(monitor.serviceHealth().paused).toBe(false);
      settings.pause();
      expect(monitor.serviceHealth().paused).toBe(true);

      // The console reads the strip off the gated list read it already polls.
      const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
      const body = (await res.json()) as { monitoring?: { health: { paused: boolean } } };
      expect(body.monitoring?.health.paused).toBe(true);
    } finally {
      runner.stop();
    }
  });
});

describe('POST /v1/operator/advertising/pause + /resume', () => {
  it('401s an anonymous caller for both routes', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      expect((await advertising(app, 'pause')).status).toBe(401);
      expect((await advertising(app, 'resume')).status).toBe(401);
      // ...and the anonymous attempt changed nothing.
      expect(settings.paused).toBe(false);
    } finally {
      runner.stop();
    }
  });

  it('pauses and resumes for an operator session, returning the resulting state', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      const cookie = await login(app);
      const paused = await advertising(app, 'pause', cookie);
      expect(paused.status).toBe(200);
      expect(await paused.json()).toEqual({ paused: true });
      expect(settings.paused).toBe(true);

      const resumed = await advertising(app, 'resume', cookie);
      expect(resumed.status).toBe(200);
      expect(await resumed.json()).toEqual({ paused: false });
      expect(settings.paused).toBe(false);
    } finally {
      runner.stop();
    }
  });

  it('is idempotent in both directions', async () => {
    const { app, runner, settings } = pauseApp();
    try {
      const cookie = await login(app);
      // Resuming an unpaused service is a no-op success, not an error: the operator asked for
      // an end state, and the service is already in it.
      expect((await advertising(app, 'resume', cookie)).status).toBe(200);
      expect(settings.paused).toBe(false);

      await advertising(app, 'pause', cookie);
      const second = await advertising(app, 'pause', cookie);
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ paused: true });
      expect(settings.paused).toBe(true);
    } finally {
      runner.stop();
    }
  });

  it('makes the advertise refusal and the public bit agree, in one round trip', async () => {
    const { app, runner } = pauseApp();
    try {
      const cookie = await login(app);
      const draft = await createDraft(app, cookie);
      await advertising(app, 'pause', cookie);

      // One pause, both consequences: the public claim and the enforced behavior are the same
      // read, so a service can never report paused while still advertising (or the reverse).
      const status = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
      expect(status.paused).toBe(true);
      expect((await advertise(app, cookie, draft.draftId)).status).toBe(409);

      await advertising(app, 'resume', cookie);
      const after = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
      expect(after.paused).toBe(false);
      expect((await advertise(app, cookie, draft.draftId)).status).toBe(200);
    } finally {
      runner.stop();
    }
  });
});
