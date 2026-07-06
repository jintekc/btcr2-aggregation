import { resolveNetwork } from '@btcr2-aggregation/shared';
import { useParticipant } from '../../stores/participant';
import { Badge, Button, Card, CopyField, Mono, SectionTitle } from '../../ui/primitives';

const STATUS_TONE = {
  idle: 'neutral',
  checking: 'accent',
  'awaiting-funds': 'warn',
  broadcasting: 'accent',
  registered: 'good',
  failed: 'bad',
} as const;

const STATUS_LABEL = {
  idle: 'not registered',
  checking: 'checking funds…',
  'awaiting-funds': 'awaiting funds',
  broadcasting: 'broadcasting…',
  registered: 'registered',
  failed: 'failed',
} as const;

/**
 * The KEY-DID first-update bootstrap. A controller's first aggregation update adds
 * the aggregate beacon service to their document, but a resolver only discovers
 * signals at beacons already in that document. So the very first update must be
 * announced through a beacon the genesis document already has: the controller's own
 * genesis SingletonBeacon. This panel helps them do exactly that: fund their genesis
 * P2TR beacon address, then broadcast an `OP_RETURN <update-hash>` spend from it.
 * After that confirms, resolving the DID reconstructs the document WITH the beacon;
 * subsequent updates ride the aggregate beacon.
 *
 * This is a real on-chain action, so it needs real funds: it works only when the
 * coordinator runs live (`LIVE=1` + a real esplora host). In the hermetic default
 * the funding check simply reports no funds.
 */
export function RegisterPanel({ baseUrl }: { baseUrl: string }) {
  const result = useParticipant((s) => s.result);
  const beaconRegAddress = useParticipant((s) => s.beaconRegAddress);
  const regStatus = useParticipant((s) => s.regStatus);
  const regTxid = useParticipant((s) => s.regTxid);
  const regError = useParticipant((s) => s.regError);
  const register = useParticipant((s) => s.register);
  // The coordinator's runtime network (GET /v1/config), so the funding label and the
  // explorer link match the chain the beacon address was derived on.
  const NET = resolveNetwork(useParticipant((s) => s.network));

  // Only meaningful once this DID has an included first update to register.
  if (!result?.included || !beaconRegAddress) {
    return null;
  }

  const busy = regStatus === 'checking' || regStatus === 'broadcasting';
  const explorerUrl = regTxid ? NET.explorerTxUrl(regTxid) : '';

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <SectionTitle>Register first update</SectionTitle>
        <Badge tone={STATUS_TONE[regStatus]}>{STATUS_LABEL[regStatus]}</Badge>
      </div>

      <p className="text-sm text-muted">
        Your first update <span className="text-ink">adds the aggregate beacon</span> to your DID
        document. To make it resolvable, announce it through your own genesis beacon: fund the address
        below, then broadcast a one-output <Mono>OP_RETURN</Mono> spend that commits your update hash.
        Once it confirms, this DID resolves with the beacon appended; later updates ride the aggregate
        beacon.
      </p>

      <CopyField label={`fund this genesis beacon (${NET.label})`} value={`bitcoin:${beaconRegAddress}`} />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => register(baseUrl)} disabled={busy}>
          {busy ? STATUS_LABEL[regStatus] : regStatus === 'registered' ? 'Register again' : 'Check funds & register'}
        </Button>
        {regStatus === 'registered' && regTxid && explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent underline decoration-dotted underline-offset-2 hover:brightness-110"
          >
            view tx on {NET.label}
          </a>
        )}
      </div>

      {regStatus === 'registered' && regTxid && (
        <CopyField label="registration txid" value={regTxid} />
      )}

      {regStatus === 'awaiting-funds' && (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          No spendable funds at that address yet. This is a live-only step: send test coins to the
          address (a mutinynet faucet, for example), then click again. In the hermetic default the
          coordinator has no chain, so this always reports no funds.
        </p>
      )}

      {regStatus === 'failed' && regError && (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{regError}</p>
      )}
    </Card>
  );
}
