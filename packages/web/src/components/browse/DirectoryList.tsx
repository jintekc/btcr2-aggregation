import { useEffect, useState } from 'react';
import { Card, SectionTitle } from '../../ui/primitives';
import { fetchDirectory, type DirectoryCohortDTO } from '../../lib/directory';
import { CohortRow } from './CohortRow';

/** Directory poll cadence (D-05): ~5s so a freshly-advertised cohort appears on its own. */
const POLL_MS = 5000;

/** The four mutually-exclusive render states of the directory (D-12). */
export type DirectoryView = 'loading' | 'rows' | 'empty' | 'unreachable';

/**
 * The pure D-12 state selector. `reachable` is tracked SEPARATELY from `rows` so a
 * transient fetch error (reachable=false) shows the distinct unreachable banner and never
 * collapses into the benign "no cohorts" empty state. Before the first successful fetch
 * (rows === undefined, still reachable) the list renders nothing (loading), matching the
 * PublicStatus card's no-misleading-state behavior.
 */
export function directoryView(reachable: boolean, rows: DirectoryCohortDTO[] | undefined): DirectoryView {
  if (!reachable) {
    return 'unreachable';
  }
  if (rows === undefined) {
    return 'loading';
  }
  if (rows.length === 0) {
    return 'empty';
  }
  return 'rows';
}

/**
 * A single anonymous directory fetch, reduced to the two-field state the component tracks.
 * On success it reports the fetched rows and `reachable: true`; on any rejection it reports
 * only `reachable: false` (the caller keeps its prior rows so a blip never blanks the list).
 * This SPLITS the source's single `.catch` into the reachable/unreachable branches (D-12).
 */
export async function fetchDirectoryState(
  baseUrl: string,
): Promise<{ rows?: DirectoryCohortDTO[]; reachable: boolean }> {
  try {
    const rows = await fetchDirectory(baseUrl);
    return { rows, reachable: true };
  } catch {
    return { reachable: false };
  }
}

/**
 * The ~5s-polled anonymous directory list (PART-01). Renders one {@link CohortRow} per open
 * cohort newest-advertised first (the service appends newest last, so the fetched order is
 * reversed), and keeps polling on a bounded interval with an active guard. The three D-12
 * states (rows / empty / unreachable) are derived by {@link directoryView} and never
 * conflated. It never maintains a parallel client-side cohort list: every render is from the
 * latest fetched rows (Phase-1 D-15 / RESEARCH anti-pattern).
 */
export function DirectoryList({
  baseUrl,
  onPick,
}: {
  baseUrl: string;
  onPick?: (row: DirectoryCohortDTO) => void;
}) {
  const [rows, setRows] = useState<DirectoryCohortDTO[] | undefined>(undefined);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let active = true;
    const load = () => {
      void fetchDirectoryState(baseUrl).then((s) => {
        if (!active) {
          return;
        }
        setReachable(s.reachable);
        if (s.reachable && s.rows) {
          setRows(s.rows);
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

  const view = directoryView(reachable, rows);

  if (view === 'unreachable') {
    return (
      <Card className="space-y-1 border-bad/40 bg-bad/10 p-5">
        <p className="text-sm text-bad">Can't reach this service</p>
        <p className="text-sm text-bad/80">
          We couldn't load this service's cohort directory. Retrying automatically…
        </p>
      </Card>
    );
  }

  if (view === 'loading') {
    return null;
  }

  if (view === 'empty') {
    return (
      <Card className="space-y-1 p-5">
        <p className="text-sm text-ink">No open cohorts right now</p>
        <p className="text-sm text-muted">
          This service isn't advertising any cohorts right now. Check back soon.
        </p>
      </Card>
    );
  }

  const ordered = rows ? rows.slice().reverse() : [];

  return (
    <div className="space-y-4">
      <SectionTitle>Open cohorts</SectionTitle>
      <div className="space-y-3">
        {ordered.map((row) => (
          <CohortRow key={row.cohortId} row={row} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}
