/**
 * The pure half of BOTH cohort forms (SVC-04 criterion 3, Phase 5 D-10/D-11).
 *
 * `CreateCohortForm` and `DraftEditForm` shape the same thing, so every rule and every string they
 * share lives here exactly once. That is not tidiness: the plan's load-bearing truth is that a
 * validation rule can never be enforced on one path and not the other, and two copies of a rule is
 * precisely how that drift happens. The server enforces the same rules under ONE `validateDraft`
 * for the same reason; this module is that discipline's client-side mirror.
 *
 * Everything here is pure and React-free, so the copy contract and the unit conversions are
 * assertable without a DOM (`packages/web/tests/cohort-form.spec.ts`) rather than only by looking
 * at a screen. The 05-05 `serviceControlsView` precedent.
 */

/** One minute in ms: the wire unit is milliseconds, the field the operator edits is minutes. */
export const ONE_MINUTE_MS = 60_000;

/**
 * The slack the service subtracts from a cohort's remaining lifetime when clamping the funding
 * wait (the shipped server-side `FUNDING_SLACK_MS`, 04 D-38). Mirrored here for the DISCLOSURE
 * only: the clamp itself is computed server-side and this copy never drives behavior, it just
 * keeps the disclosed minute figure honest about what the service will actually do.
 */
export const FUNDING_SLACK_MS = 10_000;

/**
 * The exact validation strings both forms render. Byte-identical to what the service throws, so
 * the client normally shows the message without a round trip and the server's own 400 renders in
 * the same inline slot as a backstop. Defined once here, referenced by both forms: the plan's
 * acceptance criterion is that the two forms share the constants rather than each holding a
 * literal that could drift by a character.
 */
export const SIZE_ERROR = 'Cohort size must be at least 1 signer.';
export const THRESHOLD_ERROR = 'Signing threshold must be a whole number between 1 and the cohort size.';
export const DISCOVERY_WINDOW_ERROR = 'Discovery window must be a whole number of minutes, at least 1.';
export const FUNDING_WINDOW_ERROR = 'Funding window must be a whole number of minutes, at least 1.';

/**
 * One timing field's value on the wire.
 *
 * An EMPTY field is `{ kind: 'unset' }` and deliberately NOT a zero: empty means "use this
 * service's default", so the key is omitted from the request body entirely and the server seeds
 * the draft from its own default (UI-SPEC E7 empty). Sending a 0 would mean "no window at all",
 * which is a completely different instruction and one this service would refuse anyway.
 */
export type WindowValue = { kind: 'unset' } | { kind: 'ms'; ms: number } | { kind: 'invalid' };

/**
 * Parse a minutes field into a ms window, mirroring the server's whole-number guard exactly.
 * Whitespace-only counts as empty, so a stray space can never be read as an invalid number.
 */
export function parseWindow(text: string): WindowValue {
  if (text.trim() === '') {
    return { kind: 'unset' };
  }
  const minutes = Number(text);
  if (!Number.isInteger(minutes) || minutes < 1) {
    return { kind: 'invalid' };
  }
  return { kind: 'ms', ms: minutes * ONE_MINUTE_MS };
}

/** Render a ms window as the minutes text the operator edits; absent stays an EMPTY field. */
export function msToMinutesText(ms?: number): string {
  return ms === undefined ? '' : String(ms / ONE_MINUTE_MS);
}

/** The window that will actually govern this cohort: what the operator typed, else the default. */
export function effectiveMs(value: WindowValue, defaultMs?: number): number | undefined {
  return value.kind === 'ms' ? value.ms : defaultMs;
}

/** Whole minutes for display, from a ms figure this service supplied. */
function minutes(ms: number): number {
  return Math.round(ms / ONE_MINUTE_MS);
}

/**
 * The `Discovery window (minutes)` help (UI-SPEC E7). It names this service's own default when the
 * service has told us one, and OMITS the number otherwise rather than inventing a plausible
 * figure: an operator who is told "the default is 30 min" by a console that guessed has been
 * misled about what their own service will do.
 */
export function discoveryWindowHelp(defaultMs?: number): string {
  const lead = 'How long this cohort stays advertised before it expires.';
  return defaultMs === undefined
    ? `${lead} Leave it empty to use this service's default.`
    : `${lead} Leave it empty to use this service's default of ${minutes(defaultMs)} min.`;
}

/** The `Funding window (minutes)` help (UI-SPEC E7); same default-naming rule as discovery. */
export function fundingWindowHelp(defaultMs?: number): string {
  const lead = "How long this service waits for this cohort's beacon address to be funded.";
  return defaultMs === undefined
    ? `${lead} Leave it empty to use this service's default.`
    : `${lead} Leave it empty to use this service's default of ${minutes(defaultMs)} min.`;
}

/**
 * The preserved 04 D-38 clamp disclosure, or undefined when no clamp will bite.
 *
 * A cohort's remaining lifetime bounds how long this service can wait for funding, so a funding
 * window longer than the discovery window (less the slack) is quietly shortened by the service.
 * Saying so up front is the honest move: otherwise the operator discovers it from a funding stage
 * that ended minutes before the number they typed.
 */
export function clampDisclosure(effectiveDiscoveryMs?: number, effectiveFundingMs?: number): string | undefined {
  if (effectiveDiscoveryMs === undefined || effectiveFundingMs === undefined) {
    return undefined;
  }
  const ceilingMs = Math.max(0, effectiveDiscoveryMs - FUNDING_SLACK_MS);
  if (effectiveFundingMs <= ceilingMs) {
    return undefined;
  }
  return `This cohort's remaining lifetime shortens the funding window to about ${minutes(ceilingMs)} min.`;
}

/**
 * The client-side validation both forms run, returning the FIRST problem in the order the form
 * renders its fields, or undefined when everything passes.
 *
 * The shorten-only discovery-window ceiling is deliberately NOT checked here: it depends on the
 * service's runner-level cohort TTL, which this client is not told, so the SERVER refuses it and
 * its message renders verbatim in the same inline slot. Guessing the ceiling client-side would
 * either block a legal value or promise one the service cannot keep.
 */
export function validateCohortForm(input: {
  size: number;
  threshold: number;
  discovery: WindowValue;
  funding: WindowValue;
}): string | undefined {
  if (!Number.isInteger(input.size) || input.size < 1) {
    return SIZE_ERROR;
  }
  if (!Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > input.size) {
    return THRESHOLD_ERROR;
  }
  if (input.discovery.kind === 'invalid') {
    return DISCOVERY_WINDOW_ERROR;
  }
  if (input.funding.kind === 'invalid') {
    return FUNDING_WINDOW_ERROR;
  }
  return undefined;
}

/**
 * Fold the two parsed windows into the optional wire keys, OMITTING an unset one entirely so the
 * server reads an empty field as "use your default" (see {@link WindowValue}).
 */
export function windowKeys(
  discovery: WindowValue,
  funding: WindowValue,
): { discoveryWindowMs?: number; fundingWindowMs?: number } {
  return {
    ...(discovery.kind === 'ms' ? { discoveryWindowMs: discovery.ms } : {}),
    ...(funding.kind === 'ms' ? { fundingWindowMs: funding.ms } : {}),
  };
}
