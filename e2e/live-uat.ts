import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startDemoServer, MIN_LIVE_FUNDING_SATS } from '@btcr2-aggregation/service';
import { resolveNetwork } from '@btcr2-aggregation/shared';

/**
 * Manual live-UAT harness (D-48): a broadcast-enabled coordinator + web SPA pointed at an
 * EXTERNAL regtest chain you already run (Polar with esplora on top, or any bitcoind + esplora
 * pair). The chain is yours: you fund addresses and mine blocks from Polar; this process only
 * tells you WHAT to fund and mirrors the on-chain lifecycle so you can compare the UI's claims
 * with chain truth. This is the repeatable opt-in live check the owner runs against Polar; the
 * step-by-step walkthrough is `.planning/phases/04-operator-cohort-monitoring/04-LIVE-UAT-CHECKLIST.md`.
 *
 * RESHAPED onto the env-passthrough boot (D-48): the harness now boots through the SAME product
 * path a real deployment uses, {@link startDemoServer} with `LIVE=1 BROADCAST=1`, which threads
 * `{ live: true, broadcast: true, changeAddress, allowMainnet, fundingWindowMs }` into
 * `createService` behind the ADR 0010 guard rails (04-05). The old `getUtxos` monkey-patch that
 * held the tx builder's UTXO read until funding confirmed is GONE: the NATIVE funding stage
 * (04-06) now owns that wait honestly (poll until funded, dead-end on a below-minimum UTXO, throw
 * the specific "funding never arrived" reason on a clean lapse), and the operator console renders
 * the funding stage + the `Needs funding` chip. The harness keeps only what a terminal is good
 * for: the runner-event tap (the primary server-side debugging surface for a UAT run), the
 * keygen-complete funding PROMPT (so you know which address to fund from Polar), the broadcaster
 * lifecycle mirror, and the human-paced timeouts. Not part of the hermetic gate; never in CI (the
 * hermetic mocked-chain funding leg in `e2e/live-mock-cohort.ts` + the fixture monitoring e2e are
 * the automated evidence of record, D-47).
 *
 * Usage:
 *   1. Start your Polar network (with its esplora REST endpoint up).
 *   2. ESPLORA_HOST=http://127.0.0.1:3000 pnpm uat:live   (set your actual port)
 *   3. Open the printed URL, sign in to the operator console, create + advertise a cohort; join
 *      and submit from participant browser windows.
 *   4. When the cohort's seats fill, keygen runs and the operator console surfaces the funding
 *      stage (the harness also prints FUND THIS ADDRESS with the cohort beacon address): send it
 *      ONE UTXO >= the suggested minimum from Polar and mine a block so it confirms. No rush: the
 *      native funding stage holds co-signing until the funding confirms or the funding window
 *      (FUND_WAIT_MS, default 15 min) elapses, so submit order and funding order do not race.
 *   5. After co-signing the service broadcasts the beacon tx. Do NOT mine yet: the UI must hold
 *      "Signed"/"Broadcast" with "Confirmed: pending" beneath (UAT Test 1). Then mine one block in
 *      Polar PROMPTLY (the confirm poll runs on the createService default budget): every surface
 *      must flip to Anchored/Confirmed together within the confirm poll.
 *   6. Failed-broadcast / funding-dead-end repro: simply do not fund the printed address; the
 *      funding stage advances to its honest dead-end / "funding never arrived" terminal copy.
 *
 * Registration addresses (the participant "Register first update" card) are derived in the browser,
 * so the harness never sees them: fund those straight from Polar too. This leg is REQUIRED before a
 * resolve reflects a KEY (k1) participant's FIRST update (ADR 0007): the resolver only discovers
 * signals at beacons already in the document under resolution, and a KEY genesis holds only the
 * participant's own singleton beacons, never the cohort's aggregate beacon. So after the cohort
 * anchor confirms, EACH participant must fund their registration address (>= the displayed minimum,
 * ~1330 sats) from Polar, mine a block, let the page broadcast the registration tx, and mine one
 * more block to confirm it - only then does resolve show the update. The cohort anchor makes 2nd+
 * updates resolvable, never the first. See the "Register the first update" section of the checklist.
 *
 * Env knobs: ESPLORA_HOST (default http://127.0.0.1:3000), NETWORK (default regtest), PORT
 * (default 8080), OPERATOR_PASSWORD (default "live-uat"), MIN_PARTICIPANTS (seed config default 2;
 * the operator console overrides per cohort), FUND_SATS (printed funding hint, floored at
 * MIN_LIVE_FUNDING_SATS), FUND_WAIT_MS (the native funding window in ms; how long co-signing waits
 * for the beacon funding, default 900000 = 15 min), RECOVERY_KEY (optional; throwaway regtest sats,
 * so the boot warning is fine here).
 */

function log(msg: string): void {
  console.log(`[live-uat] ${msg}`);
}

async function main(): Promise<void> {
  const webDist = fileURLToPath(new URL('../packages/web/dist', import.meta.url));
  if (!existsSync(webDist)) {
    throw new Error(`web SPA not built at ${webDist}; run \`pnpm -r build\` first`);
  }
  const esploraHost = process.env.ESPLORA_HOST ?? 'http://127.0.0.1:3000';
  const net = resolveNetwork(process.env.NETWORK ?? 'regtest', esploraHost);
  const fundSats = Math.max(MIN_LIVE_FUNDING_SATS, Number(process.env.FUND_SATS ?? 100_000));
  const operatorPassword = process.env.OPERATOR_PASSWORD ?? 'live-uat';
  // The native funding window (04-06 D-38) the co-sign wait allows for the human to fund the
  // beacon address from Polar. Kept human-paced; the phase-stall timeout below MUST exceed it
  // (startDemoServer enforces this boot invariant under BROADCAST=1, 04-05 D-38 phase-timeout leg).
  const fundingWindowMs = Number(process.env.FUND_WAIT_MS ?? 900_000);
  const phaseTimeoutMs = 1_800_000;

  // Fail fast with a pointed message if the esplora REST endpoint is not there, instead of letting
  // the first in-cohort chain read surface a confusing 502.
  const tip = await fetch(`${esploraHost}/blocks/tip/height`)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .catch((err: unknown) => {
      throw new Error(
        `esplora unreachable at ${esploraHost} (${err instanceof Error ? err.message : String(err)}); ` +
          'start your Polar network (with esplora) and/or set ESPLORA_HOST to its REST URL',
      );
    });

  // Boot through the PRODUCT path: the env-passthrough demo-server with the live+broadcast cohort
  // path enabled (LIVE=1 BROADCAST=1). createService receives { live, broadcast, fundingWindowMs }
  // and wires the native funding stage + on-chain beacon broadcast; no monkey-patch. Human-paced
  // timeouts: the submit/co-sign windows wait on a person reading UI copy (and funding an address
  // in Polar), not an e2e script.
  const demo = await startDemoServer({
    port: Number(process.env.PORT ?? 8080),
    host: '127.0.0.1',
    network: net.name,
    esploraHost,
    live: true,
    broadcast: true,
    operatorPassword,
    // Plain-http localhost UAT: a Secure cookie would be the one thing between the human and the
    // operator console, for zero security on a throwaway chain.
    operatorCookieSecure: false,
    minParticipants: Number(process.env.MIN_PARTICIPANTS ?? 2),
    recoveryKey: process.env.RECOVERY_KEY,
    fundingWindowMs,
    // The signing-phase timeout must comfortably exceed the funding window or the stall timer would
    // fire mid-funding-wait; startDemoServer also fail-fast-validates this under BROADCAST=1.
    phaseTimeoutMs,
    cohortTtlMs: phaseTimeoutMs,
    webDistDir: webDist,
  });
  const { service, baseUrl } = demo;

  // The cohort's Taproot beacon address exists only once seats fill and MuSig2 key aggregation
  // runs; the runner announces it here. Print it loudly: funding is the human's job (Polar), and
  // the native funding stage holds co-signing until it confirms (or the window elapses).
  service.runner.on('keygen-complete', (info: { cohortId?: string; beaconAddress: string }) => {
    console.log('');
    console.log('!'.repeat(64));
    console.log('  FUND THIS ADDRESS (cohort beacon), then mine 1 block in Polar:');
    console.log(`    ${info.beaconAddress}`);
    console.log(`    one UTXO >= ${fundSats} sats (the console shows the exact suggested minimum);`);
    console.log(`    co-signing WAITS up to ${Math.round(fundingWindowMs / 60_000)} min for it to confirm`);
    console.log('    (never fund it to reproduce the funding dead-end / failed-broadcast case)');
    console.log('!'.repeat(64));
    console.log('');
  });

  // Diagnostic tap: when a cohort dies, the participant UI often renders a generic stall line
  // because the real reason never reaches it, so the server-side runner lifecycle mirrored here is
  // the primary debugging surface for a UAT run. `update-received` counts prove whether every
  // member's submission actually arrived; `message-rejected`/`cohort-failed`/`error` carry the
  // real cause.
  const tap = (event: string) => (payload: unknown) => {
    if (payload instanceof Error) {
      log(`${event}: ${payload.message}`);
      return;
    }
    const p = (payload ?? {}) as Record<string, unknown>;
    const bits: string[] = [];
    for (const key of ['cohortId', 'participantDid', 'reason', 'message', 'phase', 'code']) {
      const v = p[key];
      if (typeof v === 'string' && v) {
        bits.push(`${key}=${v}`);
      }
    }
    if (p.error instanceof Error) {
      bits.push(`error=${p.error.message}`);
    } else if (typeof p.error === 'string' && p.error) {
      bits.push(`error=${p.error}`);
    }
    log(`${event}${bits.length ? ` ${bits.join(' ')}` : ''}`);
  };
  for (const event of [
    'participant-accepted',
    'update-received',
    'signing-started',
    'fallback-started',
    'message-rejected',
    'signing-complete',
    'cohort-failed',
    'error',
  ] as const) {
    // Same cast the dashboard SSE bridge used: one generic listener over a union of per-event
    // payload types.
    service.runner.on(event, tap(event) as never);
  }

  // Terminal mirror of the on-chain lifecycle so the human can correlate what the browser claims
  // with what the chain actually did.
  service.broadcaster?.on('beacon-broadcast', ({ cohortId, txid }) => {
    log(`BROADCAST cohort=${cohortId} txid=${txid} (unconfirmed; mine 1 block in Polar when ready)`);
  });
  service.broadcaster?.on('beacon-anchored', ({ cohortId, txid, confirmed }) => {
    log(`ANCHORED cohort=${cohortId} txid=${txid} confirmed=${confirmed}`);
  });
  service.broadcaster?.on('beacon-broadcast-failed', ({ cohortId, reason }) => {
    log(`BROADCAST FAILED cohort=${cohortId}: ${reason}`);
  });

  console.log('');
  console.log('='.repeat(64));
  console.log('  live-UAT harness up (broadcast-enabled; chain is YOURS via Polar)');
  console.log(`  app:               ${baseUrl}`);
  console.log(`  operator password: ${operatorPassword}`);
  console.log(`  esplora:           ${esploraHost} (tip height ${tip})`);
  console.log(`  network:           ${net.name}`);
  console.log('  fund + mine from Polar when addresses are printed; Ctrl-C stops');
  console.log('='.repeat(64));
  console.log('');

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log('stopping service...');
    await demo.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(`[live-uat] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
