/**
 * The controller's downloadable, sovereign resolution sidecar. It carries exactly
 * the off-chain artifacts a did:btcr2 resolver needs to reconstruct this update:
 * the signed update body plus the beacon-specific artifact (the CAS announcement
 * map for a CAS cohort, or this DID's SMT inclusion proof for an SMT cohort). The
 * shape matches the resolver's `Sidecar` (the array form it post-processes into
 * hex-keyed maps) and the service's `exportSidecar`, so the same JSON can be handed
 * to `DidBtcr2.resolve(did, { sidecar })` or published to any aggregator.
 */
export interface Sidecar {
  '@context': string;
  /** Signed update bodies (the `NeedSignedUpdate` artifacts). */
  updates?: object[];
  /** CAS announcement maps (CAS beacons). */
  casUpdates?: object[];
  /** SMT inclusion proofs (SMT beacons). */
  smtProofs?: object[];
}

const SIDECAR_CONTEXT = 'https://btcr2.dev/context/v1';

/**
 * Build a resolver-ready sidecar from the controller's own captured artifacts. The
 * `update` body is always included; exactly one of `casAnnouncement` / `smtProof`
 * is present, matching the cohort's beacon type. Omits empty arrays.
 */
export function buildSidecar(input: {
  update: object;
  casAnnouncement?: Record<string, string>;
  smtProof?: object;
}): Sidecar {
  const sidecar: Sidecar = { '@context': SIDECAR_CONTEXT, updates: [input.update] };
  if (input.casAnnouncement) {
    sidecar.casUpdates = [input.casAnnouncement];
  }
  if (input.smtProof) {
    sidecar.smtProofs = [input.smtProof];
  }
  return sidecar;
}

/**
 * Trigger a browser download of `data` as pretty-printed JSON named `filename`.
 * Uses an object URL + a transient anchor; revokes the URL after the click so the
 * blob is not retained. No-op-safe if the DOM is unavailable.
 */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Revoke on the next tick so the download has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** A filesystem-safe filename fragment for a DID (its bech32m suffix). */
export function didSlug(did: string): string {
  const suffix = did.split(':').pop() ?? did;
  return suffix.slice(0, 24);
}
