import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { createIdentity } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { createOfflineBitcoinConnection } from './offline-chain.js';
import { resolveBtcr2 } from './resolve.js';
import { createHonoApp } from './hono-adapter.js';
import { MemoryArtifactStore } from './store.js';

describe('createOfflineBitcoinConnection', () => {
  it('answers every read as an empty chain and refuses to broadcast', async () => {
    const conn = createOfflineBitcoinConnection();
    expect(await conn.rest.block.count()).toBe(0);
    expect(await conn.rest.address.getTxs('tb1panything')).toEqual([]);
    expect(await conn.rest.address.getUtxos('tb1panything')).toEqual([]);
    expect(await conn.rest.transaction.isConfirmed('aa'.repeat(32))).toBe(false);
    await expect(conn.rest.transaction.send('00')).rejects.toThrow(/cannot broadcast/);
  });

  it('resolves a KEY DID to its genesis document (no signals, no network I/O)', async () => {
    // The whole point of the offline default: GET /resolve/:did still works and
    // returns the deterministic genesis document (its three SingletonBeacons, no
    // appended aggregate beacon), with zero network calls, so the gate stays
    // hermetic and the resolve UX is honest for an unregistered first update.
    const { did } = createIdentity();
    const { didDocument } = await resolveBtcr2(did, {
      bitcoin: createOfflineBitcoinConnection(),
      store: new MemoryArtifactStore(),
    });
    expect(didDocument.id).toBe(did);
    const services = (didDocument.service ?? []) as Array<{ id: string; type: string }>;
    expect(services.length).toBeGreaterThan(0);
    // Genesis only: no aggregate CAS/SMT beacon appended yet.
    expect(services.some((s) => s.type === 'CASBeacon' || s.type === 'SMTBeacon')).toBe(false);
  });
});

describe('Bitcoin tx proxy routes', () => {
  function appWith(bitcoin?: BitcoinConnection) {
    const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
    return createHonoApp(transport, { store: new MemoryArtifactStore(), bitcoin });
  }

  /** A mock connection that forwards a UTXO list and echoes a txid on send. */
  function forwardingChain(): BitcoinConnection {
    return {
      rest: {
        block: { count: async () => 100 },
        address: {
          getTxs: async () => [],
          getUtxos: async (addr: string) => [{ txid: 'bb'.repeat(32), vout: 0, value: 100_000, status: { confirmed: true }, addr }],
        },
        transaction: {
          send: async () => 'cc'.repeat(32),
          isConfirmed: async () => true,
        },
      },
    } as unknown as BitcoinConnection;
  }

  it('GET /v1/tx/utxos/:address forwards the UTXO list', async () => {
    const app = appWith(forwardingChain());
    const res = await app.request('/v1/tx/utxos/tb1pexampleaddress0000');
    expect(res.status).toBe(200);
    const utxos = (await res.json()) as Array<{ txid: string; value: number }>;
    expect(utxos).toHaveLength(1);
    expect(utxos[0].value).toBe(100_000);
  });

  it('GET /v1/tx/utxos returns [] for the offline connection', async () => {
    const app = appWith(createOfflineBitcoinConnection());
    const res = await app.request('/v1/tx/utxos/tb1pexampleaddress0000');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('GET /v1/tx/utxos rejects a malformed address with 400', async () => {
    const app = appWith(forwardingChain());
    for (const bad of ['short', 'has/slash/xxxxxxxx', 'has.dot.xxxxxxxxxx']) {
      const res = await app.request(`/v1/tx/utxos/${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
  });

  it('POST /v1/tx/broadcast relays a raw hex tx and returns the txid', async () => {
    const app = appWith(forwardingChain());
    const res = await app.request('/v1/tx/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawHex: '0200000000' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { txid: string };
    expect(body.txid).toBe('cc'.repeat(32));
  });

  it('POST /v1/tx/broadcast returns 502 for the offline connection', async () => {
    const app = appWith(createOfflineBitcoinConnection());
    const res = await app.request('/v1/tx/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawHex: '0200000000' }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('broadcast failed');
    expect(body.error).not.toContain('cannot broadcast');
  });

  it('POST /v1/tx/broadcast rejects a non-hex or malformed body with 400', async () => {
    const app = appWith(forwardingChain());
    // non-hex
    let res = await app.request('/v1/tx/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawHex: 'nothex!' }),
    });
    expect(res.status).toBe(400);
    // odd-length hex
    res = await app.request('/v1/tx/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawHex: 'abc' }),
    });
    expect(res.status).toBe(400);
    // not JSON
    res = await app.request('/v1/tx/broadcast', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('POST /v1/tx/broadcast rejects an oversized body with 413 (before buffering)', async () => {
    const app = appWith(forwardingChain());
    // A body over the 512 kB bodyLimit is rejected during streaming, not relayed.
    const res = await app.request('/v1/tx/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawHex: 'a'.repeat(600_000) }),
    });
    expect(res.status).toBe(413);
  });

  it('does not mount the tx proxy without a Bitcoin connection', async () => {
    const app = appWith(undefined);
    const utxos = await app.request('/v1/tx/utxos/tb1pexampleaddress0000');
    expect(utxos.status).toBe(404);
    const broadcast = await app.request('/v1/tx/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawHex: '00' }),
    });
    expect(broadcast.status).toBe(404);
  });
});
