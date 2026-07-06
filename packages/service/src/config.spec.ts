import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import { describe, expect, it } from 'vitest';
import { createHonoApp } from './hono-adapter.js';

// Hermetic coverage of the runtime network route `GET /v1/config`: the browser fetches
// this on load to derive its addresses/DIDs from the coordinator's chain instead of a
// build-time constant. In-memory (createHonoApp(...).request), no port, no chain.

/** A bare app with no store/bitcoin/runner - the config route must still be served. */
function bareApp(networkName?: string) {
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  return createHonoApp(transport, networkName ? { networkName: networkName as never } : {});
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
});
