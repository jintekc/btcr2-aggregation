import { create } from 'zustand';
import { login as apiLogin, logout as apiLogout, sessionProbe } from '../lib/operator';

/**
 * Operator console auth state machine (mirrors the status-union pattern of
 * `stores/participant.ts`). Login state is determined ONLY via the server session probe
 * (`GET /v1/operator/session`), never by reading the browser cookie - the session
 * cookie is httpOnly and unreadable by design (ADR 0015). `disabled` is the fail-closed
 * boot state (no operator password set, D-07).
 */
export type OperatorAuthStatus = 'checking' | 'logged-out' | 'logging-in' | 'logged-in' | 'disabled';

/** Exact invalid-password copy (UI-SPEC); never reveals whether a session/account exists. */
const INVALID_PASSWORD =
  'Incorrect password. Check the operator password set for this service and try again.';
const THROTTLED = 'Too many attempts. Wait a few minutes and try again.';
const UNREACHABLE = 'Could not reach the service. Check that it is running, then reload.';

interface OperatorState {
  auth: OperatorAuthStatus;
  error?: string;
  /** Probe the session on mount: resolves to logged-in / logged-out / disabled. */
  probe: (baseUrl: string) => Promise<void>;
  /** Attempt sign-in; maps 200/401/429/404 to the matching status + copy. */
  signIn: (baseUrl: string, password: string) => Promise<void>;
  /** Sign out server-side, then drop to logged-out regardless of the response. */
  signOut: (baseUrl: string) => Promise<void>;
}

export const useOperator = create<OperatorState>((set) => ({
  auth: 'checking',
  error: undefined,

  async probe(baseUrl) {
    set({ auth: 'checking', error: undefined });
    try {
      const state = await sessionProbe(baseUrl);
      set({ auth: state });
    } catch {
      // A network/stall signal on the probe leaves the operator at the login screen
      // (not 'disabled', which is reserved for the explicit 404 fail-closed signal).
      set({ auth: 'logged-out', error: UNREACHABLE });
    }
  },

  async signIn(baseUrl, password) {
    set({ auth: 'logging-in', error: undefined });
    try {
      const status = await apiLogin(baseUrl, password);
      if (status === 200) {
        set({ auth: 'logged-in', error: undefined });
      } else if (status === 429) {
        set({ auth: 'logged-out', error: THROTTLED });
      } else if (status === 404) {
        set({ auth: 'disabled', error: undefined });
      } else {
        set({ auth: 'logged-out', error: INVALID_PASSWORD });
      }
    } catch {
      set({ auth: 'logged-out', error: UNREACHABLE });
    }
  },

  async signOut(baseUrl) {
    try {
      await apiLogout(baseUrl);
    } finally {
      set({ auth: 'logged-out', error: undefined });
    }
  },
}));
