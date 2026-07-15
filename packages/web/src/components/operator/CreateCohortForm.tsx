import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, SectionTitle } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';
import { useParticipant } from '../../stores/participant';
import type { OperatorBeaconType } from '../../lib/operator';

/** Exact UI-SPEC validation string; the server returns the same copy on its 400. */
const SIZE_ERROR = 'Cohort size must be at least 1 signer.';
/** Exact signing-threshold validation string (byte-identical to the server, Decision 3). */
const THRESHOLD_ERROR = 'Signing threshold must be a whole number between 1 and the cohort size.';

const BEACON_OPTIONS: { value: OperatorBeaconType; label: string }[] = [
  { value: 'CASBeacon', label: 'CAS' },
  { value: 'SMTBeacon', label: 'SMT' },
];

/**
 * Create-a-cohort form (SVC-01, UI-SPEC, G-02-1). An authenticated operator picks a beacon
 * type (CAS/SMT) and TWO honest numbers: a cohort size n (seats; the n in n-of-n, the cohort
 * starts only once every seat fills) and a signing threshold k of n (the ADR-042 fallback
 * floor). The service's single active network is shown read-only as a Badge, NEVER an
 * editable control (D-10). The threshold defaults to the size (k = n, unanimous). Client
 * validation surfaces the exact UI-SPEC strings before the round-trip; the server's 400
 * message (identical copy) is rendered as the `formError` banner as a backstop. The Create
 * button is a non-destructive ghost - accent stays reserved for Advertise.
 */
export function CreateCohortForm({ baseUrl }: { baseUrl: string }) {
  const activeNetwork = useParticipant((s) => s.network);
  const createStatus = useOperator((s) => s.createStatus);
  const formError = useOperator((s) => s.formError);
  const submitDraft = useOperator((s) => s.submitDraft);

  const [beaconType, setBeaconType] = useState<OperatorBeaconType>('CASBeacon');
  const [sizeText, setSizeText] = useState('2');
  // The signing threshold k defaults to the size (k = n, unanimous) until the operator lowers it.
  const [thresholdText, setThresholdText] = useState('2');
  const [clientError, setClientError] = useState<string | undefined>(undefined);

  const creating = createStatus === 'creating';

  function submit() {
    const size = Number(sizeText);
    // n = seats = min === max === n on the server, so the client only guards the floor.
    if (!Number.isInteger(size) || size < 1) {
      setClientError(SIZE_ERROR);
      return;
    }
    // k = the signing threshold, a whole number in [1, size]; mirror the server guard exactly.
    const threshold = Number(thresholdText);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > size) {
      setClientError(THRESHOLD_ERROR);
      return;
    }
    setClientError(undefined);
    void submitDraft(baseUrl, { beaconType, size, threshold });
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

        <Field label="Cohort size (seats)" htmlFor="cohort-size">
          <Input
            id="cohort-size"
            type="number"
            value={sizeText}
            onChange={setSizeText}
            disabled={creating}
          />
          <p className="mt-1 text-xs text-faint">
            Everyone in the cohort co-signs together, so this is the number of seats and the n in n-of-n. The
            cohort starts only once every seat is filled.
          </p>
        </Field>

        <Field label="Signing threshold (k of n)" htmlFor="cohort-threshold">
          <Input
            id="cohort-threshold"
            type="number"
            value={thresholdText}
            onChange={setThresholdText}
            disabled={creating}
          />
          <p className="mt-1 text-xs text-faint">
            Everyone co-signs first. If a signer stalls, the cohort can still anchor as long as at least this
            many of the n seats sign. Set it equal to the size to require everyone.
          </p>
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
