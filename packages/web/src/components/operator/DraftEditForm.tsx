import { useState } from 'react';
import { Badge, Button, Card, Expander, Field, Input, Select, SectionTitle } from '../../ui/primitives';
import { NEXT_COHORT_ONLY_LINE, useOperator } from '../../stores/operator';
import {
  clampDisclosure,
  discoveryWindowHelp,
  effectiveMs,
  fundingWindowHelp,
  msToMinutesText,
  parseWindow,
  validateCohortForm,
  windowKeys,
} from '../../lib/cohort-form';
import type { OperatorBeaconType, OperatorCohortDTO, ServiceMode } from '../../lib/operator';

/** The beacon options both cohort forms offer, in the same order (CAS first). */
export const BEACON_OPTIONS: { value: OperatorBeaconType; label: string }[] = [
  { value: 'CASBeacon', label: 'CAS' },
  { value: 'SMTBeacon', label: 'SMT' },
];

/**
 * The shared `Advanced timing` disclosure (D-11, UI-SPEC E7), rendered by BOTH the create form and
 * the draft-edit form so the two can never drift in copy, units, or validation.
 *
 * Both fields render EMPTY by default and their help names this service's own default, because
 * empty has to read as "use the default" and never as "no window at all". The funding field
 * appears only when the served mode actually broadcasts: a hermetic service never funds a beacon
 * address, so offering to tune how long it waits for funding would be a control over nothing.
 *
 * Every string comes from `lib/cohort-form` rather than being assembled inline here. That is
 * deliberate: this copy is a contract with the UI-SPEC, and copy assembled from a JSX text node
 * plus a conditional fragment is copy nothing can assert.
 */
export function AdvancedTiming({
  discoveryText,
  onDiscoveryText,
  fundingText,
  onFundingText,
  defaultDiscoveryWindowMs,
  defaultFundingWindowMs,
  mode,
  disabled,
  idPrefix,
}: {
  discoveryText: string;
  onDiscoveryText: (value: string) => void;
  fundingText: string;
  onFundingText: (value: string) => void;
  defaultDiscoveryWindowMs?: number;
  defaultFundingWindowMs?: number;
  /** The SERVED broadcast mode; the funding field renders only for a broadcasting service. */
  mode?: ServiceMode;
  disabled: boolean;
  /** Distinguishes the create form's field ids from the edit form's when both are on screen. */
  idPrefix: string;
}) {
  const broadcasts = mode === 'live';
  const discovery = parseWindow(discoveryText);
  const funding = parseWindow(fundingText);

  // The preserved 04 D-38 clamp disclosure, computed from the EFFECTIVE windows (what the operator
  // typed, else this service's default) so it discloses what will really happen rather than only
  // reacting to explicitly typed values.
  const clamp = clampDisclosure(
    effectiveMs(discovery, defaultDiscoveryWindowMs),
    effectiveMs(funding, defaultFundingWindowMs),
  );

  return (
    <Expander title="Advanced timing">
      <div className="space-y-4">
        <Field label="Discovery window (minutes)" htmlFor={`${idPrefix}-discovery-window`}>
          <Input
            id={`${idPrefix}-discovery-window`}
            type="number"
            value={discoveryText}
            onChange={onDiscoveryText}
            disabled={disabled}
          />
          <p className="mt-1 text-xs text-faint">{discoveryWindowHelp(defaultDiscoveryWindowMs)}</p>
        </Field>

        {broadcasts ? (
          <Field label="Funding window (minutes)" htmlFor={`${idPrefix}-funding-window`}>
            <Input
              id={`${idPrefix}-funding-window`}
              type="number"
              value={fundingText}
              onChange={onFundingText}
              disabled={disabled}
            />
            <p className="mt-1 text-xs text-faint">{fundingWindowHelp(defaultFundingWindowMs)}</p>
            {clamp ? <p className="mt-1 text-xs text-faint">{clamp}</p> : null}
          </Field>
        ) : null}
      </div>
    </Expander>
  );
}

/**
 * The in-place draft edit form (SVC-04 criterion 3, D-10/D-11, UI-SPEC E6/E7). It composes the same
 * field set, validation strings, and rhythm as `CreateCohortForm` (`space-y-4` inside a `p-5` card,
 * the read-only network `Badge`, the shared `Field` plus help-caption structure) because the two
 * forms shape the same thing: an operator who has used one already knows this one.
 *
 * It ALWAYS opens pre-filled from the draft's current values. There is no blank-form path, and
 * there cannot be: the component takes the draft itself, so every required field has a value
 * before the first render. The two timing fields are the deliberate exception, because they render
 * empty when the operator never set one, and empty is exactly what "use this service's default"
 * looks like (UI-SPEC E7 empty).
 *
 * `Cancel edit` closes the form and nothing else. Discarding remains the shipped `Discard draft`
 * danger action on the row: a button reading `Cancel` must never destroy anything.
 */
export function DraftEditForm({ baseUrl, draft }: { baseUrl: string; draft: OperatorCohortDTO }) {
  const editStatus = useOperator((s) => s.editStatus);
  const editError = useOperator((s) => s.editError);
  const saveDraftEdit = useOperator((s) => s.saveDraftEdit);
  const cancelEdit = useOperator((s) => s.cancelEdit);
  const mode = useOperator((s) => s.health?.mode);

  // Pre-filled from the draft's CURRENT values, so editing one field leaves every other exactly
  // where the service has it (UI-SPEC E6 partial).
  const [beaconType, setBeaconType] = useState<OperatorBeaconType>(draft.beaconType);
  const [sizeText, setSizeText] = useState(String(draft.capacity));
  const [thresholdText, setThresholdText] = useState(String(draft.threshold));
  const [discoveryText, setDiscoveryText] = useState(msToMinutesText(draft.discoveryWindowMs));
  const [fundingText, setFundingText] = useState(msToMinutesText(draft.fundingWindowMs));
  const [clientError, setClientError] = useState<string | undefined>(undefined);

  const saving = editStatus === 'saving';

  function submit() {
    const discovery = parseWindow(discoveryText);
    const funding = parseWindow(fundingText);
    const size = Number(sizeText);
    const threshold = Number(thresholdText);
    const problem = validateCohortForm({ size, threshold, discovery, funding });
    if (problem) {
      setClientError(problem);
      return;
    }
    setClientError(undefined);
    void saveDraftEdit(baseUrl, draft.draftId, {
      beaconType,
      size,
      threshold,
      ...windowKeys(discovery, funding),
    });
  }

  // The client validation message when present, else the service's own refusal, in ONE slot.
  const shownError = clientError ?? editError;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>Edit draft</SectionTitle>
        {/* The draft's OWN network, read-only exactly as on the create form (D-10). */}
        <Badge tone="neutral">Network: {draft.network}</Badge>
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Beacon type" htmlFor="edit-beacon-type">
          <Select
            id="edit-beacon-type"
            value={beaconType}
            onChange={setBeaconType}
            options={BEACON_OPTIONS}
            disabled={saving}
          />
        </Field>

        {/* Same field order as the create form (threshold first, size second): a UAT-confirmed
            operator preference, and the two forms must not disagree about it. */}
        <Field label="Signing threshold (k)" htmlFor="edit-threshold">
          <Input id="edit-threshold" type="number" value={thresholdText} onChange={setThresholdText} disabled={saving} />
          <p className="mt-1 text-xs text-faint">
            Everyone co-signs first. If a signer stalls, the cohort can still anchor as long as at least this
            many of the n seats sign. Set it equal to the size to require everyone.
          </p>
        </Field>

        <Field label="Cohort size (n)" htmlFor="edit-size">
          <Input id="edit-size" type="number" value={sizeText} onChange={setSizeText} disabled={saving} />
          <p className="mt-1 text-xs text-faint">
            Everyone in the cohort co-signs together, so this is the number of seats and the n in n-of-n. The
            cohort starts only once every seat is filled.
          </p>
        </Field>

        {/* The draft's OWN captured defaults, not the service's current ones: this draft will use
            what it was created with, so the help must name that (D-13). */}
        <AdvancedTiming
          discoveryText={discoveryText}
          onDiscoveryText={setDiscoveryText}
          fundingText={fundingText}
          onFundingText={setFundingText}
          defaultDiscoveryWindowMs={draft.defaultDiscoveryWindowMs}
          defaultFundingWindowMs={draft.defaultFundingWindowMs}
          mode={mode}
          disabled={saving}
          idPrefix="edit"
        />

        <p className="text-xs text-faint">{NEXT_COHORT_ONLY_LINE}</p>

        {shownError ? (
          <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{shownError}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="ghost" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={() => cancelEdit()}>
            Cancel edit
          </Button>
        </div>
      </form>
    </Card>
  );
}
