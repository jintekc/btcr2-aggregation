/**
 * Operator on-demand cohort drafts + advertise + the public directory/status
 * (SVC-01/SVC-02, D-09/D-10/D-12/D-13/D-14/D-15/D-17).
 *
 * This is the full two-step cohort flow. First an authenticated operator shapes a
 * cohort by hand (beacon type + a single cohort size n) and it is stored as
 * an un-advertised DRAFT - app-level config that is NOT yet handed to the
 * {@link AggregationServiceRunner}, so a draft has zero protocol side effects (D-12).
 * Then the operator ADVERTISES a draft: {@link OperatorCohorts.advertiseDraft} and
 * {@link OperatorCohorts.readvertiseExpired} are the ONLY two callers of
 * `runner.advertiseCohort` in the whole app now that the boot-time perpetual
 * auto-advertise loop is gone (D-17), and both are operator-driven - a fresh service
 * advertises nothing until the operator acts, and a cohort only ever comes into
 * existence on an explicit operator action.
 *
 * The public read surface is derived, never duplicated (D-15): {@link
 * OperatorCohorts.directory} lists the open/joinable cohorts straight from the live
 * `runner.session.cohorts` (filtered by phase), enriched from a small `advertised`
 * config map keyed by the live cohort id; {@link OperatorCohorts.status} reuses
 * `directory().length` for its open-count so the public count and the directory can
 * never drift (D-09). On completion the enrichment entry is settled: a cohort that
 * completes successfully is pruned (it legitimately leaves the open set), while a
 * cohort whose completion REJECTS (stall / TTL / stop) is moved into a bounded
 * `terminal` record set and surfaced to the operator as `state: 'expired'` with a
 * reason instead of vanishing silently (F2). Expired records are operator-only: they
 * are listed by {@link OperatorCohorts.listCohorts} but never by {@link
 * OperatorCohorts.directory}/{@link OperatorCohorts.status}, so a participant never
 * sees an expired cohort as joinable.
 *
 * Two decisions are load-bearing here:
 * - The Bitcoin network is the SERVICE's single active network, resolved once at boot
 *   and passed in as {@link OperatorCohortsOptions.activeNetwork}; it is NEVER read
 *   from the create-form body (D-10). A form that could pick a network would let the
 *   browser derive addresses/DIDs for a chain the coordinator does not run.
 * - A cohort has ONE size n, applied app-side as `minParticipants === maxParticipants === n`
 *   on top of {@link buildCohortConfig} (whose `minParticipants` is the n-of-n threshold), so
 *   n is both the seat count and the n in n-of-n. A capacity above the co-sign threshold is
 *   deliberately unrepresentable, so the directory can never advertise a seat that never
 *   fills once the cohort locks at the threshold (F1a/F1b, refines D-11/D-19).
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

/**
 * The exact UI-SPEC validation string for the single cohort-size floor; the browser
 * mirrors this copy so the operator sees the same message client-side and server-side.
 */
const SIZE_ERROR = 'Cohort size must be at least 1 signer.';

/**
 * Untrusted create-form body: beacon type + a single cohort size n. A cohort has ONE
 * size that is both the seat count and the n in n-of-n; a capacity above the co-sign
 * threshold is deliberately unrepresentable (F1b), so there is no separate capacity field.
 */
export interface DraftInput {
  beaconType: string;
  size: number;
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
  /**
   * `'draft'` for an un-advertised draft, `'advertised'` once live in the directory,
   * `'expired'` for a terminal record whose advertised cohort's completion rejected
   * (stall / TTL / stop). An expired cohort is retained and surfaced to the operator
   * (never silently deleted) but is NOT a participant-directory entry (F2).
   */
  state: 'draft' | 'advertised' | 'expired';
  /**
   * A short human-readable reason a cohort expired, present ONLY on `state: 'expired'`
   * rows (e.g. the rejection message from the completion promise). Absent for drafts /
   * advertised cohorts.
   */
  reason?: string;
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
  /**
   * Re-advertise an EXPIRED cohort (F2). Re-runs `runner.advertiseCohort` with the
   * retained config (a SECOND operator-driven advertise call site, consistent with
   * D-17), moving it out of the terminal record set and back into the live/advertised
   * set with a fresh cohort id. Returns the advertised DTO, or `undefined` for an
   * unknown/absent terminal id (route 404).
   */
  readvertiseExpired(cohortId: string): OperatorCohortDTO | undefined;
  /**
   * Drafts (state 'draft') plus advertised cohorts (state 'advertised') plus expired
   * terminal records (state 'expired'), for the operator list. Expired records are
   * operator-only (never in {@link directory}).
   */
  listCohorts(): OperatorCohortDTO[];
  /** Public: the open/joinable cohorts derived from the live set (D-14/D-15). */
  directory(): DirectoryCohortDTO[];
  /** Public: up / active network / open-cohort count, reusing {@link directory} (D-09). */
  status(): ServiceStatusDTO;
}

/**
 * Validate a create-form body into a `{ beaconType, size }` pair.
 * Guard-clause style (index.ts / shared house style): throws on the first problem with
 * a user-facing message the route surfaces verbatim as the 400 body. There is a single
 * cohort size n (no separate capacity), so a cohort where capacity exceeds the co-sign
 * threshold is unrepresentable (F1b). The size message is the exact UI-SPEC validation
 * string so the server and the browser agree on the copy the operator sees.
 */
function validateDraft(input: DraftInput): { beaconType: BeaconType; size: number } {
  const { beaconType, size } = input;
  if (typeof beaconType !== 'string' || !KNOWN_BEACON_TYPES.has(beaconType)) {
    throw new Error(`operator: unknown beacon type "${String(beaconType)}" (expected CASBeacon or SMTBeacon)`);
  }
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(SIZE_ERROR);
  }
  return { beaconType: beaconType as BeaconType, size };
}

/**
 * Build the per-service operator cohort surface. `drafts` is closure state keyed by a
 * fresh CSPRNG draft id; each entry keeps both the built {@link CohortConfig} (so plan
 * 03 can hand it straight to the runner on advertise) and the operator-facing
 * {@link OperatorCohortDTO}.
 */
/**
 * Upper bound on retained expired cohort records (mirrors the dashboard MAX_COHORTS
 * bound). Past this cap the OLDEST expired record is evicted so an operator advertising
 * and expiring many cohorts cannot grow the terminal map without limit (T-06-02, DoS).
 */
const MAX_TERMINAL = 24;

export function createOperatorCohorts(opts: OperatorCohortsOptions): OperatorCohorts {
  const { runner, activeNetwork, recoveryKey } = opts;
  const drafts = new Map<string, { config: CohortConfig; dto: OperatorCohortDTO }>();
  // Enrichment ONLY (D-15): keyed by the LIVE cohort id, holds the config each cohort
  // was advertised with so `directory()` can surface threshold/capacity/beaconType
  // without re-reading them off the runner. Membership + openness always come from
  // `runner.session.cohorts` + the phase filter; this map is pruned on a successful
  // completion so it can never make the directory outlive the live set (Pitfall 5).
  const advertised = new Map<string, CohortConfig>();
  // Terminal records (F2): keyed by the cohort id whose completion REJECTED, holds the
  // retained config + a short reason so an expired cohort is surfaced to the operator
  // (via `listCohorts`) and can be re-advertised, instead of silently vanishing. Bounded
  // to MAX_TERMINAL with oldest-first eviction (Map preserves insertion order). NEVER
  // read by `directory()`/`status()`, so an expired cohort is operator-only (T-06-03).
  const terminal = new Map<string, { config: CohortConfig; reason: string }>();

  /** Coerce a completion rejection to a short, operator-facing reason string. */
  function reasonString(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return message.length > 0 ? message : 'cohort expired';
  }

  /** Record an expired cohort, evicting the oldest terminal record past the cap. */
  function rememberTerminal(cohortId: string, config: CohortConfig, reason: string): void {
    terminal.set(cohortId, { config, reason });
    while (terminal.size > MAX_TERMINAL) {
      const oldest = terminal.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      terminal.delete(oldest);
    }
  }

  /**
   * Settle a live cohort's completion promise (D-15, Pitfall 5). On SUCCESS the
   * enrichment entry is pruned (a completed cohort legitimately leaves the open set, no
   * terminal record). On REJECTION (stall / TTL / stop) the retained config is moved
   * into the bounded `terminal` set as an expired record with a reason (F2), so the
   * cohort is surfaced to the operator rather than silently deleted. Fire-and-forget
   * like the index.ts side-effect listeners: the trailing `.catch` swallows so a failed
   * cohort never surfaces as an unhandled rejection.
   */
  function settleCompletion(cohortId: string, completion: Promise<unknown>): void {
    void completion
      .then(
        () => {
          advertised.delete(cohortId);
        },
        (err) => {
          const config = advertised.get(cohortId);
          advertised.delete(cohortId);
          if (config) {
            rememberTerminal(cohortId, config, reasonString(err));
          }
        },
      )
      .catch(() => {
        /* defensive: settlement is total, but never let a stray rejection escape. */
      });
  }

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
      const { beaconType, size } = validateDraft(input);
      // Build on the SERVICE active network (D-10). `minParticipants` is the n-of-n
      // threshold; pin `maxParticipants` = the SAME size so min === max === n. This is an
      // exact n-of-n cohort with no unfillable seat: the cohort locks the instant it
      // reaches n, and n seats is exactly what the directory advertises (F1a/F1b, refines
      // D-11/D-19).
      const config = buildCohortConfig(size, beaconType, activeNetwork, recoveryKey);
      config.maxParticipants = size;
      const draftId = randomUUID();
      const dto: OperatorCohortDTO = {
        draftId,
        beaconType,
        network: activeNetwork,
        threshold: size,
        capacity: size,
        joined: 0,
        state: 'draft',
      };
      drafts.set(draftId, { config, dto });
      console.log(`[operator] created draft ${draftId} (${beaconType} ${size}-of-${size})`);
      return dto;
    },

    advertiseDraft(draftId: string): OperatorCohortDTO | undefined {
      const entry = drafts.get(draftId);
      if (!entry) {
        return undefined;
      }
      // One of only TWO `runner.advertiseCohort` call sites in the app (D-17), both
      // operator-driven (the other is `readvertiseExpired`): the boot-time perpetual
      // auto-advertise loop is gone, so a cohort only ever comes into existence when the
      // operator explicitly advertises (or re-advertises) - this does not reintroduce
      // the removed loop.
      const { cohortId, completion } = runner.advertiseCohort(entry.config);
      advertised.set(cohortId, entry.config);
      drafts.delete(draftId);
      // Settle the completion: prune on success, retain an expired terminal record on
      // rejection so the cohort is surfaced to the operator instead of silently deleted
      // (D-15, Pitfall 5, F2).
      settleCompletion(cohortId, completion);
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

    readvertiseExpired(cohortId: string): OperatorCohortDTO | undefined {
      const record = terminal.get(cohortId);
      if (!record) {
        return undefined;
      }
      // The SECOND (and only other) operator-driven `runner.advertiseCohort` call site
      // (D-17). Re-run the advert with the retained config, wire the SAME settlement on
      // the fresh cohort id, and drop the old expired record.
      const { cohortId: newCohortId, completion } = runner.advertiseCohort(record.config);
      advertised.set(newCohortId, record.config);
      terminal.delete(cohortId);
      settleCompletion(newCohortId, completion);
      console.log(`[operator] re-advertised expired cohort ${cohortId} as ${newCohortId}`);
      return {
        draftId: newCohortId,
        beaconType: record.config.beaconType as BeaconType,
        network: activeNetwork,
        threshold: record.config.minParticipants,
        capacity: record.config.maxParticipants ?? record.config.minParticipants,
        joined: 0,
        state: 'advertised',
      };
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
      // Expired terminal records (F2), operator-only: surfaced here so the operator sees
      // a cohort that expired (and can re-advertise it) instead of it silently vanishing;
      // NEVER in `directory()`/`status()`, so a participant never sees it (T-06-03).
      const expiredDtos: OperatorCohortDTO[] = [...terminal.entries()].map(([cohortId, record]) => ({
        draftId: cohortId,
        beaconType: record.config.beaconType as BeaconType,
        network: activeNetwork,
        threshold: record.config.minParticipants,
        capacity: record.config.maxParticipants ?? record.config.minParticipants,
        joined: 0,
        state: 'expired',
        reason: record.reason,
      }));
      return [...draftDtos, ...advertisedDtos, ...expiredDtos];
    },

    directory,

    status(): ServiceStatusDTO {
      // Reuse `directory()` for the open-count so the public number and the directory
      // are the SAME source and cannot drift (D-09).
      return { up: true, network: activeNetwork, openCohorts: directory().length };
    },
  };
}
