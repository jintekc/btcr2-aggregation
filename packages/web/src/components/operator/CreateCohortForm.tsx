import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, SectionTitle } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';
import { useParticipant } from '../../stores/participant';
import type { OperatorBeaconType } from '../../lib/operator';

/** Exact UI-SPEC validation strings; the server returns the same copy on its 400. */
const THRESHOLD_ERROR = 'Threshold must be at least 1 signer.';
const CAPACITY_ERROR = 'Capacity must be at least the co-sign threshold.';

const BEACON_OPTIONS: { value: OperatorBeaconType; label: string }[] = [
  { value: 'CASBeacon', label: 'CAS' },
  { value: 'SMTBeacon', label: 'SMT' },
];

/**
 * Create-a-cohort form (SVC-01, UI-SPEC). An authenticated operator picks a beacon type
 * (CAS/SMT), an n-of-n co-sign threshold, and a seat capacity; the service's single
 * active network is shown read-only as a Badge, NEVER an editable control (D-10). Client
 * validation surfaces the exact UI-SPEC strings before the round-trip; the server's 400
 * message (identical copy) is rendered as the `formError` banner as a backstop. The
 * Create button is a non-destructive ghost - accent stays reserved for Advertise (plan 03).
 */
export function CreateCohortForm({ baseUrl }: { baseUrl: string }) {
  const activeNetwork = useParticipant((s) => s.network);
  const createStatus = useOperator((s) => s.createStatus);
  const formError = useOperator((s) => s.formError);
  const submitDraft = useOperator((s) => s.submitDraft);

  const [beaconType, setBeaconType] = useState<OperatorBeaconType>('CASBeacon');
  const [thresholdText, setThresholdText] = useState('2');
  const [capacityText, setCapacityText] = useState('2');
  const [clientError, setClientError] = useState<string | undefined>(undefined);

  const creating = createStatus === 'creating';

  function submit() {
    const threshold = Number(thresholdText);
    const capacity = Number(capacityText);
    // Mirror the server guard-clause order so the operator sees the same message.
    if (!Number.isInteger(threshold) || threshold < 1) {
      setClientError(THRESHOLD_ERROR);
      return;
    }
    if (!Number.isInteger(capacity) || capacity < threshold) {
      setClientError(CAPACITY_ERROR);
      return;
    }
    setClientError(undefined);
    void submitDraft(baseUrl, { beaconType, threshold, capacity });
  }

  // Show the client validation message if present, else the server's 400 message.
  const shownError = clientError ?? formError;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>Create a cohort</SectionTitle>
        <Badge tone="neutral">Network: {activeNetwork}</Badge>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Beacon type" htmlFor="cohort-beacon-type">
          <Select
            id="cohort-beacon-type"
            value={beaconType}
            onChange={setBeaconType}
            options={BEACON_OPTIONS}
            disabled={creating}
          />
        </Field>

        <Field label="Co-sign threshold (n-of-n)" htmlFor="cohort-threshold">
          <Input
            id="cohort-threshold"
            type="number"
            value={thresholdText}
            onChange={setThresholdText}
            disabled={creating}
          />
        </Field>

        <Field label="Capacity (max seats)" htmlFor="cohort-capacity">
          <Input
            id="cohort-capacity"
            type="number"
            value={capacityText}
            onChange={setCapacityText}
            disabled={creating}
          />
        </Field>

        {shownError ? (
          <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{shownError}</p>
        ) : null}

        <Button type="submit" variant="ghost" disabled={creating}>
          {creating ? 'Creating…' : 'Create draft'}
        </Button>
      </form>
    </Card>
  );
}
