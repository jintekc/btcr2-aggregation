import { useEffect, useState } from 'react';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import { Badge, Card, StatusDot } from '../../ui/primitives';
import { useParticipant } from '../../stores/participant';
import { useOperator } from '../../stores/operator';
import type { ServiceMode } from '../../lib/operator';

/**
 * The three mode labels, one per member of {@link ServiceMode} (D-17).
 *
 * EXPORTED so it can be asserted (`05-AUDIT-2.md` entry 6). This is the single most consequential
 * piece of copy on this surface: it is the operator's only statement of whether this service moves
 * real Bitcoin. While the record was module-private no test could reach it, so relabelling `live`
 * shipped undetected, and the last hop from a served mode to a rendered chip was recorded in
 * `05-VALIDATION.md:76` as verified by `build`, which is itself the admission. The same reasoning
 * moved the cohort-row chip presentation map out of `OperatorCohortList.tsx` and into
 * `lib/operator-rows.ts` in 05-20: a label an operator relies on belongs somewhere a spec can pin
 * it. The map stays HERE, beside the file's other chip labels, so every label on this row still has
 * one home. Pinned in `packages/web/tests/service-controls.spec.ts`, both as a map and as rendered
 * output under each served mode.
 */
export const MODE_LABEL: Record<ServiceMode, string> = {
  hermetic: 'Hermetic',
  'live-no-broadcast': 'Live (no broadcast)',
  live: 'Live',
};

/** The modes that talk to a live esplora (so the esplora reachability chip is shown, D-43). */
const LIVE_MODES: ServiceMode[] = ['live', 'live-no-broadcast'];

/**
 * The warn-tone chip shown once the one-way broadcast kill switch has engaged (SVC-04, D-14,
 * 05-UI-SPEC E9). Authored HERE, beside the strip's other chip labels, so every label on this row
 * has one home and the audit grep that proves the chip renders alongside the mode chip reads this
 * file. `(this session)` is doing real work: the state is in-memory, and a restart returns this
 * service to its boot environment.
 */
export const BROADCAST_OFF_CHIP = 'Broadcast off (this session)';

/**
 * The always-visible operator health strip (D-17/D-25/D-51). A single-line, wrapping chip row
 * that discloses, at a glance: the broadcast mode, the active Bitcoin network (reusing the
 * header's network-chip treatment, including the mainnet REAL FUNDS variant), esplora
 * reachability when live, IPFS on/off, a freshness indicator, and the operator-supplied
 * SERVICE_NAME when set.
 *
 * Freshness (D-25) derives from the operator store's own `lastUpdated`, stamped only on an ok
 * poll: the connected dot reads `good` and the label counts up `Updated {n}s ago` while reads
 * land; on a stale/unreachable read (list OR drill-down) the dot goes `warn` and the label
 * FREEZES (the tick stops advancing) rather than lying about a fresh time.
 *
 * The MODE chip (D-17) is rendered from the SERVED `monitoring.health.mode` only, never a local
 * constant (review CR-01). Until the first ok list read lands the strip says `Checking mode`
 * rather than presuming hermetic: claiming "Hermetic" on a `LIVE=1 BROADCAST=1` service would
 * tell the operator this service does not touch the chain while it is broadcasting real Bitcoin
 * transactions, which is the single most consequential piece of copy on this surface.
 *
 * SERVICE_NAME (D-51) is rendered as plain, auto-escaped React text content (never markup or a
 * URL, T-04-03-01) with no edit surface. The strip is `flex-wrap gap-2`, so a long name wraps to
 * a second line instead of pushing the chips off-screen (E2 backstop).
 */
export function HealthStrip() {
  const network = useParticipant((s) => s.network);
  const serviceName = useParticipant((s) => s.serviceName);
  const ipfsInfo = useParticipant((s) => s.ipfsInfo);
  const lastUpdated = useOperator((s) => s.lastUpdated);
  const listStale = useOperator((s) => s.listStale);
  const detailStale = useOperator((s) => s.detailStale);
  const health = useOperator((s) => s.health);

  // The mode is whatever the service SERVED (review CR-01). Undefined until the first ok list
  // read: render no mode claim at all rather than presuming a hermetic service.
  const mode = health?.mode;
  const isLive = mode !== undefined && LIVE_MODES.includes(mode);
  // Esplora reachability is meaningful only on a live mode; the hermetic path serves `'n/a'`
  // (no esplora is ever contacted), and the chip below is hidden there anyway (D-43).
  const esploraReachable = health?.esploraReachable === true;
  // Advertising drain mode (SVC-04, D-07), read from the SERVED health bit only. `=== true` is
  // deliberate: an absent bit means the service has not reported yet, and an unreported state must
  // never render as a paused claim (T-05-05-01).
  const paused = health?.paused === true;
  // The one-way broadcast kill switch (SVC-04, D-14), read from the SERVED bit only, with the same
  // `=== true` discipline as `paused`: an absent bit means the service has not reported, and an
  // unreported state must never render as a claim either way.
  const broadcastOff = health?.broadcastDisabled === true;
  const stale = listStale || detailStale;
  const net = resolveNetwork(network);
  const ipfsOn = ipfsInfo?.enabled === true;

  // A 1s tick for the freshness label, FROZEN while stale so the "{n}s ago" number stops
  // advancing on an unreachable read (honest freeze, D-25) rather than climbing past a real time.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!stale) {
        setNow(Date.now());
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [stale]);

  const secondsAgo = lastUpdated !== undefined ? Math.max(0, Math.round((now - lastUpdated) / 1000)) : null;
  const freshTone = stale ? 'warn' : lastUpdated !== undefined ? 'good' : 'neutral';
  const freshLabel = secondsAgo !== null ? `Updated ${secondsAgo}s ago` : 'Connecting';

  return (
    <Card className="flex flex-wrap items-center gap-2 px-4 py-2">
      <Badge tone="neutral">{mode ? MODE_LABEL[mode] : 'Checking mode'}</Badge>

      {/* OPERATOR-SUPPLIED TEXT (D-16/D-51, T-05-07-02). Rendered as plain auto-escaped React text
          content ONLY: never through the raw-HTML escape hatch, never as markup, and never as a
          link target or any other attribute an operator-authored string could steer. It is now
          runtime-EDITABLE from the settings view, so this constraint matters more than it did when
          the value was a boot constant: the same string also renders to anonymous participants on
          the public directory header, under the identical rule. (This comment deliberately does
          not spell the escape hatch's name, so the repo-wide grep that proves its absence stays
          meaningful.) */}
      {serviceName ? <span className="text-sm text-ink">{serviceName}</span> : null}

      <span
        className={
          net.isMainnet
            ? 'rounded-full border border-bad/50 bg-bad/10 px-3 py-1 text-xs font-semibold text-bad'
            : 'rounded-full border border-edge bg-surface px-3 py-1 text-xs text-faint'
        }
      >
        {net.isMainnet ? `${net.label} · REAL FUNDS` : net.label}
      </span>

      {/* Esplora reachability is a live-only signal (D-43); hidden on the hermetic path. A failed
          observation flips this to the bad-tone chip so a mid-flight outage is visible here, not
          only inside a cohort's funding stage. */}
      {isLive ? (
        <Badge tone={esploraReachable ? 'good' : 'bad'}>
          {esploraReachable ? 'Esplora reachable' : 'Esplora unreachable'}
        </Badge>
      ) : null}

      {/* The paused chip rides BESIDE the mode chip, never instead of it (D-07): pause says
          whether this service is offering new cohorts, where the mode says how it signs and
          broadcasts. `warn` because a drain is deliberate but non-default - something a returning
          operator must notice, not an error. */}
      {paused ? <Badge tone="warn">Advertising paused</Badge> : null}

      {/* The broadcast-off chip rides BESIDE the mode chip above, never instead of it (D-14). That
          placement is the honesty: this service really did boot in the mode the first chip names,
          and its esplora reads (resolve, anchor tracking, the funding watch) really are still live.
          Rewriting the mode chip would tell the operator this service booted a way it did not
          (T-05-08-03). `warn` for the same reason the paused chip is: deliberate but non-default,
          something a returning operator must notice rather than an error. */}
      {broadcastOff ? <Badge tone="warn">{BROADCAST_OFF_CHIP}</Badge> : null}

      <Badge tone="neutral">{ipfsOn ? 'IPFS on' : 'IPFS off'}</Badge>

      <span className="ml-auto flex items-center gap-2">
        <StatusDot tone={freshTone} label={freshLabel} />
        <span className="text-xs uppercase tracking-[0.14em] text-faint">{freshLabel}</span>
      </span>
    </Card>
  );
}
