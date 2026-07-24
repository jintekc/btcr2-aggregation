import { useEffect, useRef, useState } from 'react';
import { deriveStage, terminalReason, useParticipant } from '../../stores/participant';
import { fmtElapsed } from '../../lib/clock';
import type { LogLevel } from '../../lib/types';
import { Badge, Button, Card, CopyField, SectionTitle } from '../../ui/primitives';
import { StageTimeline } from './StageTimeline';
import { SubmitPanel } from './SubmitPanel';
import { CompletionSummary } from './CompletionSummary';

/** Log-line tone -> text color for the activity log inside the technical-detail expander. */
const LEVEL_CLASS: Record<LogLevel, string> = {
  info: 'text-muted',
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-bad',
};

/** A collapsed-by-default detail section that scrolls its overflow rather than growing the card. */
function Expander({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-edge bg-surface-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint"
      >
        <span>{title}</span>
        <span>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? <div className="max-h-80 overflow-auto border-t border-edge px-4 py-3">{children}</div> : null}
    </div>
  );
}

/**
 * The one continuous live cohort page (PART-03, D-01/D-02). It absorbs the Phase-2
 * waiting/seated states into a single surface driven entirely by the store's pure
 * {@link deriveStage} render authority: the stage timeline (the primary visual anchor), the
 * explicit submit moment (via {@link SubmitPanel}), the mode-honest Signed outcome, a compact
 * identity section with the key-custody note, the keep-tab-open note, and a technical-detail
 * expander holding the raw protocol facts and the timestamped client activity log (D-06/D-27).
 *
 * Anchor tracking, resolution, and the full degraded/terminal states land in 03-06; this plan
 * renders the browse -> pick -> join -> submit -> co-sign -> Signed loop honestly through Signed.
 * Mode honesty (D-07): the Signed copy branches on the anchor read's `enabled` bit and never
 * claims an on-chain anchor or a txid on the hermetic no-broadcast path.
 */
export function CohortPage({ baseUrl: _baseUrl, onBrowse }: { baseUrl: string; onBrowse: () => void }) {
  const status = useParticipant((s) => s.status);
  const optedIn = useParticipant((s) => s.optedIn);
  const seated = useParticipant((s) => s.seated);
  const pendingSubmit = useParticipant((s) => s.pendingSubmit);
  const steps = useParticipant((s) => s.steps);
  const anchor = useParticipant((s) => s.anchor);
  const resolveStatus = useParticipant((s) => s.resolveStatus);

  const did = useParticipant((s) => s.did);
  const idType = useParticipant((s) => s.idType);
  const secret = useParticipant((s) => s.secret);
  const cohortId = useParticipant((s) => s.cohortId);
  const beaconAddress = useParticipant((s) => s.beaconAddress);
  const log = useParticipant((s) => s.log);
  const leave = useParticipant((s) => s.leave);
  const unreachable = useParticipant((s) => s.unreachable);
  const liveCohort = useParticipant((s) => s.liveCohort);
  const awaitingFunding = useParticipant((s) => s.awaitingFunding);
  const validationRequested = useParticipant((s) => s.validationRequested);
  const error = useParticipant((s) => s.error);
  const startOver = useParticipant((s) => s.startOver);

  const stage = deriveStage({ status, optedIn, seated, pendingSubmit, steps, anchor, resolveStatus });
  const failed = status === 'failed';
  const hasCohort =
    status === 'connecting' || status === 'live' || status === 'complete' || seated || optedIn;

  // Quiet elapsed indicator for the active stage (D-05): reset the clock on each stage change
  // and tick every second so "Active for {mm:ss}" advances without a countdown or a promise.
  const [stageEnteredAt, setStageEnteredAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const prevStage = useRef(stage);
  useEffect(() => {
    if (prevStage.current !== stage) {
      prevStage.current = stage;
      setStageEnteredAt(Date.now());
      setNow(Date.now());
    }
  }, [stage]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Confirmation for Leave (D-09): only offered while waiting for seats; once co-signing starts
  // the seat is committed through anchoring and Leave is hidden.
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Confirmation for Start over (D-10): the identity wipe is irreversible, so it sits behind an
  // explicit danger-variant key-custody confirmation. Offered only from a terminal state.
  const [confirmStartOver, setConfirmStartOver] = useState(false);

  if (!hasCohort) {
    // Empty state (E1/E9): the timeline renders only for a joined cohort.
    return (
      <Card className="space-y-3 p-5">
        <h2 className="text-xl font-semibold text-ink">No cohort joined yet</h2>
        <p className="text-sm text-muted">
          Browse this service&apos;s open cohorts and join one to submit a DID update.
        </p>
        <Button onClick={onBrowse}>Browse cohorts</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionTitle>Your cohort</SectionTitle>
          <Button variant="ghost" onClick={onBrowse}>
            Browse cohorts
          </Button>
        </div>
        <StageTimeline
          stage={stage}
          failed={failed}
          activeElapsedMs={now - stageEnteredAt}
          anchor={anchor}
        />
      </Card>

      {/* Live-cohort funding notice + honest wait copy (D-44). A LIVE (on-chain) cohort anchors its
          beacon on Bitcoin, and the operator funds that beacon address only after seats fill, so the
          participant sees WHY co-signing may pause (waiting on funding) instead of a bare spinner. The
          notice shows on any live cohort still in flight; the wait line adds only while the public
          funding read reports the beacon still unfunded. A hermetic cohort surfaces neither. */}
      {liveCohort && !failed && status !== 'complete' ? (
        <Card className="space-y-1 border-edge-strong p-5">
          <p className="text-sm text-ink">
            This cohort anchors on-chain. The operator funds its beacon address after seats fill, so
            keep this tab open.
          </p>
          {awaitingFunding ? (
            <p className="text-sm text-muted">
              Waiting for the operator to fund this cohort&apos;s beacon address.
            </p>
          ) : null}
        </Card>
      ) : null}

      {!failed && stage === 'submit-window' && cohortId ? (
        <SubmitPanel baseUrl={_baseUrl} cohortId={cohortId} />
      ) : null}

      {/* Transient "can't reach this service" banner (D-24, E7): quiet auto-retry, the timeline
          above stays frozen, and this is NEVER a terminal by itself (a successful poll clears it). */}
      {unreachable && !failed ? (
        <Card className="space-y-1 border-warn/40 bg-warn/10 p-5">
          <p className="text-sm text-warn">Can&apos;t reach this service</p>
          <p className="text-sm text-warn/80">
            We&apos;ll keep trying to reconnect. Your place in the cohort is unaffected as long as this tab
            stays open.
          </p>
        </Card>
      ) : null}

      {/* Terminal failure (D-25, E7): a best-effort specific reason with the honest fallback,
          landed ON the cohort page (not a browse-directory error card). */}
      {failed ? (
        <Card className="space-y-3 border-bad/40 bg-bad/10 p-5">
          <p className="text-sm text-bad">{terminalReason({ error, steps, validationRequested })}</p>
          <Button
            variant="ghost"
            onClick={() => {
              leave();
              onBrowse();
            }}
          >
            Back to cohorts
          </Button>
        </Card>
      ) : null}

      {status === 'complete' ? <CompletionSummary baseUrl={_baseUrl} onBrowse={onBrowse} /> : null}

      <Card className="space-y-3 p-5">
        <SectionTitle>Your identity</SectionTitle>
        {did ? <CopyField label="did" value={did} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{idType === 'EXTERNAL' ? 'EXTERNAL (x1)' : 'KEY (k1)'}</Badge>
        </div>
        {secret ? <CopyField label="secret (save to re-import)" value={secret} /> : null}
        <p className="text-xs text-faint">
          You hold this key in your browser only. It is never sent to the service.
        </p>
      </Card>

      {!failed && status !== 'complete' ? (
        <p className="text-xs text-faint">
          Keep this tab open. Refreshing loses your seat, and this service does not save your session yet.
        </p>
      ) : null}

      <Expander title="Technical detail">
        <div className="space-y-3">
          <div className="text-xs text-muted">
            Current stage: <span className="text-ink">{stage}</span>
          </div>
          {cohortId ? <CopyField label="cohort id" value={cohortId} /> : null}
          {beaconAddress ? <CopyField label="beacon address" value={beaconAddress} /> : null}
          <div className="space-y-1">
            <div className="text-[0.65rem] uppercase tracking-wider text-faint">Activity log</div>
            {log.length === 0 ? (
              <p className="text-xs text-faint">No activity yet.</p>
            ) : (
              <div className="space-y-1">
                {log.map((entry) => (
                  <div key={entry.id} className="flex gap-2 text-xs">
                    <span className="shrink-0 font-mono tabular-nums text-faint">{fmtElapsed(entry.t)}</span>
                    <span className={LEVEL_CLASS[entry.level]}>{entry.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Expander>

      {stage === 'waiting-for-seats' && !failed ? (
        confirmLeave ? (
          <Card className="space-y-3 border-edge-strong p-5">
            <p className="text-sm text-muted">
              Leave this cohort? You can browse and join another. Once co-signing starts you are committed
              through anchoring.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  leave();
                  onBrowse();
                }}
              >
                Leave cohort
              </Button>
              <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
                Stay
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmLeave(true)}>
            Leave
          </Button>
        )
      ) : null}

      {/* Start over from any terminal state (D-10, E8): wipe the in-memory DID key behind an
          explicit danger-variant key-custody confirmation, after the sidecar export offer above. */}
      {status === 'complete' || failed ? (
        confirmStartOver ? (
          <Card className="space-y-3 border-bad/40 bg-bad/10 p-5">
            <p className="text-sm text-bad">
              This clears this cohort&apos;s result and erases the DID key held in your browser. This key
              cannot be recovered. Export the sidecar first if you need it. Continue?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => startOver()}>
                Start over
              </Button>
              <Button variant="ghost" onClick={() => setConfirmStartOver(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="danger" onClick={() => setConfirmStartOver(true)}>
            Start over
          </Button>
        )
      ) : null}
    </div>
  );
}
