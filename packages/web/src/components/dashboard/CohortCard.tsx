import type { CohortState, CohortStatus } from '../../lib/types';
import { Badge, Card, CopyField, Mono, StatusDot } from '../../ui/primitives';

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

const STATUS_TONE: Record<CohortStatus, Tone> = {
  advertised: 'neutral',
  keygen: 'accent',
  signing: 'accent',
  fallback: 'warn',
  complete: 'good',
  failed: 'bad',
};

const STATUS_LABEL: Record<CohortStatus, string> = {
  advertised: 'advertised',
  keygen: 'keygen',
  signing: 'signing',
  fallback: 'fallback',
  complete: 'complete',
  failed: 'failed',
};

function shortDid(did: string): string {
  return did.length > 26 ? `${did.slice(0, 18)}…${did.slice(-4)}` : did;
}

/** One cohort's full lifecycle as the coordinator sees it. */
export function CohortCard({ cohort }: { cohort: CohortState }) {
  const tone = STATUS_TONE[cohort.status];
  const live = cohort.status === 'keygen' || cohort.status === 'signing' || cohort.status === 'fallback';

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot tone={tone} pulse={live} label={STATUS_LABEL[cohort.status]} />
          <Mono className="truncate text-ink">{cohort.cohortId}</Mono>
        </div>
        <Badge tone={tone}>{STATUS_LABEL[cohort.status]}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Counter label="opted in" value={cohort.participants.length} />
        <Counter label="updates" value={cohort.updates} />
        <Counter label="nonces" value={cohort.nonces} />
      </div>

      {cohort.participants.length > 0 && (
        <ul className="space-y-1">
          {cohort.participants.map((p) => {
            const accepted = cohort.accepted.includes(p.did);
            return (
              <li key={p.did} className="flex items-center gap-2 text-xs">
                <StatusDot tone={accepted ? 'good' : 'neutral'} label={accepted ? 'accepted' : 'pending'} />
                <Mono className="truncate text-muted">{shortDid(p.did)}</Mono>
                <span className={`ml-auto shrink-0 text-[0.6rem] uppercase tracking-wider ${accepted ? 'text-good' : 'text-faint'}`}>
                  {accepted ? 'accepted' : 'pending'}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {cohort.beaconAddress && <CopyField label="beacon" value={`bitcoin:${cohort.beaconAddress}`} />}

      {cohort.status === 'complete' && cohort.signature && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge tone="good">{cohort.path ?? 'key-path'}</Badge>
            {cohort.txid && <Mono className="truncate text-faint">txid {cohort.txid.slice(0, 16)}…</Mono>}
          </div>
          <CopyField label="aggregated signature" value={cohort.signature} />
        </div>
      )}

      {cohort.anchorStatus && <AnchorRow cohort={cohort} />}

      {cohort.status === 'failed' && cohort.reason && (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{cohort.reason}</p>
      )}
    </Card>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-edge bg-canvas py-2">
      <div className="text-lg font-bold tabular-nums text-ink">{value}</div>
      <div className="text-[0.6rem] uppercase tracking-wider text-faint">{label}</div>
    </div>
  );
}

const ANCHOR_TONE: Record<NonNullable<CohortState['anchorStatus']>, Tone> = {
  broadcast: 'accent',
  confirmed: 'good',
  failed: 'bad',
};

const ANCHOR_LABEL: Record<NonNullable<CohortState['anchorStatus']>, string> = {
  broadcast: 'broadcast · unconfirmed',
  confirmed: 'anchored on-chain',
  failed: 'broadcast failed',
};

/** The on-chain anchor state of the beacon tx (live broadcasting only). */
function AnchorRow({ cohort }: { cohort: CohortState }) {
  const status = cohort.anchorStatus;
  if (!status) {
    return null;
  }
  return (
    <div className="space-y-1.5 border-t border-edge pt-2">
      <div className="flex items-center gap-2">
        <StatusDot tone={ANCHOR_TONE[status]} pulse={status === 'broadcast'} label={ANCHOR_LABEL[status]} />
        <Badge tone={ANCHOR_TONE[status]}>{ANCHOR_LABEL[status]}</Badge>
        {cohort.anchorTxid && cohort.explorerUrl ? (
          <a
            href={cohort.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 text-[0.7rem] text-accent underline decoration-dotted underline-offset-2 hover:brightness-110"
          >
            {cohort.anchorTxid.slice(0, 12)}…
          </a>
        ) : (
          cohort.anchorTxid && <Mono className="ml-auto shrink-0 text-faint">{cohort.anchorTxid.slice(0, 12)}…</Mono>
        )}
      </div>
      {status === 'failed' && cohort.anchorError && (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-2.5 py-1.5 text-[0.7rem] text-bad">
          {cohort.anchorError}
        </p>
      )}
    </div>
  );
}
