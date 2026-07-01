import { pathToFileURL } from 'node:url';
import { encode } from '@did-btcr2/common';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Address, OutScript, Transaction } from '@scure/btc-signer';
import type { BTC_NETWORK } from '@scure/btc-signer/utils';
import { createParticipant } from '@btcr2-aggregation/participant';
import { createService } from '@btcr2-aggregation/service';
import {
  buildCohortConfig,
  createIdentity,
  resolveNetwork,
  type BeaconType,
  type Identity,
} from '@btcr2-aggregation/shared';

/**
 * Hermetic proof of the M3c LIVE beacon-tx wiring, with NO real chain. Drives a
 * real fixture cohort (CAS and SMT) through `createService({ live: true })` with a
 * MOCK esplora connection injected: the runner's live `onProvideTxData` builds a
 * genuine aggregation beacon tx (`buildAggregationBeaconTx`) spending a mock-funded
 * UTXO at the cohort's real Taproot beacon address, then n-of-n MuSig2 co-signing
 * runs over that tx to a 64-byte aggregated signature. Nothing is broadcast (the
 * mock's `send` throws), so this stays in the hermetic gate; a real broadcast +
 * confirmation is the operator-funded M3c-live step behind a real BitcoinConnection.
 */

/** Reject if `p` does not settle within `ms` (the timeout does not keep Node alive). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref();
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Minimal harvested-cohort view the assertions read (a real AggregationCohort fits). */
interface HarvestedCohort {
  beaconAddress: string;
  signalBytes?: Uint8Array;
}

/** A minimal view of the signed beacon tx (inputs + outputs) the assertions read. */
interface SignedTxView {
  outputsLength: number;
  getOutput(i: number): { script?: Uint8Array };
  getInput(i: number): { txid?: Uint8Array };
}

/** An instrumented mock esplora connection: records every call so the e2e can prove
 * the LIVE builder actually used it (impossible on the fixture path) and that
 * nothing was broadcast. */
interface MockBitcoin {
  rest: unknown;
  /** Call tallies: the pre-flight + builder both hit getUtxos/getHex. */
  calls: { getUtxos: number; getHex: number; send: number };
  /** txids of the prev txs the mock served (the UTXO the live tx must spend). */
  servedTxids: Set<string>;
  /** Raw hex strings passed to `send` (empty unless the broadcast variant runs). */
  sentHex: string[];
}

/** Options for {@link mockBitcoin}. */
interface MockBitcoinOptions {
  /**
   * When false (default), `send` records the call and THROWS - broadcast is
   * disabled, proving the no-broadcast live path never pushes a tx. When true,
   * `send` records the raw hex and returns {@link broadcastTxid}, exercising the
   * broadcast wiring hermetically (still no real network).
   */
  broadcast?: boolean;
  /** The txid `send` returns in broadcast mode (default a fixed sentinel). */
  broadcastTxid?: string;
}

/**
 * An instrumented mock esplora connection. `getUtxos(addr)` lazily builds a real
 * prev tx paying `addr` (so `buildAggregationBeaconTx`'s nonWitnessUtxo / txid /
 * witnessUtxo all reconcile - the prev tx is deterministic, so repeated calls yield
 * one stable txid) and returns one confirmed UTXO; `getHex` returns that prev tx.
 * `send` is broadcast-disabled by default (records + throws); in broadcast mode it
 * records the raw hex and returns a sentinel txid. Every method bumps a counter so
 * the assertions can prove the live path ran.
 */
function mockBitcoin(network: BTC_NETWORK, valueSats = 100000, opts: MockBitcoinOptions = {}): MockBitcoin {
  const prevByTxid = new Map<string, string>();
  const calls = { getUtxos: 0, getHex: 0, send: 0 };
  const servedTxids = new Set<string>();
  const sentHex: string[] = [];
  const broadcastTxid = opts.broadcastTxid ?? 'ab'.repeat(32);
  return {
    calls,
    servedTxids,
    sentHex,
    rest: {
      address: {
        getUtxos: async (addr: string) => {
          calls.getUtxos += 1;
          const script = OutScript.encode(Address(network).decode(addr));
          const prev = new Transaction({ allowUnknownOutputs: true, allowUnknownInputs: true, version: 2 });
          prev.addOutput({ script, amount: BigInt(valueSats) });
          prev.addInput({ txid: new Uint8Array(32), index: 0xffffffff, sequence: 0xffffffff, finalScriptSig: hexToBytes('00') });
          prevByTxid.set(prev.id, prev.hex);
          servedTxids.add(prev.id);
          return [{ txid: prev.id, vout: 0, value: valueSats, status: { confirmed: true, block_height: 100 } }];
        },
      },
      transaction: {
        getHex: async (txid: string) => {
          calls.getHex += 1;
          return prevByTxid.get(txid) ?? '';
        },
        send: async (hex: string) => {
          calls.send += 1;
          sentHex.push(hex);
          if (!opts.broadcast) {
            throw new Error('mock esplora: broadcast is disabled in the hermetic live-mock e2e');
          }
          return broadcastTxid;
        },
        isConfirmed: async () => true,
      },
    },
  };
}

/** The last output's script hex of a signed tx (the OP_RETURN carrying the signal). */
function lastOutputScriptHex(tx: SignedTxView): string {
  const out = tx.getOutput(tx.outputsLength - 1);
  return out.script ? bytesToHex(out.script) : '';
}

/**
 * The input's prevout txid in both byte orders. scure's `getInput().txid` bytes
 * match the mock's `prev.id` directly (same internal order), so `internal` is the
 * one that matches `servedTxids`; `display` (reversed, the block-explorer form) is
 * compared too so the discriminator survives a byte-order convention flip.
 * `Uint8Array.from` copies first, so `.reverse()` never mutates the original txid.
 */
function inputTxidHexes(tx: SignedTxView): { internal: string; display: string } {
  const txid = tx.getInput(0).txid ?? new Uint8Array(0);
  return { internal: bytesToHex(txid), display: bytesToHex(Uint8Array.from(txid).reverse()) };
}

/** Drive one live-mock cohort of `beaconType`; return any problems (empty = pass). */
async function runLiveMockCohort(beaconType: BeaconType, quiet: boolean): Promise<string[]> {
  const n = 2;
  const log = quiet ? () => {} : (msg: string) => console.log(msg);
  const config = buildCohortConfig(n, beaconType);
  const network = resolveNetwork(config.network).scureNetwork;

  const serviceIdentity = createIdentity();
  const participantIdentities: Identity[] = Array.from({ length: n }, () => createIdentity());
  const bitcoin = mockBitcoin(network);
  const service = createService({
    identity: serviceIdentity,
    config,
    live: true,
    bitcoin: bitcoin as never,
  });

  let cohortId = '';
  service.runner.on('signing-complete', (result) => {
    cohortId = result.cohortId;
  });

  const { baseUrl } = await service.start(0);
  const participants = participantIdentities.map((identity) =>
    createParticipant({ identity, baseUrl, beaconType }),
  );
  const participantComplete = participants.map(
    (participant) =>
      new Promise<void>((resolve) => participant.runner.on('cohort-complete', () => resolve())),
  );

  try {
    await Promise.all(participants.map((participant) => participant.start()));
    const result = await withTimeout(service.runner.run(), 30000, `${beaconType} live-mock run`);
    await withTimeout(Promise.all(participantComplete), 15000, 'participant completion');

    const problems: string[] = [];
    if (result.signature.length !== 64) {
      problems.push(`expected a 64-byte aggregated signature, got ${result.signature.length}`);
    }
    if (!result.signedTx) {
      problems.push('expected a signed beacon transaction, got none');
    }
    if (!cohortId) {
      problems.push('no cohortId captured from signing-complete');
      return problems;
    }
    const cohort = service.runner.session.getCohort(cohortId) as HarvestedCohort | undefined;
    if (!cohort?.signalBytes) {
      problems.push('cohort or its signalBytes missing after completion');
      return problems;
    }

    // DISCRIMINATORS (must distinguish the live path from the fixture path - the
    // fixture emits a byte-identical OP_RETURN and a 64-byte sig, so those alone
    // prove nothing). The live builder is the ONLY thing that touches the injected
    // connection, so a non-zero getUtxos/getHex count proves buildAggregationBeaconTx
    // ran on the mock; send must stay 0 (nothing broadcast).
    if (bitcoin.calls.getUtxos === 0 || bitcoin.calls.getHex === 0) {
      problems.push(
        `live builder never used the injected connection (getUtxos=${bitcoin.calls.getUtxos}, ` +
          `getHex=${bitcoin.calls.getHex}) - the fixture path must have run`,
      );
    }
    if (bitcoin.calls.send !== 0) {
      problems.push(`beacon tx was broadcast (send called ${bitcoin.calls.send}x); this e2e must not broadcast`);
    }

    if (result.signedTx) {
      const tx = result.signedTx as unknown as SignedTxView;
      // The signed tx must commit to the cohort's real signal in its trailing
      // OP_RETURN (6a20 = OP_RETURN OP_PUSHBYTES_32).
      const expectedOpReturn = `6a20${encode(cohort.signalBytes, 'hex')}`;
      const actualOpReturn = lastOutputScriptHex(tx);
      if (actualOpReturn !== expectedOpReturn) {
        problems.push(`beacon tx OP_RETURN: expected ${expectedOpReturn}, got ${actualOpReturn}`);
      }
      // The input must spend the mock-funded UTXO, NOT the fixture's dummy all-zero
      // prevout. A real (non-zero) txid that matches a txid the mock served is a
      // hard, on-tx discriminator the fixture path can never satisfy.
      const { internal, display } = inputTxidHexes(tx);
      const zero = '00'.repeat(32);
      if (internal === zero || display === zero) {
        problems.push('beacon tx input spends the all-zero fixture prevout, not a funded UTXO');
      } else if (!bitcoin.servedTxids.has(internal) && !bitcoin.servedTxids.has(display)) {
        problems.push(
          `beacon tx input txid (${display}) does not match any UTXO the mock served ` +
            `[${[...bitcoin.servedTxids].join(', ')}]`,
        );
      }
    }
    if (problems.length === 0) {
      log(
        `[ok] ${beaconType}: live path built a real beacon tx spending the mock-funded ` +
          `beacon UTXO at ${cohort.beaconAddress}; MuSig2 co-signing reached a 64-byte signature`,
      );
    }
    return problems;
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

/**
 * Drive one live-mock cohort of `beaconType` through `createService({ live: true,
 * broadcast: true })` with a broadcast-enabled mock esplora. Proves the M3c-live
 * BROADCAST wiring hermetically: on `signing-complete` the service extracts the
 * finalized beacon tx and pushes it via the injected `send`, then emits the
 * `beacon-broadcast` / `beacon-anchored` lifecycle on `service.broadcaster`.
 * Returns any problems (empty = pass).
 */
async function runLiveBroadcastMockCohort(beaconType: BeaconType, quiet: boolean): Promise<string[]> {
  const n = 2;
  const log = quiet ? () => {} : (msg: string) => console.log(msg);
  const config = buildCohortConfig(n, beaconType);
  const network = resolveNetwork(config.network).scureNetwork;
  const broadcastTxid = 'ab'.repeat(32);

  const bitcoin = mockBitcoin(network, 100000, { broadcast: true, broadcastTxid });
  const service = createService({
    identity: createIdentity(),
    config,
    live: true,
    broadcast: true,
    bitcoin: bitcoin as never,
    // Confirmation is instant (mock isConfirmed -> true), so a tight poll is fine.
    confirmPollIntervalMs: 10,
    confirmTimeoutMs: 3000,
  });

  const broadcaster = service.broadcaster;
  if (!broadcaster) {
    await service.stop();
    return ['service.broadcaster is undefined despite broadcast:true'];
  }

  let broadcastEvent: { cohortId: string; txid: string } | undefined;
  let anchoredEvent: { cohortId: string; txid: string; confirmed: boolean } | undefined;
  const anchored = new Promise<void>((resolve) => {
    broadcaster.on('beacon-broadcast', (p) => {
      broadcastEvent = p;
    });
    broadcaster.on('beacon-anchored', (p) => {
      anchoredEvent = p;
      resolve();
    });
  });

  const { baseUrl } = await service.start(0);
  const participantIdentities: Identity[] = Array.from({ length: n }, () => createIdentity());
  const participants = participantIdentities.map((identity) =>
    createParticipant({ identity, baseUrl, beaconType }),
  );
  const participantComplete = participants.map(
    (participant) =>
      new Promise<void>((resolve) => participant.runner.on('cohort-complete', () => resolve())),
  );

  try {
    await Promise.all(participants.map((participant) => participant.start()));
    const result = await withTimeout(service.runner.run(), 30000, `${beaconType} live-broadcast run`);
    await withTimeout(Promise.all(participantComplete), 15000, 'participant completion');
    // Wait for the anchor lifecycle; a broadcast failure would leave it unresolved,
    // surfaced below as a missing anchored event rather than an unhandled rejection.
    await withTimeout(anchored, 15000, 'beacon anchored').catch(() => undefined);

    const problems: string[] = [];
    if (result.signature.length !== 64) {
      problems.push(`expected a 64-byte aggregated signature, got ${result.signature.length}`);
    }
    if (!result.signedTx) {
      problems.push('expected a signed beacon transaction, got none');
      return problems;
    }

    // The live builder is the only thing that touches the injected connection.
    if (bitcoin.calls.getUtxos === 0 || bitcoin.calls.getHex === 0) {
      problems.push(
        `live builder never used the injected connection (getUtxos=${bitcoin.calls.getUtxos}, ` +
          `getHex=${bitcoin.calls.getHex}) - the fixture path must have run`,
      );
    }
    // Broadcast happened exactly once (the fixture path never calls send).
    if (bitcoin.calls.send !== 1) {
      problems.push(`expected exactly one broadcast, send was called ${bitcoin.calls.send}x`);
    }
    // Path-unique: the broadcast payload is byte-for-byte the finalized signed
    // beacon tx (extract()), not some other/fixture tx.
    const rawHex = bytesToHex(result.signedTx.extract());
    if (bitcoin.sentHex[0] !== rawHex) {
      problems.push('the hex passed to send() is not the finalized signed beacon tx (extract mismatch)');
    }
    // On-tx discriminator: the broadcast tx spends the mock-funded UTXO, not the
    // fixture's all-zero prevout.
    const { internal, display } = inputTxidHexes(result.signedTx as unknown as SignedTxView);
    const zero = '00'.repeat(32);
    if (internal === zero || display === zero) {
      problems.push('broadcast tx input spends the all-zero fixture prevout, not a funded UTXO');
    } else if (!bitcoin.servedTxids.has(internal) && !bitcoin.servedTxids.has(display)) {
      problems.push(`broadcast tx input txid (${display}) does not match any UTXO the mock served`);
    }
    // The txid send() returned must flow through both lifecycle events.
    if (!broadcastEvent) {
      problems.push('no beacon-broadcast event emitted');
    } else if (broadcastEvent.txid !== broadcastTxid) {
      problems.push(`beacon-broadcast txid ${broadcastEvent.txid} != the txid send() returned`);
    }
    if (!anchoredEvent) {
      problems.push('no beacon-anchored event emitted (broadcast may have failed)');
    } else {
      if (anchoredEvent.txid !== broadcastTxid) {
        problems.push(`beacon-anchored txid ${anchoredEvent.txid} != the txid send() returned`);
      }
      if (anchoredEvent.confirmed !== true) {
        problems.push('beacon-anchored reported confirmed:false though the mock confirms immediately');
      }
    }

    if (problems.length === 0) {
      log(
        `[ok] ${beaconType}: live+broadcast pushed the finalized beacon tx (txid ${broadcastTxid}) ` +
          `and the dashboard anchor lifecycle (broadcast -> anchored, confirmed) fired`,
      );
    }
    return problems;
  } finally {
    for (const participant of participants) {
      participant.stop();
    }
    await service.stop();
  }
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  const cas = await runLiveMockCohort('CASBeacon', quiet);
  const smt = await runLiveMockCohort('SMTBeacon', quiet);
  const casBc = await runLiveBroadcastMockCohort('CASBeacon', quiet);
  const smtBc = await runLiveBroadcastMockCohort('SMTBeacon', quiet);
  const problems = [
    ...cas.map((p) => `CAS: ${p}`),
    ...smt.map((p) => `SMT: ${p}`),
    ...casBc.map((p) => `CAS-broadcast: ${p}`),
    ...smtBc.map((p) => `SMT-broadcast: ${p}`),
  ];

  if (problems.length > 0) {
    console.error('\nLIVE-MOCK E2E FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nLIVE-MOCK E2E PASSED: the live beacon-tx path built a real aggregation beacon tx over a ' +
      'mock-funded UTXO for both CAS and SMT cohorts (n-of-n MuSig2 -> 64-byte Taproot signature), ' +
      'and the broadcast wiring pushed the finalized tx + emitted the anchor lifecycle (no real network).',
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
