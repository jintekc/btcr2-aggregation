import { useEffect, useRef, useState } from 'react';
import { deriveStage, useParticipant } from '../../stores/participant';
import { Button, Card, StatusDot } from '../../ui/primitives';
import type { DirectoryCohortDTO } from '../../lib/directory';
import { CohortPage } from '../cohort/CohortPage';
import { STAGE_LABEL } from '../cohort/StageTimeline';
import { DirectoryList } from './DirectoryList';
import { JoinIdentityStep } from './JoinIdentityStep';
import { ServiceIdentityHeader } from './ServiceIdentityHeader';

/**
 * The participant landing composition (D-13) and the browse-and-pick loop (PART-02/PART-03).
 * The directory is the ONLY entry path (D-31, criterion 4): the standalone stepper is gone.
 * A participant browses the polled directory, picks an open cohort, confirms an identity inline
 * (JoinIdentityStep), joins by choice, and from the moment the join is in flight the whole
 * lifecycle renders on the one continuous {@link CohortPage} (internal SPA view, no route, D-11).
 *
 * The App shell owns the view toggle: `view === 'cohort'` shows the live cohort page, while
 * `view === 'browse'` shows the directory again (so a seated participant can look around) with a
 * persistent "Your cohort · {stage}" link back. Only one cohort at a time (D-04): while a
 * lifecycle is active the directory rows offer no Join, and the seated row shows "You're in this
 * cohort" + View cohort. The participant store is the single lifecycle owner (02-RESEARCH Pitfall
 * 4): BrowseView holds only the locally-picked row and the view, and reads store slices.
 */
export function BrowseView({
  baseUrl,
  view,
  onView,
}: {
  baseUrl: string;
  view: 'cohort' | 'browse';
  onView: (view: 'cohort' | 'browse') => void;
}) {
  // The directory row the participant tapped Join on (only an isJoinable row can set it). Held
  // locally as the snapshot the inline identity step reads from; the store owns the lifecycle.
  const [pickedRow, setPickedRow] = useState<DirectoryCohortDTO | null>(null);

  const status = useParticipant((s) => s.status);
  const optedIn = useParticipant((s) => s.optedIn);
  const seated = useParticipant((s) => s.seated);
  const pendingSubmit = useParticipant((s) => s.pendingSubmit);
  const steps = useParticipant((s) => s.steps);
  const anchor = useParticipant((s) => s.anchor);
  const resolveStatus = useParticipant((s) => s.resolveStatus);
  const joinClosed = useParticipant((s) => s.joinClosed);
  const error = useParticipant((s) => s.error);
  const leave = useParticipant((s) => s.leave);

  // A joined cohort lifecycle is active from the moment the join is in flight through completion.
  // Terminal failures (joinClosed / general failed) are handled by their own cards below and are
  // NOT lifecycleActive; the full degraded/terminal cohort-page states land in 03-06.
  const lifecycleActive = status === 'connecting' || status === 'live' || status === 'complete';
  const stage = deriveStage({ status, optedIn, seated, pendingSubmit, steps, anchor, resolveStatus });

  // Clear the local pick once a lifecycle that actually started has ended (leave / terminal), so
  // we return to the directory rather than re-showing the identity step for the finished cohort.
  const ranLifecycle = useRef(false);
  useEffect(() => {
    if (lifecycleActive) {
      ranLifecycle.current = true;
    } else if (ranLifecycle.current) {
      ranLifecycle.current = false;
      setPickedRow(null);
    }
  }, [lifecycleActive]);

  // Return to the directory from a terminal card: reset the store lifecycle and the local pick.
  function backToDirectory() {
    leave();
    setPickedRow(null);
  }

  // A POST-SEAT terminal failure (D-24/D-25) lands ON the cohort page, not a browse-directory
  // error card: the participant was seated, so the honest degraded/terminal states + Start over
  // belong on the one continuous surface (03-06). Pre-seat closes (joinClosed) and pre-seat join
  // failures stay directory cards below.
  if (status === 'failed' && seated) {
    return <CohortPage baseUrl={baseUrl} onBrowse={() => onView('browse')} />;
  }

  // The picked cohort filled or closed before we were seated (D-06/D-12): the store's
  // deterministic message + a return to browse. Never a dead spinner.
  if (joinClosed) {
    return (
      <div className="space-y-8">
        <ServiceIdentityHeader baseUrl={baseUrl} />
        <Card className="space-y-3 border-bad/40 bg-bad/10 p-5">
          <p className="text-sm text-bad">
            {error ?? 'That cohort just filled or closed. Pick another from the directory.'}
          </p>
          <Button variant="ghost" onClick={backToDirectory}>
            Back to directory
          </Button>
        </Card>
      </div>
    );
  }

  // A general join failure that is NOT a filled-or-closed close (WR-01): surface the reason and
  // offer a return to the directory. (03-06 folds these into the cohort page's D-24/D-25 states.)
  if (status === 'failed' && !joinClosed) {
    return (
      <div className="space-y-8">
        <ServiceIdentityHeader baseUrl={baseUrl} />
        <Card className="space-y-3 border-bad/40 bg-bad/10 p-5">
          <h2 className="text-xl font-bold tracking-tight text-ink">Join failed</h2>
          <p className="text-sm text-bad">
            {error ?? 'The join failed. Pick another cohort from the directory.'}
          </p>
          <Button variant="ghost" onClick={backToDirectory}>
            Back to directory
          </Button>
        </Card>
      </div>
    );
  }

  // Active lifecycle: the one continuous cohort page, or (view === 'browse') the directory with a
  // persistent link back. One cohort at a time - the directory offers no Join while active (D-04).
  if (lifecycleActive) {
    if (view === 'browse') {
      const stageSettled = stage === 'signed' || stage === 'anchored' || stage === 'resolved';
      return (
        <div className="space-y-8">
          <ServiceIdentityHeader baseUrl={baseUrl} />
          <button
            type="button"
            onClick={() => onView('cohort')}
            className="inline-flex items-center gap-2 rounded-lg border border-edge-strong bg-surface-2 px-3 py-2 text-sm text-ink hover:bg-surface"
          >
            <StatusDot tone={stageSettled ? 'good' : 'accent'} pulse={!stageSettled} label="cohort stage" />
            Your cohort · {STAGE_LABEL[stage]}
          </button>
          {/* No onPick while a lifecycle is active: Join is disabled on every row (D-04). The
              seated row surfaces "You're in this cohort" + View cohort via onView. */}
          <DirectoryList baseUrl={baseUrl} onView={() => onView('cohort')} />
        </div>
      );
    }
    return <CohortPage baseUrl={baseUrl} onBrowse={() => onView('browse')} />;
  }

  // Picked but not yet joining: the inline identity step. Cancel returns to the directory.
  if (pickedRow) {
    return (
      <div className="space-y-8">
        <ServiceIdentityHeader baseUrl={baseUrl} />
        <Card className="p-5">
          <JoinIdentityStep baseUrl={baseUrl} row={pickedRow} onCancel={() => setPickedRow(null)} />
        </Card>
      </div>
    );
  }

  // Default: browse. Only an isJoinable row fires onPick.
  return (
    <div className="space-y-8">
      <ServiceIdentityHeader baseUrl={baseUrl} />
      <DirectoryList baseUrl={baseUrl} onPick={setPickedRow} />
    </div>
  );
}
