import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createParticipant } from '@btcr2-aggregation/participant';
import { startDemoServer, type DemoServer } from '@btcr2-aggregation/service';
import { createIdentity } from '@btcr2-aggregation/shared';
import { STEP_TIMEOUT_MS, launchBrowser, trackPageErrors, waitForApp } from './lib/browser-harness.js';
import type { Browser } from 'playwright-core';

/*
 * Phase-3 browser CAPSTONE (PART-03 + PART-04, ROADMAP criterion 4, D-32). The whole
 * two-sided participant loop proven at the BROWSER level, hermetically, the way a real
 * stranger drives it:
 *
 *   operator self-hosts + advertises ONE cohort  ->  ONE real Chromium page lands on the
 *   DIRECTORY (not a KeyGen-first stepper)  ->  picks the cohort  ->  generates an identity
 *   inline  ->  joins by choice  ->  clicks "Submit my DID update" (the EXPLICIT submit gate,
 *   PART-03/D-12)  ->  headless in-process peers fill the remaining seats and co-sign  ->  the
 *   page reaches the mode-honest SIGNED state (NOT "anchored", no txid: D-07 hermetic)  ->
 *   auto-resolve runs  ->  the round-trip renders the honest hermetic-genesis outcome (D-29).
 *
 * This is the phase-level proof that the directory is the ONLY entry path (criterion 4: no
 * KeyGen-first stepper affordance) and that the explicit-submit gate + mode-honest tracking +
 * honest round-trip all work through the real UI, end to end.
 *
 * Single-advert-slot discipline (RESEARCH Pitfall 7): the service transport keeps ONE
 * most-recent advert slot, and a browsing participant is always a LATE subscriber. This
 * capstone advertises exactly ONE cohort, so the only current advert IS the picked cohort and
 * both the browser page and the headless peers receive it on connect. The run synchronizes on
 * HARD completion events (the service's signing-complete + the visible round-trip copy), never
 * on bare timers.
 *
 * Hermetic by construction: the offline/fixture beacon-tx path (no `live`, no chain, no IPFS),
 * so it runs with no chain and no new dependency. The cohort still co-signs a real 64-byte
 * Taproot signature internally; only the beacon tx spends a fixture prevout.
 *
 * Registered as the local `e2e:browser:participant` script; NOT wired into CI (the red
 * `e2e:browser*` rewrite + CI wiring are Phase-6 CI debt, D-32).
 */

/** The operator console password this hermetic run boots the service with. */
const OPERATOR_PASSWORD = 'operator-participant-correct-horse-battery-staple';
/** The cohort seat count n and (k == n) the pure n-of-n signing floor: one real page + peers. */
const COHORT_SIZE = 2;

const WEB_DIST = fileURLToPath(new URL('../packages/web/dist', import.meta.url));

/** The operator-cohort DTO shape returned by create + advertise (subset asserted). */
interface OperatorCohortDTO {
  draftId: string;
  state: 'draft' | 'advertised';
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

export interface BrowserParticipantOptions {
  /** Overall run timeout in ms for the co-sign leg (default STEP_TIMEOUT_MS). */
  timeoutMs?: number;
  /** Suppress progress logging (default false). */
  quiet?: boolean;
}

/**
 * Drive the full browse -> pick -> join -> explicit-submit -> co-sign -> signed -> resolve loop
 * with ONE real Chromium page and (n-1) headless in-process peers, and return the list of
 * problems (empty = pass). Everything runs against one hermetic self-hosted service on a real
 * loopback port, with the browser talking to it same-origin (Hono serves the SPA + protocol).
 */
export async function runBrowserParticipantCohort(options: BrowserParticipantOptions = {}): Promise<string[]> {
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
    // Boot a hermetic, operator-enabled service that ALSO serves the built SPA at its origin
    // (single-origin: Hono serves the SPA + protocol, no Vite, no proxy). It advertises nothing
    // on its own; the operator advertises over HTTP below.
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

    // Operator login: capture + echo the operator_session cookie (Node fetch has no cookie jar).
    const loginRes = await fetch(`${baseUrl}/v1/operator/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: OPERATOR_PASSWORD }),
    });
    if (loginRes.status !== 200) {
      fail(`operator login should be 200, got ${loginRes.status}`);
      return problems;
    }
    const setCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('operator_session='));
    await loginRes.text();
    if (!setCookie) {
      fail('login succeeded but issued no operator_session cookie');
      return problems;
    }
    const cookie = setCookie.split(';')[0];
    log('[ok] operator login: session cookie captured');

    // Advertise EXACTLY ONE cohort (single-advert-slot discipline, Pitfall 7). The advertised
    // row id IS the live cohort id (D-15).
    const createRes = await fetch(`${baseUrl}/v1/operator/cohorts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ beaconType: 'CASBeacon', size: COHORT_SIZE, threshold: COHORT_SIZE }),
    });
    if (createRes.status !== 201) {
      fail(`create draft should be 201, got ${createRes.status}`);
      return problems;
    }
    const draft = (await createRes.json()) as OperatorCohortDTO;
    const advertiseRes = await fetch(`${baseUrl}/v1/operator/cohorts/${draft.draftId}/advertise`, {
      method: 'POST',
      headers: { cookie },
    });
    if (advertiseRes.status !== 200) {
      fail(`advertise should be 200, got ${advertiseRes.status}`);
      return problems;
    }
    const cohortId = ((await advertiseRes.json()) as OperatorCohortDTO).draftId;
    log(`[ok] advertise: cohort ${cohortId} is live`);

    // Capture the service's HARD signing-complete for the picked cohort (deterministic sync).
    let aggregatedSignatureLength = -1;
    const signingComplete = new Promise<void>((resolve) => {
      server!.service.runner.on('signing-complete', (result) => {
        if (result.cohortId === cohortId) {
          aggregatedSignatureLength = result.signature.length;
          resolve();
        }
      });
    });

    // Launch headless Chromium and drive ONE real page as the participant.
    browser = await launchBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors: string[] = [];
    trackPageErrors(page, 'participant', pageErrors);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    // Criterion 4: the DIRECTORY is the landing, NOT a KeyGen-first stepper. The retired stepper's
    // first affordance was a top-level "Generate a DID" button; it must be ABSENT on load, and the
    // inline "Generate a new identity" control must not exist until a cohort is picked.
    await page.getByRole('button', { name: 'Join' }).first().waitFor({ state: 'visible', timeout: timeoutMs });
    if ((await page.getByRole('button', { name: 'Generate a DID' }).count()) > 0) {
      fail('criterion 4: a KeyGen-first "Generate a DID" stepper affordance is present on the directory landing');
    }
    if ((await page.getByRole('button', { name: 'Generate a new identity' }).count()) > 0) {
      fail('criterion 4: the inline identity control is shown before a cohort is picked (directory is not the entry)');
    }
    log('[ok] criterion 4: the directory is the landing (no KeyGen-first stepper affordance)');

    // Pick the cohort -> choose an identity inline -> join by choice.
    await page.getByRole('button', { name: 'Join' }).first().click();
    await page.getByRole('button', { name: 'Generate a new identity' }).click();
    const did = (await page.locator('text=/^did:btcr2:/').first().textContent())?.trim() ?? '(unknown)';
    log(`participant identity: ${did}`);
    await page.getByRole('button', { name: 'Join cohort' }).click();
    log('[ok] joined by choice; awaiting the remaining seats');

    // Start the (n-1) headless in-process peers that fill the remaining seats and AUTO-submit
    // (no onSubmitGate: byte-identical to every other headless caller, Pitfall 1). They co-sign
    // the same cohort the browser page picked.
    for (let i = 0; i < COHORT_SIZE - 1; i += 1) {
      const peer = createParticipant({ identity: createIdentity(), baseUrl, cohortId });
      peers.push(peer);
    }
    await Promise.all(peers.map((p) => p.start()));
    log(`[ok] ${peers.length} headless peer(s) started to fill the remaining seat(s)`);

    // The EXPLICIT submit gate (PART-03/D-12): the runner asks this participant for its update and
    // waits for the user's click. The SubmitPanel renders "Submit my DID update"; click it.
    const submitBtn = page.getByRole('button', { name: 'Submit my DID update' });
    await submitBtn.waitFor({ state: 'visible', timeout: timeoutMs });
    log('[ok] explicit submit gate: the submit window opened and is awaiting the click');
    await submitBtn.click();
    log('[ok] clicked "Submit my DID update" (explicit consent)');

    // Synchronize on the service's HARD signing-complete for this cohort (no bare timer).
    await withTimeout(signingComplete, timeoutMs, 'cohort signing');
    if (aggregatedSignatureLength !== 64) {
      fail(`cohort should co-sign a 64-byte aggregated signature, got ${aggregatedSignatureLength}`);
    }

    // Mode-honest SIGNED (D-07): the hermetic no-broadcast copy is visible, NOT "anchored", no
    // txid, no live anchor sub-steps.
    await page
      .getByText(/no-broadcast service does not publish to Bitcoin/i)
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
    if ((await page.getByText('Signed and anchored', { exact: false }).count()) > 0) {
      fail('mode honesty (D-07): the page claimed "Signed and anchored" on a hermetic no-broadcast service');
    }
    if ((await page.getByText('View on explorer', { exact: false }).count()) > 0) {
      fail('mode honesty (D-07): a "View on explorer" anchor link appeared on a hermetic service (no txid should exist)');
    }
    log('[ok] mode-honest SIGNED state (no "anchored", no txid, no explorer link)');

    // Auto-resolve (D-28) runs and the round-trip renders the honest hermetic-genesis outcome (D-29):
    // resolved to the genesis document, expected, NOT a mismatch warning.
    await page
      .getByText(/Resolved to the genesis document/i)
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
    if ((await page.getByText(/Your update is reflected/i).count()) > 0) {
      fail('mode honesty (D-29): the page claimed "Your update is reflected" on a hermetic-genesis round-trip');
    }
    log('[ok] auto-resolve + honest hermetic-genesis round-trip');

    // The sovereign export is offered (D-30).
    if ((await page.getByRole('button', { name: 'Download sidecar (resolver artifacts)' }).count()) < 1) {
      fail('completion summary did not offer the "Download sidecar (resolver artifacts)" export (D-30)');
    }

    problems.push(...pageErrors);
    if (problems.length === 0) {
      log(
        `[ok] full loop: browse -> pick -> join -> explicit submit CLICK -> co-sign (64-byte aggregate) -> ` +
          `mode-honest SIGNED -> auto-resolve -> honest hermetic-genesis round-trip`,
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
  const problems = await runBrowserParticipantCohort({ quiet });
  if (problems.length > 0) {
    console.error('\nBROWSER CAPSTONE FAILED:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    return 1;
  }
  console.log(
    '\nBROWSER CAPSTONE PASSED: a stranger landed on the DIRECTORY (no KeyGen-first stepper), picked a cohort, ' +
      'generated an identity inline, joined by choice, and CLICKED "Submit my DID update" (the explicit submit ' +
      'gate) while headless peers filled the remaining seats and co-signed a 64-byte aggregated Taproot ' +
      'signature. The page reached the mode-honest SIGNED state (no "anchored", no txid), auto-resolved, and ' +
      'rendered the honest hermetic-genesis round-trip. The whole discover -> submit -> co-sign -> signed -> ' +
      'resolve loop proven at the browser level, hermetically, with the stepper retired (criterion 4).',
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
