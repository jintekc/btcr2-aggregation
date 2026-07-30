import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canceledEndedLine,
  chipForCohort,
  dismissDropsReadvertise,
  groupForChip,
  groupRenderRows,
} from '../src/lib/operator-rows';
import { DISMISS_READVERTISE_LINE } from '../src/stores/operator';
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

/**
 * The dismissal's FULL cost, disclosed on exactly the rows where it is real (05-19, D-15).
 *
 * Once a dismissal also clears the terminal record, `readvertiseExpired` loses the record it
 * needs, so dismissing an EXPIRED row destroys that row's only escape hatch. The shipped
 * "there is no undo" covers that only in the abstract, so the confirm gains one sentence, and it
 * must appear on the rows that offer Re-advertise and nowhere else.
 *
 * `packages/web` has NO DOM harness, so a pure predicate plus a constant-containment grep is
 * exactly the pairing that let audit defect 8's seven assertions guard a function nothing called.
 * The source-read block below is what makes these assertions depend on the code they describe,
 * using the `readFileSync` + `fileURLToPath` technique `packages/web/tests/terms.spec.ts` already
 * uses and the brace-matched region extraction `packages/web/tests/tx-client.spec.ts:407-431` uses.
 */
describe('dismissDropsReadvertise: the disclosure predicate (05-19)', () => {
  it('is TRUE for a row whose served state offers Re-advertise', () => {
    expect(dismissDropsReadvertise(cohort({ state: 'expired' }))).toBe(true);
  });

  it('is FALSE for a monitoring-only ended row, which has no served cohort at all', () => {
    // This is the row the unconditional-render mistake would lie to: nothing was ever
    // re-advertisable here, so telling the operator they are giving that up is simply false.
    expect(dismissDropsReadvertise(undefined)).toBe(false);
  });

  it('is FALSE for every other served state', () => {
    for (const state of ['draft', 'advertised', 'canceled'] as const) {
      expect(dismissDropsReadvertise(cohort({ state }))).toBe(false);
    }
  });
});

describe('DISMISS_READVERTISE_LINE says what the dismissal costs (05-19)', () => {
  it('names the cohort list and uses the word re-advertise', () => {
    // CONTAINMENT rather than exact-string equality, in the shape of the shipped `DISMISS_BODY`
    // pin: the wording is the author's, the two FACTS are the contract. Pinning the whole
    // sentence would make a future rewording fail for no reason; pinning nothing would let
    // `'This also clears the row.'` satisfy every other assertion in this file while still never
    // telling the operator that their only re-advertise path is being destroyed.
    expect(DISMISS_READVERTISE_LINE).toContain('re-advertise');
    expect(DISMISS_READVERTISE_LINE).toContain('cohort list');
  });
});

/** The shipped list component's source, read once (the `terms.spec.ts` technique). */
const LIST_SRC = readFileSync(
  fileURLToPath(new URL('../src/components/operator/OperatorCohortList.tsx', import.meta.url)),
  'utf8',
);

/**
 * The same source with its import declarations stripped, so an occurrence COUNT means "renders in
 * exactly one place" rather than "is mentioned once including its own import".
 */
const LIST_RENDER_SRC = LIST_SRC.replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '');

/**
 * The rung-1 `<ConfirmPanel ...>` element, isolated so a placement pin cannot be satisfied by a
 * paragraph sitting BESIDE the panel.
 *
 * Located by angle and brace matching rather than by slicing to the next known element, following
 * `packages/web/tests/tx-client.spec.ts:407-431`, and carrying the same kind of SELF-GUARD it
 * carries: a pin that fails for the wrong reason (or that silently widens into its neighbour) is
 * worse than no pin, because the next reader disarms it.
 */
function confirmPanelElement(): string {
  const start = LIST_SRC.indexOf('<ConfirmPanel');
  expect(start).toBeGreaterThan(0);
  let depth = 0;
  for (let i = start; i < LIST_SRC.length; i += 1) {
    const ch = LIST_SRC[i];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
    } else if (ch === '>' && depth === 0) {
      // Self-closing (`... />`) is the shipped shape; a plain `>` would open a tag whose matching
      // close has to be found instead. Both are handled so the extractor cannot quietly truncate.
      if (LIST_SRC[i - 1] === '/') {
        return LIST_SRC.slice(start, i + 1);
      }
      const close = LIST_SRC.indexOf('</ConfirmPanel>', i);
      if (close < 0) {
        throw new Error('ConfirmPanel element not found: no matching close tag');
      }
      return LIST_SRC.slice(start, close + '</ConfirmPanel>'.length);
    }
  }
  throw new Error('ConfirmPanel element not found: unbalanced delimiters');
}

describe('OperatorCohortList renders the disclosure conditionally, INSIDE the confirm (05-19)', () => {
  it('imports the predicate', () => {
    expect(LIST_SRC).toContain('dismissDropsReadvertise');
    expect(LIST_SRC).toMatch(/import[\s\S]*?dismissDropsReadvertise[\s\S]*?from\s+'\.\.\/\.\.\/lib\/operator-rows'/);
  });

  it('actually CALLS the predicate, rather than importing it and ignoring it', () => {
    const occurrences = LIST_SRC.split('dismissDropsReadvertise').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('renders the line in exactly ONE place, and that place is guarded by the predicate', () => {
    // Without this, a component that renders `<p>{DISMISS_READVERTISE_LINE}</p>` unconditionally
    // and never imports the predicate satisfies every other assertion here, and a monitoring-only
    // ended row would be told the cohort can no longer be re-advertised, which is false for it.
    const occurrences = LIST_RENDER_SRC.split('DISMISS_READVERTISE_LINE').length - 1;
    expect(occurrences).toBe(1);
    expect(LIST_RENDER_SRC).toMatch(/dismissDropsReadvertise\([A-Za-z0-9_.?]*\)\s*\?[^:]*DISMISS_READVERTISE_LINE[^:]*:/);
  });

  it('calls the predicate on the served cohort of the ROW, not on a value that makes it constant', () => {
    // Every other assertion here is argument-INDEPENDENT, so without this one
    // `dismissDropsReadvertise(undefined) ? <p>{DISMISS_READVERTISE_LINE}</p> : null` passes them
    // all while rendering the sentence for NO row at all. `cohort` is the binding the component
    // destructures from `entry` and the same one `isExpired` is derived from, so pinning the call
    // text also pins that the disclosure and the Re-advertise control read one fact.
    expect(LIST_SRC).toContain('dismissDropsReadvertise(cohort)');
  });

  it('places the guarded line INSIDE the rung-1 ConfirmPanel, not beside it', () => {
    const panel = confirmPanelElement();
    // Self-guard, in the shape of the `register()` extractor's: the slice starts where it should
    // and did NOT widen into the discard-draft confirm that follows in the same component.
    expect(panel.startsWith('<ConfirmPanel')).toBe(true);
    expect(panel).not.toContain('Discard this draft?');
    expect(panel).not.toContain('Keep draft');
    // The panel takes its content as a `body={...}` PROP, so a sibling placement still compiles
    // and still renders on the row while sitting OUTSIDE the confirmation the operator is
    // reading, which defeats the entire point of disclosing a cost before a confirm.
    expect(panel).toContain('DISMISS_READVERTISE_LINE');
    expect(panel).toContain('dismissDropsReadvertise(cohort)');
  });
});
