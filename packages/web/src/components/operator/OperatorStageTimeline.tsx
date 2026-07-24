import { StatusDot } from '../../ui/primitives';
import type { CohortDetailDTO } from '../../lib/operator';

/**
 * The operator cohort-lifecycle stage timeline (D-05), the visual anchor at the top of the
 * drill-down. It MIRRORS the participant `StageTimeline` treatment (completed = good dot,
 * active = pulsing accent dot, pending = dim neutral) but carries its OWN stage set: the
 * operator's cohort lifecycle advertise -> filling -> submissions -> co-signing -> anchor
 * (the live-only funding stage is inserted between co-signing and anchor by plan 04-06). It
 * deliberately does NOT import the participant component: the two timelines describe two
 * different journeys and must stay honest for each side independently.
 *
 * The active stage is derived PURELY from the observed detail projection (phase + submissions
 * + co-sign + anchor facts), so the rendered timeline can never claim a stage the monitor did
 * not observe. "Anchored" is reserved for a CONFIRMED anchor only (D-18); the deeper Anchor
 * concern section below renders the Signed/Broadcast/Confirmed sub-steps.
 */

/** The operator lifecycle stages, in protocol order (D-05). */
export type OperatorStage = 'advertise' | 'filling' | 'submissions' | 'co-signing' | 'anchor';

const TIMELINE: { key: OperatorStage; label: string }[] = [
  { key: 'advertise', label: 'Advertised' },
  { key: 'filling', label: 'Filling' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'co-signing', label: 'Co-signing' },
  { key: 'anchor', label: 'Anchor' },
];

const STAGE_ORDER: OperatorStage[] = ['advertise', 'filling', 'submissions', 'co-signing', 'anchor'];

/** Library phases that place a cohort at (at least) the Submissions stage. */
const SUBMISSION_PHASES = new Set<string>(['CohortSet', 'CollectingUpdates']);
/** Library phases that place a cohort at (at least) the Co-signing stage. */
const CO_SIGN_PHASES = new Set<string>(['SigningStarted', 'NoncesCollected', 'AwaitingPartialSigs']);

/**
 * Derive the active operator stage from the observed detail. Takes the FURTHEST-along signal
 * so a cohort never reads behind its real progress: the phase string, any observed submission,
 * any observed nonce / awaiting-partial-sigs, and any non-`none` anchor state each ratchet the
 * stage forward. A hermetic cohort with no anchor stays at co-signing (its honest terminal),
 * because there is no on-chain anchor to reach.
 */
function deriveOperatorStage(detail: CohortDetailDTO): OperatorStage {
  // Filling by default once a cohort exists (advertise is always already done here).
  let idx = 1;
  if (SUBMISSION_PHASES.has(detail.phase)) {
    idx = Math.max(idx, 2);
  }
  if (CO_SIGN_PHASES.has(detail.phase)) {
    idx = Math.max(idx, 3);
  }
  if (detail.submissions.some((s) => s.submitted)) {
    idx = Math.max(idx, 2);
  }
  if (detail.coSign.noncesReceived > 0 || detail.coSign.awaitingPartialSigs) {
    idx = Math.max(idx, 3);
  }
  // A non-`none` anchor state (broadcast/confirmed/failed) means the cohort reached anchoring.
  if (detail.anchor.state !== 'none') {
    idx = Math.max(idx, 4);
  }
  return STAGE_ORDER[idx];
}

export function OperatorStageTimeline({ detail }: { detail: CohortDetailDTO }) {
  const stage = deriveOperatorStage(detail);
  const activeIdx = STAGE_ORDER.indexOf(stage);
  // A failed broadcast marks the active (anchor) stage bad-tone (no pulse); "Anchored" is
  // reserved for a confirmed anchor only (D-18), so the final row relabels only then.
  const failed = detail.anchor.state === 'failed';
  const confirmed = detail.anchor.state === 'confirmed';

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
        // The anchor row relabels to "Anchored" ONLY when the anchor is confirmed (D-18); a
        // broadcasting, failed, or hermetic cohort keeps the honest "Anchor" label.
        const label = item.key === 'anchor' && confirmed ? 'Anchored' : item.label;
        return (
          <li key={item.key} className="flex items-center gap-3">
            <StatusDot
              tone={dotTone}
              pulse={position === 'active' && !failed}
              label={`${label}: ${position}`}
            />
            <div className={labelClass}>{label}</div>
          </li>
        );
      })}
    </ol>
  );
}
