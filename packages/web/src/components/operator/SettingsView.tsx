import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, Select, SectionTitle, TextArea } from '../../ui/primitives';
import {
  BACK_TO_COHORTS,
  NEXT_COHORT_ONLY_LINE,
  SETTINGS_MODEL_LINE,
  TERMS_HONEST_LIMIT,
  useOperator,
} from '../../stores/operator';
import {
  msToMinutesText,
  parseWindow,
  validateCohortForm,
  type WindowValue,
} from '../../lib/cohort-form';
import { BEACON_OPTIONS } from './DraftEditForm';
import type { OperatorBeaconType, SettingFieldDTO, SettingsPatchDTO, SettingsSnapshotDTO } from '../../lib/operator';

/** The save control's label (ghost: a settings save is reversible, so it takes no ceremony). */
export const SAVE_SETTINGS_LABEL = 'Save settings';

/** The in-flight save label, the shipped create-form treatment verbatim. */
export const SAVE_SETTINGS_BUSY = 'Saving…';

/** The caption an untouched field carries: this value is still what the environment set at boot. */
export const SOURCE_ENV_DEFAULT = 'env default';

/** How an ABSENT boot value reads in a caption. An empty string would look like a chosen value. */
export const SOURCE_UNSET = 'not set';

/**
 * The per-setting source caption (D-12, UI-SPEC E8 populated).
 *
 * Two formats and no third: `env default` when the field still holds its boot value, and
 * `changed this session (environment default: {value})` when it does not. The caption CARRIES the
 * fact rather than reinforcing a colored badge, which is the point: an operator reading this
 * console needs to know which values will survive a restart, and a color cannot say that.
 *
 * `changed` comes from the SERVICE, never from a local comparison, so the caption is a fact the
 * service reported rather than a guess about a boot value this browser never saw.
 */
export function sourceCaption(changed: boolean, envDefaultText: string): string {
  return changed ? `changed this session (environment default: ${envDefaultText})` : SOURCE_ENV_DEFAULT;
}

/** A plain value's caption text; an absent boot value reads as {@link SOURCE_UNSET}. */
export function envDefaultText(value: string | number | undefined): string {
  return value === undefined || value === '' ? SOURCE_UNSET : String(value);
}

/** A window's caption text in the minutes the operator actually edits, or {@link SOURCE_UNSET}. */
export function windowEnvDefaultText(ms: number | undefined): string {
  return ms === undefined ? SOURCE_UNSET : `${msToMinutesText(ms)} min`;
}

/** The settings form's editable values, all held as the text the operator typed. */
export interface SettingsFormValues {
  serviceName: string;
  beaconType: OperatorBeaconType;
  sizeText: string;
  thresholdText: string;
  discoveryText: string;
  fundingText: string;
  termsText: string;
}

/** Seed the form from a served snapshot, so every field opens on what the SERVICE holds. */
export function formFromSnapshot(snapshot: SettingsSnapshotDTO): SettingsFormValues {
  return {
    serviceName: snapshot.serviceName.value ?? '',
    beaconType: snapshot.defaultBeaconType.value ?? 'CASBeacon',
    sizeText: String(snapshot.defaultSize.value ?? ''),
    thresholdText: String(snapshot.defaultThreshold.value ?? ''),
    discoveryText: msToMinutesText(snapshot.defaultDiscoveryWindowMs.value),
    fundingText: msToMinutesText(snapshot.defaultFundingWindowMs.value),
    termsText: snapshot.termsText.value ?? '',
  };
}

/**
 * Fold the form into ONE patch carrying every field the surface renders (D-12).
 *
 * Sending the whole set is what makes all-or-nothing meaningful: the service judges the values
 * together (k against the n in this same patch) and applies none of them on any rejection, so the
 * surface can never show a half-saved state.
 *
 * A window field cleared to empty sends an explicit `null` (clear this default) rather than
 * omitting the key, which would mean "leave it alone" and quietly ignore the operator's edit. The
 * two funding keys are omitted ENTIRELY on a non-broadcasting service, because that field is not
 * rendered there and a save must never carry a value the operator was never shown.
 */
export function settingsPatch(form: SettingsFormValues, broadcasts: boolean): SettingsPatchDTO {
  const discovery = parseWindow(form.discoveryText);
  const funding = parseWindow(form.fundingText);
  return {
    serviceName: form.serviceName,
    defaultBeaconType: form.beaconType,
    defaultSize: Number(form.sizeText),
    defaultThreshold: Number(form.thresholdText),
    defaultDiscoveryWindowMs: windowPatchValue(discovery),
    ...(broadcasts ? { defaultFundingWindowMs: windowPatchValue(funding) } : {}),
    termsText: form.termsText,
  };
}

/** An empty window field clears the default (`null`); a typed one sets it; an invalid one is
 * already refused by {@link validateCohortForm} before this runs. */
function windowPatchValue(value: WindowValue): number | null {
  return value.kind === 'ms' ? value.ms : null;
}

/**
 * The `Service settings` view (SVC-04 criterion 3 / SVC-05, 05-UI-SPEC E8): the third SPA-internal
 * console view, reached from the `Service controls` card and left by the same `Back to cohorts`
 * link the drill-down uses. No routed URL is introduced.
 *
 * Everything on this surface follows from two rules the plan exists to hold:
 *
 *  1. **Every value says where it came from.** Each field carries a source caption built from the
 *     SERVED `changed` bit plus the served boot value, so an operator can tell at a glance which
 *     settings survive a restart. The model line under the heading states the whole contract in
 *     words rather than leaving it to be inferred from the captions.
 *  2. **A save is all-or-nothing.** One request carries every field; the service validates the set
 *     and applies none on any rejection; and this component renders exclusively from the served
 *     snapshot, so a refused save leaves every field showing what the service still holds.
 *
 * Client validation reuses `lib/cohort-form` rather than re-typing the four strings, for the same
 * reason the two cohort forms share it: this surface validates the SAME numbers, so a rule enforced
 * on one form and not the other is exactly the drift a second copy produces. The service's own 400
 * renders in the same inline slot as a backstop.
 */
export function SettingsView({ baseUrl }: { baseUrl: string }) {
  const snapshot = useOperator((s) => s.settings);
  const status = useOperator((s) => s.settingsStatus);
  const serverError = useOperator((s) => s.settingsError);
  const message = useOperator((s) => s.settingsMessage);
  const loadSettings = useOperator((s) => s.loadSettings);
  const saveSettings = useOperator((s) => s.saveSettings);
  const closeSettings = useOperator((s) => s.closeSettings);
  // The SERVED broadcast mode: the funding-window default is a control over something a hermetic
  // service never does, so it is not rendered there at all (the AdvancedTiming precedent).
  const mode = useOperator((s) => s.health?.mode);
  const broadcasts = mode === 'live';

  const [form, setForm] = useState<SettingsFormValues | undefined>(
    snapshot ? formFromSnapshot(snapshot) : undefined,
  );
  const [clientError, setClientError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void loadSettings(baseUrl);
  }, [loadSettings, baseUrl]);

  // Re-seed the form whenever a NEW snapshot lands (the first read, and after every successful
  // save). This is what keeps a normalized value honest on screen: the service's trimmed name or
  // cleared terms replace what was typed, rather than the form continuing to show the input.
  useEffect(() => {
    if (snapshot) {
      setForm(formFromSnapshot(snapshot));
      setClientError(undefined);
    }
  }, [snapshot]);

  const saving = status === 'saving';
  const shownError = clientError ?? serverError;

  function update(patch: Partial<SettingsFormValues>): void {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function submit(): void {
    if (!form) {
      return;
    }
    const problem = validateCohortForm({
      size: Number(form.sizeText),
      threshold: Number(form.thresholdText),
      discovery: parseWindow(form.discoveryText),
      funding: broadcasts ? parseWindow(form.fundingText) : { kind: 'unset' },
    });
    if (problem) {
      setClientError(problem);
      return;
    }
    setClientError(undefined);
    void saveSettings(baseUrl, settingsPatch(form, broadcasts));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Heading, not Display: the landing `Operator console` heading keeps that size (UI-SPEC). */}
        <h1 className="text-xl font-semibold tracking-tight text-ink">Service settings</h1>
        <Button variant="ghost" onClick={() => closeSettings()}>
          {BACK_TO_COHORTS}
        </Button>
      </div>

      {/* The model, in words, directly under the heading. Nothing here persists, and an operator
          who is not told that would reasonably assume otherwise. */}
      <p className="text-sm text-muted">{SETTINGS_MODEL_LINE}</p>
      <p className="text-sm text-muted">{NEXT_COHORT_ONLY_LINE}</p>

      {form === undefined ? (
        <Card className="p-5">
          <p className="text-sm text-muted">Loading settings…</p>
        </Card>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Card className="space-y-4 p-5">
            <SectionTitle>This service</SectionTitle>

            <Field label="Service name" htmlFor="settings-service-name">
              <Input
                id="settings-service-name"
                value={form.serviceName}
                onChange={(value) => update({ serviceName: value })}
                disabled={saving}
              />
              <p className="mt-1 text-xs text-faint">
                Shown on the public directory and on this console. Leave it empty to show only this
                service&apos;s address.
              </p>
              <SourceCaption field={snapshot?.serviceName} text={envDefaultText(snapshot?.serviceName.envDefault)} />
            </Field>
          </Card>

          <Card className="space-y-4 p-5">
            <SectionTitle>New cohort defaults</SectionTitle>

            <Field label="Default beacon type" htmlFor="settings-beacon-type">
              <Select
                id="settings-beacon-type"
                value={form.beaconType}
                onChange={(value) => update({ beaconType: value })}
                options={BEACON_OPTIONS}
                disabled={saving}
              />
              <p className="mt-1 text-xs text-faint">
                The beacon type a new cohort starts with. You can still change it per cohort.
              </p>
              <SourceCaption
                field={snapshot?.defaultBeaconType}
                text={envDefaultText(snapshot?.defaultBeaconType.envDefault)}
              />
            </Field>

            <Field label="Default cohort size (n)" htmlFor="settings-size">
              <Input
                id="settings-size"
                type="number"
                value={form.sizeText}
                onChange={(value) => update({ sizeText: value })}
                disabled={saving}
              />
              {/* The shipped size help, reused verbatim so the two surfaces describe n identically. */}
              <p className="mt-1 text-xs text-faint">
                Everyone in the cohort co-signs together, so this is the number of seats and the n in n-of-n. The
                cohort starts only once every seat is filled.
              </p>
              <SourceCaption field={snapshot?.defaultSize} text={envDefaultText(snapshot?.defaultSize.envDefault)} />
            </Field>

            <Field label="Default signing threshold (k)" htmlFor="settings-threshold">
              <Input
                id="settings-threshold"
                type="number"
                value={form.thresholdText}
                onChange={(value) => update({ thresholdText: value })}
                disabled={saving}
              />
              {/* The shipped threshold help, reused verbatim for the same reason. */}
              <p className="mt-1 text-xs text-faint">
                Everyone co-signs first. If a signer stalls, the cohort can still anchor as long as at least this
                many of the n seats sign. Set it equal to the size to require everyone.
              </p>
              <SourceCaption
                field={snapshot?.defaultThreshold}
                text={envDefaultText(snapshot?.defaultThreshold.envDefault)}
              />
            </Field>

            <Field label="Default discovery window (minutes)" htmlFor="settings-discovery">
              <Input
                id="settings-discovery"
                type="number"
                value={form.discoveryText}
                onChange={(value) => update({ discoveryText: value })}
                disabled={saving}
              />
              <p className="mt-1 text-xs text-faint">
                How long a new cohort stays advertised before it expires.
              </p>
              <SourceCaption
                field={snapshot?.defaultDiscoveryWindowMs}
                text={windowEnvDefaultText(snapshot?.defaultDiscoveryWindowMs.envDefault)}
              />
            </Field>

            {/* Rendered only when the served mode actually broadcasts: a hermetic service never
                funds a beacon address, so tuning how long it waits would be a control over nothing. */}
            {broadcasts ? (
              <Field label="Default funding window (minutes)" htmlFor="settings-funding">
                <Input
                  id="settings-funding"
                  type="number"
                  value={form.fundingText}
                  onChange={(value) => update({ fundingText: value })}
                  disabled={saving}
                />
                <p className="mt-1 text-xs text-faint">
                  How long this service waits for a new cohort&apos;s beacon address to be funded.
                </p>
                <SourceCaption
                  field={snapshot?.defaultFundingWindowMs}
                  text={windowEnvDefaultText(snapshot?.defaultFundingWindowMs.envDefault)}
                />
              </Field>
            ) : null}
          </Card>

          <Card className="space-y-4 p-5">
            <SectionTitle>Participation terms</SectionTitle>

            <Field label="Participation terms" htmlFor="settings-terms">
              {/* Operator-supplied text. It reaches anonymous participants and renders there as
                  plain auto-escaped React text content ONLY: never markup, never a link target
                  (T-05-07-02). The same constraint applies at every render site downstream. */}
              <TextArea
                id="settings-terms"
                value={form.termsText}
                onChange={(value) => update({ termsText: value })}
                disabled={saving}
              />
              <p className="mt-1 text-xs text-faint">
                Leave empty for no terms step. When set, participants must accept these terms before joining, and
                their acceptance is recorded as a signed record.
              </p>
              <p className="mt-1 text-xs text-faint">{TERMS_HONEST_LIMIT}</p>
              <SourceCaption field={snapshot?.termsText} text={envDefaultText(snapshot?.termsText.envDefault)} />
            </Field>
          </Card>

          {shownError ? (
            <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{shownError}</p>
          ) : null}
          {message ? (
            <p className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">{message}</p>
          ) : null}

          <Button type="submit" variant="ghost" disabled={saving}>
            {saving ? SAVE_SETTINGS_BUSY : SAVE_SETTINGS_LABEL}
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * One field's source caption. Absent until a snapshot has landed: before the service has reported
 * a source, this says nothing rather than claiming the value is still the environment's.
 */
function SourceCaption({ field, text }: { field?: SettingFieldDTO<unknown>; text: string }) {
  if (!field) {
    return null;
  }
  return <p className="mt-1 text-xs uppercase tracking-[0.14em] text-faint">{sourceCaption(field.changed, text)}</p>;
}
