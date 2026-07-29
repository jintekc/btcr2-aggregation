import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORKS } from '@btcr2-aggregation/shared';
import { broadcastTx, fetchUtxos, TxProxyError } from '../src/lib/tx-client';
import {
  checkEndpoint,
  classifyEndpoint,
  clearEndpointCache,
  confirmTxAt,
  normalizeEndpoint,
  probeChain,
  UNRECOGNIZED_CHAIN,
} from '../src/lib/esplora';

/**
 * The participant-supplied chain endpoint (PART-05, D-20, UI-SPEC E16).
 *
 * Two properties carry this whole feature and both are asserted here rather than described.
 *
 * FIRST, the zero-config default must not move. The same-origin proxy is the shipped path and
 * stays the default (ADR 0003), so the no-endpoint rows below assert the built URLs, methods,
 * headers and bodies against LITERAL expected strings. A regression on the default path is the
 * expensive failure: it would break every participant, including the ones who never opted in.
 *
 * SECOND, the four failure modes must stay four. A browser cannot tell a cross-origin rejection
 * from a DNS failure by reading the error (both surface as an opaque `TypeError`), so the
 * classification comes from ORDERING - parse first, then probe, then compare - and never from
 * parsing a message. Collapsing them into one generic error would leave a participant unable to
 * decide what to do next, which is the one thing the copy exists to tell them.
 *
 * No chain hash literal appears in this file either: the expected hashes are read from the shared
 * registry, the same single source of truth the browser code reads.
 */

const SERVICE = 'http://coordinator.test';
const ENDPOINT = 'https://esplora.example.com';

/** One recorded `fetch` call, flattened to what the assertions actually care about. */
interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

let calls: Call[] = [];

/** A JSON response, matching what the coordinator proxy returns. */
function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
    text: async () => JSON.stringify(value),
  } as unknown as Response;
}

/** A plain-text response, matching what esplora returns for `POST /tx` and the block routes. */
function textResponse(value: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('not json');
    },
    text: async () => value,
  } as unknown as Response;
}

/** Install a fetch stub that answers from `route`, recording every call. */
function stubFetch(route: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers as Record<string, string>) ?? {},
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return route(url);
    }),
  );
}

/** Answer the two chain-marker routes with `hashes`, and 404 anything else. */
function stubChain(hashes: Record<number, string>): void {
  stubFetch((url) => {
    const m = /\/block-height\/(\d+)$/.exec(url);
    const hash = m ? hashes[Number(m[1])] : undefined;
    return hash ? textResponse(hash) : textResponse('Block not found', 404);
  });
}

beforeEach(() => {
  calls = [];
  clearEndpointCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tx-client - the zero-config proxy path is byte-identical without an endpoint', () => {
  it('reads UTXOs from the shipped proxy route', async () => {
    stubFetch(() => jsonResponse([{ txid: 'aa', vout: 0, value: 5000 }]));
    const utxos = await fetchUtxos(SERVICE, 'tb1pexample');
    expect(calls[0].url).toBe('http://coordinator.test/v1/tx/utxos/tb1pexample');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers).toEqual({ accept: 'application/json' });
    expect(utxos).toEqual([{ txid: 'aa', vout: 0, value: 5000 }]);
  });

  it('broadcasts through the shipped proxy route and reads the JSON txid', async () => {
    stubFetch(() => jsonResponse({ txid: 'abc123' }));
    const txid = await broadcastTx(SERVICE, 'deadbeef');
    expect(calls[0].url).toBe('http://coordinator.test/v1/tx/broadcast');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers).toEqual({ 'content-type': 'application/json' });
    expect(calls[0].body).toBe('{"rawHex":"deadbeef"}');
    expect(txid).toBe('abc123');
  });

  it('treats an endpoint object with no base as no endpoint at all', async () => {
    // The store always passes a ChainEndpoint value; an unset endpoint must therefore
    // be indistinguishable from the shipped call, not merely close to it.
    stubFetch((url) =>
      url.endsWith('/broadcast') ? jsonResponse({ txid: 'abc123' }) : jsonResponse([]),
    );
    await fetchUtxos(SERVICE, 'tb1pexample', { broadcastDirect: true });
    await broadcastTx(SERVICE, 'deadbeef', { broadcastDirect: true });
    expect(calls.map((c) => c.url)).toEqual([
      'http://coordinator.test/v1/tx/utxos/tb1pexample',
      'http://coordinator.test/v1/tx/broadcast',
    ]);
  });

  it('reports an unreachable proxy as status 0 and a proxy error with its status', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchUtxos(SERVICE, 'tb1pexample')).rejects.toMatchObject({ status: 0 });
    stubFetch(() => jsonResponse({ error: 'bad address' }, 400));
    await expect(fetchUtxos(SERVICE, 'tb1pexample')).rejects.toMatchObject({
      status: 400,
      message: 'bad address',
    });
  });
});

describe('tx-client - the direct esplora path is the SAME function with a parameter', () => {
  it('reads UTXOs from the esplora address route', async () => {
    stubFetch(() => jsonResponse([{ txid: 'bb', vout: 1, value: 9000 }]));
    const utxos = await fetchUtxos(SERVICE, 'tb1pexample', { esploraBase: ENDPOINT });
    expect(calls[0].url).toBe('https://esplora.example.com/address/tb1pexample/utxo');
    // Verbatim: esplora's AddressUtxo[] IS the shape the proxy forwards.
    expect(utxos).toEqual([{ txid: 'bb', vout: 1, value: 9000 }]);
  });

  it('strips a trailing slash so a pasted endpoint never doubles it', async () => {
    stubFetch(() => jsonResponse([]));
    await fetchUtxos(SERVICE, 'tb1pexample', { esploraBase: 'https://esplora.example.com/' });
    expect(calls[0].url).toBe('https://esplora.example.com/address/tb1pexample/utxo');
  });

  it('broadcasts as plain text and reads a BARE txid back, not JSON', async () => {
    // The one real asymmetry between the two paths: the proxy answers `{ txid }`, esplora
    // answers the txid as bare text. Parsing this as JSON would throw on every success.
    stubFetch(() => textResponse('  ffeeddcc\n'));
    const txid = await broadcastTx(SERVICE, 'deadbeef', {
      esploraBase: ENDPOINT,
      broadcastDirect: true,
    });
    expect(calls[0].url).toBe('https://esplora.example.com/tx');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers).toEqual({ 'content-type': 'text/plain' });
    expect(calls[0].body).toBe('deadbeef');
    expect(txid).toBe('ffeeddcc');
  });

  it('keeps broadcast on the service while the second opt-in is OFF', async () => {
    // Opt-in within the opt-in (D-20): reading the chain directly must not silently
    // move a real transaction onto an endpoint the participant only meant to read from.
    stubFetch(() => jsonResponse({ txid: 'abc123' }));
    const txid = await broadcastTx(SERVICE, 'deadbeef', { esploraBase: ENDPOINT });
    expect(calls[0].url).toBe('http://coordinator.test/v1/tx/broadcast');
    expect(txid).toBe('abc123');
  });

  it('refuses an empty direct broadcast answer rather than inventing a txid', async () => {
    stubFetch(() => textResponse('   '));
    await expect(
      broadcastTx(SERVICE, 'deadbeef', { esploraBase: ENDPOINT, broadcastDirect: true }),
    ).rejects.toBeInstanceOf(TxProxyError);
  });

  it('keeps the shipped error handling on the direct path (status 0 for a thrown fetch)', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      fetchUtxos(SERVICE, 'tb1pexample', { esploraBase: ENDPOINT }),
    ).rejects.toMatchObject({ status: 0 });
  });
});

describe('esplora - normalizeEndpoint refuses anything that is not https', () => {
  it('accepts an https URL and strips its trailing slash', () => {
    expect(normalizeEndpoint('https://esplora.example.com/')).toBe('https://esplora.example.com');
    expect(normalizeEndpoint('  https://esplora.example.com/api  ')).toBe(
      'https://esplora.example.com/api',
    );
  });

  it('refuses http, other schemes, and text that is not a URL', () => {
    for (const raw of ['http://esplora.example.com', 'ftp://x.example', 'esplora.example.com', '']) {
      expect(normalizeEndpoint(raw), raw).toBeNull();
    }
  });
});

describe('esplora - probeChain reads the chain marker at a height', () => {
  it('asks for the block hash at the requested height and trims the answer', async () => {
    stubChain({ 0: NETWORKS.regtest.genesisHash });
    const hash = await probeChain(ENDPOINT, 0);
    expect(calls[0].url).toBe('https://esplora.example.com/block-height/0');
    expect(calls[0].headers).toEqual({ accept: 'text/plain' });
    expect(hash).toBe(NETWORKS.regtest.genesisHash);
  });

  it('throws with the shipped status-zero convention when the fetch itself throws', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(probeChain(ENDPOINT, 0)).rejects.toMatchObject({ status: 0 });
  });
});

describe('esplora - classifyEndpoint is a pure verdict over one observation', () => {
  it('returns malformed for a non-https input regardless of the probe', () => {
    expect(
      classifyEndpoint({
        raw: 'http://esplora.example.com',
        ourNetwork: 'mutinynet',
        probe: { status: 'hashes', genesis: NETWORKS.mutinynet.genesisHash },
      }),
    ).toEqual({ kind: 'malformed' });
  });

  it('returns ok when the observed chain is this service\'s chain', () => {
    expect(
      classifyEndpoint({
        raw: ENDPOINT,
        ourNetwork: 'regtest',
        probe: { status: 'hashes', genesis: NETWORKS.regtest.genesisHash },
      }),
    ).toEqual({ kind: 'ok', base: ENDPOINT });
  });

  it('names BOTH chains on a mismatch, so the participant can see what happened', () => {
    const verdict = classifyEndpoint({
      raw: ENDPOINT,
      ourNetwork: 'regtest',
      probe: { status: 'hashes', genesis: NETWORKS.bitcoin.genesisHash },
    });
    expect(verdict).toEqual({
      kind: 'mismatch',
      theirNetwork: NETWORKS.bitcoin.label,
      ourNetwork: NETWORKS.regtest.label,
    });
  });

  it('names an unfamiliar chain honestly rather than guessing a network', () => {
    const verdict = classifyEndpoint({
      raw: ENDPOINT,
      ourNetwork: 'regtest',
      probe: { status: 'hashes', genesis: 'ab'.repeat(32) },
    });
    expect(verdict).toMatchObject({ kind: 'mismatch', theirNetwork: UNRECOGNIZED_CHAIN });
  });

  it('keeps browser-rejected and unreachable apart', () => {
    expect(
      classifyEndpoint({ raw: ENDPOINT, ourNetwork: 'regtest', probe: { status: 'rejected' } }),
    ).toEqual({ kind: 'browser-rejected' });
    expect(
      classifyEndpoint({ raw: ENDPOINT, ourNetwork: 'regtest', probe: { status: 'unreachable' } }),
    ).toEqual({ kind: 'unreachable' });
  });

  it('refuses rather than passing when a required second marker was not observed', () => {
    // A3 mitigation: "cannot verify" is refused with honest copy, never waved through.
    expect(
      classifyEndpoint({
        raw: ENDPOINT,
        ourNetwork: 'mutinynet',
        probe: { status: 'hashes', genesis: NETWORKS.mutinynet.genesisHash },
      }),
    ).toEqual({ kind: 'unreachable' });
  });
});

describe('esplora - checkEndpoint orders parse, probe, compare', () => {
  it('refuses a non-https endpoint BEFORE any request is made', async () => {
    stubChain({ 0: NETWORKS.mutinynet.genesisHash });
    const verdict = await checkEndpoint('http://esplora.example.com', 'mutinynet');
    expect(verdict).toEqual({ kind: 'malformed' });
    expect(calls).toHaveLength(0);
  });

  it('accepts an endpoint on this service\'s chain', async () => {
    stubChain({
      0: NETWORKS.regtest.genesisHash,
    });
    expect(await checkEndpoint(ENDPOINT, 'regtest')).toEqual({ kind: 'ok', base: ENDPOINT });
  });

  it('separates two signet-family chains that SHARE a genesis block', async () => {
    // The whole reason the registry carries a second marker: mutinynet and signet have
    // the same block zero, so block zero alone would wave a signet endpoint through to a
    // mutinynet participant, which is exactly the confidently-wrong answer T-05-11-03
    // exists to prevent.
    stubChain({
      0: NETWORKS.signet.genesisHash,
      [NETWORKS.signet.distinguishingBlock!.height]: NETWORKS.signet.distinguishingBlock!.hash,
    });
    expect(await checkEndpoint(ENDPOINT, 'mutinynet')).toEqual({
      kind: 'mismatch',
      theirNetwork: NETWORKS.signet.label,
      ourNetwork: NETWORKS.mutinynet.label,
    });
  });

  it('accepts the matching signet-family chain on the same shared genesis', async () => {
    stubChain({
      0: NETWORKS.mutinynet.genesisHash,
      [NETWORKS.mutinynet.distinguishingBlock!.height]:
        NETWORKS.mutinynet.distinguishingBlock!.hash,
    });
    expect(await checkEndpoint(ENDPOINT, 'mutinynet')).toEqual({ kind: 'ok', base: ENDPOINT });
  });

  it('classifies a thrown fetch as browser-rejected, not as unreachable', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await checkEndpoint(ENDPOINT, 'regtest')).toEqual({ kind: 'browser-rejected' });
  });

  it('classifies an endpoint that answers but cannot be read as unreachable', async () => {
    stubFetch(() => textResponse('Service Unavailable', 503));
    expect(await checkEndpoint(ENDPOINT, 'regtest')).toEqual({ kind: 'unreachable' });
  });

  it('classifies a nonsense body as unreachable rather than as a foreign chain', async () => {
    stubFetch(() => textResponse('<html>hello</html>'));
    expect(await checkEndpoint(ENDPOINT, 'regtest')).toEqual({ kind: 'unreachable' });
  });

  it('caches the verdict per endpoint so a dead host is not probed on every read', async () => {
    stubChain({ 0: NETWORKS.regtest.genesisHash });
    await checkEndpoint(ENDPOINT, 'regtest');
    const afterFirst = calls.length;
    await checkEndpoint(ENDPOINT, 'regtest');
    expect(calls.length).toBe(afterFirst);
    // A different chain is a different question, so it is asked again.
    await checkEndpoint(ENDPOINT, 'bitcoin');
    expect(calls.length).toBeGreaterThan(afterFirst);
  });
});

describe('esplora - confirmTxAt is an ADDITIONAL check on a known txid', () => {
  it('reads the esplora transaction route and reports a confirmed transaction', async () => {
    stubFetch(() => jsonResponse({ status: { confirmed: true, block_height: 42 } }));
    expect(await confirmTxAt(ENDPOINT, 'ffee')).toBe(true);
    expect(calls[0].url).toBe('https://esplora.example.com/tx/ffee');
  });

  it('reports an unknown or unconfirmed transaction as not confirmed, never as an error', async () => {
    stubFetch(() => jsonResponse({ status: { confirmed: false } }));
    expect(await confirmTxAt(ENDPOINT, 'ffee')).toBe(false);
    stubFetch(() => textResponse('Transaction not found', 404));
    expect(await confirmTxAt(ENDPOINT, 'ffee')).toBe(false);
  });
});
