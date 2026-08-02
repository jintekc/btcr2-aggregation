import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NETWORKS, type NetworkName } from '@btcr2-aggregation/shared';
import { chainEndpointFor, useParticipant } from '../src/stores/participant';
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
    // PRESERVED, and load-bearing: this is the boundary of the genesis-first rule below.
    // Our OWN block zero arrived, so block zero settles nothing and the marker is genuinely
    // required. If this row ever goes green as `mismatch`, the marker requirement was
    // deleted rather than narrowed.
    expect(
      classifyEndpoint({
        raw: ENDPOINT,
        ourNetwork: 'mutinynet',
        probe: { status: 'hashes', genesis: NETWORKS.mutinynet.genesisHash },
      }),
    ).toEqual({ kind: 'unreachable' });
  });

  /**
   * The default network against every foreign chain family (05-VERIFICATION.md Gap 2, review
   * WR-1). This is the configuration the product actually ships in, and it is the one the
   * matrix above never had: every existing mismatch row pairs `regtest` (no second marker, so
   * the marker guard is never reached) or signet with signet (the marker already observed).
   * On `mutinynet`, the project's own DEFAULT_NETWORK, a foreign chain's block zero never
   * earns a second probe, so before this was fixed all four families were reported as a host
   * that could not be reached, and the participant was sent to debug a working endpoint.
   */
  const FOREIGN_FAMILIES: NetworkName[] = ['bitcoin', 'testnet3', 'testnet4', 'regtest'];
  for (const theirs of FOREIGN_FAMILIES) {
    it(`names ${theirs} against the DEFAULT network, where no second marker can ever arrive`, () => {
      expect(
        classifyEndpoint({
          raw: ENDPOINT,
          ourNetwork: 'mutinynet',
          probe: { status: 'hashes', genesis: NETWORKS[theirs].genesisHash },
        }),
      ).toEqual({
        kind: 'mismatch',
        theirNetwork: NETWORKS[theirs].label,
        ourNetwork: NETWORKS.mutinynet.label,
      });
    });
  }

  it('names an unregistered chain honestly on the DEFAULT network too', () => {
    // The honest fallback has to survive the same reordering: a chain we cannot name is still
    // a chain we can tell apart from ours, and guessing a network name would be worse copy
    // than admitting we do not know which one it is.
    expect(
      classifyEndpoint({
        raw: ENDPOINT,
        ourNetwork: 'mutinynet',
        probe: { status: 'hashes', genesis: 'ab'.repeat(32) },
      }),
    ).toEqual({
      kind: 'mismatch',
      theirNetwork: UNRECOGNIZED_CHAIN,
      ourNetwork: NETWORKS.mutinynet.label,
    });
  });

  it('accepts NOTHING new: every registry pairing, with no marker observed', () => {
    // The safety half of the reordering (T-05-29-02). Moving a verdict from `unreachable` to
    // `mismatch` moves it between two refusals; widening acceptance instead would let a
    // foreign chain answer UTXO and confirmation questions on a real-funds path, which is
    // strictly worse than the defect being fixed. So the whole registry is driven both ways
    // and the ONLY pairing allowed to return `ok` is our own chain where block zero is
    // already unambiguous; everything else must refuse, and a foreign block zero must refuse
    // by NAMING the chain rather than by claiming the host could not be reached.
    const names = Object.keys(NETWORKS) as NetworkName[];
    for (const ours of names) {
      for (const theirs of names) {
        const verdict = classifyEndpoint({
          raw: ENDPOINT,
          ourNetwork: ours,
          probe: { status: 'hashes', genesis: NETWORKS[theirs].genesisHash },
        });
        const row = `${ours} <- ${theirs}`;
        const sameBlockZero = NETWORKS[theirs].genesisHash === NETWORKS[ours].genesisHash;
        const ambiguous = NETWORKS[ours].distinguishingBlock !== undefined;
        expect(verdict.kind === 'ok', row).toBe(sameBlockZero && !ambiguous);
        if (!sameBlockZero) {
          expect(verdict.kind, row).toBe('mismatch');
        }
      }
    }
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
    // ONE request on a chain that needs no second marker. Counting matters as much as the
    // verdict: a row that only read the verdict would pass just as happily against a probe that
    // asked twice and took whichever answer it liked, and this endpoint belongs to a third party
    // who is owed no more requests than the check actually needs.
    expect(calls).toHaveLength(1);
  });

  it('refuses an endpoint whose required second marker cannot be read at all', async () => {
    // Block zero agrees, so the signet-family second marker is genuinely required, and the
    // endpoint cannot serve it. "Cannot verify" is refused, never waved through (RESEARCH A3):
    // the alternative is treating a half-finished observation as a confirmed identity.
    stubChain({ 0: NETWORKS.mutinynet.genesisHash });
    expect(await checkEndpoint(ENDPOINT, 'mutinynet')).toEqual({ kind: 'unreachable' });
    expect(calls).toHaveLength(2);
  });

  it('stops after block zero when block zero already disagrees', async () => {
    // The second probe is gated on block zero ALREADY agreeing, and that gate is load-bearing in
    // both directions. It keeps the common case to one request, and it stops a height-one marker
    // that happens to match ours from rescuing an endpoint whose genesis is somebody else's
    // chain entirely. Both of those are still true, and both are still asserted here: one
    // request, and a matching height-one marker that rescues nothing.
    //
    // What changed (05-VERIFICATION.md Gap 2, review WR-1): the verdict this observation earns.
    // A block zero that is not ours already identifies the chain, so the honest answer is that
    // we know which chain it is, not that we could not verify it. This row read `unreachable`
    // until 05-29 and was the shape of the shipped defect on the default network.
    stubChain({
      0: NETWORKS.regtest.genesisHash,
      [NETWORKS.mutinynet.distinguishingBlock!.height]:
        NETWORKS.mutinynet.distinguishingBlock!.hash,
    });
    expect(await checkEndpoint(ENDPOINT, 'mutinynet')).toEqual({
      kind: 'mismatch',
      theirNetwork: NETWORKS.regtest.label,
      ourNetwork: NETWORKS.mutinynet.label,
    });
    expect(calls).toHaveLength(1);
  });

  it('names a mainnet endpoint on the DEFAULT network, in ONE request', async () => {
    // The orchestrated half of the Gap 2 rows above, and the scenario a participant actually
    // reaches: a mainnet esplora pasted into a mutinynet service. One request is all this
    // costs, because block zero settled it, and a third-party host is owed no more questions
    // than the check needs.
    stubChain({ 0: NETWORKS.bitcoin.genesisHash });
    expect(await checkEndpoint(ENDPOINT, 'mutinynet')).toEqual({
      kind: 'mismatch',
      theirNetwork: NETWORKS.bitcoin.label,
      ourNetwork: NETWORKS.mutinynet.label,
    });
    expect(calls).toHaveLength(1);
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
    // Exactly two: block zero, then the marker that block zero cannot settle.
    expect(calls).toHaveLength(2);
  });

  it('accepts the matching signet-family chain on the same shared genesis', async () => {
    stubChain({
      0: NETWORKS.mutinynet.genesisHash,
      [NETWORKS.mutinynet.distinguishingBlock!.height]:
        NETWORKS.mutinynet.distinguishingBlock!.hash,
    });
    expect(await checkEndpoint(ENDPOINT, 'mutinynet')).toEqual({ kind: 'ok', base: ENDPOINT });
    expect(calls).toHaveLength(2);
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

/**
 * The store half (PART-05, D-20, 05-RESEARCH Pitfall 8).
 *
 * The endpoint rides the SINGLE shipped `register()` path as a parameter. That is not a
 * style preference: the ADR 0010 real-funds acknowledgment, the re-entrancy guard and the
 * funding check all sit at the top of that one path, and a second "override" path is
 * precisely how such a gate stops firing without anybody deciding that it should.
 *
 * Some of what follows is asserted against the SOURCE rather than by driving the call.
 * Reaching the UTXO read requires the module-private first-update artifacts, which only a
 * real cohort round produces, so a behavioral test there would have to fake the very
 * thing it claims to prove. The source pins are narrow and specific instead: one register
 * path, one UTXO call site, one broadcast call site, both carrying the endpoint, the
 * three guards ahead of them, and no catch block that quietly retries through the
 * service. The 05-10 source-order pin is the precedent.
 */

/**
 * The `register()` body, isolated so a pin cannot accidentally match elsewhere.
 *
 * Located by BRACE MATCHING rather than by slicing up to the next known method: an extractor
 * anchored on whatever happens to be declared after `register()` silently widens the moment
 * anything is added between the two, and then reports a neighbour's call site as a second call
 * site inside `register()` (which is exactly what happened when 05-12 added the PSBT actions).
 * A pin that fails for the wrong reason is worse than no pin, because the next reader disarms it.
 */
function registerBody(): string {
  const path = fileURLToPath(new URL('../src/stores/participant.ts', import.meta.url));
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf('async register(');
  expect(start).toBeGreaterThan(0);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
    } else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error('register() body not found: unbalanced braces');
}

/** Count non-overlapping matches of `re` (which must be global) in `text`. */
function count(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

describe('participant store - the endpoint is a parameter, so no guard rail moves', () => {
  beforeEach(() => {
    useParticipant.setState({
      identity: null,
      did: null,
      network: 'mutinynet',
      regStatus: 'idle',
      regError: null,
      chainEndpoint: null,
      chainEndpointVerdict: null,
      chainEndpointProbing: false,
      broadcastDirect: false,
      endpointTxConfirmed: null,
      log: [],
    });
  });

  it('fires the mainnet real-funds gate identically with and without an endpoint', async () => {
    // The SAME scenario, twice. If the override were a second flow, this is the row that
    // would notice: an acknowledgment gate that fires in one mode and not the other.
    for (const endpoint of [null, 'https://esplora.example.com']) {
      useParticipant.setState({
        network: 'bitcoin',
        regStatus: 'idle',
        regError: null,
        chainEndpoint: endpoint,
        broadcastDirect: endpoint !== null,
      });
      await useParticipant.getState().register('http://127.0.0.1:0');
      const s = useParticipant.getState();
      expect(s.regStatus, String(endpoint)).toBe('failed');
      expect(s.regError, String(endpoint)).toMatch(/mainnet/i);
    }
  });

  it('holds the re-entrancy guard in both modes', async () => {
    for (const endpoint of [null, 'https://esplora.example.com']) {
      useParticipant.setState({
        network: 'bitcoin',
        regStatus: 'broadcasting',
        regError: null,
        chainEndpoint: endpoint,
      });
      await useParticipant.getState().register('http://127.0.0.1:0');
      // Untouched: the guard returned before the mainnet gate could rewrite it.
      expect(useParticipant.getState().regStatus, String(endpoint)).toBe('broadcasting');
      expect(useParticipant.getState().regError, String(endpoint)).toBeNull();
    }
  });

  it('keeps exactly ONE register path, ONE UTXO call site and ONE broadcast call site', () => {
    const body = registerBody();
    const path = fileURLToPath(new URL('../src/stores/participant.ts', import.meta.url));
    expect(count(readFileSync(path, 'utf8'), /async register\(/g)).toBe(1);
    expect(count(body, /fetchUtxos\(/g)).toBe(1);
    expect(count(body, /broadcastTx\(/g)).toBe(1);
    // The extractor really did stop at register()'s own closing brace: a widened slice would pull
    // in the neighbouring PSBT export, whose funding read is a different call site entirely.
    expect(body).not.toContain('async exportPsbt(');
    expect(body.trimEnd().endsWith('}')).toBe(true);
  });

  it('passes the endpoint INTO those two call sites rather than branching around them', () => {
    const body = registerBody();
    expect(body).toMatch(/fetchUtxos\([^)]*endpoint[^)]*\)/);
    expect(body).toMatch(/broadcastTx\([^)]*endpoint[^)]*\)/);
  });

  it('keeps the three guards ahead of the chain reads in source order', () => {
    const body = registerBody();
    const utxoRead = body.indexOf('fetchUtxos(');
    // Re-entrancy guard, then the ADR 0010 acknowledgment, both before any network I/O.
    expect(body.indexOf("regStatus === 'checking'")).toBeGreaterThan(-1);
    expect(body.indexOf("regStatus === 'checking'")).toBeLessThan(utxoRead);
    expect(body.indexOf('acknowledgeMainnet')).toBeLessThan(utxoRead);
    // The funding check reads the UTXOs, so it sits between the two chain calls.
    const funding = body.indexOf('MIN_REGISTRATION_FUNDING_SATS');
    expect(funding).toBeGreaterThan(utxoRead);
    expect(funding).toBeLessThan(body.indexOf('broadcastTx('));
  });

  it('has no failure path that quietly retries through the service', () => {
    // A silent fallback would take the participant's chosen trust source away from them
    // without saying so, which is the one thing this feature must never do. The catch
    // blocks are located by brace matching rather than by a character window, so the pin
    // means exactly what it says: neither chain call happens inside a failure handler.
    const body = registerBody();
    const utxoRead = body.indexOf('fetchUtxos(');
    const broadcast = body.indexOf('broadcastTx(');
    for (let at = body.indexOf('catch'); at !== -1; at = body.indexOf('catch', at + 1)) {
      const open = body.indexOf('{', at);
      let depth = 0;
      let close = open;
      for (; close < body.length; close += 1) {
        if (body[close] === '{') depth += 1;
        if (body[close] === '}') depth -= 1;
        if (depth === 0) break;
      }
      for (const call of [utxoRead, broadcast]) {
        expect(call > open && call < close, `call at ${call} inside catch at ${at}`).toBe(false);
      }
    }
  });
});

describe('participant store - chainEndpointFor is the one place the parameter is built', () => {
  it('is undefined with no endpoint, so the shipped call is made unchanged', () => {
    expect(chainEndpointFor({ chainEndpoint: null, broadcastDirect: false })).toBeUndefined();
    // Even with the broadcast opt-in somehow on, no endpoint means no direct anything.
    expect(chainEndpointFor({ chainEndpoint: null, broadcastDirect: true })).toBeUndefined();
  });

  it('reads the chain directly while broadcast still goes through the service', () => {
    expect(
      chainEndpointFor({ chainEndpoint: 'https://esplora.example.com', broadcastDirect: false }),
    ).toEqual({ esploraBase: 'https://esplora.example.com', broadcastDirect: false });
  });

  it('carries the second opt-in only when the participant turned it on', () => {
    expect(
      chainEndpointFor({ chainEndpoint: 'https://esplora.example.com', broadcastDirect: true }),
    ).toEqual({ esploraBase: 'https://esplora.example.com', broadcastDirect: true });
  });
});

describe('participant store - setting and clearing an endpoint', () => {
  beforeEach(() => {
    clearEndpointCache();
    useParticipant.setState({
      network: 'regtest',
      chainEndpoint: null,
      chainEndpointVerdict: null,
      chainEndpointProbing: false,
      broadcastDirect: false,
      endpointTxConfirmed: null,
      log: [],
    });
  });

  it('activates an endpoint that is on this service\'s chain', async () => {
    stubChain({ 0: NETWORKS.regtest.genesisHash });
    await useParticipant.getState().useChainEndpoint(ENDPOINT);
    const s = useParticipant.getState();
    expect(s.chainEndpoint).toBe(ENDPOINT);
    expect(s.chainEndpointVerdict).toEqual({ kind: 'ok', base: ENDPOINT });
    expect(s.chainEndpointProbing).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('judges the endpoint against THIS participant\'s chain, not a chain the code picked', async () => {
    // The row every other row in this block cannot be: it is the only one whose store network is
    // not the one they all share. That sameness was the hole (`05-AUDIT-2.md` entry 3) - with six
    // rows seeded to one chain, hardcoding the network at the store's single call into the
    // endpoint check passed all six, while a mutinynet participant would have been handed a
    // regtest esplora and read UTXOs and confirmations off the wrong chain, feeding `register()`'s
    // funding read and, with the second opt-in on, a direct broadcast (T-05-11-03).
    //
    // The shared-genesis pair is what makes the assertion sharp: this endpoint answers with the
    // signet family's genesis, which mutinynet ALSO carries, so only the height-one marker
    // separates them and only a check given mutinynet can tell the two apart.
    useParticipant.setState({ network: 'mutinynet' });
    stubChain({
      0: NETWORKS.signet.genesisHash,
      [NETWORKS.signet.distinguishingBlock!.height]: NETWORKS.signet.distinguishingBlock!.hash,
    });
    await useParticipant.getState().useChainEndpoint(ENDPOINT);
    const s = useParticipant.getState();
    expect(s.chainEndpoint).toBeNull();
    // The message names the STORE's own chain, not just the endpoint's. A refusal that named
    // only the far side would leave the participant unable to tell which of the two is wrong.
    expect(s.chainEndpointVerdict).toEqual({
      kind: 'mismatch',
      theirNetwork: NETWORKS.signet.label,
      ourNetwork: NETWORKS.mutinynet.label,
    });
    expect(calls).toHaveLength(2);
  });

  it('keeps a refused endpoint INACTIVE and holds its specific verdict', async () => {
    stubChain({ 0: NETWORKS.bitcoin.genesisHash });
    await useParticipant.getState().useChainEndpoint(ENDPOINT);
    const s = useParticipant.getState();
    expect(s.chainEndpoint).toBeNull();
    expect(s.chainEndpointVerdict).toEqual({
      kind: 'mismatch',
      theirNetwork: NETWORKS.bitcoin.label,
      ourNetwork: NETWORKS.regtest.label,
    });
  });

  it('tells a browser rejection apart from an unreachable host, in the store too', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await useParticipant.getState().useChainEndpoint(ENDPOINT);
    expect(useParticipant.getState().chainEndpointVerdict).toEqual({ kind: 'browser-rejected' });
    clearEndpointCache();
    stubFetch(() => textResponse('nope', 502));
    await useParticipant.getState().useChainEndpoint(ENDPOINT);
    expect(useParticipant.getState().chainEndpointVerdict).toEqual({ kind: 'unreachable' });
  });

  it('refuses a non-https endpoint without making a request', async () => {
    stubChain({ 0: NETWORKS.regtest.genesisHash });
    await useParticipant.getState().useChainEndpoint('esplora.example.com');
    expect(useParticipant.getState().chainEndpointVerdict).toEqual({ kind: 'malformed' });
    expect(calls).toHaveLength(0);
  });

  it('drops an active endpoint and its second opt-in on the explicit switch back', async () => {
    stubChain({ 0: NETWORKS.regtest.genesisHash });
    await useParticipant.getState().useChainEndpoint(ENDPOINT);
    useParticipant.getState().setBroadcastDirect(true);
    expect(useParticipant.getState().broadcastDirect).toBe(true);
    useParticipant.getState().clearChainEndpoint();
    const s = useParticipant.getState();
    expect(s.chainEndpoint).toBeNull();
    expect(s.chainEndpointVerdict).toBeNull();
    // The opt-in within the opt-in cannot outlive the opt-in it sits inside.
    expect(s.broadcastDirect).toBe(false);
    expect(s.endpointTxConfirmed).toBeNull();
  });

  it('cannot turn on direct broadcast without an active endpoint', () => {
    useParticipant.getState().setBroadcastDirect(true);
    expect(useParticipant.getState().broadcastDirect).toBe(false);
  });
});
