import { useEffect, useState } from 'react';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import { BrowseView } from './components/browse/BrowseView';
import { STAGE_LABEL } from './components/cohort/StageTimeline';
import { OperatorConsole } from './components/operator/OperatorConsole';
import { StatusDot } from './ui/primitives';
import { deriveStage, useParticipant } from './stores/participant';

/**
 * App shell over one same-origin service. The route decides the experience: `/operator`
 * is the login-gated operator console (the server session middleware is the real
 * boundary, D-04), and every other path is the anonymous participant experience. The
 * runtime network config (GET /v1/config) and the network badge are shared by both.
 *
 * The shell also owns the participant view toggle (cohort vs browse) so a single persistent
 * "Your cohort · {stage}" link (D-03/D-10) lives in the header while a cohort lifecycle is
 * active: it returns to the live cohort page from anywhere in the browse surface, and its
 * stage label + StatusDot update live from the same store facts the timeline derives from.
 */
export function App() {
  const baseUrl = window.location.origin;
  const [pathname, setPathname] = useState(window.location.pathname);

  // React to browser back/forward so a client-side nav (history.pushState) reflows
  // without a full reload; the initial route is a normal page load (the SPA catch-all
  // serves index.html for /operator).
  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Fetch the coordinator's Bitcoin network once on load so every in-browser DID /
  // address derivation targets the chain the coordinator actually runs, instead of a
  // build-time constant (GET /v1/config).
  const loadConfig = useParticipant((s) => s.loadConfig);
  const netLabel = useParticipant((s) => resolveNetwork(s.network).label);
  const isMainnet = useParticipant((s) => resolveNetwork(s.network).isMainnet);
  useEffect(() => {
    void loadConfig(baseUrl);
  }, [loadConfig, baseUrl]);

  // The participant cohort lifecycle + its derived stage, for the header "Your cohort" link.
  const status = useParticipant((s) => s.status);
  const optedIn = useParticipant((s) => s.optedIn);
  const seated = useParticipant((s) => s.seated);
  const pendingSubmit = useParticipant((s) => s.pendingSubmit);
  const steps = useParticipant((s) => s.steps);
  const anchor = useParticipant((s) => s.anchor);
  const resolveStatus = useParticipant((s) => s.resolveStatus);
  const lifecycleActive = status === 'connecting' || status === 'live' || status === 'complete';
  // A post-seat terminal failure keeps the chip visible with the frozen terminal stage label
  // (E10/D-25): it never invents a state the cohort page does not show.
  const terminalSeated = status === 'failed' && seated;
  const stage = deriveStage({ status, optedIn, seated, pendingSubmit, steps, anchor, resolveStatus });

  // The one participant view toggle, owned here so the header link and BrowseView agree.
  const [participantView, setParticipantView] = useState<'cohort' | 'browse'>('cohort');
  // When a lifecycle ends (leave / terminal reset), snap the default view back to cohort so a
  // fresh join opens on the cohort page rather than a stale browse view.
  useEffect(() => {
    if (!lifecycleActive) {
      setParticipantView('cohort');
    }
  }, [lifecycleActive]);

  const isOperator = pathname === '/operator';
  const showCohortLink = !isOperator && (lifecycleActive || terminalSeated);
  // The active-stage dot pulses; a settled stage (signed and beyond) reads good-tone; a terminal
  // failure freezes bad-tone with no pulse (D-25).
  const stageSettled = stage === 'signed' || stage === 'anchored' || stage === 'resolved';
  const chipTone = terminalSeated ? 'bad' : stageSettled ? 'good' : 'accent';

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4 py-6 sm:px-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">
              did:btcr2 <span className="text-accent">aggregation</span>
            </h1>
            <p className="text-sm text-muted">
              {isOperator
                ? 'Operator console for this self-hosted aggregation service.'
                : "Browse this service's open cohorts and pick one to join and co-sign."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showCohortLink ? (
              <button
                type="button"
                onClick={() => setParticipantView('cohort')}
                className="inline-flex items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1 text-xs text-muted hover:bg-surface-2"
              >
                <StatusDot tone={chipTone} pulse={!stageSettled && !terminalSeated} label="cohort stage" />
                Your cohort · {STAGE_LABEL[stage]}
              </button>
            ) : null}
            <span
              className={
                isMainnet
                  ? 'rounded-full border border-bad/50 bg-bad/10 px-3 py-1 text-xs font-semibold text-bad'
                  : 'rounded-full border border-edge bg-surface px-3 py-1 text-xs text-faint'
              }
            >
              {isMainnet ? `${netLabel} · REAL FUNDS` : `${netLabel} · key-path Taproot`}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {isOperator ? (
          <OperatorConsole baseUrl={baseUrl} />
        ) : (
          <BrowseView baseUrl={baseUrl} view={participantView} onView={setParticipantView} />
        )}
      </main>

      <footer className="mt-8 border-t border-edge pt-4 text-xs text-faint">
        Aggregation is trustless by design: every signer is a real, separate participant. The
        service only routes messages and aggregates public nonces, it never holds a signing key.
      </footer>
    </div>
  );
}
