import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Hermetic regtest chain harness: a throwaway bitcoind (regtest) plus an
 * esplora-fork electrs serving the REST API the app's `BitcoinConnection`
 * consumes (`/blocks/tip/height`, `/address/:addr/{utxo,txs}`, `/tx/:txid[/hex]`,
 * `POST /tx`). This is the "regtest CI node" of M3-PLAN's definition of done: it
 * turns the operator-funded live legs into fully automated ones - funding is a
 * wallet send, confirmation is a mined block, no human in the loop.
 *
 * Everything is process-owned and disposable: a mkdtemp datadir, ephemeral ports,
 * children killed on stop() (and best-effort on process exit), the datadir
 * removed. Binaries resolve from the PATH (`bitcoind`, `bitcoin-cli`, `electrs`)
 * or the `BITCOIND_EXEC` / `BITCOIN_CLI_EXEC` / `ELECTRS_EXEC` env overrides -
 * the same shape CI uses after downloading the pinned artifacts (see
 * .github/workflows/ci.yml and docs/adr/0013).
 *
 * electrs must be the Blockstream esplora fork (the one with `--http-addr`);
 * romanz/electrs speaks only the Electrum protocol and cannot serve this app.
 * `--jsonrpc-import` makes electrs index via the bitcoind JSON-RPC instead of
 * parsing blk files, which avoids a fresh-datadir race (what nigiri does).
 */

const execFileAsync = promisify(execFile);

/** One OS-assigned free TCP port (bind to 0, read it back, release). */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/** Poll `fn` every `intervalMs` until it returns truthy or `timeoutMs` elapses. */
async function poll<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Esplora `GET /address/:addr/utxo` entry subset the harness reads. */
interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

export interface RegtestStackOptions {
  /** Suppress the harness's own progress lines. */
  quiet?: boolean;
  /** Blocks mined at startup to mature a coinbase (default 101). */
  initialBlocks?: number;
}

export interface RegtestStack {
  /** The esplora REST base URL (`http://127.0.0.1:<port>`), for `resolveNetwork('regtest', host)`. */
  esploraHost: string;
  /**
   * Send `sats` to `address` from the mining wallet, mine one block, and wait
   * until esplora serves the CONFIRMED UTXO at that address (the app's funding
   * pre-flights read esplora, so indexed-and-confirmed is the contract here).
   * Returns the funding txid so callers can assert the beacon tx spends it.
   */
  fund(address: string, sats: number): Promise<string>;
  /** Mine `blocks` to the harness wallet and wait for esplora to index the new tip. */
  mine(blocks: number): Promise<void>;
  /**
   * Mine one block every `intervalMs` (default 1500) until stopped - the regtest
   * stand-in for a live network's block cadence, so the app's own confirmation
   * polling (`isConfirmed`) is exercised unmodified rather than short-circuited.
   */
  startAutoMine(intervalMs?: number): void;
  stopAutoMine(): void;
  /** Stop electrs + bitcoind and remove the datadir. Safe to call twice. */
  stop(): Promise<void>;
}

/** Start a throwaway bitcoind(regtest) + esplora-electrs pair. */
export async function startRegtestStack(opts: RegtestStackOptions = {}): Promise<RegtestStack> {
  const log = opts.quiet ? () => {} : (msg: string) => console.log(`[regtest] ${msg}`);
  const bitcoindExec = process.env.BITCOIND_EXEC ?? 'bitcoind';
  const bitcoinCliExec = process.env.BITCOIN_CLI_EXEC ?? 'bitcoin-cli';
  const electrsExec = process.env.ELECTRS_EXEC ?? 'electrs';

  const datadir = await mkdtemp(join(tmpdir(), 'btcr2-regtest-'));
  const [rpcPort, p2pPort, httpPort, electrumPort, monitoringPort] = await Promise.all([
    freePort(), freePort(), freePort(), freePort(), freePort(),
  ]);
  const esploraHost = `http://127.0.0.1:${httpPort}`;

  const children: ChildProcess[] = [];
  let stopped = false;
  let autoMineTimer: NodeJS.Timeout | undefined;
  let miningInFlight = false;
  // Assigned during startup (needs the wallet); `mine` closes over it.
  let mineAddress = '';

  // Best-effort orphan prevention: children do NOT die with the parent on their
  // own, so kill them synchronously if the process exits without stop().
  const killChildren = () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  };
  process.once('exit', killChildren);

  /**
   * Run bitcoin-cli against this node. `-rpcwait` rides out startup;
   * `-rpcwaittimeout` bounds it so a dead node errors instead of hanging.
   */
  const cli = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync(bitcoinCliExec, [
      '-regtest', `-datadir=${datadir}`, `-rpcport=${rpcPort}`, '-rpcwait', '-rpcwaittimeout=15', ...args,
    ]);
    return stdout.trim();
  };

  /** Tail a child's log file into a startup-failure error message. */
  const logTail = async (file: string): Promise<string> => {
    const text = await readFile(join(datadir, file), 'utf8').catch(() => '');
    return text.split('\n').slice(-15).join('\n');
  };

  const spawnLogged = (name: string, exec: string, args: string[]): ChildProcess => {
    const child = spawn(exec, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    children.push(child);
    child.on('error', (err) => {
      console.error(`[regtest] failed to spawn ${name} (${exec}): ${err.message}`);
    });
    return child;
  };

  const esploraGet = async (path: string): Promise<Response> => fetch(`${esploraHost}${path}`);

  /** The RPC-side tip height (the truth esplora must catch up to). */
  const rpcHeight = async (): Promise<number> => Number(await cli('getblockcount'));

  /** Wait until esplora's tip reaches `height` (index sync after mining). */
  const waitForEsploraHeight = async (height: number): Promise<void> => {
    await poll(async () => {
      const res = await esploraGet('/blocks/tip/height');
      if (!res.ok) {
        return undefined;
      }
      const tip = Number(await res.text());
      return tip >= height ? tip : undefined;
    }, 60_000, 250, `esplora tip >= ${height}`);
  };

  const mine = async (blocks: number): Promise<void> => {
    await cli('generatetoaddress', String(blocks), mineAddress);
    await waitForEsploraHeight(await rpcHeight());
  };

  try {
    // 1. bitcoind. -txindex lets esplora serve arbitrary /tx/:txid lookups;
    //    -fallbackfee keeps wallet sends working with no fee history to estimate from.
    spawnLogged('bitcoind', bitcoindExec, [
      '-regtest', `-datadir=${datadir}`, `-rpcport=${rpcPort}`, `-port=${p2pPort}`,
      '-txindex=1', '-fallbackfee=0.0001', '-listen=1', '-server=1',
      `-debuglogfile=${join(datadir, 'bitcoind.log')}`,
    ]);
    await poll(() => cli('getblockchaininfo').then(() => true as const), 30_000, 250, 'bitcoind RPC');
    await cli('createwallet', 'miner');
    mineAddress = await cli('getnewaddress');
    const initialBlocks = opts.initialBlocks ?? 101;
    await cli('generatetoaddress', String(initialBlocks), mineAddress);
    log(`bitcoind up (rpc :${rpcPort}), mined ${initialBlocks} blocks`);

    // 2. electrs (esplora HTTP API). Cookie auth is read from the daemon-dir.
    await mkdir(join(datadir, 'electrs-db'), { recursive: true });
    spawnLogged('electrs', electrsExec, [
      '--network', 'regtest',
      '--daemon-dir', datadir,
      '--daemon-rpc-addr', `127.0.0.1:${rpcPort}`,
      '--db-dir', join(datadir, 'electrs-db'),
      '--http-addr', `127.0.0.1:${httpPort}`,
      '--electrum-rpc-addr', `127.0.0.1:${electrumPort}`,
      '--monitoring-addr', `127.0.0.1:${monitoringPort}`,
      '--jsonrpc-import',
    ]);
    await waitForEsploraHeight(initialBlocks).catch(async (err) => {
      throw new Error(
        `${(err as Error).message}\n--- electrs may have failed; bitcoind log tail:\n${await logTail('bitcoind.log')}`,
      );
    });
    log(`esplora REST up at ${esploraHost}`);

    const fund = async (address: string, sats: number): Promise<string> => {
      const btc = (sats / 1e8).toFixed(8);
      const txid = await cli('sendtoaddress', address, btc);
      await mine(1);
      await poll(async () => {
        const res = await esploraGet(`/address/${address}/utxo`);
        if (!res.ok) {
          return undefined;
        }
        const utxos = (await res.json()) as EsploraUtxo[];
        return utxos.some((u) => u.txid === txid && u.status.confirmed && u.value >= sats)
          ? true as const
          : undefined;
      }, 60_000, 250, `confirmed ${sats}-sat UTXO at ${address}`);
      log(`funded ${address} with ${sats} sats (${txid})`);
      return txid;
    };

    const stop = async (): Promise<void> => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (autoMineTimer) {
        clearInterval(autoMineTimer);
      }
      const exits = children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            child.once('exit', () => resolve());
          }),
      );
      // electrs first (it holds an RPC connection into bitcoind), then bitcoind.
      children[1]?.kill('SIGTERM');
      await cli('stop').catch(() => {});
      await Promise.race([
        Promise.all(exits),
        new Promise((r) => setTimeout(r, 10_000)),
      ]);
      killChildren();
      process.removeListener('exit', killChildren);
      await rm(datadir, { recursive: true, force: true });
      log('stopped and cleaned up');
    };

    return {
      esploraHost,
      fund,
      mine,
      startAutoMine(intervalMs = 1500) {
        if (autoMineTimer) {
          return;
        }
        autoMineTimer = setInterval(() => {
          if (miningInFlight || stopped) {
            return;
          }
          miningInFlight = true;
          mine(1)
            .catch(() => {})
            .finally(() => {
              miningInFlight = false;
            });
        }, intervalMs);
        autoMineTimer.unref();
      },
      stopAutoMine() {
        if (autoMineTimer) {
          clearInterval(autoMineTimer);
          autoMineTimer = undefined;
        }
      },
      stop,
    };
  } catch (err) {
    killChildren();
    process.removeListener('exit', killChildren);
    await rm(datadir, { recursive: true, force: true });
    throw err;
  }
}
