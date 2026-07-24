import { useState } from 'react';
import { Badge, Button, Card, CopyField, SectionTitle, StatusDot } from '../../ui/primitives';
import { cosignCaption, cosignValue } from '../../lib/directory';
import { useOperator } from '../../stores/operator';
import type { CohortSummaryDTO, OperatorCohortDTO, ServiceMetricsDTO } from '../../lib/operator';

/** Friendly beacon-type label (matches the create form's CAS/SMT options). */
function beaconLabel(beaconType: OperatorCohortDTO['beaconType']): string {
  return beaconType === 'CASBeacon' ? 'CAS' : 'SMT';
}

/**
 * The fixed status-chip key for a list row. A DRAFT and an EXPIRED cohort are operator-list
 * states (not monitoring chips), so they extend the monitoring {@link CohortSummaryDTO.chip}
 * union here with the two inherited row states.
 */
type ChipKey = CohortSummaryDTO['chip'] | 'draft' | 'expired';

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
type GroupKey = 'attention' | 'active' | 'drafts' | 'ended';
const GROUP_ORDER: GroupKey[] = ['attention', 'active', 'drafts', 'ended'];
const GROUP_HEADING: Record<GroupKey, string> = {
  attention: 'Needs attention',
  active: 'Active',
  drafts: 'Drafts',
  ended: 'Ended',
};

/**
 * Derive one row's status chip. A draft/expired cohort reads its inherited row state; an
 * advertised cohort reads its live monitoring chip, defaulting to `filling` when the monitor
 * has no row yet (a freshly advertised, zero-opt-in cohort is live and filling).
 */
function chipForCohort(cohort: OperatorCohortDTO, row?: CohortSummaryDTO): ChipKey {
  if (cohort.state === 'draft') {
    return 'draft';
  }
  if (cohort.state === 'expired') {
    return 'expired';
  }
  return row?.chip ?? 'filling';
}

/**
 * Assign a chip to exactly ONE group (single membership, so a cohort never double-renders):
 * `needs-funding` / `fallback` / `failed` need a human, so they surface under Needs attention
 * (this also backs the drill-down cross-cohort attention badge, D-11); `filling` / `co-signing`
 * are live under Active; `draft` under Drafts; a clean `anchored` and an `expired` window are
 * settled under Ended. The tone map above still colors each chip identically wherever it renders.
 */
function groupForChip(chip: ChipKey): GroupKey {
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
 * and revivable instead of silently vanishing. All render the network, beacon type, and a
 * copyable id.
 */
function CohortRow({
  baseUrl,
  cohort,
  row,
  onOpen,
}: {
  baseUrl: string;
  cohort: OperatorCohortDTO;
  /** The cohort's live monitoring row, when the fold has one (advertised/ended cohorts). */
  row?: CohortSummaryDTO;
  onOpen?: (id: string) => void;
}) {
  const discard = useOperator((s) => s.discard);
  const advertise = useOperator((s) => s.advertise);
  const readvertise = useOperator((s) => s.readvertise);
  const advertiseStatus = useOperator((s) => s.advertiseStatus);
  const advertisingId = useOperator((s) => s.advertisingId);
  const [confirming, setConfirming] = useState(false);

  const isDraft = cohort.state === 'draft';
  const isExpired = cohort.state === 'expired';
  const isAdvertised = cohort.state === 'advertised';
  const isAdvertising = advertiseStatus === 'advertising' && advertisingId === cohort.draftId;
  const chip = chipForCohort(cohort, row);
  // Prefer the live monitoring seats (authoritative for an advertised/ended cohort); fall back
  // to the operator DTO's own count for a draft (0 of n) that has no monitoring row yet.
  const joined = row ? row.seatsJoined : cohort.joined;
  const capacity = row ? row.capacity : cohort.capacity;
  // A short reason line: the expired window reason, or a failed cohort's failure reason.
  const reason = cohort.reason ?? row?.reason;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip chip={chip} />
          <span className="text-sm text-muted">{cohort.network}</span>
          <span className="text-sm text-muted">{beaconLabel(cohort.beaconType)}</span>
          <span className="text-sm text-muted">
            {joined}/{capacity} seats
          </span>
          <span className="text-sm text-muted">Co-sign: {cosignValue(cohort)}</span>
          {cohort.threshold < cohort.capacity ? (
            <span className="text-xs text-faint">{cosignCaption(cohort)}</span>
          ) : null}
        </div>
        {isDraft && !confirming ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={isAdvertising} onClick={() => void advertise(baseUrl, cohort.draftId)}>
              {isAdvertising ? 'Advertising…' : 'Advertise cohort'}
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Discard draft
            </Button>
          </div>
        ) : null}
        {isExpired ? (
          <Button variant="primary" disabled={isAdvertising} onClick={() => void readvertise(baseUrl, cohort.draftId)}>
            {isAdvertising ? 'Re-advertising…' : 'Re-advertise'}
          </Button>
        ) : null}
        {isAdvertised && onOpen ? (
          // Only advertised cohorts open the live monitoring drill-down (D-01/D-03/D-09).
          <Button variant="ghost" onClick={() => onOpen(cohort.draftId)}>
            Open
          </Button>
        ) : null}
      </div>

      {reason ? <p className="text-sm text-muted">{isExpired ? `Expired: ${reason}` : reason}</p> : null}

      <CopyField label={isDraft ? 'draft id' : 'cohort id'} value={cohort.draftId} />

      {confirming ? (
        <div className="space-y-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          <p>
            Discard this draft? It hasn&rsquo;t been advertised, so nothing has been published to the
            directory yet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void discard(baseUrl, cohort.draftId)}>
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

  // Per-cohort chip lookup: an advertised cohort's live cohort id equals its draft id, so the
  // monitoring rows join to the operator cohorts on that single key.
  const rowByCohort = new Map(rows.map((r) => [r.cohortId, r]));

  // Bucket each cohort into exactly one group by its derived chip (single membership).
  const grouped: Record<GroupKey, OperatorCohortDTO[]> = { attention: [], active: [], drafts: [], ended: [] };
  for (const cohort of cohorts) {
    const chip = chipForCohort(cohort, rowByCohort.get(cohort.draftId));
    grouped[groupForChip(chip)].push(cohort);
  }

  return (
    <div className="space-y-6">
      <ServiceMetricsRow metrics={metrics} />

      {advertiseMessage ? (
        <div className="rounded-lg border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
          {advertiseMessage}
        </div>
      ) : null}

      {cohorts.length === 0 ? (
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
                {grouped[g].map((cohort) => (
                  <CohortRow
                    key={cohort.draftId}
                    baseUrl={baseUrl}
                    cohort={cohort}
                    row={rowByCohort.get(cohort.draftId)}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
