import { StatusDot } from '../../ui/primitives';
import type { Stage } from '../../stores/participant';
import type { AnchorDTO } from '../../lib/anchor';

/**
 * The one live-journey stage timeline (D-01/D-05). It renders the full protocol journey
 * UPFRONT from a single {@link Stage} derived by the store's pure `deriveStage` (Pattern 3),
 * so the rendered timeline can never drift from the event handlers: completed stages carry a
 * good-tone dot, the active stage a pulsing accent dot plus the quiet "Active for {mm:ss}"
 * elapsed indicator (never a countdown or a duration promise, D-05), and future stages are
 * dimmed as pending. It is the primary visual anchor on the cohort page (UI-SPEC Color); the
 * single accent CTA renders inline at the active stage and never competes as a separate anchor.
 *
 * Anchoring / resolution land in 03-06; this plan's timeline runs through "Signed". A stage
 * beyond "Signed" (anchored/resolved) marks every listed step complete (the journey is done).
 */

/** The five stages this plan's timeline renders, in protocol order (D-01). */
const TIMELINE: { key: Stage; label: string }[] = [
  { key: 'waiting-for-seats', label: 'Waiting for seats' },
  { key: 'seated', label: 'Seated' },
  { key: 'submit-window', label: 'Submit update' },
  { key: 'co-signing', label: 'Co-signing' },
  { key: 'signed', label: 'Signed' },
];

/**
 * Full precedence order of every {@link Stage}, so a stage past "Signed" (anchored/resolved)
 * still ranks every listed timeline step as complete. The plain-language label for each stage,
 * shared by the persistent "Your cohort · {stage}" link (D-03) so the chip and the timeline
 * always name the same stage.
 */
const STAGE_ORDER: Stage[] = [
  'waiting-for-seats',
  'seated',
  'submit-window',
  'co-signing',
  'signed',
  'anchored',
  'resolved',
];

/** Plain-language stage labels (D-01/D-03), the single source shared with the chip. */
export const STAGE_LABEL: Record<Stage, string> = {
  'waiting-for-seats': 'Waiting for seats',
  seated: 'Seated',
  'submit-window': 'Submit update',
  'co-signing': 'Co-signing',
  signed: 'Signed',
  anchored: 'Anchored',
  resolved: 'Resolved',
};

/** Format an elapsed-ms value as a quiet `mm:ss` (no milliseconds, no countdown). */
function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * The live anchor sub-steps (D-22, UI-SPEC E6), rendered under the final "Anchored" row ONLY on a
 * broadcasting service (`anchor.enabled`). They walk Signed -> Broadcast (txid + a "View on
 * explorer" link) -> Confirmed on the ~5s poll cadence and FREEZE at first confirmation (the store
 * stops polling; this just renders the last-known state). The hermetic (no-broadcast) path never
 * renders them: its single "Signed" line is the honest terminal (D-07). Mode honesty: no txid,
 * no broadcast/confirmed sub-step, ever surfaces when `enabled` is false.
 */
function AnchorSubSteps({ anchor }: { anchor: AnchorDTO }) {
  // Broadcast is reached once the tx is broadcast/confirmed; Confirmed only at confirmed. A
  // failed anchor marks the reached-but-unconfirmed step bad-tone (still not a page terminal).
  const broadcastReached = anchor.state === 'broadcast' || anchor.state === 'confirmed';
  const confirmed = anchor.state === 'confirmed';
  const failedAnchor = anchor.state === 'failed';
  const sub: { label: string; done: boolean; bad?: boolean }[] = [
    { label: 'Signed', done: true },
    { label: 'Broadcast', done: broadcastReached, bad: failedAnchor && !broadcastReached },
    { label: 'Confirmed', done: confirmed, bad: failedAnchor && broadcastReached },
  ];
  return (
    <ol className="ml-6 mt-1 space-y-1.5 border-l border-edge pl-4">
      {sub.map((s) => (
        <li key={s.label} className="flex items-center gap-2">
          <StatusDot
            tone={s.bad ? 'bad' : s.done ? 'good' : 'neutral'}
            label={`${s.label}: ${s.done ? 'done' : 'pending'}`}
          />
          <span className={s.done ? 'text-xs text-muted' : 'text-xs text-faint'}>{s.label}</span>
        </li>
      ))}
      {broadcastReached && anchor.txid ? (
        <li className="flex flex-wrap items-center gap-2 pl-0 text-xs text-faint">
          <span className="font-mono break-all">{anchor.txid}</span>
          {anchor.explorerUrl ? (
            <a
              href={anchor.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline decoration-dotted underline-offset-2 hover:brightness-110"
            >
              View on explorer
            </a>
          ) : null}
        </li>
      ) : null}
    </ol>
  );
}

export function StageTimeline({
  stage,
  failed = false,
  activeElapsedMs,
  anchor = null,
}: {
  stage: Stage;
  /** A terminal failure marks the active stage bad-tone (no pulse) and freezes the timeline. */
  failed?: boolean;
  /** Milliseconds the active stage has been running, for the quiet elapsed indicator (D-05). */
  activeElapsedMs?: number;
  /**
   * The last-known anchor read (D-22). On a broadcasting service (`enabled`) the final step
   * relabels to "Anchored" and expands into the Signed/Broadcast/Confirmed sub-steps; on the
   * hermetic path it stays a single "Signed" line (mode honesty, D-07).
   */
  anchor?: AnchorDTO | null;
}) {
  const activeIdx = STAGE_ORDER.indexOf(stage);
  const liveAnchor = anchor?.enabled === true;

  return (
    <ol className="space-y-3">
      {TIMELINE.map((item) => {
        const idx = STAGE_ORDER.indexOf(item.key);
        const position = idx < activeIdx ? 'complete' : idx === activeIdx ? 'active' : 'pending';
        const dotTone =
          position === 'complete'
            ? 'good'
            : position === 'active'
              ? failed
                ? 'bad'
                : 'accent'
              : 'neutral';
        const labelClass =
          position === 'active'
            ? 'text-sm font-semibold text-ink'
            : position === 'complete'
              ? 'text-sm text-muted'
              : 'text-sm text-faint';
        // The final row relabels to "Anchored" on a broadcasting service (UI-SPEC stage labels).
        const label = item.key === 'signed' && liveAnchor ? 'Anchored' : item.label;
        // Expand the anchor sub-steps under the final row once it is reached, live only (D-22).
        const showSubSteps = item.key === 'signed' && liveAnchor && position !== 'pending';
        return (
          <li key={item.key} className="flex flex-col">
            <div className="flex items-center gap-3">
              <StatusDot tone={dotTone} pulse={position === 'active' && !failed} label={`${label}: ${position}`} />
              <div className="min-w-0">
                <div className={labelClass}>{label}</div>
                {position === 'active' && !failed && activeElapsedMs !== undefined ? (
                  <div className="text-xs text-faint tabular-nums">Active for {mmss(activeElapsedMs)}</div>
                ) : null}
              </div>
            </div>
            {showSubSteps && anchor ? <AnchorSubSteps anchor={anchor} /> : null}
          </li>
        );
      })}
    </ol>
  );
}
