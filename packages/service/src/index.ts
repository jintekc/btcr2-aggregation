import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import {
  AggregationServiceRunner,
  HttpServerTransport,
  type CohortConfig,
} from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import type { Identity } from '@btcr2-aggregation/shared';
import { createHonoApp } from './hono-adapter.js';
import { makeProvideTxData } from './tx.js';

export { createHonoApp } from './hono-adapter.js';
export { makeProvideTxData } from './tx.js';

export interface CreateServiceOptions {
  /** Service identity (the coordinator). */
  identity: Identity;
  /** Cohort configuration the runner advertises on `run()`. */
  config: CohortConfig;
}

export interface StartedService {
  port: number;
  baseUrl: string;
}

export interface Service {
  /** The aggregation runner driving the cohort. Attach event listeners to it. */
  readonly runner: AggregationServiceRunner;
  /** The underlying sans-I/O HTTP server transport. */
  readonly transport: HttpServerTransport;
  /** Start listening. Pass port 0 (default) for an ephemeral port. */
  start(port?: number, host?: string): Promise<StartedService>;
  /** Stop the runner, transport, and HTTP server. */
  stop(): Promise<void>;
}

/**
 * Create an aggregation service: an {@link HttpServerTransport} mounted under Hono
 * on a real port, driven by an {@link AggregationServiceRunner} configured with the
 * fixture beacon-tx callback. did:btcr2 KEY senders are authenticated by resolving
 * their DID to a public key (`resolveBtcr2SenderPk`); SSE heartbeats are disabled
 * so the process exits cleanly once a cohort completes.
 */
export function createService(opts: CreateServiceOptions): Service {
  const { did, keys } = opts.identity;

  const transport = new HttpServerTransport({
    resolveSenderPk: resolveBtcr2SenderPk,
    heartbeatIntervalMs: 0,
  });
  transport.registerActor(did, keys);

  // `onProvideTxData` reads `runner` lazily (only when signing starts, long after
  // construction), so closing over the const binding here is safe.
  const runner: AggregationServiceRunner = new AggregationServiceRunner({
    transport,
    did,
    keys,
    config: opts.config,
    onProvideTxData: makeProvideTxData(() => runner),
  });

  const app = createHonoApp(transport);
  let server: ServerType | undefined;

  return {
    runner,
    transport,
    start(port = 0, host = '127.0.0.1'): Promise<StartedService> {
      transport.start();
      return new Promise<StartedService>((resolve, reject) => {
        try {
          server = serve({ fetch: app.fetch, port, hostname: host }, (info: AddressInfo) => {
            resolve({ port: info.port, baseUrl: `http://${host}:${info.port}` });
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    stop(): Promise<void> {
      runner.stop();
      transport.stop();
      return new Promise<void>((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}
