import { useEffect, useState } from 'react';
import { Card, SectionTitle } from '../../ui/primitives';
import { directoryNotice, fetchDirectory, type DirectoryCohortDTO } from '../../lib/directory';
import { CohortRow } from './CohortRow';

/** Directory poll cadence (D-05): ~5s so a freshly-advertised cohort appears on its own. */
const POLL_MS = 5000;

/**
 * The paused notice shown ABOVE the list while cohorts are still open (D-07, UI-SPEC E5
 * populated). Its second half is what makes the notice actionable rather than merely informative:
 * pause is drain mode, so everything already advertised is still genuinely joinable.
 */
const PAUSED_WITH_ROWS =
  "This service isn't offering new cohorts right now. The cohorts below are already open, and you can still join one.";

/**
 * The paused empty-state body. Deliberately DIFFERENT wording from the inherited idle body below
 * ("advertising any cohorts" vs "offering new cohorts"), because the two states are otherwise
 * indistinguishable to a stranger: both show zero open cohorts. A participant must be able to tell
 * that the operator CHOSE to stop offering cohorts, rather than concluding the service is dead.
 */
const PAUSED_EMPTY_BODY = "This service isn't offering new cohorts right now. Check back soon.";

/** The inherited idle empty-state body, unchanged, so a paused service never reads as an idle one. */
const IDLE_EMPTY_BODY = "This service isn't advertising any cohorts right now. Check back soon.";

/** The shared empty-state heading, identical in both variants; only the body differs. */
const EMPTY_HEADING = 'No open cohorts right now';

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
  onView,
  paused,
}: {
  baseUrl: string;
  onPick?: (row: DirectoryCohortDTO) => void;
  /**
   * Navigate back to the live cohort page (D-04). Supplied only while a cohort lifecycle is
   * active: it lets the seated row's "View cohort" action return to the cohort view. Omitting
   * `onPick` at the same time disables Join on every row (one cohort at a time).
   */
  onView?: () => void;
  /**
   * The SERVED advertising-pause bit from `GET /v1/status` (SVC-04, D-07), threaded down from
   * {@link BrowseView} which owns the public status read. `undefined` means UNKNOWN (no status
   * read has landed, or the last one failed), and the notice is suppressed entirely in that case:
   * a paused claim is only ever made from a bit this service actually reported.
   */
  paused?: boolean;
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
  // Which paused notice (if any) to render. Computed from the SERVED bit plus the directory's own
  // reachability and row count, so an unreachable directory and an unknown status both fail closed
  // (see `directoryNotice`). The `loading` view returns before this is ever consulted, so a notice
  // can never flash over a directory that has not loaded (UI-SPEC E5 loading).
  const notice = directoryNotice({ paused, rowCount: rows?.length ?? 0, unreachable: !reachable });

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
    // Same heading, different body: the only thing that distinguishes a deliberate pause from an
    // idle service is these words, so the paused variant is not a decoration on the idle one.
    return (
      <Card className="space-y-1 p-5">
        <p className="text-sm text-ink">{EMPTY_HEADING}</p>
        <p className="text-sm text-muted">
          {notice === 'paused-empty' ? PAUSED_EMPTY_BODY : IDLE_EMPTY_BODY}
        </p>
      </Card>
    );
  }

  const ordered = rows ? rows.slice().reverse() : [];

  return (
    <div className="space-y-4">
      {/* The notice sits ABOVE the heading and the list KEEPS rendering below it (UI-SPEC E5
          populated): pausing does not retract what is already advertised, so suppressing the rows
          here would hide cohorts a participant can still join. */}
      {notice === 'paused-with-rows' ? (
        <Card className="p-5">
          <p className="text-sm text-ink">{PAUSED_WITH_ROWS}</p>
        </Card>
      ) : null}
      <SectionTitle>Open cohorts</SectionTitle>
      <div className="space-y-3">
        {ordered.map((row) => (
          <CohortRow key={row.cohortId} row={row} onPick={onPick} onView={onView} />
        ))}
      </div>
    </div>
  );
}
