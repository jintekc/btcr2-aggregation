import { useState } from 'react';
import type { IdType } from '@btcr2-aggregation/shared';
import { preSeatFitWarning, useParticipant } from '../../stores/participant';
import { Button, CopyField, SectionTitle } from '../../ui/primitives';
import { statusLabel, type DirectoryCohortDTO } from '../../lib/directory';

/**
 * The inline identity step revealed when a participant clicks Join on an open directory row
 * (PART-02/PART-03, D-03/D-04/D-18/D-19). It is the identity-acquisition portion of the retired
 * KeyGenPanel: generate a fresh did:btcr2 in the browser, import one already controlled
 * (including an x1/EXTERNAL identity), or - once an identity is in memory - reuse the CURRENT
 * one as the default so the same DID can accumulate a version N+1 update across cohorts (D-18).
 *
 * D-04 nuance: no key is minted behind the participant's back. Generation runs only on the
 * explicit "Generate a new identity" click. D-19: a pre-seat fit warning (network / baked
 * beacon-type mismatch) is shown as an informed "join anyway" note, NEVER a block; late
 * cooperative non-inclusion stays the honest backstop. The participant store stays the single
 * lifecycle owner (02-RESEARCH Pitfall 4): this panel only reads slices and calls store actions.
 */
export function JoinIdentityStep({
  baseUrl,
  row,
  onCancel,
}: {
  baseUrl: string;
  /** The picked directory row, so the fit warning can compare network + baked beacon type. */
  row: DirectoryCohortDTO;
  onCancel: () => void;
}) {
  const did = useParticipant((s) => s.did);
  const identity = useParticipant((s) => s.identity);
  const idType = useParticipant((s) => s.idType);
  const secret = useParticipant((s) => s.secret);
  const status = useParticipant((s) => s.status);
  const network = useParticipant((s) => s.network);
  const awaitingSeats = useParticipant((s) => s.awaitingSeats);
  const configStatus = useParticipant((s) => s.configStatus);
  const generate = useParticipant((s) => s.generate);
  const importSecret = useParticipant((s) => s.importSecret);
  const join = useParticipant((s) => s.join);

  const [kind, setKind] = useState<IdType>('KEY');
  const [showImport, setShowImport] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  // D-18: when an identity is already in memory, using it is the DEFAULT. Choosing a different
  // identity is an explicit opt-out that reveals the generate/import controls.
  const [wantDifferent, setWantDifferent] = useState(false);

  const cohortId = row.cohortId;
  const joined = row.joined;
  const capacity = row.capacity;
  const label = statusLabel(row);

  // Gate generation/import until the coordinator's network is known (GET /v1/config), so a DID
  // is never minted on the wrong chain during the (brief) config fetch.
  const configLoading = configStatus !== 'ready';
  // A join is in flight once the store is connecting or the runner is live (opted in, awaiting
  // the cohort to fill): keep the confirm in its "Joining" state throughout.
  const joining = status === 'connecting' || status === 'live';
  const shortCohortId = cohortId.slice(0, 8);

  // D-19: an informed, non-blocking fit warning for the current identity against this cohort.
  const fitWarning = preSeatFitWarning(identity, row, network);

  // Show the choose/generate controls when there is no identity, or the user explicitly asked
  // for a different one. Otherwise the current identity is the default (D-18).
  const showChooser = !did || wantDifferent;

  function doImport() {
    const err = importSecret(importValue, kind);
    setImportError(err);
    if (!err) {
      setShowImport(false);
      setImportValue('');
      setWantDifferent(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionTitle>Choose an identity to join</SectionTitle>
      <p className="text-sm text-muted">
        Joining cohort {shortCohortId} - {joined}/{capacity} seats, {label}.
      </p>
      {/* Custody reassurance stays visible in both the choose and confirm states (D-04). */}
      <p className="text-sm text-muted">
        Your keys stay in this browser. This service never sees your private key.
      </p>

      {showChooser ? (
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
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                  kind === k ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
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
            {did ? (
              <Button variant="ghost" onClick={() => setWantDifferent(false)}>
                Use current identity
              </Button>
            ) : (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
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
          {/* D-19: non-blocking fit warning for a chosen/imported identity (never a block). */}
          {fitWarning && (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              {fitWarning} You can join anyway.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <CopyField label="did" value={did} />
          {secret && <CopyField label="secret (save to re-import)" value={secret} />}
          <p className="text-xs text-faint">
            {idType === 'EXTERNAL' ? 'EXTERNAL (x1) identity' : 'KEY (k1) identity'}, ready to join.
          </p>
          {/* D-19: non-blocking fit warning for the current identity (never a block). */}
          {fitWarning && (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              {fitWarning} You can join anyway.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button onClick={() => join(baseUrl, cohortId)} disabled={joining}>
              {joining ? 'Joining…' : 'Join cohort'}
            </Button>
            <Button variant="ghost" onClick={() => setWantDifferent(true)} disabled={joining}>
              Use a different identity
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={joining}>
              Cancel
            </Button>
          </div>
          {/* Truthful waiting surface (G-02-2): while opted in and the picked cohort is still
              openly Advertised, show the live seat count instead of only a bare Joining spinner. */}
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
