import type {
  AggregationServiceEvents,
  AggregationServiceRunner,
  SseStream,
} from '@did-btcr2/aggregation/service';
import { bytesToHex } from '@noble/hashes/utils';
import type { Transaction } from '@scure/btc-signer';

/**
 * Every event the AggregationServiceRunner emits. The dashboard forwards ALL of
 * them (not just the happy path) so it can show drops, the k-of-n fallback, nonce
 * progress, and non-fatal errors. Typed as keys so a renamed/removed event fails
 * to compile.
 */
const SERVICE_EVENTS: ReadonlyArray<keyof AggregationServiceEvents> = [
  'cohort-advertised',
  'opt-in-received',
  'participant-accepted',
  'keygen-complete',
  'update-received',
  'message-rejected',
  'data-distributed',
  'validation-received',
  'signing-started',
  'fallback-started',
  'nonce-received',
  'signing-complete',
  'cohort-failed',
  'error',
];

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** A JSON-safe summary of a signed beacon transaction (no raw bytes). */
function summarizeTx(tx: Transaction): Record<string, unknown> {
  return {
    txid: safe(() => tx.id),
    version: safe(() => tx.version),
    inputs: safe(() => tx.inputsLength),
    outputs: safe(() => tx.outputsLength),
    vsize: safe(() => tx.vsize),
    weight: safe(() => tx.weight),
    // tx.fee throws when fixture inputs carry no prevout amount, so guard it and
    // keep it last; a missing fee must never drop the signing-complete frame.
    fee: safe(() => Number(tx.fee)),
  };
}

/** Convert a runner event payload into a JSON-serializable shape (hex bytes, summarized tx). */
function serialize(event: keyof AggregationServiceEvents, payload: unknown): unknown {
  const p = payload as Record<string, unknown>;
  switch (event) {
    case 'opt-in-received':
      return {
        cohortId: p.cohortId,
        participantDid: p.participantDid,
        participantPk: p.participantPk ? bytesToHex(p.participantPk as Uint8Array) : undefined,
        communicationPk: p.communicationPk ? bytesToHex(p.communicationPk as Uint8Array) : undefined,
      };
    case 'signing-complete': {
      const signature = p.signature as Uint8Array | undefined;
      return {
        cohortId: p.cohortId,
        path: p.path ?? 'key-path',
        signature: signature && signature.length > 0 ? bytesToHex(signature) : '',
        signedTx: p.signedTx ? summarizeTx(p.signedTx as Transaction) : undefined,
      };
    }
    case 'error':
      return { message: payload instanceof Error ? payload.message : String(payload) };
    default:
      // The remaining events carry only strings/numbers/booleans (JSON-safe).
      return payload;
  }
}

/**
 * Bridge an {@link AggregationServiceRunner}'s typed event emitter onto an
 * {@link SseStream} for a browser dashboard. Registers one listener per event,
 * forwards a JSON frame per emit, sends a keepalive comment (the service runs
 * with heartbeatIntervalMs 0), and removes every listener on disconnect so a
 * reconnecting dashboard does not leak listeners on the long-lived runner.
 *
 * Returns the teardown function (also wired to the stream's onClose).
 */
export function bridgeRunnerToSse(runner: AggregationServiceRunner, stream: SseStream): () => void {
  let counter = 0;
  const registered: Array<{ event: keyof AggregationServiceEvents; fn: (payload: unknown) => void }> = [];

  for (const event of SERVICE_EVENTS) {
    const fn = (payload: unknown): void => {
      safe(() => {
        const frame = JSON.stringify({ event, payload: serialize(event, payload) });
        stream.writeEvent(event, frame, String(++counter));
      });
    };
    // The listener ignores the typed args tuple, so cast past the per-event signature.
    runner.on(event, fn as never);
    registered.push({ event, fn });
  }

  const ping = setInterval(() => safe(() => stream.writeComment('ping')), 15000);
  if (typeof (ping as { unref?: () => void }).unref === 'function') {
    (ping as { unref: () => void }).unref();
  }

  let torn = false;
  const teardown = (): void => {
    if (torn) {
      return;
    }
    torn = true;
    clearInterval(ping);
    for (const { event, fn } of registered) {
      runner.off(event, fn as never);
    }
  };

  stream.onClose(teardown);
  return teardown;
}
