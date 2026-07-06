import { useState } from 'react';
import type { IdType } from '@btcr2-aggregation/shared';
import { useParticipant } from '../../stores/participant';
import { Badge, Button, CopyField, Mono, SectionTitle } from '../../ui/primitives';

/**
 * Identity + the single explicit "Join" gate. The attendee either generates a
 * fresh did:btcr2 in-browser or re-imports one from a saved secret, then clicks
 * Join once to connect and auto-drive the protocol. No mnemonic ever leaves the
 * page; the secret stays client-side and is shown only so the attendee can save
 * it.
 *
 * The attendee picks the onboarding model: a KEY (`k1`) DID (the DID *is* the key)
 * or an EXTERNAL (`x1`) DID (a self-verifying genesis document, made a first-class
 * aggregation member over HTTP by ADR 066). Both co-sign the same cohort.
 */
export function KeyGenPanel({ baseUrl }: { baseUrl: string }) {
  const did = useParticipant((s) => s.did);
  const idType = useParticipant((s) => s.idType);
  const secret = useParticipant((s) => s.secret);
  const status = useParticipant((s) => s.status);
  const error = useParticipant((s) => s.error);
  const configStatus = useParticipant((s) => s.configStatus);
  const generate = useParticipant((s) => s.generate);
  const importSecret = useParticipant((s) => s.importSecret);
  const join = useParticipant((s) => s.join);
  const leave = useParticipant((s) => s.leave);

  const [kind, setKind] = useState<IdType>('KEY');
  const [showImport, setShowImport] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const connected = status === 'connecting' || status === 'live' || status === 'complete' || status === 'failed';
  const joining = status === 'connecting';
  // Gate generation/import until the coordinator's network is known, so a DID is
  // never minted on the wrong chain during the (brief) `GET /v1/config` fetch.
  const configLoading = configStatus !== 'ready';

  function doImport() {
    const err = importSecret(importValue, kind);
    setImportError(err);
    if (!err) {
      setShowImport(false);
      setImportValue('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionTitle>Your identity</SectionTitle>
        {did ? (
          <Badge tone="accent">did:btcr2 {idType === 'EXTERNAL' ? 'EXTERNAL' : 'KEY'}</Badge>
        ) : (
          <Badge>none yet</Badge>
        )}
      </div>

      {!did ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Generate a throwaway did:btcr2 in your browser, or import one you saved earlier. The
            signing key never leaves this page.
          </p>
          {/* Onboarding model: a KEY (k1) DID derives from the key; an EXTERNAL (x1) DID
              commits to a genesis document carried on the opt-in (ADR 066). Both co-sign. */}
          <div
            role="radiogroup"
            aria-label="Onboarding model"
            className="inline-flex rounded-lg border border-edge bg-canvas p-0.5"
          >
            {(['KEY', 'EXTERNAL'] as IdType[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  kind === k ? 'bg-accent text-white' : 'text-muted hover:text-ink'
                }`}
              >
                {k === 'KEY' ? 'KEY (k1)' : 'EXTERNAL (x1)'}
              </button>
            ))}
          </div>
          <p className="text-xs text-faint">
            {kind === 'EXTERNAL'
              ? 'EXTERNAL (x1): a bring-your-own DID whose genesis document rides your opt-in so the coordinator can authenticate you with zero trust. Keep the sidecar to resolve it.'
              : 'KEY (k1): the DID is your public key; nothing extra to carry.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => generate(kind)} disabled={configLoading}>
              {configLoading ? 'Loading network…' : 'Generate a DID'}
            </Button>
            <Button variant="ghost" onClick={() => setShowImport((v) => !v)} disabled={configLoading}>
              Import a secret
            </Button>
          </div>
          {showImport && (
            <form
              className="space-y-2 rounded-lg border border-edge bg-canvas p-3"
              onSubmit={(e) => {
                e.preventDefault();
                doImport();
              }}
            >
              <label htmlFor="import-secret" className="block text-xs text-faint">
                64-hex secret
              </label>
              <input
                id="import-secret"
                value={importValue}
                onChange={(e) => setImportValue(e.target.value)}
                placeholder="e.g. 3f0a…"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-md border border-edge bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
              />
              {importError && <p className="text-xs text-bad">{importError}</p>}
              <Button type="submit" variant="ghost" disabled={!importValue.trim()}>
                Import
              </Button>
            </form>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <CopyField label="did" value={did} />
          {secret && <CopyField label="secret (save to re-import)" value={secret} />}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!connected ? (
              <>
                <Button onClick={() => join(baseUrl)}>Join the cohort</Button>
                <Button variant="ghost" onClick={() => generate(idType)}>
                  Regenerate
                </Button>
              </>
            ) : status === 'failed' ? (
              <>
                <Badge tone="bad">failed</Badge>
                <Button onClick={() => join(baseUrl)}>Retry</Button>
                <Button variant="ghost" onClick={leave}>
                  Reset
                </Button>
              </>
            ) : (
              <>
                <Badge tone={status === 'complete' ? 'good' : 'accent'}>
                  {joining ? 'connecting…' : status}
                </Badge>
                <Button variant="danger" onClick={leave} disabled={joining}>
                  Leave
                </Button>
              </>
            )}
          </div>
          {status === 'failed' && error && (
            <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>
          )}
          <p className="text-xs text-faint">
            Joining opens a real HTTP/SSE connection to the coordinator at{' '}
            <Mono>{baseUrl || 'this origin'}</Mono> and runs the full MuSig2 flow. Stay on this page
            until the signature is produced.
          </p>
        </div>
      )}
    </div>
  );
}
