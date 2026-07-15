import { AggregationServiceRunner, HttpServerTransport, type CohortConfig } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import { describe, expect, it, vi } from 'vitest';
import { createHonoApp } from './hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from './operator-auth.js';
import {
  createOperatorCohorts,
  type DirectoryCohortDTO,
  type OperatorCohortDTO,
  type ServiceStatusDTO,
} from './operator-cohorts.js';

// Hermetic coverage of the gated operator cohort routes (SVC-01) using the
// config.spec.ts / operator-auth.spec.ts idiom: an in-memory operator-enabled app
// (no port, no chain), login once to capture the session cookie, then drive
// create/validate/discard/list plus the mandatory no-session 401s. The service active
// network is threaded in as 'signet' so the DTO's network can be asserted against it
// (never a form value, D-10).

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';

/**
 * Build an operator-enabled app wired exactly as `index.ts` wires it, over a REAL
 * runner so the advertise path (`runner.advertiseCohort`) and the live-set-derived
 * directory/status can be exercised. The advert uses the runner's default repeating
 * broadcast (a fixed `advertRepeatIntervalMs: 0` would make it a `sendMessage` the
 * `HttpServerTransport` rejects with MISSING_RECIPIENT, failing the cohort instantly);
 * every test calls `runner.stop()` to clear that republish timer. `onProvideTxData` is
 * a stub because no cohort here reaches signing.
 */
function operatorCohortApp(autoFallbackOnStall = true) {
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
    // A high cap so the login-per-test setup never trips the throttle.
    throttle: createLoginThrottle({ maxAttempts: 1000, windowMs: 5 * 60_000 }),
    expectedPassword: PASSWORD,
    cookieSecure: false,
    sessionTtlMs: 60_000,
  };
  // Default the stall fallback ON so a k < n draft is representable (the demo server boots
  // with AUTO_FALLBACK on). The fallback-off guard test passes `false` explicitly.
  const operatorCohorts = createOperatorCohorts({ activeNetwork: ACTIVE_NETWORK, runner, autoFallbackOnStall });
  const app = createHonoApp(transport, { operatorAuth, operatorCohorts, runner, networkName: ACTIVE_NETWORK });
  return { app, runner };
}

/** POST a login and return the bare `operator_session=<id>` cookie for gated requests. */
async function login(app: ReturnType<typeof operatorCohortApp>['app']): Promise<string> {
  const res = await app.request('/v1/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

/** POST a create-draft body with the session cookie attached. */
async function createDraft(
  app: ReturnType<typeof operatorCohortApp>['app'],
  cookie: string,
  body: unknown,
): Promise<Response> {
  return app.request('/v1/operator/cohorts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

// The exact THRESHOLD_ERROR literal (byte-identical server + client, Decision 3).
const THRESHOLD_ERROR = 'Signing threshold must be a whole number between 1 and the cohort size.';
// The exact FALLBACK_OFF_ERROR literal (Decision 4).
const FALLBACK_OFF_ERROR =
  'A signing threshold below the cohort size needs the stall fallback, which this service disabled (AUTO_FALLBACK=0).';

describe('POST /v1/operator/cohorts (create draft)', () => {
  it('creates a validated CAS size-2 draft with threshold === capacity === n on the active network', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 2 });
    expect(res.status).toBe(201);
    const dto = (await res.json()) as OperatorCohortDTO;
    expect(dto.beaconType).toBe('CASBeacon');
    expect(dto.network).toBe(ACTIVE_NETWORK); // D-10: active network, never a form value
    // k == n default: an omitted threshold defaults to the size, so both numbers equal n.
    expect(dto.threshold).toBe(2);
    expect(dto.capacity).toBe(2);
    expect(dto.state).toBe('draft');
    expect(dto.draftId).toMatch(/[0-9a-f-]{36}/i); // a UUID
  });

  it('accepts a larger SMT size and still reports threshold === capacity === n', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'SMTBeacon', size: 5 });
    expect(res.status).toBe(201);
    const dto = (await res.json()) as OperatorCohortDTO;
    expect(dto.beaconType).toBe('SMTBeacon');
    // No threshold sent: k defaults to n, a 5-of-5 cohort with 5 seats.
    expect(dto.threshold).toBe(5);
    expect(dto.capacity).toBe(5);
  });

  it('accepts a two-field k < n draft with independent threshold (k) and capacity (n)', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 3, threshold: 2 });
    expect(res.status).toBe(201);
    const dto = (await res.json()) as OperatorCohortDTO;
    // The two numbers are surfaced independently: k = 2 (signing floor), n = 3 (seats).
    expect(dto.threshold).toBe(2);
    expect(dto.capacity).toBe(3);
    expect(dto.state).toBe('draft');
  });

  it('defaults k to n when threshold is null (k = n)', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 4, threshold: null });
    expect(res.status).toBe(201);
    const dto = (await res.json()) as OperatorCohortDTO;
    expect(dto.threshold).toBe(4);
    expect(dto.capacity).toBe(4);
  });

  it('rejects a threshold above the size with the exact THRESHOLD_ERROR 400', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 3, threshold: 4 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(THRESHOLD_ERROR);
  });

  it('rejects a threshold of 0 with the exact THRESHOLD_ERROR 400', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 3, threshold: 0 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(THRESHOLD_ERROR);
  });

  it('rejects a non-integer (string) threshold with the exact THRESHOLD_ERROR 400', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 3, threshold: '2' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(THRESHOLD_ERROR);
  });

  it('rejects a size below 1 with the specific 400 message', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 0 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Cohort size must be at least 1 signer.');
  });

  it('rejects an unknown beacon type with a 400', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'SingletonBeacon', size: 2 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/beacon type/i);
  });

  it('rejects a non-integer size with a 400', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 1.5 });
    expect(res.status).toBe(400);
  });

  it('rejects a k < n over-promise when the stall fallback is disabled (Decision 4)', async () => {
    // A service booted with AUTO_FALLBACK off cannot deliver "anchors with at least k of n",
    // so a k < size draft is refused with the exact FALLBACK_OFF_ERROR 400.
    const { app } = operatorCohortApp(false);
    const cookie = await login(app);
    const rejected = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 3, threshold: 2 });
    expect(rejected.status).toBe(400);
    const body = (await rejected.json()) as { error: string };
    expect(body.error).toBe(FALLBACK_OFF_ERROR);
    // k == n stays allowed either way (no over-promise to make).
    const accepted = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 3, threshold: 3 });
    expect(accepted.status).toBe(201);
    const dto = (await accepted.json()) as OperatorCohortDTO;
    expect(dto.threshold).toBe(3);
    expect(dto.capacity).toBe(3);
  });

  it('rejects a malformed JSON body with a 400', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await app.request('/v1/operator/cohorts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/operator/cohorts (list) + DELETE (discard)', () => {
  it('lists a created draft and removes it on discard', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const created = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 4 });
    const dto = (await created.json()) as OperatorCohortDTO;

    const listed = await app.request('/v1/operator/cohorts', { headers: { cookie } });
    expect(listed.status).toBe(200);
    const { cohorts } = (await listed.json()) as { cohorts: OperatorCohortDTO[] };
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].draftId).toBe(dto.draftId);
    expect(cohorts[0].state).toBe('draft');

    const discarded = await app.request(`/v1/operator/cohorts/${dto.draftId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(discarded.status).toBe(200);

    const relisted = await app.request('/v1/operator/cohorts', { headers: { cookie } });
    const after = (await relisted.json()) as { cohorts: OperatorCohortDTO[] };
    expect(after.cohorts).toHaveLength(0);
  });

  it('404s a discard of an unknown draft id', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await app.request('/v1/operator/cohorts/does-not-exist', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});

describe('operator cohort routes are gated (no session -> 401)', () => {
  it('401s POST /v1/operator/cohorts with no session cookie', async () => {
    const { app } = operatorCohortApp();
    const res = await app.request('/v1/operator/cohorts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ beaconType: 'CASBeacon', size: 2 }),
    });
    expect(res.status).toBe(401);
  });

  it('401s GET /v1/operator/cohorts with no session cookie', async () => {
    const { app } = operatorCohortApp();
    const res = await app.request('/v1/operator/cohorts');
    expect(res.status).toBe(401);
  });

  it('401s DELETE /v1/operator/cohorts/:id with no session cookie', async () => {
    const { app } = operatorCohortApp();
    const res = await app.request('/v1/operator/cohorts/whatever', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

/** POST the advertise action for a draft id with the session cookie attached. */
async function advertise(
  app: ReturnType<typeof operatorCohortApp>['app'],
  cookie: string,
  draftId: string,
): Promise<Response> {
  return app.request(`/v1/operator/cohorts/${draftId}/advertise`, {
    method: 'POST',
    headers: { cookie },
  });
}

describe('POST /v1/operator/cohorts/:id/advertise (advertise a draft)', () => {
  it('advertises a draft: it leaves the drafts list and becomes an open directory entry', async () => {
    const { app, runner } = operatorCohortApp();
    const cookie = await login(app);
    const created = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 2 });
    const draft = (await created.json()) as OperatorCohortDTO;

    const spy = vi.spyOn(runner, 'advertiseCohort');
    const res = await advertise(app, cookie, draft.draftId);
    expect(res.status).toBe(200);
    const advDto = (await res.json()) as OperatorCohortDTO;
    expect(advDto.state).toBe('advertised');
    // advertiseCohort is called EXACTLY once - the sole caller now lives here (D-17).
    expect(spy).toHaveBeenCalledTimes(1);
    const cohortId = advDto.draftId; // the row id is now the live cohort id

    // The draft is gone from the operator list; the advertised entry replaces it.
    const listed = await app.request('/v1/operator/cohorts', { headers: { cookie } });
    const { cohorts } = (await listed.json()) as { cohorts: OperatorCohortDTO[] };
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].state).toBe('advertised');

    // The public directory (no cookie) shows it as an open entry derived from the live set.
    const dir = await app.request('/v1/directory');
    expect(dir.status).toBe(200);
    const directory = (await dir.json()) as DirectoryCohortDTO[];
    expect(directory).toHaveLength(1);
    expect(directory[0].cohortId).toBe(cohortId);
    expect(directory[0].beaconType).toBe('CASBeacon');
    expect(directory[0].network).toBe(ACTIVE_NETWORK);
    expect(directory[0].threshold).toBe(2);
    expect(directory[0].capacity).toBe(2);
    expect(directory[0].joined).toBe(0);

    // The public status open-count matches the directory length (one source, D-09).
    const status = await app.request('/v1/status');
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as ServiceStatusDTO;
    expect(statusBody.up).toBe(true);
    expect(statusBody.network).toBe(ACTIVE_NETWORK);
    expect(statusBody.openCohorts).toBe(1);

    runner.stop();
  });

  it('drops the cohort from directory + status after its completion settles (no drift)', async () => {
    const { app, runner } = operatorCohortApp();
    const cookie = await login(app);
    const created = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 2 });
    const draft = (await created.json()) as OperatorCohortDTO;
    const advDto = (await (await advertise(app, cookie, draft.draftId)).json()) as OperatorCohortDTO;
    const cohortId = advDto.draftId;

    // Sanity: it is open before completion.
    expect(((await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[])).toHaveLength(1);

    // Settle the cohort (stopCohort rejects its completion); the enrichment map prunes
    // on completion.finally and the live set no longer holds it.
    runner.stopCohort(cohortId);
    await new Promise((r) => setTimeout(r, 20));

    const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
    expect(directory).toHaveLength(0);
    const status = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
    expect(status.openCohorts).toBe(0);

    runner.stop();
  });

  it('401s the advertise POST with no session cookie', async () => {
    const { app, runner } = operatorCohortApp();
    const res = await app.request('/v1/operator/cohorts/whatever/advertise', { method: 'POST' });
    expect(res.status).toBe(401);
    runner.stop();
  });

  it('404s advertising an unknown draft id', async () => {
    const { app, runner } = operatorCohortApp();
    const cookie = await login(app);
    const res = await advertise(app, cookie, 'does-not-exist');
    expect(res.status).toBe(404);
    runner.stop();
  });
});

/** POST the re-advertise action for an expired cohort id with the session cookie attached. */
async function readvertise(
  app: ReturnType<typeof operatorCohortApp>['app'],
  cookie: string,
  cohortId: string,
): Promise<Response> {
  return app.request(`/v1/operator/cohorts/${cohortId}/readvertise`, {
    method: 'POST',
    headers: { cookie },
  });
}

describe('cohort expiry is surfaced to the operator (never silently deleted)', () => {
  it('keeps an expired cohort out of /v1/directory but lists it to the operator as state: "expired" with a reason', async () => {
    const { app, runner } = operatorCohortApp();
    const cookie = await login(app);
    const created = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 2 });
    const draft = (await created.json()) as OperatorCohortDTO;
    const advDto = (await (await advertise(app, cookie, draft.draftId)).json()) as OperatorCohortDTO;
    const cohortId = advDto.draftId;

    // Force the completion to reject (stall / stop / TTL all reject the completion the
    // same way); await the microtask turn so the settlement runs.
    runner.stopCohort(cohortId);
    await new Promise((r) => setTimeout(r, 20));

    // The participant surface is genuinely empty (the expired cohort is gone from the
    // live open set), exactly as before.
    const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
    expect(directory).toHaveLength(0);
    const status = (await (await app.request('/v1/status')).json()) as ServiceStatusDTO;
    expect(status.openCohorts).toBe(0);

    // But the operator list now surfaces it as an expired terminal record with a reason.
    const listed = await app.request('/v1/operator/cohorts', { headers: { cookie } });
    const { cohorts } = (await listed.json()) as { cohorts: OperatorCohortDTO[] };
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].draftId).toBe(cohortId);
    expect(cohorts[0].state).toBe('expired');
    expect(typeof cohorts[0].reason).toBe('string');
    expect(cohorts[0].reason).toBeTruthy();
    // The retained config's shape is preserved (n-of-n size 2).
    expect(cohorts[0].threshold).toBe(2);
    expect(cohorts[0].capacity).toBe(2);
    expect(cohorts[0].joined).toBe(0);

    runner.stop();
  });

  it('re-advertises an expired cohort: a fresh advertised DTO, back in the directory, and the expired record gone', async () => {
    const { app, runner } = operatorCohortApp();
    const cookie = await login(app);
    const created = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 2 });
    const draft = (await created.json()) as OperatorCohortDTO;
    const advDto = (await (await advertise(app, cookie, draft.draftId)).json()) as OperatorCohortDTO;
    const expiredId = advDto.draftId;

    runner.stopCohort(expiredId);
    await new Promise((r) => setTimeout(r, 20));

    const spy = vi.spyOn(runner, 'advertiseCohort');
    const res = await readvertise(app, cookie, expiredId);
    expect(res.status).toBe(200);
    const revived = (await res.json()) as OperatorCohortDTO;
    expect(revived.state).toBe('advertised');
    // A fresh live cohort id (a re-advertise is a SECOND operator-driven advertiseCohort).
    expect(spy).toHaveBeenCalledTimes(1);
    const newCohortId = revived.draftId;

    // The expired terminal record is gone; the operator list now shows the live one.
    const listed = await app.request('/v1/operator/cohorts', { headers: { cookie } });
    const { cohorts } = (await listed.json()) as { cohorts: OperatorCohortDTO[] };
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].state).toBe('advertised');
    expect(cohorts[0].draftId).toBe(newCohortId);

    // The revived cohort is an open participant-directory entry again.
    const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
    expect(directory).toHaveLength(1);
    expect(directory[0].cohortId).toBe(newCohortId);

    runner.stop();
  });

  it('401s the re-advertise POST with no session cookie', async () => {
    const { app, runner } = operatorCohortApp();
    const res = await app.request('/v1/operator/cohorts/whatever/readvertise', { method: 'POST' });
    expect(res.status).toBe(401);
    runner.stop();
  });

  it('404s re-advertising an unknown (or non-expired) cohort id', async () => {
    const { app, runner } = operatorCohortApp();
    const cookie = await login(app);
    const res = await readvertise(app, cookie, 'does-not-exist');
    expect(res.status).toBe(404);
    runner.stop();
  });
});

describe('two-field k-of-n: config contract + honest DTO flip at every read path', () => {
  it('sets fallbackThreshold = k while pinning maxParticipants === minParticipants === size', async () => {
    const { app, runner } = operatorCohortApp();
    const cookie = await login(app);
    const created = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 3, threshold: 2 });
    const draft = (await created.json()) as OperatorCohortDTO;

    // Inspect the CohortConfig handed to the runner on advertise (the built config).
    const spy = vi.spyOn(runner, 'advertiseCohort');
    await advertise(app, cookie, draft.draftId);
    const config = spy.mock.calls[0][0] as CohortConfig;
    // T-KOFN-04: only fallbackThreshold carries k; the seat pin stays min == max == n.
    expect(config.minParticipants).toBe(3);
    expect(config.maxParticipants).toBe(3);
    expect(config.fallbackThreshold).toBe(2);
    expect(config.fallbackThreshold ?? 0).toBeLessThanOrEqual(config.maxParticipants ?? config.minParticipants);

    runner.stop();
  });

  it('surfaces threshold = k / capacity = n at the directory + operator-list read paths (k < n)', async () => {
    const { app, runner } = operatorCohortApp();
    const cookie = await login(app);
    const created = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 3, threshold: 2 });
    const draft = (await created.json()) as OperatorCohortDTO;
    const advDto = (await (await advertise(app, cookie, draft.draftId)).json()) as OperatorCohortDTO;
    expect(advDto.threshold).toBe(2);
    expect(advDto.capacity).toBe(3);

    const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
    expect(directory).toHaveLength(1);
    expect(directory[0].threshold).toBe(2);
    expect(directory[0].capacity).toBe(3);

    const listed = (await (await app.request('/v1/operator/cohorts', { headers: { cookie } })).json()) as {
      cohorts: OperatorCohortDTO[];
    };
    expect(listed.cohorts[0].threshold).toBe(2);
    expect(listed.cohorts[0].capacity).toBe(3);

    runner.stop();
  });

  it('carries threshold = k / capacity = n onto an expired terminal record and its re-advertise', async () => {
    const { app, runner } = operatorCohortApp();
    const cookie = await login(app);
    const created = await createDraft(app, cookie, { beaconType: 'CASBeacon', size: 3, threshold: 2 });
    const draft = (await created.json()) as OperatorCohortDTO;
    const advDto = (await (await advertise(app, cookie, draft.draftId)).json()) as OperatorCohortDTO;
    const cohortId = advDto.draftId;

    runner.stopCohort(cohortId);
    await new Promise((r) => setTimeout(r, 20));

    const listed = (await (await app.request('/v1/operator/cohorts', { headers: { cookie } })).json()) as {
      cohorts: OperatorCohortDTO[];
    };
    const expiredRow = listed.cohorts.find((c) => c.draftId === cohortId);
    expect(expiredRow?.state).toBe('expired'); // the F2 expired terminal record
    expect(expiredRow?.threshold).toBe(2);
    expect(expiredRow?.capacity).toBe(3);

    const revived = (await (await readvertise(app, cookie, cohortId)).json()) as OperatorCohortDTO;
    expect(revived.threshold).toBe(2);
    expect(revived.capacity).toBe(3);

    runner.stop();
  });
});

describe('public /v1/directory + /v1/status (no session required)', () => {
  it('both 200 with an empty directory / zero open count before anything is advertised', async () => {
    const { app, runner } = operatorCohortApp();
    const dir = await app.request('/v1/directory');
    expect(dir.status).toBe(200);
    expect(await dir.json()).toEqual([]);

    const status = await app.request('/v1/status');
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ up: true, network: ACTIVE_NETWORK, openCohorts: 0 });

    runner.stop();
  });
});
