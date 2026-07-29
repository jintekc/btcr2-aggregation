import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { describe, expect, it } from 'vitest';
import { createHonoApp } from './hono-adapter.js';
import { createRuntimeSettings } from './runtime-settings.js';

// Hermetic coverage of the runtime network route `GET /v1/config`: the browser fetches
// this on load to derive its addresses/DIDs from the coordinator's chain instead of a
// build-time constant. In-memory (createHonoApp(...).request), no port, no chain.

/** A bare app with no store/bitcoin/runner - the config route must still be served. */
function bareApp(networkName?: string) {
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  return createHonoApp(transport, networkName ? { networkName: networkName as never } : {});
}

/** A bare app with an operator-supplied SERVICE_NAME threaded in (D-51). */
function namedApp(serviceName: string) {
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  return createHonoApp(transport, { serviceName });
}

/** A bare app wired with a runtime settings holder, exactly as `createService` wires one. */
function holderApp(serviceName?: string) {
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  const runtimeSettings = createRuntimeSettings({ serviceName });
  return { app: createHonoApp(transport, { runtimeSettings }), runtimeSettings };
}

describe('GET /v1/config route', () => {
  it('serves the default network (mutinynet) with no network threaded in', async () => {
    const res = await bareApp().request('/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { network: string; label: string; isMainnet: boolean };
    expect(body).toEqual({ network: 'mutinynet', label: 'Mutinynet (signet)', isMainnet: false });
  });

  it('serves the operator-configured network when one is threaded in', async () => {
    const res = await bareApp('signet').request('/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { network: string; isMainnet: boolean };
    expect(body.network).toBe('signet');
    expect(body.isMainnet).toBe(false);
  });

  it('flags mainnet so the client can guard before live actions', async () => {
    const res = await bareApp('bitcoin').request('/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { network: string; isMainnet: boolean };
    expect(body.network).toBe('bitcoin');
    expect(body.isMainnet).toBe(true);
  });

  it('is unconditional: mounts with no store, bitcoin, or runner', async () => {
    // The route must not depend on the live/resolve wiring (which is how the offline
    // hermetic default and the browser E2Es reach it). bareApp() passes none of them.
    const res = await bareApp().request('/v1/config');
    expect(res.status).toBe(200);
  });

  it('returns only JSON-safe fields (no function/secret leaks)', async () => {
    // NetworkConfig.explorerTxUrl is a function and scureNetwork carries no secrets,
    // but neither belongs on the wire: the client rebuilds them via resolveNetwork.
    const res = await bareApp().request('/v1/config');
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['isMainnet', 'label', 'network']);
    expect(body.explorerTxUrl).toBeUndefined();
    expect(body.scureNetwork).toBeUndefined();
    expect(body.esploraHost).toBeUndefined();
  });

  it('fails fast at construction on an unknown network name', () => {
    // An operator typo must surface at boot (resolveNetwork throws), not per-request.
    expect(() => bareApp('notanetwork')).toThrow(/Unknown Bitcoin network/);
  });

  it('includes the optional serviceName ADDITIVELY when SERVICE_NAME is set (D-51)', async () => {
    // The service-name carrier extends the config DTO for the health strip + public header
    // WITHOUT touching the frozen network fields: the three network keys stay byte-identical
    // (same values as the unnamed default above) plus the optional serviceName.
    const res = await namedApp('Acme Aggregation').request('/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      network: 'mutinynet',
      label: 'Mutinynet (signet)',
      isMainnet: false,
      serviceName: 'Acme Aggregation',
    });
  });

  it('serves the service name from the runtime holder PER REQUEST, network fields frozen (D-16)', async () => {
    // Phase 5 makes the name runtime-editable, so the route must read the holder on every
    // request. A value captured into the app's construction closure would serve the boot name
    // forever while the console claimed the rename applied. The frozen network fields stay
    // byte-identical across the change: only the additive key moves.
    const { app, runtimeSettings } = holderApp('Acme Aggregation');
    const before = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(before).toEqual({
      network: 'mutinynet',
      label: 'Mutinynet (signet)',
      isMainnet: false,
      serviceName: 'Acme Aggregation',
    });

    expect(runtimeSettings.applySettings({ serviceName: 'Acme (maintenance)' })).toBeUndefined();
    const after = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(after).toEqual({
      network: 'mutinynet',
      label: 'Mutinynet (signet)',
      isMainnet: false,
      serviceName: 'Acme (maintenance)',
    });

    // Cleared at runtime, the key disappears entirely rather than serving an empty string, so
    // the DTO an unnamed service serves is byte-identical to the pin above.
    expect(runtimeSettings.applySettings({ serviceName: '' })).toBeUndefined();
    const cleared = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(Object.keys(cleared).sort()).toEqual(['isMainnet', 'label', 'network']);
  });

  it('grows ADDITIVELY with the participation terms, network fields still byte-identical (SVC-05)', async () => {
    // The terms are the second operator-authored string this public read carries (D-19). The pin
    // that matters is the one below: the three frozen network fields keep the EXACT values the
    // unnamed default serves, so a participant client that only parses the network can never be
    // broken by an operator setting terms.
    const { app, runtimeSettings } = holderApp();
    expect(runtimeSettings.applySettings({ termsText: 'Be excellent to each other.' })).toBeUndefined();
    const body = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(body).toEqual({
      network: 'mutinynet',
      label: 'Mutinynet (signet)',
      isMainnet: false,
      termsText: 'Be excellent to each other.',
    });
    expect(body.network).toBe('mutinynet');
    expect(body.label).toBe('Mutinynet (signet)');
    expect(body.isMainnet).toBe(false);

    // Cleared, the key disappears entirely: empty terms mean the join flow has NO terms step,
    // which is a different fact from terms that say nothing.
    expect(runtimeSettings.applySettings({ termsText: '  ' })).toBeUndefined();
    const cleared = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(Object.keys(cleared).sort()).toEqual(['isMainnet', 'label', 'network']);
  });
});
