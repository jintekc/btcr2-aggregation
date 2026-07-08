import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { describe, expect, it } from 'vitest';
import { createHonoApp } from './hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from './operator-auth.js';
import { createOperatorCohorts, type OperatorCohortDTO } from './operator-cohorts.js';

// Hermetic coverage of the gated operator cohort routes (SVC-01) using the
// config.spec.ts / operator-auth.spec.ts idiom: an in-memory operator-enabled app
// (no port, no chain), login once to capture the session cookie, then drive
// create/validate/discard/list plus the mandatory no-session 401s. The service active
// network is threaded in as 'signet' so the DTO's network can be asserted against it
// (never a form value, D-10).

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';

/** Build an operator-enabled app wired exactly as `index.ts` will wire it (Task 1 GREEN). */
function operatorCohortApp() {
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  const sessions = createSessionStore(60_000);
  const operatorAuth: OperatorAuthConfig = {
    sessions,
    // A high cap so the login-per-test setup never trips the throttle.
    throttle: createLoginThrottle({ maxAttempts: 1000, windowMs: 5 * 60_000 }),
    expectedPassword: PASSWORD,
    cookieSecure: false,
    sessionTtlMs: 60_000,
  };
  const operatorCohorts = createOperatorCohorts({ activeNetwork: ACTIVE_NETWORK });
  const app = createHonoApp(transport, { operatorAuth, operatorCohorts, networkName: ACTIVE_NETWORK });
  return { app };
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

describe('POST /v1/operator/cohorts (create draft)', () => {
  it('creates a validated CAS 2-of-2 capacity-2 draft on the service active network', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', threshold: 2, capacity: 2 });
    expect(res.status).toBe(201);
    const dto = (await res.json()) as OperatorCohortDTO;
    expect(dto.beaconType).toBe('CASBeacon');
    expect(dto.network).toBe(ACTIVE_NETWORK); // D-10: active network, never a form value
    expect(dto.threshold).toBe(2);
    expect(dto.capacity).toBe(2);
    expect(dto.state).toBe('draft');
    expect(dto.draftId).toMatch(/[0-9a-f-]{36}/i); // a UUID
  });

  it('accepts an SMT draft with capacity above the threshold', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'SMTBeacon', threshold: 2, capacity: 5 });
    expect(res.status).toBe(201);
    const dto = (await res.json()) as OperatorCohortDTO;
    expect(dto.beaconType).toBe('SMTBeacon');
    expect(dto.capacity).toBe(5);
  });

  it('rejects capacity below the threshold with the specific 400 message', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', threshold: 3, capacity: 2 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Capacity must be at least the co-sign threshold.');
  });

  it('rejects a threshold below 1 with the specific 400 message', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', threshold: 0, capacity: 2 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Threshold must be at least 1 signer.');
  });

  it('rejects an unknown beacon type with a 400', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'SingletonBeacon', threshold: 2, capacity: 2 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/beacon type/i);
  });

  it('rejects a non-integer threshold with a 400', async () => {
    const { app } = operatorCohortApp();
    const cookie = await login(app);
    const res = await createDraft(app, cookie, { beaconType: 'CASBeacon', threshold: 1.5, capacity: 2 });
    expect(res.status).toBe(400);
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
    const created = await createDraft(app, cookie, { beaconType: 'CASBeacon', threshold: 2, capacity: 4 });
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
      body: JSON.stringify({ beaconType: 'CASBeacon', threshold: 2, capacity: 2 }),
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
