import { useParticipant } from '../../stores/participant';
import { Card } from '../../ui/primitives';
import { LogPanel } from '../LogPanel';
import { FlowStepper } from './FlowStepper';
import { KeyGenPanel } from './KeyGenPanel';
import { PublishPanel } from './PublishPanel';
import { RegisterPanel } from './RegisterPanel';
import { ResolvePanel } from './ResolvePanel';
import { ResultCard } from './ResultCard';

/**
 * The attendee experience: identity + Join gate on the left, the live protocol
 * stepper and event log on the right, and the result card once the cohort
 * anchors. `baseUrl` is this page's origin (same-origin topology), so the client
 * transport talks to the coordinator through the Vite dev proxy (or the prod
 * static server) with no CORS.
 */
export function ParticipantView({ baseUrl }: { baseUrl: string }) {
  const log = useParticipant((s) => s.log);
  const hasResult = useParticipant((s) => s.result !== null);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="space-y-5">
        <Card className="p-5">
          <KeyGenPanel baseUrl={baseUrl} />
        </Card>
        {hasResult && (
          <>
            <ResultCard />
            <PublishPanel baseUrl={baseUrl} />
            <RegisterPanel baseUrl={baseUrl} />
            <ResolvePanel baseUrl={baseUrl} />
          </>
        )}
      </div>

      <div className="space-y-5">
        <Card className="p-5">
          <FlowStepper />
        </Card>
        <Card className="flex h-80 flex-col p-5">
          <LogPanel
            title="Your activity"
            entries={log}
            emptyHint="Generate a DID and click Join to start."
            className="flex-1"
          />
        </Card>
      </div>
    </div>
  );
}
