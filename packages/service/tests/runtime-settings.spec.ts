import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { buildCohortConfig, createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import { createCohortIntents } from '../src/cohort-intent.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createService } from '../src/index.js';
import { createOperatorCohorts, discoveryWindowCeilingError } from '../src/operator-cohorts.js';
import { createRuntimeSettings, type RuntimeSettingsSeed } from '../src/runtime-settings.js';

/**
 * Hermetic coverage of the per-service runtime settings holder (SVC-04, D-08/D-12/D-16): the
 * env-seeds / runtime-overrides model every later Phase 5 plan builds on.
 *
 * Four properties are load-bearing and each has its own block below:
 *
 * 1. A malformed numeric seed falls back to the built-in default with ONE warning and never
 *    becomes NaN. This is the shipped WR-04 lesson applied at the new seam: a NaN window is not
 *    a loud failure, it is a silent one (every comparison against NaN is false), so the guard is
 *    asserted at the seed rather than trusted.
 * 2. Source tracking is honest: an untouched field reports the environment default, and an
 *    overridden one still carries its ORIGINAL env value so the console caption can read
 *    `changed this session (environment default: {value})`.
 * 3. Settings save as a SET (UI-SPEC E8 `partial`): one invalid field applies none, so the
 *    surface can never show a half-saved state.
 * 4. The holder is per-`createRuntimeSettings` closure state, never a module singleton, so two
 *    services in one process (exactly what these specs construct) never share configuration.
 *
 * There is deliberately NO persistence test beyond the source-level assertion below: the absence
 * of persistence is the product's stated state model (a restart returns every value to its
 * environment), and DUR-01 is a v2 requirement. The assertion pins the ABSENCE so a later change
 * that quietly adds a write path has to argue with a test.
 */

const RUNTIME_SETTINGS_SRC = fileURLToPath(new URL('../src/runtime-settings.ts', import.meta.url));

/** Collect the warnings a seed emits instead of writing them to the console. */
function withWarnings() {
  const warnings: string[] = [];
  return { warnings, warn: (msg: string) => warnings.push(msg) };
}

describe('createRuntimeSettings: numeric seeds are NaN-guarded (WR-04 discipline)', () => {
  it('falls back to the built-in default and warns ONCE on a non-numeric seed', () => {
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: Number('30m'),
      warn,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/defaultDiscoveryWindowMs/);
    // The built-in default, never NaN: a NaN window silently disables every downstream
    // comparison rather than failing loudly.
    expect(Number.isNaN(settings.defaultDiscoveryWindowMs.value)).toBe(false);
    expect(settings.defaultDiscoveryWindowMs.value).toBe(settings.defaultDiscoveryWindowMs.envDefault);
    expect(settings.defaultDiscoveryWindowMs.changed).toBe(false);
  });

  it('falls back on a seed below the minimum and never yields a NaN on ANY field', () => {
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({
      defaultSize: 0,
      defaultThreshold: -3,
      defaultFundingWindowMs: 0,
      warn,
    });
    expect(warnings.length).toBe(3);
    for (const field of [
      settings.defaultSize,
      settings.defaultThreshold,
      settings.defaultDiscoveryWindowMs,
      settings.defaultFundingWindowMs,
    ]) {
      expect(Number.isNaN(field.value as number)).toBe(false);
    }
    expect(settings.defaultSize.value).toBeGreaterThanOrEqual(1);
    expect(settings.defaultThreshold.value).toBeGreaterThanOrEqual(1);
  });

  it('accepts a well-formed seed silently and reports it as the environment default', () => {
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({ defaultSize: 4, defaultThreshold: 3, warn });
    expect(warnings).toEqual([]);
    expect(settings.defaultSize.value).toBe(4);
    expect(settings.defaultSize.envDefault).toBe(4);
    expect(settings.defaultThreshold.value).toBe(3);
  });

  it('collapses an empty or whitespace-only optional string seed to undefined', () => {
    // Optional strings stay ABSENT rather than empty so the DTOs that carry them
    // (GET /v1/config's serviceName) stay additive instead of gaining an empty key.
    const settings = createRuntimeSettings({ serviceName: '   ', termsText: '' });
    expect(settings.serviceName.value).toBeUndefined();
    expect(settings.termsText.value).toBeUndefined();
  });
});

describe('createRuntimeSettings: honest source tracking (D-12)', () => {
  it('reports an untouched field as the environment default', () => {
    const settings = createRuntimeSettings({ serviceName: 'Acme Aggregation' });
    expect(settings.serviceName.value).toBe('Acme Aggregation');
    expect(settings.serviceName.envDefault).toBe('Acme Aggregation');
    expect(settings.serviceName.changed).toBe(false);
  });

  it('reports an overridden field as changed and STILL carries its original env value', () => {
    const settings = createRuntimeSettings({ serviceName: 'Acme Aggregation' });
    expect(settings.applySettings({ serviceName: 'Acme (maintenance)' })).toBeUndefined();
    expect(settings.serviceName.value).toBe('Acme (maintenance)');
    // The caption reads `changed this session (environment default: {envDefault})`, so the
    // boot value must survive the override.
    expect(settings.serviceName.envDefault).toBe('Acme Aggregation');
    expect(settings.serviceName.changed).toBe(true);
  });

  it('reports a field set BACK to its env value as the environment default again', () => {
    const settings = createRuntimeSettings({ defaultSize: 2 });
    settings.applySettings({ defaultSize: 5 });
    expect(settings.defaultSize.changed).toBe(true);
    settings.applySettings({ defaultSize: 2 });
    // `changed` answers "does this differ from boot", so restoring the boot value restores
    // the honest caption rather than leaving a permanent "changed" claim.
    expect(settings.defaultSize.changed).toBe(false);
  });
});

describe('createRuntimeSettings: applySettings is all-or-nothing (UI-SPEC E8 partial)', () => {
  it('applies NO field when any supplied field is invalid, and returns the first message', () => {
    const settings = createRuntimeSettings({ serviceName: 'Acme', defaultSize: 2, defaultThreshold: 2 });
    const error = settings.applySettings({ serviceName: 'Renamed', defaultSize: 0 });
    expect(typeof error).toBe('string');
    expect(error).toBe('Cohort size must be at least 1 signer.');
    // Every OTHER field stayed at its previous value: no half-saved state.
    expect(settings.serviceName.value).toBe('Acme');
    expect(settings.serviceName.changed).toBe(false);
    expect(settings.defaultSize.value).toBe(2);
  });

  it('refuses a threshold above the size supplied in the SAME patch', () => {
    const settings = createRuntimeSettings({ defaultSize: 5, defaultThreshold: 5 });
    const error = settings.applySettings({ defaultSize: 3, defaultThreshold: 4 });
    expect(error).toBe('Signing threshold must be a whole number between 1 and the cohort size.');
    expect(settings.defaultSize.value).toBe(5);
    expect(settings.defaultThreshold.value).toBe(5);
  });

  it('accepts a valid multi-field patch and applies every field', () => {
    const settings = createRuntimeSettings({ defaultSize: 2, defaultThreshold: 2 });
    const error = settings.applySettings({
      defaultBeaconType: 'SMTBeacon',
      defaultSize: 4,
      defaultThreshold: 3,
      termsText: 'Be excellent to each other.',
    });
    expect(error).toBeUndefined();
    expect(settings.defaultBeaconType.value).toBe('SMTBeacon');
    expect(settings.defaultSize.value).toBe(4);
    expect(settings.defaultThreshold.value).toBe(3);
    expect(settings.termsText.value).toBe('Be excellent to each other.');
  });

  it('clears an optional string when the patch supplies an empty value', () => {
    const settings = createRuntimeSettings({ serviceName: 'Acme' });
    expect(settings.applySettings({ serviceName: '   ' })).toBeUndefined();
    expect(settings.serviceName.value).toBeUndefined();
    expect(settings.serviceName.changed).toBe(true);
  });

  it('refuses an unknown beacon type rather than storing it', () => {
    const settings = createRuntimeSettings({});
    const error = settings.applySettings({ defaultBeaconType: 'DogeBeacon' as never });
    expect(typeof error).toBe('string');
    expect(settings.defaultBeaconType.value).toBe('CASBeacon');
  });

  it('bounds the stored service name and terms length server-side (T-05-04-05)', () => {
    const settings = createRuntimeSettings({});
    expect(typeof settings.applySettings({ serviceName: 'x'.repeat(5_000) })).toBe('string');
    expect(settings.serviceName.value).toBeUndefined();
    expect(typeof settings.applySettings({ termsText: 'x'.repeat(100_000) })).toBe('string');
    expect(settings.termsText.value).toBeUndefined();
  });
});

describe('createRuntimeSettings: pause is in-memory, per-service, and non-persistent', () => {
  it('pause and resume flip the flag and are idempotent', () => {
    const settings = createRuntimeSettings({});
    expect(settings.paused).toBe(false);
    settings.pause();
    settings.pause();
    expect(settings.paused).toBe(true);
    settings.resume();
    settings.resume();
    expect(settings.paused).toBe(false);
  });

  it('keeps two holders in one process independent (never a module singleton)', () => {
    const a = createRuntimeSettings({ serviceName: 'Service A' });
    const b = createRuntimeSettings({ serviceName: 'Service B' });
    a.pause();
    a.applySettings({ serviceName: 'Service A (renamed)' });
    expect(b.paused).toBe(false);
    expect(b.serviceName.value).toBe('Service B');
    expect(b.serviceName.changed).toBe(false);
  });

  it('defaults broadcastDisabled to false (the boot contract, ADR 0010)', () => {
    expect(createRuntimeSettings({}).broadcastDisabled).toBe(false);
  });

  it('exposes NO persistence: the module never touches the filesystem or a store', () => {
    // The absence of persistence is the product's stated state model (D-08/D-12): a restart
    // returns every value to its environment. Pin the absence at the source so a later change
    // that quietly adds a write path has to argue with this test rather than slip through.
    const source = readFileSync(RUNTIME_SETTINGS_SRC, 'utf8');
    expect(source).not.toMatch(/from 'node:fs'/);
    expect(source).not.toMatch(/from 'node:path'/);
    expect(source).not.toMatch(/\.\/store\.js/);
    const settings = createRuntimeSettings({}) as unknown as Record<string, unknown>;
    for (const key of ['save', 'persist', 'write', 'flush', 'load']) {
      expect(settings[key]).toBeUndefined();
    }
  });
});

describe('GET /v1/config reads the service name from the holder per request (D-16)', () => {
  /** A bare app wired with a runtime holder, exactly as `createService` wires one. */
  function settingsApp(serviceName?: string) {
    const transport = new HttpServerTransport({
      resolveSenderPk: resolveBtcr2SenderPk,
      heartbeatIntervalMs: 0,
    });
    const runtimeSettings = createRuntimeSettings({ serviceName });
    return { app: createHonoApp(transport, { runtimeSettings }), runtimeSettings };
  }

  it('reflects a runtime service-name change on the NEXT request, network fields untouched', async () => {
    const { app, runtimeSettings } = settingsApp('Acme Aggregation');
    const before = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(before).toEqual({
      network: 'mutinynet',
      label: 'Mutinynet (signet)',
      isMainnet: false,
      serviceName: 'Acme Aggregation',
    });

    // The route must read the HOLDER per request, not a boot-time closure constant.
    runtimeSettings.applySettings({ serviceName: 'Acme (maintenance)' });
    const after = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(after).toEqual({
      network: 'mutinynet',
      label: 'Mutinynet (signet)',
      isMainnet: false,
      serviceName: 'Acme (maintenance)',
    });
  });

  it('stays byte-identical (no serviceName key) when the name is cleared at runtime', async () => {
    const { app, runtimeSettings } = settingsApp('Acme Aggregation');
    runtimeSettings.applySettings({ serviceName: '' });
    const body = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['isMainnet', 'label', 'network']);
  });

  it('carries the participation terms ADDITIVELY once they are set (D-19)', async () => {
    // The terms are the operator half of SVC-05: the participant's join flow needs them from a
    // route it can read with no session, and `GET /v1/config` is the one such read the browser
    // already makes on load. It rides the SAME per-request holder read the name does.
    const { app, runtimeSettings } = settingsApp('Acme Aggregation');
    expect(runtimeSettings.applySettings({ termsText: 'Be excellent to each other.' })).toBeUndefined();
    const body = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(body).toEqual({
      network: 'mutinynet',
      label: 'Mutinynet (signet)',
      isMainnet: false,
      serviceName: 'Acme Aggregation',
      termsText: 'Be excellent to each other.',
    });
  });

  it('omits the terms key entirely when they are empty or whitespace-only (SVC-05, D-19)', async () => {
    // Empty terms mean the feature is ABSENT, not an empty step: the participant flow must be able
    // to tell "this operator set no terms" from "this operator set terms that say nothing", and an
    // empty string on the wire would collapse the two.
    const { app, runtimeSettings } = settingsApp();
    expect(runtimeSettings.applySettings({ termsText: '   ' })).toBeUndefined();
    const body = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['isMainnet', 'label', 'network']);
  });
});

describe('snapshot(): the whole field set with its source, for the console caption (D-12)', () => {
  it('reports every declared field with its value, its env default, and whether it changed', () => {
    const settings = createRuntimeSettings({
      serviceName: 'Acme Aggregation',
      defaultBeaconType: 'CASBeacon',
      defaultSize: 3,
      defaultThreshold: 2,
      defaultDiscoveryWindowMs: 30 * 60_000,
      defaultFundingWindowMs: 10 * 60_000,
      termsText: 'Original terms.',
    });
    const snap = settings.snapshot();
    // The console renders `env default` or `changed this session (environment default: {value})`
    // from SERVED data rather than guessing, so every field must carry all three facts.
    expect(Object.keys(snap).sort()).toEqual(
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
    for (const field of Object.values(snap)) {
      expect(field).toHaveProperty('envDefault');
      expect(field.changed).toBe(false);
    }
    expect(snap.defaultSize.value).toBe(3);
    expect(snap.termsText.value).toBe('Original terms.');
  });

  it('marks only the fields that actually moved, keeping their boot value alongside', () => {
    const settings = createRuntimeSettings({ serviceName: 'Acme', defaultSize: 2, defaultThreshold: 2 });
    expect(settings.applySettings({ defaultSize: 5, defaultThreshold: 5 })).toBeUndefined();
    const snap = settings.snapshot();
    expect(snap.defaultSize.changed).toBe(true);
    expect(snap.defaultSize.envDefault).toBe(2);
    expect(snap.serviceName.changed).toBe(false);
  });

  it('returns a FRESH projection per call, so a caller cannot write settings through it', () => {
    const settings = createRuntimeSettings({ defaultSize: 2 });
    const first = settings.snapshot();
    (first.defaultSize as { value: number }).value = 99;
    expect(settings.snapshot().defaultSize.value).toBe(2);
    expect(settings.defaultSize.value).toBe(2);
  });
});

describe('applySettings refuses a discovery-window default this service cannot honor', () => {
  it('names the real service maximum rather than accepting a value the library overrules', () => {
    // The same shorten-only ceiling `validateDraft` enforces per draft (05-06, RESEARCH Pitfall 7).
    // The library arms its cohort TTL at advertise and never resets it, so a DEFAULT above that TTL
    // is a promise this service cannot keep for the drafts that inherit it. Refusing here is the
    // difference between a setting surface and a wish list.
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: 30 * 60_000,
      discoveryWindowCeilingMs: 30 * 60_000,
    });
    const error = settings.applySettings({ defaultDiscoveryWindowMs: 45 * 60_000 });
    expect(error).toMatch(/30 min/);
    expect(settings.defaultDiscoveryWindowMs.value).toBe(30 * 60_000);
  });

  it('accepts a default at or below the ceiling', () => {
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: 30 * 60_000,
      discoveryWindowCeilingMs: 30 * 60_000,
    });
    expect(settings.applySettings({ defaultDiscoveryWindowMs: 5 * 60_000 })).toBeUndefined();
    expect(settings.defaultDiscoveryWindowMs.value).toBe(5 * 60_000);
  });
});

/**
 * The SEED half of the same ceiling (05-AUDIT.md entry 7, D-11/D-12). The two rows above cover the
 * SAVE path and are deliberately left untouched: the save path still REFUSES with the real maximum
 * named, and their staying green unedited is the evidence that this block moved nothing there.
 *
 * The asymmetry is the point. A save is an operator's explicit act on a value they typed, so the
 * honest answer is a refusal naming the limit. A boot seed is inherited configuration the operator
 * may never have chosen, and every other out-of-range seed in this module warns and falls back
 * rather than aborting the process, so the seed CLAMPS with a loud warning.
 *
 * What no earlier row did was construct the holder with an over-ceiling seed, so the one path that
 * never consulted the ceiling was never entered. Two consequences rode on that gap and both are
 * asserted here: the gated read captioned an unenforceable window as this service's `env default`,
 * and `applySettings` re-read that stored value for every ABSENT key, so a save of an unrelated
 * field (a rename) was refused with an error about a field the operator never touched.
 */
describe('createRuntimeSettings CLAMPS an over-ceiling discovery-window seed (05-AUDIT entry 7)', () => {
  it('stores the ceiling as BOTH the current value and the env default', () => {
    const { warn } = withWarnings();
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: 60 * 60_000,
      discoveryWindowCeilingMs: 30 * 60_000,
      warn,
    });
    // Both halves matter: `value` is what every new draft inherits, and `envDefault` is what the
    // console captions as this service's environment default. Seeding the unenforceable number
    // into either one is a promise the runner's own TTL breaks 30 minutes in.
    expect(settings.defaultDiscoveryWindowMs.value).toBe(30 * 60_000);
    expect(settings.defaultDiscoveryWindowMs.envDefault).toBe(30 * 60_000);
    expect(settings.defaultDiscoveryWindowMs.changed).toBe(false);
  });

  it('warns loudly, naming both the requested value and the enforced maximum', () => {
    const { warnings, warn } = withWarnings();
    createRuntimeSettings({
      defaultDiscoveryWindowMs: 60 * 60_000,
      discoveryWindowCeilingMs: 30 * 60_000,
      warn,
    });
    // A clamp the operator cannot see in boot output is indistinguishable from the silent
    // acceptance this row exists to end, so the message must carry both numbers.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/3600000/);
    expect(warnings[0]).toMatch(/1800000/);
  });

  it('leaves the settings surface usable: a save of an UNRELATED field now succeeds', () => {
    const { warn } = withWarnings();
    const settings = createRuntimeSettings({
      serviceName: 'boot',
      defaultDiscoveryWindowMs: 60 * 60_000,
      discoveryWindowCeilingMs: 30 * 60_000,
      warn,
    });
    // Before the clamp this returned the ceiling error and applied NOTHING, because the all-or-
    // nothing set re-read the stored over-ceiling value for the absent discovery key. The operator
    // was locked out of every setting by a boot value they never chose.
    expect(settings.applySettings({ serviceName: 'renamed' })).toBeUndefined();
    expect(settings.serviceName.value).toBe('renamed');
  });

  it('leaves a seed at or below the ceiling byte-unchanged and silent', () => {
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: 30 * 60_000,
      discoveryWindowCeilingMs: 30 * 60_000,
      warn,
    });
    // Equal is not over: the unset case seeds the window and the ceiling from the SAME
    // `cohortTtlMs`, so a clamp that fired at equality would warn on every default boot.
    expect(warnings).toEqual([]);
    expect(settings.defaultDiscoveryWindowMs.value).toBe(30 * 60_000);
  });

  it('leaves the seed alone when no ceiling is configured', () => {
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: 60 * 60_000,
      warn,
    });
    // A service that never set a cohort TTL has no maximum to enforce, so there is nothing to
    // clamp against and inventing one would truncate a window the service can actually honor.
    expect(warnings).toEqual([]);
    expect(settings.defaultDiscoveryWindowMs.value).toBe(60 * 60_000);
  });
});

/**
 * The WIRING half of the same ceiling (05-AUDIT-2.md entry 12, defect #5). Every row above, and
 * every row in the two save-path blocks before them, hand-injects `discoveryWindowCeilingMs` into
 * `createRuntimeSettings`. They are all correct about the RULE and none of them touches the one
 * line that supplies the ceiling on the product path: `index.ts` seeds it from the runner's own
 * `cohortTtlMs` when it builds this service's holder. Delete that one property and every row above
 * stays green, because every one of them supplies the knob itself.
 *
 * So this block never touches the knob at all. It boots a REAL service through {@link createService}
 * with nothing but a cohort TTL and a discovery-window default, and reads the holder back through
 * the service handle's own exposed {@link Service.settings}, which exists (see its docstring at
 * `index.ts`) precisely so a harness can observe a runtime value without an HTTP route. If the boot
 * seed goes away, these rows are the ones that notice.
 *
 * What shipping without them would have cost: an over-ceiling `DEFAULT_DISCOVERY_WINDOW_MS` served
 * as this service's `env default` with `changed: false`, captioned to the operator as configuration
 * they can rely on, while `armWindowTimer` returns early at or above the TTL so no app timer is ever
 * armed and the cohort lapses with the generic expired fate instead of the app's window-expired
 * reason. And `PUT /v1/operator/settings` would accept a discovery window the runner's TTL overrules.
 */
describe('a real createService boot SUPPLIES the discovery-window ceiling (audit #5)', () => {
  const THIRTY_MIN = 30 * 60_000;
  const SIXTY_MIN = 60 * 60_000;

  /**
   * Boot a real service. Nothing binds a port and nothing is mocked: the settings holder is built
   * during `createService` itself, so the boot seed is exercised without ever starting the server.
   * The runner and transport are torn down through the service's own `stop()`.
   */
  async function bootedSettings(
    opts: { cohortTtlMs?: number; defaultDiscoveryWindowMs?: number },
    body: (settings: ReturnType<typeof createService>['settings']) => void,
  ): Promise<void> {
    const service = createService({
      identity: createIdentity(resolveNetwork('signet')),
      config: buildCohortConfig(2, 'CASBeacon', 'signet'),
      ...opts,
    });
    try {
      body(service.settings);
    } finally {
      await service.stop();
    }
  }

  it('clamps an over-ceiling boot default to the runner cohort TTL, in BOTH halves of the field', async () => {
    await bootedSettings({ cohortTtlMs: THIRTY_MIN, defaultDiscoveryWindowMs: SIXTY_MIN }, (settings) => {
      // `value` is what every new draft inherits; `envDefault` is what the console captions as this
      // service's environment default. Neither may hold a window the runner's own TTL overrules.
      expect(settings.defaultDiscoveryWindowMs.value).toBe(THIRTY_MIN);
      expect(settings.defaultDiscoveryWindowMs.envDefault).toBe(THIRTY_MIN);
      expect(settings.defaultDiscoveryWindowMs.changed).toBe(false);
    });
  });

  it('serves a boot default BELOW the TTL unchanged, so the ceiling clamps rather than overwrites', async () => {
    const FIVE_MIN = 5 * 60_000;
    await bootedSettings({ cohortTtlMs: THIRTY_MIN, defaultDiscoveryWindowMs: FIVE_MIN }, (settings) => {
      // The control for the row above. Without it a seed the boot simply replaced with the TTL
      // would satisfy the clamp assertion just as happily as a seed it bounded.
      expect(settings.defaultDiscoveryWindowMs.value).toBe(FIVE_MIN);
      expect(settings.defaultDiscoveryWindowMs.envDefault).toBe(FIVE_MIN);
    });
  });

  it('refuses a settings save above the TTL, naming the real maximum the console renders', async () => {
    await bootedSettings({ cohortTtlMs: THIRTY_MIN }, (settings) => {
      const error = settings.applySettings({ defaultDiscoveryWindowMs: 45 * 60_000 });
      // The SAME sentence `validateDraft` gives a per-draft over-ceiling window, so the operator
      // reads one rule about this service rather than two that happen to agree.
      expect(error).toBe(discoveryWindowCeilingError(THIRTY_MIN));
      expect(error).toMatch(/30 minutes/);
      expect(settings.defaultDiscoveryWindowMs.value).toBe(THIRTY_MIN);
    });
  });

  it('accepts a save at EXACTLY the TTL, so the boundary is pinned rather than assumed', async () => {
    await bootedSettings({ cohortTtlMs: THIRTY_MIN, defaultDiscoveryWindowMs: 5 * 60_000 }, (settings) => {
      // Equal is not over. A ceiling that fired at equality would refuse the very value the default
      // boot seeds, since the unset case seeds the window and the ceiling from the same TTL.
      expect(settings.applySettings({ defaultDiscoveryWindowMs: THIRTY_MIN })).toBeUndefined();
      expect(settings.defaultDiscoveryWindowMs.value).toBe(THIRTY_MIN);
    });
  });

  it('warns LOUDLY on the clamped boot, naming both numbers on the real console', async () => {
    // A real boot passes no `warn` sink, so the warning goes to `console.warn` behind the module's
    // own `[settings]` prefix. 05-18 promised this two-number line and UAT test 1 passed it by eye;
    // this is the row that makes the promise a fact rather than an observation somebody made once.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await bootedSettings({ cohortTtlMs: THIRTY_MIN, defaultDiscoveryWindowMs: SIXTY_MIN }, () => {});
      const lines = spy.mock.calls.map((call) => String(call[0]));
      const clampWarning = lines.filter((line) => /defaultDiscoveryWindowMs/.test(line));
      expect(clampWarning).toHaveLength(1);
      expect(clampWarning[0]).toMatch(/\[settings\]/);
      expect(clampWarning[0]).toMatch(String(SIXTY_MIN));
      expect(clampWarning[0]).toMatch(String(THIRTY_MIN));
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * A real runner + operator cohort surface wired to a real settings holder, so the read-once rule
 * (D-13) is asserted against the SAME `createDraft` the gated route calls rather than a stand-in.
 */
function draftDefaultsApp(seed: RuntimeSettingsSeed = {}) {
  const identity = createIdentity(resolveNetwork('signet'));
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
  const settings = createRuntimeSettings(seed);
  const operatorCohorts = createOperatorCohorts({
    activeNetwork: 'signet',
    runner,
    autoFallbackOnStall: true,
    intents: createCohortIntents(),
    settings,
  });
  return { runner, operatorCohorts, settings };
}

describe('service defaults are read ONCE at createDraft time and never re-read (D-13)', () => {
  it('seeds a draft that supplies no shape from the holder', () => {
    const { runner, operatorCohorts } = draftDefaultsApp({
      defaultBeaconType: 'SMTBeacon',
      defaultSize: 4,
      defaultThreshold: 3,
    });
    const draft = operatorCohorts.createDraft({});
    expect(draft.beaconType).toBe('SMTBeacon');
    expect(draft.capacity).toBe(4);
    expect(draft.threshold).toBe(3);
    runner.stop();
  });

  it('leaves an EXISTING draft untouched when the service default changes afterwards', () => {
    const { runner, operatorCohorts, settings } = draftDefaultsApp({ defaultSize: 2, defaultThreshold: 2 });
    const draft = operatorCohorts.createDraft({});
    expect(settings.applySettings({ defaultSize: 6, defaultThreshold: 6 })).toBeUndefined();

    // The draft keeps the shape it was made with: a settings change is about the NEXT cohort.
    const row = operatorCohorts.listCohorts().find((c) => c.draftId === draft.draftId);
    expect(row?.capacity).toBe(2);
    expect(row?.threshold).toBe(2);
    runner.stop();
  });

  it('leaves an ADVERTISED cohort untouched when the service default changes afterwards', () => {
    const { runner, operatorCohorts, settings } = draftDefaultsApp({ defaultSize: 2, defaultThreshold: 2 });
    const draft = operatorCohorts.createDraft({});
    const advertised = operatorCohorts.advertiseDraft(draft.draftId);
    expect(advertised && 'draftId' in advertised).toBe(true);
    expect(settings.applySettings({ defaultSize: 6, defaultThreshold: 6 })).toBeUndefined();

    const rows = operatorCohorts.listCohorts().filter((c) => c.state === 'advertised');
    expect(rows).toHaveLength(1);
    expect(rows[0].capacity).toBe(2);
    expect(rows[0].threshold).toBe(2);
    runner.stop();
  });

  it('still honors an EXPLICIT shape over the service default', () => {
    const { runner, operatorCohorts } = draftDefaultsApp({ defaultBeaconType: 'SMTBeacon', defaultSize: 4 });
    const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 2, threshold: 2 });
    expect(draft.beaconType).toBe('CASBeacon');
    expect(draft.capacity).toBe(2);
    runner.stop();
  });

  it('keeps k = n for a body that supplies n but no k (the shipped default is not overridden)', () => {
    // k is only meaningful relative to n. Taking a DEFAULT k against an operator-supplied n would
    // silently reshape a cohort they described: a 5-seat cohort would quietly become 2-of-5.
    const { runner, operatorCohorts } = draftDefaultsApp({ defaultSize: 2, defaultThreshold: 2 });
    const draft = operatorCohorts.createDraft({ beaconType: 'CASBeacon', size: 5 });
    expect(draft.capacity).toBe(5);
    expect(draft.threshold).toBe(5);
    runner.stop();
  });
});
