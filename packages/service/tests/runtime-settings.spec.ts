import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AggregationServiceRunner, HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { buildCohortConfig, createIdentity, resolveNetwork } from '@btcr2-aggregation/shared';
import { createCohortIntents } from '../src/cohort-intent.js';
import { createHonoApp } from '../src/hono-adapter.js';
import { createService } from '../src/index.js';
import {
  createOperatorCohorts,
  discoveryWindowCeilingError,
  DISCOVERY_WINDOW_ERROR,
  FUNDING_WINDOW_ERROR,
} from '../src/operator-cohorts.js';
import {
  createRuntimeSettings,
  MAX_SERVICE_NAME_CHARS,
  MAX_TERMS_CHARS,
  numericKnob,
  SETTINGS_BODY_LIMIT_BYTES,
  settingsBodyLimitBytes,
  type RuntimeSettings,
  type RuntimeSettingsSeed,
} from '../src/runtime-settings.js';

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
        // RESHAPED, not loosened (`05-REVIEW.md` WR-07): boot PROVENANCE about a refused seed, not
        // a setting, which is why the field walk below now names the settings rather than walking
        // every member. The exact-equality discipline is this row's whole value and it stays.
        'droppedSeeds',
        'serviceName',
        'termsText',
      ].sort(),
    );
    const { droppedSeeds, ...fields } = snap;
    expect(droppedSeeds).toEqual([]);
    for (const field of Object.values(fields)) {
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

/** One minute in ms, retyped here rather than imported: the spec states the unit it asserts on. */
const MINUTE_MS = 60_000;


/**
 * THE INVARIANT (`05-VERIFICATION.md` W3, review WR-2 and WR-3): no value this holder ACCEPTS at
 * boot may be a value its own {@link RuntimeSettings.applySettings} would REFUSE.
 *
 * Every block above tests one guard against its own input. None of them took a value the holder
 * ACCEPTED and then asked whether the holder would still accept it on the next save, and that gap
 * is the shape of both defects this block closes. `applySettings` re-reads the STORED value for
 * every key a patch OMITS, so an accepted-but-invalid seed does not fail its own field: it fails
 * every later save AS A SET, including a save of a field the operator did touch, behind a message
 * naming a field they never set. `createDraft` is wedged the same way, because a draft's absent
 * size is filled from the stored default and `validateDraft` then refuses it.
 *
 * Two independent boot values could do it. A FRACTIONAL numeric passed `numericKnob` (which
 * validated finiteness and a lower bound but never integrality) and then failed `Number.isInteger`
 * on every save. And a window that was integral but NOT a whole number of minutes stored cleanly,
 * then reached the console as a fractional minutes field (`msToMinutesText(90000)` is `"1.5"`),
 * which `parseWindow` calls invalid because it mirrors this service's own whole-minute guard; the
 * settings view validates the WHOLE form before it will post, so one unrepresentable window blocks
 * a save of every other field.
 *
 * The table below is the hostile-seed set. Each row carries a seed plus what it must end up
 * storing, and EVERY row additionally runs the same two checks through
 * {@link expectHolderInvariants} and the rename-only save: asserting the stored value alone would
 * pass against a fix that stored a good number while leaving the save broken for another reason,
 * and the rename-only save is the exact operator experience the defect ruins.
 */
interface HostileSeed {
  /** What the row is hostile ABOUT, read into the test name. */
  readonly what: string;
  readonly seed: RuntimeSettingsSeed;
  /** The row-specific expectation about what the holder ended up storing. */
  readonly stored: (settings: RuntimeSettings) => void;
}

const HOSTILE_SEEDS: readonly HostileSeed[] = [
  {
    what: 'a fractional cohort size',
    seed: { defaultSize: 2.5 },
    // The built-in default, exactly as a NaN or an under-minimum size already fell back.
    stored: (s) => expect(s.defaultSize.value).toBe(2),
  },
  {
    what: 'a fractional signing threshold',
    seed: { defaultSize: 4, defaultThreshold: 2.5 },
    // k falls back to its own fallback, the resolved n, which is the honest n-of-n default.
    stored: (s) => {
      expect(s.defaultSize.value).toBe(4);
      expect(s.defaultThreshold.value).toBe(4);
    },
  },
  {
    what: 'a fractional discovery window',
    seed: { defaultDiscoveryWindowMs: 90_000.5 },
    // No built-in window default exists, so the fallback is absent: the service's own default.
    stored: (s) => expect(s.defaultDiscoveryWindowMs.value).toBeUndefined(),
  },
  {
    what: 'a fractional funding window',
    seed: { defaultFundingWindowMs: 600_000.5 },
    stored: (s) => expect(s.defaultFundingWindowMs.value).toBeUndefined(),
  },
  {
    what: 'a fractional discovery-window CEILING, which is a clamp TARGET',
    seed: { defaultDiscoveryWindowMs: 30 * MINUTE_MS, discoveryWindowCeilingMs: 1_800_000.5 },
    // A fractional ceiling would be written into the stored window by the clamp: the same wedge
    // arriving through a different door. With the ceiling refused there is nothing to clamp to.
    stored: (s) => expect(s.defaultDiscoveryWindowMs.value).toBe(30 * MINUTE_MS),
  },
  {
    what: 'a non-whole-minute discovery window',
    seed: { defaultDiscoveryWindowMs: 90_000 },
    // Quantized DOWN to the nearest whole minute rather than refused: flooring preserves the
    // operator's intent as closely as a representable value allows.
    stored: (s) => expect(s.defaultDiscoveryWindowMs.value).toBe(MINUTE_MS),
  },
  {
    what: 'a non-whole-minute funding window',
    seed: { defaultFundingWindowMs: 90_000 },
    stored: (s) => expect(s.defaultFundingWindowMs.value).toBe(MINUTE_MS),
  },
  {
    what: 'a non-whole-minute CEILING with a seed above it',
    seed: { defaultDiscoveryWindowMs: 30 * MINUTE_MS, discoveryWindowCeilingMs: 150_000 },
    // The ceiling is quantized BEFORE it is used as a clamp target, so the value the clamp writes
    // is already a whole minute at or below what the operator's ceiling allowed.
    stored: (s) => expect(s.defaultDiscoveryWindowMs.value).toBe(2 * MINUTE_MS),
  },
  {
    what: 'an over-long service name',
    seed: { serviceName: 'x'.repeat(5_000) },
    // Nothing, rather than the first 200 characters: a name this service would refuse on a save is
    // a name it must not store at boot either, and a half-name is a display string the operator
    // never wrote.
    stored: (s) => expect(s.serviceName.value).toBeUndefined(),
  },
  {
    what: 'an over-long participation-terms document',
    seed: { termsText: 'x'.repeat(100_000) },
    // Nothing, and deliberately not a truncation: the acceptance record binds the HASH of the exact
    // text shown, so a truncated document is one participants would DID-sign in mutilated form.
    // Serving no terms is the honest fallback and the boot warning says what it costs.
    stored: (s) => expect(s.termsText.value).toBeUndefined(),
  },
];

/**
 * Everything {@link RuntimeSettings.applySettings} demands of a value it re-reads, asserted against
 * what the holder actually STORED. This is the invariant stated as a predicate: a stored value that
 * fails any line here is a value the holder accepted and would then refuse.
 */
function expectHolderInvariants(settings: RuntimeSettings): void {
  expect(Number.isInteger(settings.defaultSize.value)).toBe(true);
  expect(settings.defaultSize.value).toBeGreaterThanOrEqual(1);
  expect(Number.isInteger(settings.defaultThreshold.value)).toBe(true);
  expect(settings.defaultThreshold.value).toBeGreaterThanOrEqual(1);
  expect(settings.defaultThreshold.value).toBeLessThanOrEqual(settings.defaultSize.value);
  for (const window of [settings.defaultDiscoveryWindowMs.value, settings.defaultFundingWindowMs.value]) {
    if (window === undefined) {
      continue;
    }
    expect(Number.isInteger(window)).toBe(true);
    expect(window).toBeGreaterThanOrEqual(MINUTE_MS);
    // The browser half of the invariant, stated as arithmetic (review WR-3): a window that does
    // not divide evenly by one minute cannot round-trip through the console's minutes field, and
    // the console validates the WHOLE form before it will post.
    expect(window % MINUTE_MS).toBe(0);
  }
  // The FREE-TEXT half (Gap 1 / SC3, review CR-01). This predicate is what makes the table above a
  // statement of the invariant rather than a list of examples, and until now it iterated two
  // numbers and two windows and never looked at a string. That is precisely how a 100000 character
  // terms seed passed a 1215 test gate: the rule was stated for every field the holder stores and
  // checked for the fields somebody had already thought about. Naming the subject explicitly is the
  // difference, so a field added later without a bound fails here rather than passing.
  for (const [text, maximum] of [
    [settings.serviceName.value, MAX_SERVICE_NAME_CHARS],
    [settings.termsText.value, MAX_TERMS_CHARS],
  ] as const) {
    if (text === undefined) {
      continue;
    }
    expect(text.length).toBeLessThanOrEqual(maximum);
  }
}

describe('no seed the holder ACCEPTS is a value it would REFUSE (W3, review WR-2 and WR-3)', () => {
  for (const row of HOSTILE_SEEDS) {
    it(`stores a self-consistent value for ${row.what}, and a rename-only save still succeeds`, () => {
      const { warn } = withWarnings();
      const settings = createRuntimeSettings({ serviceName: 'boot', ...row.seed, warn });
      row.stored(settings);
      expectHolderInvariants(settings);
      // The operator experience the defect ruins: a save of the ONE field they did touch, with
      // every other key absent and therefore re-read from what this boot stored.
      expect(settings.applySettings({ serviceName: 'renamed' })).toBeUndefined();
      expect(settings.serviceName.value).toBe('renamed');
    });
  }

  it('satisfies the holder invariant for EVERY field across the whole table, as a property', () => {
    // The predicate on its own, with no row-specific expectation in front of it. Inside the per-row
    // test above a row's own `stored` assertion fires first and would mask a predicate that had
    // stopped covering a field, which is exactly the failure mode that let the string half sit
    // vacuous through a green gate. Here the predicate is the only thing being asked.
    for (const row of HOSTILE_SEEDS) {
      const { warn } = withWarnings();
      expectHolderInvariants(createRuntimeSettings({ serviceName: 'boot', ...row.seed, warn }));
    }
  });

  it('stores only WHOLE-MINUTE windows across the entire table, asserted as a property', () => {
    // Row by row, a missed window would only fail the row that produced it. As a property over
    // the whole table it fails for any seed anybody adds later without thinking about the round
    // trip, which is the drift this whole block exists to stop.
    for (const row of HOSTILE_SEEDS) {
      const { warn } = withWarnings();
      const settings = createRuntimeSettings({ ...row.seed, warn });
      for (const window of [settings.defaultDiscoveryWindowMs.value, settings.defaultFundingWindowMs.value]) {
        if (window !== undefined) {
          expect(window % MINUTE_MS).toBe(0);
        }
      }
    }
  });

  it('keeps the retained last-write whole-minute guard a NO-OP across the whole table (review IN-04)', () => {
    // WHAT THIS ROW IS FOR, since a reader will otherwise see a test asserting that nothing
    // happens. The quantizer's third call, the last-write `floorToWholeMinute` on the discovery
    // window, is deliberately DEAD on every path a caller can reach today: point 1 quantizes the
    // ceiling, point 2 quantizes the seed, and the clamp between them can only ever choose one of
    // those two already-quantized values. It is kept anyway, because it is where the invariant is
    // ENFORCED rather than merely arrived at, and a future second writer into that value would
    // otherwise be unguarded. The cost the review names (IN-04) is that no test could tell the
    // guard from its own deletion. This row is that test: it turns dead code into PINNED code.
    //
    // The assertion has to be OBSERVABLE from outside the module, because the guard is silent by
    // construction on every current path. What it WOULD change if it ever fired is the boot output:
    // it warns with both numbers. So a second whole-minute line about this one field is exactly the
    // signal that a later writer made it fire, and this row goes RED when that happens rather than
    // letting the change land silently.
    //
    // The stored value is asserted beside the count, so the property states the invariant the guard
    // enforces and not merely the guard's silence: a fix that deleted the guard AND the warning
    // would pass a count-only row.
    for (const row of HOSTILE_SEEDS) {
      const { warnings, warn } = withWarnings();
      const settings = createRuntimeSettings({ ...row.seed, warn });
      const wholeMinuteLines = warnings.filter(
        (line) => /^defaultDiscoveryWindowMs=/.test(line) && /is not a whole number of minutes/.test(line),
      );
      expect(wholeMinuteLines.length).toBeLessThanOrEqual(1);
      const stored = settings.defaultDiscoveryWindowMs.value;
      if (stored !== undefined) {
        expect(stored % MINUTE_MS).toBe(0);
      }
    }
  });

  it('warns on a malformed seed rather than storing it, naming the value it ignored', () => {
    const { warnings, warn } = withWarnings();
    createRuntimeSettings({ defaultSize: 2.5, warn });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/defaultSize/);
    expect(warnings[0]).toMatch(/2\.5/);
  });

  it('unwedges createDraft too: the shipped draft path succeeds under a fractional size seed', () => {
    // The other half of the same wedge. A draft that supplies no shape fills its size from the
    // stored default, and `validateDraft` refused a fractional one, so the operator could not
    // create a cohort at all on a service booted from an ordinary typo.
    const { runner, operatorCohorts } = draftDefaultsApp({ defaultSize: 2.5 });
    const draft = operatorCohorts.createDraft({});
    expect(draft.capacity).toBe(2);
    expect(draft.threshold).toBe(2);
    runner.stop();
  });

  it('refuses a SAVE of a window that is integral but not a whole number of minutes', () => {
    // The browser cannot produce this, but a headless operator client can, and it would re-wedge
    // the console the moment it landed. The message is unchanged: this rule makes it TRUE.
    const settings = createRuntimeSettings({});
    expect(settings.applySettings({ defaultDiscoveryWindowMs: 90_000 })).toBe(DISCOVERY_WINDOW_ERROR);
    expect(settings.defaultDiscoveryWindowMs.value).toBeUndefined();
    expect(settings.applySettings({ defaultFundingWindowMs: 90_000 })).toBe(FUNDING_WINDOW_ERROR);
    expect(settings.defaultFundingWindowMs.value).toBeUndefined();
    // The whole-minute values either side of it still save, so the rule bounds nothing legal.
    expect(settings.applySettings({ defaultDiscoveryWindowMs: MINUTE_MS })).toBeUndefined();
    expect(settings.applySettings({ defaultFundingWindowMs: 2 * MINUTE_MS })).toBeUndefined();
  });
});

/**
 * The DERIVED boot paths, which both the verification note and the review understated: no
 * malformed `DEFAULT_*` value is required to reach this defect at all.
 *
 * `createService` fills the size seed from `config.minParticipants`, the discovery-window seed from
 * `cohortTtlMs`, and the funding-window seed from `fundingWindowMs` whenever the matching `DEFAULT_*`
 * option is absent. Every one of those has its own env var with no integrality and no whole-minute
 * constraint, so `COHORT_TTL_MS=90000` (a perfectly reasonable thing to set, and nothing in the
 * runbook warned against it) wedged every settings save and every draft edit on a service where no
 * `DEFAULT_*` variable was set at all.
 *
 * A bare holder call cannot show that, because the derivation lives in `createService` and not in
 * the holder. These rows therefore boot a REAL service, following the block above that proves the
 * ceiling is supplied by a real boot.
 */
describe('the DERIVED boot seeds reach the same defect, and the holder-level fix closes them (W3)', () => {
  /**
   * Boot a real service and read its holder back through the service handle's own `settings`.
   * Nothing binds a port and nothing is mocked: the holder is built during `createService` itself.
   */
  async function withBootedService(
    opts: { minParticipants?: number; cohortTtlMs?: number; fundingWindowMs?: number },
    body: (settings: ReturnType<typeof createService>['settings']) => void,
  ): Promise<void> {
    const service = createService({
      identity: createIdentity(resolveNetwork('signet')),
      config: buildCohortConfig(opts.minParticipants ?? 2, 'CASBeacon', 'signet'),
      ...(opts.cohortTtlMs !== undefined ? { cohortTtlMs: opts.cohortTtlMs } : {}),
      ...(opts.fundingWindowMs !== undefined ? { fundingWindowMs: opts.fundingWindowMs } : {}),
    });
    try {
      body(service.settings);
    } finally {
      await service.stop();
    }
  }

  it('closes a fractional MIN_PARTICIPANTS with no DEFAULT_SIZE anywhere', async () => {
    await withBootedService({ minParticipants: 2.5 }, (settings) => {
      expect(settings.defaultSize.value).toBe(2);
      expect(settings.applySettings({ serviceName: 'renamed' })).toBeUndefined();
      expect(settings.serviceName.value).toBe('renamed');
    });
  });

  it('closes a non-whole-minute COHORT_TTL_MS with no DEFAULT_DISCOVERY_WINDOW_MS anywhere', async () => {
    // The reachable-without-any-malformed-value case, and the one most likely to be met in the
    // field: `COHORT_TTL_MS=90000` seeds BOTH the discovery-window default and its own ceiling.
    //
    // The stored assertions below are the ones this row shipped with and are deliberately UNEDITED:
    // they are the evidence that reordering the quantizer changed the boot OUTPUT and no stored
    // value (05-VERIFICATION.md W6, review WR-02). The warning assertions are what this row was
    // missing, and their absence is how a boot that printed two lines, the second of them false,
    // sat under a passing test that was correct about everything it looked at.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withBootedService({ cohortTtlMs: 90_000 }, (settings) => {
        const stored = settings.defaultDiscoveryWindowMs.value;
        expect(stored).toBeDefined();
        expect(stored! % MINUTE_MS).toBe(0);
        expect(stored).toBeLessThanOrEqual(90_000);
        expect(settings.applySettings({ serviceName: 'renamed' })).toBeUndefined();
        expect(settings.serviceName.value).toBe('renamed');

        const lines = spy.mock.calls.map((call) => String(call[0])).filter((line) => /\[settings\]/.test(line));
        // ONE variable set wrongly, ONE warning. The count alone would pass against a fix that
        // deleted the true line instead of the false one, so the content is asserted beside it.
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/whole number of minutes/);
        expect(lines[0]).toMatch(/90000/);
        expect(lines[0]).toMatch(/60000/);
        // The naming half of the fix, stated as an assertion over EVERY captured line rather than
        // the first: a boot line naming only an internal field sends the operator looking for a
        // knob that appears in no environment reference, no compose file and no ADR.
        for (const line of lines) {
          expect(line).toMatch(/COHORT_TTL_MS/);
          expect(line).not.toMatch(/discoveryWindowCeilingMs/);
        }
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('closes a non-whole-minute FUNDING_WINDOW_MS with no DEFAULT_FUNDING_WINDOW_MS anywhere', async () => {
    // The funding window has no ceiling, so it needs its own quantizer call; without one this row
    // stores 90000 and the rename below fails behind a message about a window nobody set.
    await withBootedService({ fundingWindowMs: 90_000 }, (settings) => {
      expect(settings.defaultFundingWindowMs.value).toBe(MINUTE_MS);
      expect(settings.applySettings({ serviceName: 'renamed' })).toBeUndefined();
      expect(settings.serviceName.value).toBe('renamed');
    });
  });

  it('warns LOUDLY on the real console, naming the malformed value it ignored', async () => {
    // Observed, not assumed, matching the clamp block's discipline: a real boot passes no `warn`
    // sink, so the warning goes to `console.warn` behind the module's own `[settings]` prefix.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withBootedService({ minParticipants: 2.5 }, () => {});
      const lines = spy.mock.calls.map((call) => String(call[0]));
      const sizeWarning = lines.filter((line) => /defaultSize/.test(line));
      expect(sizeWarning).toHaveLength(1);
      expect(sizeWarning[0]).toMatch(/\[settings\]/);
      expect(sizeWarning[0]).toMatch(/2\.5/);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * THE FREE-TEXT half of the same invariant (`05-VERIFICATION.md` Gap 1 / SC3, review CR-01), which
 * the numeric half above stated generically and enforced for numbers only.
 *
 * `applySettings` bounds the stored service name at {@link MAX_SERVICE_NAME_CHARS} and the stored
 * terms at {@link MAX_TERMS_CHARS}, and it re-reads the STORED value for every key a patch OMITS.
 * The two seeds carried no bound at all, so an over-long one did not fail its own field: it failed
 * every later save AS A SET, behind a sentence naming a field the operator never touched, until the
 * process restarted. `TERMS_TEXT` is the realistic trigger rather than a typo, because 20000
 * characters is roughly 3500 words and SVC-05 exists precisely so an operator can set a real
 * participation-terms document.
 *
 * The first row boots a REAL service, following the two blocks above: a bare holder call proves the
 * bound works, while a boot proves the bound sits on the path `demo-server.ts` actually feeds, which
 * is where the defect lived.
 */
describe('no free-text seed the holder ACCEPTS is a value it would REFUSE (SC3, review CR-01)', () => {
  /**
   * Boot a real service and read its holder back through the service handle's own `settings`.
   * Nothing binds a port and nothing is mocked: the holder is built during `createService` itself.
   */
  async function withBootedService(
    opts: { serviceName?: string; termsText?: string },
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

  it('drops an over-long TERMS_TEXT at a real boot, warns, and leaves the settings surface usable', async () => {
    // Three assertions in ONE row on purpose: each alone passes against a wrong fix. Storing
    // nothing is satisfied by a holder that drops every terms value; warning is satisfied by a
    // holder that warns and stores the over-long text anyway; and the rename-only save is the exact
    // operator experience the defect ruins, which neither of the other two proves on its own.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withBootedService({ termsText: 'x'.repeat(100_000) }, (settings) => {
        expect(settings.termsText.value).toBeUndefined();

        const termsWarnings = spy.mock.calls.map((call) => String(call[0])).filter((line) => /TERMS_TEXT/.test(line));
        expect(termsWarnings).toHaveLength(1);
        expect(termsWarnings[0]).toMatch(/\[settings\]/);
        expect(termsWarnings[0]).toMatch(/100000/);
        expect(termsWarnings[0]).toMatch(String(MAX_TERMS_CHARS));
        // The CONSEQUENCE in words. A warning that discloses a drop without saying what the drop
        // costs is the silent acceptance this row exists to end: with no terms stored, the join
        // flow has no terms step at all, and the operator would otherwise learn that from a
        // participant rather than from their own boot output.
        expect(termsWarnings[0]).toMatch(/no terms step/);

        expect(settings.applySettings({ serviceName: 'renamed' })).toBeUndefined();
        expect(settings.serviceName.value).toBe('renamed');
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('stores a terms document AT the ceiling exactly, unchanged and silently', () => {
    // The anti-vacuity control for the whole block. Without it a helper that dropped EVERY terms
    // value would satisfy the row above just as happily as one that bounds them.
    const atCeiling = 'x'.repeat(MAX_TERMS_CHARS);
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({ termsText: atCeiling, warn });
    expect(warnings).toEqual([]);
    expect(settings.termsText.value).toBe(atCeiling);
    expect(settings.termsText.envDefault).toBe(atCeiling);
    expect(settings.termsText.changed).toBe(false);
  });

  it('stores a service name AT the ceiling exactly, unchanged and silently', () => {
    const atCeiling = 'x'.repeat(MAX_SERVICE_NAME_CHARS);
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({ serviceName: atCeiling, warn });
    expect(warnings).toEqual([]);
    expect(settings.serviceName.value).toBe(atCeiling);
  });

  it('warns about BOTH over-long seeds separately, so an operator who set both is told about both', () => {
    // One combined line would leave an operator who set both believing they had one problem.
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({
      serviceName: 'x'.repeat(5_000),
      termsText: 'x'.repeat(100_000),
      warn,
    });
    expect(warnings).toHaveLength(2);
    expect(warnings.filter((line) => /SERVICE_NAME/.test(line))).toHaveLength(1);
    expect(warnings.filter((line) => /TERMS_TEXT/.test(line))).toHaveLength(1);
    expect(settings.serviceName.value).toBeUndefined();
    expect(settings.termsText.value).toBeUndefined();
  });

  it('keeps the empty-collapses-to-undefined behavior the seeds already had', () => {
    // The bound is ADDED to the existing trim, never a replacement for it: an empty or
    // whitespace-only seed must still collapse to undefined so the DTOs that carry these two
    // fields stay additive rather than gaining an empty key.
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({ serviceName: '   ', termsText: '\n\t ', warn });
    expect(warnings).toEqual([]);
    expect(settings.serviceName.value).toBeUndefined();
    expect(settings.termsText.value).toBeUndefined();
  });

  /**
   * WHAT THE DROP IS NOW ACCOUNTED FOR (`05-REVIEW.md` WR-07). Dropping is the right choice and the
   * rows above are unchanged, but until now the ONLY record of a refusal was one boot line. The
   * gated settings read serves the refused variable NAMES, so the console can caption the resulting
   * emptiness as this service's refusal instead of as the environment's own choice.
   *
   * The first row boots a REAL service for the same reason the block's first row does: a bare holder
   * call proves the collector works, while a boot proves it sits on the path `demo-server.ts` feeds.
   */
  it('carries the refused TERMS_TEXT by NAME on the snapshot of a real boot, with the field still unset', async () => {
    // BOTH halves. The name alone would pass against a collector that also stored the refused text,
    // and the undefined alone is exactly what already shipped, silently.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withBootedService({ termsText: 'x'.repeat(100_000) }, (settings) => {
        expect(settings.termsText.value).toBeUndefined();
        expect(settings.snapshot().droppedSeeds).toEqual(['TERMS_TEXT']);
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('records BOTH refused seeds, so the record is a list of what happened and not a last-one-wins flag', () => {
    const { warn } = withWarnings();
    const settings = createRuntimeSettings({
      serviceName: 'x'.repeat(5_000),
      termsText: 'x'.repeat(100_000),
      warn,
    });
    expect([...settings.snapshot().droppedSeeds].sort()).toEqual(['SERVICE_NAME', 'TERMS_TEXT']);
  });

  it('records nothing for a clean boot, and nothing for seeds sitting exactly AT their ceilings', () => {
    // The anti-vacuity control for the whole record. Without it a collector that listed every seed
    // it saw would satisfy the two rows above just as happily as one that lists only refusals.
    const { warn } = withWarnings();
    expect(createRuntimeSettings({ warn }).snapshot().droppedSeeds).toEqual([]);
    expect(
      createRuntimeSettings({
        serviceName: 'x'.repeat(MAX_SERVICE_NAME_CHARS),
        termsText: 'x'.repeat(MAX_TERMS_CHARS),
        warn,
      })
        .snapshot().droppedSeeds,
    ).toEqual([]);
  });

  it('carries NAMES only: no part of a refused seed appears anywhere in the served snapshot', () => {
    // Asserted against the SERIALIZED snapshot rather than against the field, which looks stronger
    // than necessary until the reason is stated: a future carrier that stashed the refused text
    // under some other key would pass a field-level check and fail here. A disclosure added for
    // honesty must never become a disclosure of something the operator did not mean to serve.
    const { warn } = withWarnings();
    const refused = `NEVER-SERVE-THIS-${'y'.repeat(100_000)}`;
    const settings = createRuntimeSettings({ termsText: refused, warn });
    const serialized = JSON.stringify(settings.snapshot());
    expect(serialized).toContain('TERMS_TEXT');
    expect(serialized).not.toContain('NEVER-SERVE-THIS');
    expect(serialized).not.toContain('yyyy');
  });

  it('serves a FRESH copy of the record on every read, like every other member of this snapshot', () => {
    // The same rule `project` states for every field: a caller must not be able to reshape this
    // service's settings by writing through a DTO it was handed.
    const { warn } = withWarnings();
    const settings = createRuntimeSettings({ termsText: 'x'.repeat(100_000), warn });
    const handed = settings.snapshot().droppedSeeds as string[];
    handed.push('MADE_UP_VARIABLE');
    handed[0] = 'REWRITTEN';
    expect(settings.snapshot().droppedSeeds).toEqual(['TERMS_TEXT']);
  });

  /**
   * ONE REFUSAL, THREE STATEMENTS, ONE ORDER (`05-REVIEW.md` IN-13, extending WR-10).
   *
   * WR-10's premise, which round 6 accepted and acted on, is that a refused seed is repairable in
   * the RUNNING session: `applySettings` accepts a value up to this holder's own character ceiling
   * and the settings route carries it, so the operator can type into the settings field, save, and
   * have the setting back now. Round 6 corrected exactly one of the three places that state the
   * repair, the console caption, and left the boot warning and `docs/DEPLOY.md` naming the slow one
   * as the only one. The boot warning is the statement an operator meets FIRST.
   *
   * The rows below assert the ORDER by comparing two positions inside the composed line rather than
   * by matching a whole sentence, so a later rewording that preserves the order stays green and a
   * rewording that drops or demotes the in-session repair does not. `REFUSED_SEEDS` in
   * `packages/web/src/components/operator/SettingsView.tsx` is the fixed point these follow; it is
   * not edited by this round.
   */
  const REFUSED_SEED_LINES: readonly {
    readonly what: string;
    readonly seed: RuntimeSettingsSeed;
    readonly variable: string;
    readonly suppliedLength: number;
    readonly ceiling: number;
    /** The unique substring of the in-session repair clause. */
    readonly inSessionRepair: string;
    /** The unique substring of the environment edit clause, which must come after it. */
    readonly environmentEdit: string;
  }[] = [
    {
      what: 'a refused SERVICE_NAME',
      seed: { serviceName: 'x'.repeat(5_000) },
      variable: 'SERVICE_NAME',
      suppliedLength: 5_000,
      ceiling: MAX_SERVICE_NAME_CHARS,
      inSessionRepair: 'Set the service name in the operator settings surface',
      environmentEdit: 'shorten SERVICE_NAME',
    },
    {
      what: 'a refused TERMS_TEXT',
      seed: { termsText: 'x'.repeat(100_000) },
      variable: 'TERMS_TEXT',
      suppliedLength: 100_000,
      ceiling: MAX_TERMS_CHARS,
      inSessionRepair: 'Set the participation terms in the operator settings surface',
      environmentEdit: 'shorten TERMS_TEXT',
    },
  ];

  /** The one boot line about `variable`, which every row below reads through. */
  function refusalLine(seed: RuntimeSettingsSeed, variable: string): string {
    const { warnings, warn } = withWarnings();
    createRuntimeSettings({ ...seed, warn });
    const matching = warnings.filter((line) => line.includes(variable));
    expect(matching).toHaveLength(1);
    return matching[0]!;
  }

  for (const row of REFUSED_SEED_LINES) {
    it(`names the in-session repair BEFORE the environment edit for ${row.what}`, () => {
      const line = refusalLine(row.seed, row.variable);
      const repairAt = line.indexOf(row.inSessionRepair);
      const environmentAt = line.indexOf(row.environmentEdit);
      // Both present at all: an ordering comparison between two -1s is vacuously true.
      expect(repairAt).toBeGreaterThan(-1);
      expect(environmentAt).toBeGreaterThan(-1);
      // The operator can do the first one while reading this line. The second is what stops the
      // refusal happening again at the next boot, which is why it comes second and not instead.
      expect(repairAt).toBeLessThan(environmentAt);
    });

    it(`still names the variable, the supplied length and the ceiling for ${row.what}`, () => {
      // The split ADDS a repair. It must not cost the measurement the warning already carried,
      // which is the only thing telling the operator how far over the value was.
      const line = refusalLine(row.seed, row.variable);
      expect(line).toContain(row.variable);
      expect(line).toContain(String(row.suppliedLength));
      expect(line).toContain(String(row.ceiling));
    });
  }

  it('keeps the two consequences DIFFERENT sentences, so neither loss is dressed in the other words', () => {
    // The reasoning `REFUSED_SEEDS` already records: dropping the display name loses a label, and
    // dropping the participation terms turns the SVC-05 acceptance gate off. A shared sentence
    // would either overstate the name's loss or hide the one that matters, and fusing them is
    // exactly how the cost and the remedy fused in the first place.
    const terms = refusalLine({ termsText: 'x'.repeat(100_000) }, 'TERMS_TEXT');
    const name = refusalLine({ serviceName: 'x'.repeat(5_000) }, 'SERVICE_NAME');
    expect(terms).toMatch(/no terms step at all/);
    expect(terms).toMatch(/acceptance/);
    expect(name).not.toMatch(/terms step/);
    expect(name).not.toMatch(/acceptance/);
  });

  it('says none of this for a seed within the cap: no warning at all, and no dropped name', () => {
    // The control that keeps every row above about the REFUSAL path. Without it a holder that
    // appended this consequence to every seed it saw would satisfy them just as happily.
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({
      serviceName: 'x'.repeat(MAX_SERVICE_NAME_CHARS),
      termsText: 'x'.repeat(MAX_TERMS_CHARS),
      warn,
    });
    expect(warnings).toEqual([]);
    expect(settings.snapshot().droppedSeeds).toEqual([]);
  });
});

/**
 * The DERIVATION behind the gated settings route's byte budget (`05-VERIFICATION.md` SC3, review
 * CR-02), stated as a property over what the field can actually carry.
 *
 * The rows below MEASURE. A row that recomputed the arithmetic from the same two constants would
 * pass against any multiplier at all and prove nothing, which is precisely how the shipped defect
 * survived: `runtime-settings.spec.ts` proved this holder's character cap thoroughly,
 * `lifecycle-routes.spec.ts` proved the route's byte cap thoroughly, the two specs never met, and a
 * five times disagreement between them passed a 1234 test gate with both halves green.
 *
 * The general lesson, worth carrying past this phase: when two layers bound the same value, the
 * test that matters is the one that sends the LARGEST legal value through BOTH.
 */
describe('the settings body budget bounds every encoding a terms document at the cap can have', () => {
  /**
   * The five encoding classes {@link MAX_TERMS_CHARS} code units can be made of, each built to sit
   * EXACTLY at the cap so the measurement is of the largest legal value rather than a convenient
   * one. The surrogate row repeats half as many times because one pair is two code units.
   */
  const ENCODING_CLASSES: readonly { readonly what: string; readonly terms: string }[] = [
    { what: 'plain ASCII', terms: 'x'.repeat(MAX_TERMS_CHARS) },
    { what: 'a two-byte script', terms: 'é'.repeat(MAX_TERMS_CHARS) },
    { what: 'a three-byte script', terms: '漢'.repeat(MAX_TERMS_CHARS) },
    { what: 'surrogate pairs', terms: '𝄞'.repeat(MAX_TERMS_CHARS / 2) },
    // The last row is spelled as an escape rather than pasted: it is the class that costs six bytes
    // per code unit, so it is the class the multiplier is derived from and it has to be readable.
    { what: 'escape-forcing control characters', terms: '\u0001'.repeat(MAX_TERMS_CHARS) },
  ];

  /**
   * The character the multiplier is derived from: one UTF-16 code unit, six UTF-8 bytes once
   * `JSON.stringify` escapes it. Constructed by code point rather than pasted, for the same reason
   * the control-character row above is spelled as an escape: the class this bound is derived from
   * has to be readable in the source that measures it.
   */
  const ESCAPE_FORCING = String.fromCharCode(1);

  /** The worst-case name every row in this block already assumed before the helper took it. */
  const ASCII_NAME_AT_CAP = 'x'.repeat(MAX_SERVICE_NAME_CHARS);

  /**
   * The full console-shaped patch, so the measurement includes the rest of the form (D-12).
   *
   * The NAME is a PARAMETER (review IN-06). It was a fixed ASCII name at the cap, which is what
   * made this block structurally incapable of noticing the service-name cap at all: the table
   * varied one of the two string fields the budget has to carry and froze the other. Every row
   * this block shipped with passes {@link ASCII_NAME_AT_CAP}, the exact value it always assumed,
   * so its measurement and its assertion are unchanged.
   */
  function encodedBodyBytes(terms: string, name: string): number {
    const body = JSON.stringify({
      serviceName: name,
      defaultBeaconType: 'CASBeacon',
      defaultSize: 2,
      defaultThreshold: 2,
      defaultDiscoveryWindowMs: 1_800_000,
      defaultFundingWindowMs: 720_000,
      termsText: terms,
    });
    return new TextEncoder().encode(body).length;
  }

  for (const row of ENCODING_CLASSES) {
    it(`fits a terms document at the cap written in ${row.what}`, () => {
      expect(row.terms).toHaveLength(MAX_TERMS_CHARS);
      expect(SETTINGS_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(encodedBodyBytes(row.terms, ASCII_NAME_AT_CAP));
    });
  }

  it('bounds the worst case across EVERY class at once, as a property', () => {
    // Class by class, a missed encoding only fails its own row. As a property over the whole set it
    // fails for any class somebody adds later, which is the drift this block exists to stop.
    for (const row of ENCODING_CLASSES) {
      expect(SETTINGS_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(encodedBodyBytes(row.terms, ASCII_NAME_AT_CAP));
    }
  });

  it('bounds the LARGEST legal console body: both string fields at their cap, both at the worst encoding', () => {
    // The row this block could not express while its name was frozen (review IN-06). The console
    // posts the whole form (D-12), so the largest body a legal save can produce is BOTH string
    // fields at their cap in the class that costs six bytes per code unit, not the terms field
    // alone beside a cheap name.
    const worst = encodedBodyBytes(
      ESCAPE_FORCING.repeat(MAX_TERMS_CHARS),
      ESCAPE_FORCING.repeat(MAX_SERVICE_NAME_CHARS),
    );
    // It really is the worst: the same terms beside an ASCII name at the same cap is cheaper, which
    // is the difference the shipped rows above were blind to.
    expect(worst).toBeGreaterThan(
      encodedBodyBytes(ESCAPE_FORCING.repeat(MAX_TERMS_CHARS), ASCII_NAME_AT_CAP),
    );
    expect(SETTINGS_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(worst);
  });

  it('is not vacuously large: the doubling the review suggested would have failed a real class', () => {
    // The anti-vacuity control for the derivation itself. `MAX_TERMS_CHARS * 2 + 4096` is 44096
    // bytes, which fits ASCII and fits surrogate pairs and REFUSES a three-byte script AT the cap.
    // Without this row the block above would pass just as happily against the smaller multiplier,
    // and the gap would have survived for exactly the operators who write their own terms in their
    // own language. It also proves the budget bounds something: a limit that fit every class with
    // room to spare for a reason nobody stated would be the original defect facing the other way.
    const suggested = MAX_TERMS_CHARS * 2 + 4096;
    const threeByteBytes = encodedBodyBytes('漢'.repeat(MAX_TERMS_CHARS), ASCII_NAME_AT_CAP);
    expect(threeByteBytes).toBeGreaterThan(suggested);
    expect(SETTINGS_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(threeByteBytes);
  });

  it('pins each cap against a retyped literal, so a cap change is deliberate and visible', () => {
    // The ONE place in this suite that retypes either cap (review IN-06). Every other row derives
    // from the imported constants, which is the property the previous shape lacked: the service
    // name cap was retyped HERE, in the spec, so the measurement that was supposed to bound it
    // could not see it move. A cap change now fails exactly one row, on purpose, and that row is
    // the record of the decision rather than an accident.
    expect(MAX_SERVICE_NAME_CHARS).toBe(200);
    expect(MAX_TERMS_CHARS).toBe(20_000);
  });

  it('sizes its one chosen number against a MEASURED body rather than a hope', () => {
    // The allowance for the five non-string fields and the JSON punctuation is the only number in
    // the derivation still chosen, and it stays chosen because that field set cannot grow without
    // a code change (T-05-38-06). What it must not be is unmeasured: the headroom it replaced
    // claimed a 184 byte non-terms body and was wrong in both directions, and nothing checked it.
    // A figure quoted in a comment is a claim, and it needs a row the same way the code does.
    const bare = encodedBodyBytes('', '');
    expect(bare).toBe(169);
    // Applying the derivation with both caps at zero leaves exactly the allowance, which therefore
    // has to cover the body with both string fields empty on its own.
    expect(settingsBodyLimitBytes(0, 0)).toBeGreaterThanOrEqual(bare);
  });

  /**
   * Cap PAIRS, the property that makes a future cap raise safe by construction rather than by
   * somebody remembering (review IN-06).
   *
   * The break-even point measured against the fixed headroom this replaced: a body is
   * `169 + 6 * nameCap + 120000` bytes at the worst encoding, so the old 124096 byte budget stopped
   * bounding it at a name cap of 655. Raising `MAX_SERVICE_NAME_CHARS` past that would have
   * re-opened CR-02 through the NAME field with the whole suite green, because the budget carried
   * no name term and this block retyped the cap. The pairs below therefore include name caps well
   * past that point, and one pair with the two caps swapped so neither field can be the special one.
   */
  const CAP_PAIRS: readonly { readonly what: string; readonly name: number; readonly terms: number }[] =
    [
      { what: "today's shipped caps", name: MAX_SERVICE_NAME_CHARS, terms: MAX_TERMS_CHARS },
      { what: 'a name cap just past the old break-even point', name: 700, terms: MAX_TERMS_CHARS },
      { what: 'a name cap far past it', name: 5_000, terms: MAX_TERMS_CHARS },
      { what: 'the two caps swapped, so neither field is the special one', name: 20_000, terms: 200 },
    ];

  for (const pair of CAP_PAIRS) {
    it(`derives a budget that bounds the worst legal body for ${pair.what}`, () => {
      const worst = encodedBodyBytes(
        ESCAPE_FORCING.repeat(pair.terms),
        ESCAPE_FORCING.repeat(pair.name),
      );
      expect(settingsBodyLimitBytes(pair.name, pair.terms)).toBeGreaterThanOrEqual(worst);
    });
  }

  it('bounds every cap pair at once, as a property over the table', () => {
    // Pair by pair, a derivation that dropped one field's term only fails the pairs where that
    // field is large. As a property over the whole table it fails the moment the derivation stops
    // carrying either term, which is the coupling this closes.
    for (const pair of CAP_PAIRS) {
      const worst = encodedBodyBytes(
        ESCAPE_FORCING.repeat(pair.terms),
        ESCAPE_FORCING.repeat(pair.name),
      );
      expect(settingsBodyLimitBytes(pair.name, pair.terms)).toBeGreaterThanOrEqual(worst);
    }
  });

  it('is not vacuously large in the NAME field either: the fixed headroom this replaced would have failed a real cap pair', () => {
    // The same technique as the row above that kills the smaller multiplier, pointed at the other
    // string field. `MAX_TERMS_CHARS * 6 + 4096` was the shipped budget, and it carried no name
    // term at all, so it is a derivation that happens to bound today's caps and stops bounding
    // anything the moment the name cap moves. Without this row the pairs above would pass just as
    // happily against a name-blind derivation, and the pairs would prove slack rather than a rule.
    const nameBlind = (_nameCap: number, termsCap: number): number => termsCap * 6 + 4096;
    const pair = { name: 5_000, terms: MAX_TERMS_CHARS };
    const worst = encodedBodyBytes(
      ESCAPE_FORCING.repeat(pair.terms),
      ESCAPE_FORCING.repeat(pair.name),
    );
    expect(nameBlind(pair.name, pair.terms)).toBeLessThan(worst);
    expect(settingsBodyLimitBytes(pair.name, pair.terms)).toBeGreaterThanOrEqual(worst);
  });

  it('stays inside the range this service already accepts on its other routes', () => {
    // The bound MOVED, it was not removed (T-05-33-02). The largest limit any other route in
    // `hono-adapter.ts` carries is 512 KiB, so a budget at or under that keeps the request-size
    // denial-of-service property the original 4 KiB comment claimed.
    expect(SETTINGS_BODY_LIMIT_BYTES).toBeLessThanOrEqual(512 * 1024);
    expect(SETTINGS_BODY_LIMIT_BYTES).toBeGreaterThan(4 * 1024);
  });
});

/**
 * The integrality check is OPT-IN, so the eleven existing `numericKnob` call sites resolve
 * byte-identically and the diff at `demo-server.ts` is empty. `PORT` is the one that would notice
 * first if the new parameter were not opt-in: it passes a minimum of 0, and a port of 0 is a legal
 * request for an ephemeral port.
 */
describe('numericKnob: the integrality check is OPT-IN (existing call sites unchanged)', () => {
  it('accepts a non-integer when integrality is not requested', () => {
    const { warnings, warn } = withWarnings();
    expect(numericKnob('cohortTtlMs', 90_000.5, 1, warn)).toBe(90_000.5);
    expect(warnings).toEqual([]);
  });

  it('still accepts zero for the PORT-shaped call with a minimum of zero', () => {
    const { warnings, warn } = withWarnings();
    expect(numericKnob('PORT', '0', 8080, warn, 0)).toBe(0);
    expect(warnings).toEqual([]);
  });

  it('takes the SAME warn-and-fall-back path as a NaN when integrality IS requested', () => {
    // One branch, one message shape, one posture: a non-integer is malformed in exactly the way
    // an infinity or an under-minimum value already was.
    const { warnings, warn } = withWarnings();
    expect(numericKnob('defaultSize', 2.5, 2, warn, 1, true)).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe('ignoring malformed defaultSize="2.5"; using 2');
  });

  it('still accepts a whole number when integrality is requested', () => {
    const { warnings, warn } = withWarnings();
    expect(numericKnob('defaultSize', '4', 2, warn, 1, true)).toBe(4);
    expect(warnings).toEqual([]);
  });
});

/**
 * The QUANTIZER half of the invariant (review WR-3), asserted on the stored NUMBER rather than only
 * on a save succeeding: a fix that stored the right value for the wrong reason must not pass here.
 *
 * A window that is integral but not a whole number of minutes is legal at the knob, so integrality
 * alone does not close this. It is FLOORED rather than rounded or refused, and the reasoning is
 * recorded beside the helper in the source: flooring preserves the operator's intent as closely as
 * a representable value allows, it can only ever SHORTEN a window (the same safe direction the
 * ceiling clamp already moves in, and never a promise this service cannot keep), and refusing would
 * drop a window the operator did choose over a value that is only unrepresentable in the console's
 * own units.
 */
describe('every window this holder will serve is a whole number of minutes (review WR-3)', () => {
  it('quantizes a non-whole-minute discovery seed DOWN, warning with BOTH numbers', () => {
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({ defaultDiscoveryWindowMs: 90_000, warn });
    // Both halves: `value` is what every new draft inherits, `envDefault` is what the console
    // captions as this service's environment default, and neither may be unrepresentable.
    expect(settings.defaultDiscoveryWindowMs.value).toBe(MINUTE_MS);
    expect(settings.defaultDiscoveryWindowMs.envDefault).toBe(MINUTE_MS);
    expect(settings.defaultDiscoveryWindowMs.changed).toBe(false);
    // A truncation the operator cannot see in boot output is indistinguishable from the silent
    // acceptance this row exists to end, so the message carries the supplied ms and the stored ms.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/defaultDiscoveryWindowMs/);
    expect(warnings[0]).toMatch(/90000/);
    expect(warnings[0]).toMatch(/60000/);
  });

  it('quantizes the funding seed by the same rule, on its own call', () => {
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({ defaultFundingWindowMs: 12 * MINUTE_MS + 1, warn });
    expect(settings.defaultFundingWindowMs.value).toBe(12 * MINUTE_MS);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/defaultFundingWindowMs/);
  });

  it('never quantizes BELOW one minute, because the knob refused anything under it first', () => {
    // 119999 ms is the worst case: one tick short of two minutes, floored to one, never to zero.
    // Anything under a minute never reaches the quantizer at all, so no floor can produce a 0.
    const { warn } = withWarnings();
    const settings = createRuntimeSettings({ defaultDiscoveryWindowMs: 119_999, warn });
    expect(settings.defaultDiscoveryWindowMs.value).toBe(MINUTE_MS);
    const belowMinimum = createRuntimeSettings({ defaultDiscoveryWindowMs: 59_999, warn });
    expect(belowMinimum.defaultDiscoveryWindowMs.value).toBeUndefined();
  });

  it('quantizes the CEILING too, so the clamp cannot write a fractional-minute value', () => {
    // Drive a seed ABOVE a non-whole-minute ceiling: without quantizing the clamp TARGET, the
    // clamp writes 150000 straight into the stored window and the console is wedged again.
    const { warn } = withWarnings();
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: 30 * MINUTE_MS,
      discoveryWindowCeilingMs: 150_000,
      warn,
    });
    expect(settings.defaultDiscoveryWindowMs.value).toBe(2 * MINUTE_MS);
    expect(settings.defaultDiscoveryWindowMs.value! % MINUTE_MS).toBe(0);
    expect(settings.defaultDiscoveryWindowMs.value!).toBeLessThanOrEqual(150_000);
  });

  it('leaves a whole-minute seed byte-unchanged and SILENT', () => {
    // The control. Without it a quantizer that rewrote every value would satisfy the rows above
    // just as happily as one that only touches what it must, and every default boot would warn.
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: 30 * MINUTE_MS,
      defaultFundingWindowMs: 12 * MINUTE_MS,
      discoveryWindowCeilingMs: 30 * MINUTE_MS,
      warn,
    });
    expect(warnings).toEqual([]);
    expect(settings.defaultDiscoveryWindowMs.value).toBe(30 * MINUTE_MS);
    expect(settings.defaultFundingWindowMs.value).toBe(12 * MINUTE_MS);
  });
});

/**
 * EVERY WARNING THIS HOLDER PRINTS ABOUT A WINDOW IS TRUE, AND NAMES A VARIABLE THE OPERATOR CAN ACT
 * ON (`05-VERIFICATION.md` W6, review WR-02).
 *
 * The suite that shipped 05-30 asserted what the holder STORED and, except where a row was written
 * about a warning specifically, never read what it PRINTED. The `COHORT_TTL_MS=90000` row above
 * existed, passed, and was correct about the stored value while the boot output beside it said
 * something untrue: the clamp fired against the already-quantized CEILING rather than against the
 * TTL, because the window's quantizer ran after the clamp, so a boot was told a 90000 ms window
 * "exceeds this service's cohort TTL" of 90000 ms. The operator had set one variable and was warned
 * about two others, one of them `discoveryWindowCeilingMs`, which appears in no environment
 * reference, no compose file and no ADR.
 *
 * The reordering is value-preserving and the proof is arithmetic rather than a promise: flooring is
 * monotone and the ceiling is itself quantized first, so for a seed at or below the ceiling the
 * result is the floored seed either way, and for a seed above it the floored seed is still at or
 * above the whole-minute ceiling and the result is the ceiling either way. The property row below
 * asserts that over the whole hostile-seed table rather than row by row.
 */
describe('the window warnings are true, and name a variable the operator set (W6, review WR-02)', () => {
  it('prints the whole-minute line THEN the clamp line for a seed above a non-whole-minute ceiling', () => {
    // The case the reordering must not paper over: BOTH truncations really happened, so both are
    // disclosed, in the order they were applied, each true of the number it names.
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: 2_500_000,
      discoveryWindowCeilingMs: 30 * MINUTE_MS,
      warn,
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/whole number of minutes/);
    expect(warnings[0]).toMatch(/2500000/);
    expect(warnings[0]).toMatch(/2460000/);
    // The clamp names the FLOORED seed, which is the value that genuinely exceeded the ceiling.
    expect(warnings[1]).toMatch(/exceeds this service's cohort TTL/);
    expect(warnings[1]).toMatch(/2460000/);
    expect(warnings[1]).toMatch(/1800000/);
    expect(settings.defaultDiscoveryWindowMs.value).toBe(30 * MINUTE_MS);
  });

  it('still clamps, and its sentence is still true, when a window genuinely exceeds the ceiling', () => {
    // The anti-vacuity control for the reordering: a change that simply stopped clamping would
    // satisfy the single-warning row above just as happily as one that made the clamp accurate.
    const { warnings, warn } = withWarnings();
    const settings = createRuntimeSettings({
      defaultDiscoveryWindowMs: 60 * MINUTE_MS,
      discoveryWindowCeilingMs: 30 * MINUTE_MS,
      warn,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/exceeds this service's cohort TTL/);
    expect(warnings[0]).toMatch(/3600000/);
    expect(warnings[0]).toMatch(/1800000/);
    expect(settings.defaultDiscoveryWindowMs.value).toBe(30 * MINUTE_MS);
  });

  it('names an environment variable in every window warning it prints, never a bare internal field', () => {
    // Three boots, one per window warning this holder can emit: the whole-minute line, the clamp
    // line, and the funding line. Each must hand the operator something they can act on.
    const seeds: readonly RuntimeSettingsSeed[] = [
      { defaultDiscoveryWindowMs: 90_000 },
      { defaultDiscoveryWindowMs: 60 * MINUTE_MS, discoveryWindowCeilingMs: 30 * MINUTE_MS },
      { defaultFundingWindowMs: 90_000 },
    ];
    for (const seed of seeds) {
      const { warnings, warn } = withWarnings();
      createRuntimeSettings({ ...seed, warn });
      expect(warnings.length).toBeGreaterThan(0);
      for (const line of warnings) {
        expect(line).toMatch(/COHORT_TTL_MS|DEFAULT_DISCOVERY_WINDOW_MS|DEFAULT_FUNDING_WINDOW_MS|FUNDING_WINDOW_MS/);
        // The one name that is not a variable anybody can set.
        expect(line).not.toMatch(/discoveryWindowCeilingMs=/);
      }
    }
  });

  it('stores exactly what the hostile-seed table already expected, as a property over the table', () => {
    // The reordering changes which warnings fire and nothing else. Row by row a changed value would
    // only fail the row that produced it; as a property it fails for any seed at all, which is what
    // makes "only the warnings moved" a fact rather than a claim in a comment.
    for (const row of HOSTILE_SEEDS) {
      const { warn } = withWarnings();
      const settings = createRuntimeSettings({ ...row.seed, warn });
      row.stored(settings);
      for (const [stored, seeded] of [
        [settings.defaultDiscoveryWindowMs.value, row.seed.defaultDiscoveryWindowMs],
        [settings.defaultFundingWindowMs.value, row.seed.defaultFundingWindowMs],
      ] as const) {
        if (stored === undefined || seeded === undefined) {
          continue;
        }
        // Never LONGER than what the operator asked for: every move this holder makes to a window
        // is a shortening, which is the one safe direction.
        expect(stored).toBeLessThanOrEqual(seeded);
      }
    }
  });
});
