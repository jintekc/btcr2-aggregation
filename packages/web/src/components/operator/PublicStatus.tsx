import { useEffect, useState } from 'react';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import { Card, StatusDot } from '../../ui/primitives';
import { fetchStatus, type ServiceStatus } from '../../lib/operator';

/** Poll cadence for the public status (bounded fetch; no new dependency). */
const POLL_MS = 10000;

/**
 * Anonymous public status card (D-09). Shows the service is online, the active Bitcoin
 * network (reusing the header's network-chip treatment, including the mainnet
 * `· REAL FUNDS` variant), and a truthful open-cohort count sourced from the same
 * public `GET /v1/status` the directory derives from - so the number a stranger sees
 * matches what they can actually join. Fetched without operator credentials (the status
 * route is public) and refreshed on a bounded interval; renders nothing until the first
 * successful fetch so a briefly-unreachable service shows no misleading state.
 */
export function PublicStatus({ baseUrl }: { baseUrl: string }) {
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
  const openCopy = status.openCohorts === 0 ? 'No open cohorts right now' : `${status.openCohorts} open cohorts`;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <StatusDot tone="good" pulse label="service online" />
          <span className="text-sm text-ink">Service online</span>
        </div>
        <span className="text-sm text-muted">{openCopy}</span>
      </div>
      <span
        className={
          net.isMainnet
            ? 'rounded-full border border-bad/50 bg-bad/10 px-3 py-1 text-xs font-semibold text-bad'
            : 'rounded-full border border-edge bg-surface px-3 py-1 text-xs text-faint'
        }
      >
        {net.isMainnet ? `${net.label} · REAL FUNDS` : net.label}
      </span>
    </Card>
  );
}
