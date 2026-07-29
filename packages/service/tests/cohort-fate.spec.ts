import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { createCohortIntents } from '../src/cohort-intent.js';
import { createCohortMonitor } from '../src/monitor.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from '../src/operator-auth.js';
import { createOperatorCohorts, type OperatorCohortDTO } from '../src/operator-cohorts.js';

/**
 * The PUBLIC, non-oracle cohort-fate read `GET /v1/cohort-fate/:id` (SVC-04, D-02).
 *
 * A seated participant learns their cohort is gone only through the directory poll's post-seat
 * gone streak, and the aggregation protocol has no message type that could carry an operator's
 * cancel to them. This read is the ONE bit that can be carried out of band, so that a canceled
 * participant is told the operator ended the cohort instead of the honest-but-vague fallback.
 *
 * Two properties are load-bearing and are asserted here rather than described:
 *
 * 1. **It is not an existence oracle** (T-05-10-01). An unknown id, an EVICTED id (one whose
 *    terminal record aged out of the bounded retention), and a never-existed id must be
 *    indistinguishable. That is asserted by DEEP EQUALITY between the three responses rather
 *    than case by case, because three separate `toEqual({ canceled: false })` assertions would
 *    still pass if one of them started answering 404 or grew an extra key.
 * 2. **It carries the canceled fact and nothing else** (T-05-10-02). One key. No reason string,
 *    no member count, no member DID, no amount - every one of those stays behind the gated
 *    operator reads.
 *
 * The COMPLETED-normally case needs no fixture of its own: `settleCompletion` PRUNES a cohort's
 * retained record on success (operator-cohorts.ts), so a completed cohort holds no terminal
 * record at all and takes the same unknown default the deep-equality test already pins. The
 * live-cohort and draft rows below cover the two non-terminal states directly.
 *
 * Every test calls `runner.stop()` so the runner's advert republish timer never leaks.
 */

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';

/** The retained terminal-record cap in `operator-cohorts.ts`; one more than this evicts the oldest. */
const MAX_TERMINAL = 24;

/**
 * An operator-enabled app wired as `index.ts` wires it for the cancel path (one intent registry
 * shared by the action and the settlement, one monitoring fold, the event-time `onCancel` hook).
 * The operator surface is present precisely so the fate read can be shown to answer ANONYMOUSLY
 * on a service that does gate everything else.
 */
function fateApp() {
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
  return { app, runner, operatorCohorts };
}

/** POST a login and return the bare `operator_session=<id>` cookie for gated requests. */
async function login(app: ReturnType<typeof fateApp>['app']): Promise<string> {
  const res = await app.request('/v1/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

/** Create a draft; returns the DRAFT id (never advertised). */
async function createDraft(app: ReturnType<typeof fateApp>['app'], cookie: string): Promise<string> {
  const created = await app.request('/v1/operator/cohorts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ beaconType: 'CASBeacon', size: 2, threshold: 2 }),
  });
  return ((await created.json()) as OperatorCohortDTO).draftId;
}

/** Create a draft and advertise it in one step; returns the LIVE cohort id. */
async function createAndAdvertise(
  app: ReturnType<typeof fateApp>['app'],
  cookie: string,
): Promise<string> {
  const draftId = await createDraft(app, cookie);
  const advertised = await app.request(`/v1/operator/cohorts/${draftId}/advertise`, {
    method: 'POST',
    headers: { cookie },
  });
  return ((await advertised.json()) as OperatorCohortDTO).draftId;
}

/** Read the PUBLIC fate route with NO session cookie: the whole point is that a stranger can. */
async function anonymousFate(
  app: ReturnType<typeof fateApp>['app'],
  cohortId: string,
): Promise<{ status: number; body: unknown }> {
  const res = await app.request(`/v1/cohort-fate/${cohortId}`);
  return { status: res.status, body: await res.json() };
}

/** Let the completion rejection drive `settleCompletion` on the next microtask turn. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

describe('GET /v1/cohort-fate/:id carries the canceled fact', () => {
  it('answers the canceled fact TRUE for a canceled cohort, with no session at all', async () => {
    const { app, runner, operatorCohorts } = fateApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    expect(operatorCohorts.cancelCohort(cohortId)).toBe('ok');
    await settle();

    const { status, body } = await anonymousFate(app, cohortId);
    expect(status).toBe(200);
    expect(body).toEqual({ canceled: true });

    runner.stop();
  });

  it('answers FALSE for a live advertised cohort and for a draft (only a deliberate cancel is attributed)', async () => {
    const { app, runner } = fateApp();
    const cookie = await login(app);
    const live = await createAndAdvertise(app, cookie);
    const draft = await createDraft(app, cookie);

    expect((await anonymousFate(app, live)).body).toEqual({ canceled: false });
    expect((await anonymousFate(app, draft)).body).toEqual({ canceled: false });

    runner.stop();
  });

  it('answers FALSE for a cohort that ended on its own, so an expiry is never read as a cancel', async () => {
    const { app, runner, operatorCohorts } = fateApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);

    // The whole-runner stop rejects the completion through the SAME channel a cancel does, with
    // no intent declared: it files the `expired` fate. If the fate read keyed on the rejection
    // rather than on the record's own fate, this would read canceled.
    runner.stop();
    await settle();

    const listed = await app.request('/v1/operator/cohorts', { headers: { cookie } });
    const rows = ((await listed.json()) as { cohorts: OperatorCohortDTO[] }).cohorts;
    expect(rows.find((r) => r.draftId === cohortId)?.state).toBe('expired');
    expect((await anonymousFate(app, cohortId)).body).toEqual({ canceled: false });
    expect(operatorCohorts.cohortFate(cohortId)).toEqual({ canceled: false });
  });

  it('carries exactly one key: no reason, no member count, no DID, and no amount', async () => {
    const { app, runner, operatorCohorts } = fateApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    operatorCohorts.cancelCohort(cohortId);
    await settle();

    const { body } = await anonymousFate(app, cohortId);
    expect(Object.keys(body as object)).toEqual(['canceled']);
    // The operator-only fields the terminal record DOES hold must not have followed the bit out.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/reason|canceled by the operator|did:|seats|capacity|amount|sats/i);

    runner.stop();
  });
});

describe('GET /v1/cohort-fate/:id is not an existence oracle (T-05-10-01)', () => {
  it('answers an unknown, an EVICTED, and a never-existed id byte-identically', async () => {
    const { app, runner, operatorCohorts } = fateApp();
    const cookie = await login(app);

    // Cancel one more cohort than the retention cap, so the FIRST canceled record is evicted.
    // An evicted cancel is the interesting case: the service really did cancel it, and the read
    // must still be indistinguishable from an id it never heard of.
    const canceled: string[] = [];
    for (let i = 0; i < MAX_TERMINAL + 1; i += 1) {
      const cohortId = await createAndAdvertise(app, cookie);
      expect(operatorCohorts.cancelCohort(cohortId)).toBe('ok');
      canceled.push(cohortId);
      await settle();
    }
    const evicted = canceled[0];
    const newest = canceled[canceled.length - 1];
    // Sanity: the newest cancel is still retained, so the eviction below is a real eviction and
    // not a read that stopped working for everyone.
    expect((await anonymousFate(app, newest)).body).toEqual({ canceled: true });

    const unknown = await anonymousFate(app, 'a-cohort-id-this-service-never-issued');
    const gone = await anonymousFate(app, evicted);
    const neverExisted = await anonymousFate(app, 'zzzzzzzz-0000-4000-8000-zzzzzzzzzzzz'.replace(/z/g, 'b'));

    // Deep equality across all three, status included: one assertion that cannot be satisfied by
    // three separately-correct-looking answers that differ in status code or key set.
    expect(gone).toEqual(unknown);
    expect(neverExisted).toEqual(unknown);
    expect(unknown).toEqual({ status: 200, body: { canceled: false } });

    runner.stop();
  });

  it('answers 400 for a malformed id and NEVER 404, so the status code is not an oracle either', async () => {
    const { app, runner, operatorCohorts } = fateApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    operatorCohorts.cancelCohort(cohortId);
    await settle();

    expect((await app.request('/v1/cohort-fate/not a cohort id')).status).toBe(400);
    expect((await app.request(`/v1/cohort-fate/${'x'.repeat(65)}`)).status).toBe(400);
    // A traversal attempt that DOES reach the handler as one segment (a multi-segment path is a
    // router miss, which is the same answer for every input and carries no cohort information).
    expect(
      (await app.request(`/v1/cohort-fate/${encodeURIComponent('../../etc/passwd')}`)).status,
    ).toBe(400);

    // Every WELL-FORMED id - canceled, unknown, evicted - is a 200. Nothing answers 404.
    for (const id of [cohortId, 'unknown-cohort', 'another-unknown-cohort']) {
      expect((await app.request(`/v1/cohort-fate/${id}`)).status).toBe(200);
    }

    runner.stop();
  });

  it('answers the SAME neutral shape on a service with no operator surface configured at all', async () => {
    // A fail-closed boot (no OPERATOR_PASSWORD) mounts no operator routes. The fate read must
    // still exist and still answer neutrally: omitting the route there would make the presence
    // of a 404-vs-200 a signal about how the service was booted.
    const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
    const app = createHonoApp(transport, { networkName: ACTIVE_NETWORK });

    const res = await app.request('/v1/cohort-fate/any-cohort-id');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ canceled: false });
  });

  it('is reachable ANONYMOUSLY on a service whose operator surface is gated (401 stays for the gated read)', async () => {
    const { app, runner, operatorCohorts } = fateApp();
    const cookie = await login(app);
    const cohortId = await createAndAdvertise(app, cookie);
    operatorCohorts.cancelCohort(cohortId);
    await settle();

    // The gated operator read still refuses the same anonymous caller: the fate route widens
    // exactly one bit and nothing else (ADR 0015 gating byte-untouched).
    expect((await app.request('/v1/operator/cohorts')).status).toBe(401);
    expect((await anonymousFate(app, cohortId)).body).toEqual({ canceled: true });

    runner.stop();
  });
});
