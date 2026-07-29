import { SchnorrKeyPair } from '@did-btcr2/keypair';
import { p2tr } from '@scure/btc-signer';
import type { BTC_NETWORK } from '@scure/btc-signer/utils';
import { resolveNetwork } from '@btcr2-aggregation/shared';
import type { AggregationServiceRunner } from '@did-btcr2/aggregation/service';
import type { AddressUtxo, BitcoinConnection } from '@did-btcr2/bitcoin';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCohortIntents, type CohortIntent, type CohortIntentRegistry } from '../src/cohort-intent.js';
import { createRuntimeSettings } from '../src/runtime-settings.js';
import { createOperatorCohorts, type OperatorCohortDTO } from '../src/operator-cohorts.js';
import { computeFundingDeadline, FUNDING_SLACK_MS } from '../src/funding-watch.js';
import { makeProvideTxData, type LiveTxConfig } from '../src/tx.js';

/**
 * Hermetic coverage of PER-DRAFT TIMING WINDOWS (SVC-04 criterion 3, D-11, RESEARCH Pitfall 7).
 *
 * The honest ceiling is the whole point of this file. `cohortTtlMs`, `phaseTimeoutMs` and
 * `advertRepeatIntervalMs` are all PER-RUNNER constructor options armed once at advertise and never
 * reset, and `advertTtlMs` is per-transport, so NO timing value in `aggregation@0.4.0` is
 * per-cohort. A per-draft discovery window is therefore enforced app-side by an intent-tagged
 * `stopCohort`, and it can only ever SHORTEN a cohort's life: asking for longer than the service's
 * own cohort TTL is refused at SAVE TIME with the real ceiling named, because accepting it would be
 * a promise the service cannot keep (the library kills the cohort at its TTL regardless).
 *
 * The funding window is the opposite case and is covered here too: it is app-owned already, so a
 * genuine per-cohort value works, provided the 04 D-38 clamp still computes
 * `min(window, remainingTtl - slack)` and still throws its specific reason before either library
 * timer.
 *
 * The fate of a window-expired cohort rides the INTENT REGISTRY, never the rejection's message
 * text: `stopCohort`, the whole-runner `stop()`, a stall, and a TTL lapse all reject through the
 * same channel, so only an out-of-band declaration made BEFORE the call can tell them apart. The
 * ordering is asserted directly below, not inferred.
 */

const ACTIVE_NETWORK = 'signet';
const MINUTE = 60_000;
/** A 30-minute service cohort TTL: the honest ceiling every per-draft window is measured against. */
const SERVICE_TTL_MS = 30 * MINUTE;
/** The exact refusal a window above the ceiling earns, naming the service maximum in minutes. */
const CEILING_ERROR =
  'This service ends a cohort after 30 minutes, so the discovery window must be 30 minutes or less.';

/**
 * A minimal runner double. The cohort surface touches only `advertiseCohort`, `stopCohort`,
 * `session.cohorts` and `session.getCohortPhase`, so a double gives this spec what a real runner
 * cannot: direct control over each cohort's completion promise, which is the only way to drive the
 * SUCCESS settle path (a real runner would need a full signing round to resolve it).
 */
function fakeRunner() {
  const cohorts: { id: string; participants: unknown[] }[] = [];
  const settle = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();
  const stopped: string[] = [];
  let seq = 0;

  const runner = {
    session: {
      cohorts,
      getCohortPhase: (id: string): string | undefined =>
        cohorts.some((c) => c.id === id) ? 'Advertised' : undefined,
      getCohort: (id: string) => cohorts.find((c) => c.id === id),
    },
    advertiseCohort() {
      const cohortId = `cohort-${++seq}`;
      cohorts.push({ id: cohortId, participants: [] });
      let resolve!: () => void;
      let reject!: (err: Error) => void;
      const completion = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // The surface attaches its own handlers; this keeps an unhandled rejection out of the test
      // run for a cohort no assertion settles.
      completion.catch(() => undefined);
      settle.set(cohortId, { resolve, reject });
      return { cohortId, completion };
    },
    stopCohort(cohortId: string): void {
      stopped.push(cohortId);
      const index = cohorts.findIndex((c) => c.id === cohortId);
      if (index >= 0) {
        cohorts.splice(index, 1);
      }
      settle.get(cohortId)?.reject(new Error(`Cohort ${cohortId} stopped.`));
    },
  };

  return {
    runner: runner as unknown as AggregationServiceRunner,
    /** Resolve a cohort's completion, the SUCCESS settle path. */
    complete(cohortId: string): void {
      const index = cohorts.findIndex((c) => c.id === cohortId);
      if (index >= 0) {
        cohorts.splice(index, 1);
      }
      settle.get(cohortId)?.resolve();
    },
    /** Reject a cohort's completion WITHOUT an intent, the ordinary stall / failure path. */
    fail(cohortId: string): void {
      const index = cohorts.findIndex((c) => c.id === cohortId);
      if (index >= 0) {
        cohorts.splice(index, 1);
      }
      settle.get(cohortId)?.reject(new Error(`Cohort ${cohortId} failed.`));
    },
    stopped,
  };
}

/**
 * Wrap an intent registry so every declaration is recorded with the stop calls interleaved. This is
 * what turns "declare before stop" from an inferred property into an asserted one.
 */
function recordingIntents(inner: CohortIntentRegistry, log: string[]): CohortIntentRegistry {
  return {
    declare(cohortId: string, intent: CohortIntent): void {
      log.push(`declare:${cohortId}:${intent}`);
      inner.declare(cohortId, intent);
    },
    read: (cohortId: string) => inner.read(cohortId),
    clear: (cohortId: string) => inner.clear(cohortId),
  };
}

/** The cohort surface under test, over the runner double. */
function windowSurface(
  opts: { cohortTtlMs?: number; defaultDiscoveryWindowMs?: number; defaultFundingWindowMs?: number } = {},
) {
  const harness = fakeRunner();
  const log: string[] = [];
  const intents = recordingIntents(createCohortIntents(), log);
  const settings = createRuntimeSettings({
    defaultDiscoveryWindowMs: opts.defaultDiscoveryWindowMs,
    defaultFundingWindowMs: opts.defaultFundingWindowMs,
  });
  const advertisedWindows: { cohortId: string; discoveryWindowMs?: number; fundingWindowMs?: number }[] = [];
  const cohorts = createOperatorCohorts({
    activeNetwork: ACTIVE_NETWORK,
    runner: harness.runner,
    autoFallbackOnStall: true,
    intents,
    settings,
    cohortTtlMs: opts.cohortTtlMs,
    onAdvertised: (cohortId, windows) => {
      advertisedWindows.push({ cohortId, ...windows });
    },
  });
  // Interleave the stop calls into the SAME log the declarations write to.
  const realStop = harness.runner.stopCohort.bind(harness.runner);
  vi.spyOn(harness.runner, 'stopCohort').mockImplementation((id: string) => {
    log.push(`stop:${id}`);
    realStop(id);
  });
  return { ...harness, cohorts, intents, settings, log, advertisedWindows };
}

/** The message thrown for `run`, or undefined when it did not throw. */
function thrownMessage(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the per-draft discovery window can only SHORTEN (RESEARCH Pitfall 7)', () => {
  it('accepts a window BELOW the service cohort TTL', () => {
    const { cohorts } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const dto = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: 10 * MINUTE });
    expect(dto.discoveryWindowMs).toBe(10 * MINUTE);
  });

  it('accepts a window exactly AT the service cohort TTL', () => {
    const { cohorts } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const dto = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: SERVICE_TTL_MS });
    expect(dto.discoveryWindowMs).toBe(SERVICE_TTL_MS);
  });

  it('refuses a window ABOVE the ceiling, naming the service maximum in minutes', () => {
    const { cohorts } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const message = thrownMessage(() =>
      cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: 45 * MINUTE }),
    );
    expect(message).toBe(CEILING_ERROR);
  });

  it('refuses the same over-long window on the EDIT path and leaves the draft unchanged', () => {
    const { cohorts } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: 10 * MINUTE });
    const message = thrownMessage(() =>
      cohorts.updateDraft(draft.draftId, { beaconType: 'CASBeacon', size: 2, discoveryWindowMs: 45 * MINUTE }),
    );
    expect(message).toBe(CEILING_ERROR);
    // Nothing was reshaped by the refusal.
    const listed = cohorts.listCohorts();
    expect(listed[0].discoveryWindowMs).toBe(10 * MINUTE);
    expect(listed[0].capacity).toBe(2);
  });

  it('imposes NO ceiling when the service arms no cohort TTL of its own', () => {
    const { cohorts } = windowSurface({});
    const dto = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: 600 * MINUTE });
    expect(dto.discoveryWindowMs).toBe(600 * MINUTE);
  });

  it('refuses a sub-minute or fractional window with the exact UI-SPEC copy', () => {
    const { cohorts } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    expect(
      thrownMessage(() => cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: 30_000 })),
    ).toBe('Discovery window must be a whole number of minutes, at least 1.');
    expect(
      thrownMessage(() => cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, fundingWindowMs: 1.5 })),
    ).toBe('Funding window must be a whole number of minutes, at least 1.');
  });
});

describe('an omitted window means USE THE DEFAULT, never no window', () => {
  it('carries this service default onto the draft without an explicit value', () => {
    const { cohorts } = windowSurface({
      cohortTtlMs: SERVICE_TTL_MS,
      defaultDiscoveryWindowMs: 20 * MINUTE,
      defaultFundingWindowMs: 12 * MINUTE,
    });
    const dto = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    // No EXPLICIT value (so the edit form's field renders empty, UI-SPEC E7 empty)...
    expect(dto.discoveryWindowMs).toBeUndefined();
    expect(dto.fundingWindowMs).toBeUndefined();
    // ...but the service's own default is carried alongside, so the help text can name it and the
    // draft is never left with NO window at all.
    expect(dto.defaultDiscoveryWindowMs).toBe(20 * MINUTE);
    expect(dto.defaultFundingWindowMs).toBe(12 * MINUTE);
  });

  it('never lets a zero, null, or NaN window reach the advertised cohort', () => {
    const { cohorts, advertisedWindows } = windowSurface({
      cohortTtlMs: SERVICE_TTL_MS,
      defaultDiscoveryWindowMs: 20 * MINUTE,
    });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    cohorts.advertiseDraft(draft.draftId);
    expect(advertisedWindows).toHaveLength(1);
    const effective = advertisedWindows[0].discoveryWindowMs;
    expect(effective).toBe(20 * MINUTE);
    expect(Number.isInteger(effective)).toBe(true);
  });

  it('reads the default ONCE at draft time and never re-reads it at advertise time (D-13)', () => {
    const { cohorts, settings, advertisedWindows } = windowSurface({
      cohortTtlMs: SERVICE_TTL_MS,
      defaultDiscoveryWindowMs: 20 * MINUTE,
    });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2 });
    // The operator changes the service default AFTER drafting. The draft keeps the shape it was
    // drafted with, exactly as an advertised cohort keeps the shape it was advertised with.
    settings.applySettings({ defaultDiscoveryWindowMs: 5 * MINUTE });
    cohorts.advertiseDraft(draft.draftId);
    expect(advertisedWindows[0].discoveryWindowMs).toBe(20 * MINUTE);
  });

  it('prefers an EXPLICIT per-draft value over the service default', () => {
    const { cohorts, advertisedWindows } = windowSurface({
      cohortTtlMs: SERVICE_TTL_MS,
      defaultDiscoveryWindowMs: 20 * MINUTE,
      defaultFundingWindowMs: 12 * MINUTE,
    });
    const draft = cohorts.createDraft({
      beaconType: 'CASBeacon',
      size: 2,
      discoveryWindowMs: 5 * MINUTE,
      fundingWindowMs: 3 * MINUTE,
    });
    cohorts.advertiseDraft(draft.draftId);
    expect(advertisedWindows[0].discoveryWindowMs).toBe(5 * MINUTE);
    expect(advertisedWindows[0].fundingWindowMs).toBe(3 * MINUTE);
  });
});

describe('the app-side window timer ends the cohort through the intent registry', () => {
  it('declares window-expired BEFORE calling stopCohort', async () => {
    vi.useFakeTimers();
    const { cohorts, log } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: MINUTE });
    const advertised = cohorts.advertiseDraft(draft.draftId) as OperatorCohortDTO;
    const cohortId = advertised.draftId;

    expect(cohorts.pendingWindowTimers()).toBe(1);
    await vi.advanceTimersByTimeAsync(MINUTE + 10);

    // The ORDER is the whole contract: `stopCohort` is silent and rejects through the same channel
    // as a stall, a TTL lapse, and a whole-runner shutdown, so a tag declared after the call would
    // be read too late and the cohort would be filed as an ordinary expiry.
    expect(log).toEqual([`declare:${cohortId}:window-expired`, `stop:${cohortId}`]);
  });

  it('files the app-authored expiry reason under the expired fate, never canceled', async () => {
    vi.useFakeTimers();
    const { cohorts } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: MINUTE });
    const advertised = cohorts.advertiseDraft(draft.draftId) as OperatorCohortDTO;

    await vi.advanceTimersByTimeAsync(MINUTE + 10);

    const listed = cohorts.listCohorts();
    expect(listed).toHaveLength(1);
    expect(listed[0].draftId).toBe(advertised.draftId);
    expect(listed[0].state).toBe('expired');
    // App-authored copy, NOT the library's `Cohort {id} stopped.` machine string, which reads as a
    // malfunction rather than the window this service itself closed.
    expect(listed[0].reason).toBe('the discovery window closed');
    expect(listed[0].reason).not.toMatch(/stopped\./);
  });

  it('leaves the cohort alone until the window actually elapses', async () => {
    vi.useFakeTimers();
    const { cohorts, log } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: 5 * MINUTE });
    cohorts.advertiseDraft(draft.draftId);

    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(log).toEqual([]);
    expect(cohorts.directory()).toHaveLength(1);
  });

  it('arms NO timer for a draft whose window is the service TTL (the library already ends it)', () => {
    vi.useFakeTimers();
    const { cohorts } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: SERVICE_TTL_MS });
    cohorts.advertiseDraft(draft.draftId);
    // A timer that fires at the same moment as the library's own TTL adds nothing but a race.
    expect(cohorts.pendingWindowTimers()).toBe(0);
  });
});

describe('the window timer is cleared on EVERY settle path', () => {
  it('clears it when the cohort completes successfully', async () => {
    vi.useFakeTimers();
    const { cohorts, complete } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: MINUTE });
    const advertised = cohorts.advertiseDraft(draft.draftId) as OperatorCohortDTO;
    expect(cohorts.pendingWindowTimers()).toBe(1);

    complete(advertised.draftId);
    await vi.advanceTimersByTimeAsync(0);
    expect(cohorts.pendingWindowTimers()).toBe(0);

    // ...and no late fire can mislabel a reused id.
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(cohorts.listCohorts()).toHaveLength(0);
  });

  it('clears it when the cohort fails', async () => {
    vi.useFakeTimers();
    const { cohorts, fail } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: MINUTE });
    const advertised = cohorts.advertiseDraft(draft.draftId) as OperatorCohortDTO;

    fail(advertised.draftId);
    await vi.advanceTimersByTimeAsync(0);
    expect(cohorts.pendingWindowTimers()).toBe(0);
    // The ordinary failure keeps its own reason: the window never closed, so it must not claim it.
    expect(cohorts.listCohorts()[0].reason).not.toBe('the discovery window closed');
  });

  it('clears it when the operator cancels, and the fate stays canceled', async () => {
    vi.useFakeTimers();
    const { cohorts, log } = windowSurface({ cohortTtlMs: SERVICE_TTL_MS });
    const draft = cohorts.createDraft({ beaconType: 'CASBeacon', size: 2, discoveryWindowMs: MINUTE });
    const advertised = cohorts.advertiseDraft(draft.draftId) as OperatorCohortDTO;

    expect(cohorts.cancelCohort(advertised.draftId)).toBe('ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(cohorts.pendingWindowTimers()).toBe(0);
    expect(cohorts.listCohorts()[0].state).toBe('canceled');

    // The window timer must NOT fire afterwards and re-declare an intent against the same id.
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(log.filter((e) => e.includes('window-expired'))).toEqual([]);
    expect(cohorts.listCohorts()[0].state).toBe('canceled');
  });
});

// ---------------------------------------------------------------------------------------------
// The per-cohort FUNDING window: genuinely per-cohort, because it is app-owned (unlike every
// library timer). The 04 D-38 clamp must keep computing min(window, remainingTtl - slack).
// ---------------------------------------------------------------------------------------------

const NETWORK: BTC_NETWORK = resolveNetwork('regtest').scureNetwork;
const SIGNAL = new Uint8Array(32).fill(9);
const feeEstimator = { estimateFee: async (): Promise<bigint> => 500n };

/** A runner double whose `session.getCohort` returns a cohort carrying `internalKey`. */
function txRunner(internalKey: Uint8Array): AggregationServiceRunner {
  return { session: { getCohort: () => ({ internalKey }) } } as unknown as AggregationServiceRunner;
}

/** A mock esplora whose beacon address never funds (every read is a successful empty observation). */
function emptyBitcoin(): BitcoinConnection {
  return {
    rest: {
      address: { getUtxos: async (): Promise<AddressUtxo[]> => [] },
      transaction: {
        getHex: async () => '',
        send: async () => {
          throw new Error('mock: broadcast disabled');
        },
        isConfirmed: async () => true,
      },
    },
  } as unknown as BitcoinConnection;
}

describe('a per-draft FUNDING window still obeys the 04 D-38 clamp', () => {
  it('computes min(window, remainingTtl - slack) for a per-cohort value', () => {
    // The per-draft window binds when it is the smaller leg...
    expect(
      computeFundingDeadline({
        configuredWindowMs: 3 * MINUTE,
        remainingTtlMs: 20 * MINUTE,
        slackMs: FUNDING_SLACK_MS,
      }).deadlineMs,
    ).toBe(3 * MINUTE);
    // ...and the remaining cohort TTL less the slack binds when IT is, with the truncation
    // disclosed rather than silently applied.
    const clamped = computeFundingDeadline({
      configuredWindowMs: 12 * MINUTE,
      remainingTtlMs: 4 * MINUTE,
      slackMs: FUNDING_SLACK_MS,
    });
    expect(clamped.deadlineMs).toBe(4 * MINUTE - FUNDING_SLACK_MS);
    expect(clamped.truncatedWindowMin).toBe(4);
  });

  it('drives the wait from the PER-COHORT window rather than the service default', async () => {
    const internalKey = SchnorrKeyPair.generate().publicKey.xOnly;
    const beaconAddress = p2tr(internalKey, undefined, NETWORK).address!;
    const live: LiveTxConfig = {
      bitcoin: emptyBitcoin(),
      network: NETWORK,
      // A service default long enough that the test would hang if it were the one honored...
      fundingWindowMs: 60_000,
      fundingPollIntervalMs: 15,
      // ...against a per-cohort window of 120ms, which is what must bind.
      cohortFundingWindowMs: () => 120,
    };
    const provide = makeProvideTxData(() => txRunner(internalKey), live);
    const start = Date.now();
    await expect(
      provide({ cohortId: 'cohort-1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/funding never arrived/);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it('waits at all for a cohort window on a service with NO configured default', async () => {
    // The wait is gated on there being a window; a per-cohort value must open that gate on its own,
    // else a draft-level funding window would silently fall back to the single-shot pre-flight.
    const internalKey = SchnorrKeyPair.generate().publicKey.xOnly;
    const beaconAddress = p2tr(internalKey, undefined, NETWORK).address!;
    const live: LiveTxConfig = {
      bitcoin: emptyBitcoin(),
      network: NETWORK,
      fundingPollIntervalMs: 15,
      cohortFundingWindowMs: () => 120,
    };
    const provide = makeProvideTxData(() => txRunner(internalKey), live);
    await expect(
      provide({ cohortId: 'cohort-1', beaconAddress, signalBytes: SIGNAL, feeEstimator }),
    ).rejects.toThrow(/funding never arrived/);
  });
});
