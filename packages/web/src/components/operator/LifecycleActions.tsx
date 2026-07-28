import { useState } from 'react';
import { Button, Card, ConfirmPanel, Mono, SectionTitle } from '../../ui/primitives';
import { cancelAvailability, cancelRung, cohortShortId } from '../../lib/lifecycle';
import { CANCEL_BUSY, useOperator } from '../../stores/operator';
import { useParticipant } from '../../stores/participant';
import type { CohortDetailDTO } from '../../lib/operator';

/**
 * The `Lifecycle` section of the cohort drill-down (SVC-04, Phase 5 D-01/D-03/D-04).
 *
 * It offers only HONEST primitives. `Cancel cohort` wraps the service's own cancel verb and is
 * available from Advertised through the signing stages, right up to the moment the beacon
 * transaction broadcasts. After that the control is HIDDEN, not disabled, and replaced by the
 * line explaining there is nothing left to cancel: a disabled button would imply the act is still
 * possible under some condition, and it is not. There is deliberately no `Close` button - closing
 * is the automatic lock when the nth seat fills, narrated by the stage timeline (D-01).
 *
 * Every availability and ceremony decision comes from the pure predicates in
 * {@link file://../../lib/lifecycle.ts}, so the rules are unit-tested without a DOM and this
 * component only renders them.
 *
 * The confirmation ladder (D-03) sets friction by stakes:
 *
 * - Rung 3, an ordinary cohort: one explicit confirm that names the cohort and its seated count,
 *   because the people who lose their seats are the real consequence.
 * - Rung 4, a cohort whose beacon address has received funds: the same, plus the recovery-key
 *   situation in plain words and a typed cohort id before the confirm button arms. Only the
 *   recovery-key STATE crosses to the browser, never key material (the 04 T-04-06-04 pin).
 *
 * The tone is never the only carrier of meaning: each body names the irreversible outcome in
 * words. A failed cancel renders the action-error line and changes nothing on screen (the Canceled
 * chip only ever arrives from the served projection).
 */

/** Exact 05-UI-SPEC copy, all em-dash-free. */
const CANCEL_LABEL = 'Cancel cohort';
const AVAILABILITY_NOTE = "Available until this cohort's beacon transaction is broadcast.";
const AFTER_BROADCAST =
  "This cohort's beacon transaction is already broadcast, so there is nothing left to cancel.";
const KEEP_RUNNING = 'Keep it running';
const RUNG3_HEADING = 'Cancel this cohort?';
const RUNG4_HEADING = 'Cancel this funded cohort?';
const RUNG4_CONFIRM = 'Cancel funded cohort';
const RECOVERY_OPERATOR_HELD =
  "Operator-held recovery key: you can recover the funds sent to this cohort's beacon address.";
const RECOVERY_THROWAWAY =
  "Throwaway recovery key: funds sent to this cohort's beacon address are unrecoverable.";

/** A seat count rendered inline in Body weight 600 with tabular figures (UI-SPEC Typography). */
function Seats({ n }: { n: number }) {
  return <span className="font-semibold tabular-nums">{n}</span>;
}

/**
 * The rung-3 body: an ordinary (unfunded, or not-yet-funded) cohort. The zero-seat variant is a
 * different sentence, not a pluralization patch, because "no one has joined yet" is genuinely a
 * different fact from "these people lose their seats".
 */
function rung3Body(short: string, seats: number) {
  if (seats === 0) {
    return (
      <p>
        No one has joined cohort <Mono>{short}</Mono> yet. Canceling removes it from the directory so it
        can never be joined or anchored. This cannot be undone.
      </p>
    );
  }
  return (
    <p>
      Cohort <Mono>{short}</Mono> has <Seats n={seats} /> seated participants. Canceling ends the cohort
      for all of them: seats are lost, joining stops, and it will never anchor. This cannot be undone.
    </p>
  );
}

/**
 * The rung-4 body: real money is already at this cohort's beacon address. Line 1 names the loss,
 * line 2 states the recovery-key situation, reusing the 04 D-40 disclosure so the operator learns
 * whether those funds are recoverable BEFORE the confirm button can arm.
 */
function rung4Body(short: string, seats: number, network: string, operatorHeld: boolean) {
  return (
    <>
      <p>
        Cohort <Mono>{short}</Mono> is funded on {network}. Canceling ends it for its <Seats n={seats} />{' '}
        seated participants, and it will never anchor.
      </p>
      <p>{operatorHeld ? RECOVERY_OPERATOR_HELD : RECOVERY_THROWAWAY}</p>
    </>
  );
}

export function LifecycleActions({ baseUrl, cohortId }: { baseUrl: string; cohortId: string }) {
  // Subscribe per field (never the whole store), matching CreateCohortForm.
  const detail = useOperator((s) => s.detail);
  const cancelling = useOperator((s) => s.cancelling);
  const cancelCohort = useOperator((s) => s.cancelCohort);
  const actionError = useOperator((s) => s.actionError);
  // The service's single active network, for the rung-4 funded-on line (the FundingStage precedent).
  const activeNetwork = useParticipant((s) => s.network);
  const [confirming, setConfirming] = useState(false);

  const availability = cancelAvailability(detail);
  // Nothing observed yet, or nothing left to act on: render NO control at all, so a control never
  // appears and then vanishes (UI-SPEC E1 loading). The `detail` guard also narrows the type.
  if (availability === 'unavailable' || !detail) {
    return null;
  }

  return (
    <Card className="space-y-3 p-5">
      <SectionTitle>Lifecycle</SectionTitle>
      {availability === 'broadcast' ? (
        <p className="text-sm text-muted">{AFTER_BROADCAST}</p>
      ) : confirming ? (
        <CancelConfirm
          detail={detail}
          cohortId={cohortId}
          activeNetwork={activeNetwork}
          busy={cancelling === cohortId}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void cancelCohort(baseUrl, cohortId)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {CANCEL_LABEL}
          </Button>
          <span className="text-sm text-muted">{AVAILABILITY_NOTE}</span>
        </div>
      )}
      {actionError ? (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{actionError}</p>
      ) : null}
    </Card>
  );
}

/** The confirmation panel for whichever rung this cohort's stakes call for (D-03). */
function CancelConfirm({
  detail,
  cohortId,
  activeNetwork,
  busy,
  onConfirm,
  onCancel,
}: {
  detail: CohortDetailDTO;
  cohortId: string;
  activeNetwork: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const short = cohortShortId(cohortId);
  const seats = detail.seatsJoined;
  if (cancelRung(detail) === 4) {
    return (
      <ConfirmPanel
        tone="bad"
        heading={RUNG4_HEADING}
        body={rung4Body(short, seats, activeNetwork, detail.funding?.recoveryKeyState === 'operator-held')}
        typeToConfirm={short}
        confirmLabel={RUNG4_CONFIRM}
        cancelLabel={KEEP_RUNNING}
        busy={busy}
        busyLabel={CANCEL_BUSY}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }
  return (
    <ConfirmPanel
      tone="bad"
      heading={RUNG3_HEADING}
      body={rung3Body(short, seats)}
      confirmLabel={CANCEL_LABEL}
      cancelLabel={KEEP_RUNNING}
      busy={busy}
      busyLabel={CANCEL_BUSY}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
