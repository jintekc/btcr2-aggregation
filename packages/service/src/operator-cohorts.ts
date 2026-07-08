/**
 * Operator on-demand cohort drafts + advertise + the public directory/status
 * (SVC-01/SVC-02, D-09/D-10/D-12/D-13/D-14/D-15/D-17).
 *
 * This is the full two-step cohort flow. First an authenticated operator shapes a
 * cohort by hand (beacon type, n-of-n co-sign threshold, capacity) and it is stored as
 * an un-advertised DRAFT - app-level config that is NOT yet handed to the
 * {@link AggregationServiceRunner}, so a draft has zero protocol side effects (D-12).
 * Then the operator ADVERTISES a draft: {@link OperatorCohorts.advertiseDraft} is the
 * ONE and ONLY caller of `runner.advertiseCohort` in the whole app now that the
 * boot-time perpetual auto-advertise loop is gone (D-17) - a fresh service advertises
 * nothing until the operator acts.
 *
 * The public read surface is derived, never duplicated (D-15): {@link
 * OperatorCohorts.directory} lists the open/joinable cohorts straight from the live
 * `runner.session.cohorts` (filtered by phase), enriched from a small `advertised`
 * config map keyed by the live cohort id; {@link OperatorCohorts.status} reuses
 * `directory().length` for its open-count so the public count and the directory can
 * never drift (D-09). The enrichment map is the ONLY app-side state, and it is pruned
 * the moment a cohort's completion settles, so a finished cohort disappears from both
 * (Pitfall 5).
 *
 * Two decisions are load-bearing here:
 * - The Bitcoin network is the SERVICE's single active network, resolved once at boot
 *   and passed in as {@link OperatorCohortsOptions.activeNetwork}; it is NEVER read
 *   from the create-form body (D-10). A form that could pick a network would let the
 *   browser derive addresses/DIDs for a chain the coordinator does not run.
 * - `capacity` is applied app-side as `maxParticipants` on top of
 *   {@link buildCohortConfig} (whose `minParticipants` is the n-of-n threshold), so
 *   the operator sets an explicit seat ceiling rather than an open cohort (D-11/D-19).
 *
 * State is a per-{@link createOperatorCohorts} `Map` pair (mirrors the
 * `seatedRosterKeys` / `genesisStaging` closure scoping in index.ts), NOT a module
 * singleton, so two services in one process (tests) never share drafts.
 */

import { randomUUID } from 'node:crypto';
import { buildCohortConfig, type BeaconType, type NetworkName } from '@btcr2-aggregation/shared';
import type { AggregationServiceRunner, CohortConfig } from '@did-btcr2/aggregation/service';

/** The two aggregation beacon types an operator may draft (singleton is single-party). */
const KNOWN_BEACON_TYPES = new Set<string>(['CASBeacon', 'SMTBeacon']);

/**
 * Cohort phases that count as open/joinable for the public directory (A1, RESEARCH).
 * These are exactly the pre-signing phases: a cohort still discovering or gathering
 * participants. Once signing starts (SigningStarted and later) or the cohort settles
 * (Complete/Failed) it is no longer an open entry. Filtering conservatively to this
 * set keeps a signing or finished cohort out of the "open" directory even before the
 * enrichment map is pruned. Kept as string members so this file does not depend on the
 * library's enum value shape.
 */
const OPEN_PHASES = new Set<string>(['Advertised', 'CohortSet', 'CollectingUpdates']);

/** Untrusted create-form body: beacon type + the two cohort-size bounds. */
export interface DraftInput {
  beaconType: string;
  threshold: number;
  capacity: number;
}

/**
 * The wire shape of an operator cohort in the operator's OWN list. Only operator-safe
 * fields are exposed (T-02-04): no recovery key, no keys, no secrets - just what the
 * operator's cohort list renders. `state` is `'draft'` for an un-advertised draft and
 * `'advertised'` once it is live in the directory. `draftId` is the row's stable id:
 * the draft id while a draft, the live cohort id once advertised (drafts and advertised
 * cohorts never share an id space, so it stays unambiguous for React keying).
 */
export interface OperatorCohortDTO {
  draftId: string;
  beaconType: BeaconType;
  network: NetworkName;
  threshold: number;
  capacity: number;
  /** Accepted participants so far; always 0 for a draft (nobody joins a draft). */
  joined: number;
  state: 'draft' | 'advertised';
}

/**
 * The PUBLIC directory entry for one open cohort (D-14). Derived from the live
 * `runner.session.cohorts` and enriched from the advertised config; exposes only
 * non-sensitive fields a participant needs to choose a cohort (T-03-02) - no keys, no
 * recovery key, no participant DIDs (only a count).
 */
export interface DirectoryCohortDTO {
  cohortId: string;
  beaconType: BeaconType;
  network: NetworkName;
  threshold: number;
  capacity: number;
  /** Number of participants accepted into the cohort so far. */
  joined: number;
  /** Current cohort phase (one of {@link OPEN_PHASES} for a listed entry). */
  phase: string;
}

/** The PUBLIC service status (D-09): up, active network, and the open-cohort count. */
export interface ServiceStatusDTO {
  up: true;
  network: NetworkName;
  openCohorts: number;
}

/** Construction inputs for {@link createOperatorCohorts}. */
export interface OperatorCohortsOptions {
  /**
   * The live aggregation runner. `advertiseDraft` hands a draft's config to
   * `runner.advertiseCohort` (the sole call site now, D-17), and `directory`/`status`
   * read `runner.session.cohorts` as the single source of truth for the open set (D-15).
   */
  runner: AggregationServiceRunner;
  /** The service's single active Bitcoin network (D-10); never a form value. */
  activeNetwork: NetworkName;
  /**
   * Operator recovery key (x-only hex) threaded from the service cohort config, so a
   * drafted cohort carries the same recovery leaf the operator funds. Optional - when
   * absent {@link buildCohortConfig} derives a throwaway (fine off-chain / on test nets).
   */
  recoveryKey?: string;
}

/** The create/advertise/discard/list + public directory/status surface. */
export interface OperatorCohorts {
  /** Validate + store a draft; throws a user-facing `Error` on invalid input. */
  createDraft(input: DraftInput): OperatorCohortDTO;
  /**
   * Advertise a draft: the SOLE caller of `runner.advertiseCohort` (D-17). Moves the
   * draft out of the drafts map into the live/advertised set and returns the advertised
   * DTO. Returns `undefined` for an unknown draft id (route 404).
   */
  advertiseDraft(draftId: string): OperatorCohortDTO | undefined;
  /** Remove an un-advertised draft. Returns false for an unknown id (route 404). */
  discardDraft(draftId: string): boolean;
  /** Drafts (state 'draft') plus advertised cohorts (state 'advertised'), for the operator list. */
  listCohorts(): OperatorCohortDTO[];
  /** Public: the open/joinable cohorts derived from the live set (D-14/D-15). */
  directory(): DirectoryCohortDTO[];
  /** Public: up / active network / open-cohort count, reusing {@link directory} (D-09). */
  status(): ServiceStatusDTO;
}

/**
 * Validate a create-form body into a `{ beaconType, threshold, capacity }` triple.
 * Guard-clause style (index.ts / shared house style): throws on the first problem with
 * a user-facing message the route surfaces verbatim as the 400 body. The two numeric
 * messages are the exact UI-SPEC validation strings so the server and the browser agree
 * on the copy the operator sees.
 */
function validateDraft(input: DraftInput): { beaconType: BeaconType; threshold: number; capacity: number } {
  const { beaconType, threshold, capacity } = input;
  if (typeof beaconType !== 'string' || !KNOWN_BEACON_TYPES.has(beaconType)) {
    throw new Error(`operator: unknown beacon type "${String(beaconType)}" (expected CASBeacon or SMTBeacon)`);
  }
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error('Threshold must be at least 1 signer.');
  }
  if (!Number.isInteger(capacity) || capacity < threshold) {
    throw new Error('Capacity must be at least the co-sign threshold.');
  }
  return { beaconType: beaconType as BeaconType, threshold, capacity };
}

/**
 * Build the per-service operator cohort surface. `drafts` is closure state keyed by a
 * fresh CSPRNG draft id; each entry keeps both the built {@link CohortConfig} (so plan
 * 03 can hand it straight to the runner on advertise) and the operator-facing
 * {@link OperatorCohortDTO}.
 */
export function createOperatorCohorts(opts: OperatorCohortsOptions): OperatorCohorts {
  const { runner, activeNetwork, recoveryKey } = opts;
  const drafts = new Map<string, { config: CohortConfig; dto: OperatorCohortDTO }>();
  // Enrichment ONLY (D-15): keyed by the LIVE cohort id, holds the config each cohort
  // was advertised with so `directory()` can surface threshold/capacity/beaconType
  // without re-reading them off the runner. Membership + openness always come from
  // `runner.session.cohorts` + the phase filter; this map is pruned on completion so
  // it can never make the directory outlive the live set (Pitfall 5).
  const advertised = new Map<string, CohortConfig>();

  /**
   * The open/joinable cohorts, derived from the live set. Membership is
   * `runner.session.cohorts` (the single source of truth), narrowed to the pre-signing
   * {@link OPEN_PHASES} and to cohorts we still hold an enrichment config for (a
   * belt-and-suspenders alignment with the completion prune). Never reads a parallel
   * operator-written list as the source of truth (D-15).
   */
  function directory(): DirectoryCohortDTO[] {
    const entries: DirectoryCohortDTO[] = [];
    for (const cohort of runner.session.cohorts) {
      const config = advertised.get(cohort.id);
      if (!config) {
        continue;
      }
      const phase = runner.session.getCohortPhase(cohort.id);
      if (!phase || !OPEN_PHASES.has(phase)) {
        continue;
      }
      entries.push({
        cohortId: cohort.id,
        beaconType: config.beaconType as BeaconType,
        network: activeNetwork,
        threshold: config.minParticipants,
        capacity: config.maxParticipants ?? config.minParticipants,
        joined: cohort.participants.length,
        phase,
      });
    }
    return entries;
  }

  return {
    createDraft(input: DraftInput): OperatorCohortDTO {
      const { beaconType, threshold, capacity } = validateDraft(input);
      // Build on the SERVICE active network (D-10). `minParticipants` is the n-of-n
      // threshold; set `maxParticipants` = capacity so the cohort has an explicit seat
      // ceiling app-side rather than being open (D-11/D-19).
      const config = buildCohortConfig(threshold, beaconType, activeNetwork, recoveryKey);
      config.maxParticipants = capacity;
      const draftId = randomUUID();
      const dto: OperatorCohortDTO = {
        draftId,
        beaconType,
        network: activeNetwork,
        threshold,
        capacity,
        joined: 0,
        state: 'draft',
      };
      drafts.set(draftId, { config, dto });
      console.log(`[operator] created draft ${draftId} (${beaconType} ${threshold}-of-${threshold}, cap ${capacity})`);
      return dto;
    },

    advertiseDraft(draftId: string): OperatorCohortDTO | undefined {
      const entry = drafts.get(draftId);
      if (!entry) {
        return undefined;
      }
      // THE sole `runner.advertiseCohort` call site in the app (D-17): the boot-time
      // perpetual auto-advertise loop is gone, so a cohort only ever comes into
      // existence here, when the operator explicitly advertises a draft.
      const { cohortId, completion } = runner.advertiseCohort(entry.config);
      advertised.set(cohortId, entry.config);
      drafts.delete(draftId);
      // Prune the enrichment entry the moment the cohort settles (resolves OR rejects),
      // so `directory()`/`status()` stop counting it (D-15, Pitfall 5). Fire-and-forget
      // like the index.ts side-effect listeners: swallow the rejection a failed/stalled
      // cohort raises so it never surfaces as an unhandled rejection (the `finally`
      // prune has already run by the time `catch` sees it).
      void completion.finally(() => advertised.delete(cohortId)).catch(() => {
        /* completion rejects on cohort failure/stall/stop; the prune above still ran. */
      });
      console.log(`[operator] advertised cohort ${cohortId} (from draft ${draftId})`);
      return {
        draftId: cohortId,
        beaconType: entry.dto.beaconType,
        network: entry.dto.network,
        threshold: entry.dto.threshold,
        capacity: entry.dto.capacity,
        joined: 0,
        state: 'advertised',
      };
    },

    discardDraft(draftId: string): boolean {
      const existed = drafts.delete(draftId);
      if (existed) {
        console.log(`[operator] discarded draft ${draftId}`);
      }
      return existed;
    },

    listCohorts(): OperatorCohortDTO[] {
      const draftDtos = [...drafts.values()].map((d) => d.dto);
      const advertisedDtos: OperatorCohortDTO[] = directory().map((entry) => ({
        draftId: entry.cohortId,
        beaconType: entry.beaconType,
        network: entry.network,
        threshold: entry.threshold,
        capacity: entry.capacity,
        joined: entry.joined,
        state: 'advertised',
      }));
      return [...draftDtos, ...advertisedDtos];
    },

    directory,

    status(): ServiceStatusDTO {
      // Reuse `directory()` for the open-count so the public number and the directory
      // are the SAME source and cannot drift (D-09).
      return { up: true, network: activeNetwork, openCohorts: directory().length };
    },
  };
}
