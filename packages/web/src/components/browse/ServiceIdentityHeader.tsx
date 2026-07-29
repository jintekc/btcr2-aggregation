import { resolveNetwork } from '@btcr2-aggregation/shared';
import { Card, StatusDot } from '../../ui/primitives';
import { useParticipant } from '../../stores/participant';

/**
 * The anonymous service-identity header (D-02, PART-01). The single Display focal heading is
 * the service origin (`window.location.host`) so a stranger pointed at the URL immediately
 * sees which service they are looking at, alongside the reused service-online indicator, the
 * active-network chip (including the mainnet `· REAL FUNDS` variant), and the truthful
 * open-cohort count from the same public `GET /v1/status` the directory derives from.
 *
 * Reads without operator credentials (the store's public status read uses `credentials: 'omit'`)
 * and renders nothing until the first successful fetch, so a briefly unreachable service never
 * flashes misleading state.
 *
 * The status itself comes from the participant store rather than a local poll of this component's
 * own (SVC-04, 05-05): {@link BrowseView} drives ONE public status read that feeds both this
 * card's open-cohort count and the directory's paused notice. Two independent polls of the same
 * endpoint would be two snapshots that could disagree about the same service on the same screen.
 */
export function ServiceIdentityHeader() {
  const status = useParticipant((s) => s.publicStatus);
  // Optional operator-supplied service name (D-51), read from the same GET /v1/config load the
  // App performs on mount; rendered as plain auto-escaped text beside the origin, no edit surface.
  const serviceName = useParticipant((s) => s.serviceName);

  if (!status) {
    return null;
  }

  const net = resolveNetwork(status.network);
  const openCopy =
    status.openCohorts === 0 ? 'No open cohorts right now' : `${status.openCohorts} open cohorts`;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* OPERATOR-SUPPLIED TEXT reaching an ANONYMOUS stranger (D-16, T-05-07-02). This is the
              higher-stakes of the two render sites: the operator authors it, a participant who has
              never met them reads it. Plain auto-escaped React text content ONLY, never
              `dangerouslySetInnerHTML`, never markup, and never a link target - an operator must
              not be able to turn their service's own name into a destination. The service bounds
              its length, and this block is `flex-wrap`, so a long name wraps rather than pushing
              the network chip off-screen (UI-SPEC E8 long-text backstop). */}
          {serviceName ? <p className="text-sm text-muted">{serviceName}</p> : null}
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-ink">{window.location.host}</h1>
        </div>
        <span
          className={
            net.isMainnet
              ? 'rounded-full border border-bad/50 bg-bad/10 px-3 py-1 text-xs font-semibold text-bad'
              : 'rounded-full border border-edge bg-surface px-3 py-1 text-xs text-faint'
          }
        >
          {net.isMainnet ? `${net.label} · REAL FUNDS` : net.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <StatusDot tone="good" pulse label="service online" />
          <span className="text-sm text-ink">Service online</span>
        </div>
        <span className="text-sm text-muted">{openCopy}</span>
      </div>
    </Card>
  );
}
