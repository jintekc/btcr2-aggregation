import { useParticipant } from '../../stores/participant';
import {
  findAppendedBeacon,
  serviceEndpointString,
  type ResolvedService,
} from '../../lib/resolve';
import { Badge, Button, Card, Mono, SectionTitle } from '../../ui/primitives';

/**
 * Resolve this DID through the coordinator (`GET /resolve/:did`) and render the
 * reconstructed document. Resolution runs server-side (the browser never bundles the
 * resolver's native deps). The panel is honest about the KEY-DID discovery model: a
 * fresh DID resolves to its genesis document (its three SingletonBeacons, no
 * aggregate beacon), and the appended aggregate beacon appears only after the first
 * update is registered on-chain (see "Register first update") or on an EXTERNAL DID
 * whose beacon is baked into genesis.
 */
export function ResolvePanel({ baseUrl }: { baseUrl: string }) {
  const did = useParticipant((s) => s.did);
  const status = useParticipant((s) => s.resolveStatus);
  const resolution = useParticipant((s) => s.resolution);
  const error = useParticipant((s) => s.resolveError);
  const resolve = useParticipant((s) => s.resolve);
  if (!did) {
    return null;
  }

  const doc = resolution?.didDocument;
  const beacon = doc ? findAppendedBeacon(doc, did) : undefined;
  const services = doc?.service ?? [];
  const resolving = status === 'resolving';

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <SectionTitle>Resolve this DID</SectionTitle>
        {status === 'resolved' && (
          <Badge tone={beacon ? 'good' : 'neutral'}>
            {beacon ? 'aggregate beacon present' : 'genesis document'}
          </Badge>
        )}
      </div>

      <p className="text-sm text-muted">
        Reconstruct this DID document exactly as any third party would, from the on-chain beacon
        signals plus the off-chain artifacts. Runs on the coordinator.
      </p>

      <Button onClick={() => resolve(baseUrl)} disabled={resolving}>
        {resolving ? 'resolving…' : status === 'resolved' ? 'Resolve again' : 'Resolve this DID'}
      </Button>

      {status === 'failed' && error && (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>
      )}

      {status === 'resolved' && doc && (
        <div className="space-y-3">
          <div className="rounded-lg border border-edge bg-canvas px-3 py-2">
            <div className="text-[0.65rem] uppercase tracking-wider text-faint">resolved id</div>
            <Mono className="block break-all text-ink">{doc.id}</Mono>
            {resolution?.didDocumentMetadata?.versionId && (
              <div className="mt-1 text-xs text-faint">
                version {resolution.didDocumentMetadata.versionId}
                {typeof resolution.didDocumentMetadata.confirmations === 'number' &&
                  ` · ${resolution.didDocumentMetadata.confirmations} confirmations`}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-[0.65rem] uppercase tracking-wider text-faint">
              services ({services.length})
            </div>
            <ul className="space-y-1.5">
              {services.map((s) => (
                <ServiceRow key={s.id} service={s} highlight={beacon?.id === s.id} />
              ))}
            </ul>
          </div>

          {beacon ? (
            <p className="rounded-md border border-good/40 bg-good/10 px-3 py-2 text-xs text-good">
              Your aggregate <span className="font-semibold">{beacon.type}</span> is in the document:
              the first update was registered on-chain and applied. Later updates ride this beacon.
            </p>
          ) : (
            <p className="rounded-md border border-edge bg-surface-2 px-3 py-2 text-xs text-muted">
              This is your genesis document: its three SingletonBeacons, no aggregate beacon yet. A KEY
              DID&apos;s first aggregation update is discoverable only through a beacon already in the
              document, so it becomes resolvable once you register it via your genesis beacon (see
              &ldquo;Register first update&rdquo;) or start from an EXTERNAL DID with the beacon baked
              into genesis.
            </p>
          )}
        </div>
      )}
    </Card>
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
      <Mono className="truncate text-muted" >{fragment}</Mono>
      <Mono className="ml-auto shrink-0 text-faint">{serviceEndpointString(service)}</Mono>
    </li>
  );
}
