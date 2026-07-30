import { describe, expect, it, vi } from 'vitest';
import { CohortRow } from '../src/components/operator/OperatorCohortList';
import { ADVERTISE_DISABLED_REASON } from '../src/stores/operator';
import { asRenderedText, renderStatic } from './support/render';
import type { GroupKey, RenderRow } from '../src/lib/operator-rows';
import type { OperatorCohortDTO } from '../src/lib/operator';
import type { OperatorState } from '../src/stores/operator';

/**
 * The drain-mode advertise guards, RENDERED (05-23, `05-AUDIT-2.md` entry 20, SVC-04 / D-06).
 *
 * `packages/web/src/components/operator/OperatorCohortList.tsx` gates BOTH advertise verbs on the
 * served paused bit, once on the draft row's `Advertise cohort` and once on the expired row's
 * `Re-advertise`, and renders `ADVERTISE_DISABLED_REASON` beside each. Neither call site had any
 * coverage: deleting the `|| advertisingPaused` half of either binding shipped green, and a paused
 * service would then offer a primary CTA whose only possible outcome is the service's own 409.
 *
 * ## Why this is a NEW file rather than a block in `operator-rows.spec.ts`
 *
 * `vi.mock` is FILE-SCOPED and hoisted, so a file that installs the operator-store fake has no
 * access to the genuine module singleton. `operator-rows.spec.ts` reads `DISMISS_READVERTISE_LINE`
 * from that same store module and its chip and label rows must keep the real
 * `../src/lib/operator-rows`, so the fake moves into a sibling instead. Same shape as
 * `packages/web/tests/terms-render.spec.tsx` beside `terms.spec.ts` (05-21).
 *
 * ## Why the fixture is not a `setState`
 *
 * `CohortRow` reads eleven fields from the operator store, the paused bit under test among them,
 * and takes only its entry and its grouping as props. A static render takes
 * `useSyncExternalStore`'s SERVER snapshot, which zustand implements as `getInitialState()`, where
 * `health` is `undefined`. Seeded with `useOperator.setState` BOTH paused rows below would render
 * an ENABLED control, both would still pass their assertions if written loosely, and the mutation
 * that deletes the guard would stay green: the exact vacuous shape this round exists to eliminate.
 * See the trap section of `packages/web/tests/support/render.tsx`.
 *
 * The UNPAUSED draft row is therefore written first and watched pass before any paused row exists.
 * Until something renders, an assertion that a control is disabled proves nothing.
 */

const operatorFixture: { current: Partial<OperatorState> } = { current: {} };

vi.mock('../src/stores/operator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/stores/operator')>();
  const { selectorFake } = await import('./support/render');
  return { ...actual, useOperator: selectorFake(() => operatorFixture.current) };
});

function cohort(over: Partial<OperatorCohortDTO> = {}): OperatorCohortDTO {
  return {
    draftId: 'cohort-1',
    beaconType: 'CASBeacon',
    network: 'mutinynet',
    threshold: 2,
    capacity: 2,
    joined: 0,
    state: 'draft',
    ...over,
  };
}

/** Seed the served health and render one row. `paused` is the ONLY thing that varies per row. */
function row(entry: RenderRow, group: GroupKey, paused: boolean): string {
  operatorFixture.current = {
    // The real unseeded posture for everything else: no advertise in flight, no row in edit mode,
    // no dismissal running. Only the paused bit is the subject.
    advertiseStatus: 'idle',
    health: { mode: 'hermetic', esploraReachable: 'n/a', paused },
  };
  return renderStatic(<CohortRow baseUrl="http://svc.example" entry={entry} group={group} />);
}

const draftRow: RenderRow = { id: 'cohort-1', chip: 'draft', cohort: cohort() };
const expiredRow: RenderRow = {
  id: 'cohort-1',
  chip: 'expired',
  cohort: cohort({ state: 'expired', reason: 'cohort expired' }),
};

/**
 * The opening tag of the button whose ONLY text child is `label`.
 *
 * Read as an element rather than by a substring search over the whole markup, because the shared
 * `Button` base carries `disabled:cursor-not-allowed disabled:opacity-40` on EVERY render: a plain
 * `toContain('disabled')` over the row is true no matter what the binding says (the 05-22 lesson).
 */
function buttonTag(html: string, label: string): string {
  const match = new RegExp(`<button([^>]*)>${label}</button>`).exec(html);
  if (!match) {
    throw new Error(`no button labelled "${label}" in the rendered row`);
  }
  return match[1];
}

/** Whether that button carries the `disabled` ATTRIBUTE, which React emits only when it is true. */
function isDisabled(html: string, label: string): boolean {
  return buttonTag(html, label).includes('disabled=""');
}

/** Whether the row rendered the advertise-disabled reason, in the escaped form markup carries. */
function saysWhy(html: string): boolean {
  return html.includes(asRenderedText(ADVERTISE_DISABLED_REASON));
}

describe('a DRAFT row on a RUNNING service offers advertising (the anti-vacuity control)', () => {
  it('renders the advertise control ENABLED and says nothing about a pause', () => {
    // Proof that the fixture reaches the renderer at all. Every paused row below is worthless
    // until this passes: an unseeded store renders exactly this, so a disabled-control assertion
    // taken without it could be true for the wrong reason.
    const html = row(draftRow, 'drafts', false);
    expect(html).toContain('Advertise cohort');
    expect(isDisabled(html, 'Advertise cohort')).toBe(false);
    expect(saysWhy(html)).toBe(false);
  });
});

describe('a paused service disables BOTH advertise controls and says why (D-06, audit #1 residual)', () => {
  it('disables the DRAFT row advertise control and renders the reason beside it', () => {
    const html = row(draftRow, 'drafts', true);
    expect(isDisabled(html, 'Advertise cohort')).toBe(true);
    // A disabled button with no explanation is indistinguishable from a broken one, which is why
    // the reason is asserted rather than only the disabled state.
    expect(saysWhy(html)).toBe(true);
  });

  it('renders the EXPIRED row re-advertise control ENABLED while advertising is running', () => {
    // The expired call site's own anti-vacuity control. Without it the paused expired row below
    // would prove only that something rendered, not that the paused bit is what changed it.
    const html = row(expiredRow, 'ended', false);
    expect(html).toContain('Re-advertise');
    expect(isDisabled(html, 'Re-advertise')).toBe(false);
    expect(saysWhy(html)).toBe(false);
  });

  it('disables the EXPIRED row re-advertise control and renders the reason beside it', () => {
    // Covered SEPARATELY from the draft row rather than letting one stand in for the other: the
    // component carries two independent bindings and two independent reason spans, so a mutation
    // to either has to fail a row of its own.
    const html = row(expiredRow, 'ended', true);
    expect(isDisabled(html, 'Re-advertise')).toBe(true);
    expect(saysWhy(html)).toBe(true);
  });
});

describe('pause is DRAIN MODE, not a kill switch: every other row control stays live (D-06)', () => {
  it('keeps Edit draft and Discard draft ENABLED on a paused draft row', () => {
    // Not optional, and not a bonus row. Without it this matrix would certify a REGRESSION as a
    // fix: a change that disabled the whole action group while draining would satisfy every
    // assertion above. 05-04's argument was that the narrowness of pause has to be asserted rather
    // than assumed, and reshaping or discarding a draft that is not being offered to anyone is the
    // one moment when doing so is unambiguously safe.
    const html = row(draftRow, 'drafts', true);
    expect(isDisabled(html, 'Edit draft')).toBe(false);
    expect(isDisabled(html, 'Discard draft')).toBe(false);
  });
});
