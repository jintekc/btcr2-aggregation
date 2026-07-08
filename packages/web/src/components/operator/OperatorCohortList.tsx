import { useState } from 'react';
import { Badge, Button, Card, CopyField, SectionTitle } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';
import type { OperatorCohortDTO } from '../../lib/operator';

/** Friendly beacon-type label (matches the create form's CAS/SMT options). */
function beaconLabel(beaconType: OperatorCohortDTO['beaconType']): string {
  return beaconType === 'CASBeacon' ? 'CAS' : 'SMT';
}

/**
 * One operator cohort row (SVC-01/D-16). A draft shows a neutral `Draft` badge, its
 * network, beacon type, seats (`0/{capacity}` - nobody joins a draft), and a copyable
 * draft id. `Discard draft` (danger) removes it after an inline confirm using the exact
 * UI-SPEC confirmation copy. Advertised rows + the Advertise button arrive in plan 03.
 */
function CohortRow({ baseUrl, cohort }: { baseUrl: string; cohort: OperatorCohortDTO }) {
  const discard = useOperator((s) => s.discard);
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">Draft</Badge>
          <span className="text-sm text-muted">{cohort.network}</span>
          <span className="text-sm text-muted">{beaconLabel(cohort.beaconType)}</span>
          <span className="text-sm text-muted">
            {0}/{cohort.capacity} seats
          </span>
        </div>
        {confirming ? null : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Discard draft
          </Button>
        )}
      </div>

      <CopyField label="draft id" value={cohort.draftId} />

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
 * state uses the exact UI-SPEC heading + body. Each entry renders as a {@link CohortRow}.
 */
export function OperatorCohortList({ baseUrl }: { baseUrl: string }) {
  const cohorts = useOperator((s) => s.cohorts);

  return (
    <Card className="space-y-4 p-5">
      <SectionTitle>Your cohorts</SectionTitle>
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
