import { useEffect, useRef, useState } from 'react';
import { psbtBase64ToBytes, REGISTRATION_FEE_SATS } from '@btcr2-aggregation/shared';
import { useParticipant, type SigningMethod } from '../../stores/participant';
import type { PsbtVerdict } from '../../lib/psbt';
import { Button, copyToClipboard, Expander, Field, Mono, TextArea } from '../../ui/primitives';

/**
 * The external-signer round trip for the KEY first-update registration transaction (PART-06,
 * D-21, UI-SPEC E17). Mounted INSIDE the shipped `Register first update` section, whose single
 * primary button this panel's verdict relabels and gates.
 *
 * A participant who does not want to paste a private key into a web page can take the unsigned
 * transaction to whatever holds their key, sign it there, and bring it back. The registration
 * transaction can support this today because it is a plain Taproot key-spend; the cohort's
 * co-signing round cannot, and this panel says so rather than letting a participant assume
 * otherwise.
 *
 * The panel never signs and never broadcasts. It exports, it accepts, and it renders the verdict
 * the pure validator returns ({@link file://../../lib/psbt.ts}); the broadcast happens through the
 * one shipped `register()` path, so every ADR 0010 guard rail fires identically on both paths.
 *
 * Nothing here is persisted. The exported PSBT, the returned text and the verdict all live in the
 * store's per-round slice, which every teardown path clears, which is what makes
 * {@link EPHEMERAL_NOTE} and {@link PASTE_WARNING} true rather than reassuring.
 *
 * Every string is a named module constant, free of the long dash, per the UI-SPEC copy contract.
 */

const CHOOSER_LABEL = 'Where to sign';
const CHOOSER_OPTIONS: { value: SigningMethod; label: string }[] = [
  { value: 'browser', label: 'Sign in this browser' },
  { value: 'wallet', label: 'Sign with my own wallet' },
];

/**
 * The honest limit on what the wallet path covers, rendered under the chooser on BOTH paths: the
 * expectation that wallet signing covers the whole flow is created by the option existing at all,
 * so the correction belongs beside it rather than only inside the path.
 */
const COSIGN_LIMIT =
  "Only this registration step can be signed in your own wallet. The cohort's co-signing round still signs in this browser.";

const STEP_ONE_TITLE = '1. Download the unsigned transaction';
const STEP_ONE_HELP =
  'This is a Taproot key-spend registration transaction for your DID. Sign it in your own wallet, then bring the signed PSBT back here.';
const DOWNLOAD_LABEL = 'Download PSBT';
const COPY_LABEL = 'Copy PSBT (base64)';
const COPIED_LABEL = 'Copied';
const COPY_FAILED_LABEL = 'Select and copy below';
const PSBT_EXPANDER_TITLE = 'Unsigned PSBT (base64)';

const STEP_TWO_TITLE = '2. Bring back the signed PSBT';
const UPLOAD_LABEL = 'Upload signed PSBT';
const PASTE_EXPANDER_TITLE = 'Paste instead';
const PASTE_FIELD_LABEL = 'Signed PSBT (base64)';
const PASTE_WARNING =
  'Anything you paste here stays in this browser tab for this session only. It is never saved and never sent anywhere except to broadcast the transaction you signed.';

const VERDICT_UNSIGNED = "That PSBT isn't signed yet.";
const VERDICT_MISMATCHED =
  "That PSBT doesn't match the transaction this page created. Download it again and sign that one.";
const VERDICT_UNPARSEABLE = "That doesn't look like a PSBT. Expected base64 text or a .psbt file.";
const verdictFeeOutOfBand = (feeSats: string, expectedSats: string): string =>
  `That transaction's fee is ${feeSats} sats, well above the expected ${expectedSats} sats. Check it in your wallet before broadcasting.`;
const verdictOk = (paysSats: string, feeSats: string): string =>
  `This signed transaction checks out: it pays ${paysSats} sats to your registration address with a ${feeSats} sat fee.`;

const EPHEMERAL_NOTE =
  'Nothing from this step is saved. Reloading this page starts the registration over.';

/**
 * The wallet path's label for the section's single inherited primary button. Exported so
 * {@link file://./CompletionSummary.tsx} relabels the button it already renders rather than
 * adding a second accent action beside it (UI-SPEC: Phase 5 adds no new accent button).
 */
export const BROADCAST_LABEL = 'Broadcast signed transaction';

// Authored beyond the UI-SPEC string set, because the export needs a funding read that can fail
// and a state with no way forward is worse than one extra sentence (05-11 set this precedent).
const EXPORT_BUSY = 'Building the unsigned transaction...';
const EXPORT_RETRY = 'Try again';

/** BIP-174 magic: a `.psbt` file is BINARY and starts with these bytes, where base64 text does not. */
const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

function looksLikeRawPsbt(bytes: Uint8Array): boolean {
  return PSBT_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Trigger a download of the unsigned PSBT as a binary `.psbt` file, which is what desktop and
 * hardware wallets expect. Mirrors `downloadJson`'s object-URL handling, including the deferred
 * revoke: revoking synchronously can cancel the download before the browser has read the blob.
 */
function downloadPsbt(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** The message for a verdict, one string per outcome. Null while nothing has come back. */
export function psbtVerdictMessage(verdict: PsbtVerdict | null): string | null {
  if (!verdict) {
    return null;
  }
  if (verdict.ok) {
    return verdictOk(verdict.paysSats.toString(), verdict.feeSats.toString());
  }
  switch (verdict.reason) {
    case 'unsigned':
      return VERDICT_UNSIGNED;
    case 'mismatched':
      return VERDICT_MISMATCHED;
    case 'fee-out-of-band':
      return verdictFeeOutOfBand(verdict.feeSats.toString(), REGISTRATION_FEE_SATS.toString());
    default:
      return VERDICT_UNPARSEABLE;
  }
}

export function WalletSignPanel({ baseUrl }: { baseUrl: string }) {
  const signingMethod = useParticipant((s) => s.signingMethod);
  const setSigningMethod = useParticipant((s) => s.setSigningMethod);
  const psbtBase64 = useParticipant((s) => s.psbtBase64);
  const psbtExporting = useParticipant((s) => s.psbtExporting);
  const psbtExportError = useParticipant((s) => s.psbtExportError);
  const psbtReturned = useParticipant((s) => s.psbtReturned);
  const psbtVerdict = useParticipant((s) => s.psbtVerdict);
  const exportPsbt = useParticipant((s) => s.exportPsbt);
  const submitSignedPsbt = useParticipant((s) => s.submitSignedPsbt);
  const did = useParticipant((s) => s.did);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const fileRef = useRef<HTMLInputElement>(null);

  // Choosing the wallet path builds the unsigned transaction, because the export needs a funding
  // read the participant cannot perform themselves. It does NOT retry after a failure: the
  // failure renders its own retry, so a dead endpoint cannot become a request loop.
  useEffect(() => {
    if (signingMethod === 'wallet' && !psbtBase64 && !psbtExporting && !psbtExportError) {
      void exportPsbt(baseUrl);
    }
  }, [signingMethod, psbtBase64, psbtExporting, psbtExportError, exportPsbt, baseUrl]);

  async function copyPsbt(): Promise<void> {
    if (!psbtBase64) {
      return;
    }
    const ok = await copyToClipboard(psbtBase64);
    setCopyState(ok ? 'copied' : 'failed');
    setTimeout(() => setCopyState('idle'), 1400);
  }

  function onFile(file: File | undefined): void {
    if (!file) {
      return;
    }
    void file.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      // Accept both interchange forms the copy promises: a binary `.psbt` file, or a text file
      // holding base64. Sniffing the magic is what tells them apart without guessing at encoding.
      submitSignedPsbt(looksLikeRawPsbt(bytes) ? bytes : new TextDecoder().decode(bytes));
      // Let the same file be re-selected after a failed attempt.
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    });
  }

  const message = psbtVerdictMessage(psbtVerdict);
  const filename = `registration-${(did ?? 'did').split(':').pop()?.slice(0, 24) ?? 'did'}.psbt`;

  return (
    <div className="space-y-4 border-t border-edge pt-4">
      <div className="space-y-1.5">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
          {CHOOSER_LABEL}
        </div>
        {/* The shipped segmented-control treatment from JoinIdentityStep, verbatim. */}
        <div
          role="radiogroup"
          aria-label={CHOOSER_LABEL}
          className="inline-flex rounded-lg border border-edge bg-canvas p-0.5"
        >
          {CHOOSER_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={signingMethod === o.value}
              onClick={() => setSigningMethod(o.value)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                signingMethod === o.value ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-faint">{COSIGN_LIMIT}</p>
      </div>

      {signingMethod === 'wallet' ? (
        <div className="space-y-4">
          {/* Step one: hand the unsigned transaction out. */}
          <div className="space-y-2 rounded-lg border border-edge bg-surface-2 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
              {STEP_ONE_TITLE}
            </div>
            <p className="text-xs text-muted">{STEP_ONE_HELP}</p>
            {psbtExporting ? (
              <p className="text-xs text-faint">{EXPORT_BUSY}</p>
            ) : psbtExportError ? (
              <div className="space-y-2">
                <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                  {psbtExportError}
                </p>
                <Button variant="ghost" onClick={() => void exportPsbt(baseUrl)}>
                  {EXPORT_RETRY}
                </Button>
              </div>
            ) : psbtBase64 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => downloadPsbt(filename, psbtBase64ToBytes(psbtBase64) ?? new Uint8Array())}
                  >
                    {DOWNLOAD_LABEL}
                  </Button>
                  <Button variant="ghost" onClick={() => void copyPsbt()}>
                    {copyState === 'copied'
                      ? COPIED_LABEL
                      : copyState === 'failed'
                        ? COPY_FAILED_LABEL
                        : COPY_LABEL}
                  </Button>
                </div>
                {/* Base64 only ever renders through Mono inside the scroll-capped expander, never
                    as a raw wrapped block in the card body (UI-SPEC E17 overflow). */}
                <Expander title={PSBT_EXPANDER_TITLE}>
                  <Mono className="block break-all text-muted">{psbtBase64}</Mono>
                </Expander>
              </div>
            ) : null}
          </div>

          {/* Step two: take the signed transaction back, and judge it. */}
          {psbtBase64 ? (
            <div className="space-y-2 rounded-lg border border-edge bg-surface-2 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">
                {STEP_TWO_TITLE}
              </div>
              <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-edge-strong bg-surface-2 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface">
                {UPLOAD_LABEL}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".psbt,.txt,text/plain,application/octet-stream"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
              </label>
              <Expander title={PASTE_EXPANDER_TITLE}>
                <div className="space-y-2">
                  <Field label={PASTE_FIELD_LABEL} htmlFor="signed-psbt">
                    <TextArea
                      id="signed-psbt"
                      value={psbtReturned}
                      onChange={submitSignedPsbt}
                      placeholder="cHNidP8..."
                    />
                  </Field>
                  <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                    {PASTE_WARNING}
                  </p>
                </div>
              </Expander>
              {message ? (
                <p
                  className={`rounded-md border px-3 py-2 text-xs ${
                    psbtVerdict?.ok
                      ? 'border-good/40 bg-good/10 text-good'
                      : 'border-bad/40 bg-bad/10 text-bad'
                  }`}
                >
                  {message}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-faint">{EPHEMERAL_NOTE}</p>
        </div>
      ) : null}
    </div>
  );
}
