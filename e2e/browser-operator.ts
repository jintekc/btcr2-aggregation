import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createParticipant } from '@btcr2-aggregation/participant';
import { startDemoServer, type DemoServer } from '@btcr2-aggregation/service';
import { createIdentity } from '@btcr2-aggregation/shared';
import { STEP_TIMEOUT_MS, launchBrowser, trackPageErrors, waitForApp } from './lib/browser-harness.js';
import type { Browser } from 'playwright-core';

/*
 * Phase-4 browser OPERATOR capstone (SVC-03 success criterion 4, D-49). The operator
 * monitoring loop proven at the BROWSER level, hermetically, mirroring the participant
 * capstone `e2e/browser-participant-cohort.ts`:
 *
 *   ONE real Chromium page lands on the operator console (`/operator`)  ->  signs in with
 *   the operator password  ->  creates a cohort  ->  advertises it (and is LANDED in that
 *   cohort's drill-down, D-13)  ->  headless in-process peers fill every seat and co-sign  ->
 *   the drill-down's polled monitoring reads surface the seated members, who submitted, the
 *   co-sign progress, and the mode-honest anchor section as the cohort completes.
 *
 * This is the browser-level proof that the authenticated operator can monitor a cohort's real
 * activity in real time (SVC-03 criterion 4: reachable only by the authenticated operator, over
 * the gated polled reads). The operator here is NOT a participant: all n seats are filled by
 * headless peers, so the page exercises the pure monitoring surface.
 *
 * Hermetic by construction: the offline/fixture beacon-tx path (no `live`, no chain, no IPFS),
 * so it runs with no chain and no new dependency. The cohort still co-signs a real 64-byte
 * Taproot signature internally, and the mode-honest anchor section reads the no-broadcast copy
 * (D-18): there is no on-chain anchor to show on the fixture path. The live anchor lifecycle
 * (Broadcast -> Confirmed) is the owner's opt-in `pnpm uat:live` walkthrough (D-48/D-50).
 *
 * Registered as the local `e2e:browser:operator` script; NOT wired into CI (the red
 * `e2e:browser*` rewrite + CI wiring stay Phase-6 CI debt, D-49).
 */

/** The operator console password this hermetic run boots the service with. */
const OPERATOR_PASSWORD = 'operator-monitor-correct-horse-battery-staple';
/** The cohort seat count n and (k == n) the pure n-of-n signing floor, all filled by headless peers. */
const COHORT_SIZE = 2;

const WEB_DIST = fileURLToPath(new URL('../packages/web/dist', import.meta.url));

/** The operator-cohort DTO shape returned by the list read (subset asserted). */
interface OperatorCohortDTO {
  draftId: string;
  state: 'draft' | 'advertised' | 'expired';
}

/** Reject if `p` does not settle within `ms` (the timeout does not keep Node alive). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref();
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Poll `produce` every `intervalMs` until `predicate` holds or the `ms` budget runs out. */
async function pollUntil<T>(
  produce: () => Promise<T>,
  predicate: (value: T) => boolean,
  ms: number,
  label: string,
  intervalMs = 200,
): Promise<T> {
  const deadline = Date.now() + ms;
  let last = await produce();
  while (!predicate(last)) {
    if (Date.now() >= deadline) {
      throw new Error(`${label} not satisfied within ${ms}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await produce();
  }
  return last;
}

export interface BrowserOperatorOptions {
  /** Overall run timeout in ms for the co-sign leg (default STEP_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Suppress progress logging (default false). */
  quiet?: boolean;
}

/**
 * Drive the full operator monitoring loop with ONE real Chromium page and `n` headless
 * in-process peers, returning the list of problems (empty = pass). Everything runs against one
 * hermetic self-hosted service on a real loopback port, with the browser talking to it
 * same-origin (Hono serves the SPA + protocol, no Vite, no proxy).
 */
export async function runBrowserOperatorCohort(options: BrowserOperatorOptions = {}): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? STEP_TIMEOUT_MS;
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const problems: string[] = [];
  const fail = (problem: string): void => {
    problems.push(problem);
  };

  if (!existsSync(WEB_DIST)) {
    fail(`web build not found at ${WEB_DIST} (run \`pnpm -r build\` first)`);
    return problems;
  }

  let server: DemoServer | undefined;
  let browser: Browser | undefined;
  const peers: ReturnType<typeof createParticipant>[] = [];

  try {
    // Boot a hermetic, operator-enabled service that ALSO serves the built SPA at its origin.
    server = await startDemoServer({
      port: 0,
      minParticipants: COHORT_SIZE,
      fillers: 0,
      operatorPassword: OPERATOR_PASSWORD,
      operatorCookieSecure: false,
      webDistDir: WEB_DIST,
      quiet: options.quiet ?? false,
    });
    const baseUrl = server.baseUrl;
    log(`service + web served at ${baseUrl}`);
    await waitForApp(baseUrl, timeoutMs);

    // Capture the service's HARD signing-complete (deterministic sync, no bare timer).
    let aggregatedSignatureLength = -1;
    let signedCohortId = '';
    const signingComplete = new Promise<void>((resolve) => {
      server!.service.runner.on('signing-complete', (result) => {
        aggregatedSignatureLength = result.signature.length;
        signedCohortId = result.cohortId;
        resolve();
      });
    });

    // Launch headless Chromium and drive ONE real page as the operator.
    browser = await launchBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors: string[] = [];
    trackPageErrors(page, 'operator', pageErrors);

    // The operator console lives at /operator (the SPA catch-all serves index.html there).
    await page.goto(`${baseUrl}/operator`, { waitUntil: 'domcontentloaded' });

    // Sign in with the operator password (the server session middleware is the real boundary, D-04).
    await page.getByLabel('Operator password').fill(OPERATOR_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'New cohort' }).waitFor({ state: 'visible', timeout: timeoutMs });
    log('[ok] operator sign-in: the monitoring console is visible');

    // Create a cohort (two honest numbers: threshold k and size n, both COHORT_SIZE for pure n-of-n).
    await page.getByRole('button', { name: 'New cohort' }).click();
    await page.locator('#cohort-threshold').fill(String(COHORT_SIZE));
    await page.locator('#cohort-size').fill(String(COHORT_SIZE));
    await page.getByRole('button', { name: 'Create draft' }).click();

    // Advertise the draft: the store lands the operator in that cohort's drill-down (D-13).
    const advertiseBtn = page.getByRole('button', { name: 'Advertise cohort' });
    await advertiseBtn.waitFor({ state: 'visible', timeout: timeoutMs });
    await advertiseBtn.click();
    await page.getByRole('button', { name: 'Back to cohorts' }).waitFor({ state: 'visible', timeout: timeoutMs });
    log('[ok] create + advertise: landed in the cohort drill-down (D-13)');

    // Learn the advertised cohort id via a separate Node-side operator session (the browser holds
    // the httpOnly cookie the peers cannot). Exactly one cohort exists, so the advertised row is it.
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (!setCookie) {
      fail('could not obtain a Node-side operator session to learn the advertised cohort id');
      return problems;
    }
    const cookie = setCookie.split(';')[0];
    const advertised = await pollUntil(
      async () => {
        const res = await fetch(`${baseUrl}/v1/operator/cohorts`, { headers: { cookie } });
        const body = (await res.json()) as { cohorts: OperatorCohortDTO[] };
        return body.cohorts;
      },
      (cohorts) => cohorts.some((c) => c.state === 'advertised'),
      timeoutMs,
      'advertised cohort appears in the operator list',
    );
    const cohortId = advertised.find((c) => c.state === 'advertised')!.draftId;
    log(`[ok] advertised cohort ${cohortId}`);

    // Start the n headless in-process peers that fill every seat and co-sign the cohort the
    // operator is watching (byte-identical to every other headless caller, no onSubmitGate).
    for (let i = 0; i < COHORT_SIZE; i += 1) {
      peers.push(createParticipant({ identity: createIdentity(), baseUrl, cohortId }));
    }
    await Promise.all(peers.map((p) => p.start()));
    log(`[ok] ${peers.length} headless peer(s) started to fill every seat`);

    // Synchronize on the service's HARD signing-complete (no bare timer).
    await withTimeout(signingComplete, timeoutMs, 'cohort signing');
    if (aggregatedSignatureLength !== 64) {
      fail(`cohort should co-sign a 64-byte aggregated signature, got ${aggregatedSignatureLength}`);
    }
    if (signedCohortId !== cohortId) {
      fail(`the cohort that signed (${signedCohortId}) is not the advertised cohort the peers drove (${cohortId})`);
    }

    // The drill-down polls the gated detail read every few seconds: the Members section must
    // surface the two seated members and the Seats: n/n line (SVC-03 criterion 1).
    await page.getByText(`Seats: ${COHORT_SIZE}/${COHORT_SIZE}.`).first().waitFor({ state: 'visible', timeout: timeoutMs });
    // A seated member row carries a round-state chip that progresses seated -> submitted ->
    // validated -> nonce-sent as the fold observes the co-sign round; after a completed co-sign the
    // terminal per-member round is "Nonce sent", so asserting it proves the drill-down reflects real
    // per-member round progression, not a static seated placeholder (SVC-03 criterion 2, D-31).
    await page.getByText('Nonce sent', { exact: true }).first().waitFor({ state: 'visible', timeout: timeoutMs });
    log('[ok] members: the drill-down shows the seated members + Seats n/n with progressed round chips');

    // The Submissions section must show who submitted and when (SVC-03 criterion 2).
    await page.getByText(/submitted at/i).first().waitFor({ state: 'visible', timeout: timeoutMs });
    log('[ok] submissions: the drill-down shows who submitted and when');

    // Co-sign progress (SVC-03 criterion 2): the honest nonce count reaches n of n on a completed
    // co-sign (the partial-signature leg is never given an invented count, D-32).
    await page
      .getByText(new RegExp(`${COHORT_SIZE} of ${COHORT_SIZE} nonces received|Awaiting partial signatures`, 'i'))
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
    log('[ok] co-sign: the drill-down shows the honest n-of-n nonce progress');

    // Mode-honest anchor (D-18): the hermetic no-broadcast copy is visible, NOT an on-chain
    // anchor claim; no "View on explorer" link exists (no txid on the fixture path).
    await page
      .getByText(/no-broadcast service does not publish to Bitcoin/i)
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
    if ((await page.getByRole('link', { name: 'View on explorer' }).count()) > 0) {
      fail('mode honesty (D-18): a "View on explorer" anchor link appeared on a hermetic service (no txid should exist)');
    }
    log('[ok] anchor: mode-honest no-broadcast section (no on-chain anchor claim, no explorer link)');

    // The per-cohort JSON export (D-34) is offered on the drill-down.
    if ((await page.getByRole('button', { name: 'Download monitoring record (JSON)' }).count()) < 1) {
      fail('the drill-down did not offer the "Download monitoring record (JSON)" export (D-34)');
    }

    // The operator console probes `GET /v1/operator/session` on mount BEFORE sign-in, which
    // honestly 401s (no session yet) and the browser logs that response as a console resource
    // error. It is expected fail-closed behavior (the console then renders the login panel), so
    // filter that one benign line rather than failing the capstone on it.
    const realErrors = pageErrors.filter(
      (e) => !(/\/v1\/operator\/session/.test(e) && /401/.test(e)),
    );
    problems.push(...realErrors);
    if (problems.length === 0) {
      log(
        '[ok] full loop: sign in -> create -> advertise -> drill-down -> members + submissions + co-sign + ' +
          'mode-honest anchor monitored through the real UI as headless peers drove the cohort',
      );
    }
    return problems;
  } catch (err) {
    problems.push(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return problems;
  } finally {
    for (const peer of peers) {
      peer.stop();
    }
    if (browser) await browser.close().catch(() => {});
    if (server) await server.stop().catch(() => {});
  }
}

async function main(): Promise<number> {
  const quiet = process.argv.includes('--quiet');
  const problems = await runBrowserOperatorCohort({ quiet });
  if (problems.length > 0) {
    console.error('\nBROWSER OPERATOR CAPSTONE FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nBROWSER OPERATOR CAPSTONE PASSED: an operator signed in at /operator, created and advertised a ' +
      'cohort (landing in its drill-down), and watched the gated monitoring reads surface the seated ' +
      'members, who submitted, the co-sign progress, and the mode-honest no-broadcast anchor section as ' +
      'headless peers filled every seat and co-signed a 64-byte aggregated Taproot signature. The ' +
      'authenticated operator monitoring loop proven at the browser level, hermetically (SVC-03 criterion 4).',
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
