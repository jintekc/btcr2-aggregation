import { describe, expect, it } from 'vitest';
import {
  MAX_ACCEPTANCES,
  acceptanceDedupKey,
  createAcceptanceLedger,
} from '../src/acceptance-ledger.js';

/**
 * The bounded retention ledger behind `POST /v1/terms/acceptance` (SVC-05, D-19), unit-tested as
 * the pure structure it is: no store, no route, no keys.
 *
 * The route is deliberately anonymous, so a caller who mints throwaway k1 DIDs locally is a
 * VERIFIED caller (the signature proves authenticity, never authorization). Before this ledger
 * existed nothing ever deleted an acceptance, so every distinct record grew the process-wide
 * artifact store forever (`05-AUDIT.md` entries 1 and 5, reproduced at about 430 accepted writes
 * per second). This structure is what makes the namespace bounded.
 *
 * Two properties carry the whole design and each has its own row below:
 *
 * 1. **`remember` never returns the hash it is retaining.** The store key is the canonical hash of
 *    the WHOLE record while the dedup key is participant plus cohort, and those two disagree on
 *    exactly one input: a byte-identical repost. An unguarded `return previous` would hand the
 *    route the hash it stored one line earlier, the route would delete it, and the participant
 *    would get a 200 carrying a hash that resolves to nothing (T-05-17-06).
 * 2. **Eviction is oldest-first and never a refusal.** Refusing past a cap would trade memory
 *    exhaustion for participant lockout of the SVC-05 join gate itself (T-05-17-02), so the
 *    ledger always accepts and drops the oldest instead.
 */

describe('the acceptance dedup key is participant AND cohort, and nothing else', () => {
  it('separates two participants on one cohort, and one participant on two cohorts', () => {
    expect(acceptanceDedupKey('did:btcr2:a', 'cohort-1')).not.toBe(
      acceptanceDedupKey('did:btcr2:b', 'cohort-1'),
    );
    expect(acceptanceDedupKey('did:btcr2:a', 'cohort-1')).not.toBe(
      acceptanceDedupKey('did:btcr2:a', 'cohort-2'),
    );
    expect(acceptanceDedupKey('did:btcr2:a', 'cohort-1')).toBe(
      acceptanceDedupKey('did:btcr2:a', 'cohort-1'),
    );
  });

  it('cannot be confused across the boundary between the two fields', () => {
    // A separator that either field could contain would let one pair spell another pair's key.
    // A cohort id is `[0-9a-zA-Z-]` and a DID is printable, so the NUL separator is unspellable
    // by both and the two keys below stay distinct.
    expect(acceptanceDedupKey('did:btcr2:a', 'b-cohort')).not.toBe(
      acceptanceDedupKey('did:btcr2:a-b', 'cohort'),
    );
  });
});

describe('createAcceptanceLedger retains one hash per participant-and-cohort', () => {
  it('drops nothing for a first-time key', () => {
    const ledger = createAcceptanceLedger();
    expect(ledger.remember('k1', 'aa')).toEqual([]);
    expect(ledger.retained()).toEqual(['aa']);
  });

  it('drops the PREVIOUS hash when the same key is re-accepted with a different record', () => {
    const ledger = createAcceptanceLedger();
    ledger.remember('k1', 'aa');
    expect(ledger.remember('k1', 'bb')).toEqual(['aa']);
    expect(ledger.retained()).toEqual(['bb']);
  });

  it('NEVER returns the hash it is retaining, so a byte-identical repost drops nothing', () => {
    // The contract row for T-05-17-06. A naive `return previous` passes every OTHER row in this
    // file and still turns the route into an unauthenticated delete primitive against the record
    // it just stored, because an identical repost arrives with `previous === hashHex`.
    const ledger = createAcceptanceLedger();
    expect(ledger.remember('k1', 'aa')).toEqual([]);
    expect(ledger.remember('k1', 'aa')).toEqual([]);
    expect(ledger.remember('k1', 'aa')).toEqual([]);
    expect(ledger.retained()).toEqual(['aa']);
  });

  it('keeps distinct keys apart rather than collapsing them', () => {
    const ledger = createAcceptanceLedger();
    ledger.remember(acceptanceDedupKey('did:btcr2:a', 'cohort-1'), 'aa');
    ledger.remember(acceptanceDedupKey('did:btcr2:b', 'cohort-1'), 'bb');
    ledger.remember(acceptanceDedupKey('did:btcr2:a', 'cohort-2'), 'cc');
    expect(ledger.retained().sort()).toEqual(['aa', 'bb', 'cc']);
  });
});

describe('the ledger is BOUNDED with oldest-first eviction', () => {
  it(`retains exactly ${MAX_ACCEPTANCES} hashes and returns the oldest for deletion`, () => {
    const ledger = createAcceptanceLedger();
    const dropped: string[] = [];
    for (let i = 0; i < MAX_ACCEPTANCES; i += 1) {
      dropped.push(...ledger.remember(`k${i}`, `h${i}`));
    }
    // Nothing is evicted until the bound is actually exceeded.
    expect(dropped).toEqual([]);
    expect(ledger.retained()).toHaveLength(MAX_ACCEPTANCES);

    // The next twenty push the twenty OLDEST out, one per insertion.
    for (let i = MAX_ACCEPTANCES; i < MAX_ACCEPTANCES + 20; i += 1) {
      expect(ledger.remember(`k${i}`, `h${i}`)).toEqual([`h${i - MAX_ACCEPTANCES}`]);
    }
    expect(ledger.retained()).toHaveLength(MAX_ACCEPTANCES);
    expect(ledger.retained()).not.toContain('h0');
    expect(ledger.retained()).toContain(`h${MAX_ACCEPTANCES + 19}`);
  });

  it('refreshes a re-accepted key to the newest position rather than leaving it to age out', () => {
    // Delete-then-set, the same ordering `monitor.ts` uses for its ended map: a participant who
    // re-accepts must not be the next eviction victim just because they first accepted long ago.
    const ledger = createAcceptanceLedger();
    for (let i = 0; i < MAX_ACCEPTANCES; i += 1) {
      ledger.remember(`k${i}`, `h${i}`);
    }
    // k0 is the oldest. Re-accepting it moves it to the back of the queue...
    expect(ledger.remember('k0', 'h0-again')).toEqual(['h0']);
    // ...so the NEXT insertion evicts k1, not k0.
    expect(ledger.remember('kNew', 'hNew')).toEqual(['h1']);
    expect(ledger.retained()).toContain('h0-again');
  });

  it('is sized like every other retained structure in this service', () => {
    // 200, matching `MAX_TEST_PEER_DIDS`. An acceptance is a handful of short strings, so the
    // worst case is a few hundred kilobytes of heap on a single-box coordinator.
    expect(MAX_ACCEPTANCES).toBe(200);
  });
});
