import { EventEmitter } from 'node:events';
import { bytesToHex } from '@noble/hashes/utils';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import type { AggregationResult, AggregationServiceRunner, SseStream } from '@did-btcr2/aggregation/service';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { Transaction } from '@scure/btc-signer';
import { describe, expect, it } from 'vitest';
import {
  attachBeaconBroadcast,
  BeaconBroadcaster,
  broadcastAndConfirm,
  rawBeaconTxHex,
  type BeaconAnchorEvents,
} from './broadcast.js';
import { bridgeRunnerToSse } from './dashboard-sse.js';

/** A finalized-tx stand-in: `extract()` returns fixed bytes (or throws). */
function fakeTx(extract: () => Uint8Array): Transaction {
  return { extract } as unknown as Transaction;
}

/** An instrumented mock esplora connection recording every call. */
function mockBitcoin(opts: {
  txid?: string;
  confirmSeq?: boolean[];
  sendThrows?: string;
}): { conn: BitcoinConnection; calls: { send: string[]; isConfirmed: number } } {
  const calls = { send: [] as string[], isConfirmed: 0 };
  let i = 0;
  const conn = {
    rest: {
      transaction: {
        send: async (hex: string): Promise<string> => {
          calls.send.push(hex);
          if (opts.sendThrows) {
            throw new Error(opts.sendThrows);
          }
          return opts.txid ?? 'txid-default';
        },
        isConfirmed: async (): Promise<boolean> => {
          const seq = opts.confirmSeq ?? [true];
          const v = seq[Math.min(i, seq.length - 1)];
          i += 1;
          calls.isConfirmed += 1;
          return v;
        },
      },
    },
  } as unknown as BitcoinConnection;
  return { conn, calls };
}

/** A runner stand-in backed by a real emitter, with a hook to fire signing-complete. */
function fakeRunner(): { runner: AggregationServiceRunner; emit: (r: AggregationResult) => void } {
  const ee = new EventEmitter();
  const runner = { on: ee.on.bind(ee), off: ee.off.bind(ee) } as unknown as AggregationServiceRunner;
  return { runner, emit: (r) => ee.emit('signing-complete', r) };
}

/** Resolve on the next emit of `event` (or reject after `ms`). */
function nextEvent<K extends keyof BeaconAnchorEvents>(
  broadcaster: BeaconBroadcaster,
  event: K,
  ms = 2000,
): Promise<BeaconAnchorEvents[K]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    timer.unref();
    broadcaster.on(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** A result with a finalized signed tx whose `extract()` yields `bytes`. */
function resultWith(bytes: Uint8Array, cohortId = 'c1'): AggregationResult {
  return {
    cohortId,
    signature: new Uint8Array(64),
    signedTx: fakeTx(() => bytes),
    path: 'key-path',
  };
}

describe('rawBeaconTxHex', () => {
  it('hex-encodes the extracted (finalized) tx bytes', () => {
    const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    expect(rawBeaconTxHex(fakeTx(() => bytes))).toBe('deadbeef');
  });

  it('propagates the extract() error for an unfinalized tx (tripwire)', () => {
    const tx = fakeTx(() => {
      throw new Error('Transaction has unfinalized inputs');
    });
    expect(() => rawBeaconTxHex(tx)).toThrow(/unfinalized/);
  });
});

describe('broadcastAndConfirm', () => {
  const HEX = 'abcdef';

  it('sends the raw hex, fires onBroadcast, and confirms', async () => {
    const { conn, calls } = mockBitcoin({ txid: 'TX', confirmSeq: [true] });
    const seen: string[] = [];
    const out = await broadcastAndConfirm(conn, HEX, { onBroadcast: (t) => seen.push(t) });
    expect(out).toEqual({ txid: 'TX', confirmed: true });
    expect(calls.send).toEqual([HEX]);
    expect(seen).toEqual(['TX']);
  });

  it('polls until confirmed', async () => {
    const { conn, calls } = mockBitcoin({ txid: 'TX', confirmSeq: [false, false, true] });
    const out = await broadcastAndConfirm(conn, HEX, { pollIntervalMs: 1, confirmTimeoutMs: 5000 });
    expect(out).toEqual({ txid: 'TX', confirmed: true });
    expect(calls.isConfirmed).toBe(3);
  });

  it('returns confirmed:false when the window elapses before a confirmation', async () => {
    const { conn } = mockBitcoin({ txid: 'TX', confirmSeq: [false] });
    const out = await broadcastAndConfirm(conn, HEX, { pollIntervalMs: 5, confirmTimeoutMs: 30 });
    expect(out).toEqual({ txid: 'TX', confirmed: false });
  });

  it('propagates a send() rejection', async () => {
    const { conn } = mockBitcoin({ sendThrows: 'sendrawtransaction RPC error: datacarrier' });
    await expect(broadcastAndConfirm(conn, HEX)).rejects.toThrow(/datacarrier/);
  });

  it('does not poll when the signal is already aborted (still returns the txid)', async () => {
    const { conn, calls } = mockBitcoin({ txid: 'TX', confirmSeq: [false] });
    const ac = new AbortController();
    ac.abort();
    const out = await broadcastAndConfirm(conn, HEX, { signal: ac.signal });
    expect(out).toEqual({ txid: 'TX', confirmed: false });
    expect(calls.isConfirmed).toBe(0);
  });
});

describe('attachBeaconBroadcast', () => {
  it('broadcasts the extracted signed tx and emits broadcast + anchored', async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const { conn, calls } = mockBitcoin({ txid: 'ANCHOR', confirmSeq: [true] });
    const broadcaster = new BeaconBroadcaster();
    const { runner, emit } = fakeRunner();
    const handle = attachBeaconBroadcast(runner, { bitcoin: conn, broadcaster });

    const broadcast = nextEvent(broadcaster, 'beacon-broadcast');
    const anchored = nextEvent(broadcaster, 'beacon-anchored');
    emit(resultWith(bytes));

    expect(await broadcast).toEqual({ cohortId: 'c1', txid: 'ANCHOR' });
    expect(await anchored).toEqual({ cohortId: 'c1', txid: 'ANCHOR', confirmed: true });
    // Path-unique: the exact finalized-tx bytes were the broadcast payload.
    expect(calls.send).toEqual([bytesToHex(bytes)]);
    handle.stop();
  });

  it('emits beacon-anchored with confirmed:false when broadcast but unmined in-window', async () => {
    // Guards the anchored payload's `confirmed` flag end-to-end through the handler:
    // a regression that hardcoded confirmed:true (mislabeling a pending tx as
    // anchored) would fail here.
    const { conn } = mockBitcoin({ txid: 'PENDING', confirmSeq: [false] });
    const broadcaster = new BeaconBroadcaster();
    const { runner, emit } = fakeRunner();
    const handle = attachBeaconBroadcast(runner, {
      bitcoin: conn,
      broadcaster,
      pollIntervalMs: 5,
      confirmTimeoutMs: 20,
    });

    const anchored = nextEvent(broadcaster, 'beacon-anchored');
    emit(resultWith(Uint8Array.from([7])));
    expect(await anchored).toEqual({ cohortId: 'c1', txid: 'PENDING', confirmed: false });
    handle.stop();
  });

  it('emits beacon-broadcast-failed when the signed tx will not extract', async () => {
    const { conn, calls } = mockBitcoin({ txid: 'X' });
    const broadcaster = new BeaconBroadcaster();
    const { runner, emit } = fakeRunner();
    const handle = attachBeaconBroadcast(runner, { bitcoin: conn, broadcaster, log: () => {} });

    const failed = nextEvent(broadcaster, 'beacon-broadcast-failed');
    emit({
      cohortId: 'c1',
      signature: new Uint8Array(),
      signedTx: fakeTx(() => {
        throw new Error('Transaction has unfinalized inputs');
      }),
    });
    expect((await failed).reason).toMatch(/unfinalized/);
    expect(calls.send).toEqual([]); // never reached the network
    handle.stop();
  });

  it('emits beacon-broadcast-failed when send() is rejected', async () => {
    const { conn } = mockBitcoin({ sendThrows: 'bad-txns-inputs-missingorspent' });
    const broadcaster = new BeaconBroadcaster();
    const { runner, emit } = fakeRunner();
    const handle = attachBeaconBroadcast(runner, { bitcoin: conn, broadcaster, log: () => {} });

    const failed = nextEvent(broadcaster, 'beacon-broadcast-failed');
    emit(resultWith(Uint8Array.from([9])));
    expect((await failed).reason).toMatch(/missingorspent/);
    handle.stop();
  });

  it('stop() detaches so a later signing-complete broadcasts nothing', async () => {
    const { conn, calls } = mockBitcoin({ txid: 'X', confirmSeq: [true] });
    const broadcaster = new BeaconBroadcaster();
    const { runner, emit } = fakeRunner();
    const handle = attachBeaconBroadcast(runner, { bitcoin: conn, broadcaster });
    handle.stop();

    let fired = false;
    broadcaster.on('beacon-broadcast', () => {
      fired = true;
    });
    emit(resultWith(Uint8Array.from([1])));
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(false);
    expect(calls.send).toEqual([]);
  });
});

describe('bridgeRunnerToSse - beacon anchor frames', () => {
  /** A capturing SseStream. */
  function capturingStream(): { stream: SseStream; frames: Array<{ event: string; data: unknown; id?: string }> } {
    const frames: Array<{ event: string; data: unknown; id?: string }> = [];
    let onCloseCb: (() => void) | undefined;
    const stream: SseStream = {
      writeEvent: (event, data, id) => frames.push({ event, data: JSON.parse(data), id }),
      writeComment: () => {},
      close: () => onCloseCb?.(),
      onClose: (cb) => {
        onCloseCb = cb;
      },
    };
    return { stream, frames };
  }

  it('forwards beacon-anchored with an explorer URL derived from the network', () => {
    const network = resolveNetwork('mutinynet');
    const broadcaster = new BeaconBroadcaster();
    const { runner } = fakeRunner();
    const { stream, frames } = capturingStream();
    const teardown = bridgeRunnerToSse(runner, stream, { broadcaster, network });

    broadcaster.emit('beacon-broadcast', { cohortId: 'c1', txid: 'TXID' });
    broadcaster.emit('beacon-anchored', { cohortId: 'c1', txid: 'TXID', confirmed: true });

    const anchored = frames.find((f) => f.event === 'beacon-anchored');
    expect(anchored?.data).toEqual({
      event: 'beacon-anchored',
      payload: {
        cohortId: 'c1',
        txid: 'TXID',
        confirmed: true,
        explorerUrl: 'https://mutinynet.com/tx/TXID',
      },
    });
    const broadcast = frames.find((f) => f.event === 'beacon-broadcast');
    expect((broadcast?.data as { payload: { explorerUrl: string } }).payload.explorerUrl).toBe(
      'https://mutinynet.com/tx/TXID',
    );
    teardown();
  });

  it('stops forwarding broadcaster events after teardown', () => {
    const network = resolveNetwork('mutinynet');
    const broadcaster = new BeaconBroadcaster();
    const { runner } = fakeRunner();
    const { stream, frames } = capturingStream();
    const teardown = bridgeRunnerToSse(runner, stream, { broadcaster, network });
    teardown();

    broadcaster.emit('beacon-anchored', { cohortId: 'c1', txid: 'TXID', confirmed: true });
    expect(frames.find((f) => f.event === 'beacon-anchored')).toBeUndefined();
  });
});
