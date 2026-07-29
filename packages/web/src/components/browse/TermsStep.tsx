import { useParticipant } from '../../stores/participant';
import { CopyField, SectionTitle } from '../../ui/primitives';

/**
 * The participation-terms join step (SVC-05, D-19, UI-SPEC E15).
 *
 * Rendered above the identity step when, and ONLY when, the operator has set terms. When they
 * have not, this renders NOTHING at all: no empty card, no "this service has no terms"
 * placeholder. A placeholder would be a claim about a service that made none, and it would put a
 * legal-looking box in front of every participant of every service that never asked for one.
 * {@link termsStepVisible} is the single predicate for that decision, exported so it is asserted
 * rather than eyeballed.
 *
 * ## The rendering rule for operator-supplied text
 *
 * The terms body is OPERATOR-SUPPLIED TEXT SHOWN TO STRANGERS. It renders as plain, auto-escaped
 * React text content and nothing else: no markup, no HTML prop, no link target, no markdown pass
 * (T-05-13-03, ASVS V5). This is the same rule the health strip states for `SERVICE_NAME`, and
 * it matters more here, because terms are the one operator string a participant is asked to read
 * carefully and then agree to. The container caps its height and scrolls, and wraps unbroken
 * tokens, so an unbounded document (or a single 3000-character URL) scrolls inside the card
 * instead of pushing the join controls off the screen.
 *
 * ## The honest limit
 *
 * The caption at the bottom is not decoration. The aggregation protocol carries no message type
 * that could hold an acceptance, so enforcement here is APP-LEVEL: a client that speaks the
 * protocol directly joins a cohort without ever seeing this step. Saying so plainly is the
 * difference between a feature and an overclaim (D-19, RESEARCH Pitfall 10).
 */

/**
 * Every authored string on this step, in one place (UI-SPEC E15).
 *
 * The failure sentence is the one deliberate absentee: it lives in the participant store beside
 * the code that SETS it (`TERMS_ACCEPTANCE_FAILED`), and this component renders whatever the
 * store is holding.
 */
export const TERMS_COPY = {
  title: 'Participation terms',
  checkbox: 'I accept these terms.',
  signatureDisclosure:
    'Accepting signs a short record with your DID so this service can show that you agreed. The signing happens in this browser and your private key never leaves it.',
  /** Rendered beside the disabled join control, in the step that owns the button. */
  joinDisabledReason: 'Accept the terms to join.',
  copyFieldLabel: 'acceptance record',
  honestLimit:
    'These terms are enforced in this web app. A client that speaks the protocol directly can join without this step.',
} as const;

/** The `Accepted at {time}.` line, once an acceptance has been recorded. */
export function acceptedAtLine(acceptedAtIso: string): string {
  const at = new Date(acceptedAtIso);
  return `Accepted at ${Number.isNaN(at.getTime()) ? acceptedAtIso : at.toLocaleTimeString()}.`;
}

/**
 * Whether the participation-terms step renders at all.
 *
 * Absent, null, empty, and whitespace-only all mean the SAME thing: this operator set no terms,
 * so there is no step. Whitespace-only is folded in deliberately - a body of spaces is not a
 * document anyone can agree to, and rendering an empty scroll box with a checkbox under it would
 * ask a participant to accept nothing at all.
 */
export function termsStepVisible(termsText: string | null | undefined): boolean {
  return typeof termsText === 'string' && termsText.trim().length > 0;
}

/**
 * The step itself. Owns the terms body, the checkbox, the signature disclosure, the accepted or
 * failed line, and the honest-limit caption; the JOIN control stays where it already lives (the
 * identity step), which is why {@link TERMS_COPY.joinDisabledReason} is exported rather than
 * rendered here.
 */
export function TermsStep({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  const termsText = useParticipant((s) => s.termsText);
  const termsAcceptance = useParticipant((s) => s.termsAcceptance);
  const termsAccepting = useParticipant((s) => s.termsAccepting);
  const termsError = useParticipant((s) => s.termsError);

  if (!termsStepVisible(termsText)) {
    return null;
  }

  return (
    <div className="space-y-3">
      <SectionTitle>{TERMS_COPY.title}</SectionTitle>

      {/* OPERATOR-SUPPLIED TEXT SHOWN TO STRANGERS. Plain React text content, so React escapes
          it: never an HTML prop, never a link target, never parsed as markup (T-05-13-03).
          `max-h-64 overflow-auto` caps an unbounded document to a scrolling region, and
          `whitespace-pre-wrap break-words` keeps the operator's own line breaks while wrapping a
          single unbroken token (a long URL) instead of letting it widen the card. */}
      <div className="max-h-64 overflow-auto rounded-lg border border-edge bg-canvas px-3 py-2">
        <p className="whitespace-pre-wrap break-words text-sm text-muted">{termsText}</p>
      </div>

      {/* Label and control are ONE click target, tall enough (py-2 plus the 16px box) to be
          comfortable on a touch screen (UI-SPEC touch-target rule). */}
      <label className="flex cursor-pointer items-start gap-2 py-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={checked}
          disabled={termsAccepting || termsAcceptance !== null}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>{TERMS_COPY.checkbox}</span>
      </label>

      <p className="text-xs text-faint">{TERMS_COPY.signatureDisclosure}</p>

      {termsAcceptance && (
        <div className="space-y-2">
          <p className="text-sm text-good">{acceptedAtLine(termsAcceptance.acceptedAt)}</p>
          <CopyField label={TERMS_COPY.copyFieldLabel} value={termsAcceptance.hash} />
        </div>
      )}

      {termsError && !termsAcceptance && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
          {termsError}
        </p>
      )}

      {/* The limit of this enforcement, stated rather than implied away (D-19, Pitfall 10). */}
      <p className="text-xs text-faint">{TERMS_COPY.honestLimit}</p>
    </div>
  );
}
