import { useEffect, useState } from 'react';
import { Button, Card } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';
import { LoginPanel } from './LoginPanel';
import { CreateCohortForm } from './CreateCohortForm';
import { OperatorCohortList } from './OperatorCohortList';
import { CohortDetail } from './CohortDetail';
import { HealthStrip } from './HealthStrip';
import { ServiceControls } from './ServiceControls';
import { SettingsView } from './SettingsView';

/** List poll cadence (matches the drill-down detail poll): keeps chips/metrics/freshness live. */
const LIST_POLL_MS = 4000;

/** Unreachable banner copy (UI-SPEC D-25), shown when the list poll cannot reach the service. */
const UNREACHABLE_BANNER = "Can't reach this service. Showing the last known state and retrying quietly.";

/**
 * Login-gated, list-first operator console (SVC-03, D-07). Probes the session on mount, then
 * renders one of: a neutral checking placeholder, the {@link LoginPanel}, the fail-closed
 * "disabled" notice (no operator password at boot, D-07), or the signed-in monitoring console.
 *
 * The signed-in shell is MONITORING-FIRST (D-07/D-13): the service-metrics row + grouped cohort
 * list are the default view, the create form hides behind a `New cohort` button (dismissible via
 * `Cancel`), and advertising a draft lands the operator in that cohort's drill-down (D-13, wired
 * in the store's advertise action). A quiet accent link opens the public directory in a new tab
 * (view-as-participant, D-15). The server middleware is the real access boundary; this gating is
 * presentation (D-04).
 */
export function OperatorConsole({ baseUrl }: { baseUrl: string }) {
  const auth = useOperator((s) => s.auth);
  const probe = useOperator((s) => s.probe);
  const signOut = useOperator((s) => s.signOut);
  const view = useOperator((s) => s.view);
  const openCohort = useOperator((s) => s.openCohort);
  const refreshCohorts = useOperator((s) => s.refreshCohorts);
  const listStale = useOperator((s) => s.listStale);

  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    void probe(baseUrl);
  }, [probe, baseUrl]);

  // Poll the list read while signed in AND on the list view (the drill-down runs its own detail
  // poll, D-19). Each ok read refreshes the chips/metrics and stamps `lastUpdated` for the health
  // strip freshness indicator; a 401 drops to re-login and an unreachable read freezes + banners
  // (handled in the store's refreshCohorts).
  useEffect(() => {
    if (auth !== 'logged-in' || view.kind !== 'list') {
      return;
    }
    const timer = setInterval(() => void refreshCohorts(baseUrl), LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [auth, view.kind, refreshCohorts, baseUrl]);

  if (auth === 'checking') {
    return (
      <Card className="mx-auto max-w-md p-5">
        <p className="text-sm text-muted">Checking session…</p>
      </Card>
    );
  }

  if (auth === 'disabled') {
    return (
      <Card className="mx-auto max-w-md p-5">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Operator console is disabled</h1>
        <p className="mt-2 text-sm text-muted">
          This service booted without an operator password, so the console is turned off. Set
          OPERATOR_PASSWORD and restart the service to enable operator sign-in.
        </p>
      </Card>
    );
  }

  if (auth !== 'logged-in') {
    return <LoginPanel baseUrl={baseUrl} />;
  }

  // Drill-down view (D-03): a single open cohort's live detail replaces the list; the Back link
  // inside CohortDetail returns to the list. Only advertised cohorts reach here (drafts keep the
  // inline row treatment, D-09). The health strip stays always-visible above both views (D-17).
  if (view.kind === 'detail') {
    return (
      <div className="space-y-6">
        <HealthStrip />
        <ServiceControls baseUrl={baseUrl} />
        <CohortDetail baseUrl={baseUrl} cohortId={view.cohortId} />
      </div>
    );
  }

  // Service settings (D-12): the THIRD SPA-internal view, reached from the controls card and left
  // by the same `Back to cohorts` link the drill-down uses. The strip and the controls card stay
  // visible above it exactly as they do above the other two views, so the operator never loses
  // sight of the mode, the network, or whether advertising is draining while they reconfigure.
  if (view.kind === 'settings') {
    return (
      <div className="space-y-6">
        <HealthStrip />
        <ServiceControls baseUrl={baseUrl} />
        <SettingsView baseUrl={baseUrl} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HealthStrip />
      {/* Service-level controls sit directly under the strip and above BOTH views (D-06): pause is
          a service fact, not a cohort fact, so it must not be reachable only from the list. */}
      <ServiceControls baseUrl={baseUrl} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Operator console</h1>
        <Button variant="ghost" onClick={() => void signOut(baseUrl)}>
          Sign out
        </Button>
      </div>

      {/* Unreachable freeze banner (D-25): a network/5xx list poll freezes the displayed state
          and retries quietly, never redirecting. A 401 instead routes to re-login (in the store). */}
      {listStale ? (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
          {UNREACHABLE_BANNER}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {!showCreate ? (
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            New cohort
          </Button>
        ) : (
          <span />
        )}
        {/* Quiet view-as-participant link (D-15): opens the public directory in a new tab. */}
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-accent underline decoration-dotted underline-offset-2 hover:brightness-110"
        >
          View the public directory
        </a>
      </div>

      {showCreate ? (
        <div className="space-y-3">
          <CreateCohortForm baseUrl={baseUrl} />
          <Button variant="ghost" onClick={() => setShowCreate(false)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {/* Advertised rows open a live drill-down (D-01/D-03); drafts stay inline (D-09). */}
      <OperatorCohortList baseUrl={baseUrl} onOpen={(id) => openCohort(id)} />
    </div>
  );
}
