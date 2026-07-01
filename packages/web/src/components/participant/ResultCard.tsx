import { useParticipant } from '../../stores/participant';
import { Badge, Button, Card, CopyField, SectionTitle } from '../../ui/primitives';

/**
 * Shown once the attendee's cohort completes. Surfaces the attendee's own
 * sidecar: the beacon coordinates, the update hash, and the downloadable
 * resolution artifacts they keep for future DID resolution. The aggregated
 * signature itself is service-side and appears on the coordinator dashboard.
 */
export function ResultCard() {
  const result = useParticipant((s) => s.result);
  const sidecar = useParticipant((s) => s.sidecar);
  const downloadSidecar = useParticipant((s) => s.downloadSidecar);
  if (!result) {
    return null;
  }

  return (
    <Card glow className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <SectionTitle>Anchored</SectionTitle>
        <Badge tone={result.included ? 'good' : 'warn'}>
          {result.included ? 'update included' : 'not included'}
        </Badge>
      </div>
      <p className="text-sm text-muted">
        Your DID update was aggregated into cohort <span className="font-mono text-ink">{result.cohortId}</span> and the
        cohort produced a single Taproot signature over the beacon transaction.
      </p>
      <div className="space-y-2">
        <CopyField label="beacon address" value={`bitcoin:${result.beaconAddress}`} />
        <div className="grid grid-cols-2 gap-2">
          <Stat label="beacon type" value={result.beaconType} />
          <Stat label="announcement entries" value={String(result.announcementEntries)} />
        </div>
        {result.updateHashHex && <CopyField label="update hash" value={result.updateHashHex} />}
      </div>

      {result.included && sidecar && (
        <div className="space-y-2 border-t border-edge pt-3">
          <Button variant="ghost" onClick={downloadSidecar} className="w-full">
            Download resolution sidecar
          </Button>
          <p className="text-xs text-faint">
            Your sovereign copy of the off-chain artifacts (signed update +{' '}
            {result.beaconType === 'SMTBeacon' ? 'SMT proof' : 'CAS announcement'}). A resolver needs
            these to reconstruct your updated DID document from the on-chain beacon signal. Keep it, or
            hand it to any resolver as <span className="font-mono">sidecar</span> data.
          </p>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-edge bg-canvas px-3 py-2">
      <div className="text-[0.65rem] uppercase tracking-wider text-faint">{label}</div>
      <div className="font-mono text-sm text-ink">{value}</div>
    </div>
  );
}
