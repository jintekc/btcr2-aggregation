import { useEffect, useRef } from 'react';
import { fmtElapsed } from '../lib/clock';
import type { LogEntry, LogLevel } from '../lib/types';
import { SectionTitle } from '../ui/primitives';

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'text-muted',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
};

/** An auto-scrolling, monospace event log. */
export function LogPanel({
  title,
  entries,
  emptyHint,
  className = '',
}: {
  title: string;
  entries: LogEntry[];
  emptyHint: string;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Scroll the log container itself (not scrollIntoView on a sentinel, which would
  // also scroll the whole window and yank the page during a demo). Depend on the
  // last entry id, not entries.length, so auto-follow keeps working after the
  // capped buffer fills and the length stops changing.
  const lastId = entries.length > 0 ? entries[entries.length - 1].id : 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lastId]);

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle>{title}</SectionTitle>
        <span className="text-[0.65rem] text-faint">{entries.length} events</span>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-edge bg-canvas p-3"
      >
        {entries.length === 0 ? (
          <p className="font-mono text-xs text-faint">{emptyHint}</p>
        ) : (
          <ul className="space-y-1">
            {entries.map((e) => (
              <li key={e.id} className="flex gap-2 font-mono text-xs leading-relaxed">
                <span className="shrink-0 text-faint tabular-nums">{fmtElapsed(e.t)}</span>
                <span className={LEVEL_COLOR[e.level]}>{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
