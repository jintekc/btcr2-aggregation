# Known upstream library limits

This repository is a reference CONSUMER of the published `@did-btcr2/*` packages, not a fork
(see `.planning/REQUIREMENTS.md`, "Out of Scope"). So when the library behaves in a way that
shapes how a real cohort must be run, the honest response here is an app-side workaround plus a
written record, never a patched dependency.

This page is that record. Each entry states what was observed, the pinned version it was observed
against, and what this repository does about it.

**Filing these upstream is still QUEUED and is not done by this phase.** The list below is the
batch to file against `@did-btcr2/aggregation` and `@did-btcr2/method`. Nothing here is a defect
in this application.

Pinned versions in use: `@did-btcr2/aggregation@0.4.0`, `@did-btcr2/method@0.51.0`.

---

## 1. The HTTP transport holds a single advert slot

**Observed** (`@did-btcr2/aggregation@0.4.0`, `HttpServerTransport`): publishing an advert
overwrites one slot rather than appending to a set. A newly connected advert subscriber is replayed
only that single current advert, and the stop closure returned at publish time clears the slot when
the owning cohort's advert loop stops. Disposing a stopped cohort runs exactly that closure.

**Effect on a running service:** with two cohorts open, settling the one that owns the slot leaves
the other listed in the directory and unjoinable. A participant picks it, opens the advert stream,
receives nothing, and waits, because nothing has failed.

**App-side workaround:** every settle path (cancel, signing completion, failure) re-publishes the
newest still-open cohort's advert, rebuilding the library's own advert message and re-installing it
through the transport. The republisher tracks slot ownership so that only the owner's settle
triggers a repair; re-publishing over a LIVE advert would hand already-seated participants a
duplicate their runner rejects as an invalid phase. Recorded as decision 2 in
[ADR 0017](adr/0017-runtime-lifecycle-control.md), proven by the two-cohort `pnpm e2e:cancel` leg.

**Operator guidance:** none needed any more. Before this repair existed, the guidance was to avoid
advertising a second cohort before the first had filled.

## 2. There is no per-seat release API

**Observed** (`@did-btcr2/aggregation@0.4.0`, `AggregationServiceRunner`): the runner exposes
`stopCohort`, `triggerFallback`, and a whole-runner `stop()`. There is no primitive that releases
one seat, removes one participant, or reopens a cohort for a replacement. This is the limit
Phase 5 adds to this list, after re-parking active seat reclaim for the second time.

**Effect on a running service:** an operator watching a cohort stall one seat short of full has no
targeted remedy. Nothing can free the abandoned seat.

**App-side workaround:** none is possible, so the console does not pretend. The drill-down states
the real workaround in a SENTENCE rather than offering a control: cancel the cohort and
re-advertise it, alongside the existing discovery-window reclaim. A control that could only fail
would be worse than the honest sentence.

**Filing note:** the enhancement request is "release a single seat and reopen the cohort for a
replacement, without dropping the cohort's state machine".

## 3. A seat is never released when a participant abandons it

**Observed** (`@did-btcr2/aggregation@0.4.0`): once a participant is seated, closing or reloading
its browser tab does not free the seat. The runner has no liveness check on a seated member, and
per limit 2 there is no API to release one.

**Effect on a running service:** a participant who reloads mid-cohort abandons their seat with no
way to reclaim it, and the cohort can never fill.

**App-side workaround:** the participant UI carries a keep-this-tab-open warning at the point where
the seat is taken. On the operator side, the remedy is limit 2's: cancel and re-advertise. The
discovery window bounds how long a half-filled cohort sits there.

## 4. A duplicate or surplus opt-in is dropped silently

**Observed** (`@did-btcr2/aggregation@0.4.0`, surfaced during the Phase 4 live walkthrough): an
opt-in carrying a key that is already seated is dropped with no rejection message reaching the
sender, and so is an opt-in that arrives after every seat is filled. The participant sees nothing
at all, not an error.

**Effect on a running service:** importing a duplicate secret, or losing a race for the last seat,
produces no visible seat and no visible reason.

**App-side workaround:** app-authored copy fills the gap the protocol leaves. A browser that is
never seated once the cohort locks with every seat filled gets the honest "the cohort locked with
all N seats filled and this browser was not seated; it may have filled without you, or your seat
confirmation was lost" line rather than a generic stall. The operator-facing guidance is to create
each identity fresh per session.

## 5. The advert repeat interval argument is ignored

**Observed** (`@did-btcr2/aggregation@0.4.0`, `HttpServerTransport.publishRepeating`): the
`intervalMs` argument is accepted and not used. The transport does not re-publish on a timer; it
holds the current advert until it expires or is replaced.

**Effect on a running service:** setting a repeat interval has no effect, so a service cannot rely
on periodic re-advertisement to reach a late subscriber.

**App-side workaround:** the advert replay window is instead equalized with the operator's
discovery window by threading the transport's advert TTL (Phase 4), and the app passes `0` for the
interval as the honest value rather than a number that implies a behavior. Late subscribers are
served by the transport's replay of the current slot, which is why limit 1's repair matters.

## 6. Envelope skew outside a 60 second window is rejected as a replay

**Observed** (`@did-btcr2/aggregation@0.4.0`): a protocol envelope whose timestamp differs from the
receiver's clock by more than about 60 seconds is rejected as a replay.

**Effect on a running service:** a participant machine whose clock has drifted more than a minute
cannot join at all, and the rejection reads as a protocol error rather than a clock problem.

**App-side workaround:** none in the app; this is a genuine anti-replay property and narrowing it
would weaken a security control. It is documented here so an operator debugging an inexplicable
join failure checks clock sync early.

## 7. Coin selection is deepest-first with only a dust floor

**Observed** (`@did-btcr2/method@0.51.0`, `selectSpendableUtxo`): selection prefers the deepest
(oldest confirmed) coin at the address and applies only a dust floor. It cannot skip an inadequate
older coin in favour of an adequate newer one.

**Effect on a running service:** a below-minimum FIRST payment to a cohort beacon address
permanently dead-ends that address. A later top-up confirms shallower and is never selected, so
topping up cannot fix it; the only way out is re-creating the cohort on a fresh address.

**App-side workaround:** the operator console shows ONE suggested minimum, computed by the same
predicate the builder will actually check, and the funding stage detects the dead-end and says so
plainly ("topping up cannot fix this") rather than waiting forever. `docs/DEPLOY.md` states the
one-clean-payment rule at the point of funding.

**Filing note:** the enhancement request is "prefer the deepest ADEQUATE utxo above a
caller-supplied floor".

---

## Where these came from

Limits 1 and 5 were verified by reading the pinned transport and runner sources during Phase 5
research. Limits 3, 4, 6, and 7 were surfaced by the owner-run Phase 4 live walkthrough against a
real regtest chain and were first recorded in
`.planning/phases/04-operator-cohort-monitoring/04-LIVE-UAT-CHECKLIST.md`. Limit 2 is added by
Phase 5, which re-parked active seat reclaim on exactly this ground.
