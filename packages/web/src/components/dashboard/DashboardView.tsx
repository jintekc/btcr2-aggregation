import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useDashboard } from '../../stores/dashboard';
import { Badge, Card, SectionTitle, StatusDot } from '../../ui/primitives';
import { LogPanel } from '../LogPanel';
import { CohortCard } from './CohortCard';
import { MetricsStrip } from './MetricsStrip';

/**
 * Coordinator monitor. Subscribes to the read-only `/dashboard/events` SSE feed
 * and renders every cohort's lifecycle plus a raw service event log. This is
 * pure telemetry: it never participates in signing.
 */
export function DashboardView() {
  const connect = useDashboard((s) => s.connect);
  const disconnect = useDashboard((s) => s.disconnect);
  const connected = useDashboard((s) => s.connected);
  const log = useDashboard((s) => s.log);
  const order = useDashboard(useShallow((s) => s.order));
  const cohorts = useDashboard((s) => s.cohorts);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Newest cohort first.
  const cards = [...order].reverse();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot
            tone={connected ? 'good' : 'bad'}
            pulse={connected}
            label={connected ? 'connected' : 'offline'}
          />
          <span className="text-sm text-muted">
            {connected ? 'live coordinator feed' : 'feed disconnected'}
          </span>
        </div>
        <Badge tone={connected ? 'good' : 'bad'}>{connected ? 'connected' : 'offline'}</Badge>
      </div>

      <MetricsStrip />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <SectionTitle>Cohorts</SectionTitle>
          {cards.length === 0 ? (
            <Card className="p-6 text-center text-sm text-faint">
              Waiting for the coordinator to advertise a cohort…
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {cards.map((id) => {
                const cohort = cohorts[id];
                return cohort ? <CohortCard key={id} cohort={cohort} /> : null;
              })}
            </div>
          )}
        </div>

        <Card className="flex h-[28rem] flex-col p-5">
          <LogPanel
            title="Service events"
            entries={log}
            emptyHint="No service events yet."
            className="flex-1"
          />
        </Card>
      </div>
    </div>
  );
}
