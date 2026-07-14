import { useEffect, useState } from 'react';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import { Card, StatusDot } from '../../ui/primitives';
import { fetchStatus, type ServiceStatus } from '../../lib/directory';

/** Status poll cadence (matches PublicStatus): 10s bounded fetch, no new dependency. */
const POLL_MS = 10000;

/**
 * The anonymous service-identity header (D-02, PART-01). The single Display focal heading is
 * the service origin (`window.location.host`) so a stranger pointed at the URL immediately
 * sees which service they are looking at, alongside the reused service-online indicator, the
 * active-network chip (including the mainnet `· REAL FUNDS` variant), and the truthful
 * open-cohort count from the same public `GET /v1/status` the directory derives from.
 *
 * Reads without operator credentials (the re-exported {@link fetchStatus} uses
 * `credentials: 'omit'`) and renders nothing until the first successful fetch, so a briefly
 * unreachable service never flashes misleading state.
 */
export function ServiceIdentityHeader({ baseUrl }: { baseUrl: string }) {
  const [status, setStatus] = useState<ServiceStatus | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetchStatus(baseUrl)
        .then((s) => {
          if (active) {
            setStatus(s);
          }
        })
        .catch(() => {
          if (active) {
            setStatus(undefined);
          }
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [baseUrl]);

  if (!status) {
    return null;
  }

  const net = resolveNetwork(status.network);
  const openCopy =
    status.openCohorts === 0 ? 'No open cohorts right now' : `${status.openCohorts} open cohorts`;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-ink">{window.location.host}</h1>
        <span
          className={
            net.isMainnet
              ? 'rounded-full border border-bad/50 bg-bad/10 px-3 py-1 text-xs font-semibold text-bad'
              : 'rounded-full border border-edge bg-surface px-3 py-1 text-xs text-faint'
          }
        >
          {net.isMainnet ? `${net.label} · REAL FUNDS` : net.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <StatusDot tone="good" pulse label="service online" />
          <span className="text-sm text-ink">Service online</span>
        </div>
        <span className="text-sm text-muted">{openCopy}</span>
      </div>
    </Card>
  );
}
