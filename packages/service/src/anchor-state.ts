/**
 * Retained anchor-state: the transient beacon-broadcast lifecycle folded into a
 * pollable last-known fact for the PUBLIC `GET /v1/anchor/:cohortId` read (PART-04,
 * D-20/D-21/D-22).
 *
 * The {@link BeaconBroadcaster} emits one cohort's broadcast/anchored/failed frames
 * exactly once as they happen (broadcast.ts:12-28); the dashboard SSE bridge already
 * forwards them, but only to the operator-gated `/dashboard/events` feed. A participant
 * who joined a cohort by choice needs the SAME chain facts (broadcast / confirmed /
 * failed + txid) to track their anchor - and those facts are public chain data, no
 * different from the unauthenticated `/resolve` + `/cas` reads. So this module folds the
 * fire-once frames into a bounded per-service Map keyed by cohortId and exposes a single
 * `read(cohortId)` that the browser can poll (D-21: a poll of last-known state, NOT a
 * second SSE, and NEVER chain I/O on the anonymous route).
 *
 * Three properties are load-bearing:
 * - It is a per-service closure factory (never a module singleton), mirroring
 *   `createOperatorCohorts`'s closure-scoped Maps (operator-cohorts.ts:270-287), so two
 *   services in one process (tests) never share anchor state.
 * - The retained Map is bounded at {@link MAX_TERMINAL} with oldest-first
 *   (insertion-order) eviction, reusing the `rememberTerminal` idiom
 *   (operator-cohorts.ts:296-305), so an anonymous read can never grow the map without
 *   bound (T-03-02-03, DoS) and every read stays O(1).
 * - The DTO carries an `enabled` mode-honesty bit (true only when a broadcaster is
 *   present), mirroring the `GET /v1/ipfs {enabled:false}` probe precedent, so the
 *   client renders Anchored/txid only on a broadcasting service and signed/complete
 *   otherwise (D-07).
 */

import type { NetworkConfig } from '@btcr2-aggregation/shared';
import type { BeaconBroadcaster } from './broadcast.js';

/**
 * The PUBLIC wire shape of one cohort's anchor read. Only public chain facts are
 * exposed (T-03-02-01): no member DIDs, no keys, nothing beyond `state`, the broadcast
 * `txid`, a derived `explorerUrl`, and the `enabled` mode bit. A broadcast-failure
 * `reason` is intentionally GENERIC (never the raw esplora/policy error), mirroring the
 * 502-generic-body convention so an untrusted caller learns nothing about internals.
 * `state: 'none'` answers an unknown cohortId (never a 404), so a never-existed cohort
 * and an evicted one are indistinguishable (T-03-02-02, no existence oracle).
 */
export interface AnchorReadDTO {
  /** True only when a broadcaster is wired (this service broadcasts on-chain). */
  enabled: boolean;
  /**
   * `'none'` = unknown/never-broadcast/evicted; `'broadcast'` = accepted to the network
   * (or mined-window elapsed, still pending); `'confirmed'` = mined; `'failed'` = the
   * broadcast itself failed.
   */
  state: 'none' | 'broadcast' | 'confirmed' | 'failed';
  /** The broadcast txid, present once a cohort has a broadcast/confirmed frame. */
  txid?: string;
  /** Block-explorer URL for {@link txid}, present only when the network derives it. */
  explorerUrl?: string;
  /** A generic failure reason, present only on `state: 'failed'`. */
  reason?: string;
}

/** The public read surface backed by the retained fold. */
export interface AnchorState {
  /** Last-known anchor fact for a cohort; `{ state: 'none' }` for an unknown id. */
  read(cohortId: string): AnchorReadDTO;
}

/**
 * Upper bound on retained anchor records (mirrors the operator-cohorts MAX_TERMINAL and
 * the dashboard MAX_COHORTS bounds). Past this cap the OLDEST cohort record is evicted
 * so an anonymous read path can never grow the map without limit (T-03-02-03, DoS).
 */
const MAX_TERMINAL = 24;

/** The generic broadcast-failure reason surfaced publicly (never the raw error). */
const GENERIC_FAILURE_REASON = 'broadcast failed';

/** The internal retained entry: the folded terminal-ish state plus its txid/reason. */
interface AnchorEntry {
  state: 'broadcast' | 'confirmed' | 'failed';
  txid?: string;
  reason?: string;
}

/**
 * Build the per-service anchor read. When `broadcaster` is present, subscribe ONCE to
 * its three lifecycle events and fold them into a bounded Map; when it is absent, never
 * subscribe (enabled stays false and every read is the fail-open `{ state: 'none' }`).
 *
 * The fold mirrors the frames at broadcast.ts:12-28 (D-22 granularity):
 * `beacon-broadcast` -> `'broadcast'` + txid; `beacon-anchored{confirmed:true}` ->
 * `'confirmed'`; `beacon-anchored{confirmed:false}` stays `'broadcast'` (pending is NOT
 * a failure); `beacon-broadcast-failed` -> `'failed'` with a GENERIC reason (the raw
 * error is dropped so it never leaks on the public read).
 */
export function createAnchorState(broadcaster?: BeaconBroadcaster, network?: NetworkConfig): AnchorState {
  const enabled = Boolean(broadcaster);
  const entries = new Map<string, AnchorEntry>();

  /** Store/refresh a cohort's entry, evicting the oldest record past the cap. */
  function remember(cohortId: string, entry: AnchorEntry): void {
    // Re-set moves the key to the end of the insertion order, so a cohort that keeps
    // progressing (broadcast -> confirmed) stays "fresh" and is not evicted mid-life.
    entries.delete(cohortId);
    entries.set(cohortId, entry);
    while (entries.size > MAX_TERMINAL) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      entries.delete(oldest);
    }
  }

  if (broadcaster) {
    broadcaster.on('beacon-broadcast', ({ cohortId, txid }) => {
      remember(cohortId, { state: 'broadcast', txid });
    });
    broadcaster.on('beacon-anchored', ({ cohortId, txid, confirmed }) => {
      // confirmed:false is still live (accepted, not yet mined); keep it as 'broadcast'
      // so a pending tx never reads as a failure or a false "confirmed".
      remember(cohortId, { state: confirmed ? 'confirmed' : 'broadcast', txid });
    });
    broadcaster.on('beacon-broadcast-failed', ({ cohortId }) => {
      // Deliberately drop the raw reason: the public DTO carries only the generic
      // failure string, so esplora/policy internals never reach an untrusted caller.
      remember(cohortId, { state: 'failed', reason: GENERIC_FAILURE_REASON });
    });
  }

  return {
    read(cohortId: string): AnchorReadDTO {
      const entry = entries.get(cohortId);
      if (!entry) {
        // Non-oracle default: unknown/never-existed/evicted all read identically.
        return { enabled, state: 'none' };
      }
      // Derive the explorer URL under a local try/catch exactly as dashboard-sse.ts does
      // (139-145): a bad/absent network must never throw on the anonymous read. An empty
      // string (the offline network's explorerTxUrl) collapses to `undefined` so the DTO
      // stays clean.
      let explorerUrl: string | undefined;
      if (entry.txid) {
        try {
          explorerUrl = network?.explorerTxUrl(entry.txid) || undefined;
        } catch {
          explorerUrl = undefined;
        }
      }
      return {
        enabled,
        state: entry.state,
        txid: entry.txid,
        explorerUrl,
        reason: entry.reason,
      };
    },
  };
}
