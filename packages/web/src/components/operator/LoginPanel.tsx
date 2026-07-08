import { useState } from 'react';
import { Button, Card, Field, Input } from '../../ui/primitives';
import { useOperator } from '../../stores/operator';

/**
 * The sign-in screen at `/operator` (UI-SPEC). The client route is presentation only;
 * the real boundary is the server session middleware (D-04). Copy is verbatim from the
 * UI-SPEC Copywriting Contract; the accent is reserved to the primary Sign in CTA.
 */
export function LoginPanel({ baseUrl }: { baseUrl: string }) {
  const [password, setPassword] = useState('');
  const auth = useOperator((s) => s.auth);
  const error = useOperator((s) => s.error);
  const signIn = useOperator((s) => s.signIn);
  const busy = auth === 'logging-in';

  function submit() {
    if (password && !busy) {
      void signIn(baseUrl, password);
    }
  }

  return (
    <Card className="mx-auto max-w-md p-5">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Operator console</h1>
      <p className="mt-2 text-sm text-muted">
        Sign in with this service&rsquo;s operator password to create and advertise cohorts.
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Operator password" htmlFor="operator-password">
          <Input
            id="operator-password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={busy}
          />
        </Field>
        {error ? (
          <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>
        ) : null}
        <Button type="submit" variant="primary" disabled={busy || !password} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Card>
  );
}
