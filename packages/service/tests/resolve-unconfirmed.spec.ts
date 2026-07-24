import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk, type BeaconService, type DataNeed, type ResolverState } from '@did-btcr2/method';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import { createIdentity } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { driveResolution, UnconfirmedSignalError, type ResolverLike } from '../src/resolve.js';
import { MemoryArtifactStore } from '../src/store.js';
import { createHonoApp } from '../src/hono-adapter.js';

// D-46: an unconfirmed (mempool-resident) beacon signal carries no block_time, which makes the
// upstream @did-btcr2/method resolver derive an `Invalid Date` and throw generically. The resolve
// path must detect this in-repo (no library fork) and return a DISTINGUISHABLE retryable outcome -
// `A beacon signal is awaiting confirmation. Resolve again after it confirms.` (a 503) - not the
// generic 502 a genuine fault gets, nor a 500 throw. These tests exercise BOTH guard seams (the
// proactive signal-shape detection at NeedBeaconSignals AND the belt-and-suspenders Invalid-Date
// mapping in driveResolution) plus the route, and prove the 400 / 502 branches are preserved.

const SIGNAL_HEX = 'bb'.repeat(32);

/**
 * A mock esplora that reports one MEMPOOL-RESIDENT (unconfirmed) OP_RETURN beacon signal for
 * EVERY address: `status.confirmed = false`, so `block_height` / `block_time` are absent and the
 * indexer yields a signal whose `blockMetadata.time` is `undefined` - exactly the shape the D-46
 * seam guard detects. The OP_RETURN is a well-formed 32-byte push so the indexer accepts it as a
 * signal rather than skipping it.
 */
function unconfirmedChain(): BitcoinConnection {
  return {
    rest: {
      block: { count: async () => 200 },
      address: {
        getTxs: async () => [
          {
            txid: 'cc'.repeat(32),
            version: 2,
            locktime: 0,
            vin: [],
            size: 0,
            weight: 0,
            fee: 0,
            vout: [
              {
                scriptpubkey: `6a20${SIGNAL_HEX}`,
                scriptpubkey_asm: `OP_RETURN OP_PUSHBYTES_32 ${SIGNAL_HEX}`,
                scriptpubkey_type: 'op_return',
                value: 0,
              },
            ],
            status: { confirmed: false },
          },
        ],
      },
    },
  } as unknown as BitcoinConnection;
}

/** A confirmed empty chain (no signals): resolution completes at the deterministic genesis. */
function emptyChain(): BitcoinConnection {
  return {
    rest: {
      block: { count: async () => 200 },
      address: { getTxs: async () => [] },
    },
  } as unknown as BitcoinConnection;
}

const DID = 'did:btcr2:k1qexampleparticipant';

describe('driveResolution - D-46 unconfirmed-signal guard', () => {
  it('raises UnconfirmedSignalError at the NeedBeaconSignals seam for a mempool-resident signal', async () => {
    // The seam guard: the indexer returns a signal with no confirmation time, so the driver must
    // throw the distinguishable retryable error BEFORE provide() reaches the upstream Invalid Date.
    const addr = 'tb1pbeaconaddress';
    const service = {
      id: `${DID}#initialP2TR`,
      type: 'SingletonBeacon',
      serviceEndpoint: `bitcoin:${addr}`,
    } as unknown as BeaconService;
    const need: DataNeed = { kind: 'NeedBeaconSignals', beaconServices: [service] };
    const states: ResolverState[] = [
      { status: 'action-required', needs: [need] },
      { status: 'resolved', result: { didDocument: { id: DID } as never, metadata: { versionId: '1' } } },
    ];
    let i = 0;
    const resolver: ResolverLike = {
      resolve: () => states[Math.min(i++, states.length - 1)],
      provide: () => {},
    };
    await expect(driveResolution(resolver, DID, { bitcoin: unconfirmedChain() })).rejects.toBeInstanceOf(
      UnconfirmedSignalError,
    );
  });

  it('maps the upstream Invalid-Date throw to UnconfirmedSignalError (belt-and-suspenders)', async () => {
    // If a mempool signal shape slips past the seam, the upstream resolver throws the generic
    // `Invalid date: Invalid Date` during resolve(); the driver must normalize THAT to the same
    // retryable signal rather than letting it surface as a generic fault.
    const resolver: ResolverLike = {
      resolve: () => {
        throw new Error('Invalid date: Invalid Date');
      },
      provide: () => {},
    };
    await expect(driveResolution(resolver, DID, { bitcoin: emptyChain() })).rejects.toBeInstanceOf(
      UnconfirmedSignalError,
    );
  });

  it('lets a genuine (non-unconfirmed) failure propagate unchanged', async () => {
    // A real fault (here a missing artifact) is NOT the unconfirmed condition, so it must propagate
    // as ITSELF (never remapped to UnconfirmedSignalError), so the route can still map it to a
    // generic 502.
    const need: DataNeed = { kind: 'NeedGenesisDocument', genesisHash: 'aa'.repeat(32) } as DataNeed;
    const resolver: ResolverLike = {
      resolve: () => ({ status: 'action-required', needs: [need] }),
      provide: () => {},
    };
    const attempt = driveResolution(resolver, DID, {
      bitcoin: emptyChain(),
      store: new MemoryArtifactStore(),
      maxIterations: 3,
    });
    await expect(attempt).rejects.toThrow(/no genesis document/);
    await expect(attempt).rejects.not.toBeInstanceOf(UnconfirmedSignalError);
  });
});

describe('GET /resolve/:did route - D-46 retryable outcome', () => {
  function appWith(bitcoin: BitcoinConnection) {
    const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
    return createHonoApp(transport, { store: new MemoryArtifactStore(), bitcoin });
  }

  it('returns the retryable 503 outcome (not a 500/502) for an unconfirmed beacon signal', async () => {
    const { did } = createIdentity();
    const app = appWith(unconfirmedChain());
    const res = await app.request(`/resolve/${did}`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; retryable?: boolean };
    expect(body.error).toBe('A beacon signal is awaiting confirmation. Resolve again after it confirms.');
    expect(body.retryable).toBe(true);
  });

  it('still returns a generic 502 for a genuine upstream fault', async () => {
    // A chain read error is NOT the unconfirmed condition: the route must surface the generic 502
    // and never the retryable copy nor the raw error text.
    const throwingChain = {
      rest: {
        block: { count: async () => { throw new Error('esplora unreachable: connect ECONNREFUSED'); } },
        address: { getTxs: async () => [] },
      },
    } as unknown as BitcoinConnection;
    const app = appWith(throwingChain);
    const res = await app.request(`/resolve/${createIdentity().did}`);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('resolution failed');
    expect(body.error).not.toContain('awaiting confirmation');
  });

  it('still rejects a malformed DID with 400 before resolving', async () => {
    const app = appWith(unconfirmedChain());
    const res = await app.request('/resolve/not-a-did');
    expect(res.status).toBe(400);
  });
});
