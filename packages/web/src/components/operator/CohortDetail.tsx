import { useEffect } from 'react';
import { Badge, Button, Card, CopyField, Mono, SectionTitle, StatusDot } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';
import type { CohortMemberDTO } from '../../lib/operator';

/** Poll interval for the open cohort's detail read (SVC-03; D-19 polled snapshot). */
const POLL_INTERVAL_MS = 4000;

/** The unreachable banner copy (UI-SPEC D-25), shown when a poll cannot reach the service. */
const UNREACHABLE_BANNER = "Can't reach this service. Showing the last known state and retrying quietly.";

/** Shorten a cohort id for the page heading; the full id is available via a CopyField. */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Shorten a long DID for display; the full DID is available via the row's CopyField. */
function shortDid(did: string): string {
  return did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did;
}

/** One seated member row: shortened DID display plus copy-full (D-28). */
function SeatedRow({ member }: { member: CohortMemberDTO }) {
  return (
    <div className="space-y-1.5">
      <Mono className="block text-ink">{shortDid(member.did)}</Mono>
      <CopyField label="member did" value={member.did} />
    </div>
  );
}

/** One pending opt-in row, kept visually distinct from seated members (D-29). */
function PendingRow({ member }: { member: CohortMemberDTO }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="neutral">Pending</Badge>
      <Mono className="text-muted">{shortDid(member.did)}</Mono>
      <span className="text-sm text-muted">Joining, not yet seated.</span>
    </div>
  );
}

/**
 * The operator drill-down for one advertised cohort (SVC-03, D-01/D-03/D-05). The tracer
 * scope: it polls the gated per-cohort detail read while open and renders the live members
 * (seated vs pending) plus the seat count. The submissions / co-sign / anchor / funding /
 * activity concern sections land in later plans on top of this proven seam.
 *
 * Loading + failure are honest (UI-SPEC E4/E5): until the first read lands, the freshness
 * dot is in a neutral checking state and the Members section shows its documented empty
 * lines with no invented spinner; a 401 poll routes the store to the logged-out state
 * (handled in the store), while an unreachable poll freezes the last-known view and raises
 * the bad-tone unreachable banner (D-25).
 */
export function CohortDetail({ baseUrl, cohortId }: { baseUrl: string; cohortId: string }) {
  const detail = useOperator((s) => s.detail);
  const detailStale = useOperator((s) => s.detailStale);
  const lastUpdated = useOperator((s) => s.lastUpdated);
  const pollDetail = useOperator((s) => s.pollDetail);
  const closeCohort = useOperator((s) => s.closeCohort);

  // Poll the detail read while the drill-down is open: an immediate read, then every few
  // seconds (D-19). The interval is cleared on unmount / cohort change so a closed
  // drill-down stops polling (the store's pollDetail is also a no-op off the detail view).
  useEffect(() => {
    void pollDetail(baseUrl);
    const timer = setInterval(() => void pollDetail(baseUrl), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [baseUrl, cohortId, pollDetail]);

  // Freshness indicator (D-25): checking before the first read, stale (warn) after an
  // unreachable poll, good once a read has landed.
  const freshness = detailStale
    ? { tone: 'warn' as const, label: 'Reconnecting' }
    : lastUpdated
      ? { tone: 'good' as const, label: 'Live' }
      : { tone: 'neutral' as const, label: 'Checking freshness' };

  const seated = detail?.members.filter((m) => m.status === 'seated') ?? [];
  const pending = detail?.members.filter((m) => m.status === 'pending') ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => closeCohort()}>
          Back to cohorts
        </Button>
        <div className="flex items-center gap-2">
          <StatusDot tone={freshness.tone} label={freshness.label} />
          <span className="text-xs uppercase tracking-[0.14em] text-faint">{freshness.label}</span>
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Cohort {shortId(cohortId)}</h1>
        <CopyField label="cohort id" value={cohortId} />
      </div>

      {detailStale ? (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {UNREACHABLE_BANNER}
        </div>
      ) : null}

      <Card className="space-y-4 p-5">
        <SectionTitle>Members</SectionTitle>
        {detail && detail.members.length === 0 ? (
          <p className="text-sm text-muted">
            No one has joined yet. Seats: {detail.seatsJoined}/{detail.capacity}.
          </p>
        ) : detail ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Seats: {detail.seatsJoined}/{detail.capacity}.
            </p>
            {seated.length > 0 ? (
              <div className="space-y-3">
                {seated.map((member) => (
                  <SeatedRow key={member.did} member={member} />
                ))}
              </div>
            ) : null}
            {pending.length > 0 ? (
              <div className="space-y-2">
                {pending.map((member) => (
                  <PendingRow key={member.did} member={member} />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          // First-poll checking window (UI-SPEC E4/E5 loading): documented empty line, no spinner.
          <p className="text-sm text-muted">Loading members from this service.</p>
        )}
      </Card>
    </div>
  );
}
