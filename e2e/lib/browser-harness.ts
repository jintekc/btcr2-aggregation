import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveNetwork, type IdType, type NetworkName } from '@btcr2-aggregation/shared';
import { Identifier } from '@did-btcr2/method';
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

/**
 * Drive one attendee page through generate -> join -> anchored, returning its DID.
 * `idType` selects the onboarding model: a KEY (`k1`) DID (default), or an EXTERNAL
 * (`x1`) DID (click the EXTERNAL toggle first; its genesis rides the opt-in, ADR 066).
 */
async function runAttendee(
  page: Page,
  label: string,
  baseUrl: string,
  idType: IdType = 'KEY',
  expectedNetwork: NetworkName = 'mutinynet',
): Promise<string> {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  if (idType === 'EXTERNAL') {
    await page.getByRole('radio', { name: 'EXTERNAL (x1)' }).click();
  }
  await page.getByRole('button', { name: 'Generate a DID' }).click();
  const did = (await page.locator('text=/^did:btcr2:/').first().textContent())?.trim() ?? '(unknown did)';
  const expectedPrefix = idType === 'EXTERNAL' ? 'did:btcr2:x1' : 'did:btcr2:k1';
  if (!did.startsWith(expectedPrefix)) {
    throw new Error(`${label}: expected a ${expectedPrefix}… DID for ${idType}, got ${did}`);
  }
  // The DID must be minted on the coordinator's RUNTIME network (from GET /v1/config),
  // not the build-time default. Decoding the identifier's network segment is what makes
  // the runtime-injection proof real: on a non-default coordinator this fails if the
  // browser generated the DID on the build-time constant instead of the served network.
  const didNetwork = Identifier.decode(did).network;
  if (didNetwork !== expectedNetwork) {
    throw new Error(
      `${label}: DID minted on network "${didNetwork}", expected the coordinator's "${expectedNetwork}" (runtime network not consumed?)`,
    );
  }
  console.log(`${label} (${idType}) on ${didNetwork}: ${did}`);
  await page.getByRole('button', { name: 'Join the cohort' }).click();
  console.log(`${label}: joined, co-signing...`);
  await page.getByText('update included').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
  console.log(`${label}: ANCHORED`);
  return did;
}

/**
 * After anchoring, exercise the M3e resolve UX on `page` (hermetic default: the
 * coordinator resolves over an offline chain, so a KEY DID resolves to its genesis
 * document and the live-only registration reports no funds). Verifies: server-driven
 * resolution renders the genesis document, the sovereign sidecar download exists, and
 * the first-update registration is wired (funding check -> awaiting funds). Pushes
 * any failure onto `problems`.
 */
async function verifyResolveUx(page: Page, label: string, problems: string[]): Promise<void> {
  try {
    // Server-driven resolve (GET /resolve/:did). Offline chain -> genesis document.
    await page.getByRole('button', { name: 'Resolve this DID' }).click();
    await page
      .getByText('genesis document', { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    if ((await page.getByText(/services \(\d+\)/).count()) < 1) {
      problems.push(`${label}: resolved document did not render a services list`);
    }
    // The controller's sovereign sidecar download must be available.
    if ((await page.getByRole('button', { name: 'Download resolution sidecar' }).count()) < 1) {
      problems.push(`${label}: no sidecar download button after anchoring`);
    }
    // First-update registration is live-only; the hermetic funding check reports no funds.
    await page.getByRole('button', { name: 'Check funds & register' }).click();
    await page
      .getByText(/No spendable funds/)
      .first()
      .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    console.log(`${label}: resolve UX verified (genesis doc rendered, sidecar available, live-only registration)`);
  } catch (err) {
    problems.push(`${label}: resolve UX failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Run the full two-attendee cohort scenario against `baseUrl` (a dashboard page
 * plus two independent attendees) and return a list of problems (empty = pass).
 * `baseUrl` is the only thing that differs between the dev and prod topologies.
 */
export async function runCohortScenario(
  context: BrowserContext,
  baseUrl: string,
  expectedNetwork: NetworkName = 'mutinynet',
): Promise<string[]> {
  const problems: string[] = [];
  const pageErrors: string[] = [];
  const livePages: Array<{ page: Page; label: string }> = [];

  try {
    // 1) Dashboard page first so it captures the full cohort lifecycle.
    const dash = await context.newPage();
    livePages.push({ page: dash, label: 'dashboard' });
    trackPageErrors(dash, 'dashboard', pageErrors);
    await dash.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    // Runtime network injection (M3f): the SPA fetches the coordinator's Bitcoin
    // network from GET /v1/config on load and derives its addresses/DIDs from it,
    // instead of a build-time constant. Prove it same-origin, in dev (proxied) and prod
    // (Hono): the endpoint is reachable AND the App rendered the SERVED network's label.
    // When expectedNetwork differs from the build-time default, this label check is a
    // genuine runtime-consumption proof (a build-time-constant SPA would render the
    // wrong label); the DID-network check in runAttendee proves minting uses it too.
    const expected = resolveNetwork(expectedNetwork);
    const cfg = (await dash.evaluate(async () => {
      const r = await fetch('/v1/config', { headers: { accept: 'application/json' } });
      return r.ok ? ((await r.json()) as { network: string; label: string; isMainnet: boolean }) : null;
    })) as { network: string; label: string; isMainnet: boolean } | null;
    if (!cfg) {
      problems.push('GET /v1/config was not reachable from the browser (same-origin)');
    } else {
      if (cfg.network !== expected.name) {
        problems.push(`GET /v1/config served network "${cfg.network}", expected "${expected.name}"`);
      }
      if (cfg.isMainnet !== expected.isMainnet) {
        problems.push(`GET /v1/config reported isMainnet=${cfg.isMainnet}, expected ${expected.isMainnet}`);
      }
      // The header badge renders the runtime label, proving the App consumed the config.
      if ((await dash.getByText(expected.label, { exact: false }).count()) < 1) {
        problems.push(`header did not render the runtime network label "${expected.label}"`);
      }
      console.log(`browser consumed GET /v1/config: ${cfg.network} (${cfg.label})`);
    }

    await dash.getByRole('button', { name: 'Coordinator' }).click();
    await dash.getByText('connected', { exact: false }).first().waitFor({ timeout: STEP_TIMEOUT_MS });
    console.log('dashboard connected to coordinator feed');

    // 2) Two independent attendees join the same advertised cohort.
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    livePages.push({ page: pageA, label: 'attendee-A' }, { page: pageB, label: 'attendee-B' });
    trackPageErrors(pageA, 'attendee-A', pageErrors);
    trackPageErrors(pageB, 'attendee-B', pageErrors);

    // A mixed cohort: attendee-A is a KEY (k1) DID, attendee-B an EXTERNAL (x1) DID.
    // Both authenticate and co-sign the same cohort in-browser - proving the ADR 066
    // x1 onboarding path end to end through the real UI (toggle -> genesis on the opt-in).
    const [didA, didB] = await Promise.all([
      runAttendee(pageA, 'attendee-A', baseUrl, 'KEY', expectedNetwork),
      runAttendee(pageB, 'attendee-B', baseUrl, 'EXTERNAL', expectedNetwork),
    ]);
    if (didA === didB) {
      problems.push('both attendees produced the same DID (expected two distinct signers)');
    }
    if (!didB.startsWith('did:btcr2:x1')) {
      problems.push(`attendee-B expected an x1 (EXTERNAL) DID, got ${didB}`);
    }

    // 2b) Exercise the resolve UX on BOTH: the k1 attendee (server-driven GET resolve)
    //     and the x1 attendee (POST resolve carrying its genesis) - each resolving to
    //     its genesis document over the offline chain, with the sovereign sidecar
    //     download and the live-only first-update registration.
    await verifyResolveUx(pageA, 'attendee-A', problems);
    await verifyResolveUx(pageB, 'attendee-B', problems);

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

/**
 * Drive the MAINNET guard rails end to end through the real UI against a
 * mainnet-configured (offline) coordinator: the header must show the REAL FUNDS
 * badge, a solo cohort completes on the fixture path, and the first-update
 * registration must be checkbox-gated - button disabled until the real-funds
 * acknowledgment is ticked, then the acknowledged flow reaches the funds check
 * (offline chain: reports no funds, so no tx can move). This pins the RegisterPanel
 * wiring the store-level ack gate alone cannot see (a regression hardcoding
 * `acknowledgeMainnet: true` or dropping the checkbox fails here).
 */
export async function runMainnetRailsScenario(
  context: BrowserContext,
  baseUrl: string,
): Promise<string[]> {
  const problems: string[] = [];
  const pageErrors: string[] = [];
  const page = await context.newPage();
  trackPageErrors(page, 'mainnet-attendee', pageErrors);

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    // The runtime isMainnet flag (GET /v1/config) must flip the header badge.
    await page.getByText('REAL FUNDS', { exact: false }).first().waitFor({ timeout: STEP_TIMEOUT_MS });

    // Solo cohort (minParticipants=1 coordinator) so the RegisterPanel appears.
    await page.getByRole('button', { name: 'Generate a DID' }).click();
    const did = (await page.locator('text=/^did:btcr2:/').first().textContent())?.trim() ?? '';
    const didNetwork = Identifier.decode(did).network;
    if (didNetwork !== 'bitcoin') {
      problems.push(`mainnet attendee minted a DID on "${didNetwork}", expected "bitcoin"`);
    }
    await page.getByRole('button', { name: 'Join the cohort' }).click();
    await page.getByText('update included').first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });

    // The register panel must warn about real funds and gate the button behind
    // the acknowledgment checkbox.
    await page.getByText(/spends real bitcoin/i).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    const registerBtn = page.getByRole('button', { name: 'Check funds & register' });
    if (await registerBtn.isEnabled()) {
      problems.push('mainnet register button was ENABLED before the real-funds acknowledgment');
    }
    await page.getByRole('checkbox').check();
    if (!(await registerBtn.isEnabled())) {
      problems.push('mainnet register button stayed disabled after the acknowledgment was ticked');
    }
    // The acknowledged click must pass the store gate and reach the funds check;
    // the offline chain reports no funds, so registration stops there (no tx).
    await registerBtn.click();
    await page.getByText(/No spendable funds/).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    console.log('mainnet rails verified: badge, warning, checkbox-gated registration -> funds check');

    problems.push(...pageErrors);
  } catch (err) {
    problems.push(err instanceof Error ? (err.stack ?? err.message) : String(err));
    await dumpPage(page, 'mainnet-attendee');
  }

  return problems;
}

/**
 * Drive the opt-in IPFS publish (ADR 0011) end to end through the real UI
 * against an IPFS-enabled coordinator: an EXTERNAL (x1) attendee completes a
 * solo cohort, clicks "Publish to IPFS" (loading the lazy Helia chunk, booting
 * the in-browser node, dialing the coordinator's websocket multiaddr), and the
 * panel must report every artifact pinned - with the GENESIS pinned via
 * 'network', the path-unique proof that a real bitswap transfer crossed from
 * the browser (the coordinator never holds an x1 genesis; its store could
 * satisfy the other artifacts, so only the genesis proves the browser leg).
 */
export async function runIpfsPublishScenario(
  context: BrowserContext,
  baseUrl: string,
): Promise<string[]> {
  const problems: string[] = [];
  const pageErrors: string[] = [];
  const page = await context.newPage();
  trackPageErrors(page, 'ipfs-attendee', pageErrors);

  try {
    // EXTERNAL identity on purpose: the genesis is the artifact whose pin can
    // only come over the wire. Solo cohort (minParticipants=1 coordinator).
    const did = await runAttendee(page, 'ipfs-attendee', baseUrl, 'EXTERNAL', 'mutinynet');
    if (!did.startsWith('did:btcr2:x1')) {
      problems.push(`ipfs attendee expected an x1 DID, got ${did}`);
    }

    const publishBtn = page.getByRole('button', { name: /^Publish to IPFS$|^Publish again$/ });
    await publishBtn.first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });
    if (!(await publishBtn.first().isEnabled())) {
      problems.push('publish button is disabled although the coordinator runs an IPFS node');
      return problems;
    }
    await publishBtn.first().click();

    // The Badge flips to exactly 'published' on success ('not published' fails
    // the exact match, so this cannot false-green on the idle state).
    await page
      .getByText('published', { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS });

    // Three artifacts (update + CAS announcement + genesis), each rendering its
    // raw CIDv1 (base32 'bafkrei' + 52 chars) in the panel's copy field. The
    // locator matches elements whose ENTIRE text is one bare CID, so this is
    // attributable to the panel's CopyFields: activity-log lines embed CIDs in
    // longer sentences and cannot satisfy it (a body-text regex could - the
    // false-green a panel-drop regression would slip through).
    const cidCount = await page.locator('text=/^bafkrei[a-z2-7]{52}$/').count();
    if (cidCount < 3) {
      problems.push(`expected 3 artifact-CID copy fields in the publish panel, found ${cidCount}`);
    }
    const body = (await page.locator('body').textContent()) ?? '';
    // The per-row pin badges (log lines phrase it differently, so these are
    // panel-only strings).
    const pinnedCount = (body.match(/pinned \((store|network|local|already-pinned)\)/g) ?? []).length;
    if (pinnedCount < 3) {
      problems.push(`expected 3 pinned artifact rows, found ${pinnedCount}`);
    }
    // The path-unique signal: the genesis block crossed over bitswap (the badge
    // requires ALL rows pinned for 'published', and the genesis is never in the
    // coordinator's store, so its pin can only be a real transfer).
    if (!body.includes('pinned (network)')) {
      problems.push("no artifact was pinned via 'network' - the browser->coordinator bitswap leg never ran");
    }
    console.log(`ipfs publish verified: ${cidCount} CID copy fields, genesis pinned over bitswap`);

    problems.push(...pageErrors);
  } catch (err) {
    problems.push(err instanceof Error ? (err.stack ?? err.message) : String(err));
    await dumpPage(page, 'ipfs-attendee');
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
