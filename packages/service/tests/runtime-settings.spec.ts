import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { createHonoApp } from '../src/hono-adapter.js';
import { createRuntimeSettings } from '../src/runtime-settings.js';

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
});
