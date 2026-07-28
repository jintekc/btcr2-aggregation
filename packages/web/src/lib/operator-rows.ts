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
 * `needs-funding` / `fallback` / `failed` need a human, so they surface under Needs attention
 * (this also backs the drill-down cross-cohort attention badge, D-11); `filling` / `co-signing`
 * are live under Active; `draft` under Drafts; a clean `anchored`, an `expired` window, and a
 * `canceled` cohort are settled under Ended. `canceled` reaching Ended by the default fall-through
 * is deliberate and pinned by spec: an operator's own decision is settled, never attention-worthy.
 * The tone map in the component still colors each chip identically wherever it renders.
 */
export function groupForChip(chip: ChipKey): GroupKey {
  if (chip === 'needs-funding' || chip === 'fallback' || chip === 'failed') {
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
