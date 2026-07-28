# Phase 5: Deferred Items

Out-of-scope discoveries logged during execution. Each was found while working on a plan in
this phase but is not that plan's concern; none is fixed here.

## The advert slot is also cleared when a cohort FILLS, not only when it settles

**Found during:** 05-01 Task 2 (advert-slot repair)
**Where:** `@did-btcr2/aggregation@0.4.0` `service-runner.ts` calls `#stopAdvertRepeating(ctx)`
at `keygen-complete` (a filled cohort stops advertising), in addition to the three settle
paths (`stopCohort`, `#completeCohort`, `#failCohort`) that run it via `#disposeCohort`.

**Consequence:** the same single-advert-slot defect 05-01 repairs on the settle paths also
fires when a cohort simply FILLS its last seat. With cohorts A and B open and B most recently
advertised, B reaching its nth seat empties the transport's advert slot, so A stays in the
public directory yet a freshly connecting participant receives no `COHORT_ADVERT` for it.

**Why it was not fixed in 05-01:** the plan scopes the repair to the settle paths explicitly
("cancel, signing-complete, cohort-failed"), and `repairAdvertSlot` currently runs inside the
completion settlement, where `operator-cohorts.ts` registers no runner listeners at all.
Covering the fill case means subscribing to `keygen-complete` there, which is a wider change
than the cancel tracer, and its blast radius (an extra advert delivered to already-seated
participants, whose runner then rejects a re-join) deserves its own plan and its own test.

**Suggested home:** a later Phase 5 plan that already touches the lifecycle wiring, or Phase 6.
The repair machinery (`advert-republish.ts` plus `repairAdvertSlot`) is already in place; only
the additional trigger and its slot-ownership bookkeeping would be new.
