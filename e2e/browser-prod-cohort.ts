import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startDemoServer, type DemoServer } from '@btcr2-aggregation/service';
import {
  STEP_TIMEOUT_MS,
  launchBrowser,
  runCohortScenario,
  runMainnetRailsScenario,
} from './lib/browser-harness.js';
import type { Browser } from 'playwright-core';

/*
 * M2 browser E2E, PRODUCTION topology. This exercises the real deployment shape:
 * a single Hono server (the coordinator) serves the built web SPA, the protocol
 * routes, and the dashboard feed all from ONE origin, with no Vite and no proxy.
 * The browser talks to that origin directly (same-origin, zero CORS), exactly as
 * a deployed conference demo would. Headless Chromium drives a dashboard page
 * plus two attendees to a real 128-hex key-path aggregated signature.
 *
 * This topology runs on a NON-DEFAULT network (signet) on purpose: it forces the SPA
 * to consume GET /v1/config at runtime (the header label and every minted DID must be
 * signet, not the build-time mutinynet default), so the runtime-network-injection proof
 * is real and not a false-green. The dev topology covers the default network.
 */

const WEB_DIST = fileURLToPath(new URL('../packages/web/dist', import.meta.url));

/** A non-default network so the browser must derive it from GET /v1/config, not the bundle. */
const SERVED_NETWORK = 'signet';

async function main(): Promise<number> {
  let coordinator: DemoServer | undefined;
  let mainnetCoordinator: DemoServer | undefined;
  let browser: Browser | undefined;
  let problems: string[] = [];

  try {
    if (!existsSync(WEB_DIST)) {
      throw new Error(`web build not found at ${WEB_DIST} (run \`pnpm -r build\` first)`);
    }

    console.log('starting demo coordinator on an ephemeral port (prod topology: Hono serves the web build)...');
    coordinator = await startDemoServer({
      port: 0,
      minParticipants: 2,
      fillers: 0,
      network: SERVED_NETWORK, // non-default: the SPA must consume it from GET /v1/config
      webDistDir: WEB_DIST, // single-origin: Hono serves the SPA + protocol + dashboard
    });
    console.log(`coordinator + web served at ${coordinator.baseUrl} (network=${SERVED_NETWORK})`);

    browser = await launchBrowser();
    const context = await browser.newContext();
    console.log(`step timeout ${STEP_TIMEOUT_MS}ms`);
    // Same origin as the coordinator: no proxy, no CORS. Assert the browser mints on
    // the served (non-default) network, proving runtime injection end to end.
    problems = await runCohortScenario(context, coordinator.baseUrl, SERVED_NETWORK);

    // MAINNET guard rails (ADR 0010), through the real UI: a second coordinator on
    // `bitcoin` (offline chain - zero live I/O - opted in via allowMainnet, solo
    // cohorts so the register panel appears). The SPA must render the REAL FUNDS
    // badge and keep the first-update registration checkbox-gated; the acknowledged
    // flow ends at the offline funds check, so nothing can broadcast.
    console.log('starting mainnet-configured (offline) coordinator for the guard-rails scenario...');
    mainnetCoordinator = await startDemoServer({
      port: 0,
      minParticipants: 1,
      fillers: 0,
      network: 'bitcoin',
      allowMainnet: true,
      webDistDir: WEB_DIST,
      quiet: true,
    });
    const mainnetContext = await browser.newContext();
    problems.push(...(await runMainnetRailsScenario(mainnetContext, mainnetCoordinator.baseUrl)));
  } catch (err) {
    problems.push(err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (coordinator) await coordinator.stop().catch(() => {});
    if (mainnetCoordinator) await mainnetCoordinator.stop().catch(() => {});
  }

  if (problems.length > 0) {
    console.error('\nBROWSER E2E (prod topology) FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log(
    '\nBROWSER E2E (prod topology) PASSED: Hono served the SPA + protocol + dashboard from one origin; ' +
      'two attendees reached a real aggregated Taproot signature, and the mainnet guard rails held in the UI.',
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
