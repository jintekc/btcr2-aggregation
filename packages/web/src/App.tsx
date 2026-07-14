import { useEffect, useState } from 'react';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import { BrowseView } from './components/browse/BrowseView';
import { OperatorConsole } from './components/operator/OperatorConsole';
import { useParticipant } from './stores/participant';

/**
 * App shell over one same-origin service. The route decides the experience: `/operator`
 * is the login-gated operator console (the server session middleware is the real
 * boundary, D-04), and every other path is the anonymous participant experience. The
 * runtime network config (GET /v1/config) and the network badge are shared by both.
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

  const isOperator = pathname === '/operator';

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
      </header>

      <main className="flex-1">
        {isOperator ? (
          <OperatorConsole baseUrl={baseUrl} />
        ) : (
          <BrowseView baseUrl={baseUrl} />
        )}
      </main>

      <footer className="mt-8 border-t border-edge pt-4 text-xs text-faint">
        Aggregation is trustless by design: every signer is a real, separate participant. The
        service only routes messages and aggregates public nonces, it never holds a signing key.
      </footer>
    </div>
  );
}
