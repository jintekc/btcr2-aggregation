import { useEffect } from 'react';
import { Badge, Button, Card, CopyField, Expander, Mono, SectionTitle, StatusDot } from '../../ui/primitives';
import { LogPanel } from '../LogPanel';
import { OperatorStageTimeline } from './OperatorStageTimeline';
import { FundingStage } from './FundingStage';
import { useOperator } from '../../stores/operator';
import { useParticipant } from '../../stores/participant';
import { downloadExport } from '../../lib/operator';
import type { AnchorDTO } from '../../lib/anchor';
import type { CohortMemberDTO, MemberRound, SubmissionDTO } from '../../lib/operator';
import type { LogEntry } from '../../lib/types';

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

/**
 * Render a server wall-clock ms stamp as a local `HH:MM:SS` time (D-22/D-30). The operator
 * activity log and submission times carry SERVER wall-clock stamps, not the participant-side
 * elapsed offset, so they render as a real clock time rather than a `mm:ss.mmm` duration.
 */
function fmtWallClock(t: number): string {
  return new Date(t).toLocaleTimeString();
}

/** The fixed round-state chip tone map (UI-SPEC Members, D-31). */
const ROUND_LABEL: Record<MemberRound, string> = {
  seated: 'Seated',
  submitted: 'Submitted',
  validated: 'Validated',
  'nonce-sent': 'Nonce sent',
  rejected: 'Rejected',
};
const ROUND_TONE: Record<MemberRound, 'neutral' | 'accent' | 'bad'> = {
  seated: 'neutral',
  submitted: 'accent',
  validated: 'accent',
  'nonce-sent': 'accent',
  rejected: 'bad',
};

/** One seated member row: shortened DID + copy-full, round-state chip, and a Technical detail expander (D-28/D-31). */
function SeatedRow({ member }: { member: CohortMemberDTO }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Mono className="text-ink">{shortDid(member.did)}</Mono>
        <Badge tone={ROUND_TONE[member.round]}>{ROUND_LABEL[member.round]}</Badge>
      </div>
      <CopyField label="member did" value={member.did} />
      {member.participantPk || member.communicationPk ? (
        <Expander title="Technical detail">
          <div className="space-y-2">
            {member.participantPk ? <CopyField label="participant pk" value={member.participantPk} /> : null}
            {member.communicationPk ? <CopyField label="communication pk" value={member.communicationPk} /> : null}
          </div>
        </Expander>
      ) : null}
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

/** One submission row: who submitted and when, with the raw signed update behind an expander (D-30). */
function SubmissionRow({ submission }: { submission: SubmissionDTO }) {
  return (
    <div className="space-y-2">
      {submission.submitted ? (
        <p className="text-sm text-muted">
          <Mono className="text-ink">{shortDid(submission.did)}</Mono>
          {submission.at !== undefined ? ` submitted at ${fmtWallClock(submission.at)}` : ' submitted'}
        </p>
      ) : (
        <p className="text-sm text-faint">
          <Mono className="text-muted">{shortDid(submission.did)}</Mono>: not yet submitted
        </p>
      )}
      {submission.raw !== undefined ? (
        <Expander title="Raw signed update">
          <pre className="whitespace-pre-wrap break-all font-mono text-xs text-muted">
            {JSON.stringify(submission.raw, null, 2)}
          </pre>
        </Expander>
      ) : null}
    </div>
  );
}

/**
 * The operator anchor sub-steps (D-18), mirroring the participant `AnchorSubSteps` pattern:
 * Signed -> Broadcast (txid + explorer link) -> Confirmed. "Anchored" narration is reserved
 * for a confirmed anchor only; a failed broadcast marks the reached-but-unconfirmed step bad.
 */
function OperatorAnchorSubSteps({ anchor }: { anchor: AnchorDTO }) {
  const broadcastReached = anchor.state === 'broadcast' || anchor.state === 'confirmed';
  const confirmed = anchor.state === 'confirmed';
  const failedAnchor = anchor.state === 'failed';
  const sub: { label: string; done: boolean; bad?: boolean }[] = [
    { label: 'Signed', done: true },
    { label: 'Broadcast', done: broadcastReached, bad: failedAnchor && !broadcastReached },
    { label: 'Confirmed', done: confirmed, bad: failedAnchor && broadcastReached },
  ];
  return (
    <ol className="ml-1 space-y-1.5 border-l border-edge pl-4">
      {sub.map((s) => (
        <li key={s.label} className="flex items-center gap-2">
          <StatusDot
            tone={s.bad ? 'bad' : s.done ? 'good' : 'neutral'}
            label={`${s.label}: ${s.done ? 'done' : 'pending'}`}
          />
          <span className={s.done ? 'text-xs text-muted' : 'text-xs text-faint'}>{s.label}</span>
        </li>
      ))}
      {broadcastReached && anchor.txid ? (
        <li className="flex flex-wrap items-center gap-2 pl-0 text-xs text-faint">
          <Mono className="break-all">{anchor.txid}</Mono>
          {anchor.explorerUrl ? (
            <a
              href={anchor.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline decoration-dotted underline-offset-2 hover:brightness-110"
            >
              View on explorer
            </a>
          ) : null}
        </li>
      ) : null}
    </ol>
  );
}

/**
 * The operator drill-down for one advertised cohort (SVC-03, D-01/D-03/D-05). It polls the
 * gated per-cohort detail read while open and renders, top-to-bottom (D-05): the cohort
 * lifecycle stage timeline, the members (round-state chips + pubkeys behind a Technical detail
 * expander), submissions (who/when + raw signed update), honest co-sign progress (with the
 * honest partial-sig limit, D-32), the operator anchor detail (D-18/D-33), and the per-cohort
 * activity log (D-21/D-22). The JSON export card lands in Task 3.
 *
 * Loading + failure stay honest (UI-SPEC E4/E5): until the first read lands the sections show
 * their documented empty lines with no invented spinner; a 401 poll routes the store to the
 * logged-out state, while an unreachable poll freezes the last-known view and raises the
 * bad-tone unreachable banner (D-25). Every positive terminal claim is mode-honest: "Anchored"
 * only at a confirmed anchor, and the partial-signature leg is never given an invented count.
 */
export function CohortDetail({ baseUrl, cohortId }: { baseUrl: string; cohortId: string }) {
  const detail = useOperator((s) => s.detail);
  const detailStale = useOperator((s) => s.detailStale);
  const lastUpdated = useOperator((s) => s.lastUpdated);
  const pollDetail = useOperator((s) => s.pollDetail);
  const closeCohort = useOperator((s) => s.closeCohort);
  // The service's single active network, for the funding stage's beacon-address label (D-36).
  const activeNetwork = useParticipant((s) => s.network);

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

      {detail ? (
        <>
          {/* Stage timeline: the visual anchor at the top of the page (D-05). */}
          <Card className="p-5">
            <OperatorStageTimeline detail={detail} />
          </Card>

          {/* Members. */}
          <Card className="space-y-4 p-5">
            <SectionTitle>Members</SectionTitle>
            {detail.members.length === 0 ? (
              <p className="text-sm text-muted">
                No one has joined yet. Seats: {detail.seatsJoined}/{detail.capacity}.
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  Seats: {detail.seatsJoined}/{detail.capacity}.
                </p>
                {seated.length > 0 ? (
                  <div className="space-y-4">
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
            )}
          </Card>

          {/* Submissions (D-30). */}
          <Card className="space-y-4 p-5">
            <SectionTitle>Submissions</SectionTitle>
            {detail.submissions.length === 0 ? (
              <p className="text-sm text-muted">No seated members yet.</p>
            ) : (
              <div className="space-y-3">
                {detail.submissions.map((submission) => (
                  <SubmissionRow key={submission.did} submission={submission} />
                ))}
              </div>
            )}
          </Card>

          {/* Co-sign progress (D-32, honest partial-sig limit). */}
          <Card className="space-y-3 p-5">
            <SectionTitle>Co-sign</SectionTitle>
            {detail.coSign.awaitingPartialSigs ? (
              // The partial-signature leg emits NO event: render the honest awaiting line with
              // NO per-member or k-of-n count (D-32).
              <p className="text-sm text-muted">
                All {detail.coSign.total} nonces received. Awaiting partial signatures.
              </p>
            ) : (
              <p className="text-sm text-muted">
                {detail.coSign.noncesReceived} of {detail.coSign.total} nonces received.
              </p>
            )}
            {seated.some((m) => m.round === 'nonce-sent') ? (
              <div className="flex flex-wrap gap-2">
                {seated
                  .filter((m) => m.round === 'nonce-sent')
                  .map((m) => (
                    <Badge key={m.did} tone="accent">
                      Nonce sent
                    </Badge>
                  ))}
              </div>
            ) : null}
          </Card>

          {/* Funding stage (D-36 through D-42): live+broadcast cohorts only, inserted between
              co-signing and anchor. Absent (no funding view) on a hermetic cohort. */}
          {detail.funding ? (
            <FundingStage funding={detail.funding} activeNetwork={activeNetwork} />
          ) : null}

          {/* Anchor detail (D-18/D-33). */}
          <Card className="space-y-3 p-5">
            <SectionTitle>Anchor</SectionTitle>
            {detail.anchor.enabled ? (
              <>
                <OperatorAnchorSubSteps anchor={detail.anchor} />
                {detail.fallback.used ? (
                  <p className="text-sm text-muted">
                    This cohort anchored via the k-of-n fallback path with {detail.fallback.k ?? '?'} of{' '}
                    {detail.fallback.n ?? '?'} signatures.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted">
                This no-broadcast service does not publish to Bitcoin, so there is no on-chain anchor to
                show.
              </p>
            )}
          </Card>

          {/* Activity log (D-21/D-22): server wall-clock timestamps, fixed-height internal scroll. */}
          <Card className="p-5">
            <LogPanel
              title="Activity"
              entries={detail.activity as LogEntry[]}
              emptyHint="No activity yet."
              formatTime={fmtWallClock}
              className="h-[24rem]"
            />
          </Card>

          {/* Export (D-34): a gated per-cohort JSON download of exactly this drill-down + the log. */}
          <Card className="space-y-3 p-5">
            <SectionTitle>Export</SectionTitle>
            <Button variant="ghost" onClick={() => void downloadExport(baseUrl, cohortId)}>
              Download monitoring record (JSON)
            </Button>
            <p className="text-sm text-muted">
              Downloads exactly what this page shows, plus the activity log. Off-chain artifacts stay
              referenced by hash at /cas/.
            </p>
          </Card>
        </>
      ) : (
        // First-poll checking window (UI-SPEC E4/E5 loading): documented empty line, no spinner.
        <Card className="space-y-4 p-5">
          <SectionTitle>Members</SectionTitle>
          <p className="text-sm text-muted">Loading members from this service.</p>
        </Card>
      )}
    </div>
  );
}
