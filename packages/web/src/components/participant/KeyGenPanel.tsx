import { useState } from 'react';
import { useParticipant } from '../../stores/participant';
import { Badge, Button, CopyField, Mono, SectionTitle } from '../../ui/primitives';

/**
 * Identity + the single explicit "Join" gate. The attendee either generates a
 * fresh did:btcr2 in-browser or re-imports one from a saved secret, then clicks
 * Join once to connect and auto-drive the protocol. No mnemonic ever leaves the
 * page; the secret stays client-side and is shown only so the attendee can save
 * it.
 */
export function KeyGenPanel({ baseUrl }: { baseUrl: string }) {
  const did = useParticipant((s) => s.did);
  const secret = useParticipant((s) => s.secret);
  const status = useParticipant((s) => s.status);
  const error = useParticipant((s) => s.error);
  const generate = useParticipant((s) => s.generate);
  const importSecret = useParticipant((s) => s.importSecret);
  const join = useParticipant((s) => s.join);
  const leave = useParticipant((s) => s.leave);

  const [showImport, setShowImport] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const connected = status === 'connecting' || status === 'live' || status === 'complete' || status === 'failed';
  const joining = status === 'connecting';

  function doImport() {
    const err = importSecret(importValue);
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
        {did ? <Badge tone="accent">did:btcr2 KEY</Badge> : <Badge>none yet</Badge>}
      </div>

      {!did ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Generate a throwaway did:btcr2 in your browser, or import one you saved earlier. The
            signing key never leaves this page.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={generate}>Generate a DID</Button>
            <Button variant="ghost" onClick={() => setShowImport((v) => !v)}>
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
                <Button variant="ghost" onClick={generate}>
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
