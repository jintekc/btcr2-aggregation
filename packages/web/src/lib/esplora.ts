/**
 * The participant-side chain endpoint guard (PART-05, D-20, UI-SPEC E16).
 *
 * A participant may point their browser's chain reads at an esplora endpoint they chose
 * instead of reading the chain through the service they joined. Two things have to be
 * true before that is safe, and this module owns both.
 *
 * FIRST, the endpoint must be on the RIGHT CHAIN. An endpoint on another chain would not
 * fail; it would answer, confidently and wrongly, about UTXOs and confirmations
 * (T-05-11-03). So the chain is probed BEFORE any UTXO read, and the comparison is made
 * against `packages/shared/src/networks.ts`, the declared single source of truth for
 * chain parameters. No chain hash literal lives in this package.
 *
 * SECOND, a failure must say WHICH failure. A browser cannot distinguish a cross-origin
 * rejection from a DNS failure by inspecting the error: both surface as an opaque
 * `TypeError` from `fetch`. Message-parsing that would be guesswork dressed as fact, so
 * the classification comes from ORDER instead:
 *
 *   1. parse and scheme-check    -> `malformed`, and NO request is made
 *   2. probe the chain markers   -> a thrown fetch is `browser-rejected`;
 *                                   an answer that cannot be read is `unreachable`
 *   3. compare against our chain -> `mismatch`, naming both chains
 *
 * Step 2's split is best-effort by construction (that is why `unreachable` is the
 * documented fallback), but it is honest: after a successful URL parse, a throw is far
 * more often a browser refusing the cross-origin request than a hostname that vanished,
 * and the copy for it offers the explicit switch back rather than acting on its own.
 *
 * Nothing here ever falls back to the service's chain reads. The participant chose a
 * trust source; silently overriding that choice would defeat the entire feature.
 */

import { NETWORKS, chainFingerprint, type NetworkName } from '@btcr2-aggregation/shared';
import { TxProxyError } from './tx-client';

/** Same-origin/third-party read budget, matching the anchor and config clients. */
const TIMEOUT_MS = 8000;

/**
 * How a foreign chain is named when its markers match no network in the registry. The
 * honest answer: we know it is not ours, and we do not know what it is.
 */
export const UNRECOGNIZED_CHAIN = 'an unrecognized chain';

/**
 * What a chain probe observed. `rejected` and `unreachable` are deliberately separate
 * members rather than one failure: they produce different copy because they call for
 * different action from the participant (pick another endpoint vs. check the host).
 */
export type ChainProbe =
  | { status: 'hashes'; genesis: string; distinguishing?: string }
  | { status: 'rejected' }
  | { status: 'unreachable' };

/** The verdict on a participant-supplied endpoint. One member per UI-SPEC E16 message. */
export type EndpointVerdict =
  | { kind: 'ok'; base: string }
  | { kind: 'mismatch'; theirNetwork: string; ourNetwork: string }
  | { kind: 'browser-rejected' }
  | { kind: 'unreachable' }
  | { kind: 'malformed' };

/**
 * Validate a pasted endpoint and return its canonical base, or `null` when it is not a
 * full https URL.
 *
 * https ONLY, and refused before any request is made: a plain-http endpoint would be
 * blocked as mixed content on any https deployment anyway, and any other scheme (file,
 * ftp, javascript) has no business being handed to `fetch` at all.
 */
export function normalizeEndpoint(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') {
    return null;
  }
  return trimmed.replace(/\/$/, '');
}

/**
 * Read the block hash at `height` from an esplora endpoint (`GET /block-height/:h`).
 *
 * Throws a {@link TxProxyError} using the SHIPPED status-zero convention from
 * `tx-client.ts` (0 = the fetch itself threw), rather than inventing a second error type
 * for the same distinction the tx client already encodes.
 */
export async function probeChain(esploraBase: string, height = 0): Promise<string> {
  const url = `${esploraBase.replace(/\/$/, '')}/block-height/${height}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'text/plain' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new TxProxyError(err instanceof Error ? err.message : String(err), 0);
  }
  if (!res.ok) {
    throw new TxProxyError(`HTTP ${res.status}`, res.status);
  }
  return (await res.text()).trim();
}

/** True for a well-formed 64-character lowercase block hash. */
function isBlockHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Name the chain an observation belongs to, or `null` when no registered network matches.
 *
 * A network whose block zero is ambiguous (the signet family) matches only when the
 * second marker was observed AND agrees, so an unfinished observation is never resolved
 * into a confident name.
 */
export function identifyChain(observed: {
  genesis: string;
  distinguishing?: string;
}): NetworkName | null {
  const names = Object.keys(NETWORKS) as NetworkName[];
  const candidates = names.filter((name) => NETWORKS[name].genesisHash === observed.genesis);
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length === 1 && !NETWORKS[candidates[0]].distinguishingBlock) {
    return candidates[0];
  }
  return (
    candidates.find(
      (name) =>
        observed.distinguishing !== undefined &&
        NETWORKS[name].distinguishingBlock?.hash === observed.distinguishing,
    ) ?? null
  );
}

/**
 * The pure verdict over one already-collected observation (the async orchestration lives
 * in {@link checkEndpoint}). Keeping the decision pure is what makes all five outcomes
 * assertable without a network, which is the only way the four failure modes stay four.
 *
 * `probe: null` means the probe never ran. That is legal only alongside a malformed
 * input; anywhere else it means the caller could not complete the check, and the honest
 * verdict for "could not verify" is a refusal, never a pass.
 */
export function classifyEndpoint(input: {
  raw: string;
  ourNetwork: NetworkName;
  probe: ChainProbe | null;
}): EndpointVerdict {
  const base = normalizeEndpoint(input.raw);
  if (base === null) {
    return { kind: 'malformed' };
  }
  if (input.probe === null) {
    return { kind: 'unreachable' };
  }
  if (input.probe.status === 'rejected') {
    return { kind: 'browser-rejected' };
  }
  if (input.probe.status === 'unreachable') {
    return { kind: 'unreachable' };
  }
  const ours = NETWORKS[input.ourNetwork];
  const observed = { genesis: input.probe.genesis, distinguishing: input.probe.distinguishing };
  // A required second marker that was not observed leaves the chain UNVERIFIED. Refusing
  // is the A3 mitigation: an endpoint we cannot check is not an endpoint we may trust.
  if (ours.distinguishingBlock && observed.distinguishing === undefined) {
    return { kind: 'unreachable' };
  }
  const theirName = identifyChain(observed);
  const theirPrint = theirName ? chainFingerprint(NETWORKS[theirName]) : null;
  if (theirPrint !== null && theirPrint === chainFingerprint(ours)) {
    return { kind: 'ok', base };
  }
  return {
    kind: 'mismatch',
    theirNetwork: theirName ? NETWORKS[theirName].label : UNRECOGNIZED_CHAIN,
    ourNetwork: ours.label,
  };
}

/**
 * Cached verdicts, keyed by endpoint AND our chain (the same host is a different question
 * on a different chain). The cache exists so a dead or refusing endpoint is probed once
 * rather than on every chain read (T-05-11-04).
 */
const verdictCache = new Map<string, EndpointVerdict>();

/** Drop every cached verdict. Used by tests and by an explicit re-check. */
export function clearEndpointCache(): void {
  verdictCache.clear();
}

/** Run one marker probe, mapping every failure onto a {@link ChainProbe} member. */
async function probeMarker(
  base: string,
  height: number,
): Promise<{ hash: string } | { fail: ChainProbe }> {
  try {
    const hash = await probeChain(base, height);
    // An endpoint that answers 200 with something that is not a block hash (an HTML
    // error page, a login wall) cannot be read, and is not evidence of a foreign chain.
    return isBlockHash(hash) ? { hash } : { fail: { status: 'unreachable' } };
  } catch (err) {
    // The status-zero convention: 0 means `fetch` threw, which after a successful URL
    // parse is most often a browser refusing the cross-origin request.
    const threw = err instanceof TxProxyError && err.status === 0;
    return { fail: { status: threw ? 'rejected' : 'unreachable' } };
  }
}

/**
 * Decide whether a participant-supplied endpoint may be used for `ourNetwork`.
 *
 * Order is the whole design: parse (no request on a malformed input), then probe block
 * zero, then, only where block zero is ambiguous, probe the second marker, then compare.
 */
export async function checkEndpoint(
  raw: string,
  ourNetwork: NetworkName,
): Promise<EndpointVerdict> {
  const base = normalizeEndpoint(raw);
  if (base === null) {
    return { kind: 'malformed' };
  }
  const key = `${base}|${ourNetwork}`;
  const cached = verdictCache.get(key);
  if (cached) {
    return cached;
  }
  const genesis = await probeMarker(base, 0);
  let probe: ChainProbe;
  if ('fail' in genesis) {
    probe = genesis.fail;
  } else {
    const marker = NETWORKS[ourNetwork].distinguishingBlock;
    // The second request happens ONLY for a signet-family chain and ONLY once block zero
    // already agrees; everywhere else the common probe stays a single request.
    if (marker && genesis.hash === NETWORKS[ourNetwork].genesisHash) {
      const second = await probeMarker(base, marker.height);
      probe =
        'fail' in second
          ? second.fail
          : { status: 'hashes', genesis: genesis.hash, distinguishing: second.hash };
    } else {
      probe = { status: 'hashes', genesis: genesis.hash };
    }
  }
  const verdict = classifyEndpoint({ raw, ourNetwork, probe });
  verdictCache.set(key, verdict);
  return verdict;
}

/**
 * Independently confirm a KNOWN transaction id at the participant's endpoint.
 *
 * This is an ADDITIONAL check, never a replacement for the service's anchor read: that
 * read is keyed by COHORT id and an esplora endpoint has no notion of a cohort
 * (05-RESEARCH Pattern 7). Never throws: an unknown transaction, an unconfirmed one and
 * an unreadable answer are all simply "not confirmed here", because a second opinion that
 * could break the page would be worse than no second opinion.
 */
export async function confirmTxAt(esploraBase: string, txid: string): Promise<boolean> {
  try {
    const url = `${esploraBase.replace(/\/$/, '')}/tx/${encodeURIComponent(txid)}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { status?: { confirmed?: boolean } };
    return body?.status?.confirmed === true;
  } catch {
    return false;
  }
}
