/**
 * Row derivation for the operator cohort list (SVC-03, D-04/D-06). Extracted from
 * {@link file://../components/operator/OperatorCohortList.tsx} so the join between the operator's
 * OWN cohorts and the monitor's summary rows is a pure, directly-testable function rather than a
 * loop buried in a component the gate cannot reach.
 *
 * The join is a UNION, not a lookup (review CR-02). The operator list and the monitoring fold
 * retain cohorts on DIFFERENT schedules:
 *
 * - `operator-cohorts.ts` `settleCompletion` prunes a cohort from `advertised` the moment its
 *   completion RESOLVES and mints no terminal record (terminal records exist only for a
 *   completion that REJECTS), so `listCohorts()` can never return a successfully anchored cohort.
 * - `monitor.ts` `summary()` still emits that cohort's `anchored` / `fallback` / `failed` ended
 *   row from its bounded (24-entry, oldest-first) `ended` map.
 *
 * The previous render iterated the operator cohorts alone and used the monitoring rows only as a
 * lookup, so the instant a cohort anchored it left the list entirely, taking its drill-down and
 * its `Download monitoring record (JSON)` export with it (drill-downs are SPA-internal with no
 * routed URLs, D-03, so a row is the ONLY way in). The metrics row meanwhile counted `anchored: 1`
 * with zero rows behind it, and the `anchored`/`failed`/`fallback` chips were unreachable.
 *
 * Rendering the monitor's ended rows keeps a completed cohort reachable for exactly as long as the
 * monitor retains it - an honest, already-bounded window. No service-side retention is added.
 */

import type { CohortSummaryDTO, OperatorCohortDTO } from './operator';

/**
 * The fixed status-chip key for a list row. A DRAFT and an EXPIRED cohort are operator-list
 * states (not monitoring chips), so they extend the monitoring {@link CohortSummaryDTO.chip}
 * union here with the two inherited row states.
 *
 * `canceled` arrives through the monitoring union rather than being added here: the service
 * emits it on BOTH sides (the operator DTO's `state` and the monitor's ended chip, Phase 5
 * D-05), so a canceled cohort reads the same fate whether the operator list still carries it or
 * only the monitor's bounded ended record survives.
 */
export type ChipKey = CohortSummaryDTO['chip'] | 'draft' | 'expired';

/**
 * The exact ended-row line for a cohort the operator canceled (05-UI-SPEC E12 populated).
 *
 * `at` is the SERVER wall-clock stamp carried by the monitoring row (04 D-22), rendered as a
 * local clock time. The console never substitutes its own observation time for a missing stamp:
 * a row with no `at` simply renders without this line (see the list surface), because "when this
 * browser first saw it" is not when the operator canceled it.
 */
export function canceledEndedLine(at: number): string {
  return `Canceled by the operator at ${new Date(at).toLocaleTimeString()}.`;
}

/**
 * Whether dismissing this row would ALSO give up its Re-advertise option (05-19, D-15).
 *
 * A dismissal now clears the operator cohort list's terminal record as well as the monitoring
 * ended record, and for an expired row that terminal record is exactly what `readvertiseExpired`
 * needs: forgetting it destroys the row's only escape hatch. The shipped `DISMISS_BODY` says
 * "there is no undo", which covers that in the abstract only, so the confirm names the specific
 * cost - and only where it is real.
 *
 * Decided from the SAME served fact the Re-advertise control itself is gated on (`isExpired` in
 * {@link file://../components/operator/OperatorCohortList.tsx}), so the control and the
 * disclosure can never disagree about which rows have something to lose. A monitoring-only ended
 * row passes `undefined` here and reads false: nothing was ever re-advertisable for it, so
 * telling its operator they are giving that up would be simply untrue.
 *
 * Dependency-free like every other predicate in this file, so the rule is unit-testable in a
 * package with no DOM harness. Its whole purpose is to keep a confirmation from promising less
 * than it costs.
 */
export function dismissDropsReadvertise(cohort?: OperatorCohortDTO): boolean {
  return cohort?.state === 'expired';
}

/**
 * How ONE chip renders: its Badge/StatusDot tone, its label, and whether the dot pulses (a live,
 * mid-flight cohort reads live via a pulsing dot; every settled state is a still dot).
 *
 * `tone` declares its own literal union rather than importing one, because `Tone` in
 * {@link file://../ui/primitives.tsx} is not exported and this module must stay dependency-free
 * (no react import, no primitives import, so every rule here is unit-testable in a package with no
 * DOM harness). The union assigns structurally to the `Badge` / `StatusDot` props, so the type
 * checker still catches any drift between the two declarations.
 */
export interface ChipPresentation {
  tone: 'neutral' | 'accent' | 'good' | 'warn' | 'bad';
  label: string;
  pulse: boolean;
}

/**
 * The FIXED status-chip tone map (D-04, 04-UI-SPEC Color): the SINGLE definition of every chip's
 * tone, label and pulse, so a chip's appearance never drifts between rows.
 *
 * It lives HERE, in a lib module, rather than beside `StatusChip` in the component, and that move
 * is the point rather than tidiness (05-AUDIT entry 9). As a module-private `const` in
 * `OperatorCohortList.tsx` its only reference was `CHIP[chip]`, `packages/web` renders no component
 * in any spec, and both end-to-end legs compare the SERVED chip string rather than the rendered
 * badge. A `Record<ChipKey, ...>` constrains only the KEY set and never a value, so an entry could
 * have shipped as a success-green badge labelled one character from the live pulsing chip and every
 * other check would still have passed. Exported, it is assertable.
 *
 * Exactly ONE definition of a chip's presentation may exist in this package: a second inline map
 * beside this one would recreate the tested-definition-beside-shipped-definition shape that
 * 05-AUDIT entry 10 is made of. Consumers read it through {@link chipPresentation}, which is what
 * `StatusChip` in {@link file://../components/operator/OperatorCohortList.tsx} calls, so the values
 * a spec asserts are the values that render.
 */
export const CHIP_PRESENTATION: Record<ChipKey, ChipPresentation> = {
  draft: { tone: 'neutral', label: 'Draft', pulse: false },
  filling: { tone: 'accent', label: 'Filling', pulse: true },
  'co-signing': { tone: 'accent', label: 'Co-signing', pulse: true },
  'needs-funding': { tone: 'warn', label: 'Needs funding', pulse: false },
  // NEUTRAL rather than good, and a SETTLED dot rather than the live pulsing one: the co-sign
  // succeeded, and nothing confirmed on-chain, so there is nothing to celebrate and nothing still
  // in flight. The label is deliberately NOT `Co-signed`, which sits one character from the live
  // `Co-signing` chip above and would read as the same state at a glance on a scanned list; it is
  // the word the participant surface already uses for this exact state (its anchor lifecycle runs
  // Signed -> Broadcast -> Confirmed), so both sides of the product agree about what is known.
  'co-signed': { tone: 'neutral', label: 'Signed', pulse: false },
  // WARN, matching the `fallback` entry below, because the reason that row wants a human's eye has
  // not changed: not every seat signed. Neutral would quietly downgrade that. It differs from
  // `fallback` in exactly one respect, that nothing has confirmed on-chain yet, which is why it
  // counts in neither metric column and why its label says signed rather than anchored.
  'co-signed-fallback': { tone: 'warn', label: 'Signed via fallback', pulse: false },
  fallback: { tone: 'warn', label: 'Fallback', pulse: false },
  anchored: { tone: 'good', label: 'Anchored', pulse: false },
  failed: { tone: 'bad', label: 'Failed', pulse: false },
  expired: { tone: 'bad', label: 'Expired', pulse: false },
  // NEUTRAL, never bad (05-UI-SPEC tone map, D-05): the operator meant to end this cohort, so it
  // must not read as a failure. Its label and its Ended group tell it apart from a Draft.
  canceled: { tone: 'neutral', label: 'Canceled', pulse: false },
};

/**
 * Every chip key, derived from {@link CHIP_PRESENTATION}'s own keys rather than hand-listed, so
 * the type checker keeps this list complete and a spec that iterates it cannot silently stop
 * covering a chip.
 */
export const CHIP_KEYS = Object.keys(CHIP_PRESENTATION) as ChipKey[];

/** How one chip renders. The accessor `StatusChip` consumes, so the shipped values are the asserted ones. */
export function chipPresentation(chip: ChipKey): ChipPresentation {
  return CHIP_PRESENTATION[chip];
}

/** The four list groups, in render order (04-UI-SPEC list group headings). */
export type GroupKey = 'attention' | 'active' | 'drafts' | 'ended';

/**
 * One rendered list row. `cohort` carries the operator's own DTO (network, beacon type, the k-of-n
 * numbers, the draft/expired actions) and is ABSENT for a monitoring-only row: a cohort the
 * operator list no longer holds, whose ended monitoring row is all that remains. `row` carries the
 * monitoring projection and is absent for a draft the fold has never seen.
 *
 * At least one of the two is always present, so `id` is always resolvable.
 */
export type RenderRow = {
  /** The row's stable id: the operator draft/cohort id, or the monitoring row's cohortId. */
  id: string;
  chip: ChipKey;
  cohort?: OperatorCohortDTO;
  row?: CohortSummaryDTO;
};

/**
 * Derive one row's status chip. A draft/expired/canceled cohort reads its inherited row state
 * (a terminal fate always wins over whatever the fold last saw); an advertised cohort reads its
 * live monitoring chip, defaulting to `filling` when the monitor has no row yet (a freshly
 * advertised, zero-opt-in cohort is live and filling).
 */
export function chipForCohort(cohort: OperatorCohortDTO, row?: CohortSummaryDTO): ChipKey {
  if (cohort.state === 'draft') {
    return 'draft';
  }
  if (cohort.state === 'expired') {
    return 'expired';
  }
  if (cohort.state === 'canceled') {
    return 'canceled';
  }
  return row?.chip ?? 'filling';
}

/**
 * Assign a chip to exactly ONE group (single membership, so a cohort never double-renders):
 * `needs-funding` / `fallback` / `co-signed-fallback` / `failed` need a human, so they surface
 * under Needs attention (this also backs the drill-down cross-cohort attention badge, D-11);
 * `filling` / `co-signing` are live under Active; `draft` under Drafts; a clean `anchored`, a
 * settled `co-signed`, an `expired` window, and a `canceled` cohort are settled under Ended.
 * `canceled` and `co-signed` reaching Ended by the default fall-through is deliberate and pinned by
 * spec: an operator's own decision is settled, and so is a completed key-path co-sign that needs
 * nobody.
 *
 * The rule the two-by-two makes explicit (05-AUDIT entry 9): CONFIRMATION decides the WORD on the
 * chip, the k-of-n SCRIPT PATH decides the BUCKET. So `co-signed-fallback` is listed here
 * EXPLICITLY rather than left to the fall-through, which would send it to Ended and take the
 * script-path row's Needs-attention bucketing away from the shipped hermetic default. That is the
 * regression this shape exists to avoid, and all four terminal groupings are pinned together in one
 * row of {@link file://../../tests/operator-rows.spec.ts}.
 *
 * {@link CHIP_PRESENTATION} above colors each chip identically wherever it renders.
 */
export function groupForChip(chip: ChipKey): GroupKey {
  if (chip === 'needs-funding' || chip === 'fallback' || chip === 'co-signed-fallback' || chip === 'failed') {
    return 'attention';
  }
  if (chip === 'filling' || chip === 'co-signing') {
    return 'active';
  }
  if (chip === 'draft') {
    return 'drafts';
  }
  return 'ended';
}

/**
 * Group the UNION of the operator's cohorts and the monitoring rows into the four list groups,
 * keyed by id so nothing double-renders (review CR-02).
 *
 * Operator cohorts render first, in their served order, each joined to its monitoring row when the
 * fold has one. Then any monitoring row whose id the operator list does NOT carry renders from the
 * monitoring projection alone, under its own ended taxonomy - this is what keeps an anchored,
 * fallback, or failed cohort (and therefore its drill-down and its JSON export) reachable after
 * `settleCompletion` has pruned it.
 */
export function groupRenderRows(
  cohorts: OperatorCohortDTO[],
  rows: CohortSummaryDTO[],
): Record<GroupKey, RenderRow[]> {
  // An advertised cohort's live cohort id equals its draft id, so the two sides join on one key.
  const rowById = new Map(rows.map((r) => [r.cohortId, r]));
  const cohortIds = new Set(cohorts.map((c) => c.draftId));
  const grouped: Record<GroupKey, RenderRow[]> = { attention: [], active: [], drafts: [], ended: [] };

  for (const cohort of cohorts) {
    const row = rowById.get(cohort.draftId);
    const chip = chipForCohort(cohort, row);
    grouped[groupForChip(chip)].push({ id: cohort.draftId, chip, cohort, ...(row ? { row } : {}) });
  }

  for (const row of rows) {
    if (cohortIds.has(row.cohortId)) {
      continue;
    }
    grouped[groupForChip(row.chip)].push({ id: row.cohortId, chip: row.chip, row });
  }

  return grouped;
}
