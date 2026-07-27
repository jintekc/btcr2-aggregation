/**
 * The cohort-lifecycle phase sets, as ONE cross-package source of truth (review WR-05).
 *
 * The library's `AggregationServiceRunner` reports a cohort's phase as a plain string. Four
 * separate surfaces classify that string, and `monitor.ts` states outright that they "MUST stay in
 * lockstep or the console contradicts the public directory":
 *
 * - `packages/service/src/operator-cohorts.ts` - the public `/v1/directory` DISPLAY filter and the
 *   `/v1/status` open count.
 * - `packages/service/src/monitor.ts` - the operator summary chip and the service metrics.
 * - `packages/web/src/lib/directory.ts` - the plain-language directory label.
 * - `packages/web/src/components/operator/OperatorStageTimeline.tsx` - the drill-down stage.
 *
 * They had drifted: the timeline's copy omitted the four funding-wait phases the other three were
 * deliberately widened to include (the SVC-JOIN-2 fix), so on a hermetic cohort sitting in
 * `Validated` / `UpdatesCollected` / `DataDistributed` the drill-down's primary visual anchor
 * reported the cohort was still collecting Submissions while it was actually mid-signing. Nothing
 * pinned the copies equal, and the two specs that touched them each re-declared their own literal
 * array, so a fifth copy drifting would also have gone green.
 *
 * Kept as plain string members (not the library's enum) for the same reason each local copy was:
 * this app does not depend on the library's phase enum value shape.
 *
 * Lives in `@btcr2-aggregation/shared` because that is already the home of the cross-package
 * network/cohort vocabulary every one of these four surfaces imports.
 */

/**
 * Phases in which a cohort is still discovering or gathering participants: the joinable,
 * pre-signing tier. This is the set the public open COUNT narrows to (`/v1/status`), the set the
 * operator summary reads as `filling`, and the tier the JOIN gate stays within.
 *
 * Widening this widens what is joinable and counted, which is NOT the same decision as widening
 * what is displayed - see {@link IN_FLIGHT_PHASES}.
 */
export const OPEN_PHASES: ReadonlySet<string> = new Set<string>([
  'Advertised',
  'CohortSet',
  'CollectingUpdates',
]);

/**
 * The in-flight (post-seat, pre-terminal) phases: a cohort that has locked its roster and is
 * working through the signing arc. Displayed as a non-joinable "In progress" directory row, read
 * as the `co-signing` chip by the operator summary, counted as `inFlight` by the service metrics,
 * and placed at the Co-signing stage by the drill-down timeline.
 *
 * The set spans the WHOLE mid-signing arc, not just the MuSig2 nonce/partial-sig rounds:
 * `UpdatesCollected`, `DataDistributed`, `Validated`, and `FallbackRequested` are the phases a
 * cohort sits in during the live funding wait (the library calls `onProvideTxData` from them).
 * Omitting them made the `/v1/directory` row VANISH for the entire funding window, so a seated
 * participant's post-seat poll saw the cohort go dark and false-failed it as "ended" after ~10s
 * (the SVC-JOIN-2 live-UAT killer), and made the monitor assign no chip at all, so the
 * `needs-funding` attention nudge never fired exactly when it mattered.
 *
 * These are never in {@link OPEN_PHASES}, so widening what is SHOWN never widens what is joinable
 * or counted (D-09/D-26).
 */
export const IN_FLIGHT_PHASES: ReadonlySet<string> = new Set<string>([
  'SigningStarted',
  'NoncesCollected',
  'AwaitingPartialSigs',
  'UpdatesCollected',
  'DataDistributed',
  'Validated',
  'FallbackRequested',
]);

/**
 * The DISPLAY set for the public directory: the joinable {@link OPEN_PHASES} PLUS the in-flight
 * {@link IN_FLIGHT_PHASES}. `directory()` filters on THIS union so in-flight cohorts stay listed
 * (D-26) while the joinable gate stays Advertised-tier only.
 */
export const DISPLAY_PHASES: ReadonlySet<string> = new Set<string>([...OPEN_PHASES, ...IN_FLIGHT_PHASES]);
