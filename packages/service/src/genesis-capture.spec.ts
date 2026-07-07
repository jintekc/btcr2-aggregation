import { canonicalHash } from '@did-btcr2/common';
import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { bakedExternalIdentityFromKeys, createIdentity } from '@btcr2-aggregation/shared';
import { describe, expect, it } from 'vitest';
import { GenesisStagingCache, persistMemberGenesis } from './genesis-capture.js';
import { MemoryArtifactStore } from './store.js';

const COHORT_ADDR = 'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c';

function bakedIdentity() {
  return bakedExternalIdentityFromKeys(SchnorrKeyPair.generate(), COHORT_ADDR, 'CASBeacon');
}

describe('GenesisStagingCache', () => {
  it('evicts the least-recently-remembered entry past the cap', () => {
    const cache = new GenesisStagingCache(2);
    cache.remember('did:a', { a: 1 });
    cache.remember('did:b', { b: 1 });
    cache.remember('did:c', { c: 1 });
    expect(cache.size).toBe(2);
    expect(cache.take('did:a')).toBeUndefined();
    expect(cache.take('did:b')).toEqual({ b: 1 });
    expect(cache.take('did:c')).toEqual({ c: 1 });
  });

  it('re-remembering refreshes recency (the refreshed entry survives eviction)', () => {
    const cache = new GenesisStagingCache(2);
    cache.remember('did:a', { a: 1 });
    cache.remember('did:b', { b: 1 });
    cache.remember('did:a', { a: 2 });
    cache.remember('did:c', { c: 1 });
    expect(cache.take('did:b')).toBeUndefined();
    expect(cache.take('did:a')).toEqual({ a: 2 });
  });

  it('take removes the entry (promotion is one-shot)', () => {
    const cache = new GenesisStagingCache();
    cache.remember('did:a', { a: 1 });
    expect(cache.take('did:a')).toEqual({ a: 1 });
    expect(cache.take('did:a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('rejects a non-positive cap', () => {
    expect(() => new GenesisStagingCache(0)).toThrow(/cap/);
  });
});

describe('persistMemberGenesis', () => {
  it('persists a verified baked genesis under the hash the DID commits to', async () => {
    const store = new MemoryArtifactStore();
    const member = bakedIdentity();
    const outcome = await persistMemberGenesis(store, member.did, member.genesisDocument!);
    expect(outcome).toBe('persisted');
    const key = canonicalHash(member.genesisDocument!, { encoding: 'hex' });
    expect(await store.get('genesis', key)).toEqual(member.genesisDocument);
  });

  it('refuses content that does not hash to the DID commitment (store stays clean)', async () => {
    const store = new MemoryArtifactStore();
    const member = bakedIdentity();
    const tampered = { ...member.genesisDocument!, extra: 'field' };
    expect(await persistMemberGenesis(store, member.did, tampered)).toBe('hash-mismatch');
    expect(await store.entries('genesis')).toHaveLength(0);
  });

  it('refuses a genesis claimed for a DIFFERENT x1 DID (no cross-DID poisoning)', async () => {
    const store = new MemoryArtifactStore();
    const victim = bakedIdentity();
    const attacker = bakedIdentity();
    expect(await persistMemberGenesis(store, victim.did, attacker.genesisDocument!)).toBe('hash-mismatch');
    expect(await store.entries('genesis')).toHaveLength(0);
  });

  it("returns 'not-external' for a KEY (k1) member and for an undecodable DID", async () => {
    const store = new MemoryArtifactStore();
    const genesis = bakedIdentity().genesisDocument!;
    expect(await persistMemberGenesis(store, createIdentity().did, genesis)).toBe('not-external');
    expect(await persistMemberGenesis(store, 'did:btcr2:not-a-real-identifier', genesis)).toBe('not-external');
    expect(await store.entries('genesis')).toHaveLength(0);
  });
});
