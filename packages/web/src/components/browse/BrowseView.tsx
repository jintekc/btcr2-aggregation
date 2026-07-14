import { useState } from 'react';
import { useParticipant } from '../../stores/participant';
import { Button, Card } from '../../ui/primitives';
import { statusLabel, type DirectoryCohortDTO } from '../../lib/directory';
import { PublishPanel } from '../participant/PublishPanel';
import { RegisterPanel } from '../participant/RegisterPanel';
import { ResolvePanel } from '../participant/ResolvePanel';
import { ResultCard } from '../participant/ResultCard';
import { DirectoryList } from './DirectoryList';
import { JoinIdentityStep } from './JoinIdentityStep';
import { ServiceIdentityHeader } from './ServiceIdentityHeader';

/**
 * The participant landing composition (D-13) and the browse-and-pick loop (PART-02,
 * criterion 3): the service-identity header above the polled directory, then a single
 * pick region driven off the participant store's lifecycle. A participant picks an open
 * cohort, confirms an identity inline, joins by choice, sees a seated confirmation, and
 * the existing submit/co-sign/resolve tail keeps working unchanged (D-11).
 *
 * The participant store is the single lifecycle owner (02-RESEARCH Pitfall 4): BrowseView
 * only holds the locally-picked directory row and reads store slices / calls join+leave. It
 * never duplicates join/leave/seated logic. The four tail components
 * (ResultCard/PublishPanel/RegisterPanel/ResolvePanel) are reused verbatim below the seated
 * confirmation via the same `hasResult` gate ParticipantView used; Phase 3 owns that tail.
 */
export function BrowseView({ baseUrl }: { baseUrl: string }) {
  // The directory row the participant tapped Join on (only an isJoinable row can set it).
  // Held locally as the snapshot the inline identity step + seated confirmation read from;
  // the store owns the actual join lifecycle keyed on the same cohort id.
  const [pickedRow, setPickedRow] = useState<DirectoryCohortDTO | null>(null);

  const status = useParticipant((s) => s.status);
  const seated = useParticipant((s) => s.seated);
  const joinClosed = useParticipant((s) => s.joinClosed);
  const error = useParticipant((s) => s.error);
  const hasResult = useParticipant((s) => s.result !== null);
  const leave = useParticipant((s) => s.leave);

  // Return to the directory: clear the local pick and reset the store lifecycle (leave()
  // also clears seated/joinClosed). No confirmation dialog - a not-yet-full seat is benign
  // and reclaimed by the service's TTL (D-15).
  function backToDirectory() {
    leave();
    setPickedRow(null);
  }

  // The picked cohort just filled or closed before we were seated (D-06/D-12): surface the
  // store's deterministic message and offer a return to browse. Never a dead spinner.
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

  // A general join failure that is NOT a filled-or-closed close (WR-01): a post-seat
  // failure (cohort-failed / mid-signing error keeps seated true, joinClosed false) or a
  // pre-seat connect/runtime failure (seated + joinClosed both false). Both were previously
  // invisible - the former showed a false "seated" success card, the latter silently
  // re-enabled Join with no feedback. Surface the reason and offer a return to the directory.
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

  // Seated: the definitive seat (cohort-ready). Show the resting confirmation and, once the
  // cohort anchors, the reused tail. Leave returns to the directory (D-11/D-15).
  if (seated) {
    const shortCohortId = pickedRow ? pickedRow.cohortId.slice(0, 8) : '';
    const seats = pickedRow ? `${pickedRow.joined}/${pickedRow.capacity} seats` : '';
    const label = pickedRow ? statusLabel(pickedRow) : '';
    return (
      <div className="space-y-8">
        <ServiceIdentityHeader baseUrl={baseUrl} />
        <Card className="space-y-3 p-5">
          <h2 className="text-xl font-bold tracking-tight text-ink">
            You&apos;re seated in cohort {shortCohortId}
          </h2>
          <p className="text-sm text-muted">
            {seats} · {label}. When this cohort fills, co-signing begins below.
          </p>
          <Button variant="ghost" onClick={backToDirectory}>
            Leave cohort
          </Button>
        </Card>
        {hasResult && (
          <div className="space-y-5">
            <ResultCard />
            <PublishPanel baseUrl={baseUrl} />
            <RegisterPanel baseUrl={baseUrl} />
            <ResolvePanel baseUrl={baseUrl} />
          </div>
        )}
      </div>
    );
  }

  // Picked but not yet seated: reveal the inline identity step (it drives its own
  // "Joining" state off the store status). Cancel returns to the directory, minting nothing.
  if (pickedRow) {
    return (
      <div className="space-y-8">
        <ServiceIdentityHeader baseUrl={baseUrl} />
        <Card className="p-5">
          <JoinIdentityStep
            baseUrl={baseUrl}
            cohortId={pickedRow.cohortId}
            joined={pickedRow.joined}
            capacity={pickedRow.capacity}
            statusLabel={statusLabel(pickedRow)}
            onCancel={() => setPickedRow(null)}
          />
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
