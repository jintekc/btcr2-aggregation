import { describe, expect, it } from 'vitest';
import { canceledEndedLine, chipForCohort, groupForChip, groupRenderRows } from '../src/lib/operator-rows';
import type { CohortSummaryDTO, OperatorCohortDTO } from '../src/lib/operator';

/**
 * Review CR-02 coverage: the operator cohort list must render the UNION of the operator's own
 * cohorts and the monitor's summary rows.
 *
 * The two sides retain a cohort on different schedules: `operator-cohorts.ts` `settleCompletion`
 * prunes a cohort from `advertised` the moment its completion RESOLVES and mints no terminal
 * record (terminal records exist only for a REJECTED completion), so `listCohorts()` can never
 * return a successfully anchored cohort - while `monitor.ts` `summary()` still emits its
 * `anchored` / `fallback` / `failed` ended row. Joining monitoring rows as a mere LOOKUP therefore
 * dropped every successful cohort from the list, taking its drill-down and its JSON export with it
 * (drill-downs are SPA-internal with no routed URLs, D-03), while the metrics row still counted
 * `anchored: 1` with nothing behind it.
 *
 * NEW spec under `packages/web/tests/` (tests-outside-src convention).
 */

function cohort(over: Partial<OperatorCohortDTO> = {}): OperatorCohortDTO {
  return {
    draftId: 'cohort-1',
    beaconType: 'CASBeacon',
    network: 'mutinynet',
    threshold: 2,
    capacity: 2,
    joined: 0,
    state: 'advertised',
    ...over,
  };
}

function summary(over: Partial<CohortSummaryDTO> = {}): CohortSummaryDTO {
  return { cohortId: 'cohort-1', chip: 'filling', seatsJoined: 0, capacity: 2, phase: 'Advertised', ...over };
}

describe('groupRenderRows: ended monitoring rows survive the operator-list prune (CR-02)', () => {
  it('renders an ANCHORED cohort the operator list no longer carries', () => {
    // The exact post-success state: settleCompletion pruned the cohort, so `cohorts` is empty,
    // but the monitor still holds its bounded ended record.
    const grouped = groupRenderRows([], [summary({ chip: 'anchored', phase: 'ended', seatsJoined: 2 })]);
    expect(grouped.ended).toHaveLength(1);
    expect(grouped.ended[0]).toMatchObject({ id: 'cohort-1', chip: 'anchored' });
    // No operator DTO behind it: the row renders monitoring facts only, never invented ones.
    expect(grouped.ended[0].cohort).toBeUndefined();
    expect(grouped.ended[0].row).toBeDefined();
  });

  it('routes a FAILED and a FALLBACK monitoring-only row to the attention group', () => {
    const grouped = groupRenderRows(
      [],
      [
        summary({ cohortId: 'c-failed', chip: 'failed', phase: 'ended', reason: 'stalled' }),
        summary({ cohortId: 'c-fallback', chip: 'fallback', phase: 'ended' }),
      ],
    );
    expect(grouped.attention.map((r) => r.id).sort()).toEqual(['c-failed', 'c-fallback']);
    expect(grouped.attention.find((r) => r.id === 'c-failed')?.row?.reason).toBe('stalled');
  });

  it('never double-renders a cohort the operator list DOES still carry', () => {
    const grouped = groupRenderRows([cohort()], [summary({ chip: 'co-signing', phase: 'SigningStarted' })]);
    const all = [...grouped.attention, ...grouped.active, ...grouped.drafts, ...grouped.ended];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: 'cohort-1', chip: 'co-signing' });
    // Joined to BOTH sides, so the row keeps the operator's network/beacon/k-of-n facts.
    expect(all[0].cohort).toBeDefined();
    expect(all[0].row).toBeDefined();
  });

  it('keeps drafts and expired records in their own groups alongside a monitoring-only ended row', () => {
    const grouped = groupRenderRows(
      [
        cohort({ draftId: 'd1', state: 'draft' }),
        cohort({ draftId: 'x1', state: 'expired', reason: 'cohort expired' }),
      ],
      [summary({ cohortId: 'anchored-1', chip: 'anchored', phase: 'ended' })],
    );
    expect(grouped.drafts.map((r) => r.id)).toEqual(['d1']);
    expect(grouped.ended.map((r) => r.id)).toEqual(['x1', 'anchored-1']);
    expect(grouped.active).toHaveLength(0);
  });

  it('an advertised cohort with no monitoring row yet still reads filling', () => {
    const grouped = groupRenderRows([cohort()], []);
    expect(grouped.active).toHaveLength(1);
    expect(grouped.active[0].chip).toBe('filling');
  });
});

describe('chipForCohort / groupForChip', () => {
  it('a draft and an expired cohort read their inherited row state, not a monitoring chip', () => {
    expect(chipForCohort(cohort({ state: 'draft' }), summary({ chip: 'anchored' }))).toBe('draft');
    expect(chipForCohort(cohort({ state: 'expired' }), summary({ chip: 'anchored' }))).toBe('expired');
  });

  it('maps every chip to exactly one group', () => {
    expect(groupForChip('needs-funding')).toBe('attention');
    expect(groupForChip('fallback')).toBe('attention');
    expect(groupForChip('failed')).toBe('attention');
    expect(groupForChip('filling')).toBe('active');
    expect(groupForChip('co-signing')).toBe('active');
    expect(groupForChip('draft')).toBe('drafts');
    expect(groupForChip('anchored')).toBe('ended');
    expect(groupForChip('expired')).toBe('ended');
  });
});

/**
 * SVC-04 (Phase 5 D-05): a cohort the operator canceled is a DELIBERATE end, so it reads as a
 * neutral `Canceled` chip in the settled `Ended` group. Folding it into `failed` (attention) or
 * into `expired` (a bad-tone window lapse) would tell the operator something went wrong when in
 * fact they chose it.
 */
describe('the canceled fate (D-05)', () => {
  it('maps an operator-canceled cohort to the canceled chip', () => {
    expect(chipForCohort(cohort({ state: 'canceled' }))).toBe('canceled');
    // The fate wins over any live monitoring chip the fold may still be carrying.
    expect(chipForCohort(cohort({ state: 'canceled' }), summary({ chip: 'filling' }))).toBe('canceled');
  });

  it('places the canceled chip in the settled Ended group, never in Needs attention', () => {
    expect(groupForChip('canceled')).toBe('ended');
  });

  it('groups a canceled cohort into Ended alongside the other settled rows', () => {
    const grouped = groupRenderRows(
      [cohort({ draftId: 'c-canceled', state: 'canceled', reason: 'canceled by the operator' })],
      [summary({ cohortId: 'c-canceled', chip: 'canceled', phase: 'ended' })],
    );
    expect(grouped.ended.map((r) => r.id)).toEqual(['c-canceled']);
    expect(grouped.attention).toHaveLength(0);
  });

  it('renders the exact ended-row line from a server wall-clock stamp', () => {
    const line = canceledEndedLine(Date.parse('2026-07-28T22:31:00Z'));
    expect(line.startsWith('Canceled by the operator at ')).toBe(true);
    expect(line.endsWith('.')).toBe(true);
  });
});
