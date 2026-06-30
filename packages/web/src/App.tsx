import { useState } from 'react';
import { DashboardView } from './components/dashboard/DashboardView';
import { ParticipantView } from './components/participant/ParticipantView';

type Tab = 'participant' | 'dashboard';

const TABS: { key: Tab; label: string; blurb: string }[] = [
  { key: 'participant', label: 'Participant', blurb: 'Join a cohort and co-sign' },
  { key: 'dashboard', label: 'Coordinator', blurb: 'Watch the live service feed' },
];

/**
 * Demo shell. Two views over the same same-origin service: the attendee
 * (Participant) and the coordinator monitor (Dashboard). The participant talks
 * to the service at this page's origin, proxied to the coordinator in dev and
 * served statically in prod.
 */
export function App() {
  const [tab, setTab] = useState<Tab>('participant');
  const baseUrl = window.location.origin;

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4 py-6 sm:px-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">
              did:btcr2 <span className="text-accent">aggregation</span>
            </h1>
            <p className="text-sm text-muted">
              p2p MuSig2 cohort signing over HTTP/REST. Real keys, real transport, a fixture beacon
              transaction.
            </p>
          </div>
          <span className="rounded-full border border-edge bg-surface px-3 py-1 text-xs text-faint">
            mutinynet · key-path Taproot
          </span>
        </div>

        <nav className="mt-5 inline-flex rounded-xl border border-edge bg-surface p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                tab === t.key ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
              }`}
              title={t.blurb}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1">
        {tab === 'participant' ? <ParticipantView baseUrl={baseUrl} /> : <DashboardView />}
      </main>

      <footer className="mt-8 border-t border-edge pt-4 text-xs text-faint">
        Aggregation is trustless by design: every signer is a real, separate attendee. The
        coordinator only routes messages and aggregates public nonces, it never holds a signing key.
      </footer>
    </div>
  );
}
