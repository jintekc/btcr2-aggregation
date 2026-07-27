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

/** Sleep whose timer does not keep Node alive (used by the directory-presence poller). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

/** Minimal `/v1/directory` row shape the SVC-JOIN-2 presence guard reads. */
interface DirectoryRow {
  cohortId: string;
  phase: string;
  joined: number;
  capacity: number;
}

/**
 * The post-seat funding-wait phases the widened directory DISPLAY must keep listed (SVC-JOIN-2):
 * the live funding wait runs inside `onProvideTxData`, which the library calls while the cohort
 * sits in one of these. The presence guard asserts the row stayed listed through at least one of
 * them (the phases that USED to drop the row and false-fail a seated participant).
 */
const FUNDING_WAIT_PHASES = new Set<string>([
  'UpdatesCollected',
  'DataDistributed',
  'Validated',
  'FallbackRequested',
]);

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
  /**
   * Number of INITIAL `getUtxos` reads that return `[]` (an unfunded address) before the mock
   * starts returning the confirmed funded UTXO. Default 0 (funded immediately). A positive value
   * drives the D-38 funding WAIT through its awaiting-funding -> funded transition hermetically:
   * the operator "funds" the beacon address after N poll reads, and the wait then auto-advances.
   */
  emptyReadsBeforeFunded?: number;
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
          // Stateful funding: the first N reads see an UNFUNDED address (awaiting-funding), then the
          // address is "funded" so the wait auto-advances (D-38/D-47).
          if (calls.getUtxos <= (opts.emptyReadsBeforeFunded ?? 0)) {
            return [];
          }
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

/**
 * Drive one live+broadcast cohort through the D-38 funding WAIT, proving the awaiting-funding ->
 * funded AUTO-ADVANCE hermetically (D-47). The mock's `getUtxos` returns `[]` for the first N reads
 * (the operator has not funded the beacon address yet) and then a confirmed above-minimum UTXO, so
 * the funding wait inside onProvideTxData polls through `waiting` and advances the moment funds
 * appear - then the cohort signs and broadcasts on the mock exactly as the immediate-funded path
 * does. `fundingWindowMs` ENABLES the wait (without it the live branch keeps its single-shot
 * pre-flight, which would reject the unfunded first read outright). Returns any problems (empty = pass).
 */
async function runStatefulFundingMockCohort(beaconType: BeaconType, quiet: boolean): Promise<string[]> {
  const n = 2;
  const log = quiet ? () => {} : (msg: string) => console.log(msg);
  const config = buildCohortConfig(n, beaconType);
  const network = resolveNetwork(config.network).scureNetwork;
  const broadcastTxid = 'cd'.repeat(32);
  const emptyReadsBeforeFunded = 3;

  const bitcoin = mockBitcoin(network, 100000, { broadcast: true, broadcastTxid, emptyReadsBeforeFunded });
  const service = createService({
    identity: createIdentity(),
    config,
    live: true,
    broadcast: true,
    bitcoin: bitcoin as never,
    // ENABLE the funding wait with a generous window + a tiny poll interval so the awaiting-funding
    // -> funded transition is exercised quickly and never races the (unset) cohort TTL.
    fundingWindowMs: 30_000,
    fundingPollIntervalMs: 20,
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
    const result = await withTimeout(service.runner.run(), 30000, `${beaconType} stateful-funding run`);
    await withTimeout(Promise.all(participantComplete), 15000, 'participant completion');
    await withTimeout(anchored, 15000, 'beacon anchored').catch(() => undefined);

    const problems: string[] = [];
    if (result.signature.length !== 64) {
      problems.push(`expected a 64-byte aggregated signature, got ${result.signature.length}`);
    }
    if (!result.signedTx) {
      problems.push('expected a signed beacon transaction, got none');
      return problems;
    }
    // The wait must have POLLED through the unfunded window: getUtxos was called strictly more times
    // than the empty-read count, proving the awaiting-funding -> funded auto-advance actually ran
    // (an immediate-funded path would have fewer reads and never traverse the awaiting state).
    if (bitcoin.calls.getUtxos <= emptyReadsBeforeFunded) {
      problems.push(
        `funding wait did not poll through the unfunded window (getUtxos=${bitcoin.calls.getUtxos}, ` +
          `expected > ${emptyReadsBeforeFunded}) - the awaiting-funding -> funded transition was not exercised`,
      );
    }
    // The cohort then signed + broadcast on the mock exactly once (the fixture path never sends).
    if (bitcoin.calls.send !== 1) {
      problems.push(`expected exactly one broadcast after funding, send was called ${bitcoin.calls.send}x`);
    }
    if (!broadcastEvent || broadcastEvent.txid !== broadcastTxid) {
      problems.push('no beacon-broadcast event with the expected txid after funding auto-advance');
    }
    if (!anchoredEvent || anchoredEvent.confirmed !== true) {
      problems.push('no confirmed beacon-anchored event after funding auto-advance');
    }

    if (problems.length === 0) {
      log(
        `[ok] ${beaconType}: funding wait advanced awaiting-funding -> funded after ` +
          `${emptyReadsBeforeFunded} unfunded reads, then the cohort signed + broadcast (txid ${broadcastTxid})`,
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
 * SVC-JOIN-2 regression guard: prove the public `/v1/directory` row STAYS PRESENT through the
 * whole live funding wait. Boots an operator-enabled live+broadcast service over the stateful
 * mock (unfunded for the first N reads), advertises ONE cohort via the operator HTTP routes, has
 * n real participants join + auto-submit, and polls `/v1/directory` continuously from the moment
 * the row first appears until signing-complete, asserting the row never vanishes mid-flight. It
 * also asserts the guard actually spanned a funding-wait phase (UpdatesCollected / DataDistributed
 * / Validated / FallbackRequested) - the phases that, before this fix, dropped the row for the
 * entire funding window and made a seated participant's post-seat poll false-fail the cohort as
 * "ended" after ~10s. Returns any problems (empty = pass).
 */
async function runFundingDirectoryPresenceCohort(beaconType: BeaconType, quiet: boolean): Promise<string[]> {
  const n = 2;
  const OPERATOR_PASSWORD = 'live-mock-operator-correct-horse-battery-staple';
  const log = quiet ? () => {} : (msg: string) => console.log(msg);
  const config = buildCohortConfig(n, beaconType);
  const network = resolveNetwork(config.network).scureNetwork;
  const broadcastTxid = 'ef'.repeat(32);
  // Hold the unfunded window open long enough (~5s at 100ms cadence) that the directory poller
  // lands many ticks inside the funding-wait phase.
  const emptyReadsBeforeFunded = 50;

  const bitcoin = mockBitcoin(network, 100000, { broadcast: true, broadcastTxid, emptyReadsBeforeFunded });
  const service = createService({
    identity: createIdentity(),
    config,
    live: true,
    broadcast: true,
    bitcoin: bitcoin as never,
    // Operator-enabled so the cohort is advertised through the real operator flow and the public
    // directory reflects it (the directory reads the operator surface).
    operatorPassword: OPERATOR_PASSWORD,
    operatorCookieSecure: false,
    // ENABLE the funding wait with a generous window + tiny poll interval.
    fundingWindowMs: 60_000,
    fundingPollIntervalMs: 100,
    confirmPollIntervalMs: 10,
    confirmTimeoutMs: 3000,
  });

  let signedCohortId = '';
  let signingDone = false;
  const signingComplete = new Promise<void>((resolve) => {
    service.runner.on('signing-complete', (result) => {
      signedCohortId = result.cohortId;
      // Flip BEFORE resolving so no poll tick after signing counts the legitimate Complete-prune
      // as a mid-flight absence (the row rightfully drops once the cohort completes).
      signingDone = true;
      resolve();
    });
  });

  const { baseUrl } = await service.start(0);
  const participants: ReturnType<typeof createParticipant>[] = [];
  try {
    // Operator login (Node fetch has no cookie jar, so capture + echo the session cookie).
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (!setCookie) {
      return ['operator login issued no operator_session cookie'];
    }
    const cookie = setCookie.split(';')[0];

    // Advertise ONE cohort (single-advert-slot discipline).
    const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ beaconType, size: n, threshold: n }),
    });
    if (createRes.status !== 201) {
      return [`create draft should be 201, got ${createRes.status}`];
    }
    const draft = (await createRes.json()) as { draftId: string };
    const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (advertiseRes.status !== 200) {
      return [`advertise should be 200, got ${advertiseRes.status}`];
    }
    const cohortId = ((await advertiseRes.json()) as { draftId: string }).draftId;

    // Background directory-presence guard: from the first sighting of the row until
    // signing-complete, the /v1/directory row must be present on EVERY tick.
    let polling = true;
    let sawRow = false;
    const absences: string[] = [];
    const seenPhases = new Set<string>();
    const presencePoll = (async () => {
      while (polling) {
        try {
          const rows = (await fetch(`${baseUrl}/v1/directory`).then((r) => r.json())) as DirectoryRow[];
          const found = rows.find((r) => r.cohortId === cohortId);
          if (found) {
            sawRow = true;
            seenPhases.add(found.phase);
          } else if (sawRow && !signingDone) {
            // The row was present, then vanished, and the cohort has NOT completed: the
            // SVC-JOIN-2 regression. A post-completion drop (signingDone) is legitimate.
            absences.push('directory row vanished while the cohort was in flight');
          }
        } catch {
          // A transient fetch error is not an absence; the next tick retries.
        }
        await sleep(150);
      }
    })();

    // n real participants join the advertised cohort and auto-submit (no onSubmitGate).
    for (const identity of Array.from({ length: n }, () => createIdentity())) {
      participants.push(createParticipant({ identity, baseUrl, cohortId, beaconType }));
    }
    await Promise.all(participants.map((participant) => participant.start()));

    // Wait for signing to complete THROUGH the funding wait, then stop the guard.
    await withTimeout(signingComplete, 45000, `${beaconType} funding-presence signing`);
    polling = false;
    await presencePoll;

    const problems: string[] = [];
    if (signedCohortId !== cohortId) {
      problems.push(`signing-complete cohort ${signedCohortId} != advertised ${cohortId}`);
    }
    if (!sawRow) {
      problems.push('the directory row never appeared at all (advertise or discovery failed)');
    }
    if (absences.length > 0) {
      problems.push(
        `directory row vanished mid-flight ${absences.length}x during the funding wait (SVC-JOIN-2 regression)`,
      );
    }
    // Prove the guard genuinely spanned the funding wait: at least one funding-wait phase must
    // have been observed with the row PRESENT (else the guard did not exercise the widened set).
    const spannedFundingWait = [...seenPhases].some((phase) => FUNDING_WAIT_PHASES.has(phase));
    if (!spannedFundingWait) {
      problems.push(
        `guard never saw the row present in a funding-wait phase (observed: ${[...seenPhases].join(', ')})`,
      );
    }
    if (problems.length === 0) {
      log(
        `[ok] ${beaconType}: /v1/directory row stayed present through the funding wait ` +
          `(phases seen: ${[...seenPhases].join(', ')})`,
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
  const casFund = await runStatefulFundingMockCohort('CASBeacon', quiet);
  const smtFund = await runStatefulFundingMockCohort('SMTBeacon', quiet);
  const casDir = await runFundingDirectoryPresenceCohort('CASBeacon', quiet);
  const smtDir = await runFundingDirectoryPresenceCohort('SMTBeacon', quiet);
  const problems = [
    ...cas.map((p) => `CAS: ${p}`),
    ...smt.map((p) => `SMT: ${p}`),
    ...casBc.map((p) => `CAS-broadcast: ${p}`),
    ...smtBc.map((p) => `SMT-broadcast: ${p}`),
    ...casFund.map((p) => `CAS-funding: ${p}`),
    ...smtFund.map((p) => `SMT-funding: ${p}`),
    ...casDir.map((p) => `CAS-directory-presence: ${p}`),
    ...smtDir.map((p) => `SMT-directory-presence: ${p}`),
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
      'the broadcast wiring pushed the finalized tx + emitted the anchor lifecycle, the D-38 ' +
      'funding wait advanced awaiting-funding -> funded before signing + broadcasting, and the ' +
      '/v1/directory row stayed present through the whole funding wait (SVC-JOIN-2 guard) - all ' +
      'with no real network.',
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
