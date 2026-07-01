/**
 * Browser client for the coordinator's same-origin Bitcoin tx proxy
 * (`GET /v1/tx/utxos/:address`, `POST /v1/tx/broadcast`). The controller signs the
 * registration transaction locally (their key never leaves the browser); this
 * client only reads UTXOs and relays the raw signed tx, so the browser stays
 * same-origin and does not depend on an esplora host's CORS.
 */

/** A spendable UTXO at an address (esplora `AddressUtxo` subset). */
export interface Utxo {
  txid: string;
  vout: number;
  /** Amount in satoshis. */
  value: number;
  status?: { confirmed: boolean; block_height?: number };
}

/** Thrown on a proxy error; `status` is the HTTP status (0 = unreachable). */
export class TxProxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TxProxyError';
  }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Fetch the spendable UTXOs at `address` via the coordinator proxy. */
export async function fetchUtxos(baseUrl: string, address: string): Promise<Utxo[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/tx/utxos/${encodeURIComponent(address)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (err) {
    throw new TxProxyError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) {
    throw new TxProxyError(await errorDetail(res), res.status);
  }
  return (await res.json()) as Utxo[];
}

/** Broadcast a raw signed transaction via the coordinator proxy; returns the txid. */
export async function broadcastTx(baseUrl: string, rawHex: string): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/tx/broadcast`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawHex }),
    });
  } catch (err) {
    throw new TxProxyError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) {
    throw new TxProxyError(await errorDetail(res), res.status);
  }
  const body = (await res.json()) as { txid?: string };
  if (!body?.txid) {
    throw new TxProxyError('broadcast response missing txid', res.status);
  }
  return body.txid;
}
