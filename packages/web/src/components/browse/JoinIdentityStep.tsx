import { useState } from 'react';
import type { IdType } from '@btcr2-aggregation/shared';
import { useParticipant } from '../../stores/participant';
import { Button, CopyField, SectionTitle } from '../../ui/primitives';

/**
 * The inline identity step revealed when a participant clicks Join on an open
 * directory row (PART-02, D-03/D-04). It is the identity-acquisition portion of
 * the retired KeyGenPanel: the participant either generates a fresh did:btcr2 in
 * their browser or imports one they already control (including an x1/EXTERNAL
 * identity), then confirms into `store.join(baseUrl, cohortId)`. Browse happens
 * first; an identity is only created here, at Join.
 *
 * D-04 nuance: no key is minted behind the participant's back. Generation runs
 * only on the explicit "Generate a new identity" click, so cancelling before that
 * leaves no key material. The participant store stays the single lifecycle owner:
 * this panel never duplicates any join/leave logic (02-RESEARCH Pitfall 4), it
 * only reads slices and calls the store's generate/importSecret/join actions.
 */
export function JoinIdentityStep({
  baseUrl,
  cohortId,
  joined,
  capacity,
  statusLabel,
  onCancel,
}: {
  baseUrl: string;
  cohortId: string;
  joined: number;
  capacity: number;
  statusLabel: string;
  onCancel: () => void;
}) {
  const did = useParticipant((s) => s.did);
  const idType = useParticipant((s) => s.idType);
  const secret = useParticipant((s) => s.secret);
  const status = useParticipant((s) => s.status);
  const awaitingSeats = useParticipant((s) => s.awaitingSeats);
  const configStatus = useParticipant((s) => s.configStatus);
  const generate = useParticipant((s) => s.generate);
  const importSecret = useParticipant((s) => s.importSecret);
  const join = useParticipant((s) => s.join);

  const [kind, setKind] = useState<IdType>('KEY');
  const [showImport, setShowImport] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  // Gate generation/import until the coordinator's network is known (GET /v1/config),
  // so a DID is never minted on the wrong chain during the (brief) config fetch.
  const configLoading = configStatus !== 'ready';
  // A join is in flight once the store is connecting or the runner is live (opted in,
  // awaiting the cohort to fill): keep the confirm in its "Joining" state throughout.
  const joining = status === 'connecting' || status === 'live';
  const shortCohortId = cohortId.slice(0, 8);

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
      <SectionTitle>Choose an identity to join</SectionTitle>
      <p className="text-sm text-muted">
        Joining cohort {shortCohortId} - {joined}/{capacity} seats, {statusLabel}.
      </p>
      {/* Custody reassurance stays visible in both the choose and confirm states (D-04). */}
      <p className="text-sm text-muted">
        Your keys stay in this browser. This service never sees your private key.
      </p>

      {!did ? (
        <div className="space-y-3">
          {/* Onboarding model: a KEY (k1) DID derives from the key; an EXTERNAL (x1) DID
              commits to a genesis document carried on the opt-in. Both co-sign the cohort. */}
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
              ? 'Bring a did:btcr2 identity you already control (including an x1/EXTERNAL identity).'
              : "We'll generate a new did:btcr2 key identity in your browser."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => generate(kind)} disabled={configLoading}>
              {configLoading ? 'Loading network…' : 'Generate a new identity'}
            </Button>
            <Button variant="ghost" onClick={() => setShowImport((v) => !v)} disabled={configLoading}>
              Import an existing identity
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
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
              <label htmlFor="join-import-secret" className="block text-xs text-faint">
                64-hex secret
              </label>
              <input
                id="join-import-secret"
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
          <p className="text-xs text-faint">
            {idType === 'EXTERNAL' ? 'EXTERNAL (x1) identity' : 'KEY (k1) identity'}, ready to join.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={() => join(baseUrl, cohortId)} disabled={joining}>
              {joining ? 'Joining…' : 'Join cohort'}
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={joining}>
              Cancel
            </Button>
          </div>
          {/* Truthful waiting surface (G-02-2): while opted in and the picked cohort is
              still openly Advertised, show the live seat count instead of only a bare,
              indefinite Joining spinner. Additive context; the button keeps its state. */}
          {joining && awaitingSeats && (
            <p className="text-xs text-faint">
              Waiting for the cohort to fill ({awaitingSeats.joined}/{awaitingSeats.capacity} seats)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
