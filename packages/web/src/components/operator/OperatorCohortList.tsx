import { useState } from 'react';
import { Badge, Button, Card, CopyField, SectionTitle, StatusDot } from '../../ui/primitives';
import { cosignCaption, cosignValue } from '../../lib/directory';
import { groupRenderRows, type ChipKey, type GroupKey, type RenderRow } from '../../lib/operator-rows';
import { useOperator } from '../../stores/operator';
import type { OperatorCohortDTO, ServiceMetricsDTO } from '../../lib/operator';

/** Friendly beacon-type label (matches the create form's CAS/SMT options). */
function beaconLabel(beaconType: OperatorCohortDTO['beaconType']): string {
  return beaconType === 'CASBeacon' ? 'CAS' : 'SMT';
}

/**
 * The FIXED status-chip tone map (D-04, 04-UI-SPEC Color). Tone + label + whether the
 * StatusDot pulses (a live, mid-flight cohort reads live via a pulsing accent dot; every
 * other state is a settled dot). This is the single source of truth for the chips, so a
 * chip's tone never drifts between rows.
 */
const CHIP: Record<ChipKey, { tone: 'neutral' | 'accent' | 'good' | 'warn' | 'bad'; label: string; pulse: boolean }> = {
  draft: { tone: 'neutral', label: 'Draft', pulse: false },
  filling: { tone: 'accent', label: 'Filling', pulse: true },
  'co-signing': { tone: 'accent', label: 'Co-signing', pulse: true },
  'needs-funding': { tone: 'warn', label: 'Needs funding', pulse: false },
  fallback: { tone: 'warn', label: 'Fallback', pulse: false },
  anchored: { tone: 'good', label: 'Anchored', pulse: false },
  failed: { tone: 'bad', label: 'Failed', pulse: false },
  expired: { tone: 'bad', label: 'Expired', pulse: false },
};

/** The four list groups, in render order (04-UI-SPEC list group headings). */
const GROUP_ORDER: GroupKey[] = ['attention', 'active', 'drafts', 'ended'];
const GROUP_HEADING: Record<GroupKey, string> = {
  attention: 'Needs attention',
  active: 'Active',
  drafts: 'Drafts',
  ended: 'Ended',
};

/** A status chip: a Badge carrying the fixed tone + a StatusDot that pulses only when live. */
function StatusChip({ chip }: { chip: ChipKey }) {
  const c = CHIP[chip];
  return (
    <Badge tone={c.tone}>
      <StatusDot tone={c.tone} pulse={c.pulse} label={c.label} />
      {c.label}
    </Badge>
  );
}

/**
 * The compact service-metrics row (D-06): four `tabular-nums` counters with count-neutral
 * SectionTitle captions, derived from the live set + retained records (never a since-boot
 * total). At zero cohorts every counter renders 0. Captions stay singular/plural-neutral
 * (`open`, `in flight`, `anchored`, `failed`) so the row reads correctly at 0, 1, and many.
 */
function ServiceMetricsRow({ metrics }: { metrics?: ServiceMetricsDTO }) {
  const m = metrics ?? { open: 0, inFlight: 0, anchored: 0, failed: 0 };
  const cells: { n: number; caption: string }[] = [
    { n: m.open, caption: 'open' },
    { n: m.inFlight, caption: 'in flight' },
    { n: m.anchored, caption: 'anchored' },
    { n: m.failed, caption: 'failed' },
  ];
  return (
    <Card className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.caption} className="space-y-1">
          <div className="text-sm font-semibold tabular-nums text-ink">{c.n}</div>
          <SectionTitle>{c.caption}</SectionTitle>
        </div>
      ))}
    </Card>
  );
}

/**
 * One operator cohort row (SVC-01/SVC-02/SVC-03, D-04/D-09/F2). A DRAFT shows a neutral
 * `Draft` chip plus the two-step actions: the primary `Advertise cohort` CTA (the only accent
 * button, UI-SPEC) and `Discard draft` (danger, behind an inline confirm). An ADVERTISED cohort
 * shows its live status chip (from the monitoring summary) and its `{joined}/{capacity}` seats,
 * and opens the live drill-down (D-01/D-03). An EXPIRED cohort shows the bad-tone `Expired` chip
 * with its reason and a single primary `Re-advertise` action, so an expired cohort is visible
 * and revivable instead of silently vanishing.
 *
 * A MONITORING-ONLY row (`entry.cohort` absent, review CR-02) is a cohort the operator list no
 * longer carries: `settleCompletion` prunes a cohort the moment it completes successfully and
 * mints no terminal record, so an anchored cohort exists ONLY as the monitor's ended row. Such a
 * row renders exactly the facts the monitoring DTO carries (chip, seats, reason, id) - the
 * network, beacon type, and k-of-n numbers are deliberately omitted rather than invented - and
 * keeps `Open` wired so the drill-down and its JSON export stay reachable for as long as the
 * monitor retains the record.
 */
function CohortRow({
  baseUrl,
  entry,
  onOpen,
}: {
  baseUrl: string;
  /** The joined row: an operator cohort, a monitoring row, or (usually) both. */
  entry: RenderRow;
  onOpen?: (id: string) => void;
}) {
  const discard = useOperator((s) => s.discard);
  const advertise = useOperator((s) => s.advertise);
  const readvertise = useOperator((s) => s.readvertise);
  const advertiseStatus = useOperator((s) => s.advertiseStatus);
  const advertisingId = useOperator((s) => s.advertisingId);
  const [confirming, setConfirming] = useState(false);

  const { id, chip, cohort, row } = entry;
  const isDraft = cohort?.state === 'draft';
  const isExpired = cohort?.state === 'expired';
  const isAdvertised = cohort?.state === 'advertised';
  const isAdvertising = advertiseStatus === 'advertising' && advertisingId === id;
  // Prefer the live monitoring seats (authoritative for an advertised/ended cohort); fall back
  // to the operator DTO's own count for a draft (0 of n) that has no monitoring row yet.
  const joined = row ? row.seatsJoined : (cohort?.joined ?? 0);
  const capacity = row ? row.capacity : (cohort?.capacity ?? 0);
  // A short reason line: the expired window reason, or a failed cohort's failure reason.
  const reason = cohort?.reason ?? row?.reason;
  // A monitoring-only row has no operator cohort behind it, so the drill-down is the only action
  // it can offer; an advertised cohort opens the same drill-down (D-01/D-03/D-09).
  const canOpen = isAdvertised || cohort === undefined;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip chip={chip} />
          {/* Network / beacon type / k-of-n ride the operator DTO only: the monitoring row does
              not carry them, and a settled cohort must not have them invented for it. */}
          {cohort ? (
            <>
              <span className="text-sm text-muted">{cohort.network}</span>
              <span className="text-sm text-muted">{beaconLabel(cohort.beaconType)}</span>
            </>
          ) : null}
          <span className="text-sm text-muted">
            {joined}/{capacity} seats
          </span>
          {cohort ? <span className="text-sm text-muted">Co-sign: {cosignValue(cohort)}</span> : null}
          {cohort && cohort.threshold < cohort.capacity ? (
            <span className="text-xs text-faint">{cosignCaption(cohort)}</span>
          ) : null}
        </div>
        {isDraft && !confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={isAdvertising} onClick={() => void advertise(baseUrl, id)}>
              {isAdvertising ? 'Advertising…' : 'Advertise cohort'}
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Discard draft
            </Button>
          </div>
        ) : null}
        {isExpired ? (
          <Button variant="primary" disabled={isAdvertising} onClick={() => void readvertise(baseUrl, id)}>
            {isAdvertising ? 'Re-advertising…' : 'Re-advertise'}
          </Button>
        ) : null}
        {canOpen && onOpen ? (
          <Button variant="ghost" onClick={() => onOpen(id)}>
            Open
          </Button>
        ) : null}
      </div>

      {reason ? <p className="text-sm text-muted">{isExpired ? `Expired: ${reason}` : reason}</p> : null}

      <CopyField label={isDraft ? 'draft id' : 'cohort id'} value={id} />

      {confirming ? (
        <div className="space-y-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          <p>
            Discard this draft? It hasn&rsquo;t been advertised, so nothing has been published to the
            directory yet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void discard(baseUrl, id)}>
              Discard draft
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep draft
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The list-first operator cohort surface (SVC-03, D-06/D-07/D-08). A compact service-metrics
 * row sits at the top, then the operator's cohorts render grouped under `Needs attention`,
 * `Active`, `Drafts`, and `Ended` (a group heading appears only when its group is non-empty),
 * each advertised row carrying its live status chip + seats. At zero cohorts the metrics row
 * still renders (every counter 0) above the honest `No cohorts yet` empty state, whose body
 * carries the in-memory-clears-on-restart line (D-24). A transient good-tone banner confirms a
 * successful advertise.
 *
 * The rows are the UNION of the operator's cohorts and the monitoring rows
 * ({@link groupRenderRows}, review CR-02), so a cohort that has ANCHORED - which
 * `settleCompletion` prunes from the operator list without minting a terminal record - keeps its
 * Ended row, its drill-down, and its JSON export instead of vanishing the instant it succeeds.
 */
export function OperatorCohortList({
  baseUrl,
  onOpen,
}: {
  baseUrl: string;
  /** Open an advertised cohort's live drill-down (D-01/D-03); absent = no drill-down affordance. */
  onOpen?: (id: string) => void;
}) {
  const cohorts = useOperator((s) => s.cohorts);
  const rows = useOperator((s) => s.rows);
  const metrics = useOperator((s) => s.metrics);
  const advertiseMessage = useOperator((s) => s.advertiseMessage);
  // A failed discard used to look identical to a successful one (review WR-06).
  const actionError = useOperator((s) => s.actionError);

  // Bucket the UNION of the operator cohorts and the monitoring rows into exactly one group each
  // (single membership, keyed by id so nothing double-renders).
  const grouped = groupRenderRows(cohorts, rows);
  const rowCount = GROUP_ORDER.reduce((n, g) => n + grouped[g].length, 0);

  return (
    <div className="space-y-6">
      <ServiceMetricsRow metrics={metrics} />

      {advertiseMessage ? (
        <div className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {advertiseMessage}
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{actionError}</div>
      ) : null}

      {/* The empty state keys on the RENDERED row count, not on `cohorts` alone: a service whose
          only cohort has already anchored has an empty operator list but a live monitoring row. */}
      {rowCount === 0 ? (
        <Card className="space-y-1 p-5">
          <p className="text-sm text-ink">No cohorts yet</p>
          <p className="text-sm text-muted">
            Create a cohort to advertise it into this service&rsquo;s directory. This service keeps cohort
            state in memory, so a restart clears it.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {GROUP_ORDER.map((g) =>
            grouped[g].length === 0 ? null : (
              <div key={g} className="space-y-3">
                <SectionTitle>{GROUP_HEADING[g]}</SectionTitle>
                {grouped[g].map((entry) => (
                  <CohortRow key={entry.id} baseUrl={baseUrl} entry={entry} onOpen={onOpen} />
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
