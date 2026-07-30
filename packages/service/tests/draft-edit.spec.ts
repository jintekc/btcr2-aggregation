import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { createCohortIntents } from '../src/cohort-intent.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createRuntimeSettings, type RuntimeSettingsSeed } from '../src/runtime-settings.js';
import { createLoginThrottle, createSessionStore, type OperatorAuthConfig } from '../src/operator-auth.js';
import {
  createOperatorCohorts,
  type DirectoryCohortDTO,
  type DraftInput,
  type OperatorCohortDTO,
} from '../src/operator-cohorts.js';

/**
 * Hermetic coverage of IN-PLACE DRAFT EDITING (SVC-04 criterion 3, D-10/D-13).
 *
 * Two claims carry this file.
 *
 * ONE VALIDATOR. `createDraft` and `updateDraft` share exactly one `validateDraft`, so a rule can
 * never be enforced on the create path and skipped on the edit path. The parity tests below assert
 * that by driving the SAME invalid body through BOTH verbs and comparing the thrown messages for
 * equality, rather than re-typing an expected literal: a re-typed string would still pass if the
 * edit path grew a second, subtly different validator, which is precisely the drift under test.
 *
 * NEXT-COHORT-ONLY IS ENFORCED, NOT STATED. A cohort that is already advertised (or in flight, or
 * terminal) cannot be reshaped at all: its advert is public and its seats may already be filling,
 * so a participant who joined a 2-of-3 CAS cohort must never find themselves bound to a 5-of-5 SMT
 * one. `updateDraft` returns `undefined` for every non-draft id so the route answers 404, and the
 * cohort's served shape is asserted UNCHANGED after the refusal.
 */

const PASSWORD = 'correct-horse-battery-staple';
const ACTIVE_NETWORK = 'signet';
const MINUTE = 60_000;

/**
 * An operator-enabled app wired exactly as `index.ts` wires it, over a REAL runner so the advertise
 * path and the live-set-derived public reads are genuinely exercised. Returns the cohort surface
 * itself as well as the app, because the validation-parity assertions call the two verbs directly
 * (comparing thrown Errors is only possible below the HTTP boundary, where a thrown message has
 * already been flattened into a 400 body).
 */
function draftEditApp(autoFallbackOnStall = true, seed: RuntimeSettingsSeed = {}) {
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

  const operatorAuth: OperatorAuthConfig = {
    sessions: createSessionStore(60_000),
    throttle: createLoginThrottle({ maxAttempts: 1000, windowMs: 5 * 60_000 }),
    expectedPassword: PASSWORD,
    cookieSecure: false,
    sessionTtlMs: 60_000,
  };
  const settings = createRuntimeSettings(seed);
  const operatorCohorts = createOperatorCohorts({
    activeNetwork: ACTIVE_NETWORK,
    runner,
    autoFallbackOnStall,
    intents: createCohortIntents(),
    settings,
  });
  const app = createHonoApp(transport, {
    operatorAuth,
    operatorCohorts,
    runtimeSettings: settings,
    networkName: ACTIVE_NETWORK,
  });
  return { app, runner, operatorCohorts, settings };
}

/** POST a login and return the bare `operator_session=<id>` cookie for gated requests. */
async function login(app: ReturnType<typeof draftEditApp>['app']): Promise<string> {
  const res = await app.request('/v1/operator/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

/** PATCH a draft through the real gated route. */
function patchDraft(
  app: ReturnType<typeof draftEditApp>['app'],
  cookie: string,
  id: string,
  body: unknown,
  raw = false,
): Promise<Response> {
  return app.request(`/v1/operator/cohorts/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

/** The message a verb threw for `input`, or undefined when it did not throw. */
function thrownMessage(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe('updateDraft reshapes a draft in place', () => {
  it('replaces the draft config + DTO under the SAME draft id', () => {
    const { runner, operatorCohorts } = draftEditApp();
    const created = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    const updated = operatorCohorts.updateDraft(created.draftId, {
      beaconType: 'SMTBeacon',
      size: 5,
      threshold: 3,
    });

    // The id is STABLE across an edit, so the console row does not re-key (and the operator does
    // not watch their draft vanish and a stranger appear in its place).
    expect(updated?.draftId).toBe(created.draftId);
    expect(updated?.beaconType).toBe('SMTBeacon');
    expect(updated?.capacity).toBe(5);
    expect(updated?.threshold).toBe(3);
    expect(updated?.state).toBe('draft');

    // In place: one draft before, one draft after, carrying the NEW shape.
    const listed = operatorCohorts.listCohorts();
    expect(listed).toHaveLength(1);
    expect(listed[0].draftId).toBe(created.draftId);
    expect(listed[0].beaconType).toBe('SMTBeacon');
    expect(listed[0].capacity).toBe(5);
    expect(listed[0].threshold).toBe(3);

    runner.stop();
  });

  it('carries the edited shape into the ADVERTISED cohort, so the edit really took', async () => {
    const { app, runner, operatorCohorts } = draftEditApp();
    const created = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    operatorCohorts.updateDraft(created.draftId, { beaconType: 'SMTBeacon', size: 4, threshold: 2 });
    operatorCohorts.advertiseDraft(created.draftId);

    const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
    expect(directory).toHaveLength(1);
    expect(directory[0].beaconType).toBe('SMTBeacon');
    expect(directory[0].capacity).toBe(4);
    expect(directory[0].threshold).toBe(2);

    runner.stop();
  });

  it('leaves the unedited fields at their current values when only one changes', () => {
    const { runner, operatorCohorts } = draftEditApp();
    const created = operatorCohorts.createDraft({ beaconType: 'SMTBeacon', size: 3, threshold: 2 });
    // Only the size moves; the browser always sends the whole current shape, so beacon type and k
    // ride through unchanged (UI-SPEC E6 partial).
    const updated = operatorCohorts.updateDraft(created.draftId, {
      beaconType: 'SMTBeacon',
      size: 4,
      threshold: 2,
    });
    expect(updated?.beaconType).toBe('SMTBeacon');
    expect(updated?.threshold).toBe(2);
    expect(updated?.capacity).toBe(4);

    runner.stop();
  });
});

/**
 * THE SUCCESSFUL WINDOW EDIT (audit #29, SVC-04 criterion 3, D-11/D-13).
 *
 * Every other row in this file that touches the edit path either passes no window key at all or
 * (in `discovery-window.spec.ts`) supplies one that is refused by `validateDraft` before the update
 * verb ever assembles anything. So the assembly itself - the four-way conditional spread that
 * decides which explicit windows an edited draft carries - was unexecuted source, and a refactor
 * that MERGED the supplied keys over the previous draft's own explicit windows would have shipped
 * green while silently keeping a window the operator had just cleared.
 *
 * The consequence is a broken promise rather than a crash: the console tells the operator that an
 * empty timing field means "use this service's default" (`operator-cohorts.ts`, `effectiveWindows`),
 * and clearing the field would not have made that true.
 *
 * Each window is driven BOTH ways on purpose. A clearing row on its own would pass just as happily
 * against code that never wrote an explicit window at all, so the setting row is what proves the
 * clearing row is measuring a real transition. Both are read back twice, from the update verb's own
 * return value AND from the served gated list, because a response DTO assembled separately from the
 * stored draft would satisfy one and not the other.
 */
describe('a per-cohort timing window can be CLEARED and SET on the edit path (audit #29)', () => {
  /** The gated list as the operator's console really reads it, by draft id. */
  async function servedRow(
    app: ReturnType<typeof draftEditApp>['app'],
    cookie: string,
    draftId: string,
  ): Promise<OperatorCohortDTO | undefined> {
    const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
    const { cohorts } = (await res.json()) as { cohorts: OperatorCohortDTO[] };
    return cohorts.find((c) => c.draftId === draftId);
  }

  it('CLEARS a discovery window the draft carried, on the DTO and on the served list', async () => {
    // The service has a default of its own, so "cleared" has to mean "falls back to the service
    // default", not "has no window at all". Both halves are asserted below.
    const { app, runner, operatorCohorts } = draftEditApp(true, { defaultDiscoveryWindowMs: 20 * MINUTE });
    const cookie = await login(app);
    const created = operatorCohorts.createDraft({
      beaconType: 'CASBeacon',
      size: 2,
      discoveryWindowMs: 10 * MINUTE,
    });
    expect(created.discoveryWindowMs).toBe(10 * MINUTE);

    // The console sends the whole current shape with the timing field left empty, which is the
    // key omitted entirely (the browser's null is normalized to undefined by the validator).
    const updated = operatorCohorts.updateDraft(created.draftId, {
      beaconType: 'CASBeacon',
      size: 2,
      threshold: 2,
    });

    // ABSENT, not an explicit undefined and not a zero: the wire shape is additive, so the console
    // can tell "no window of my own" apart from "a window of nothing".
    expect(updated?.discoveryWindowMs).toBeUndefined();
    expect(updated && 'discoveryWindowMs' in updated).toBe(false);
    // ...and the service's own default is still carried, which is what makes the empty field mean
    // "use this service's default" rather than "no window".
    expect(updated?.defaultDiscoveryWindowMs).toBe(20 * MINUTE);

    // The same fact off the STORED draft, not only off the response the verb just built.
    const served = await servedRow(app, cookie, created.draftId);
    expect(served?.discoveryWindowMs).toBeUndefined();
    expect(served && 'discoveryWindowMs' in served).toBe(false);
    expect(served?.defaultDiscoveryWindowMs).toBe(20 * MINUTE);

    runner.stop();
  });

  it('SETS a discovery window on a draft that had none, on the DTO and on the served list', async () => {
    // The positive twin. Without it the clearing row above would pass against an assembly that
    // never wrote an explicit window in the first place.
    const { app, runner, operatorCohorts } = draftEditApp();
    const cookie = await login(app);
    const created = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    expect(created.discoveryWindowMs).toBeUndefined();

    const updated = operatorCohorts.updateDraft(created.draftId, {
      beaconType: 'CASBeacon',
      size: 2,
      threshold: 2,
      discoveryWindowMs: 7 * MINUTE,
    });
    expect(updated?.discoveryWindowMs).toBe(7 * MINUTE);

    const served = await servedRow(app, cookie, created.draftId);
    expect(served?.discoveryWindowMs).toBe(7 * MINUTE);

    runner.stop();
  });

  it('CLEARS a funding window the draft carried, on the DTO and on the served list', async () => {
    // The assembly handles both windows in one expression, so a refactor that merged one would
    // almost certainly merge both; each window therefore gets its own pair rather than riding on
    // the other's.
    const { app, runner, operatorCohorts } = draftEditApp(true, { defaultFundingWindowMs: 12 * MINUTE });
    const cookie = await login(app);
    const created = operatorCohorts.createDraft({
      beaconType: 'CASBeacon',
      size: 2,
      fundingWindowMs: 6 * MINUTE,
    });
    expect(created.fundingWindowMs).toBe(6 * MINUTE);

    const updated = operatorCohorts.updateDraft(created.draftId, {
      beaconType: 'CASBeacon',
      size: 2,
      threshold: 2,
    });
    expect(updated?.fundingWindowMs).toBeUndefined();
    expect(updated && 'fundingWindowMs' in updated).toBe(false);
    expect(updated?.defaultFundingWindowMs).toBe(12 * MINUTE);

    const served = await servedRow(app, cookie, created.draftId);
    expect(served?.fundingWindowMs).toBeUndefined();
    expect(served && 'fundingWindowMs' in served).toBe(false);
    expect(served?.defaultFundingWindowMs).toBe(12 * MINUTE);

    runner.stop();
  });

  it('SETS a funding window on a draft that had none, on the DTO and on the served list', async () => {
    const { app, runner, operatorCohorts } = draftEditApp();
    const cookie = await login(app);
    const created = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    expect(created.fundingWindowMs).toBeUndefined();

    const updated = operatorCohorts.updateDraft(created.draftId, {
      beaconType: 'CASBeacon',
      size: 2,
      threshold: 2,
      fundingWindowMs: 4 * MINUTE,
    });
    expect(updated?.fundingWindowMs).toBe(4 * MINUTE);

    const served = await servedRow(app, cookie, created.draftId);
    expect(served?.fundingWindowMs).toBe(4 * MINUTE);

    runner.stop();
  });

  it('clears ONE window while leaving the other, so the two are assembled independently', async () => {
    // A merge refactor and a swap refactor both survive a single-window pair; only a row that moves
    // exactly one of the two can tell the assembly reads each key on its own.
    const { runner, operatorCohorts } = draftEditApp();
    const created = operatorCohorts.createDraft({
      beaconType: 'CASBeacon',
      size: 2,
      discoveryWindowMs: 10 * MINUTE,
      fundingWindowMs: 6 * MINUTE,
    });

    const updated = operatorCohorts.updateDraft(created.draftId, {
      beaconType: 'CASBeacon',
      size: 2,
      threshold: 2,
      fundingWindowMs: 6 * MINUTE,
    });
    expect(updated?.discoveryWindowMs).toBeUndefined();
    expect(updated?.fundingWindowMs).toBe(6 * MINUTE);

    runner.stop();
  });

  it('leaves every OTHER field exactly as supplied when neither window is sent', async () => {
    // The assembly rebuilds the whole DTO, so it is also the place a clobber would happen. This row
    // is what says the window work does not disturb the shape the operator actually edited.
    const { app, runner, operatorCohorts } = draftEditApp();
    const cookie = await login(app);
    const created = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });

    const updated = operatorCohorts.updateDraft(created.draftId, {
      beaconType: 'SMTBeacon',
      size: 5,
      threshold: 3,
    });
    expect(updated).toEqual({
      draftId: created.draftId,
      beaconType: 'SMTBeacon',
      network: ACTIVE_NETWORK,
      threshold: 3,
      capacity: 5,
      joined: 0,
      state: 'draft',
    });

    const served = await servedRow(app, cookie, created.draftId);
    expect(served).toEqual(updated);

    runner.stop();
  });
});

describe('create and edit share exactly ONE validator', () => {
  // Every invalid body below is driven through BOTH verbs and the two thrown messages are compared
  // for EQUALITY. Comparing rather than re-typing is the point: a second validator on the edit path
  // that refused with different words would pass a literal assertion and fail this one.
  const invalidBodies: { name: string; body: DraftInput }[] = [
    { name: 'a size below 1', body: { beaconType: 'CASBeacon', size: 0 } },
    { name: 'a non-integer size', body: { beaconType: 'CASBeacon', size: 1.5 } },
    { name: 'a threshold above the size', body: { beaconType: 'CASBeacon', size: 3, threshold: 4 } },
    { name: 'a threshold of 0', body: { beaconType: 'CASBeacon', size: 3, threshold: 0 } },
    {
      name: 'a non-integer (string) threshold',
      body: { beaconType: 'CASBeacon', size: 3, threshold: '2' as unknown as number },
    },
    { name: 'an unknown beacon type', body: { beaconType: 'SingletonBeacon', size: 2 } },
  ];

  for (const { name, body } of invalidBodies) {
    it(`refuses ${name} with the SAME message from createDraft and updateDraft`, () => {
      const { runner, operatorCohorts } = draftEditApp();
      const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });

      const onCreate = thrownMessage(() => operatorCohorts.createDraft(body));
      const onUpdate = thrownMessage(() => operatorCohorts.updateDraft(draft.draftId, body));

      expect(onCreate).toBeTruthy();
      expect(onUpdate).toBe(onCreate);

      runner.stop();
    });
  }

  it('applies the fallback-off over-promise guard on the edit path too', () => {
    // A service booted with the stall fallback OFF cannot deliver "anchors with at least k of n",
    // so a k < n edit must be refused in exactly the words the create path refuses it.
    const { runner, operatorCohorts } = draftEditApp(false);
    const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 3 });
    const body: DraftInput = { beaconType: 'CASBeacon', size: 3, threshold: 2 };

    const onCreate = thrownMessage(() => operatorCohorts.createDraft(body));
    const onUpdate = thrownMessage(() => operatorCohorts.updateDraft(draft.draftId, body));
    expect(onCreate).toMatch(/stall fallback/);
    expect(onUpdate).toBe(onCreate);

    // The refused edit changed NOTHING: the draft still carries its original k = n shape.
    const listed = operatorCohorts.listCohorts();
    expect(listed[0].threshold).toBe(3);
    expect(listed[0].capacity).toBe(3);

    runner.stop();
  });
});

describe('next-cohort-only: an advertised or ended cohort cannot be reshaped (D-13)', () => {
  it('refuses an ADVERTISED cohort and leaves its served shape unchanged', async () => {
    const { app, runner, operatorCohorts } = draftEditApp();
    const created = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 3, threshold: 2 });
    const advertised = operatorCohorts.advertiseDraft(created.draftId) as OperatorCohortDTO;
    const cohortId = advertised.draftId;

    // Its advert is public and its seats may be filling, so this is a refusal, never a reshape.
    expect(operatorCohorts.updateDraft(cohortId, { beaconType: 'SMTBeacon', size: 5, threshold: 5 })).toBeUndefined();

    const directory = (await (await app.request('/v1/directory')).json()) as DirectoryCohortDTO[];
    expect(directory).toHaveLength(1);
    expect(directory[0].beaconType).toBe('CASBeacon');
    expect(directory[0].capacity).toBe(3);
    expect(directory[0].threshold).toBe(2);

    runner.stop();
  });

  it('refuses a TERMINAL (expired) record and leaves it exactly as it was', async () => {
    const { runner, operatorCohorts } = draftEditApp();
    const created = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 3, threshold: 2 });
    const advertised = operatorCohorts.advertiseDraft(created.draftId) as OperatorCohortDTO;
    const cohortId = advertised.draftId;

    runner.stopCohort(cohortId);
    await new Promise((r) => setTimeout(r, 20));

    expect(operatorCohorts.updateDraft(cohortId, { beaconType: 'SMTBeacon', size: 5, threshold: 5 })).toBeUndefined();

    const listed = operatorCohorts.listCohorts();
    expect(listed).toHaveLength(1);
    expect(listed[0].state).toBe('expired');
    expect(listed[0].beaconType).toBe('CASBeacon');
    expect(listed[0].capacity).toBe(3);
    expect(listed[0].threshold).toBe(2);

    runner.stop();
  });

  it('refuses an UNKNOWN id without throwing, so the route can answer 404 rather than 400', () => {
    const { runner, operatorCohorts } = draftEditApp();
    // Deliberately paired with an INVALID body: the lookup runs first, so an unknown id is a 404
    // even when the body would not have validated. The two refusals must stay distinguishable.
    expect(operatorCohorts.updateDraft('does-not-exist', { beaconType: 'CASBeacon', size: 0 })).toBeUndefined();
    runner.stop();
  });
});

describe('PATCH /v1/operator/cohorts/:id', () => {
  it('401s an anonymous caller BEFORE any lookup (T-05-06-01)', async () => {
    const { app, runner } = draftEditApp();
    const res = await app.request('/v1/operator/cohorts/whatever', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ beaconType: 'CASBeacon', size: 2 }),
    });
    expect(res.status).toBe(401);
    runner.stop();
  });

  it('200s with the updated DTO on success', async () => {
    const { app, runner, operatorCohorts } = draftEditApp();
    const cookie = await login(app);
    const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });

    const res = await patchDraft(app, cookie, draft.draftId, {
      beaconType: 'SMTBeacon',
      size: 3,
      threshold: 2,
    });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as OperatorCohortDTO;
    expect(dto.draftId).toBe(draft.draftId);
    expect(dto.beaconType).toBe('SMTBeacon');
    expect(dto.capacity).toBe(3);
    expect(dto.threshold).toBe(2);
    expect(dto.network).toBe(ACTIVE_NETWORK);

    runner.stop();
  });

  it('400s a malformed id before any lookup', async () => {
    const { app, runner } = draftEditApp();
    const cookie = await login(app);
    const res = await patchDraft(app, cookie, 'bad_id', { beaconType: 'CASBeacon', size: 2 });
    expect(res.status).toBe(400);
    runner.stop();
  });

  it('400s an unparseable body', async () => {
    const { app, runner, operatorCohorts } = draftEditApp();
    const cookie = await login(app);
    const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    const res = await patchDraft(app, cookie, draft.draftId, 'not json', true);
    expect(res.status).toBe(400);
    runner.stop();
  });

  it('400s an invalid body with the validator message verbatim', async () => {
    const { app, runner, operatorCohorts } = draftEditApp();
    const cookie = await login(app);
    const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    const res = await patchDraft(app, cookie, draft.draftId, { beaconType: 'CASBeacon', size: 0 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    // The exact UI-SPEC copy the create route already returns for the same input.
    expect(body.error).toBe('Cohort size must be at least 1 signer.');
    runner.stop();
  });

  it('404s a non-draft id', async () => {
    const { app, runner } = draftEditApp();
    const cookie = await login(app);
    const res = await patchDraft(app, cookie, 'does-not-exist', { beaconType: 'CASBeacon', size: 2 });
    expect(res.status).toBe(404);
    runner.stop();
  });

  it('413s a body over the 4 KiB limit (T-05-06-03)', async () => {
    const { app, runner, operatorCohorts } = draftEditApp();
    const cookie = await login(app);
    const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    const oversized = { beaconType: 'CASBeacon', size: 2, padding: 'x'.repeat(5 * 1024) };
    const res = await patchDraft(app, cookie, draft.draftId, oversized);
    expect(res.status).toBe(413);
    runner.stop();
  });
});

/**
 * The service's OWN current window defaults, served additively on the gated list read (D-11).
 *
 * A DRAFT row carries the defaults it captured at creation, which is what that draft will really
 * use. But the CREATE form shapes a cohort that does not exist yet, so it has no row to read, and
 * its `Leave it empty to use this service's default of {n} min.` help would otherwise have to
 * invent a number or borrow another draft's stale capture. Both would be claims this service never
 * made, so the service states its current values instead.
 */
describe('GET /v1/operator/cohorts serves this service current window defaults', () => {
  it('reports both defaults when the service was seeded with them', async () => {
    const { app, runner } = draftEditApp(true, {
      defaultDiscoveryWindowMs: 30 * 60_000,
      defaultFundingWindowMs: 20 * 60_000,
    });
    const cookie = await login(app);
    const res = await app.request('/v1/operator/cohorts', { headers: { cookie } });
    const body = (await res.json()) as { defaults?: { discoveryWindowMs?: number; fundingWindowMs?: number } };
    expect(body.defaults).toEqual({ discoveryWindowMs: 30 * 60_000, fundingWindowMs: 20 * 60_000 });
    runner.stop();
  });

  it('OMITS a default the service does not have, rather than serving a zero or a null', () => {
    // An absent key is what lets the console tell "no default" apart from "a default of nothing",
    // so the help omits the figure instead of promising a 0 min window.
    const { app, runner } = draftEditApp(true, { defaultDiscoveryWindowMs: 30 * 60_000 });
    return login(app)
      .then((cookie) => app.request('/v1/operator/cohorts', { headers: { cookie } }))
      .then(async (res) => {
        const body = (await res.json()) as { defaults?: Record<string, number> };
        expect(body.defaults).toEqual({ discoveryWindowMs: 30 * 60_000 });
        expect(body.defaults && 'fundingWindowMs' in body.defaults).toBe(false);
        runner.stop();
      });
  });

  it('reads the holder PER REQUEST, so a runtime change is reflected on the very next read (D-16)', async () => {
    // The service-name lesson generalized: a value captured into the app closure at construction
    // would serve the boot number forever, and 05-07 makes these editable at runtime. Asserting
    // this needs TWO reads with a real mutation between them; a single read would pass just as
    // happily against a boot-time capture, which is the bug under test.
    const { app, runner, settings } = draftEditApp(true, { defaultDiscoveryWindowMs: 30 * 60_000 });
    const cookie = await login(app);
    const read = async () =>
      ((await (await app.request('/v1/operator/cohorts', { headers: { cookie } })).json()) as {
        defaults?: { discoveryWindowMs?: number };
      }).defaults?.discoveryWindowMs;

    expect(await read()).toBe(30 * 60_000);
    expect(settings.applySettings({ defaultDiscoveryWindowMs: 45 * 60_000 })).toBeUndefined();
    expect(await read()).toBe(45 * 60_000);

    runner.stop();
  });
});
