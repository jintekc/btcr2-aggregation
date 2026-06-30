import { create } from 'zustand';
import { elapsed } from '../lib/clock';
import type { CohortState, CohortStatus, LogEntry, LogLevel } from '../lib/types';

/**
 * Every event name the service dashboard SSE emits (mirrors SERVICE_EVENTS in
 * packages/service/src/dashboard-sse.ts). Each arrives as a named SSE event
 * whose `data` is a JSON frame `{ event, payload }`.
 */
const SERVICE_EVENTS = [
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
] as const;

type ServiceEvent = (typeof SERVICE_EVENTS)[number];

interface Metrics {
  advertised: number;
  accepted: number;
  updates: number;
  completed: number;
  failed: number;
}

interface DashboardState {
  connected: boolean;
  cohorts: Record<string, CohortState>;
  /** Cohort ids in first-seen order (newest last). */
  order: string[];
  log: LogEntry[];
  metrics: Metrics;
  connect(path?: string): void;
  disconnect(): void;
}

// The EventSource is connection state, not view state: keep it out of the store.
let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
// Whether the feed has opened at least once this mount, to tell a first connect
// from a reconnect (which triggers a resync).
let everOpened = false;
let logSeq = 0;

/** Keep at most this many cohorts so an all-day booth dashboard stays bounded. */
const MAX_COHORTS = 24;

const LEVEL: Partial<Record<ServiceEvent, LogLevel>> = {
  'signing-complete': 'good',
  'participant-accepted': 'good',
  'keygen-complete': 'good',
  'cohort-failed': 'bad',
  'message-rejected': 'warn',
  'fallback-started': 'warn',
  error: 'bad',
};

export const useDashboard = create<DashboardState>((set, get) => {
  function append(level: LogLevel, text: string): void {
    const entry: LogEntry = { id: ++logSeq, t: elapsed(), level, text };
    set((s) => ({ log: [...s.log.slice(-249), entry] }));
  }

  /** Upsert a cohort by id, applying `patch` (a partial or a reducer over the prior state). */
  function patchCohort(
    cohortId: string,
    patch: Partial<CohortState> | ((prev: CohortState) => Partial<CohortState>),
  ): void {
    set((s) => {
      const prev: CohortState =
        s.cohorts[cohortId] ??
        {
          cohortId,
          status: 'advertised',
          participants: [],
          accepted: [],
          updates: 0,
          nonces: 0,
          firstSeen: elapsed(),
        };
      const delta = typeof patch === 'function' ? patch(prev) : patch;
      const next = { ...prev, ...delta };
      const cohorts = { ...s.cohorts, [cohortId]: next };
      let order = s.order.includes(cohortId) ? s.order : [...s.order, cohortId];
      // Evict the oldest cohorts so a multi-hour booth does not grow unbounded.
      if (order.length > MAX_COHORTS) {
        const dropped = order.slice(0, order.length - MAX_COHORTS);
        order = order.slice(order.length - MAX_COHORTS);
        for (const id of dropped) {
          delete cohorts[id];
        }
      }
      return { cohorts, order };
    });
  }

  function setStatus(cohortId: string, status: CohortStatus): void {
    patchCohort(cohortId, { status });
  }

  function handle(event: ServiceEvent, payload: Record<string, unknown>): void {
    const cohortId = payload.cohortId as string | undefined;
    append(LEVEL[event] ?? 'info', formatEvent(event, payload));

    switch (event) {
      case 'cohort-advertised':
        if (cohortId) {
          patchCohort(cohortId, { status: 'advertised' });
          set((s) => ({ metrics: { ...s.metrics, advertised: s.metrics.advertised + 1 } }));
        }
        return;
      case 'opt-in-received':
        if (cohortId) {
          const did = payload.participantDid as string;
          const pk = payload.participantPk as string | undefined;
          patchCohort(cohortId, (prev) =>
            prev.participants.some((p) => p.did === did)
              ? {}
              : { participants: [...prev.participants, { did, pk }] },
          );
        }
        return;
      case 'participant-accepted':
        if (cohortId) {
          const did = payload.participantDid as string;
          patchCohort(cohortId, (prev) =>
            prev.accepted.includes(did) ? {} : { accepted: [...prev.accepted, did] },
          );
          set((s) => ({ metrics: { ...s.metrics, accepted: s.metrics.accepted + 1 } }));
        }
        return;
      case 'keygen-complete':
        if (cohortId) {
          patchCohort(cohortId, { status: 'keygen', beaconAddress: payload.beaconAddress as string });
        }
        return;
      case 'update-received':
        if (cohortId) {
          patchCohort(cohortId, (prev) => ({ updates: prev.updates + 1 }));
          set((s) => ({ metrics: { ...s.metrics, updates: s.metrics.updates + 1 } }));
        }
        return;
      case 'signing-started':
        if (cohortId) setStatus(cohortId, 'signing');
        return;
      case 'fallback-started':
        if (cohortId) setStatus(cohortId, 'fallback');
        return;
      case 'nonce-received':
        if (cohortId) patchCohort(cohortId, (prev) => ({ nonces: prev.nonces + 1 }));
        return;
      case 'signing-complete':
        if (cohortId) {
          const signedTx = payload.signedTx as { txid?: string } | undefined;
          patchCohort(cohortId, {
            status: 'complete',
            signature: payload.signature as string,
            path: (payload.path as string) ?? 'key-path',
            txid: signedTx?.txid,
          });
          set((s) => ({ metrics: { ...s.metrics, completed: s.metrics.completed + 1 } }));
        }
        return;
      case 'cohort-failed':
        if (cohortId) {
          patchCohort(cohortId, { status: 'failed', reason: payload.reason as string });
          set((s) => ({ metrics: { ...s.metrics, failed: s.metrics.failed + 1 } }));
        }
        return;
      default:
        // data-distributed, validation-received, message-rejected, error: logged only.
        return;
    }
  }

  return {
    connected: false,
    cohorts: {},
    order: [],
    log: [],
    metrics: { advertised: 0, accepted: 0, updates: 0, completed: 0, failed: 0 },

    connect(path = '/dashboard/events') {
      if (source) {
        return;
      }
      openSource(path);
    },

    disconnect() {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (source) {
        source.close();
        source = null;
      }
      everOpened = false;
      set({ connected: false });
    },
  };

  /**
   * Open (or re-open) the dashboard EventSource. EventSource auto-reconnects on a
   * transient network drop (readyState stays CONNECTING), but on a hard HTTP error
   * (the coordinator returns a 404/502, e.g. during a restart) it goes CLOSED and
   * never retries. We detect CLOSED and reconnect manually. On any reconnect we
   * also clear cohort state and resync from the live feed, since events emitted
   * while we were disconnected are not replayed (a missed `signing-complete` would
   * otherwise leave a cohort stuck at 'signing' forever).
   */
  function openSource(path: string): void {
    const es = new EventSource(path);
    source = es;

    es.onopen = () => {
      if (everOpened) {
        // Reconnect: drop possibly-stale cohort state and rebuild from the feed.
        set({ cohorts: {}, order: [] });
        append('good', 'reconnected to coordinator feed (resynced)');
      } else {
        append('good', 'connected to coordinator feed');
      }
      everOpened = true;
      set({ connected: true });
    };

    es.onerror = () => {
      const wasConnected = get().connected;
      set({ connected: false });
      if (es.readyState === EventSource.CLOSED) {
        // Hard failure: the browser will not auto-retry. Reconnect ourselves.
        if (wasConnected) {
          append('warn', 'coordinator feed closed; reconnecting');
        }
        es.close();
        source = null;
        if (reconnectTimer === null) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (source === null) {
              openSource(path);
            }
          }, 2000);
        }
      } else if (wasConnected) {
        // Transient drop; native auto-reconnect will re-open.
        append('warn', 'coordinator feed dropped; reconnecting');
      }
    };

    for (const event of SERVICE_EVENTS) {
      es.addEventListener(event, (ev) => {
        try {
          const frame = JSON.parse((ev as MessageEvent).data) as {
            event: ServiceEvent;
            payload: unknown;
          };
          handle(event, (frame.payload ?? {}) as Record<string, unknown>);
        } catch {
          // Ignore a malformed frame rather than tearing down the feed.
        }
      });
    }
  }
});

/** Human-readable one-liner for the service event log. */
function formatEvent(event: ServiceEvent, p: Record<string, unknown>): string {
  const did = typeof p.participantDid === 'string' ? shortDid(p.participantDid) : '';
  switch (event) {
    case 'cohort-advertised':
      return `advertised cohort ${p.cohortId}`;
    case 'opt-in-received':
      return `opt-in from ${shortDid(p.participantDid as string)}`;
    case 'participant-accepted':
      return `accepted ${did} into ${p.cohortId}`;
    case 'keygen-complete':
      return `keygen complete; beacon ${p.beaconAddress}`;
    case 'update-received':
      return `update received from ${did}`;
    case 'message-rejected':
      return `message rejected: ${p.reason ?? p.code ?? 'unknown'}`;
    case 'data-distributed':
      return `aggregated data distributed for ${p.cohortId}`;
    case 'validation-received':
      return `validation ${p.approved ? 'approved' : 'rejected'} by ${did}`;
    case 'signing-started':
      return `signing started (session ${shortId(p.sessionId as string)})`;
    case 'fallback-started':
      return `k-of-n fallback started for ${p.cohortId}`;
    case 'nonce-received':
      return `nonce from ${did}`;
    case 'signing-complete':
      return `signing complete (${(p.path as string) ?? 'key-path'})`;
    case 'cohort-failed':
      return `cohort ${p.cohortId} failed: ${p.reason}`;
    case 'error':
      return `error: ${p.message ?? 'unknown'}`;
    default:
      return event;
  }
}

function shortDid(did: string | undefined): string {
  if (!did) return 'unknown';
  return did.length > 22 ? `${did.slice(0, 14)}…${did.slice(-4)}` : did;
}

function shortId(id: string | undefined): string {
  if (!id) return '?';
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}
