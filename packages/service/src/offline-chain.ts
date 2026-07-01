import type { BitcoinConnection } from '@did-btcr2/bitcoin';

/**
 * An offline, no-I/O {@link BitcoinConnection} for the hermetic default path. It
 * implements only the REST surface the app actually touches and answers every
 * query as if the chain were empty:
 *
 *   - `rest.block.count()`      -> 0                (no chain height)
 *   - `rest.address.getTxs()`   -> []               (every address: zero signals)
 *   - `rest.address.getUtxos()` -> []               (no spendable funds)
 *   - `rest.transaction.send()` -> throws           (cannot broadcast offline)
 *   - `rest.transaction.isConfirmed()` -> false
 *
 * With this connection wired in, `GET /resolve/:did` still works - it just always
 * resolves a KEY DID to its deterministic genesis document (no beacon signals to
 * discover), which is the honest result for a controller who has not yet published
 * a singleton-beacon registration. The tx proxy routes return "no funds" and refuse
 * to broadcast, so the browser's first-update registration step is correctly a
 * live-only action. Because it makes ZERO network calls, the 10/10 hermetic gate
 * stays chain-free; an operator flips to a real esplora connection with `LIVE=1`.
 *
 * Faithful to the `BeaconSignalDiscovery.indexer` surface (`rest.block.count` +
 * `rest.address.getTxs`), the same surface the resolve e2e's `mockResolveChain`
 * emulates, so resolution behaves identically to a real connection over an empty
 * chain.
 */
export function createOfflineBitcoinConnection(): BitcoinConnection {
  const offline = {
    rest: {
      block: {
        count: async (): Promise<number> => 0,
      },
      address: {
        // Every in-document beacon address reports no on-chain signals and no
        // spendable UTXOs: an offline chain has nothing to serve.
        getTxs: async (): Promise<unknown[]> => [],
        getUtxos: async (): Promise<unknown[]> => [],
      },
      transaction: {
        send: async (): Promise<string> => {
          throw new Error(
            'offline Bitcoin connection: cannot broadcast (run with LIVE=1 and a real esplora host)',
          );
        },
        isConfirmed: async (): Promise<boolean> => false,
      },
    },
  };
  return offline as unknown as BitcoinConnection;
}
