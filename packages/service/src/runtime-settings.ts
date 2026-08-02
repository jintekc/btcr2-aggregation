/**
 * Per-service RUNTIME SETTINGS: the env-seeds / runtime-overrides holder every operator
 * control in Phase 5 reads (SVC-04, D-08/D-12/D-16).
 *
 * The model is deliberate and stated in the product's own copy: environment variables seed
 * each value at boot, the operator console edits the IN-MEMORY value behind gated routes, and
 * a restart returns every value to its environment default. Each field therefore carries both
 * its current value and its boot value, so the console can caption it honestly as `env default`
 * or `changed this session (environment default: {value})` instead of leaving the operator to
 * guess which of the two they are looking at.
 *
 * Three properties are load-bearing:
 * - It is a per-{@link createRuntimeSettings} closure factory (never a module singleton),
 *   mirroring {@link file://./anchor-state.ts} and `createOperatorCohorts`, so two services in
 *   one process (which the specs construct routinely) can never share configuration. A module
 *   singleton here would let one service's pause silently drain another's advertising.
 * - Every numeric seed runs through {@link numericKnob}, so a malformed environment value warns
 *   loudly and falls back rather than becoming `NaN`. A NaN knob is not a loud failure, it is a
 *   silent one: every comparison against NaN is false, so a NaN window disables the very guard
 *   that was supposed to enforce it (the shipped WR-04 lesson, see {@link numericKnob}).
 * - {@link RuntimeSettings.applySettings} saves as a SET: it validates every supplied field
 *   first and applies NONE if any field is invalid, mirroring the guard-clause-first posture of
 *   `validateDraft` in {@link file://./operator-cohorts.ts}. A surface that can half-save is a
 *   surface whose displayed state can lie.
 *
 * There is deliberately NO persistence method of any kind, and that absence is a product
 * decision rather than an omission (D-08/D-12): durable state across a restart is DUR-01, a v2
 * requirement, and quietly adding a write path here would change the product's stated state
 * model without anyone deciding to. The honest restart copy on the console
 * (`A restart returns this service to its boot environment.`) is only true while this module
 * stays free of the filesystem and the artifact store, so `runtime-settings.spec.ts` pins that
 * absence at the source.
 */

import type { BeaconType } from '@btcr2-aggregation/shared';
// The two numeric validation strings are the exact UI-SPEC copy and already live beside the
// create-form validation that authored them; importing keeps ONE definition, so the settings
// form and the create form can never drift apart. This is a VALUE import, and
// `operator-cohorts.ts` imports only the TYPE of this module's holder, so the cycle is erased
// at compile time and there is no runtime import cycle.
import {
  discoveryWindowCeilingError,
  DISCOVERY_WINDOW_ERROR,
  FUNDING_WINDOW_ERROR,
  SIZE_ERROR,
  THRESHOLD_ERROR,
} from './operator-cohorts.js';

/**
 * Parse a numeric boot knob (an env string or the programmatic option) into a finite number at or
 * above `minimum`, warning loudly and falling back to `fallback` on anything malformed. An
 * absent/empty value is NOT malformed: it simply takes the fallback, silently.
 *
 * Review WR-04. A bare `Number(process.env.X)` yields `NaN` for any non-numeric value
 * (`FUNDING_WINDOW_MS=12m`, a stray quote, a typo), and NaN then poisons every downstream
 * comparison SILENTLY, because every comparison against NaN is false. The concrete trace for
 * `FUNDING_WINDOW_MS`:
 *
 * 1. `useBroadcast && phaseTimeoutMs <= fundingWindowMs` is false, so the D-38 fail-fast boot
 *    invariant is skipped and the service boots anyway.
 * 2. `computeFundingDeadline` yields `deadlineMs = NaN` and discloses no truncation.
 * 3. `while (Date.now() - start < NaN)` is false on the FIRST evaluation, so the wait never polls
 *    once and falls straight through to the blind-lapse throw - telling the operator the service
 *    "could not observe the chain", when it never tried. Every cohort then dies instantly with a
 *    verdict sending the operator to a block explorer to chase a chain problem that does not
 *    exist, which is exactly the lie the D-39 honesty rule exists to prevent.
 *
 * `OPERATOR_SESSION_TTL_MS` has the identical hazard with a worse outcome: `Date.now() > NaN` is
 * always false, so sessions NEVER expire, and `Math.floor(NaN / 1000)` emits an invalid
 * `Max-Age=NaN` cookie attribute.
 *
 * It lives HERE rather than in `demo-server.ts` (its original home) because the runtime settings
 * holder seeds every one of its numeric fields from the environment too, and the plan's rule is
 * one implementation rather than a second copy: a guard that exists twice is a guard that can be
 * fixed once. `demo-server.ts` imports it from here for its own boot knobs.
 *
 * THE INVARIANT `requireInteger` EXISTS FOR (`05-VERIFICATION.md` W3, review WR-2). No seed this
 * holder ACCEPTS may be a value {@link RuntimeSettings.applySettings} would REFUSE. That is not a
 * tidiness rule, it is the difference between a usable settings surface and a wedged one:
 * `applySettings` re-reads the STORED value for every key a patch OMITS and validates it with
 * `Number.isInteger`, so an accepted-but-invalid seed does not fail its own field. It fails every
 * later save AS A SET, including a save of a field the operator did touch, behind a message naming
 * a field they never set, until the service is restarted. `createDraft` is wedged the same way,
 * because a draft's absent size is filled from the stored default and `validateDraft` refuses it.
 *
 * The check is OPT-IN and defaults OFF so every existing call site resolves byte-identically:
 * `PORT` in particular passes a minimum of 0 and must keep accepting an ephemeral-port request,
 * and the runner knobs are free to be any finite ms value. A non-integer takes the SAME
 * warn-and-fall-back branch as a NaN, an infinity or an under-minimum value: one branch, one
 * message shape, one posture.
 */
export function numericKnob(
  name: string,
  raw: string | number | undefined,
  fallback: number | undefined,
  warn: (msg: string) => void,
  minimum = 1,
  requireInteger = false,
): number | undefined {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < minimum || (requireInteger && !Number.isInteger(n))) {
    warn(`ignoring malformed ${name}="${String(raw)}"; using ${fallback ?? 'the built-in default'}`);
    return fallback;
  }
  return n;
}

/**
 * One runtime-adjustable setting: its current `value`, the `envDefault` it booted with, and
 * whether the two differ. `changed` answers exactly one question - "does this differ from what
 * the environment set at boot" - so an operator who edits a field and then sets it back to its
 * boot value gets the honest `env default` caption again rather than a permanent "changed this
 * session" claim about a value that is no longer changed.
 */
export interface SettingField<T> {
  readonly value: T;
  readonly envDefault: T;
  readonly changed: boolean;
}

/** The optional boot seed for {@link createRuntimeSettings}, supplied by `createService`. */
export interface RuntimeSettingsSeed {
  /** Operator-supplied display name (env `SERVICE_NAME`, D-16); empty/whitespace collapses to undefined. */
  serviceName?: string;
  /** Beacon type a new draft starts from. */
  defaultBeaconType?: BeaconType;
  /** Cohort size n a new draft starts from. */
  defaultSize?: number;
  /** Signing threshold k a new draft starts from; defaults to the resolved size (n-of-n). */
  defaultThreshold?: number;
  /** Discovery window a new draft starts from, in ms (seeded from the service `cohortTtlMs`). */
  defaultDiscoveryWindowMs?: number;
  /** Funding window a new draft starts from, in ms (seeded from the service `fundingWindowMs`). */
  defaultFundingWindowMs?: number;
  /** Participation terms (D-19), seeded from env `TERMS_TEXT`; empty/whitespace collapses to undefined. */
  termsText?: string;
  /**
   * This service's runner-level cohort TTL in ms, used as the SHORTEN-ONLY ceiling on the
   * discovery-window default (D-11/D-13, RESEARCH Pitfall 7). Nothing in `aggregation@0.4.0` is
   * per-cohort: the runner arms its TTL at advertise and never resets it, so a default window
   * ABOVE that TTL is a promise this service cannot keep for the drafts that inherit it. Supplying
   * it enforces the ceiling on BOTH paths that can set the value, by the two different rules the
   * docs state distinctly: the boot SEED is clamped down to it with a loud warning, and a runtime
   * SAVE above it is refused by {@link RuntimeSettings.applySettings} naming the real maximum,
   * exactly as `validateDraft` already refuses it per draft. Omitted, no ceiling applies (a service
   * with no TTL never truncates anything).
   */
  discoveryWindowCeilingMs?: number;
  /** Where a malformed numeric seed is reported. Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

/**
 * Every runtime-adjustable field with its current value, its boot value, and whether the two
 * differ: exactly what the console's per-setting source caption needs, served by
 * `GET /v1/operator/settings` (D-12).
 *
 * It is a SNAPSHOT rather than a live view: the console renders `env default` or
 * `changed this session (environment default: {value})` from SERVED data, so the caption is a fact
 * the service reported rather than a comparison the browser guessed at against values it may not
 * have. The paused and broadcast-disabled bits are deliberately NOT here: they are service STATE
 * with their own controls and their own served bits, not settings a save applies as a set.
 */
export interface SettingsSnapshot {
  serviceName: SettingField<string | undefined>;
  defaultBeaconType: SettingField<BeaconType>;
  defaultSize: SettingField<number>;
  defaultThreshold: SettingField<number>;
  defaultDiscoveryWindowMs: SettingField<number | undefined>;
  defaultFundingWindowMs: SettingField<number | undefined>;
  termsText: SettingField<string | undefined>;
}

/**
 * A settings save. Every field is optional: an ABSENT field is left exactly as it was, and a
 * SUPPLIED optional string whose value is empty or whitespace-only CLEARS that field (so the
 * console's "leave it empty" affordance really does clear the name / the terms, and the DTOs
 * that carry them stay additive rather than gaining an empty key).
 *
 * `paused` and `broadcastDisabled` are deliberately NOT members. They are service STATE with
 * their own gated routes, not values a save applies as a set - and for the kill switch in
 * particular, a settings field would be a second way to reach the flag, in the one direction
 * ADR 0010 forbids (D-14). `applySettings` therefore cannot touch either, whatever a body carries.
 */
export interface SettingsPatch {
  serviceName?: string;
  defaultBeaconType?: BeaconType;
  defaultSize?: number;
  defaultThreshold?: number;
  /**
   * A supplied `null` CLEARS this window default, exactly as an empty string clears an optional
   * text field above, and mirroring the `null`-means-cleared idiom `DraftInput` already uses for
   * its per-cohort windows. Without it a console field that renders a value could never be emptied
   * again, since an absent key already means "leave this one alone".
   */
  defaultDiscoveryWindowMs?: number | null;
  /** A supplied `null` clears this window default; see {@link defaultDiscoveryWindowMs}. */
  defaultFundingWindowMs?: number | null;
  termsText?: string;
}

/** The per-service runtime settings surface. */
export interface RuntimeSettings {
  /**
   * Advertising DRAIN MODE (D-06/D-08). True means this service refuses to advertise NEW
   * cohorts; everything else keeps running, including the cohorts already advertised. Read at
   * exactly the two `runner.advertiseCohort` call sites in `operator-cohorts.ts` and reported
   * on the public `GET /v1/status` from that SAME value, so the public claim and the enforced
   * behavior cannot drift. In-memory only: a restart resumes advertising.
   */
  readonly paused: boolean;
  /**
   * The one-way broadcast kill switch (D-14). False on every boot: ADR 0010's layered
   * environment opt-in stays the only path to money movement, and this flag can only ever move
   * from false to true, never back, so a restart is the only way to re-enable broadcasting.
   */
  readonly broadcastDisabled: boolean;
  /**
   * The server wall-clock time (ms) the kill switch ENGAGED, or undefined while it is off
   * (D-14). It is the pivot of the whole feature: the per-cohort broadcast decision compares a
   * cohort's advertise stamp against this moment, which is what makes "cohorts already in flight
   * finish under the mode they started with" a fact rather than a hope. Stamped on the FIRST
   * {@link disableBroadcast} call and never moved afterwards, so a second click cannot slide the
   * pivot forward and retroactively re-enable a cohort advertised in between.
   */
  readonly broadcastDisabledAtMs: number | undefined;
  /** Display name served additively on `GET /v1/config` (D-16). */
  readonly serviceName: SettingField<string | undefined>;
  /** Beacon type a new draft starts from. */
  readonly defaultBeaconType: SettingField<BeaconType>;
  /** Cohort size n a new draft starts from. */
  readonly defaultSize: SettingField<number>;
  /** Signing threshold k a new draft starts from. */
  readonly defaultThreshold: SettingField<number>;
  /** Discovery window a new draft starts from, in ms; undefined leaves the service default. */
  readonly defaultDiscoveryWindowMs: SettingField<number | undefined>;
  /** Funding window a new draft starts from, in ms; undefined leaves the service default. */
  readonly defaultFundingWindowMs: SettingField<number | undefined>;
  /** Participation terms text (D-19); undefined means the join flow has no terms step. */
  readonly termsText: SettingField<string | undefined>;
  /** Enter drain mode. Idempotent: pausing an already-paused service changes nothing. */
  pause(): void;
  /** Leave drain mode. Idempotent: resuming a running service changes nothing. */
  resume(): void;
  /**
   * Engage the one-way broadcast kill switch (D-14): NEW cohorts stop publishing anything to
   * Bitcoin. Idempotent, and it stamps {@link broadcastDisabledAtMs} on the first call only.
   *
   * There is deliberately NO counterpart, and that omission is the feature. Re-enabling money
   * movement is a BOOT-ENVIRONMENT act under ADR 0010's layered opt-in, so this holder offers no
   * setter, no reset, and no `applySettings` field that could clear the flag: the worst an
   * attacker holding an operator session can do here is stand this service DOWN, never up. The
   * escape hatch is a restart with the broadcast environment set, and the console copy says so in
   * exactly those words rather than implying a control that does not exist.
   *
   * `kill-switch.spec.ts` SEARCHES this holder's own surface for that absence rather than
   * documenting it, so a future `enableBroadcast` fails the suite the moment it is written.
   */
  disableBroadcast(): void;
  /**
   * Apply a settings save as a SET. Validates every SUPPLIED field first and applies NONE if
   * any of them is invalid, returning the first user-facing message; returns `undefined` on
   * success. Nothing here is ever read by a cohort that is already advertised (D-13): these are
   * the values a NEW draft starts from, read once at `createDraft`.
   */
  applySettings(patch: SettingsPatch): string | undefined;
  /**
   * Project every field with its source for the gated settings read (D-12). A FRESH object per
   * call, never the internal records, so a caller cannot write settings through the DTO it was
   * handed. See {@link SettingsSnapshot}.
   */
  snapshot(): SettingsSnapshot;
}

/** Beacon types an operator may set as the create-form default (mirrors `validateDraft`). */
const KNOWN_BEACON_TYPES = new Set<string>(['CASBeacon', 'SMTBeacon']);

/** The exact validation string for an unknown default beacon type. */
const BEACON_TYPE_ERROR = 'Beacon type must be CASBeacon or SMTBeacon.';

/** One minute in ms: the floor for both timing windows. */
const ONE_MINUTE_MS = 60_000;

/**
 * Server-side bounds on the two operator-supplied free-text fields (T-05-04-05). Both render as
 * plain auto-escaped React text (never markup, never a link target), so the risk here is not
 * injection but unbounded in-memory text on a surface an operator can save repeatedly; these
 * caps are generous enough that no realistic name or terms document hits them.
 */
const MAX_SERVICE_NAME_CHARS = 200;
const MAX_TERMS_CHARS = 20_000;

/** Built-in fallbacks, used only when a seed is absent or malformed. */
const BUILT_IN_BEACON_TYPE: BeaconType = 'CASBeacon';
const BUILT_IN_SIZE = 2;

/** Trim an optional string, collapsing empty/whitespace-only to `undefined`. */
function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The internal mutable record behind one {@link SettingField}. */
interface FieldState<T> {
  value: T;
  envDefault: T;
}

/**
 * Build the per-service runtime settings holder. Every field is seeded from `seed` (which
 * `createService` fills from its own options, themselves resolved from the environment by
 * `demo-server.ts`), and every numeric seed is NaN-guarded.
 */
export function createRuntimeSettings(seed: RuntimeSettingsSeed = {}): RuntimeSettings {
  const warn = seed.warn ?? ((message: string) => console.warn(`[settings] ${message}`));

  let paused = false;
  // The one-way kill switch and its engage moment (D-14). Both are `let` rather than fields of a
  // mutable record on purpose: nothing in this closure but `disableBroadcast` below writes them,
  // and they are never routed through `applySettings`, so there is exactly one line in this file
  // that can change the money-movement mode and it only ever moves in the safe direction.
  let broadcastDisabled = false;
  let broadcastDisabledAtMs: number | undefined;

  // Seed the beacon type defensively: an out-of-range programmatic value falls back rather than
  // becoming the default every new draft inherits.
  const seededBeaconType =
    seed.defaultBeaconType && KNOWN_BEACON_TYPES.has(seed.defaultBeaconType)
      ? seed.defaultBeaconType
      : BUILT_IN_BEACON_TYPE;
  // Every seed below asks numericKnob for INTEGRALITY (the trailing `true`), because every one of
  // their consumers demands a whole number and `applySettings` re-reads each stored value on every
  // later save. See the invariant paragraph in numericKnob's docstring: a fractional seed that
  // passed here did not fail its own field, it wedged the whole settings surface until restart.
  const seededSize = numericKnob('defaultSize', seed.defaultSize, BUILT_IN_SIZE, warn, 1, true)!;
  // k defaults to n (the honest n-of-n default the create form already uses), and is clamped to
  // the resolved size so a malformed pair can never seed an unsatisfiable k > n draft default.
  const seededThresholdRaw = numericKnob('defaultThreshold', seed.defaultThreshold, seededSize, warn, 1, true)!;
  const seededThreshold = Math.min(seededThresholdRaw, seededSize);
  const seededDiscoveryWindowMs = numericKnob(
    'defaultDiscoveryWindowMs',
    seed.defaultDiscoveryWindowMs,
    undefined,
    warn,
    ONE_MINUTE_MS,
    true,
  );
  const seededFundingWindowMs = numericKnob(
    'defaultFundingWindowMs',
    seed.defaultFundingWindowMs,
    undefined,
    warn,
    ONE_MINUTE_MS,
    true,
  );

  // The shorten-only ceiling on the discovery-window DEFAULT (see the seed's docstring). Guarded
  // through numericKnob for the same NaN reason as every other numeric seed: a NaN ceiling makes
  // every `> ceiling` comparison false, which silently disables the very guard it configures. It
  // asks for integrality too, because it is a clamp TARGET: a fractional ceiling would be written
  // straight into the stored window by the clamp below, which is the same wedge arriving through a
  // different door.
  const seededCeilingMs = numericKnob(
    'discoveryWindowCeilingMs',
    seed.discoveryWindowCeilingMs,
    undefined,
    warn,
    ONE_MINUTE_MS,
    true,
  );

  /**
   * Floor a resolved ms window to a whole number of minutes, warning with BOTH numbers when that
   * changed anything (review WR-3).
   *
   * THE INVARIANT: any ms value this holder will SERVE must survive `msToMinutesText` into
   * `parseWindow` in `packages/web/src/lib/cohort-form.ts` unchanged. The console seeds its minutes
   * fields from the served snapshot and validates the WHOLE form before it will post, so one
   * unrepresentable window (90000 renders as "1.5", which `parseWindow` rightly calls invalid)
   * blocks a save of every other field, including a rename the operator did type.
   *
   * FLOOR rather than round or refuse, and the choice is load-bearing three ways. Flooring
   * preserves the operator's intent as closely as a representable value allows. It can only ever
   * SHORTEN a window, which is the same safe direction the ceiling clamp below already moves in and
   * never a promise this service cannot keep. And refusing would either drop a window the operator
   * did choose or, worse, abort a boot over a value that is only unrepresentable in the console's
   * units, which is exactly the crash-loop-on-a-typo posture the clamp comment below rejects.
   *
   * Nothing under one minute ever reaches here: {@link numericKnob} refuses it first against the
   * `ONE_MINUTE_MS` minimum, so the floor can never produce a zero.
   */
  function floorToWholeMinute(name: string, ms: number | undefined): number | undefined {
    if (ms === undefined) {
      return undefined;
    }
    const floored = Math.floor(ms / ONE_MINUTE_MS) * ONE_MINUTE_MS;
    if (floored !== ms) {
      // Both figures, in the ms the operator supplied, mirroring the clamp's disclosure discipline
      // below: boot output should say what happened rather than leave the operator to infer a
      // truncation from a number they never typed.
      warn(
        `${name}=${ms} is not a whole number of minutes; using ${floored} instead, ` +
          `the longest whole-minute window at or below it`,
      );
    }
    return floored;
  }

  // QUANTIZER POINT 1 of 3: the resolved ceiling, BEFORE it is used as a clamp target below or as
  // the refusal threshold in `applySettings`, so the maximum this service enforces is itself a
  // value the console can express. `discoveryWindowCeilingError` already renders it with a floor to
  // whole minutes, so an unquantized ceiling produced a message that understated its own limit.
  const discoveryWindowCeilingMs = floorToWholeMinute('discoveryWindowCeilingMs', seededCeilingMs);

  // Apply the ceiling to the SEED as well, clamping down with a loud warning (D-11/D-12,
  // `05-AUDIT.md` entry 7). It happens here, where the seed and the ceiling are both already
  // resolved, and NOT as a boot check in `demo-server.ts`: a second rule at the env layer is a
  // second rule that can drift from this one.
  //
  // The asymmetry with `applySettings` below is deliberate, because the alternative was live and a
  // future reader will ask. A SAVE is refused with the real maximum named: it is an operator's
  // explicit act on a value they chose and typed, so naming the limit is the honest answer. A boot
  // SEED is inherited configuration the operator may never have chosen, and every other
  // out-of-range seed in this file (the malformed numerics through {@link numericKnob}, the unknown
  // beacon type, the k > n threshold) warns and falls back rather than aborting; refusing to boot
  // here would turn one typo in a stranger's env file into a crash loop on the very path this
  // product's core value depends on.
  //
  // Two things were wrong without it, and the clamp closes both by construction. The gated settings
  // read served the over-ceiling number with `changed: false`, so the console captioned as this
  // service's `env default` a window the runner's own TTL would overrule (no app timer is even
  // armed: `armWindowTimer` returns early at or above the TTL, so the cohort lapsed with the
  // generic expired fate instead of the app's window-expired reason). And because
  // {@link RuntimeSettings.applySettings} re-reads the STORED value for every absent key, an
  // over-ceiling stored value refused every save as a set, including saves of fields the operator
  // did touch: a rename failed behind an error about a window they never set. With no over-ceiling
  // value storable, the save path has nothing left to trip over.
  const clampedDiscoveryWindowMs =
    seededDiscoveryWindowMs !== undefined &&
    discoveryWindowCeilingMs !== undefined &&
    seededDiscoveryWindowMs > discoveryWindowCeilingMs
      ? discoveryWindowCeilingMs
      : seededDiscoveryWindowMs;
  if (clampedDiscoveryWindowMs !== seededDiscoveryWindowMs) {
    // Both numbers, in the ms the operator supplied, so boot output says what happened and why
    // rather than leaving the operator to infer a truncation from a number they never typed.
    warn(
      `defaultDiscoveryWindowMs=${seededDiscoveryWindowMs} exceeds this service's cohort TTL; ` +
        `using ${clampedDiscoveryWindowMs} instead, the longest discovery window this service can enforce`,
    );
  }

  // QUANTIZER POINT 2 of 3: the discovery window AFTER the clamp, so both the seed path and the
  // clamp path end at a whole minute. Applying it after rather than before is deliberate: a value
  // clamped to an already-quantized ceiling is whole by construction, and a value that was never
  // clamped still needs its own floor. Running it first would leave the clamp as an unguarded
  // second writer.
  const resolvedDiscoveryWindowMs = floorToWholeMinute('defaultDiscoveryWindowMs', clampedDiscoveryWindowMs);

  // QUANTIZER POINT 3 of 3: the funding window, which has no ceiling and therefore no clamp that
  // could have quantized it in passing.
  const resolvedFundingWindowMs = floorToWholeMinute('defaultFundingWindowMs', seededFundingWindowMs);

  const serviceName: FieldState<string | undefined> = field(trimToUndefined(seed.serviceName));
  const defaultBeaconType: FieldState<BeaconType> = field(seededBeaconType);
  const defaultSize: FieldState<number> = field(seededSize);
  const defaultThreshold: FieldState<number> = field(seededThreshold);
  const defaultDiscoveryWindowMs: FieldState<number | undefined> = field(resolvedDiscoveryWindowMs);
  const defaultFundingWindowMs: FieldState<number | undefined> = field(resolvedFundingWindowMs);
  const termsText: FieldState<string | undefined> = field(trimToUndefined(seed.termsText));

  /** A field whose current value and boot value start out identical. */
  function field<T>(value: T): FieldState<T> {
    return { value, envDefault: value };
  }

  /**
   * Project a field for a reader. A FRESH object per read, never the internal record, so a
   * caller cannot mutate settings by writing through a returned DTO, and `changed` is derived
   * rather than tracked (see {@link SettingField}).
   */
  function project<T>(state: FieldState<T>): SettingField<T> {
    return { value: state.value, envDefault: state.envDefault, changed: !Object.is(state.value, state.envDefault) };
  }

  /**
   * Validate one timing window in ms: absent stays absent, else a WHOLE NUMBER OF MINUTES, at
   * least one, which is exactly what both window messages have always claimed.
   *
   * The modulo is the half that was missing (review WR-3). A window that is integral but not a
   * whole number of minutes (90000) stored cleanly and then reached the console as a fractional
   * minutes field, which `parseWindow` in `packages/web/src/lib/cohort-form.ts` calls invalid
   * because it mirrors this rule; the settings view validates the WHOLE form before it will post,
   * so one unrepresentable window blocked a save of every other field. The browser cannot produce
   * such a value, but a headless operator client posting straight at the gated route can, and it
   * would re-wedge the console the moment it landed. The message is untouched: this predicate is
   * what makes it TRUE.
   */
  function validateWindow(ms: number | undefined, message: string): string | undefined {
    if (ms === undefined) {
      return undefined;
    }
    if (!Number.isInteger(ms) || ms < ONE_MINUTE_MS || ms % ONE_MINUTE_MS !== 0) {
      return message;
    }
    return undefined;
  }

  return {
    get paused(): boolean {
      return paused;
    },
    get broadcastDisabled(): boolean {
      return broadcastDisabled;
    },
    get broadcastDisabledAtMs(): number | undefined {
      return broadcastDisabledAtMs;
    },
    get serviceName(): SettingField<string | undefined> {
      return project(serviceName);
    },
    get defaultBeaconType(): SettingField<BeaconType> {
      return project(defaultBeaconType);
    },
    get defaultSize(): SettingField<number> {
      return project(defaultSize);
    },
    get defaultThreshold(): SettingField<number> {
      return project(defaultThreshold);
    },
    get defaultDiscoveryWindowMs(): SettingField<number | undefined> {
      return project(defaultDiscoveryWindowMs);
    },
    get defaultFundingWindowMs(): SettingField<number | undefined> {
      return project(defaultFundingWindowMs);
    },
    get termsText(): SettingField<string | undefined> {
      return project(termsText);
    },

    pause(): void {
      // Idempotent by construction (a boolean assignment), so a double-click on the console's
      // Pause advertising can never leave a half-paused service.
      paused = true;
    },

    resume(): void {
      paused = false;
    },

    disableBroadcast(): void {
      // Idempotent, and the engage stamp is taken ONCE. A second call must not move the pivot:
      // the per-cohort decision compares each cohort's advertise stamp against it, so a later
      // stamp would silently re-enable broadcasting for every cohort advertised in between - the
      // exact opposite of what the operator asked for.
      if (broadcastDisabled) {
        return;
      }
      broadcastDisabled = true;
      broadcastDisabledAtMs = Date.now();
    },

    applySettings(patch: SettingsPatch): string | undefined {
      // PHASE 1 - validate everything supplied, touching nothing. The order below is the order
      // the console renders the fields in, so the message the operator sees is the first
      // problem reading down their own form.
      const nextServiceName =
        patch.serviceName !== undefined ? trimToUndefined(patch.serviceName) : serviceName.value;
      if (nextServiceName !== undefined && nextServiceName.length > MAX_SERVICE_NAME_CHARS) {
        return `Service name must be ${MAX_SERVICE_NAME_CHARS} characters or fewer.`;
      }

      const nextBeaconType = patch.defaultBeaconType ?? defaultBeaconType.value;
      if (!KNOWN_BEACON_TYPES.has(nextBeaconType)) {
        return BEACON_TYPE_ERROR;
      }

      const nextSize = patch.defaultSize ?? defaultSize.value;
      if (!Number.isInteger(nextSize) || nextSize < 1) {
        return SIZE_ERROR;
      }

      // k is validated against the size in THIS SAME patch, never the stored one: a save that
      // shrinks n and raises k at once must be judged as the operator wrote it, not against a
      // value the save is about to replace.
      const nextThreshold = patch.defaultThreshold ?? defaultThreshold.value;
      if (!Number.isInteger(nextThreshold) || nextThreshold < 1 || nextThreshold > nextSize) {
        return THRESHOLD_ERROR;
      }

      // `null` clears (see {@link SettingsPatch}); an absent key leaves the stored value alone.
      const nextDiscoveryWindowMs =
        patch.defaultDiscoveryWindowMs !== undefined
          ? (patch.defaultDiscoveryWindowMs ?? undefined)
          : defaultDiscoveryWindowMs.value;
      const discoveryProblem = validateWindow(nextDiscoveryWindowMs, DISCOVERY_WINDOW_ERROR);
      if (discoveryProblem) {
        return discoveryProblem;
      }
      // The shorten-only ceiling, refused at SAVE with this service's real maximum named rather
      // than accepted and then silently overruled by a library timer the operator cannot see. This
      // is the same refusal `validateDraft` makes per draft (05-06); it belongs here too because a
      // DEFAULT above the TTL would hand that unenforceable window to every draft that inherits it.
      if (
        nextDiscoveryWindowMs !== undefined &&
        discoveryWindowCeilingMs !== undefined &&
        nextDiscoveryWindowMs > discoveryWindowCeilingMs
      ) {
        return discoveryWindowCeilingError(discoveryWindowCeilingMs);
      }

      const nextFundingWindowMs =
        patch.defaultFundingWindowMs !== undefined
          ? (patch.defaultFundingWindowMs ?? undefined)
          : defaultFundingWindowMs.value;
      const fundingProblem = validateWindow(nextFundingWindowMs, FUNDING_WINDOW_ERROR);
      if (fundingProblem) {
        return fundingProblem;
      }

      const nextTermsText = patch.termsText !== undefined ? trimToUndefined(patch.termsText) : termsText.value;
      if (nextTermsText !== undefined && nextTermsText.length > MAX_TERMS_CHARS) {
        return `Participation terms must be ${MAX_TERMS_CHARS} characters or fewer.`;
      }

      // PHASE 2 - apply. Reached only when every supplied field validated, so the surface can
      // never render a half-saved state (UI-SPEC E8 `partial`).
      serviceName.value = nextServiceName;
      defaultBeaconType.value = nextBeaconType;
      defaultSize.value = nextSize;
      defaultThreshold.value = nextThreshold;
      defaultDiscoveryWindowMs.value = nextDiscoveryWindowMs;
      defaultFundingWindowMs.value = nextFundingWindowMs;
      termsText.value = nextTermsText;
      return undefined;
    },

    snapshot(): SettingsSnapshot {
      // Built from the SAME `project` the per-field getters use, so the gated read and any direct
      // holder read can never disagree about whether a field changed.
      return {
        serviceName: project(serviceName),
        defaultBeaconType: project(defaultBeaconType),
        defaultSize: project(defaultSize),
        defaultThreshold: project(defaultThreshold),
        defaultDiscoveryWindowMs: project(defaultDiscoveryWindowMs),
        defaultFundingWindowMs: project(defaultFundingWindowMs),
        termsText: project(termsText),
      };
    },
  };
}
