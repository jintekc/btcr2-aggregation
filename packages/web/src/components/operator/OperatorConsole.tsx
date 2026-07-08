import { useEffect } from 'react';
import { Button, Card, SectionTitle } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';
import { LoginPanel } from './LoginPanel';

/**
 * Login-gated operator console container (UI-SPEC). Probes the session on mount, then
 * renders one of: a neutral checking placeholder, the {@link LoginPanel}, the
 * fail-closed "disabled" notice (no operator password at boot, D-07), or the signed-in
 * console shell. The shell leaves a clearly-labelled empty region where plans 02/03
 * mount the create form + operator cohort list + directory - no cohort UI ships here.
 * The server middleware is the real access boundary; this gating is presentation (D-04).
 */
export function OperatorConsole({ baseUrl }: { baseUrl: string }) {
  const auth = useOperator((s) => s.auth);
  const probe = useOperator((s) => s.probe);
  const signOut = useOperator((s) => s.signOut);

  useEffect(() => {
    void probe(baseUrl);
  }, [probe, baseUrl]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Operator console</h1>
        <Button variant="ghost" onClick={() => void signOut(baseUrl)}>
          Sign out
        </Button>
      </div>
      <Card className="p-5">
        <SectionTitle>Your cohorts</SectionTitle>
        <p className="mt-3 text-sm text-muted">
          Cohort creation and this service&rsquo;s directory will appear here.
        </p>
      </Card>
    </div>
  );
}
