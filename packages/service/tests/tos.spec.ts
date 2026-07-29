import { HttpServerTransport } from '@did-btcr2/aggregation/service';
import { resolveBtcr2SenderPk } from '@did-btcr2/method';
import {
  BTCR2_CONTEXT,
  buildTermsAcceptance,
  createExternalIdentity,
  createIdentity,
  resolveNetwork,
  termsAcceptanceHashHex,
  termsAcceptanceSigningBytes,
  termsHashHex,
  type Identity,
  type TermsAcceptance,
} from '@btcr2-aggregation/shared';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, it, vi } from 'vitest';
import { createHonoApp } from '../src/hono-adapter.js';
import { createRuntimeSettings } from '../src/runtime-settings.js';
import { MemoryArtifactStore, exportSidecar } from '../src/store.js';

/**
 * The PUBLIC participation-terms acceptance route `POST /v1/terms/acceptance` (SVC-05, D-19).
 *
 * An acceptance is only worth storing if the service has PROVED, cryptographically, that the
 * participant signed the terms it actually shows. Four properties carry that claim, and each is
 * asserted here rather than described:
 *
 * 1. **Server-side signature verification** (T-05-13-01). The signature is checked against the
 *    key resolved from the CLAIMED DID, using the same `resolveBtcr2SenderPk` machinery the
 *    transport already uses for envelope authentication. A record signed by any other key is
 *    refused and NOTHING is stored, which is the part that matters: an unverified blob sitting
 *    in the store would look exactly like a proof to anyone reading it later.
 * 2. **Hash binding** (T-05-13-02). The record names the hash of the terms it was signed
 *    against. Editing the terms afterwards leaves an already stored acceptance byte-unchanged,
 *    so an operator cannot retroactively rewrite what a participant agreed to.
 * 3. **Nothing is stored before every check passes** (T-05-13-04). The route is anonymous, so
 *    every refusal path is also a store-growth path if it stores first and checks later. Each
 *    refusal row below asserts the store is still EMPTY, not merely that the response was a 400.
 * 4. **The route is not an existence oracle** (T-05-13-06). Every refusal returns the byte-same
 *    caller-facing body, so the route cannot be used to probe which DIDs or cohorts this service
 *    has seen. Asserted by deep equality ACROSS the refusal reasons, never one at a time: six
 *    separate `toEqual({ error: ... })` rows would still pass if one of them started answering
 *    404 or carrying a reason.
 *
 * Hermetic: `createHonoApp(...).request`, an in-memory store, no port, no chain.
 */

const ACTIVE_NETWORK = 'signet';
const TERMS = 'Be excellent to each other. Party on.';
const COHORT_ID = 'cohort-abc-123';

/**
 * An app wired exactly as `createService` wires this route: the transport's OWN sender-key
 * resolver, the runtime settings holder that owns the terms text, an artifact store, and this
 * service's DID.
 */
function acceptanceApp(opts: { terms?: string; store?: MemoryArtifactStore } = {}) {
  const service = createIdentity(resolveNetwork(ACTIVE_NETWORK));
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  const store = opts.store ?? new MemoryArtifactStore();
  const runtimeSettings = createRuntimeSettings({ termsText: opts.terms });
  const app = createHonoApp(transport, {
    networkName: ACTIVE_NETWORK,
    serviceDid: service.did,
    resolveSenderPk: resolveBtcr2SenderPk,
    runtimeSettings,
    store,
  });
  return { app, store, runtimeSettings, serviceDid: service.did };
}

/** Build the acceptance a participant's browser would build for these terms. */
function acceptanceFor(
  serviceDid: string,
  participant: Identity,
  terms = TERMS,
  cohortId = COHORT_ID,
): TermsAcceptance {
  return buildTermsAcceptance({
    serviceDid,
    cohortId,
    termsHash: termsHashHex(terms),
    participantDid: participant.did,
    acceptedAt: '2026-07-29T12:00:00.000Z',
  });
}

/** Sign the acceptance's canonical signing bytes with `keys` (any keypair, not necessarily the DID's). */
function signWith(acceptance: TermsAcceptance, identity: Identity): string {
  return bytesToHex(
    identity.keys.secretKey.sign(termsAcceptanceSigningBytes(acceptance), { scheme: 'schnorr' }),
  );
}

/** POST an acceptance envelope with NO session cookie: the whole point is that a stranger can. */
async function post(
  app: ReturnType<typeof acceptanceApp>['app'],
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await app.request('/v1/terms/acceptance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/** Every acceptance currently in the store, as `[hashHex, value]` pairs. */
function stored(store: MemoryArtifactStore): Promise<Array<[string, unknown]>> {
  return store.entries('acceptance');
}

describe('POST /v1/terms/acceptance stores only a VERIFIED acceptance', () => {
  it('accepts, stores, and returns the hash reference for a correctly signed record', async () => {
    const { app, store, serviceDid } = acceptanceApp({ terms: TERMS });
    const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
    const acceptance = acceptanceFor(serviceDid, participant);

    const res = await post(app, { acceptance, signature: signWith(acceptance, participant) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hash: termsAcceptanceHashHex(acceptance) });
    expect(await stored(store)).toEqual([[termsAcceptanceHashHex(acceptance), acceptance]]);
  });

  it('accepts an EXTERNAL (x1) participant that carries its self-verifying genesis in-band', async () => {
    // An x1 DID is a commitment to a genesis document, so its key cannot be decoded from the DID
    // string alone. The transport already solves this for opt-ins by carrying the genesis in-band
    // (ADR 066) and the resolver recomputes its hash against the DID, so a forged document
    // cannot be substituted. Without this the terms step would be silently unusable for every
    // EXTERNAL participant.
    const { app, store, serviceDid } = acceptanceApp({ terms: TERMS });
    const participant = createExternalIdentity(resolveNetwork(ACTIVE_NETWORK));
    const acceptance = acceptanceFor(serviceDid, participant);

    const res = await post(app, {
      acceptance,
      signature: signWith(acceptance, participant),
      genesisDocument: participant.genesisDocument,
    });

    expect(res.status).toBe(200);
    expect(await stored(store)).toHaveLength(1);
  });

  it('serves a stored acceptance back through the existing hash-addressed public read', async () => {
    const { app, serviceDid } = acceptanceApp({ terms: TERMS });
    const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
    const acceptance = acceptanceFor(serviceDid, participant);
    await post(app, { acceptance, signature: signWith(acceptance, participant) });

    const read = await app.request(`/cas/acceptance/${termsAcceptanceHashHex(acceptance)}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(acceptance);
  });

  it('appears on NO listing endpoint: only the hash-addressed read serves it', async () => {
    const { app, store, serviceDid } = acceptanceApp({ terms: TERMS });
    const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
    const acceptance = acceptanceFor(serviceDid, participant);
    await post(app, { acceptance, signature: signWith(acceptance, participant) });

    // The one export path over the store carries resolution artifacts only; an acceptance is
    // not a resolution artifact and must not ride along into a controller's sidecar.
    expect(await exportSidecar(store)).toEqual({ '@context': BTCR2_CONTEXT });
    // And the /cas namespace has no directory listing of any shape.
    expect((await app.request('/cas/acceptance')).status).toBe(404);
    expect((await app.request('/cas/acceptance/')).status).toBe(404);
  });
});

describe('POST /v1/terms/acceptance refuses without storing anything', () => {
  /** Each row: a description, and a builder producing the body to POST against a fresh app. */
  async function refusal(
    build: (ctx: {
      app: ReturnType<typeof acceptanceApp>['app'];
      store: MemoryArtifactStore;
      serviceDid: string;
      runtimeSettings: ReturnType<typeof acceptanceApp>['runtimeSettings'];
    }) => unknown | Promise<unknown>,
    terms: string | undefined = TERMS,
  ): Promise<{ status: number; body: unknown; storeSize: number }> {
    const ctx = acceptanceApp({ terms });
    const body = await build(ctx);
    const res = await post(ctx.app, body);
    return { ...res, storeSize: (await stored(ctx.store)).length };
  }

  it('refuses a signature made by a DIFFERENT key and stores nothing', async () => {
    const out = await refusal(({ serviceDid }) => {
      const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
      const attacker = createIdentity(resolveNetwork(ACTIVE_NETWORK));
      const acceptance = acceptanceFor(serviceDid, participant);
      // The record CLAIMS the participant's DID; the signature is the attacker's.
      return { acceptance, signature: signWith(acceptance, attacker) };
    });
    expect(out.status).toBe(400);
    expect(out.storeSize).toBe(0);
  });

  it('refuses a terms hash that does not match this service CURRENT terms', async () => {
    const out = await refusal(({ serviceDid }) => {
      const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
      // Correctly signed, by the right key, over terms this service does not serve.
      const acceptance = acceptanceFor(serviceDid, participant, 'Some other terms entirely.');
      return { acceptance, signature: signWith(acceptance, participant) };
    });
    expect(out.status).toBe(400);
    expect(out.storeSize).toBe(0);
  });

  it('refuses when this service has NO terms set: there is nothing to accept', async () => {
    const out = await refusal(({ serviceDid }) => {
      const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
      const acceptance = acceptanceFor(serviceDid, participant);
      return { acceptance, signature: signWith(acceptance, participant) };
    }, undefined);
    expect(out.status).toBe(400);
    expect(out.storeSize).toBe(0);
  });

  it('refuses an acceptance addressed to a DIFFERENT service', async () => {
    // Otherwise an acceptance collected by service A could be replayed to service B that
    // happens to publish the identical terms text.
    const out = await refusal(() => {
      const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
      const elsewhere = createIdentity(resolveNetwork(ACTIVE_NETWORK));
      const acceptance = acceptanceFor(elsewhere.did, participant);
      return { acceptance, signature: signWith(acceptance, participant) };
    });
    expect(out.status).toBe(400);
    expect(out.storeSize).toBe(0);
  });

  it('refuses a record carrying an EXTRA field, so the frozen shape cannot be widened by a caller', async () => {
    const out = await refusal(({ serviceDid }) => {
      const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
      const acceptance = acceptanceFor(serviceDid, participant);
      const widened = { ...acceptance, note: 'under protest' };
      return { acceptance: widened, signature: signWith(widened as TermsAcceptance, participant) };
    });
    expect(out.status).toBe(400);
    expect(out.storeSize).toBe(0);
  });

  it('refuses an unparseable body with the generic message while logging the real error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { app, store } = acceptanceApp({ terms: TERMS });
      const res = await post(app, '{ this is not json');
      expect(res.status).toBe(400);
      expect((await stored(store)).length).toBe(0);
      expect(spy).toHaveBeenCalled();
      // The real reason stays server-side; the caller learns only that it was refused.
      expect(JSON.stringify(res.body)).not.toMatch(/json|parse|token/i);
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses an OVERSIZED body at the boundary, before it is parsed', async () => {
    const { app, store } = acceptanceApp({ terms: TERMS });
    const res = await app.request('/v1/terms/acceptance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acceptance: 'x'.repeat(64 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect((await stored(store)).length).toBe(0);
  });

  it('answers every refusal with the byte-SAME body, so it is not an existence oracle', async () => {
    const { app, serviceDid } = acceptanceApp({ terms: TERMS });
    const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
    const attacker = createIdentity(resolveNetwork(ACTIVE_NETWORK));
    const good = acceptanceFor(serviceDid, participant);

    const bodies = [
      // wrong key
      { acceptance: good, signature: signWith(good, attacker) },
      // wrong terms
      (() => {
        const a = acceptanceFor(serviceDid, participant, 'Other terms.');
        return { acceptance: a, signature: signWith(a, participant) };
      })(),
      // a DID that decodes to no key at all
      (() => {
        const a = { ...good, participantDid: 'did:btcr2:not-a-real-identifier' };
        return { acceptance: a, signature: signWith(good, participant) };
      })(),
      // a well-formed but unknown cohort id
      (() => {
        const a = acceptanceFor(serviceDid, participant, TERMS, 'cohort-never-existed');
        return { acceptance: a, signature: signWith(a, participant) };
      })(),
      // structurally wrong
      { acceptance: { hello: 'world' }, signature: 'ff'.repeat(64) },
      // missing signature entirely
      { acceptance: good },
    ];

    const results = await Promise.all(bodies.map((b) => post(app, b)));
    // Deep equality ACROSS the reasons, not one assertion per reason: a divergence in status
    // code OR body shape is what turns this route into a probe, and comparing to the first
    // result catches both at once.
    for (const r of results) {
      expect(r).toEqual(results[0]);
    }
    expect(results[0].status).toBe(400);
  });
});

describe('a terms edit never changes what a stored acceptance means (T-05-13-02)', () => {
  it('leaves an already stored acceptance byte-unchanged and still naming the ORIGINAL hash', async () => {
    const { app, store, runtimeSettings, serviceDid } = acceptanceApp({ terms: TERMS });
    const participant = createIdentity(resolveNetwork(ACTIVE_NETWORK));
    const acceptance = acceptanceFor(serviceDid, participant);
    const hash = termsAcceptanceHashHex(acceptance);
    expect((await post(app, { acceptance, signature: signWith(acceptance, participant) })).status).toBe(200);

    // The operator rewrites the terms afterwards.
    expect(runtimeSettings.applySettings({ termsText: 'New terms: all rights reserved.' })).toBeUndefined();

    // The stored record is untouched, and still names the hash of the document that was shown.
    expect(await store.get('acceptance', hash)).toEqual(acceptance);
    expect((await store.get('acceptance', hash)) as TermsAcceptance).toMatchObject({
      termsHash: termsHashHex(TERMS),
    });
    // Which is NOT the hash of the terms this service now serves.
    expect(termsHashHex('New terms: all rights reserved.')).not.toBe(termsHashHex(TERMS));

    // And a fresh acceptance of the OLD terms is now refused: the binding runs both ways.
    const stale = acceptanceFor(serviceDid, participant, TERMS, 'cohort-later');
    expect((await post(app, { acceptance: stale, signature: signWith(stale, participant) })).status).toBe(400);
  });
});

describe('GET /v1/config carries the service DID so a browser can build the record it signs', () => {
  it('serves serviceDid additively, with the frozen network fields byte-identical', async () => {
    const { app, serviceDid } = acceptanceApp({ terms: TERMS });
    const body = (await (await app.request('/v1/config')).json()) as Record<string, unknown>;
    expect(body).toEqual({
      network: 'signet',
      label: 'Signet',
      isMainnet: false,
      serviceDid,
      termsText: TERMS,
    });
  });
});
