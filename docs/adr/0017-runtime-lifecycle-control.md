# ADR 0017: Runtime lifecycle control - declared intent, a repaired advert slot, and settings that do not persist

- Status: Accepted
- Date: 2026-07-29
- Milestone: v1 Phase 5 (Operator Cohort Lifecycle Control; SVC-04, SVC-05, PART-05, PART-06)
- Amends: ADR 0016 (the polled monitoring read model; see below). Supersedes nothing.

## Context

Phase 5 gives the operator real control over a running service: cancel a cohort, finalize a
stalled signing round, pause advertising, edit a draft, change service defaults, turn the
money-moving broadcast leg off, and set participation terms, all without restarting the process.

Five of the decisions taken to build that are the kind a later phase undoes by accident, because
each one looks like an unnecessary indirection until you know the library behavior that forced it.
This ADR records those five with their reasons, so that a future change either meets the stated
rationale or is a deliberate reversal rather than an unwitting one.

Everything below was verified against the pinned libraries this repository consumes,
`@did-btcr2/aggregation@0.4.0` and `@did-btcr2/method@0.51.0`. This is a consumer application,
not a fork (REQUIREMENTS.md "Out of Scope"), so every workaround here is app-side by construction.

## Decision

### 1. Declare intent, then stop. Never classify a terminal cause from an error message.

A cohort's fate is written into a per-service intent registry
(`packages/service/src/cohort-intent.ts`) BEFORE the library call that ends it, and both fate
consumers (the operator cohort list's `settleCompletion` and the monitoring fold) read that
registry rather than the rejection they receive.

**Why.** `runner.stopCohort(cohortId)` emits no event at all: it marks the context settled,
disposes the cohort, removes it from the session, and rejects the cohort's completion promise.
There is nothing a listener could subscribe to, in contrast with the runner's own internal
failure path, which does emit. So a stopped cohort would simply vanish from the console unless
the app records the fact itself.

Worse, the completion rejection is not a usable discriminator. The whole-runner `stop()` used at
shutdown rejects every cohort's completion through the same channel, and an ordinary stall
rejects there too. Matching on the rejection message (`/stopped/`) would therefore narrate a
service shutdown, or an unrelated failure, as a deliberate operator cancel.

**Consequence.** Classifying a terminal cause by matching on error message text is forbidden in
this codebase. Any future verb that ends a cohort deliberately declares its intent first and adds
a member to the intent type; it does not add a regex. The per-draft discovery window is already
the second consumer of the same seam, declaring `window-expired` rather than inventing its own
signal, and a canceled cohort therefore gets its own `canceled` fate in the ended taxonomy rather
than being filed as `expired` with a machine string for a reason.

The same discipline governs the participant side. The participant's `terminalReason` classifier
takes a required `canceled` boolean, checked above every message-text branch, fed from the narrow
anonymous `GET /v1/cohort-fate/:id` read. It is required rather than optional so that a forgotten
call site is a compile error instead of a wrong sentence shown to a stranger.

### 2. Repair the advert slot after every settle.

Every path by which a cohort leaves the live set (cancel, signing completion, failure) re-publishes
the newest still-open cohort's advert, and the republisher tracks which cohort currently owns the
slot so that only the owner's settle triggers a repair.

**Why.** The HTTP server transport holds exactly ONE advert slot. Publishing overwrites it, a new
SSE subscriber is replayed only that single current advert, and the stop closure returned at
publish time clears the slot when the owning cohort's advert loop stops, which is precisely what
disposing a stopped cohort does.

Compose those three facts and canceling cohort A, advertised most recently, leaves cohort B listed
in the directory and unjoinable: a participant picks B, opens the advert stream, receives nothing,
and the UI sits waiting because nothing failed. That was a latent defect before this phase. Cancel
would have promoted it from a rare race into a button.

**Consequence.** The repair rebuilds the library's own `createCohortAdvertMessage` and re-installs
it through `transport.publishRepeating`, because `session.advertise` cannot be re-called once the
cohort leaves its created phase. It is guarded and fire-and-forget, matching every other side
effect in `index.ts`: an advert repair failure must never disturb the protocol. It must NOT
re-publish over a live advert, because handing already-seated participants a duplicate advert makes
their runner reject it as an invalid phase, which is why the owner check exists rather than a blind
re-publish. The proof is a two-cohort hermetic end-to-end leg (`pnpm e2e:cancel`) that seats a
FRESHLY constructed participant in the sibling cohort; a single-cohort test passes while the defect
is live.

### 3. Environment seeds, runtime overrides, no persistence.

Service settings follow one model: an environment variable seeds the boot value, the console edits
the in-memory value behind a gated route, and a restart returns every value to its environment
default. Each field is served with its own `envDefault` and a `changed` bit derived per read, so
the console labels a value by its SERVED source rather than by a comparison the browser makes
against a boot value it was never told.

**Why persistence is deliberately absent.** This service keeps all cohort state in memory on a
single box (ADR 0014), and every surface says so. A settings file on disk would make some state
durable and the rest not, which changes the product's stated state model without anyone having
decided to. Durability is a requirement (DUR-01, v2), and it belongs to whichever phase takes it
on deliberately, together with cohort state.

**Consequence.** `packages/service/src/runtime-settings.spec.ts` PINS the absence of a persistence
path at the source, because the console's honest "a restart returns these to the environment" copy
is only true while the module stays free of the filesystem and the artifact store. Adding a quiet
write path is therefore a test failure, not a silent behavior change. The holder is per-service and
never a module singleton, and `GET /v1/config` reads the service name from it PER REQUEST: a boot
constant captured into the app closure would serve the old name forever while the console claimed
the rename had applied.

The next-cohort-only rule falls out of the same model. `createDraft` reads the holder exactly once,
into that draft's own config, and nothing re-reads it afterwards. An advertised cohort's shape is
public and its seats may be filling, so it is immutable by construction rather than by discipline.

### 4. The broadcast switch is one-way within a session.

The console can turn the broadcast leg OFF for new cohorts. It cannot turn it back on. Re-enabling
is a boot-environment act.

**Why.** ADR 0010 makes every path that can move Bitcoin a layered, explicit, environment-level
opt-in. Runtime power over that path may therefore point only toward safety. A console control
that could re-enable money movement would move the opt-in from the deployment into the browser
session, which is exactly the layering ADR 0010 exists to hold.

**Consequence.** The one-way property is SEARCHED for, not merely documented: the specification
enumerates the settings holder's own surface and the app's registered routes and pins both, so a
future `enableBroadcast` fails the suite the moment it is written. The switch also does not mutate
the service's boot mode, which the monitor derives once at construction: the health strip keeps
reporting the live mode it really booted with (its chain reads really are still live) and a
separate warn chip states that broadcast is off for this session.

In-flight cohorts finish under the mode they started with. That is decided by comparing each
cohort's advertise timestamp against the moment the switch engaged, and the engage stamp is taken
once and never moved, because a second click that slid the pivot would silently re-enable the
cohorts advertised in between. The rule is consulted at BOTH beacon-tx handoffs, the data handoff
that chooses the real builder or the fixture and the broadcast handoff itself, so a switched-off
cohort is genuinely created on the fixture path rather than merely left unpublished, and it fails
closed for a cohort with no advertise stamp.

### 5. A per-cohort discovery window can only shorten.

An operator may set a discovery window on a draft. A value above the runner-level cohort lifetime
is REFUSED at save, with the real service maximum named in the message.

**Why.** No timing value in `aggregation@0.4.0` is per-cohort. The cohort lifetime and the phase
timeout are per-runner constructor options, armed once per cohort at advertise and never reset;
the advert repeat interval is per-runner and is ignored by the HTTP transport anyway; the advert
TTL is per-transport. So the app can only ever cut a cohort SHORT of the runner's lifetime, and a
longer value is a promise the service cannot keep.

**Consequence.** Enforcement is an app-side timer that declares `window-expired` into the intent
registry of decision 1 and only then calls `stopCohort`. The timer is unref'd, bounded,
stop-signal-aborted, and cleared on all three settle paths, so it can never fire against a reused
id. A requested window above the ceiling is refused rather than silently truncated or silently
accepted, because both of those would leave the operator believing a window that is not in force.
Only a SUPPLIED window is measured against the ceiling, and the same ceiling applies to the
service-level default, because a default above the runner lifetime would hand an unenforceable
window to every draft that inherits it.

The funding window is genuinely different and is unaffected: it is app-owned, so a real per-cohort
value works there, and it still obeys the ADR 0016-era clamp of `min(window, remaining lifetime
minus slack)` with its own specific reason thrown before either library timer.

## Consequences

- **Fates are facts the app recorded, not strings it parsed.** Cancel, window expiry, completion,
  and failure are distinguishable by construction, and the participant-facing narration of a cancel
  can never be produced by a stall, an expiry, or a shutdown.
- **The directory and the advert stream cannot disagree after a settle.** Whatever the directory
  lists as open is advertised, because the slot is repaired on every settle path.
- **A restart is the documented reset.** Pause, the broadcast switch, and every runtime setting
  live in memory for the session. This is stated in `docs/DEPLOY.md`, in the console, and here.
- **Runtime power points one way.** Nothing in the console can enable money movement, widen a
  discovery window past what the runner will honor, or reshape a cohort that is already public.
- **Four hermetic end-to-end legs join the gate** (`e2e:cancel`, `e2e:pause`, `e2e:testpeers`,
  `e2e:fallback:operator`), each proving its property from the OUTSIDE, where a gated-side
  assertion would look identical whether or not the defect were live.

## Amendment to ADR 0016 (the polled monitoring read model)

This ADR AMENDS ADR 0016. It does not supersede it, and it introduces NO new event-stream channel.

Every lifecycle fact this phase adds rides the reads ADR 0016 already established. The operator
actions log is a bounded, service-level ring delivered as an additive sibling key on the EXISTING
gated monitoring poll, not a second channel. The canceled fate joins the same bounded ended-record
set, captured at event time for the same reason ADR 0016 gives (the runner garbage-collects a
cohort's session state on completion, so a fold that read the session lazily would find nothing).
The paused bit rides the public `GET /v1/status` read, and the participant's cancel attribution
rides one narrow anonymous read called ONCE after a terminal state has already landed, adding no
poll loop.

The public `DirectoryCohortDTO` stays byte-frozen. `ServiceStatusDTO` gained the paused bit, and
every committed pin of it was migrated in the same change, which is the discipline ADR 0016's own
retirement established.

## Alternatives considered

- **Classify the terminal cause from the completion rejection.** Rejected: the whole-runner stop
  and an ordinary stall reject through the same channel, so a shutdown would be narrated as an
  operator's deliberate act. See decision 1.
- **A "close cohort" button.** Rejected (D-01). There is no close primitive, and there could not
  usefully be one: seats are min == max == n, so the nth seat both locks the roster and starts
  keygen, and a partially filled n-of-n cohort that stopped accepting joins could never anchor.
  Closing is narrated as an automatic stage derived from the served seat counts, with no server
  flag and no control. Offering a button would be a synthetic state.
- **A per-seat reclaim or kick control.** Rejected, re-parked upstream (D-18): `aggregation@0.4.0`
  has no seat-release API at all, so the honest surface is a SENTENCE naming the real workaround
  (cancel and re-advertise, alongside the existing lifetime reclaim), not a control that could only
  pretend. See `docs/UPSTREAM-LIMITS.md`.
- **Persist runtime settings to disk.** Rejected: see decision 3. It would make part of the state
  durable while cohorts stay in memory, changing the product's stated model by accident.
- **A reversible in-session broadcast switch.** Rejected on ADR 0010 grounds: see decision 4.
- **Silently truncate an over-long discovery window to the ceiling.** Rejected: the operator would
  believe a window that is not in force. Refuse at save and name the real maximum. See decision 5.
- **Protocol-level enforcement of participation terms.** Not available. The aggregation protocol
  carries no message type that could hold an acceptance, and a client speaking the protocol
  directly opts in with no app involvement. The enforcement boundary is app-level and is stated
  plainly in the console, in the participant copy, and in `docs/DEPLOY.md`, rather than implied
  away.

