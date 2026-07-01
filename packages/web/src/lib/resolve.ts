/**
 * Browser client for the server-driven resolve route `GET /resolve/:did`.
 *
 * Resolution runs on the coordinator, never in the browser: `@did-btcr2/method`'s
 * resolver drags `@web5/dids -> level/classic-level` (native) into a bundle, which
 * is the whole reason this is a server round-trip (ADR 0007). The browser does one
 * fetch and renders the reconstructed document.
 */

/** A verification method entry of a resolved DID document. */
export interface ResolvedVerificationMethod {
  id: string;
  type: string;
  controller?: string;
  publicKeyMultibase?: string;
}

/** A service entry of a resolved DID document (beacons included). */
export interface ResolvedService {
  id: string;
  type: string;
  serviceEndpoint: string | string[];
}

/** The reconstructed DID document (the fields the UI renders; others pass through). */
export interface ResolvedDidDocument {
  id: string;
  '@context'?: unknown;
  verificationMethod?: ResolvedVerificationMethod[];
  service?: ResolvedService[];
  [key: string]: unknown;
}

/** DID document metadata as returned on the wire (resolver `.metadata`, renamed by the route). */
export interface DidDocumentMetadata {
  versionId: string;
  confirmations?: number;
  updated?: string;
  deactivated?: boolean;
}

/** The `GET /resolve/:did` success body. */
export interface ResolveResponse {
  didDocument: ResolvedDidDocument;
  didDocumentMetadata: DidDocumentMetadata;
}

/** Thrown when resolution fails; `status` is the HTTP status (400 bad DID, 502 upstream, 404 route absent). */
export class ResolveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ResolveError';
  }
}

/**
 * Resolve `did` via the coordinator at `baseUrl`. Returns the reconstructed
 * document and metadata, or throws {@link ResolveError} with the HTTP status:
 *   - 400: malformed did:btcr2 identifier
 *   - 404: the coordinator has resolution disabled (no store/connection configured)
 *   - 502: resolution failed upstream (missing artifact, esplora error, bad DID)
 */
export async function resolveDid(baseUrl: string, did: string): Promise<ResolveResponse> {
  // Encode the DID as a single path segment (its colons become %3A; Hono decodes
  // the param back before its did:btcr2 guard runs).
  const url = `${baseUrl.replace(/\/$/, '')}/resolve/${encodeURIComponent(did)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (err) {
    throw new ResolveError(
      `could not reach the resolver: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        detail = body.error;
      }
    } catch {
      // non-JSON error body (e.g. a 404 SPA fallback); keep the status line
    }
    throw new ResolveError(detail, res.status);
  }
  return (await res.json()) as ResolveResponse;
}

/**
 * Find the appended aggregate beacon service in a resolved document, if present.
 * Mirrors what `buildSignedUpdate` writes: a `CASBeacon` at `${did}#beacon-cas` or
 * an `SMTBeacon` at `${did}#beacon-smt`. Present iff the controller's first update
 * has been discovered and applied (i.e. registered via a genesis beacon or an
 * EXTERNAL genesis); absent for a bare genesis document.
 */
export function findAppendedBeacon(
  doc: ResolvedDidDocument,
  did: string,
): ResolvedService | undefined {
  return (doc.service ?? []).find(
    (s) =>
      (s.type === 'CASBeacon' && s.id === `${did}#beacon-cas`) ||
      (s.type === 'SMTBeacon' && s.id === `${did}#beacon-smt`),
  );
}

/** The `bitcoin:<addr>` endpoint of a service as a plain string (handles the array form). */
export function serviceEndpointString(service: ResolvedService): string {
  return Array.isArray(service.serviceEndpoint)
    ? (service.serviceEndpoint[0] ?? '')
    : service.serviceEndpoint;
}
