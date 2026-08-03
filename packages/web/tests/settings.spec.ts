import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  droppedSeedCaption,
  droppedSeedFor,
  envDefaultText,
  formFromSnapshot,
  settingsPatch,
  sourceCaption,
  windowEnvDefaultText,
  REFUSED_SEEDS,
  SAVE_SETTINGS_BUSY,
  SAVE_SETTINGS_LABEL,
  SOURCE_ENV_DEFAULT,
  SOURCE_UNSET,
  SourceCaption,
} from '../src/components/operator/SettingsView';
import { renderStatic } from './support/render';
import {
  createFormDefaults,
  SHIPPED_BEACON_TYPE,
  SHIPPED_SIZE_TEXT,
  SHIPPED_THRESHOLD_TEXT,
} from '../src/components/operator/CreateCohortForm';
import {
  SETTINGS_MODEL_LINE,
  SETTINGS_SAVED_OK,
  TERMS_HONEST_LIMIT,
  TERMS_RETENTION_NOTE,
  useOperator,
} from '../src/stores/operator';
import type { SettingsSnapshotDTO } from '../src/lib/operator';

/**
 * SVC-04 criterion 3 / SVC-05 settings coverage (05-07, D-12/D-13/D-16/D-19).
 *
 * The honesty this surface has to hold is a property of pure functions plus one store rule, so it
 * is proven here without a DOM (the 05-05 `serviceControlsView` precedent):
 *
 *  1. Every value says where it came from, in exactly two documented formats.
 *  2. The minute fields the operator edits convert to the millisecond wire values, and a cleared
 *     one sends an explicit `null` rather than silently omitting the operator's edit.
 *  3. A REJECTED save leaves the rendered snapshot exactly as the service still holds it. That is
 *     the whole all-or-nothing contract from the browser's side: the store writes no field on a
 *     rejection, so there is nothing to roll back and nothing half-saved to display.
 */

const ONE_MINUTE_MS = 60_000;
const BASE = 'http://svc.test';

/**
 * The character house style forbids in authored copy, spelled as an ESCAPE and once, following the
 * 05-22 precedent in `service-controls.spec.ts`. A guard that must contain the character it forbids
 * reads as a violation to every repo-wide scan that looks, which is what kept this file on the list
 * (`05-35-PLAN.md` task 2 acceptance). The comparison below is byte-identical, so the assertion did
 * not change meaning.
 */
const LONG_DASH = '\u2014';

/** A served snapshot with every field untouched, matching the shape `snapshot()` serves. */
const UNTOUCHED: SettingsSnapshotDTO = {
  serviceName: { value: 'Acme Aggregation', envDefault: 'Acme Aggregation', changed: false },
  defaultBeaconType: { value: 'CASBeacon', envDefault: 'CASBeacon', changed: false },
  defaultSize: { value: 2, envDefault: 2, changed: false },
  defaultThreshold: { value: 2, envDefault: 2, changed: false },
  defaultDiscoveryWindowMs: { value: 30 * ONE_MINUTE_MS, envDefault: 30 * ONE_MINUTE_MS, changed: false },
  defaultFundingWindowMs: { value: 10 * ONE_MINUTE_MS, envDefault: 10 * ONE_MINUTE_MS, changed: false },
  termsText: { changed: false },
};

describe('the per-setting source caption has exactly three formats (D-12, UI-SPEC E8)', () => {
  it('reads `env default` for an untouched field', () => {
    expect(sourceCaption(false, 'Acme Aggregation')).toBe(SOURCE_ENV_DEFAULT);
    expect(SOURCE_ENV_DEFAULT).toBe('env default');
  });

  it('names the ENVIRONMENT default, not the current value, for a changed field', () => {
    // The caption exists to answer one question: what does this become on restart. Naming the
    // current value would answer a question the operator can already see the answer to.
    expect(sourceCaption(true, 'Acme Aggregation')).toBe(
      'changed this session (environment default: Acme Aggregation)',
    );
  });

  it('reads an ABSENT boot value as `not set` rather than as an empty value', () => {
    // An empty string in the caption would look like a value the operator chose. The two are
    // different facts: "the environment set nothing" is not "the environment set nothing at all".
    expect(envDefaultText(undefined)).toBe(SOURCE_UNSET);
    expect(envDefaultText('')).toBe(SOURCE_UNSET);
    expect(sourceCaption(true, envDefaultText(undefined))).toBe(
      'changed this session (environment default: not set)',
    );
  });

  it('renders a window boot value in the MINUTES the operator edits, never raw milliseconds', () => {
    expect(windowEnvDefaultText(30 * ONE_MINUTE_MS)).toBe('30 min');
    expect(windowEnvDefaultText(undefined)).toBe(SOURCE_UNSET);
  });

  it('carries the fact in words, so no colored badge is needed to read it', () => {
    // Both formats are complete sentences about the source. Nothing in either depends on a tone,
    // which is the UI-SPEC rule for this surface.
    for (const caption of [sourceCaption(false, '2'), sourceCaption(true, '2')]) {
      expect(caption.length).toBeGreaterThan(0);
      expect(caption).not.toMatch(/badge|color/i);
    }
  });

  /*
   * THE THIRD FORMAT (`05-REVIEW.md` WR-07). A boot seed this service REFUSED as too long is
   * dropped rather than truncated, which is right, and the field then holds undefined for both its
   * value and its boot value: `changed` is false and the two formats above caption the emptiness as
   * `env default`. That tells the operator the environment set nothing when the environment set a
   * hundred thousand characters, and for the terms the drop also turns the SVC-05 acceptance gate
   * off. The rows below are asserted against the caption the COMPONENT produces, because the data
   * behind it was already correct and it was the caption that lied.
   */

  it('names the refused VARIABLE and what the refusal COST, for each of the two free-text fields', () => {
    // Both halves. The variable alone leaves an operator knowing something was refused and not what
    // it disabled, which is the whole difference between the terms field and the display name.
    // The cost is asserted as the WHOLE member rather than as a fragment of it, so a rewrite that
    // drops half a cost clause out of the composed line goes red here (review WR-10 split the cost
    // from the remedy, and this row is what holds the cost half in the rendered sentence).
    expect(droppedSeedCaption(REFUSED_SEEDS.termsText)).toContain('TERMS_TEXT');
    expect(droppedSeedCaption(REFUSED_SEEDS.termsText)).toContain('no terms step');
    expect(droppedSeedCaption(REFUSED_SEEDS.termsText)).toContain(REFUSED_SEEDS.termsText.cost);
    expect(droppedSeedCaption(REFUSED_SEEDS.serviceName)).toContain('SERVICE_NAME');
    expect(droppedSeedCaption(REFUSED_SEEDS.serviceName)).toContain('display name');
    expect(droppedSeedCaption(REFUSED_SEEDS.serviceName)).toContain(REFUSED_SEEDS.serviceName.cost);
    // The cost copy is per field rather than one generic sentence, so the smaller loss is not
    // dressed in the larger one's words.
    expect(REFUSED_SEEDS.termsText.cost).not.toBe(REFUSED_SEEDS.serviceName.cost);
  });

  it('THE PIN: neither cost sentence claims a restart is required (review WR-10)', () => {
    // Asserted over each COST member, deliberately NOT over the composed caption. The caption
    // legitimately names a restart in its remedy half (shorten the seed so a restart keeps the
    // repair), so a pin over the whole sentence could only pass vacuously or forbid the true half.
    // The narrow assertion is the one that carries the property: what a refusal costs RIGHT NOW
    // cannot be stated in terms of restarting, because a restart is not what repairs it. Every
    // value on this surface is repairable in the running session, which is what the model line two
    // cards above the caption already tells the operator.
    for (const seed of [REFUSED_SEEDS.serviceName, REFUSED_SEEDS.termsText]) {
      expect(seed.cost).not.toMatch(/restart/i);
    }
  });

  it('names BOTH repair paths: the one available in this session and the one a restart needs', () => {
    // A remedy naming only the in-session repair would leave the operator running a service that
    // reverts to the refusal on its next boot. A remedy naming only the environment edit is exactly
    // the claim WR-10 was filed about. Both halves, per field, in that order.
    for (const seed of [REFUSED_SEEDS.serviceName, REFUSED_SEEDS.termsText]) {
      expect(seed.remedy).toContain('this session');
      expect(seed.remedy).toContain(seed.variable);
      expect(seed.remedy).toMatch(/restart/i);
      // The remedy reaches the rendered line, not just the record.
      expect(droppedSeedCaption(seed)).toContain(seed.remedy);
    }
  });

  it('keeps the terms remedy about the acceptance gate and the name remedy about the label', () => {
    // The two costs were already deliberately different sentences; the two remedies stay different
    // for the same reason. Restoring the terms turns an enforcement control back on. Restoring the
    // display name restores a label.
    expect(REFUSED_SEEDS.termsText.remedy).toContain('acceptance');
    expect(REFUSED_SEEDS.serviceName.remedy).not.toContain('acceptance');
    expect(REFUSED_SEEDS.termsText.remedy).not.toBe(REFUSED_SEEDS.serviceName.remedy);
  });

  it('THE PIN: a field whose seed was refused can never render the environment-default caption', () => {
    const markup = renderStatic(
      createElement(SourceCaption, {
        field: { changed: false },
        text: SOURCE_UNSET,
        dropped: REFUSED_SEEDS.termsText,
      }),
    );
    expect(markup).not.toContain(SOURCE_ENV_DEFAULT);
    expect(markup).toContain('TERMS_TEXT');
    expect(markup).toContain('no terms step');
    // Rendered in the bad tone this surface already uses for its error paragraph, so the line reads
    // as something to act on rather than as another grey caption.
    expect(markup).toContain('text-bad');
  });

  it('leaves a field NOT in the refused list rendering exactly what it renders today', () => {
    // The anti-vacuity control for this block: without it a component that rendered the refused
    // caption unconditionally would satisfy the pin above.
    const markup = renderStatic(
      createElement(SourceCaption, { field: { changed: false }, text: 'Acme Aggregation' }),
    );
    expect(markup).toContain(SOURCE_ENV_DEFAULT);
    expect(markup).not.toContain('text-bad');
    expect(markup).not.toContain('TERMS_TEXT');
  });

  it('gives a field the operator has CHANGED this session its changed caption, refusal or not', () => {
    // The precedence decision, pinned because the opposite is defensible: a changed field holds a
    // value the operator chose, so the refusal is history about a boot value nothing now renders.
    const markup = renderStatic(
      createElement(SourceCaption, {
        field: { changed: true },
        text: SOURCE_UNSET,
        dropped: REFUSED_SEEDS.termsText,
      }),
    );
    expect(markup).toContain('changed this session');
    expect(markup).not.toContain('TERMS_TEXT');
  });

  it('reads a service that serves NO refused list as none refused, never as unknown', () => {
    // An older service, or any clean boot, must render exactly today's captions. The middle
    // assertion is what proves the lookup reaches the served list at all.
    expect(droppedSeedFor(UNTOUCHED, 'termsText')).toBeUndefined();
    expect(droppedSeedFor({ ...UNTOUCHED, droppedSeeds: ['TERMS_TEXT'] }, 'termsText')).toEqual(
      REFUSED_SEEDS.termsText,
    );
    // A refusal on one field says nothing about the other.
    expect(droppedSeedFor({ ...UNTOUCHED, droppedSeeds: ['TERMS_TEXT'] }, 'serviceName')).toBeUndefined();
    expect(droppedSeedFor(undefined, 'termsText')).toBeUndefined();
  });

  it('still renders NOTHING before a snapshot has landed, refused list or not', () => {
    // The component's existing deliberate behavior, which the new branch must not reach past:
    // before the service has reported anything, saying nothing is still the honest posture.
    expect(
      renderStatic(createElement(SourceCaption, { text: SOURCE_UNSET, dropped: REFUSED_SEEDS.termsText })),
    ).toBe('');
  });
});

describe('the form seeds from the served snapshot and converts minutes on the wire', () => {
  it('opens every field on what the service holds, windows as minutes text', () => {
    const form = formFromSnapshot(UNTOUCHED);
    expect(form).toEqual({
      serviceName: 'Acme Aggregation',
      beaconType: 'CASBeacon',
      sizeText: '2',
      thresholdText: '2',
      discoveryText: '30',
      fundingText: '10',
      termsText: '',
    });
  });

  it('converts the minute fields back to milliseconds and posts every field together', () => {
    const patch = settingsPatch(
      {
        serviceName: 'Acme (maintenance)',
        beaconType: 'SMTBeacon',
        sizeText: '4',
        thresholdText: '3',
        discoveryText: '15',
        fundingText: '5',
        termsText: 'Be excellent to each other.',
      },
      true,
    );
    expect(patch).toEqual({
      serviceName: 'Acme (maintenance)',
      defaultBeaconType: 'SMTBeacon',
      defaultSize: 4,
      defaultThreshold: 3,
      defaultDiscoveryWindowMs: 15 * ONE_MINUTE_MS,
      defaultFundingWindowMs: 5 * ONE_MINUTE_MS,
      termsText: 'Be excellent to each other.',
    });
  });

  it('sends an explicit null for a CLEARED window rather than omitting the operator edit', () => {
    // An omitted key means "leave this one alone" on the wire, so omitting a cleared field would
    // silently discard the edit and the form would re-render the old value as though nothing was
    // typed. Null says what the operator meant.
    const patch = settingsPatch(
      {
        serviceName: '',
        beaconType: 'CASBeacon',
        sizeText: '2',
        thresholdText: '2',
        discoveryText: '  ',
        fundingText: '',
        termsText: '',
      },
      true,
    );
    expect(patch.defaultDiscoveryWindowMs).toBeNull();
    expect(patch.defaultFundingWindowMs).toBeNull();
    // An emptied optional text field is sent as an empty string, which the service reads as CLEAR.
    expect(patch.serviceName).toBe('');
    expect(patch.termsText).toBe('');
  });

  it('omits the funding key entirely on a service that does not broadcast', () => {
    // The field is not rendered there, and a save must never carry a value the operator was never
    // shown, let alone one the service has no use for.
    const patch = settingsPatch(
      {
        serviceName: '',
        beaconType: 'CASBeacon',
        sizeText: '2',
        thresholdText: '2',
        discoveryText: '30',
        fundingText: '99',
        termsText: '',
      },
      false,
    );
    expect('defaultFundingWindowMs' in patch).toBe(false);
  });
});

describe('the settings copy is the UI-SPEC contract, free of the long dash', () => {
  it('states the model in words under the heading', () => {
    expect(SETTINGS_MODEL_LINE).toBe(
      'Environment variables set these at boot. Changes here apply to this running service only, and a restart returns every value to its environment default.',
    );
  });

  it('states the honest limit on participation terms (SVC-05)', () => {
    expect(TERMS_HONEST_LIMIT).toBe(
      'These terms are enforced in this web app. A client that speaks the protocol directly can still opt in without accepting them.',
    );
  });

  it('states the honest limit on RETAINED acceptances (SVC-05, T-05-17-05/07)', () => {
    // The acceptance namespace is bounded oldest-first, so two things are true that an operator
    // would otherwise learn only from a confused participant: a re-acceptance replaces rather than
    // adds, and past the bound the oldest record is dropped, so a hash a participant is holding can
    // stop resolving. Disclosed on the setting itself rather than left to the source comments.
    expect(TERMS_RETENTION_NOTE).toBe(
      'Acceptances are kept in memory on this service and a restart clears them. Only the most recent few hundred are retained, oldest dropped first, and re-accepting for the same cohort replaces the earlier record.',
    );
  });

  it('uses the shipped in-flight button treatment', () => {
    expect(SAVE_SETTINGS_LABEL).toBe('Save settings');
    expect(SAVE_SETTINGS_BUSY).toBe('Saving…');
  });

  it('contains no em-dash in any authored settings string', () => {
    // Em-dashes in authored copy propagate straight into shipped UI strings; guard at the source.
    for (const copy of [
      SETTINGS_MODEL_LINE,
      SETTINGS_SAVED_OK,
      TERMS_HONEST_LIMIT,
      TERMS_RETENTION_NOTE,
      SOURCE_ENV_DEFAULT,
      // This row enumerates rather than scanning, so a new authored string joins it or it covers
      // one string fewer than the surface ships (`05-REVIEW.md` WR-07).
      droppedSeedCaption(REFUSED_SEEDS.serviceName),
      droppedSeedCaption(REFUSED_SEEDS.termsText),
    ]) {
      expect(copy).not.toContain(LONG_DASH);
    }
  });
});

describe('the create form opens on the SERVED defaults, falling back to the shipped literals', () => {
  it('prefers this service\'s current defaults over the bundle literals', () => {
    // The whole point of the settings surface: an operator stops restating their own defaults on
    // every create. A form that ignored the served snapshot would make the setting decorative.
    const served: SettingsSnapshotDTO = {
      ...UNTOUCHED,
      defaultBeaconType: { value: 'SMTBeacon', envDefault: 'CASBeacon', changed: true },
      defaultSize: { value: 5, envDefault: 2, changed: true },
      defaultThreshold: { value: 3, envDefault: 2, changed: true },
    };
    expect(createFormDefaults(served)).toEqual({
      beaconType: 'SMTBeacon',
      sizeText: '5',
      thresholdText: '3',
    });
  });

  it('falls back to the shipped literals when no snapshot has landed', () => {
    // Never blank: a form rendering empty fields while a read is in flight invites the operator to
    // type over values that are about to arrive. And never a claimed default the service did not
    // send: these literals are what this form has always shipped with.
    expect(createFormDefaults(undefined)).toEqual({
      beaconType: SHIPPED_BEACON_TYPE,
      sizeText: SHIPPED_SIZE_TEXT,
      thresholdText: SHIPPED_THRESHOLD_TEXT,
    });
  });
});

describe('a rejected save leaves the rendered snapshot exactly as the service holds it', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // Seeds a LIVE session alongside the snapshot (review WR-08/WR-09). These rows drive a gated
    // action from a console the store otherwise holds at `checking`, which no real console can do:
    // the save button exists only on a signed-in console. Now that the store compares the asking
    // session before it writes or expires, staging the fiction would make the rows describe a state
    // the product never reaches. Every assertion inside the three rows is unchanged.
    useOperator.setState({
      auth: 'logged-in',
      settings: UNTOUCHED,
      settingsStatus: 'idle',
      settingsError: undefined,
    });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('renders the service message and changes NO field on a 400', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Cohort size must be at least 1 signer.' }), { status: 400 }),
    ) as unknown as typeof fetch;

    await useOperator.getState().saveSettings(BASE, { defaultSize: 0, serviceName: 'Renamed' });

    const state = useOperator.getState();
    expect(state.settingsError).toBe('Cohort size must be at least 1 signer.');
    expect(state.settingsStatus).toBe('error');
    // Nothing was applied locally either: the VALID sibling field in the same patch did not move.
    expect(state.settings).toEqual(UNTOUCHED);
  });

  it('replaces the snapshot with the SERVED one on success, never with the patch that was sent', async () => {
    const served: SettingsSnapshotDTO = {
      ...UNTOUCHED,
      // The service trimmed what was typed; the form must show the service's version.
      serviceName: { value: 'Acme (maintenance)', envDefault: 'Acme Aggregation', changed: true },
    };
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(served), { status: 200 }),
    ) as unknown as typeof fetch;

    await useOperator.getState().saveSettings(BASE, { serviceName: '  Acme (maintenance)  ' });

    const state = useOperator.getState();
    expect(state.settings?.serviceName.value).toBe('Acme (maintenance)');
    expect(state.settings?.serviceName.changed).toBe(true);
    expect(state.settingsMessage).toBe(SETTINGS_SAVED_OK);
    expect(state.settingsError).toBeUndefined();
  });

  it('takes the one shared session-expiry path on a 401, never a validation failure', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;

    await useOperator.getState().saveSettings(BASE, { serviceName: 'Renamed' });

    const state = useOperator.getState();
    expect(state.auth).toBe('logged-out');
    // `expireSession` drops the gated slice, settings included.
    expect(state.settings).toBeUndefined();
  });
});
