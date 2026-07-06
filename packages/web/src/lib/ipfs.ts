/**
 * Light browser client for the coordinator's IPFS publish surface (ADR 0011):
 * the `GET /v1/ipfs` availability probe and the `POST /v1/ipfs/pin` request.
 * Plain fetches of JSON DTOs - NO helia/libp2p imports here, so this module is
 * safe to import eagerly. The heavy in-browser node lives in `ipfs-node.ts`,
 * loaded only on demand via dynamic import (its own chunk, never in the eager
 * bundle).
 */

/** `GET /v1/ipfs` wire shape. */
export interface IpfsInfoDTO {
  enabled: boolean;
  /** The coordinator node's peer id (present when enabled). */
  peerId?: string;
  /** Multiaddrs the browser node can dial (present when enabled). */
  multiaddrs?: string[];
}

/** One entry of the `POST /v1/ipfs/pin` response. */
export interface PinResultDTO {
  hash: string;
  cid: string;
  pinned: boolean;
  /** 'store' | 'network' | 'local' | 'already-pinned' (see the service PinSource). */
  source?: string;
  error?: string;
}

/**
 * Probe the coordinator's IPFS availability. Bounded like `fetchNetworkConfig`:
 * a wedged coordinator must not hang the caller. Throws on a non-OK response;
 * the store degrades that to "unavailable".
 */
export async function fetchIpfsInfo(baseUrl: string): Promise<IpfsInfoDTO> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/ipfs`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/ipfs failed: HTTP ${res.status}`);
  }
  return (await res.json()) as IpfsInfoDTO;
}

/**
 * Ask the coordinator to pin the given digests (it fetches any block it does not
 * already hold over bitswap from this browser's node, so the node must be dialed
 * in and holding the blocks BEFORE this call). Generous timeout: each pin may
 * include a bounded bitswap fetch.
 */
export async function requestPin(baseUrl: string, hashes: string[]): Promise<PinResultDTO[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/ipfs/pin`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ hashes }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) {
        detail = body.error;
      }
    } catch {
      // keep the status-only detail
    }
    throw new Error(`pin request failed: ${detail}`);
  }
  const { results } = (await res.json()) as { results: PinResultDTO[] };
  return results;
}
