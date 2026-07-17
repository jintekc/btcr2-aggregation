import { describe, expect, it } from 'vitest';
import type { NetworkConfig } from '@btcr2-aggregation/shared';
import { BeaconBroadcaster } from './broadcast.js';
import { createAnchorState } from './anchor-state.js';

// Hermetic coverage of the retained anchor-state fold (D-20/D-21/D-22). A real
// BeaconBroadcaster (a tiny typed EventEmitter) is the sole producer, so the spec
// drives the exact frames broadcast.ts emits (beacon-broadcast / beacon-anchored /
// beacon-broadcast-failed) and asserts the pollable last-known DTO. No port, no chain,
// no esplora: the read never touches the network by design (T-03-02-05).

/** A stub network whose explorerTxUrl is deterministic, mirroring the mutinynet shape. */
const STUB_NETWORK = {
  explorerTxUrl: (txid: string) => `https://example.test/tx/${txid}`,
} as unknown as NetworkConfig;

describe('createAnchorState', () => {
  it('folds broadcast -> confirmed, carrying the txid and deriving explorerUrl', () => {
    const broadcaster = new BeaconBroadcaster();
    const anchor = createAnchorState(broadcaster, STUB_NETWORK);

    broadcaster.emit('beacon-broadcast', { cohortId: 'c1', txid: 'tx-abc' });
    let dto = anchor.read('c1');
    expect(dto.enabled).toBe(true);
    expect(dto.state).toBe('broadcast');
    expect(dto.txid).toBe('tx-abc');
    expect(dto.explorerUrl).toBe('https://example.test/tx/tx-abc');

    // beacon-anchored{confirmed:true} -> confirmed.
    broadcaster.emit('beacon-anchored', { cohortId: 'c1', txid: 'tx-abc', confirmed: true });
    dto = anchor.read('c1');
    expect(dto.state).toBe('confirmed');
    expect(dto.txid).toBe('tx-abc');
  });

  it('keeps confirmed:false as broadcast (pending, not a failure)', () => {
    const broadcaster = new BeaconBroadcaster();
    const anchor = createAnchorState(broadcaster);

    broadcaster.emit('beacon-broadcast', { cohortId: 'c1', txid: 'tx-abc' });
    broadcaster.emit('beacon-anchored', { cohortId: 'c1', txid: 'tx-abc', confirmed: false });
    expect(anchor.read('c1').state).toBe('broadcast');
  });

  it('folds a broadcast failure to failed with a GENERIC reason (never the raw error)', () => {
    const broadcaster = new BeaconBroadcaster();
    const anchor = createAnchorState(broadcaster);

    broadcaster.emit('beacon-broadcast-failed', {
      cohortId: 'c1',
      reason: 'esplora 400: sendrawtransaction RPC error {code:-26} min relay fee not met',
    });
    const dto = anchor.read('c1');
    expect(dto.state).toBe('failed');
    // The raw esplora/policy detail must never leak on the public read; a generic
    // failure reason mirrors the 502-generic-body convention (T-03-02-01).
    expect(dto.reason).toBe('broadcast failed');
    expect(dto.reason).not.toContain('esplora');
    expect(dto.reason).not.toContain('RPC');
  });

  it('reports enabled === Boolean(broadcaster): true with one, false without', () => {
    expect(createAnchorState(new BeaconBroadcaster()).read('c1').enabled).toBe(true);

    const noBroadcaster = createAnchorState();
    const dto = noBroadcaster.read('c1');
    expect(dto.enabled).toBe(false);
    expect(dto.state).toBe('none');
  });

  it('answers an unknown cohortId with state:none (no existence oracle), never throwing', () => {
    const anchor = createAnchorState(new BeaconBroadcaster(), STUB_NETWORK);
    const dto = anchor.read('never-existed');
    expect(dto.state).toBe('none');
    expect(dto.txid).toBeUndefined();
    // A never-existed cohort and an evicted one are indistinguishable (T-03-02-02).
    expect(dto.explorerUrl).toBeUndefined();
  });

  it('bounds the retained map at 24, evicting the OLDEST cohort first', () => {
    const broadcaster = new BeaconBroadcaster();
    const anchor = createAnchorState(broadcaster);

    // Broadcast 25 distinct cohorts; insertion order makes cohort-0 the oldest.
    for (let i = 0; i < 25; i++) {
      broadcaster.emit('beacon-broadcast', { cohortId: `c${i}`, txid: `tx-${i}` });
    }
    // The oldest (c0) is evicted past the 24 cap -> reads as a non-oracle none.
    expect(anchor.read('c0').state).toBe('none');
    // The newest 24 (c1..c24) are all retained.
    expect(anchor.read('c1').state).toBe('broadcast');
    expect(anchor.read('c24').state).toBe('broadcast');
  });

  it('never subscribes (and never derives explorerUrl) when no broadcaster is present', () => {
    const anchor = createAnchorState(undefined, STUB_NETWORK);
    // Every read is the fail-open none DTO; there is no producer to fold from.
    expect(anchor.read('c1')).toEqual({ enabled: false, state: 'none' });
  });

  it('omits explorerUrl when the network throws or is absent, never crashing the read', () => {
    const broadcaster = new BeaconBroadcaster();
    const throwingNetwork = {
      explorerTxUrl: () => {
        throw new Error('bad network');
      },
    } as unknown as NetworkConfig;
    const anchor = createAnchorState(broadcaster, throwingNetwork);

    broadcaster.emit('beacon-broadcast', { cohortId: 'c1', txid: 'tx-abc' });
    const dto = anchor.read('c1');
    expect(dto.state).toBe('broadcast');
    expect(dto.txid).toBe('tx-abc');
    // A bad/absent explorer must never throw on the anonymous read (mirrors dashboard-sse).
    expect(dto.explorerUrl).toBeUndefined();
  });
});
