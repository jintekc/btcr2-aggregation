import { StatusDot } from '../../ui/primitives';
import type { Stage } from '../../stores/participant';

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

export function StageTimeline({
  stage,
  failed = false,
  activeElapsedMs,
}: {
  stage: Stage;
  /** A terminal failure marks the active stage bad-tone (no pulse); full degraded UX is 03-06. */
  failed?: boolean;
  /** Milliseconds the active stage has been running, for the quiet elapsed indicator (D-05). */
  activeElapsedMs?: number;
}) {
  const activeIdx = STAGE_ORDER.indexOf(stage);

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
        return (
          <li key={item.key} className="flex items-center gap-3">
            <StatusDot tone={dotTone} pulse={position === 'active' && !failed} label={`${item.label}: ${position}`} />
            <div className="min-w-0">
              <div className={labelClass}>{item.label}</div>
              {position === 'active' && !failed && activeElapsedMs !== undefined ? (
                <div className="text-xs text-faint tabular-nums">Active for {mmss(activeElapsedMs)}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
