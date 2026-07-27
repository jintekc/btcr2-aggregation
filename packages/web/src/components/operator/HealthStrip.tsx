import { useEffect, useState } from 'react';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import { Badge, Card, StatusDot } from '../../ui/primitives';
import { useParticipant } from '../../stores/participant';
import { useOperator } from '../../stores/operator';
import type { ServiceMode } from '../../lib/operator';

const MODE_LABEL: Record<ServiceMode, string> = {
  hermetic: 'Hermetic',
  'live-no-broadcast': 'Live (no broadcast)',
  live: 'Live',
};

/** The modes that talk to a live esplora (so the esplora reachability chip is shown, D-43). */
const LIVE_MODES: ServiceMode[] = ['live', 'live-no-broadcast'];

/**
 * The always-visible operator health strip (D-17/D-25/D-51). A single-line, wrapping chip row
 * that discloses, at a glance: the broadcast mode, the active Bitcoin network (reusing the
 * header's network-chip treatment, including the mainnet REAL FUNDS variant), esplora
 * reachability when live, IPFS on/off, a freshness indicator, and the operator-supplied
 * SERVICE_NAME when set.
 *
 * Freshness (D-25) derives from the operator store's own `lastUpdated`, stamped only on an ok
 * poll: the connected dot reads `good` and the label counts up `Updated {n}s ago` while reads
 * land; on a stale/unreachable read (list OR drill-down) the dot goes `warn` and the label
 * FREEZES (the tick stops advancing) rather than lying about a fresh time.
 *
 * The MODE chip (D-17) is rendered from the SERVED `monitoring.health.mode` only, never a local
 * constant (review CR-01). Until the first ok list read lands the strip says `Checking mode`
 * rather than presuming hermetic: claiming "Hermetic" on a `LIVE=1 BROADCAST=1` service would
 * tell the operator this service does not touch the chain while it is broadcasting real Bitcoin
 * transactions, which is the single most consequential piece of copy on this surface.
 *
 * SERVICE_NAME (D-51) is rendered as plain, auto-escaped React text content (never markup or a
 * URL, T-04-03-01) with no edit surface. The strip is `flex-wrap gap-2`, so a long name wraps to
 * a second line instead of pushing the chips off-screen (E2 backstop).
 */
export function HealthStrip() {
  const network = useParticipant((s) => s.network);
  const serviceName = useParticipant((s) => s.serviceName);
  const ipfsInfo = useParticipant((s) => s.ipfsInfo);
  const lastUpdated = useOperator((s) => s.lastUpdated);
  const listStale = useOperator((s) => s.listStale);
  const detailStale = useOperator((s) => s.detailStale);
  const health = useOperator((s) => s.health);

  // The mode is whatever the service SERVED (review CR-01). Undefined until the first ok list
  // read: render no mode claim at all rather than presuming a hermetic service.
  const mode = health?.mode;
  const isLive = mode !== undefined && LIVE_MODES.includes(mode);
  // Esplora reachability is meaningful only on a live mode; the hermetic path serves `'n/a'`
  // (no esplora is ever contacted), and the chip below is hidden there anyway (D-43).
  const esploraReachable = health?.esploraReachable === true;
  const stale = listStale || detailStale;
  const net = resolveNetwork(network);
  const ipfsOn = ipfsInfo?.enabled === true;

  // A 1s tick for the freshness label, FROZEN while stale so the "{n}s ago" number stops
  // advancing on an unreachable read (honest freeze, D-25) rather than climbing past a real time.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!stale) {
        setNow(Date.now());
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [stale]);

  const secondsAgo = lastUpdated !== undefined ? Math.max(0, Math.round((now - lastUpdated) / 1000)) : null;
  const freshTone = stale ? 'warn' : lastUpdated !== undefined ? 'good' : 'neutral';
  const freshLabel = secondsAgo !== null ? `Updated ${secondsAgo}s ago` : 'Connecting';

  return (
    <Card className="flex flex-wrap items-center gap-2 px-4 py-2">
      <Badge tone="neutral">{mode ? MODE_LABEL[mode] : 'Checking mode'}</Badge>

      {serviceName ? <span className="text-sm text-ink">{serviceName}</span> : null}

      <span
        className={
          net.isMainnet
            ? 'rounded-full border border-bad/50 bg-bad/10 px-3 py-1 text-xs font-semibold text-bad'
            : 'rounded-full border border-edge bg-surface px-3 py-1 text-xs text-faint'
        }
      >
        {net.isMainnet ? `${net.label} · REAL FUNDS` : net.label}
      </span>

      {/* Esplora reachability is a live-only signal (D-43); hidden on the hermetic path. A failed
          observation flips this to the bad-tone chip so a mid-flight outage is visible here, not
          only inside a cohort's funding stage. */}
      {isLive ? (
        <Badge tone={esploraReachable ? 'good' : 'bad'}>
          {esploraReachable ? 'Esplora reachable' : 'Esplora unreachable'}
        </Badge>
      ) : null}

      <Badge tone="neutral">{ipfsOn ? 'IPFS on' : 'IPFS off'}</Badge>

      <span className="ml-auto flex items-center gap-2">
        <StatusDot tone={freshTone} label={freshLabel} />
        <span className="text-xs uppercase tracking-[0.14em] text-faint">{freshLabel}</span>
      </span>
    </Card>
  );
}
