import { StatusDot } from '../../ui/primitives';
import type { CohortDetailDTO } from '../../lib/operator';

/**
 * The operator cohort-lifecycle stage timeline (D-05), the visual anchor at the top of the
 * drill-down. It MIRRORS the participant `StageTimeline` treatment (completed = good dot,
 * active = pulsing accent dot, pending = dim neutral) but carries its OWN stage set: the
 * operator's cohort lifecycle advertise -> filling -> submissions -> co-signing -> funding
 * (live+broadcast only) -> anchor. The live-only funding stage is inserted between co-signing and
 * anchor exactly when the detail carries a funding view (04-06). It deliberately does NOT import
 * the participant component: the two timelines describe two different journeys and must stay honest
 * for each side independently.
 *
 * The active stage is derived PURELY from the observed detail projection (phase + submissions +
 * co-sign + funding + anchor facts), so the rendered timeline can never claim a stage the monitor
 * did not observe. "Anchored" is reserved for a CONFIRMED anchor only (D-18); the deeper Anchor
 * concern section below renders the Signed/Broadcast/Confirmed sub-steps.
 */

/** The operator lifecycle stages, in protocol order (D-05); `funding` appears live+broadcast only. */
export type OperatorStage = 'advertise' | 'filling' | 'submissions' | 'co-signing' | 'funding' | 'anchor';

const STAGE_LABEL: Record<OperatorStage, string> = {
  advertise: 'Advertised',
  filling: 'Filling',
  submissions: 'Submissions',
  'co-signing': 'Co-signing',
  funding: 'Funding',
  anchor: 'Anchor',
};

/** Library phases that place a cohort at (at least) the Submissions stage. */
const SUBMISSION_PHASES = new Set<string>(['CohortSet', 'CollectingUpdates']);
/** Library phases that place a cohort at (at least) the Co-signing stage. */
const CO_SIGN_PHASES = new Set<string>(['SigningStarted', 'NoncesCollected', 'AwaitingPartialSigs']);

/** Build the ordered stage list: the funding stage is present only for a live+broadcast cohort. */
function stageOrder(hasFunding: boolean): OperatorStage[] {
  const base: OperatorStage[] = ['advertise', 'filling', 'submissions', 'co-signing'];
  if (hasFunding) {
    base.push('funding');
  }
  base.push('anchor');
  return base;
}

/**
 * Derive the active operator stage from the observed detail. Takes the FURTHEST-along signal so a
 * cohort never reads behind its real progress: the phase string, any observed submission, any
 * observed nonce / awaiting-partial-sigs, the funding view (live+broadcast), and any non-`none`
 * anchor state each ratchet the stage forward. A hermetic cohort with no anchor stays at co-signing
 * (its honest terminal); a live+broadcast cohort awaiting funds sits at the funding stage.
 */
function deriveOperatorStage(detail: CohortDetailDTO, order: OperatorStage[]): OperatorStage {
  let idx = order.indexOf('filling');
  const bump = (stage: OperatorStage): void => {
    const i = order.indexOf(stage);
    if (i > idx) {
      idx = i;
    }
  };
  if (SUBMISSION_PHASES.has(detail.phase)) {
    bump('submissions');
  }
  if (CO_SIGN_PHASES.has(detail.phase)) {
    bump('co-signing');
  }
  if (detail.submissions.some((s) => s.submitted)) {
    bump('submissions');
  }
  if (detail.coSign.noncesReceived > 0 || detail.coSign.awaitingPartialSigs) {
    bump('co-signing');
  }
  // The funding stage is reached the moment the funding view exists (keygen completed, the wait is
  // live); it stays the active stage while awaiting funds and until the anchor advances.
  if (detail.funding) {
    bump('funding');
  }
  // A non-`none` anchor state (broadcast/confirmed/failed) means the cohort reached anchoring.
  if (detail.anchor.state !== 'none') {
    bump('anchor');
  }
  return order[idx];
}

export function OperatorStageTimeline({ detail }: { detail: CohortDetailDTO }) {
  const order = stageOrder(Boolean(detail.funding));
  const stage = deriveOperatorStage(detail, order);
  const activeIdx = order.indexOf(stage);
  const confirmed = detail.anchor.state === 'confirmed';
  // The active stage renders bad-tone (no pulse) on a terminal failure: a failed anchor broadcast,
  // or a dead-end / lapsed funding stage (D-36/D-38).
  const fundingBad =
    detail.funding?.state === 'dead-end' || detail.funding?.terminal !== undefined;
  const anchorFailed = detail.anchor.state === 'failed';

  return (
    <ol className="space-y-3">
      {order.map((key) => {
        const idx = order.indexOf(key);
        const position = idx < activeIdx ? 'complete' : idx === activeIdx ? 'active' : 'pending';
        const bad = position === 'active' && ((key === 'anchor' && anchorFailed) || (key === 'funding' && fundingBad));
        const dotTone =
          position === 'complete'
            ? 'good'
            : position === 'active'
              ? bad
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
        const label = key === 'anchor' && confirmed ? 'Anchored' : STAGE_LABEL[key];
        return (
          <li key={key} className="flex items-center gap-3">
            <StatusDot tone={dotTone} pulse={position === 'active' && !bad} label={`${label}: ${position}`} />
            <div className={labelClass}>{label}</div>
          </li>
        );
      })}
    </ol>
  );
}
