import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, SectionTitle } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';
import { useParticipant } from '../../stores/participant';
import { AdvancedTiming, BEACON_OPTIONS } from './DraftEditForm';
import { parseWindow, validateCohortForm, windowKeys } from '../../lib/cohort-form';
import type { OperatorBeaconType, SettingsSnapshotDTO } from '../../lib/operator';

/**
 * The shape a cohort form falls back to when this service has not (yet) told us its own defaults.
 *
 * These are the literals this form has always shipped with. They stay ONLY as a fallback so the
 * form is never blank on first paint: a form that renders empty fields while a read is in flight
 * invites an operator to type over values that are about to arrive.
 */
export const SHIPPED_BEACON_TYPE: OperatorBeaconType = 'CASBeacon';
export const SHIPPED_SIZE_TEXT = '2';
export const SHIPPED_THRESHOLD_TEXT = '2';

/**
 * Resolve the create form's opening shape (SVC-04 criterion 3, D-12/D-13).
 *
 * A new cohort must start from the defaults the operator set on THIS running service, not from
 * literals compiled into the browser bundle: the whole point of the settings surface is that an
 * operator stops having to restate their own defaults on every create. When no snapshot has landed
 * the shipped literals stand in, so the form never claims a default it has not received and never
 * renders blank while the read is in flight (UI-SPEC E8 empty).
 *
 * Pure and exported so the preference order is asserted by a unit test rather than by opening the
 * console and squinting at a number.
 */
export function createFormDefaults(snapshot?: SettingsSnapshotDTO): {
  beaconType: OperatorBeaconType;
  sizeText: string;
  thresholdText: string;
} {
  return {
    beaconType: snapshot?.defaultBeaconType.value ?? SHIPPED_BEACON_TYPE,
    sizeText: snapshot?.defaultSize.value !== undefined ? String(snapshot.defaultSize.value) : SHIPPED_SIZE_TEXT,
    thresholdText:
      snapshot?.defaultThreshold.value !== undefined
        ? String(snapshot.defaultThreshold.value)
        : SHIPPED_THRESHOLD_TEXT,
  };
}

/**
 * Create-a-cohort form (SVC-01, UI-SPEC, G-02-1). An authenticated operator picks a beacon
 * type (CAS/SMT) and TWO honest numbers: a cohort size n (seats; the n in n-of-n, the cohort
 * starts only once every seat fills) and a signing threshold k of n (the ADR-042 fallback
 * floor). The service's single active network is shown read-only as a Badge, NEVER an
 * editable control (D-10). The threshold defaults to the size (k = n, unanimous). Client
 * validation surfaces the exact UI-SPEC strings before the round-trip; the server's 400
 * message (identical copy) is rendered as the `formError` banner as a backstop. The Create
 * button is a non-destructive ghost - accent stays reserved for Advertise.
 *
 * Phase 5 (D-11) adds the optional `Advanced timing` expander, shared verbatim with the draft-edit
 * form. Its two windows are optional: an empty field means "use this service's default", so the
 * common case is unchanged and an operator who never opens the expander creates exactly the cohort
 * they always did.
 */
export function CreateCohortForm({ baseUrl }: { baseUrl: string }) {
  const activeNetwork = useParticipant((s) => s.network);
  const createStatus = useOperator((s) => s.createStatus);
  const formError = useOperator((s) => s.formError);
  const submitDraft = useOperator((s) => s.submitDraft);
  const mode = useOperator((s) => s.health?.mode);
  // This service's CURRENT defaults (D-11). A cohort that does not exist yet has no captured
  // defaults of its own, so the help names what a draft created right now would inherit.
  const defaults = useOperator((s) => s.defaults);
  // This service's CURRENT shape defaults, loaded once by the console shell. The form opens on
  // them rather than on bundle literals, which is the operator-facing half of D-13: a settings
  // change reshapes the NEXT cohort, and this is where "next" begins.
  const settings = useOperator((s) => s.settings);

  const seed = createFormDefaults(settings);
  const [beaconType, setBeaconType] = useState<OperatorBeaconType>(seed.beaconType);
  const [sizeText, setSizeText] = useState(seed.sizeText);
  // The signing threshold k defaults to the size (k = n, unanimous) until the operator lowers it.
  const [thresholdText, setThresholdText] = useState(seed.thresholdText);
  // Both timing fields start EMPTY, which is what "use this service's default" looks like (D-11).
  // They are DELIBERATELY not pre-filled from the served defaults: an empty field means "inherit",
  // and a field pre-filled with the default figure would submit that number EXPLICITLY, freezing
  // this cohort's window at today's value even if the service default moves. The help below names
  // the real served figure instead, so the operator sees the number without committing to it.
  const [discoveryText, setDiscoveryText] = useState('');
  const [fundingText, setFundingText] = useState('');
  const [clientError, setClientError] = useState<string | undefined>(undefined);
  // Track which snapshot the fields were seeded from, so a snapshot ARRIVING (or changing, after a
  // settings save) re-seeds an untouched form exactly once instead of overwriting live typing on
  // every render.
  const [seededFrom, setSeededFrom] = useState<SettingsSnapshotDTO | undefined>(settings);

  useEffect(() => {
    if (settings !== seededFrom) {
      const next = createFormDefaults(settings);
      setBeaconType(next.beaconType);
      setSizeText(next.sizeText);
      setThresholdText(next.thresholdText);
      setSeededFrom(settings);
    }
  }, [settings, seededFrom]);

  const creating = createStatus === 'creating';

  function submit() {
    const discovery = parseWindow(discoveryText);
    const funding = parseWindow(fundingText);
    const size = Number(sizeText);
    const threshold = Number(thresholdText);
    // ONE shared validator with the draft-edit form (D-10): a rule enforced on create but not on
    // edit is exactly the drift this plan exists to prevent, and two copies is how it happens.
    const problem = validateCohortForm({ size, threshold, discovery, funding });
    if (problem) {
      setClientError(problem);
      return;
    }
    setClientError(undefined);
    void submitDraft(baseUrl, { beaconType, size, threshold, ...windowKeys(discovery, funding) });
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

        {/* Field order is a UAT-confirmed operator preference: threshold (k) first, size (n) second. */}
        <Field label="Signing threshold (k)" htmlFor="cohort-threshold">
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

        <Field label="Cohort size (n)" htmlFor="cohort-size">
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

        <AdvancedTiming
          discoveryText={discoveryText}
          onDiscoveryText={setDiscoveryText}
          fundingText={fundingText}
          onFundingText={setFundingText}
          defaultDiscoveryWindowMs={defaults?.discoveryWindowMs}
          defaultFundingWindowMs={defaults?.fundingWindowMs}
          mode={mode}
          disabled={creating}
          idPrefix="create"
        />

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
