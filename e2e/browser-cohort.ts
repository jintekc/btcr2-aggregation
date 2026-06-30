import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startDemoServer, type DemoServer } from '@btcr2-aggregation/service';
import {
  STEP_TIMEOUT_MS,
  getFreePort,
  launchBrowser,
  runCohortScenario,
  waitForApp,
} from './lib/browser-harness.js';
import type { Browser } from 'playwright-core';

/*
 * M2 browser E2E, DEV topology. The coordinator (createService + advertise loop)
 * runs on an ephemeral port and the production web build is served by
 * `vite preview`, which proxies /v1 + /dashboard to the coordinator (the
 * coordinator origin is injected via COORDINATOR_ORIGIN so no port is hardcoded).
 * Headless Chromium drives a dashboard page plus two attendees to a real 128-hex
 * key-path aggregated signature. The prod static-serve topology is covered
 * separately by browser-prod-cohort.ts.
 */

const WEB_DIR = fileURLToPath(new URL('../packages/web', import.meta.url));

/**
 * Spawn `vite preview` for the built web app and wait until it serves. Spawn the
 * resolved vite binary directly (not via the `pnpm exec` shim) so the captured
 * PID IS the server and a single SIGTERM tears it down instead of orphaning a
 * grandchild that leaks the port.
 */
async function startPreview(port: number, coordinatorOrigin: string): Promise<ChildProcess> {
  const viteBin = join(WEB_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [viteBin, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: WEB_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, COORDINATOR_ORIGIN: coordinatorOrigin },
    },
  );
  child.stdout?.on('data', (d) => process.env.PREVIEW_DEBUG && process.stdout.write(`[preview] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[preview] ${d}`));
  await waitForApp(url, 30_000);
  return child;
}

/** Stop the preview server, escalating to SIGKILL and awaiting exit so the port frees. */
async function stopPreview(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    kill.unref();
    child.once('exit', () => {
      clearTimeout(kill);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function main(): Promise<number> {
  let coordinator: DemoServer | undefined;
  let preview: ChildProcess | undefined;
  let browser: Browser | undefined;
  let problems: string[] = [];

  try {
    console.log('starting demo coordinator on an ephemeral port (dev topology, web not served by Hono)...');
    coordinator = await startDemoServer({
      port: 0,
      minParticipants: 2,
      fillers: 0,
      webDistDir: null, // dev topology serves the app via vite preview, not Hono
    });

    const previewPort = await getFreePort();
    const previewUrl = `http://127.0.0.1:${previewPort}`;
    console.log(`starting vite preview on ${previewUrl} (proxying to ${coordinator.baseUrl})...`);
    preview = await startPreview(previewPort, coordinator.baseUrl);

    browser = await launchBrowser();
    const context = await browser.newContext();
    console.log(`step timeout ${STEP_TIMEOUT_MS}ms`);
    problems = await runCohortScenario(context, previewUrl);
  } catch (err) {
    problems.push(err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (preview) await stopPreview(preview);
    if (coordinator) await coordinator.stop().catch(() => {});
  }

  if (problems.length > 0) {
    console.error('\nBROWSER E2E (dev topology) FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  console.log('\nBROWSER E2E (dev topology) PASSED: two in-browser attendees drove one cohort to a real aggregated Taproot signature.');
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
