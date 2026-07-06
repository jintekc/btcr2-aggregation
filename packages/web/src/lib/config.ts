/**
 * Browser client for the coordinator's runtime network config (`GET /v1/config`).
 *
 * The browser derives its Bitcoin addresses and DIDs from the coordinator's network
 * rather than a build-time constant: it fetches this once on load and rebuilds the
 * full {@link NetworkConfig} locally via `resolveNetwork(dto.network)`. A plain fetch
 * of a JSON DTO, so it adds no dependency and stays bundle-clean.
 */

import type { NetworkConfigDTO } from '@btcr2-aggregation/shared';

/**
 * Fetch the coordinator's runtime network DTO from the same-origin `GET /v1/config`.
 *
 * Bounded by a timeout: a coordinator that accepts the connection but never sends a
 * response (blocked event loop, silent proxy) would otherwise hang this promise with no
 * default browser timeout, leaving the caller stuck. On timeout the AbortError rejects,
 * so `loadConfig` degrades to the default network - honoring its graceful-degradation
 * contract for a stall, not just an error response.
 */
export async function fetchNetworkConfig(baseUrl: string): Promise<NetworkConfigDTO> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/config`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/config failed: HTTP ${res.status}`);
  }
  return (await res.json()) as NetworkConfigDTO;
}
