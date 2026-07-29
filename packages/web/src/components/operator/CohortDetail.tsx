import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  ConfirmPanel,
  CopyField,
  Expander,
  Mono,
  SectionTitle,
  StatusDot,
} from '../../ui/primitives';
import { LogPanel } from '../LogPanel';
import { OperatorStageTimeline } from './OperatorStageTimeline';
import { FundingStage } from './FundingStage';
import { LifecycleActions } from './LifecycleActions';
import { fmtWallClock } from '../../lib/clock';
import { seatReclaimNoteVisible } from '../../lib/lifecycle';
import {
  ADD_TEST_PEERS_BODY,
  ADD_TEST_PEERS_BUSY,
  ADD_TEST_PEERS_CANCEL_LABEL,
  ADD_TEST_PEERS_LABEL,
  addTestPeersConfirmLabel,
  addTestPeersHeading,
  addTestPeersHelp,
  liveTestPeersLine,
  NO_SEATS_LEFT_REASON,
  useOperator,
} from '../../stores/operator';
import { useParticipant } from '../../stores/participant';
import type { AnchorDTO } from '../../lib/anchor';
import type { CohortMemberDTO, MemberRound, SubmissionDTO } from '../../lib/operator';
import type { LogEntry } from '../../lib/types';

/** Poll interval for the open cohort's detail read (SVC-03; D-19 polled snapshot). */
const POLL_INTERVAL_MS = 4000;

/** The unreachable banner copy (UI-SPEC D-25), shown when a poll cannot reach the service. */
const UNREACHABLE_BANNER = "Can't reach this service. Showing the last known state and retrying quietly.";

/**
 * The honest seat-reclaim workaround, shown under Members while a cohort is still filling (D-18).
 *
 * There is no per-seat release control here because `@did-btcr2/aggregation@0.4.0` provides no
 * seat-release primitive at all: once a participant opts in, their seat is held until the whole
 * cohort ends. Rather than invent a control this app cannot honor, the console states the real
 * workaround in words. Per-seat reclaim is RE-PARKED pending an upstream API (one of the six
 * library limits the 04-08 live UAT documented); if that API lands, this note is what a genuine
 * `Release seat` control replaces.
 */
const SEAT_RECLAIM_NOTE =
  "A single seat can't be released. If someone joined and went quiet, cancel this cohort and advertise a new one, or wait for its discovery window to expire.";

/** Shorten a cohort id for the page heading; the full id is available via a CopyField. */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Shorten a long DID for display; the full DID is available via the row's CopyField. */
function shortDid(did: string): string {
  return did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did;
}

/** The fixed round-state chip tone map (UI-SPEC Members, D-31). */
const ROUND_LABEL: Record<MemberRound, string> = {
  seated: 'Seated',
  submitted: 'Submitted',
  validated: 'Validated',
  'nonce-sent': 'Nonce sent',
  rejected: 'Rejected',
};
/**
 * The member-row labels for a peer the operator added (SVC-04, D-17, UI-SPEC E11). Authored here
 * beside the other member-row labels this file renders inline, the same way `HealthStrip.tsx`
 * owns its chip labels: every label on a member row has one home, and the audit grep that proves
 * both the badge and the line render reads this file.
 */
const TEST_PEER_BADGE = 'Test peer';
const TEST_PEER_ROW_LINE = 'Test peer added by the operator.';

const ROUND_TONE: Record<MemberRound, 'neutral' | 'accent' | 'bad'> = {
  seated: 'neutral',
  submitted: 'accent',
  validated: 'accent',
  'nonce-sent': 'accent',
  rejected: 'bad',
};

/**
 * One seated member row: shortened DID + copy-full, round-state chip, and a Technical detail
 * expander (D-28/D-31). A member the OPERATOR added as a test peer (D-17) carries an extra
 * NEUTRAL badge and a plain line, INLINE in this same list: a test peer really is a participant,
 * so pulling it into a separate section would misrepresent both the protocol and the cohort's
 * seat count. The badge is never accent toned, because a test peer is not a progress signal.
 */
function SeatedRow({ member }: { member: CohortMemberDTO }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Mono className="text-ink">{shortDid(member.did)}</Mono>
        <Badge tone={ROUND_TONE[member.round]}>{ROUND_LABEL[member.round]}</Badge>
        {member.testPeer ? <Badge tone="neutral">{TEST_PEER_BADGE}</Badge> : null}
      </div>
      {member.testPeer ? <p className="text-sm text-muted">{TEST_PEER_ROW_LINE}</p> : null}
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
      {/* A peer the operator added is badged from the moment it opts in, not only once seated:
          the operator should never have to wonder whose opt-in they are looking at. */}
      {member.testPeer ? <Badge tone="neutral">{TEST_PEER_BADGE}</Badge> : null}
      <span className="text-sm text-muted">
        {member.testPeer ? TEST_PEER_ROW_LINE : 'Joining, not yet seated.'}
      </span>
    </div>
  );
}

/**
 * The test-peer action (SVC-04, D-17, UI-SPEC E11), rendered inside the Members card because it is
 * about who is in this cohort's seats.
 *
 * `remaining` is recomputed from the SERVED detail on every render, so the label, the help line and
 * the confirm heading all name the same number the service would enforce a moment later; when it
 * reaches zero the control renders DISABLED with the real reason rather than vanishing, because
 * the act is a real one that simply has nothing left to do here.
 *
 * The confirm is rung 2 of the ceremony ladder: warn tone, one body, no typed value. Nothing is
 * destroyed by adding a peer. On a LIVE broadcasting service an extra line inside the SAME confirm
 * states that the peers co-sign for real and their DIDs are anchored on the named network, so the
 * operator learns it before committing rather than from a block explorer afterwards.
 */
function TestPeerAction({
  baseUrl,
  cohortId,
  remaining,
  live,
  network,
}: {
  baseUrl: string;
  cohortId: string;
  remaining: number;
  live: boolean;
  network: string;
}) {
  const addTestPeers = useOperator((s) => s.addTestPeers);
  const addingTestPeers = useOperator((s) => s.addingTestPeers);
  // Its OWN error field, not the shared `actionError`: this page already renders that one on the
  // Lifecycle card and again on the Export card, so reusing it would print one failure three times.
  const testPeerError = useOperator((s) => s.testPeerError);
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="space-y-2">
        <ConfirmPanel
          tone="warn"
          heading={addTestPeersHeading(remaining)}
          body={
            <>
              <p>{ADD_TEST_PEERS_BODY}</p>
              {live ? <p>{liveTestPeersLine(network)}</p> : null}
            </>
          }
          confirmLabel={addTestPeersConfirmLabel(remaining)}
          cancelLabel={ADD_TEST_PEERS_CANCEL_LABEL}
          busy={addingTestPeers === cohortId}
          busyLabel={ADD_TEST_PEERS_BUSY}
          onConfirm={() => void addTestPeers(baseUrl, cohortId)}
          onCancel={() => setConfirming(false)}
        />
        {/* A failed spawn: the cohort is unchanged, and the confirm stays open so the operator can
            retry or back out without hunting for the control again. */}
        {testPeerError ? (
          <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
            {testPeerError}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={remaining === 0} onClick={() => setConfirming(true)}>
          {ADD_TEST_PEERS_LABEL}
        </Button>
        <span className="text-sm text-muted">
          {remaining === 0 ? NO_SEATS_LEFT_REASON : addTestPeersHelp(remaining)}
        </span>
      </div>
      {testPeerError ? (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {testPeerError}
        </p>
      ) : null}
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
  // The export rides a store action (review WR-06) so a 401 takes the same honest re-login path
  // as every gated read, and a fault surfaces a message instead of a silent no-op click.
  const exportCohort = useOperator((s) => s.exportCohort);
  const actionError = useOperator((s) => s.actionError);
  // The SERVED broadcast mode (D-17): only a live BROADCASTING service anchors a test peer's DID,
  // so only that mode gets the extra confirm line. An absent health read makes no claim at all.
  const health = useOperator((s) => s.health);
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

          {/* Lifecycle controls (SVC-04, D-01/D-03/D-04): the cohort-level operator verbs, placed
              directly under the stage timeline so the act sits beside the state it changes. The
              section renders nothing at all until availability is observable. */}
          <LifecycleActions baseUrl={baseUrl} cohortId={cohortId} />

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
            {/* The honest seat-reclaim limit (D-18), only while there is still a seat to reclaim. */}
            {seatReclaimNoteVisible(detail) ? (
              <p className="text-sm text-muted">{SEAT_RECLAIM_NOTE}</p>
            ) : null}
            {/* Test peers (D-17): the operator's own participants, added into the seats of THIS
                cohort, so the control lives with the member list it changes. */}
            <TestPeerAction
              baseUrl={baseUrl}
              cohortId={cohortId}
              remaining={Math.max(0, detail.capacity - detail.seatsJoined)}
              live={health?.mode === 'live'}
              network={activeNetwork}
            />
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
            <Button variant="ghost" onClick={() => void exportCohort(baseUrl, cohortId)}>
              Download monitoring record (JSON)
            </Button>
            {actionError ? (
              <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
                {actionError}
              </p>
            ) : null}
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
