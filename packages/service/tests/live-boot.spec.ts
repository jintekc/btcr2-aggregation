import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FUNDING_WINDOW_MS,
  DEFAULT_PHASE_TIMEOUT_MS,
  startDemoServer,
  type DemoServer,
} from '../src/demo-server.js';

/**
 * Boot-enablement coverage for the live+broadcast env contract (LIVE-01, D-35/D-38/D-40).
 * These assert the fail-fast boot VALIDATION and the loud disclosure banners, all of which
 * run BEFORE any chain I/O: the two throw cases never construct a connection or bind a port,
 * and the banner cases bind an ephemeral loopback port with a lazy (never-contacted) esplora
 * connection on a test network, so the whole spec stays hermetic (no funded wallet, no
 * esplora reachable). Cohort broadcasting itself only fires on `signing-complete`, which no
 * cohort here ever reaches (a fresh service is idle).
 *
 * NEW spec under `packages/service/tests/` (tests-outside-src convention); imports the module
 * under test via `../src/demo-server.js`.
 */

const OPERATOR_PASSWORD = 'correct-horse-battery-staple';
const TEST_NETWORK = 'signet';

/** Common hermetic boot opts: ephemeral loopback port, no SPA, a test (non-mainnet) network. */
function bootOpts(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    port: 0,
    host: '127.0.0.1',
    webDistDir: null,
    network: TEST_NETWORK,
    operatorPassword: OPERATOR_PASSWORD,
    ...extra,
  };
}

describe('startDemoServer live+broadcast boot enablement (D-35/D-38/D-40)', () => {
  const started: DemoServer[] = [];

  afterEach(async () => {
    // Tear down any server a banner test bound, then clear the console spy.
    while (started.length > 0) {
      const server = started.pop();
      await server?.stop();
    }
    vi.restoreAllMocks();
  });

  it('refuses BROADCAST without LIVE at boot (never touches the chain)', async () => {
    await expect(
      startDemoServer(bootOpts({ live: false, broadcast: true, quiet: true })),
    ).rejects.toThrow(/BROADCAST=1 requires LIVE=1/);
  });

  it('fails fast when PHASE_TIMEOUT_MS <= the funding window under broadcast (D-38)', async () => {
    // phaseTimeoutMs (1000) does NOT exceed fundingWindowMs (2000): the funding wait could not
    // surface its reason before the phase-stall timer, so the boot must refuse and name both.
    await expect(
      startDemoServer(
        bootOpts({ live: true, broadcast: true, phaseTimeoutMs: 1000, fundingWindowMs: 2000, quiet: true }),
      ),
    ).rejects.toThrow(/1000ms.*2000ms|PHASE_TIMEOUT_MS.*must EXCEED.*funding window/s);
  });

  it('boots under the invariant when the phase timeout exceeds the funding window', async () => {
    // The mirror of the throw case: a valid ordering (phaseTimeoutMs > fundingWindowMs) boots.
    const server = await startDemoServer(
      bootOpts({ live: true, broadcast: true, phaseTimeoutMs: 5000, fundingWindowMs: 2000, quiet: true }),
    );
    started.push(server);
    expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('LIVE alone (no BROADCAST) boots without throwing (fixture co-sign preserved)', async () => {
    // The existing-deployment path: LIVE=1 switches only the esplora connection, never the
    // cohort co-sign path, so it must boot with no broadcast enablement and no banner throw.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const server = await startDemoServer(bootOpts({ live: true, broadcast: false }));
    started.push(server);
    expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // No live+broadcast banner on a LIVE-only boot.
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toMatch(/LIVE \+ BROADCAST/);
  });

  it('prints the loud live+broadcast banner and the throwaway-key warning when RECOVERY_KEY is absent (D-40)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const server = await startDemoServer(bootOpts({ live: true, broadcast: true }));
    started.push(server);
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/LIVE \+ BROADCAST/);
    // Throwaway-recovery-key warning fires on any live+broadcast boot, regardless of network.
    expect(logged).toMatch(/RECOVERY_KEY UNSET/);
    expect(logged).toMatch(/THROWAWAY/);
  });

  it('omits the throwaway-key warning when RECOVERY_KEY is supplied (still banners)', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // An operator-supplied x-only recovery key (64 hex chars); its secret is held offline.
    const recoveryKey = 'a'.repeat(64);
    const server = await startDemoServer(bootOpts({ live: true, broadcast: true, recoveryKey }));
    started.push(server);
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/LIVE \+ BROADCAST/);
    expect(logged).not.toMatch(/RECOVERY_KEY UNSET/);
  });

  it('exposes sane funding-window + phase-timeout defaults for the invariant', () => {
    // The default ordering must itself satisfy the boot invariant (phase timeout > window),
    // so a live+broadcast boot with no explicit knobs never trips its own fail-fast.
    expect(DEFAULT_PHASE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_FUNDING_WINDOW_MS);
  });

  it('rejects a malformed FUNDING_WINDOW_MS so the D-38 boot invariant still fires (review WR-04)', async () => {
    // A bare Number('12m') is NaN, and every comparison against NaN is false - so the invariant
    // `phaseTimeoutMs <= fundingWindowMs` silently passed and the service booted with a window
    // that made the wait never poll once while still emitting the blind-lapse verdict. With the
    // guard the malformed value falls back to DEFAULT_FUNDING_WINDOW_MS (12 min), which a 1000ms
    // phase timeout does NOT exceed, so the boot correctly refuses.
    process.env.FUNDING_WINDOW_MS = '12m';
    try {
      await expect(
        startDemoServer(bootOpts({ live: true, broadcast: true, phaseTimeoutMs: 1000, quiet: true })),
      ).rejects.toThrow(/must EXCEED the funding window/);
    } finally {
      delete process.env.FUNDING_WINDOW_MS;
    }
  });

  it('warns and falls back on a malformed FUNDING_WINDOW_MS, never bannering NaN', async () => {
    // The mirror: the FALLBACK (not NaN) is what the invariant is checked against, so a phase
    // timeout above the default window boots - and the operator is told the value was ignored.
    process.env.FUNDING_WINDOW_MS = 'not-a-number';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const server = await startDemoServer(
        bootOpts({ live: true, broadcast: true, phaseTimeoutMs: DEFAULT_FUNDING_WINDOW_MS + 60_000 }),
      );
      started.push(server);
      const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toMatch(/ignoring malformed FUNDING_WINDOW_MS="not-a-number"/);
      // The live+broadcast banner reports the FALLBACK window, never NaN.
      expect(logged).toMatch(new RegExp(`funding window: ${DEFAULT_FUNDING_WINDOW_MS}ms`));
    } finally {
      delete process.env.FUNDING_WINDOW_MS;
    }
  });

  it('rejects a malformed OPERATOR_SESSION_TTL_MS rather than minting never-expiring sessions', async () => {
    // NaN made `Date.now() > expiresAt` always false (sessions NEVER expired) and emitted an
    // invalid `Max-Age=NaN` cookie attribute. The guard falls back to the auth module's default.
    process.env.OPERATOR_SESSION_TTL_MS = '24h';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const server = await startDemoServer(bootOpts({}));
      started.push(server);
      const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toMatch(/ignoring malformed OPERATOR_SESSION_TTL_MS="24h"/);
      const res = await fetch(`${server.baseUrl}/v1/operator/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: server.baseUrl },
        body: JSON.stringify({ password: OPERATOR_PASSWORD }),
      });
      expect(res.status).toBe(200);
      const cookie = res.headers.get('set-cookie') ?? '';
      expect(cookie).toContain('operator_session=');
      expect(cookie).not.toMatch(/Max-Age=NaN/i);
    } finally {
      delete process.env.OPERATOR_SESSION_TTL_MS;
    }
  });
});
