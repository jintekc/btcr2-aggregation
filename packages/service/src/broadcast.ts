import { EventEmitter } from 'node:events';
import { bytesToHex } from '@noble/hashes/utils';
import type { AggregationResult, AggregationServiceRunner } from '@did-btcr2/aggregation/service';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { Transaction } from '@scure/btc-signer';

/**
 * Payloads carried by a {@link BeaconBroadcaster}, tracking the on-chain lifecycle
 * of one cohort's aggregate beacon transaction. Every payload is JSON-serializable
 * so the dashboard SSE bridge can forward it verbatim (plus a derived explorer URL).
 */
export interface BeaconAnchorEvents {
  /** The signed beacon tx was accepted by the network; `txid` is the broadcast id. */
  'beacon-broadcast': { cohortId: string; txid: string };
  /**
   * Confirmation polling finished. `confirmed` true = the tx is mined; false = it
   * was broadcast (accepted to the mempool) but not yet mined when the confirmation
   * window elapsed. False is NOT a failure: the tx is still live, the dashboard
   * shows "pending".
   */
  'beacon-anchored': { cohortId: string; txid: string; confirmed: boolean };
  /**
   * Broadcast itself failed: the node rejected the tx (policy / already-spent), the
   * network was unreachable, or the signed tx did not finalize/extract. `reason` is
   * the surfaced message.
   */
  'beacon-broadcast-failed': { cohortId: string; reason: string };
}

/**
 * A tiny typed event emitter for a cohort beacon tx's on-chain lifecycle
 * (broadcast -> anchored / failed). The service's broadcast handler
 * ({@link attachBeaconBroadcast}) is the sole producer; each open dashboard SSE
 * connection subscribes and unsubscribes over its own lifetime, mirroring how
 * `bridgeRunnerToSse` handles the runner's protocol events. Wrapping
 * {@link EventEmitter} keeps the public surface strictly typed to
 * {@link BeaconAnchorEvents}.
 */
export class BeaconBroadcaster {
  readonly #emitter = new EventEmitter();

  constructor() {
    // One listener set is added per open dashboard SSE connection; lift the default
    // 10-listener warning cap so many concurrent dashboards do not log a false
    // "possible EventEmitter memory leak" warning. Listeners are removed on close.
    this.#emitter.setMaxListeners(0);
  }

  on<K extends keyof BeaconAnchorEvents>(event: K, fn: (payload: BeaconAnchorEvents[K]) => void): void {
    this.#emitter.on(event, fn as (payload: unknown) => void);
  }

  off<K extends keyof BeaconAnchorEvents>(event: K, fn: (payload: BeaconAnchorEvents[K]) => void): void {
    this.#emitter.off(event, fn as (payload: unknown) => void);
  }

  emit<K extends keyof BeaconAnchorEvents>(event: K, payload: BeaconAnchorEvents[K]): void {
    this.#emitter.emit(event, payload);
  }
}

/**
 * The broadcastable raw-hex serialization of a finalized signed beacon transaction.
 *
 * Uses `Transaction.extract()`, which asserts the tx is fully finalized and its fee
 * is non-negative before returning the network-serialized bytes. That assertion is
 * deliberate: the runner finalizes BOTH spend paths before it emits
 * `signing-complete` (the optimistic n-of-n key path sets `finalScriptWitness`, the
 * k-of-n fallback calls `tx.finalize()`), so an extract failure is a real tripwire
 * that a caller handed us something unfinalized - e.g. the zero-chain fixture tx by
 * mistake, whose dummy prevout also makes its fee non-computable.
 */
export function rawBeaconTxHex(signedTx: Transaction): string {
  return bytesToHex(signedTx.extract());
}

/** Options for {@link broadcastAndConfirm}. */
export interface BroadcastConfirmOptions {
  /** Interval between `isConfirmed` polls, in ms. Default 5000. */
  pollIntervalMs?: number;
  /**
   * Overall wait for a first confirmation, in ms. Default 180000 (~6 mutinynet
   * 30s blocks). On expiry the tx is still broadcast; the result reports
   * `confirmed: false`.
   */
  confirmTimeoutMs?: number;
  /** Aborts an in-flight confirmation poll (wired to `service.stop()`). */
  signal?: AbortSignal;
  /** Called once with the txid immediately after acceptance, before confirmation. */
  onBroadcast?: (txid: string) => void;
}

/** Outcome of a broadcast: the accepted txid plus whether it confirmed in-window. */
export interface BroadcastResult {
  txid: string;
  confirmed: boolean;
}

/** A cancelable, unref'd sleep that also resolves early if `signal` aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    // Never let the confirmation poll keep the process alive on its own.
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Broadcast a raw transaction hex and poll for its first confirmation.
 *
 * Sends via esplora `POST /tx` (which returns the txid), invokes `onBroadcast(txid)`
 * as soon as it is accepted, then polls `isConfirmed(txid)` until true or the
 * timeout elapses. A `send()` rejection propagates (the caller reports it); a
 * confirmation-poll error does NOT - a transient esplora hiccup is swallowed and the
 * poll retries, because the tx is already broadcast and re-broadcasting is
 * unnecessary. Returns `{ txid, confirmed: false }` when accepted but not mined in
 * window (a successful broadcast, pending confirmation).
 */
export async function broadcastAndConfirm(
  bitcoin: BitcoinConnection,
  rawHex: string,
  opts: BroadcastConfirmOptions = {},
): Promise<BroadcastResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  const confirmTimeoutMs = opts.confirmTimeoutMs ?? 180000;

  const txid = await bitcoin.rest.transaction.send(rawHex);
  opts.onBroadcast?.(txid);

  // Abort is best-effort: it stops the loop between polls and cancels the sleep. An
  // already-in-flight isConfirmed/send fetch (the injected REST client exposes no
  // per-request signal) runs to its own completion, but the sleep timer is unref'd
  // and the caller never awaits this handler, so a pending poll can never block
  // service.stop() or keep the process alive.
  const deadline = Date.now() + confirmTimeoutMs;
  while (Date.now() < deadline && !opts.signal?.aborted) {
    const confirmed = await bitcoin.rest.transaction.isConfirmed(txid).catch(() => false);
    if (confirmed) {
      return { txid, confirmed: true };
    }
    await delay(pollIntervalMs, opts.signal);
  }
  return { txid, confirmed: false };
}

/** Options for {@link attachBeaconBroadcast}. */
export interface AttachBeaconBroadcastOptions {
  /** Bitcoin REST (esplora) connection used to broadcast + poll confirmation. */
  bitcoin: BitcoinConnection;
  /** Emitter the broadcast lifecycle is published on (consumed by the dashboard). */
  broadcaster: BeaconBroadcaster;
  /** Interval between `isConfirmed` polls, in ms. Default 5000. */
  pollIntervalMs?: number;
  /** Overall confirmation wait, in ms. Default 180000. */
  confirmTimeoutMs?: number;
  /** Failure logger. Default `console.error`. Successes surface as broadcaster events. */
  log?: (msg: string) => void;
}

/** Handle returned by {@link attachBeaconBroadcast}. */
export interface BeaconBroadcastHandle {
  /** Detach the `signing-complete` listener and abort any in-flight confirmation poll. */
  stop(): void;
}

/**
 * Wire a runner's `signing-complete` to broadcast the cohort's signed beacon tx and
 * poll for confirmation, publishing the lifecycle on `opts.broadcaster`.
 *
 * Fire-and-forget per cohort: a broadcast or extract failure emits
 * `beacon-broadcast-failed` and is logged, never crashing the runner. Keying off
 * `result.signedTx` (NOT `result.signature`, which is empty for the k-of-n
 * script-path fallback) is deliberate - the fully signed tx exists for both spend
 * paths.
 */
export function attachBeaconBroadcast(
  runner: AggregationServiceRunner,
  opts: AttachBeaconBroadcastOptions,
): BeaconBroadcastHandle {
  const controller = new AbortController();
  const log = opts.log ?? ((msg: string) => console.error(msg));
  const { broadcaster } = opts;

  const handleSigningComplete = async (result: AggregationResult): Promise<void> => {
    const { cohortId } = result;

    let rawHex: string;
    try {
      rawHex = rawBeaconTxHex(result.signedTx);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      broadcaster.emit('beacon-broadcast-failed', { cohortId, reason });
      log(`[broadcast] cohort ${cohortId}: signed tx did not finalize/extract: ${reason}`);
      return;
    }

    try {
      const { txid, confirmed } = await broadcastAndConfirm(opts.bitcoin, rawHex, {
        pollIntervalMs: opts.pollIntervalMs,
        confirmTimeoutMs: opts.confirmTimeoutMs,
        signal: controller.signal,
        // Stay silent once teardown has begun, mirroring the anchored guard below,
        // so the whole broadcast lifecycle goes quiet after stop().
        onBroadcast: (id) => {
          if (!controller.signal.aborted) {
            broadcaster.emit('beacon-broadcast', { cohortId, txid: id });
          }
        },
      });
      // If the service is stopping, do not emit a terminal frame mid-teardown.
      if (controller.signal.aborted) {
        return;
      }
      broadcaster.emit('beacon-anchored', { cohortId, txid, confirmed });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      broadcaster.emit('beacon-broadcast-failed', { cohortId, reason });
      log(`[broadcast] cohort ${cohortId}: broadcast failed: ${reason}`);
    }
  };

  const listener = (result: AggregationResult): void => {
    void handleSigningComplete(result);
  };

  // The event tuple is `[AggregationResult]`; the runner passes it as a single arg.
  runner.on('signing-complete', listener as never);

  return {
    stop(): void {
      controller.abort();
      runner.off('signing-complete', listener as never);
    },
  };
}
