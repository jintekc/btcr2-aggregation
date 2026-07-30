import { useState } from 'react';
import { Button, Card, ConfirmPanel, Mono, SectionTitle } from '../../ui/primitives';
import { cancelAvailability, cancelRung, cohortShortId, finalizeAvailability } from '../../lib/lifecycle';
import { CANCEL_BUSY, FINALIZE_BUSY, useOperator } from '../../stores/operator';
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
 * `Finalize now` wraps the service's own k-of-n fallback verb, for the case a signing round has
 * stalled and the operator does not want to wait out (or lose the cohort to) the automatic stall
 * timer. It is offered ONLY while the cohort is in one of the library's three signing phases,
 * because the underlying primitive throws anywhere else; outside them it renders DISABLED with
 * the reason, rather than hidden, since the round genuinely is about to start.
 *
 * The confirmation ladder (D-03) sets friction by stakes:
 *
 * - Rung 2, finalize: a simple warn-tone confirm stating the k-of-n consequence. Nothing is lost
 *   that was not already stalled, so the ceremony is cheaper than a cancel's.
 * - Rung 3, an ordinary cohort: one explicit confirm that names the cohort and its seated count,
 *   because the people who lose their seats are the real consequence.
 * - Rung 4, a cohort whose beacon address has received funds: the same, plus the recovery-key
 *   situation in plain words and a typed cohort id before the confirm button arms. Only the
 *   recovery-key STATE crosses to the browser, never key material (the 04 T-04-06-04 pin).
 *
 * The tone is never the only carrier of meaning: each body names the irreversible outcome in
 * words. A failed action renders the action-error line and changes nothing on screen (the Canceled
 * chip and the committed-fallback state only ever arrive from the served projection).
 */

/**
 * Exact 05-UI-SPEC copy, all em-dash-free.
 *
 * The cancel family is EXPORTED (05-21, `05-AUDIT-2.md` entries 1 and 2) so the render assertions
 * in `packages/web/tests/lifecycle.spec.ts` compare against the shipped strings rather than
 * retyped copies of them, and so an em-dash guard can be taken over them at the source. A test
 * that retypes the sentence it is checking proves the tester can type, not that the product ships
 * that sentence.
 */
export const CANCEL_LABEL = 'Cancel cohort';
const AVAILABILITY_NOTE = "Available until this cohort's beacon transaction is broadcast.";
export const AFTER_BROADCAST =
  "This cohort's beacon transaction is already broadcast, so there is nothing left to cancel.";
export const KEEP_RUNNING = 'Keep it running';
export const RUNG3_HEADING = 'Cancel this cohort?';
export const RUNG4_HEADING = 'Cancel this funded cohort?';
export const RUNG4_CONFIRM = 'Cancel funded cohort';
export const RECOVERY_OPERATOR_HELD =
  "Operator-held recovery key: you can recover the funds sent to this cohort's beacon address.";
export const RECOVERY_THROWAWAY =
  "Throwaway recovery key: funds sent to this cohort's beacon address are unrecoverable.";
const FINALIZE_LABEL = 'Finalize now';
const FINALIZE_NOT_SIGNING = "Available once this cohort's signing round starts.";
const FINALIZE_COMMITTED = 'This cohort already finalized on the k-of-n fallback path.';
const FINALIZE_HEADING = 'Finalize this cohort now?';
const KEEP_WAITING = 'Keep waiting';

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

/**
 * The rung-2 finalize body: the k-of-n consequence stated BEFORE it happens (D-03). All three
 * sentences are load-bearing and none of them is carried by tone: what the fallback does, who is
 * left out of it, and the one way it can still fail to anchor.
 */
function finalizeBody(k: number, n: number) {
  return (
    <p>
      This stops waiting for every seat and anchors on the k-of-n fallback path with <Seats n={k} /> of{' '}
      <Seats n={n} /> signatures. Signers who have not signed yet are not included. If fewer than{' '}
      <Seats n={k} /> signatures have arrived, this cohort cannot anchor.
    </p>
  );
}

export function LifecycleActions({ baseUrl, cohortId }: { baseUrl: string; cohortId: string }) {
  // Subscribe per field (never the whole store), matching CreateCohortForm.
  const detail = useOperator((s) => s.detail);
  const cancelling = useOperator((s) => s.cancelling);
  const finalizing = useOperator((s) => s.finalizing);
  const cancelCohort = useOperator((s) => s.cancelCohort);
  const finalizeCohort = useOperator((s) => s.finalizeCohort);
  const actionError = useOperator((s) => s.actionError);
  // The service's single active network, for the rung-4 funded-on line (the FundingStage precedent).
  const activeNetwork = useParticipant((s) => s.network);
  const [confirming, setConfirming] = useState(false);
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);

  const availability = cancelAvailability(detail);
  const finalize = finalizeAvailability(detail);
  // Nothing observed yet, and nothing to act on or explain: render NO section at all, so a control
  // never appears and then vanishes (UI-SPEC E1 loading). The `detail` guard also narrows the type.
  if (!detail || (availability === 'unavailable' && finalize === 'unavailable')) {
    return null;
  }

  // k and n come from the SERVED projection, never a local guess. `capacity` is the last-resort
  // source for n (it is the same number the monitor derives it from) and the honest n-of-n reading
  // for k on the rare projection that could not derive the threshold.
  const n = detail.fallback.n ?? detail.capacity;
  const k = detail.fallback.k ?? n;

  return (
    <Card className="space-y-3 p-5">
      <SectionTitle>Lifecycle</SectionTitle>
      {availability === 'unavailable' ? null : availability === 'broadcast' ? (
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

      {/* Finalize now (D-01). Rendered below the cancel block, and independently of it: a cohort
          whose beacon tx is already out has nothing left to cancel but may still need to explain
          that it finalized on the fallback path. */}
      {finalize === 'unavailable' ? null : finalize === 'committed' ? (
        <p className="text-sm text-muted">{FINALIZE_COMMITTED}</p>
      ) : confirmingFinalize ? (
        <ConfirmPanel
          // Warn, NOT danger: nothing is destroyed here. The round was already stalled, and the
          // fallback is the path that still anchors it.
          tone="warn"
          heading={FINALIZE_HEADING}
          body={finalizeBody(k, n)}
          confirmLabel={FINALIZE_LABEL}
          cancelLabel={KEEP_WAITING}
          busy={finalizing === cohortId}
          busyLabel={FINALIZE_BUSY}
          onConfirm={() => void finalizeCohort(baseUrl, cohortId)}
          onCancel={() => setConfirmingFinalize(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            // Disabled, not hidden: unlike a cancel after broadcast, this WILL become possible, so
            // the honest shape is a visible control with the reason for the wait beside it.
            disabled={finalize === 'not-signing'}
            onClick={() => setConfirmingFinalize(true)}
          >
            {FINALIZE_LABEL}
          </Button>
          {finalize === 'not-signing' ? (
            <span className="text-sm text-muted">{FINALIZE_NOT_SIGNING}</span>
          ) : null}
        </div>
      )}

      {actionError ? (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{actionError}</p>
      ) : null}
    </Card>
  );
}

/**
 * The confirmation panel for whichever rung this cohort's stakes call for (D-03).
 *
 * EXPORTED for one reason (05-21, `05-AUDIT-2.md` entry 1): this is the highest-stakes branch on
 * this surface, and in the running app the panel is only reachable after a click. A static render
 * cannot click, so the component the click reveals is rendered directly instead. It already takes
 * pure props, holds no state and subscribes to no store, so exporting it costs one keyword and
 * changes nothing about how `LifecycleActions` uses it.
 *
 * What that buys: deleting the type-to-confirm prop from the rung-4 panel, or adding it to the
 * rung-3 one, now fails the suite. The previous round pinned only the CALLEE (the exact-match
 * predicate in {@link file://../../lib/lifecycle.ts} and the arming expression in
 * {@link file://../../ui/primitives.tsx}) and never the call site, so either mutation shipped
 * green. The prop is named in prose rather than in backticks
 * here on purpose: `lifecycle.spec.ts` asserts it occurs EXACTLY ONCE in this file, so that the
 * rung-3 panel provably does not carry it.
 */
export function CancelConfirm({
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
