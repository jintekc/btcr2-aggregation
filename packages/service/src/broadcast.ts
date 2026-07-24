import { EventEmitter } from 'node:events';
import { bytesToHex } from '@noble/hashes/utils';
import type { AggregationResult, AggregationServiceRunner } from '@did-btcr2/aggregation/service';
import type { BitcoinConnection } from '@did-btcr2/bitcoin';
import type { Transaction } from '@scure/btc-signer';

/**
 * Payloads carried by a {@link BeaconBroadcaster}, tracking the on-chain lifecycle
 * of one cohort's aggregate beacon transaction. Every payload is JSON-serializable so
 * a fold (anchor-state / monitor) can retain it and a poll can serve it verbatim (plus
 * a derived explorer URL).
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
 * ({@link attachBeaconBroadcast}) is the sole producer; the retained anchor read
 * ({@link file://./anchor-state.ts} `createAnchorState`) and the cohort monitor
 * ({@link file://./monitor.ts} `createCohortMonitor`) subscribe to fold the lifecycle
 * into pollable last-known state. Wrapping {@link EventEmitter} keeps the public surface
 * strictly typed to {@link BeaconAnchorEvents}.
 */
export class BeaconBroadcaster {
  readonly #emitter = new EventEmitter();

  constructor() {
    // Multiple folds/consumers (anchor-state, monitor) subscribe over the service's
    // lifetime; lift the default 10-listener warning cap so many concurrent subscribers
    // never log a false "possible EventEmitter memory leak" warning.
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

/**
 * Default number of send attempts for the bounded broadcast retry (D-41): the initial send
 * plus up to four retries. Sized so a brief esplora hiccup (a dropped connection, a momentary
 * 5xx) is ridden out without an operator touching anything, while a genuinely unreachable
 * network or a policy rejection still terminates in a bounded, honest time rather than looping.
 */
const DEFAULT_SEND_RETRY_ATTEMPTS = 5;

/**
 * Default base backoff between send attempts, in ms (D-41). The delay grows linearly with the
 * attempt index (base, 2x base, 3x base, ...) via the shared {@link delay} helper, so the total
 * retry budget at the defaults is bounded (~2+4+6+8 = 20s) and the sleep is cancelable + unref'd
 * (a teardown aborts it promptly and it never keeps the process alive).
 */
const DEFAULT_SEND_RETRY_BACKOFF_MS = 2000;

/**
 * Esplora rejection messages that mean the tx is ALREADY on the network (in the mempool or a
 * block), i.e. a DUPLICATE acceptance, not a failure (Pitfall 9 / D-41). Bitcoin Core / esplora
 * phrase this several ways across versions; match them case-insensitively. A duplicate is
 * treated as a successful broadcast (the tx is live), never a terminal failure - the caller
 * emits `beacon-broadcast` exactly once with the computed txid.
 */
function isDuplicateAcceptance(message: string): boolean {
  return /already[ -]?(in[ -])?(the[ -])?(mempool|block ?chain|chain)|txn-already-(known|in-mempool)|already known|transaction already (exists|in)|code":\s*-27|"-27"/i.test(
    message,
  );
}

/**
 * Rejection messages that indicate a TRANSPORT failure (the node was unreachable at send time)
 * rather than a policy rejection the node would keep refusing. Drives the honest exhaustion copy
 * (D-41): "network unreachable at send time" vs "the node rejected the transaction". Matched on
 * the common Node/undici socket + DNS error shapes.
 */
function isNetworkUnreachable(message: string): boolean {
  return /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang ?up|fetch failed|network (error|unreachable|request failed)|timed? ?out|request to .* failed/i.test(
    message,
  );
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
  /**
   * Bounded number of send attempts before declaring terminal failure (D-41). Default
   * {@link DEFAULT_SEND_RETRY_ATTEMPTS} = 5 (the first send + four retries). The FIRST send
   * always runs; only the retries are skipped once {@link signal} aborts. Set 1 to disable
   * retrying (one-shot, the pre-D-41 behavior).
   */
  sendRetryAttempts?: number;
  /** Base backoff between send attempts, in ms (grows linearly). Default {@link DEFAULT_SEND_RETRY_BACKOFF_MS}. */
  sendRetryBackoffMs?: number;
  /**
   * The txid to report when a send is rejected as a DUPLICATE acceptance (the tx is already on
   * the network, so `send()` returns no id). Computed by the caller from the finalized signed tx
   * (`signedTx.id`); when absent, a duplicate-acceptance rejection cannot be resolved to a txid
   * and is treated as an ordinary (retryable) failure.
   */
  expectedTxid?: string;
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
 * Send a raw beacon tx with a BOUNDED backoff retry (D-41), retaining `rawHex` across attempts.
 *
 * The FIRST send always runs; a transient failure (a dropped connection, a momentary 5xx) is
 * ridden out by retrying with a linear backoff up to {@link BroadcastConfirmOptions.sendRetryAttempts}
 * total attempts. Two outcomes short-circuit to SUCCESS or exhaustion instead of an endless loop:
 * - A DUPLICATE-acceptance rejection ({@link isDuplicateAcceptance}) means the tx is already on the
 *   network - a success. It resolves to `opts.expectedTxid` (the caller-computed txid, since the
 *   rejection carries none); with no expectedTxid it degrades to an ordinary retryable failure.
 * - Once every attempt is spent (or {@link BroadcastConfirmOptions.signal} aborts a retry), the
 *   accumulated error is thrown with an honest reason that distinguishes "network unreachable at
 *   send time" from a node policy rejection (D-41), so the operator's failure copy never lies.
 *
 * Retries abort promptly: the signal is checked after each failed send and after each backoff
 * sleep, so a `service.stop()` mid-retry stops re-sending at once (the first send is already
 * committed by then and cannot be un-sent).
 */
async function sendWithRetry(
  bitcoin: BitcoinConnection,
  rawHex: string,
  opts: BroadcastConfirmOptions,
): Promise<string> {
  const attempts = Math.max(1, opts.sendRetryAttempts ?? DEFAULT_SEND_RETRY_ATTEMPTS);
  const backoffMs = opts.sendRetryBackoffMs ?? DEFAULT_SEND_RETRY_BACKOFF_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // The first send always runs; retries re-use the retained rawHex verbatim so a recovered
      // send broadcasts the SAME tx (never a rebuilt one), keeping the txid stable.
      return await bitcoin.rest.transaction.send(rawHex);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Pitfall 9: a duplicate-acceptance rejection means the tx is ALREADY live - a success,
      // not a failure. The rejection carries no id, so use the caller-computed expectedTxid.
      if (isDuplicateAcceptance(message) && opts.expectedTxid) {
        return opts.expectedTxid;
      }
      lastError = err;
      // Stop on the last attempt or once teardown has begun (do not re-send during stop()).
      if (attempt >= attempts - 1 || opts.signal?.aborted) {
        break;
      }
      // Linear backoff (base, 2x, 3x, ...); the sleep is cancelable + unref'd, so an abort
      // during the wait resolves it at once and the next loop check breaks out.
      await delay(backoffMs * (attempt + 1), opts.signal);
      if (opts.signal?.aborted) {
        break;
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  const kind = isNetworkUnreachable(message)
    ? 'network unreachable at send time'
    : 'the node rejected the transaction';
  throw new Error(`beacon broadcast failed after ${attempts} attempt(s) (${kind}): ${message}`);
}

/**
 * Broadcast a raw transaction hex and poll for its first confirmation.
 *
 * Sends via esplora `POST /tx` (which returns the txid) with a bounded backoff retry
 * ({@link sendWithRetry}, D-41): a transient send failure is retried, a duplicate-acceptance
 * rejection is treated as success, and only a genuinely exhausted send throws. Then invokes
 * `onBroadcast(txid)` as soon as it is accepted and polls `isConfirmed(txid)` until true or the
 * timeout elapses. A confirmation-poll error does NOT propagate - a transient esplora hiccup is
 * swallowed and the poll retries, because the tx is already broadcast. Returns
 * `{ txid, confirmed: false }` when accepted but not mined in window (a successful broadcast,
 * pending confirmation).
 */
export async function broadcastAndConfirm(
  bitcoin: BitcoinConnection,
  rawHex: string,
  opts: BroadcastConfirmOptions = {},
): Promise<BroadcastResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  const confirmTimeoutMs = opts.confirmTimeoutMs ?? 180000;

  const txid = await sendWithRetry(bitcoin, rawHex, opts);
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
  /** Bounded send attempts before terminal failure (D-41). Default {@link DEFAULT_SEND_RETRY_ATTEMPTS}. */
  sendRetryAttempts?: number;
  /** Base backoff between send attempts, in ms (D-41). Default {@link DEFAULT_SEND_RETRY_BACKOFF_MS}. */
  sendRetryBackoffMs?: number;
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

    // The finalized tx's own id, used ONLY to resolve a duplicate-acceptance rejection to a
    // txid (the rejection carries none, D-41/Pitfall 9). Guarded: a stand-in tx may not expose
    // `.id`, in which case a duplicate simply degrades to a retryable failure.
    let expectedTxid: string | undefined;
    try {
      expectedTxid = result.signedTx.id;
    } catch {
      expectedTxid = undefined;
    }

    try {
      const { txid, confirmed } = await broadcastAndConfirm(opts.bitcoin, rawHex, {
        pollIntervalMs: opts.pollIntervalMs,
        confirmTimeoutMs: opts.confirmTimeoutMs,
        sendRetryAttempts: opts.sendRetryAttempts,
        sendRetryBackoffMs: opts.sendRetryBackoffMs,
        expectedTxid,
        signal: controller.signal,
        // Stay silent once teardown has begun, mirroring the anchored guard below,
        // so the whole broadcast lifecycle goes quiet after stop(). onBroadcast fires
        // EXACTLY once per cohort (the retry recovers into a single accepted send, and a
        // duplicate-acceptance resolves to the same one broadcast frame).
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
      // A send aborted by teardown is not a real failure: stay silent mid-stop, mirroring the
      // anchored guard above, so a stop() during the send retry never emits a spurious frame.
      if (controller.signal.aborted) {
        return;
      }
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
