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
 * The runtime config DTO the browser reads from `GET /v1/config`: the network fields plus an
 * OPTIONAL operator-supplied `serviceName` (D-51), present only when the operator set
 * `SERVICE_NAME` at boot. Widens {@link NetworkConfigDTO} additively so a service without a
 * name returns the byte-identical network DTO and the field is simply absent.
 */
export interface RuntimeConfigDTO extends NetworkConfigDTO {
  /** Operator-supplied service display name; absent when `SERVICE_NAME` is unset. */
  serviceName?: string;
  /**
   * This service's own did:btcr2 identifier (SVC-05, D-19). Present on any service that knows
   * its own DID; needed here because the acceptance record a participant signs names the service
   * it is addressed to, and that record is built BEFORE the participant joins anything (so the
   * advert, which also carries this DID, has not been seen yet).
   */
  serviceDid?: string;
  /**
   * The operator's participation terms (SVC-05, D-19). ABSENT means this operator set no terms
   * and the join flow has NO terms step at all - which is a different fact from terms that say
   * nothing, so the key is absent rather than an empty string. Rendered as plain, auto-escaped
   * React text content, never markup and never a link target.
   */
  termsText?: string;
}

/** The envelope `POST /v1/terms/acceptance` accepts: the record, its signature, and (x1 only) the genesis. */
export interface TermsAcceptanceEnvelope {
  acceptance: Record<string, unknown>;
  /** 64-byte BIP340 schnorr signature over the record's canonical signing bytes, hex. */
  signature: string;
  /**
   * An EXTERNAL (x1) participant's self-verifying genesis document, carried in-band exactly as
   * it is on a cohort opt-in (ADR 066): an x1 DID is a hash commitment to this document, so the
   * service cannot resolve the signing key from the DID string alone. Omitted for a KEY (k1)
   * participant, whose DID decodes to its key directly.
   */
  genesisDocument?: Record<string, unknown>;
}

/**
 * POST a signed participation-terms acceptance and return the service's hash reference for it.
 *
 * Only the record and its signature travel: the participant's private key never leaves this
 * browser. Throws on any non-OK response, which the store turns into the single documented
 * failure sentence - the service deliberately answers every refusal with one identical body, so
 * there is no per-reason message to relay and no point in trying to invent one.
 */
export async function postTermsAcceptance(
  baseUrl: string,
  envelope: TermsAcceptanceEnvelope,
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/terms/acceptance`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`POST /v1/terms/acceptance failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { hash?: unknown };
  if (typeof body.hash !== 'string' || !/^[0-9a-f]{64}$/.test(body.hash)) {
    throw new Error('POST /v1/terms/acceptance returned no usable hash reference');
  }
  return body.hash;
}

/**
 * Fetch the coordinator's runtime config DTO from the same-origin `GET /v1/config`.
 *
 * Bounded by a timeout: a coordinator that accepts the connection but never sends a
 * response (blocked event loop, silent proxy) would otherwise hang this promise with no
 * default browser timeout, leaving the caller stuck. On timeout the AbortError rejects,
 * so `loadConfig` degrades to the default network - honoring its graceful-degradation
 * contract for a stall, not just an error response.
 */
export async function fetchNetworkConfig(baseUrl: string): Promise<RuntimeConfigDTO> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/config`;
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/config failed: HTTP ${res.status}`);
  }
  return (await res.json()) as RuntimeConfigDTO;
}
