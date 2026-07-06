import { useParticipant } from '../../stores/participant';
import { Badge, Button, Card, CopyField, SectionTitle } from '../../ui/primitives';

const STATUS_TONE = {
  idle: 'neutral',
  publishing: 'accent',
  published: 'good',
  failed: 'bad',
} as const;

const STATUS_LABEL = {
  idle: 'not published',
  publishing: 'publishing…',
  published: 'published',
  failed: 'failed',
} as const;

/**
 * Opt-in IPFS publish (ADR 0011). The sidecar download stays the default,
 * sovereign hand-off; this panel adds public discoverability: the browser boots
 * its own Helia node (lazy chunk), holds the canonical artifact blocks, and the
 * coordinator pins them. Because every CID is identity-on-digest, anyone holding
 * the on-chain hash - or, for an x1 DID, just the DID string - can derive the
 * CID and fetch the artifact from any host that has it. Data only: publishing
 * never touches funds, so there is no mainnet gate here.
 */
export function PublishPanel({ baseUrl }: { baseUrl: string }) {
  const result = useParticipant((s) => s.result);
  const sidecar = useParticipant((s) => s.sidecar);
  const ipfsInfo = useParticipant((s) => s.ipfsInfo);
  const ipfsStatus = useParticipant((s) => s.ipfsStatus);
  const ipfsResults = useParticipant((s) => s.ipfsResults);
  const ipfsError = useParticipant((s) => s.ipfsError);
  const publishIpfs = useParticipant((s) => s.publishIpfs);

  // Only meaningful once this DID has captured artifacts to publish.
  if (!result?.included || !sidecar) {
    return null;
  }

  const available = ipfsInfo?.enabled === true;
  const busy = ipfsStatus === 'publishing';

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <SectionTitle>Publish to IPFS</SectionTitle>
        <Badge tone={STATUS_TONE[ipfsStatus]}>{STATUS_LABEL[ipfsStatus]}</Badge>
      </div>

      <p className="text-sm text-muted">
        Optional: host your resolution artifacts on IPFS. Your browser runs its own IPFS node holding
        the canonical blocks, and the coordinator pins a copy. Every block&apos;s CID is derived from the
        same hash committed on-chain, so any resolver can verify the bytes it fetches.
        {result.beaconType === 'SMTBeacon' && (
          <> Your SMT proof stays in the sidecar: it is keyed by the cohort&apos;s shared root, not its own
          hash, so it has no on-chain-derivable CID.</>
        )}
      </p>

      {!available && (
        <p className="rounded-md border border-edge bg-canvas px-3 py-2 text-xs text-faint">
          This coordinator does not run an IPFS pinning node, so there is nowhere to publish. Your
          sidecar download above carries the same artifacts.
        </p>
      )}

      <Button
        variant="ghost"
        onClick={() => void publishIpfs(baseUrl)}
        disabled={!available || busy}
        className="w-full"
      >
        {busy ? 'Publishing…' : ipfsStatus === 'published' ? 'Publish again' : 'Publish to IPFS'}
      </Button>

      {ipfsResults && (
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
      )}

      {ipfsStatus === 'failed' && ipfsError && (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{ipfsError}</p>
      )}
    </Card>
  );
}
