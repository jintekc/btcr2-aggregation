import { useState } from 'react';
import { Badge, Button, Card, CopyField, SectionTitle } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';
import type { OperatorCohortDTO } from '../../lib/operator';

/** Friendly beacon-type label (matches the create form's CAS/SMT options). */
function beaconLabel(beaconType: OperatorCohortDTO['beaconType']): string {
  return beaconType === 'CASBeacon' ? 'CAS' : 'SMT';
}

/** Neutral/accent/bad badge label + tone for a cohort's state. */
function stateBadge(state: OperatorCohortDTO['state']): { tone: 'neutral' | 'accent' | 'bad'; label: string } {
  if (state === 'draft') {
    return { tone: 'neutral', label: 'Draft' };
  }
  if (state === 'expired') {
    return { tone: 'bad', label: 'Expired' };
  }
  return { tone: 'accent', label: 'Advertised' };
}

/**
 * One operator cohort row (SVC-01/SVC-02, D-16, F2). A DRAFT shows a neutral `Draft`
 * badge plus the two-step actions: the primary `Advertise cohort` CTA (the only accent
 * button, UI-SPEC) and `Discard draft` (danger, behind an inline confirm). An ADVERTISED
 * cohort shows the accent `Advertised` badge and its live `{joined}/{capacity}` seats and
 * carries no actions here (pause/cancel is Phase 5). An EXPIRED cohort shows a bad-tone
 * `Expired` badge with its reason and a single primary `Re-advertise` action, so an
 * expired cohort is visible and revivable instead of silently vanishing. All render the
 * network, beacon type, and a copyable id.
 */
function CohortRow({ baseUrl, cohort }: { baseUrl: string; cohort: OperatorCohortDTO }) {
  const discard = useOperator((s) => s.discard);
  const advertise = useOperator((s) => s.advertise);
  const readvertise = useOperator((s) => s.readvertise);
  const advertiseStatus = useOperator((s) => s.advertiseStatus);
  const advertisingId = useOperator((s) => s.advertisingId);
  const [confirming, setConfirming] = useState(false);

  const isDraft = cohort.state === 'draft';
  const isExpired = cohort.state === 'expired';
  const isAdvertising = advertiseStatus === 'advertising' && advertisingId === cohort.draftId;
  const badge = stateBadge(cohort.state);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <span className="text-sm text-muted">{cohort.network}</span>
          <span className="text-sm text-muted">{beaconLabel(cohort.beaconType)}</span>
          <span className="text-sm text-muted">
            {cohort.joined}/{cohort.capacity} seats
          </span>
        </div>
        {isDraft && !confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={isAdvertising} onClick={() => void advertise(baseUrl, cohort.draftId)}>
              {isAdvertising ? 'Advertising…' : 'Advertise cohort'}
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Discard draft
            </Button>
          </div>
        ) : null}
        {isExpired ? (
          <Button variant="primary" disabled={isAdvertising} onClick={() => void readvertise(baseUrl, cohort.draftId)}>
            {isAdvertising ? 'Re-advertising…' : 'Re-advertise'}
          </Button>
        ) : null}
      </div>

      {isExpired && cohort.reason ? (
        <p className="text-sm text-muted">Expired: {cohort.reason}</p>
      ) : null}

      <CopyField label={isDraft ? 'draft id' : 'cohort id'} value={cohort.draftId} />

      {confirming ? (
        <div className="space-y-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          <p>
            Discard this draft? It hasn&rsquo;t been advertised, so nothing has been published to the
            directory yet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void discard(baseUrl, cohort.draftId)}>
              Discard draft
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep draft
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The operator's own cohort list (D-16). Empty until a draft is created; the empty
 * state uses the exact UI-SPEC heading + body. Drafts and advertised cohorts both render
 * as a {@link CohortRow}. A transient good-tone banner confirms a successful advertise.
 */
export function OperatorCohortList({ baseUrl }: { baseUrl: string }) {
  const cohorts = useOperator((s) => s.cohorts);
  const advertiseMessage = useOperator((s) => s.advertiseMessage);

  return (
    <Card className="space-y-4 p-5">
      <SectionTitle>Your cohorts</SectionTitle>
      {advertiseMessage ? (
        <div className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {advertiseMessage}
        </div>
      ) : null}
      {cohorts.length === 0 ? (
        <div className="space-y-1">
          <p className="text-sm text-ink">No cohorts yet</p>
          <p className="text-sm text-muted">
            Create a cohort to advertise it into this service&rsquo;s directory.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {cohorts.map((cohort) => (
            <CohortRow key={cohort.draftId} baseUrl={baseUrl} cohort={cohort} />
          ))}
        </div>
      )}
    </Card>
  );
}
