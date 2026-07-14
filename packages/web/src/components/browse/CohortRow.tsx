import { resolveNetwork } from '@btcr2-aggregation/shared';
import { Badge, Button, Card, CopyField } from '../../ui/primitives';
import { beaconGloss, isJoinable, statusLabel, statusTone, type DirectoryCohortDTO } from '../../lib/directory';

/** A dense uppercase micro-label (600 weight, no 500) for the per-row metric captions. */
function MetricLabel({ children }: { children: string }) {
  return <div className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-faint">{children}</div>;
}

/**
 * One presentational directory row (PART-01, D-08/D-09). Built entirely from the locked
 * primitives and the pure helpers in {@link file://../../lib/directory.ts}: a plain-language
 * status Badge (accent only when Open), a beacon-type gloss chip, the active-network chip
 * (reusing PublicStatus's mainnet `· REAL FUNDS` variant), seats, the n-of-n co-sign
 * threshold, and a copyable Cohort ID.
 *
 * The `Join` button is a real function of joinability, not a stub: it is enabled only when
 * the row is joinable AND an `onPick` handler is supplied. This plan renders the row
 * without `onPick`, so Join is correctly disabled (a Full / Filling / Collecting-updates
 * row is display-only regardless); plan 04 supplies `onPick` to light it up on joinable
 * rows. Accent stays scarce: only the Open Badge and the single Join button may carry it.
 */
export function CohortRow({ row, onPick }: { row: DirectoryCohortDTO; onPick?: (cohortId: string) => void }) {
  const net = resolveNetwork(row.network);
  const full = row.joined >= row.capacity;
  const openSeats = row.capacity - row.joined;
  const joinable = isJoinable(row) && Boolean(onPick);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(row)}>{statusLabel(row)}</Badge>
          <span className="text-sm text-muted">{beaconGloss(row.beaconType)}</span>
          <span
            className={
              net.isMainnet
                ? 'rounded-full border border-bad/50 bg-bad/10 px-3 py-1 text-xs font-semibold text-bad'
                : 'rounded-full border border-edge bg-surface px-3 py-1 text-xs text-faint'
            }
          >
            {net.isMainnet ? `${net.label} · REAL FUNDS` : net.label}
          </span>
        </div>
        <Button
          variant="primary"
          disabled={!joinable}
          onClick={onPick ? () => onPick(row.cohortId) : undefined}
        >
          Join
        </Button>
      </div>

      <div className="flex flex-wrap gap-6">
        <div className="space-y-0.5">
          <MetricLabel>Seats</MetricLabel>
          <div className="text-sm text-ink tabular-nums">
            {row.joined}/{row.capacity} seats
          </div>
          <div className="text-xs text-faint">{full ? 'Full' : `${openSeats} open`}</div>
        </div>
        <div className="space-y-0.5">
          <MetricLabel>Co-sign</MetricLabel>
          <div className="text-sm text-ink tabular-nums">
            Co-sign: {row.threshold}-of-{row.threshold}
          </div>
          <div className="text-xs text-faint">all signers required</div>
        </div>
      </div>

      <CopyField label="Cohort ID" value={row.cohortId} />
    </Card>
  );
}
