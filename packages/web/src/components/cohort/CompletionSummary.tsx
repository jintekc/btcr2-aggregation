import { useState } from 'react';
import { REGISTRATION_FEE_SATS, resolveNetwork } from '@btcr2-aggregation/shared';
import { anchorSummaryState, roundTripOutcome, useParticipant } from '../../stores/participant';
import {
  findAppendedBeacon,
  serviceEndpointString,
  type ResolvedService,
} from '../../lib/resolve';
import { Badge, Button, Card, CopyField, Mono, SectionTitle } from '../../ui/primitives';

/**
 * The post-completion region of the one cohort page (PART-04, D-10/D-17/D-28/D-29/D-30). It
 * ABSORBS the logic of the four retired tail panels (ResultCard / ResolvePanel / RegisterPanel /
 * PublishPanel) as stage internals so the whole tracking + resolve tail lives on the cohort page:
 *
 *  - the mode-honest Signed / Signed-and-anchored line (D-07: never a txid on the hermetic path);
 *  - the explicit k-of-n fallback outcome (D-23) when the runner fell back;
 *  - cooperative non-inclusion as a distinct NON-error outcome that still reports the anchor (D-10);
 *  - the three-way round-trip outcome from the auto-resolve (D-28/D-29): reflected (live), the
 *    hermetic-genesis EXPECTED outcome (never a mismatch warning), or the live not-yet-reflected
 *    mismatch with a "Resolve again" retry gated on the anchor `enabled` bit (Finding 7);
 *  - the resolved DID document + metadata behind a raw-detail expander (no card overflow);
 *  - the sovereign sidecar export (reuse lib/sidecar via the store's downloadSidecar);
 *  - the CONDITIONAL post-completion stages (D-17, Finding 8): the KEY first-update registration
 *    (live + included only) and the opt-in IPFS publish (only when GET /v1/ipfs is enabled) -
 *    NEVER rendered on the hermetic path (the publishable artifacts exist only at cohort-complete);
 *  - the "Browse cohorts" CTA (the summary persists until the next join, v2 PMG-01).
 *
 * All copy is mode-honest and em-dash-free per the UI-SPEC Copywriting Contract.
 */

/** A collapsed-by-default detail section that scrolls its overflow rather than growing the card. */
function Expander({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
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

export function CompletionSummary({ baseUrl, onBrowse }: { baseUrl: string; onBrowse: () => void }) {
  const result = useParticipant((s) => s.result);
  const anchor = useParticipant((s) => s.anchor);
  const did = useParticipant((s) => s.did);
  const network = useParticipant((s) => s.network);
  const sidecar = useParticipant((s) => s.sidecar);
  const downloadSidecar = useParticipant((s) => s.downloadSidecar);
  const fallbackObserved = useParticipant((s) => s.fallbackObserved);
  const nonInclusionReason = useParticipant((s) => s.nonInclusionReason);
  const cohortThreshold = useParticipant((s) => s.cohortThreshold);
  const cohortCapacity = useParticipant((s) => s.cohortCapacity);

  const resolveStatus = useParticipant((s) => s.resolveStatus);
  const resolution = useParticipant((s) => s.resolution);
  const resolveError = useParticipant((s) => s.resolveError);
  const resolve = useParticipant((s) => s.resolve);

  if (!result) {
    return null;
  }

  const netLabel = resolveNetwork(network).label;
  // Confirmed-only heading boolean (Truth 8, D-07; 03-VERIFICATION.md Truth 8 / 03-REVIEW.md
  // WR-02): the heading reads "Anchored" only once the beacon tx is mined (state === 'confirmed'),
  // never while it is broadcast-but-unconfirmed. This matches the anchorNarration paragraph below
  // (which reads the honest 'broadcasting' copy for the broadcast state) and AnchorSubSteps'
  // independent `state === 'confirmed'` check, so no completion-view surface claims "Anchored"
  // while another shows "Confirmed: pending".
  const anchored = Boolean(anchor?.enabled && anchor.state === 'confirmed');
  const anchorEnabled = Boolean(anchor?.enabled);
  // Mode-honest Signed-line narration (WR-01, D-07): map the anchor read to one of five honest
  // states so a broadcasting or failed live anchor is never described as a no-broadcast service.
  const anchorNarration = anchorSummaryState(anchor);
  const doc = resolution?.didDocument;
  const beacon = doc && did ? findAppendedBeacon(doc, did) : undefined;
  const roundTrip = roundTripOutcome({ beaconPresent: Boolean(beacon), anchorEnabled });
  const version = resolution?.didDocumentMetadata?.versionId;
  const resolving = resolveStatus === 'resolving';

  return (
    <div className="space-y-4">
      {/* Mode-honest Signed / Signed-and-anchored line (D-07). The live anchor txid + sub-steps
          live in the timeline; this line never invents a txid on the hermetic path. */}
      <Card className="space-y-2 border-good/40 bg-good/10 p-5">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>{anchored ? 'Anchored' : 'Signed'}</SectionTitle>
          <Badge tone={result.included ? 'good' : 'warn'}>
            {result.included ? 'update included' : 'not included'}
          </Badge>
        </div>
        {anchorNarration === 'anchored' ? (
          <p className="text-sm text-ink">Signed and anchored on {netLabel}.</p>
        ) : anchorNarration === 'broadcasting' ? (
          <p className="text-sm text-ink">
            Signed. Broadcasting the beacon transaction to {netLabel}. This can take a few minutes to post.
          </p>
        ) : anchorNarration === 'broadcast-failed' ? (
          <p className="text-sm text-ink">
            Signed. The beacon broadcast to {netLabel} failed, so there is no confirmed anchor. Your co-signed
            update is in the sidecar below; resolve to check the current state.
          </p>
        ) : anchorNarration === 'checking' ? (
          // Pre-first-read window (null anchor): the read has not landed yet, so we must not
          // presume live OR hermetic. Neutral confirming copy, mirroring SubmitPanel's
          // enabled === undefined handling; the no-broadcast copy renders only for a confirmed
          // hermetic read below (D-07 mode honesty; 03-VERIFICATION.md Truth 7 / 03-REVIEW.md WR-01).
          <p className="text-sm text-ink">Confirming this service&apos;s broadcast mode.</p>
        ) : (
          <p className="text-sm text-ink">
            Signed. This no-broadcast service does not publish to Bitcoin, so there is no on-chain anchor to
            show.
          </p>
        )}

        {/* Explicit k-of-n fallback outcome (D-23). */}
        {fallbackObserved && cohortThreshold !== null && cohortCapacity !== null ? (
          <p className="text-sm text-warn">
            The cohort anchored via the k-of-n fallback path with {cohortThreshold} of {cohortCapacity}{' '}
            signatures. Your update was {result.included ? 'included' : 'not included'}.
          </p>
        ) : null}

        {/* Cooperative non-inclusion (D-10): a NON-error outcome that still reports the anchor. */}
        {!result.included ? (
          <p className="text-sm text-muted">
            The cohort proceeded without your update.
            {nonInclusionReason ? ` ${nonInclusionReason}.` : ''} Here is how the cohort finished: the cohort
            anchored around the members who submitted.
          </p>
        ) : null}
      </Card>

      {/* Round-trip outcome from the auto-resolve (D-28/D-29). */}
      <Card className="space-y-3 p-5">
        <SectionTitle>Resolve round-trip</SectionTitle>
        {resolveStatus === 'idle' || (resolving && !resolution) ? (
          // The genesis-document line presumes hermetic, so it is gated on a CONFIRMED hermetic
          // read (anchorNarration === 'hermetic'), not the enabled bit alone: during the
          // pre-first-read checking window we show the neutral "Resolving your updated DID..."
          // line instead (D-07 mode honesty; 03-VERIFICATION.md Truth 7 / 03-REVIEW.md WR-01).
          anchorNarration === 'hermetic' ? (
            <p className="text-sm text-muted">Resolving to the genesis document...</p>
          ) : (
            <p className="text-sm text-muted">Resolving your updated DID...</p>
          )
        ) : resolveStatus === 'failed' ? (
          <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            {resolveError ?? 'Resolution failed.'}
          </p>
        ) : roundTrip === 'reflected' ? (
          <p className="rounded-md border border-good/40 bg-good/10 px-3 py-2 text-sm text-good">
            Your update is reflected. The resolved DID document now lists this cohort&apos;s beacon service
            {version ? ` (version ${version})` : ''}.
          </p>
        ) : roundTrip === 'hermetic-genesis' ? (
          <p className="text-sm text-muted">
            Resolved to the genesis document. This no-broadcast service has no on-chain signal to discover, so
            your co-signed update lives in the downloadable sidecar/artifacts below.
          </p>
        ) : (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            Your update was not found in the resolved document yet. If the anchor just confirmed, the resolver
            may still be indexing. Try Resolve again.
          </p>
        )}

        {doc ? (
          <Expander title="Resolved DID document">
            <div className="space-y-3">
              <div className="rounded-lg border border-edge bg-canvas px-3 py-2">
                <div className="text-xs uppercase tracking-wider text-faint">resolved id</div>
                <Mono className="block break-all text-ink">{doc.id}</Mono>
                {version ? <div className="mt-1 text-xs text-faint">version {version}</div> : null}
              </div>
              <div>
                <div className="mb-1 text-xs uppercase tracking-wider text-faint">
                  services ({doc.service?.length ?? 0})
                </div>
                <ul className="space-y-1.5">
                  {(doc.service ?? []).map((s) => (
                    <ServiceRow key={s.id} service={s} highlight={beacon?.id === s.id} />
                  ))}
                </ul>
              </div>
            </div>
          </Expander>
        ) : null}

        <Button variant="ghost" onClick={() => void resolve(baseUrl)} disabled={resolving}>
          {resolving ? 'Resolving...' : 'Resolve again'}
        </Button>
      </Card>

      {/* Sovereign export (D-30). */}
      {result.included && sidecar ? (
        <Card className="space-y-2 p-5">
          <SectionTitle>Export</SectionTitle>
          <Button variant="ghost" onClick={downloadSidecar} className="w-full">
            Download sidecar (resolver artifacts)
          </Button>
          <p className="text-xs text-faint">
            Anyone can use this file to resolve your updated DID without contacting this service.
          </p>
        </Card>
      ) : null}

      {/* Conditional post-completion stages (D-17, Finding 8): live/enabled-gated only. */}
      <RegistrationStage baseUrl={baseUrl} />
      <IpfsPublishStage baseUrl={baseUrl} />

      <Button onClick={onBrowse}>Browse cohorts</Button>
    </div>
  );
}

function ServiceRow({ service, highlight }: { service: ResolvedService; highlight: boolean }) {
  const fragment = service.id.includes('#') ? `#${service.id.split('#')[1]}` : service.id;
  return (
    <li
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
        highlight ? 'border-good/50 bg-good/10' : 'border-edge bg-canvas'
      }`}
    >
      <Badge tone={highlight ? 'good' : 'neutral'}>{service.type}</Badge>
      <Mono className="truncate text-muted">{fragment}</Mono>
      <Mono className="ml-auto shrink-0 text-faint">{serviceEndpointString(service)}</Mono>
    </li>
  );
}

const REG_TONE = {
  idle: 'neutral',
  checking: 'accent',
  'awaiting-funds': 'warn',
  broadcasting: 'accent',
  registered: 'good',
  failed: 'bad',
} as const;

const REG_LABEL = {
  idle: 'not registered',
  checking: 'checking funds...',
  'awaiting-funds': 'awaiting funds',
  broadcasting: 'broadcasting...',
  registered: 'registered',
  failed: 'failed',
} as const;

/**
 * The KEY-DID first-update registration (D-17, absorbed from RegisterPanel). CONDITIONAL: it
 * renders ONLY on a broadcasting service (`anchor.enabled`) for a KEY identity whose update was
 * included - never on the hermetic path (Finding 8, prohibition: no funding surface off-chain).
 * A controller's first aggregation update adds the aggregate beacon to their document, but a
 * resolver only discovers signals at beacons already in that document, so the first update must be
 * announced through the controller's own genesis SingletonBeacon. This is real on-chain money, so
 * mainnet stays behind the explicit real-funds acknowledgment (the store re-checks it too).
 */
function RegistrationStage({ baseUrl }: { baseUrl: string }) {
  const idType = useParticipant((s) => s.idType);
  const anchor = useParticipant((s) => s.anchor);
  const result = useParticipant((s) => s.result);
  const beaconRegAddress = useParticipant((s) => s.beaconRegAddress);
  const regStatus = useParticipant((s) => s.regStatus);
  const regTxid = useParticipant((s) => s.regTxid);
  const regError = useParticipant((s) => s.regError);
  const register = useParticipant((s) => s.register);
  const NET = resolveNetwork(useParticipant((s) => s.network));
  const [ackMainnet, setAckMainnet] = useState(false);

  // Live + included KEY only (D-17). The hermetic path (anchor null / enabled:false) never renders.
  if (idType !== 'KEY' || !anchor?.enabled || !result?.included || !beaconRegAddress) {
    return null;
  }

  const busy = regStatus === 'checking' || regStatus === 'broadcasting';
  const blocked = NET.isMainnet && !ackMainnet;
  const explorerUrl = regTxid ? NET.explorerTxUrl(regTxid) : '';

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <SectionTitle>Register first update</SectionTitle>
        <Badge tone={REG_TONE[regStatus]}>{REG_LABEL[regStatus]}</Badge>
      </div>
      <p className="text-sm text-muted">
        Your first update <span className="text-ink">adds the aggregate beacon</span> to your DID document. To
        make it resolvable, announce it through your own genesis beacon: fund the address below, then broadcast
        a one-output <Mono>OP_RETURN</Mono> spend that commits your update hash. Once it confirms, this DID
        resolves with the beacon appended; later updates ride the aggregate beacon.
      </p>
      <CopyField label={`fund this genesis beacon (${NET.label})`} value={`bitcoin:${beaconRegAddress}`} />

      {NET.isMainnet ? (
        <div className="space-y-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
          <p>
            <span className="font-semibold">Bitcoin mainnet: this spends real bitcoin.</span> Broadcasting pays
            a {REGISTRATION_FEE_SATS.toString()}-sat fee from your funded UTXO; the remainder returns to this
            same beacon address, controlled by the key in this browser tab. Save your identity secret first;
            losing it strands the change.
          </p>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={ackMainnet}
              onChange={(e) => setAckMainnet(e.target.checked)}
              className="mt-0.5 accent-[var(--color-bad)]"
            />
            <span>I understand this broadcasts a real mainnet transaction spending real funds.</span>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => register(baseUrl, { acknowledgeMainnet: ackMainnet })}
          disabled={busy || blocked}
          variant={NET.isMainnet ? 'danger' : 'primary'}
        >
          {busy ? REG_LABEL[regStatus] : regStatus === 'registered' ? 'Register again' : 'Check funds and register'}
        </Button>
        {regStatus === 'registered' && regTxid && explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent underline decoration-dotted underline-offset-2 hover:brightness-110"
          >
            view tx on {NET.label}
          </a>
        ) : null}
      </div>

      {regStatus === 'registered' && regTxid ? <CopyField label="registration txid" value={regTxid} /> : null}

      {regStatus === 'awaiting-funds' ? (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          No spendable funds at that address yet. Send test coins to the address (a mutinynet faucet, for
          example), then click again.
        </p>
      ) : null}

      {regStatus === 'failed' && regError ? (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{regError}</p>
      ) : null}
    </Card>
  );
}

const IPFS_TONE = { idle: 'neutral', publishing: 'accent', published: 'good', failed: 'bad' } as const;
const IPFS_LABEL = {
  idle: 'not published',
  publishing: 'publishing...',
  published: 'published',
  failed: 'failed',
} as const;

/**
 * The opt-in IPFS publish (ADR 0011, absorbed from PublishPanel). CONDITIONAL: it renders ONLY
 * when the coordinator reports an IPFS pinning node (`GET /v1/ipfs` enabled) and this DID has
 * artifacts to publish - never on the hermetic path (D-17, Finding 8). The browser boots its own
 * Helia node (lazy chunk), holds the canonical blocks, and the coordinator pins a copy; every CID
 * is identity-on-digest, so any resolver can verify the bytes. Data only: no funds, no mainnet gate.
 */
function IpfsPublishStage({ baseUrl }: { baseUrl: string }) {
  const result = useParticipant((s) => s.result);
  const sidecar = useParticipant((s) => s.sidecar);
  const ipfsInfo = useParticipant((s) => s.ipfsInfo);
  const ipfsStatus = useParticipant((s) => s.ipfsStatus);
  const ipfsResults = useParticipant((s) => s.ipfsResults);
  const ipfsError = useParticipant((s) => s.ipfsError);
  const publishIpfs = useParticipant((s) => s.publishIpfs);

  // Enabled + included only (D-17). The hermetic path reports enabled:false and never renders.
  if (!ipfsInfo?.enabled || !result?.included || !sidecar) {
    return null;
  }

  const busy = ipfsStatus === 'publishing';

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <SectionTitle>Publish to IPFS</SectionTitle>
        <Badge tone={IPFS_TONE[ipfsStatus]}>{IPFS_LABEL[ipfsStatus]}</Badge>
      </div>
      <p className="text-sm text-muted">
        Optional: host your resolution artifacts on IPFS. Your browser runs its own IPFS node holding the
        canonical blocks, and the coordinator pins a copy. Every block&apos;s CID is derived from the same hash
        committed on-chain, so any resolver can verify the bytes it fetches.
        {result.beaconType === 'SMTBeacon' ? (
          <>
            {' '}
            Your SMT proof stays in the sidecar: it is keyed by the cohort&apos;s shared root, not its own hash,
            so it has no on-chain-derivable CID.
          </>
        ) : null}
      </p>

      <Button
        variant="ghost"
        onClick={() => void publishIpfs(baseUrl)}
        disabled={busy}
        className="w-full"
      >
        {busy ? 'Publishing...' : ipfsStatus === 'published' ? 'Publish again' : 'Publish to IPFS'}
      </Button>

      {ipfsResults ? (
        <div className="space-y-2 border-t border-edge pt-3">
          {ipfsResults.map((row) => (
            <div key={row.hashHex} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">{row.label}</span>
                <Badge tone={row.pinned ? 'good' : 'bad'}>
                  {row.pinned ? `pinned (${row.source ?? 'ok'})` : 'not pinned'}
                </Badge>
              </div>
              <CopyField label={`${row.label} CID`} value={row.cid} />
            </div>
          ))}
        </div>
      ) : null}

      {ipfsStatus === 'failed' && ipfsError ? (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{ipfsError}</p>
      ) : null}
    </Card>
  );
}
