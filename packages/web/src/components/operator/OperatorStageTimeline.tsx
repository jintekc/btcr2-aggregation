import { IN_FLIGHT_PHASES } from '@btcr2-aggregation/shared';
import { StatusDot } from '../../ui/primitives';
import { closedAtNthSeat } from '../../lib/lifecycle';
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
 *
 * This surface is where CLOSING lives (SVC-04, D-01), and it is the reason there is no Close
 * button anywhere in the console. Closing is not an operator verb: the cohort model pins
 * `min === max === n`, so the nth seat both locks the roster and starts keygen, and no primitive
 * exists that would stop accepting joins while leaving the cohort able to proceed (a partially
 * filled n-of-n cohort that stopped accepting joins could never anchor). So the close is narrated
 * here as a stage that simply becomes reached, and it gains no control. The same rule governs the
 * terminal `Canceled` marker below: the timeline stays a READ surface.
 */

/**
 * The operator lifecycle stages, in protocol order (D-05); `funding` appears live+broadcast only.
 * `closed` is the AUTOMATIC nth-seat lock, never an action.
 */
export type OperatorStage =
  | 'advertise'
  | 'filling'
  | 'closed'
  | 'submissions'
  | 'co-signing'
  | 'funding'
  | 'anchor';

export const STAGE_LABEL: Record<OperatorStage, string> = {
  advertise: 'Advertised',
  filling: 'Filling',
  closed: 'Closed',
  submissions: 'Submissions',
  'co-signing': 'Co-signing',
  funding: 'Funding',
  anchor: 'Anchor',
};

/**
 * Per-stage explanatory caption, rendered under the label. Only the automatic `Closed` stage has
 * one, because it is the only stage whose meaning an operator could reasonably misread (as
 * something the service did TO the cohort, or as something they could have done themselves).
 * Exact 05-UI-SPEC copy.
 */
export const STAGE_CAPTION: Partial<Record<OperatorStage, string>> = {
  closed: 'Every seat filled, so this cohort locked and stopped accepting joins.',
};

/** The terminal marker label for a cohort the operator deliberately ended (D-01/D-05). */
export const CANCELED_STAGE_LABEL = 'Canceled';

/**
 * Whether this cohort's timeline ends in the terminal Canceled marker (SVC-04). Read straight off
 * the served fate, never inferred: a cancel is a DELIBERATE act, so it is narrated in neutral tone
 * beside the stage the cohort actually reached, not as a failure and not by repainting the stages
 * behind it as though they had completed.
 */
export function terminalCanceled(detail: CohortDetailDTO): boolean {
  return detail.fate === 'canceled';
}

/** Library phases that place a cohort at (at least) the Submissions stage. */
const SUBMISSION_PHASES = new Set<string>(['CohortSet', 'CollectingUpdates']);
/**
 * Library phases that place a cohort at (at least) the Co-signing stage: the shared in-flight set
 * (review WR-05).
 *
 * This was a FOURTH, divergent copy that omitted the four funding-wait phases
 * (`UpdatesCollected`, `DataDistributed`, `Validated`, `FallbackRequested`) the service's
 * `operator-cohorts.ts` / `monitor.ts` and the web `lib/directory.ts` were all deliberately
 * widened to include (SVC-JOIN-2). On a HERMETIC cohort sitting in one of them with nonces not
 * yet observed, `deriveOperatorStage` bumped only to `submissions`, so the drill-down's primary
 * visual anchor reported the cohort was collecting submissions while it was actually mid-signing.
 * The live path's `detail.funding` bump masked it; the hermetic path (the default, and the one the
 * e2e exercises) showed it.
 */
const CO_SIGN_PHASES = IN_FLIGHT_PHASES;

/**
 * Build the ordered stage list: the funding stage is present only for a live+broadcast cohort.
 * Exported alongside {@link deriveOperatorStage} so the stage derivation is directly spec-able
 * (review WR-05); the component itself needs no DOM harness to pin its honesty.
 */
export function stageOrder(hasFunding: boolean): OperatorStage[] {
  const base: OperatorStage[] = ['advertise', 'filling', 'closed', 'submissions', 'co-signing'];
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
export function deriveOperatorStage(detail: CohortDetailDTO, order: OperatorStage[]): OperatorStage {
  let idx = order.indexOf('filling');
  const bump = (stage: OperatorStage): void => {
    const i = order.indexOf(stage);
    if (i > idx) {
      idx = i;
    }
  };
  // The AUTOMATIC close (D-01): the nth seat filled, so the cohort locked and stopped accepting
  // joins. Derived from the served seat counts, because nothing on the wire flags it and nothing
  // needs to - it is simply the moment `joined` reaches `capacity`.
  if (closedAtNthSeat(detail)) {
    bump('closed');
  }
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
  // A canceled cohort is going nowhere, so the active stage stops pulsing: the pulse means "in
  // progress", and claiming progress on a cohort the operator ended would be the timeline lying.
  const canceled = terminalCanceled(detail);

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
        const caption = STAGE_CAPTION[key];
        return (
          <li key={key} className="flex items-start gap-3">
            <StatusDot
              tone={dotTone}
              pulse={position === 'active' && !bad && !canceled}
              label={`${label}: ${position}`}
            />
            <div>
              <div className={labelClass}>{label}</div>
              {/* The caption explains an AUTOMATIC stage; it is shown once the stage is reached,
                  so a pending Closed row is not yet narrating something that has not happened. */}
              {caption && position !== 'pending' ? (
                <p className="mt-0.5 text-xs text-muted">{caption}</p>
              ) : null}
            </div>
          </li>
        );
      })}
      {/* The terminal Canceled marker (D-01/D-05), appended AFTER the stage the cohort actually
          reached rather than replacing it, so the timeline never implies the cohort got further
          than it did. Neutral tone, no pulse: a cancel is a deliberate operator decision, not a
          failure. It is a read-only row like every other one here; the cancel CONTROL lives in the
          Lifecycle section below. */}
      {canceled ? (
        <li className="flex items-start gap-3">
          <StatusDot tone="neutral" label={`${CANCELED_STAGE_LABEL}: reached`} />
          <div className="text-sm font-semibold text-ink">{CANCELED_STAGE_LABEL}</div>
        </li>
      ) : null}
    </ol>
  );
}
