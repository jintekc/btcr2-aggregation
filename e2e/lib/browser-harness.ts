import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

/**
 * Shared helpers for the two browser E2Es: `browser-cohort.ts` drives the dev
 * topology (vite preview + proxy) and `browser-prod-cohort.ts` drives the prod
 * topology (Hono serves the built SPA at its own origin). Both run the same
 * two-attendee cohort scenario, parameterized only by the base URL.
 */

export const VERBOSE = process.env.E2E_VERBOSE === '1';
export const STEP_TIMEOUT_MS = Number(process.env.STEP_TIMEOUT_MS ?? 30_000);

/** Ask the OS for a free TCP port on 127.0.0.1. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('could not determine a free port')));
      }
    });
  });
}

/** Locate the Chromium binary cached under ~/.cache/ms-playwright (Phase 0). */
export function resolveChromium(): string {
  const root = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(root)) {
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith('chromium-') && !d.includes('headless_shell'))
      .sort();
    for (const dir of dirs.reverse()) {
      const candidate = join(root, dir, 'chrome-linux64', 'chrome');
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  const managed = chromium.executablePath();
  if (managed && existsSync(managed)) {
    return managed;
  }
  throw new Error('no Chromium binary found (expected a cached ~/.cache/ms-playwright/chromium-*)');
}

/** Poll `url` until it serves the built SPA (HTTP 200 with the app root) or the deadline passes. */
export async function waitForApp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastInfo = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status === 200) {
        const body = await res.text();
        if (body.includes('id="root"')) {
          return;
        }
        lastInfo = 'served HTML without the app root (stale/empty build?)';
      } else {
        lastInfo = `HTTP ${res.status}`;
      }
    } catch (err) {
      lastInfo = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`web app did not come up at ${url}: ${lastInfo} (did you run \`pnpm -r build\`?)`);
}

/** Wire a page to record uncaught errors and (verbose) all console output. */
export function trackPageErrors(page: Page, label: string, sink: string[]): void {
  page.on('pageerror', (err) => sink.push(`[${label}] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (VERBOSE) {
      console.error(`[${label}] console.${type}: ${text}`);
    }
    if (type === 'error') {
      const url = msg.location().url ?? '';
      // Ignore benign resource-load noise (favicon, transient net errors).
      const benign = /favicon|net::ERR_/.test(text) || /favicon/.test(url);
      if (!benign) {
        sink.push(`[${label}] console.error: ${text}${url ? ` (${url})` : ''}`);
      }
    }
  });
}

async function dumpPage(page: Page, label: string): Promise<void> {
  try {
    const text = await page.innerText('body');
    console.error(`\n----- ${label} visible state -----\n${text}\n----- end ${label} -----`);
  } catch (err) {
    console.error(`(could not dump ${label}: ${err instanceof Error ? err.message : err})`);
  }
}

/** Drive one attendee page through generate -> join -> anchored, returning its DID. */
async function runAttendee(page: Page, label: string, baseUrl: string): Promise<string> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Generate a DID' }).click();
  const did = (await page.locator('text=/^did:btcr2:/').first().textContent())?.trim() ?? '(unknown did)';
  console.log(`${label}: ${did}`);
  await page.getByRole('button', { name: 'Join the cohort' }).click();
  console.log(`${label}: joined, co-signing...`);
  await page.getByText('update included').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  console.log(`${label}: ANCHORED`);
  return did;
}

/**
 * Run the full two-attendee cohort scenario against `baseUrl` (a dashboard page
 * plus two independent attendees) and return a list of problems (empty = pass).
 * `baseUrl` is the only thing that differs between the dev and prod topologies.
 */
export async function runCohortScenario(context: BrowserContext, baseUrl: string): Promise<string[]> {
  const problems: string[] = [];
  const pageErrors: string[] = [];
  const livePages: Array<{ page: Page; label: string }> = [];

  try {
    // 1) Dashboard page first so it captures the full cohort lifecycle.
    const dash = await context.newPage();
    livePages.push({ page: dash, label: 'dashboard' });
    trackPageErrors(dash, 'dashboard', pageErrors);
    await dash.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await dash.getByRole('button', { name: 'Coordinator' }).click();
    await dash.getByText('connected', { exact: false }).first().waitFor({ timeout: STEP_TIMEOUT_MS });
    console.log('dashboard connected to coordinator feed');

    // 2) Two independent attendees join the same advertised cohort.
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    livePages.push({ page: pageA, label: 'attendee-A' }, { page: pageB, label: 'attendee-B' });
    trackPageErrors(pageA, 'attendee-A', pageErrors);
    trackPageErrors(pageB, 'attendee-B', pageErrors);

    const [didA, didB] = await Promise.all([
      runAttendee(pageA, 'attendee-A', baseUrl),
      runAttendee(pageB, 'attendee-B', baseUrl),
    ]);
    if (didA === didB) {
      problems.push('both attendees produced the same DID (expected two distinct signers)');
    }

    // 3) A completed attendee must NOT auto-join the booth's next cohort. Give the
    //    re-advertise a few seconds to reach the (now torn-down) participants.
    console.log('verifying completed attendees do not auto-join the next cohort...');
    await new Promise((r) => setTimeout(r, 4000));
    for (const { page, label } of [
      { page: pageA, label: 'attendee-A' },
      { page: pageB, label: 'attendee-B' },
    ]) {
      const body = (await page.locator('body').textContent()) ?? '';
      const joinCount = (body.match(/joined cohort/g) ?? []).length;
      if (joinCount !== 1) {
        problems.push(`${label} joined ${joinCount} cohorts (expected exactly 1; it auto-rejoined the next advert)`);
      }
      if (!body.includes('update included')) {
        problems.push(`${label} no longer shows the anchored result after re-advertise (status flipped)`);
      }
    }

    // 4) The dashboard must show the completed cohort with an aggregated signature.
    console.log('verifying coordinator dashboard...');
    await dash.getByText('aggregated signature').first().waitFor({ timeout: STEP_TIMEOUT_MS });
    if ((await dash.getByText('complete', { exact: true }).count()) < 1) {
      problems.push('dashboard never showed a completed cohort');
    }
    // The 128-hex aggregated signature is the only contiguous 128-hex run on the
    // page (the txid is 64 hex and the beacon address is bech32).
    const dashText = (await dash.locator('body').textContent()) ?? '';
    const sigMatch = dashText.match(/[0-9a-f]{128}/i);
    if (!sigMatch) {
      problems.push('expected a 128-hex aggregated signature on the dashboard, found none');
    } else {
      console.log(`aggregated signature: ${sigMatch[0].slice(0, 16)}…${sigMatch[0].slice(-16)}`);
    }

    problems.push(...pageErrors);
  } catch (err) {
    problems.push(err instanceof Error ? (err.stack ?? err.message) : String(err));
    for (const { page, label } of livePages) {
      await dumpPage(page, label);
    }
  }

  return problems;
}

/** Launch headless Chromium against the cached binary. */
export async function launchBrowser() {
  const chromePath = resolveChromium();
  console.log(`launching headless Chromium (${chromePath})...`);
  return chromium.launch({
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}
