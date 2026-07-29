/**
 * Browser client for the coordinator's same-origin Bitcoin tx proxy
 * (`GET /v1/tx/utxos/:address`, `POST /v1/tx/broadcast`). The controller signs the
 * registration transaction locally (their key never leaves the browser); this
 * client only reads UTXOs and relays the raw signed tx, so the browser stays
 * same-origin and does not depend on an esplora host's CORS.
 *
 * A participant who does not want to take the operator's word for what the chain says
 * can supply their OWN esplora endpoint (PART-05, D-20). That is a {@link ChainEndpoint}
 * PARAMETER on these same two functions, never a second client: the ADR 0010 real-funds
 * acknowledgment, the re-entrancy guard and the funding check all live at the top of the
 * single `register()` path in the participant store, and a parallel path is exactly how
 * such a gate gets bypassed (05-RESEARCH Pitfall 8). With no endpoint supplied, every
 * URL, header, body and error here is byte-identical to the shipped proxy behavior.
 */

/** A spendable UTXO at an address (esplora `AddressUtxo` subset). */
export interface Utxo {
  txid: string;
  vout: number;
  /** Amount in satoshis. */
  value: number;
  status?: { confirmed: boolean; block_height?: number };
}

/**
 * A participant's own chain-truth source (PART-05, D-20). Absent or `esploraBase`-less
 * means the shipped same-origin proxy, which is the zero-config default and stays it.
 */
export interface ChainEndpoint {
  /**
   * Esplora REST base URL, already validated and trailing-slash-stripped by
   * `normalizeEndpoint` and already accepted by the chain guard in `lib/esplora.ts`.
   * Unset = read the chain through this service, exactly as shipped.
   */
  esploraBase?: string;
  /**
   * The opt-in WITHIN the opt-in: send the signed registration transaction to
   * {@link esploraBase} instead of relaying it through the service. Off by default,
   * because a mis-set endpoint must not be able to silently swallow a real transaction.
   */
  broadcastDirect?: boolean;
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

/** Drop a trailing slash so a pasted base never produces a doubled path separator. */
function trimBase(base: string): string {
  return base.replace(/\/$/, '');
}

/** Fetch the spendable UTXOs at `address` via the coordinator proxy, or via `endpoint`. */
export async function fetchUtxos(
  baseUrl: string,
  address: string,
  endpoint?: ChainEndpoint,
): Promise<Utxo[]> {
  // The ONLY difference between the two modes is which URL is built; esplora's
  // `AddressUtxo[]` IS the JSON the proxy forwards verbatim, so the response handling
  // and the error handling below are shared rather than duplicated.
  const url = endpoint?.esploraBase
    ? `${trimBase(endpoint.esploraBase)}/address/${encodeURIComponent(address)}/utxo`
    : `${trimBase(baseUrl)}/v1/tx/utxos/${encodeURIComponent(address)}`;
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

/**
 * Broadcast a raw signed transaction via the coordinator proxy; returns the txid.
 *
 * Routed to `endpoint.esploraBase` only when BOTH an endpoint is set and
 * {@link ChainEndpoint.broadcastDirect} is on. The direct path carries the one real
 * asymmetry between the two: the proxy answers `{ txid }` as JSON while esplora answers
 * the txid as bare text, so this path reads the body as text and trims it.
 */
export async function broadcastTx(
  baseUrl: string,
  rawHex: string,
  endpoint?: ChainEndpoint,
): Promise<string> {
  const direct = Boolean(endpoint?.esploraBase && endpoint.broadcastDirect);
  const url = direct
    ? `${trimBase(endpoint!.esploraBase!)}/tx`
    : `${trimBase(baseUrl)}/v1/tx/broadcast`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: direct ? { 'content-type': 'text/plain' } : { 'content-type': 'application/json' },
      body: direct ? rawHex : JSON.stringify({ rawHex }),
    });
  } catch (err) {
    throw new TxProxyError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) {
    throw new TxProxyError(await errorDetail(res), res.status);
  }
  if (direct) {
    const txid = (await res.text()).trim();
    if (!txid) {
      throw new TxProxyError('broadcast response missing txid', res.status);
    }
    return txid;
  }
  const body = (await res.json()) as { txid?: string };
  if (!body?.txid) {
    throw new TxProxyError('broadcast response missing txid', res.status);
  }
  return body.txid;
}
