import { useShallow } from 'zustand/react/shallow';
import { useDashboard } from '../../stores/dashboard';

/** Coordinator-wide counters across every cohort this feed has seen. */
export function MetricsStrip() {
  const m = useDashboard(useShallow((s) => s.metrics));
  const items: { label: string; value: number; tone: string }[] = [
    { label: 'advertised', value: m.advertised, tone: 'text-ink' },
    { label: 'accepted', value: m.accepted, tone: 'text-accent' },
    { label: 'updates', value: m.updates, tone: 'text-ink' },
    { label: 'completed', value: m.completed, tone: 'text-good' },
    { label: 'failed', value: m.failed, tone: 'text-bad' },
  ];
  return (
    <div className="grid grid-cols-5 gap-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border border-edge bg-surface px-4 py-3 text-center">
          <div className={`text-2xl font-bold tabular-nums ${it.tone}`}>{it.value}</div>
          <div className="text-[0.65rem] uppercase tracking-wider text-faint">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
