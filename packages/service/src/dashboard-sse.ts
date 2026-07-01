import type {
  AggregationServiceEvents,
  AggregationServiceRunner,
  SseStream,
} from '@did-btcr2/aggregation/service';
import { bytesToHex } from '@noble/hashes/utils';
import type { Transaction } from '@scure/btc-signer';
import type { NetworkConfig } from '@btcr2-aggregation/shared';
import type { BeaconAnchorEvents, BeaconBroadcaster } from './broadcast.js';

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
 * Optional telemetry sources layered onto the runner-event feed by
 * {@link bridgeRunnerToSse}: the beacon broadcast lifecycle plus the network config
 * whose `explorerTxUrl` turns a txid into a clickable block-explorer link.
 */
export interface DashboardExtras {
  /**
   * The beacon-tx broadcast emitter (present only when the service runs live with
   * broadcasting). Its `beacon-broadcast` / `beacon-anchored` / broadcast-failed
   * events are forwarded so the dashboard can show "anchored on-chain".
   */
  broadcaster?: BeaconBroadcaster;
  /** Network config used to derive each anchored tx's explorer URL. */
  network?: NetworkConfig;
}

/**
 * Bridge an {@link AggregationServiceRunner}'s typed event emitter onto an
 * {@link SseStream} for a browser dashboard. Registers one listener per event,
 * forwards a JSON frame per emit, sends a keepalive comment (the service runs
 * with heartbeatIntervalMs 0), and removes every listener on disconnect so a
 * reconnecting dashboard does not leak listeners on the long-lived runner.
 *
 * When `extras.broadcaster` is supplied, the beacon-tx broadcast lifecycle is
 * forwarded as `beacon-broadcast` / `beacon-anchored` / `beacon-broadcast-failed`
 * frames; anchored frames carry an `explorerUrl` derived from
 * `extras.network.explorerTxUrl(txid)`, so the dashboard can link the on-chain tx.
 *
 * Returns the teardown function (also wired to the stream's onClose).
 */
export function bridgeRunnerToSse(
  runner: AggregationServiceRunner,
  stream: SseStream,
  extras: DashboardExtras = {},
): () => void {
  let counter = 0;
  const registered: Array<{ event: keyof AggregationServiceEvents; fn: (payload: unknown) => void }> = [];

  const emitFrame = (event: string, payload: unknown): void => {
    safe(() => {
      const frame = JSON.stringify({ event, payload });
      stream.writeEvent(event, frame, String(++counter));
    });
  };

  for (const event of SERVICE_EVENTS) {
    const fn = (payload: unknown): void => emitFrame(event, serialize(event, payload));
    // The listener ignores the typed args tuple, so cast past the per-event signature.
    runner.on(event, fn as never);
    registered.push({ event, fn });
  }

  // Broadcast lifecycle -> dashboard frames (only when the service broadcasts live).
  const { broadcaster, network } = extras;
  const explorerUrl = (txid: string): string => {
    try {
      return network?.explorerTxUrl(txid) ?? '';
    } catch {
      return '';
    }
  };
  const broadcastListeners: Array<{ event: keyof BeaconAnchorEvents; fn: (payload: never) => void }> = [];
  if (broadcaster) {
    const onBroadcast = (p: BeaconAnchorEvents['beacon-broadcast']): void =>
      emitFrame('beacon-broadcast', { cohortId: p.cohortId, txid: p.txid, explorerUrl: explorerUrl(p.txid) });
    const onAnchored = (p: BeaconAnchorEvents['beacon-anchored']): void =>
      emitFrame('beacon-anchored', {
        cohortId: p.cohortId,
        txid: p.txid,
        confirmed: p.confirmed,
        explorerUrl: explorerUrl(p.txid),
      });
    const onFailed = (p: BeaconAnchorEvents['beacon-broadcast-failed']): void =>
      emitFrame('beacon-broadcast-failed', { cohortId: p.cohortId, reason: p.reason });
    broadcaster.on('beacon-broadcast', onBroadcast);
    broadcaster.on('beacon-anchored', onAnchored);
    broadcaster.on('beacon-broadcast-failed', onFailed);
    broadcastListeners.push(
      { event: 'beacon-broadcast', fn: onBroadcast as (payload: never) => void },
      { event: 'beacon-anchored', fn: onAnchored as (payload: never) => void },
      { event: 'beacon-broadcast-failed', fn: onFailed as (payload: never) => void },
    );
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
    if (broadcaster) {
      for (const { event, fn } of broadcastListeners) {
        broadcaster.off(event, fn as never);
      }
    }
  };

  stream.onClose(teardown);
  return teardown;
}
