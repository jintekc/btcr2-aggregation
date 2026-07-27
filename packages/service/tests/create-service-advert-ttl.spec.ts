import { describe, expect, it, vi } from 'vitest';
import { buildCohortConfig, createIdentity } from '@btcr2-aggregation/shared';

/**
 * SVC-JOIN-1 regression coverage: `createService` must thread the advert-cache TTL into the
 * {@link HttpServerTransport} so the advert SSE replay window equals the directory discovery
 * window on the product path. The library default is 5 minutes, but a cohort stays joinable in
 * the public directory for the full cohortTtl (demo default 30 min) with no auto-republish loop
 * (D-17), so a late-connecting second participant would otherwise never receive the advert and
 * hang at "connecting" forever (the live-UAT stall). The rule: `advertTtlMs` defaults to
 * `cohortTtlMs`, honors an explicit `opts.advertTtlMs` override, and stays undefined (library
 * default) when neither is given.
 *
 * The transport is heavy (it owns real SSE/rate-limit state), so this spec mocks the aggregation
 * service module: it keeps the real exports (hono-adapter loads `formatSse*` from it) but swaps
 * the two constructed classes for capturing stubs, so the ONLY thing under test is the ctor
 * options object `createService` builds. NEW spec under `packages/service/tests/`
 * (tests-outside-src convention); imports the module under test via `../src/index.js`.
 */

// Hoisted shared holder: the mock class constructor runs before test bodies, so it records every
// transport config into an array the tests read after calling createService.
const captured = vi.hoisted(() => ({ configs: [] as Array<Record<string, unknown>> }));

vi.mock('@did-btcr2/aggregation/service', async (importActual) => {
  const actual = await importActual<typeof import('@did-btcr2/aggregation/service')>();
  return {
    ...actual,
    // Capture the ctor options object verbatim; no real transport state is created.
    HttpServerTransport: class {
      constructor(config: Record<string, unknown>) {
        captured.configs.push(config);
      }
      start(): void {}
      stop(): void {}
      registerActor(): void {}
    },
    // A minimal runner stub: createService attaches lifecycle listeners (returns `this`) and the
    // monitor fold reads `session` only lazily (never at construction), so an empty session is safe.
    AggregationServiceRunner: class {
      session = { cohorts: [] as unknown[], getCohortPhase: () => undefined };
      on(): this {
        return this;
      }
    },
  };
});

// Import AFTER the mock is registered (vi.mock is hoisted above the import regardless).
const { createService } = await import('../src/index.js');

/** The most recent transport config captured, so each test reads its own createService call. */
function lastTransportConfig(): Record<string, unknown> {
  const config = captured.configs.at(-1);
  if (!config) {
    throw new Error('no HttpServerTransport was constructed');
  }
  return config;
}

const THIRTY_MIN_MS = 30 * 60 * 1000;

function baseOpts(extra: Record<string, unknown> = {}) {
  return {
    identity: createIdentity(),
    config: buildCohortConfig(2, 'CASBeacon'),
    ...extra,
  };
}

describe('createService advertTtlMs threading (SVC-JOIN-1)', () => {
  it('defaults advertTtlMs to cohortTtlMs when only cohortTtlMs is given', () => {
    createService(baseOpts({ cohortTtlMs: THIRTY_MIN_MS }));
    expect(lastTransportConfig().advertTtlMs).toBe(THIRTY_MIN_MS);
  });

  it('honors an explicit advertTtlMs override over cohortTtlMs', () => {
    const explicit = 7 * 60 * 1000;
    createService(baseOpts({ cohortTtlMs: THIRTY_MIN_MS, advertTtlMs: explicit }));
    expect(lastTransportConfig().advertTtlMs).toBe(explicit);
  });

  it('leaves advertTtlMs undefined (library default) when neither is given', () => {
    createService(baseOpts());
    // The option is set only when resolvable, so on the bare path it must be absent
    // and the transport falls back to its own 5-minute default.
    expect(lastTransportConfig().advertTtlMs).toBeUndefined();
  });

  it('leaves advertTtlMs undefined when cohortTtlMs is NaN (malformed env number)', () => {
    // A bare Number() over a malformed COHORT_TTL_MS env yields NaN; threading it would
    // silently disable advert replay entirely (the expiry comparison against NaN is always
    // false), which is strictly worse than the 5-minute library default.
    createService(baseOpts({ cohortTtlMs: Number('not-a-number') }));
    expect(lastTransportConfig().advertTtlMs).toBeUndefined();
  });

  it('leaves advertTtlMs undefined when the resolved value is 0 (non-positive)', () => {
    // An explicit 0 would make every advert expire immediately, disabling replay outright;
    // the finite-and-positive guard drops it so the library default applies instead.
    createService(baseOpts({ advertTtlMs: 0, cohortTtlMs: THIRTY_MIN_MS }));
    expect(lastTransportConfig().advertTtlMs).toBeUndefined();
  });
});
