import { useState } from 'react';
import { Badge, Button, Card, CopyField, SectionTitle } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';
import type { OperatorCohortDTO } from '../../lib/operator';

/** Friendly beacon-type label (matches the create form's CAS/SMT options). */
function beaconLabel(beaconType: OperatorCohortDTO['beaconType']): string {
  return beaconType === 'CASBeacon' ? 'CAS' : 'SMT';
}

/**
 * One operator cohort row (SVC-01/SVC-02, D-16). A DRAFT shows a neutral `Draft` badge
 * plus the two-step actions: the primary `Advertise cohort` CTA (the only new accent
 * button, UI-SPEC) and `Discard draft` (danger, behind an inline confirm). An
 * ADVERTISED cohort shows the accent `Advertised` badge and its live `{joined}/{capacity}`
 * seats and carries no actions here (pause/cancel is Phase 5). Both render the network,
 * beacon type, and a copyable id.
 */
function CohortRow({ baseUrl, cohort }: { baseUrl: string; cohort: OperatorCohortDTO }) {
  const discard = useOperator((s) => s.discard);
  const advertise = useOperator((s) => s.advertise);
  const advertiseStatus = useOperator((s) => s.advertiseStatus);
  const advertisingId = useOperator((s) => s.advertisingId);
  const [confirming, setConfirming] = useState(false);

  const isDraft = cohort.state === 'draft';
  const isAdvertising = advertiseStatus === 'advertising' && advertisingId === cohort.draftId;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isDraft ? 'neutral' : 'accent'}>{isDraft ? 'Draft' : 'Advertised'}</Badge>
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
      </div>

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
