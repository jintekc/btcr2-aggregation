import { useEffect, useState } from 'react';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import { pendingSubmitUpdate, useParticipant } from '../../stores/participant';
import { fetchAnchor } from '../../lib/anchor';
import { Button, StatusDot } from '../../ui/primitives';

/**
 * Serialize the signed update body for the preview. The body can carry values JSON cannot
 * represent verbatim (bigint, byte arrays), so this replacer renders them readably rather than
 * throwing or emitting `{}`: bigints as decimal strings, byte arrays as hex. The preview is a
 * faithful, read-only view of the EXACT body that will be submitted (D-29), never an editable one.
 */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'bigint') {
          return val.toString();
        }
        if (val instanceof Uint8Array) {
          return Array.from(val, (b) => b.toString(16).padStart(2, '0')).join('');
        }
        return val;
      },
      2,
    );
  } catch {
    return String(value);
  }
}

/**
 * The explicit submit moment (PART-03, D-12/D-13/D-14). Rendered only while the store's
 * `pendingSubmit` window is open: the runner has already built and signed this participant's
 * update exactly once and is awaiting the user's consent. This panel shows the plain-language
 * preview lead, a collapsed-by-default raw signed-update JSON expander (scrolls, never
 * overflows), and ONE beacon-commitment consent line branched on the service's broadcast mode
 * (hermetic vs live, D-14). Clicking "Submit my DID update" resolves the store's deferred with
 * that exact body; there is NO second mid-round approval gate (D-14).
 *
 * Submit-window urgency (D-13, the one documented exception to the quiet-indicator rule): the
 * heading escalates to "Your update is needed" and the tab title changes to "(!) Submit your
 * update" while the window is open, restored on submit / unmount (leave / terminal both unmount
 * this panel). The broadcast mode is read from the PUBLIC anchor endpoint's `enabled` bit, which
 * a service reports regardless of cohort state, so the consent line is mode-honest even before
 * the post-sign anchor poll runs.
 */
export function SubmitPanel({ baseUrl, cohortId }: { baseUrl: string; cohortId: string }) {
  const submitUpdate = useParticipant((s) => s.submitUpdate);
  const storeAnchor = useParticipant((s) => s.anchor);
  const beaconAddress = useParticipant((s) => s.beaconAddress);
  const network = useParticipant((s) => s.network);

  const [submitted, setSubmitted] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  // The broadcast-mode bit: prefer the store's anchor read if present (defensive; it is
  // typically null until the post-sign poll), otherwise a component-local probe. `undefined`
  // means "still checking" so the consent line never flashes a possibly-wrong mode claim.
  const [probedEnabled, setProbedEnabled] = useState<boolean | undefined>(undefined);

  const update = pendingSubmitUpdate();
  const netLabel = resolveNetwork(network).label;
  const enabled = storeAnchor?.enabled ?? probedEnabled;

  // Probe the PUBLIC anchor endpoint once for the service's broadcast mode. On failure default
  // to hermetic copy (the conservative choice: it claims nothing is published to Bitcoin).
  useEffect(() => {
    let active = true;
    fetchAnchor(baseUrl, cohortId).then(
      (dto) => {
        if (active) {
          setProbedEnabled(dto.enabled);
        }
      },
      () => {
        if (active) {
          setProbedEnabled(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [baseUrl, cohortId]);

  // D-13 submit-window urgency: change the tab title while the window is open and restore the
  // prior title on unmount (submit closes the window -> this panel unmounts -> title restored).
  useEffect(() => {
    const previous = document.title;
    document.title = '(!) Submit your update';
    return () => {
      document.title = previous;
    };
  }, []);

  function onSubmit() {
    setSubmitted(true);
    submitUpdate();
  }

  return (
    <div className="space-y-4 rounded-xl border border-warn/40 bg-warn/10 p-5">
      <div className="flex items-center gap-2">
        <StatusDot tone="warn" pulse label="submit window open" />
        <h2 className="text-xl font-semibold text-ink">Your update is needed</h2>
      </div>
      <p className="text-sm text-muted">The cohort is waiting on your submission before it can co-sign.</p>
      <p className="text-sm text-muted">
        This appends this cohort&apos;s beacon service to your DID document. Review the update below, then
        submit it to the round.
      </p>

      <div className="rounded-lg border border-edge bg-surface-2">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint"
        >
          <span>Signed update body</span>
          <span>{showRaw ? 'Hide' : 'Show'}</span>
        </button>
        {showRaw ? (
          <div className="max-h-80 overflow-auto border-t border-edge px-4 py-3">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-muted">
              {update ? safeJson(update) : 'No update body available.'}
            </pre>
          </div>
        ) : null}
      </div>

      {enabled === undefined ? (
        <p className="text-xs text-faint">Checking this service&apos;s broadcast mode…</p>
      ) : enabled ? (
        <p className="text-sm text-warn">
          Submitting also co-signs the beacon transaction that anchors this cohort&apos;s aggregated update
          commitment at beacon address {beaconAddress ?? 'this cohort&apos;s beacon'}. This is a real broadcast on{' '}
          {netLabel}.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Submitting also co-signs this cohort&apos;s aggregated update commitment. This service runs without
          on-chain broadcast, so nothing is published to Bitcoin.
        </p>
      )}

      <Button onClick={onSubmit} disabled={submitted}>
        {submitted ? 'Submitting…' : 'Submit my DID update'}
      </Button>
    </div>
  );
}
