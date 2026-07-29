---
phase: 05-operator-cohort-lifecycle-control
plan: 14
subsystem: phase-capstone-documentation
tags: [adr, deploy-docs, upstream-limits, uat-checklist, hermetic-gate, docker-compose]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plans 01 through 13)
    provides: every control, route, setting, and end-to-end leg this plan records and documents
  - phase: 04-operator-cohort-monitoring (plan 08)
    provides: ADR 0016 (the read model ADR 0017 amends), the going-live DEPLOY section, and the six known upstream limits lifted into their own document
provides:
  - docs/adr/0017-runtime-lifecycle-control.md - the architectural record for the intent registry, the advert-slot repair, the env-seeds settings model, the one-way broadcast switch, and the shorten-only discovery window
  - docs/UPSTREAM-LIMITS.md - seven consolidated upstream library limits, each with its observed behavior, pinned version, and app-side workaround
  - the Phase 5 sections of docs/DEPLOY.md - every runtime control, the restart model, and the participant-facing features an operator has to explain
  - six new environment variables documented in DEPLOY and mirrored into docker-compose.yml
  - pnpm e2e:gate - all thirteen hermetic end-to-end legs in one command
  - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md - the owner-facing verification checklist
affects: [phase 6 (HOST-02 stranger-to-stranger e2e, HOST-03 framing sweep), the queued upstream issue batch]

# Tech tracking
tech-stack:
  added:
    - "None. Documentation, one package.json script composed of existing scripts, and six compose entries. No source file changed."
  patterns:
    - "An ADR records the decisions a later phase could undo BY ACCIDENT, not every decision taken: each entry names the verified library behavior that forced it, so a reversal has to meet the reason"
    - "A documented environment variable is one an operator will actually find: it appears in the DEPLOY table AND in the compose file with the same default"
    - "Known upstream limits live in one referenceable document rather than inside a phase artifact that scrolls out of reach"
    - "A verification checklist states what the phase deliberately did NOT build, so the pass does not hunt for absent things and read their absence as a defect"
    - "A phase gate is one command, not a remembered list"

key-files:
  created:
    - docs/adr/0017-runtime-lifecycle-control.md
    - docs/UPSTREAM-LIMITS.md
    - .planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md
  modified:
    - docs/DEPLOY.md
    - docker-compose.yml
    - package.json

key-decisions:
  - "ADR 0017 AMENDS ADR 0016 rather than superseding it: every lifecycle fact this phase added rides the reads ADR 0016 already established (the operator actions log is an additive sibling key on the existing gated poll), and no new event-stream channel exists"
  - "The ADR records exactly five decisions, chosen by one test: would a later phase undo this by accident because the indirection looks unnecessary without the library fact behind it? Each entry therefore leads with the verified aggregation@0.4.0 / method@0.51.0 behavior, not with the design"
  - "Classifying a terminal cause by matching on error message text is written down as FORBIDDEN in this codebase, because the whole-runner stop and an ordinary stall reject through the same channel as a deliberate cancel"
  - "The absence of settings persistence is recorded as a decision with its reason (it would make part of the state durable while cohorts stay in memory, changing the product's stated model by accident), so a future write path has to argue against a stated rationale rather than merely being added"
  - "docs/UPSTREAM-LIMITS.md states at the top that filing upstream is still QUEUED and is not done by this phase, so the document cannot be mistaken for evidence that the batch was filed"
  - "No specific external wallet is named as compatible anywhere in docs/, because wallet interoperability for the exported PSBT was not verified in this environment (RESEARCH A1/A2); the checklist marks that leg NON-BLOCKING for the same reason"
  - "The convenience script is named e2e:gate and runs the thirteen hermetic legs the phase's automated verify names, rather than e2e:hermetic, which would have implied every hermetic leg in the repo and quietly left several out"

requirements-completed: [SVC-04, PART-05, PART-06, SVC-05]

coverage:
  - deliverable: "ADR 0017 records the five decisions a later phase could undo by accident"
    human_judgment: false
    verification:
      - kind: command
        ref: "test -f docs/adr/0017-runtime-lifecycle-control.md; grep -c 'intent' returns 7; grep -c 'cohort-intent' returns 1 (the key_links module reference)"
        status: pass
  - deliverable: "Every new environment variable is documented where an operator looks, and the compose file lists it with the same default"
    human_judgment: false
    verification:
      - kind: command
        ref: "per-variable grep parity across docs/DEPLOY.md and docker-compose.yml for DEFAULT_BEACON_TYPE, DEFAULT_SIZE, DEFAULT_THRESHOLD, DEFAULT_DISCOVERY_WINDOW_MS, DEFAULT_FUNDING_WINDOW_MS, TERMS_TEXT, SERVICE_NAME"
        status: pass
      - kind: command
        ref: "plan automated verify: grep -q TERMS_TEXT in both files"
        status: pass
  - deliverable: "No specific external wallet is named as compatible anywhere in docs/"
    human_judgment: false
    verification:
      - kind: command
        ref: "grep -rilE 'coldcard|sparrow|ledger' docs/ returns no files"
        status: pass
  - deliverable: "docs/UPSTREAM-LIMITS.md consolidates at least seven limits including the missing per-seat release API"
    human_judgment: false
    verification:
      - kind: command
        ref: "grep -c '^## [0-9]' docs/UPSTREAM-LIMITS.md returns 7; limit 2 is the per-seat release API added by this phase"
        status: pass
  - deliverable: "The whole hermetic gate is green at phase close, nothing weakened"
    human_judgment: false
    verification:
      - kind: command
        ref: "pnpm test (60 files, 969 tests pass)"
        status: pass
      - kind: command
        ref: "pnpm lint"
        status: pass
      - kind: command
        ref: "pnpm --filter @btcr2-aggregation/web build"
        status: pass
      - kind: command
        ref: "all thirteen e2e legs individually, then pnpm e2e:gate as one command"
        status: pass
  - deliverable: "The phase's owner-facing verification checklist covers each requirement and each ROADMAP success criterion"
    human_judgment: false
    verification:
      - kind: command
        ref: "13 top-level sections: four SVC-04 criteria, absorbed items, PART-05, PART-06, SVC-05, did-not-build, hermetic evidence, sign-off; NON-BLOCKING appears on the PART-06 external-wallet leg"
        status: pass
  - deliverable: "The documentation describes what actually ships, including its limits, and an operator can run every new control from it alone"
    human_judgment: true
    rationale: "Whether the DEPLOY prose is genuinely sufficient for a stranger who has not read the source, whether the honest-limit statements (app-level terms enforcement, the shorten-only window, the session-only settings, the one-way switch) read as candor rather than as hedging, and whether the ADR's reasons would actually stop a future phase from undoing a safety property, are judgments no grep makes. The HOST-03 posture (documenting only what ships) is a prohibition verified by judgment in the plan itself."
  - deliverable: "The owner's verification pass against 05-UAT-CHECKLIST.md"
    human_judgment: true
    rationale: "The plan's <human-check> is the phase's closing gate: run the service, work the checklist section by section. It cannot be automated (it is the judgment the hermetic legs deliberately do not make) and has NOT been run in this session. The four SVC-04 sections and the absorbed items are the phase core; the external-wallet leg of PART-06 is explicitly non-blocking."

# Metrics
duration: ~25 min
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 14: Phase Capstone, Documentation, and the Green Gate Summary

**Phase 5 closes with its five accidentally-undoable decisions written into ADR 0017 alongside the verified library behavior that forced each one, every runtime control and all six new environment variables documented where an operator will actually find them, seven upstream library limits consolidated into one referenceable document that says plainly the filing has not happened, and the whole hermetic gate green with no assertion touched.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-29
- **Tasks:** 2
- **Files:** 6 (3 created, 3 modified). No source file changed.

## Accomplishments

- **ADR 0017 records five decisions, chosen by one test.** Not "what did this phase decide" but "what would a later phase undo BY ACCIDENT, because the indirection looks unnecessary until you know the library fact behind it". Each entry therefore leads with the verified behavior: `stopCohort` emits nothing and rejects through the same channel as a whole-runner shutdown, so intent is declared out of band FIRST; the transport holds one advert slot, replays only that one, and clears it when the owner is disposed, so any settle can silently un-advertise a sibling; no timing value in `aggregation@0.4.0` is per-cohort, so a discovery window can only shorten. A reversal now has to meet the reason rather than merely look tidier.
- **"Classifying a terminal cause from error message text is forbidden" is now a written rule.** That is the load-bearing sentence of decision 1. The temptation is obvious and permanent (the rejection carries a `COHORT_STOPPED` code and a readable message), and the failure it produces is a service shutdown narrated to a stranger as a deliberate operator cancel.
- **The absence of settings persistence is recorded AS A DECISION, with its reason.** A future contributor adding a settings file would otherwise be closing an obvious gap. The ADR states why the gap is deliberate: it would make part of the state durable while cohorts stay in memory, changing the product's stated model without anyone deciding to, and `runtime-settings.spec.ts` already pins the absence at the source so the change is a test failure rather than a silent one.
- **The ADR amends rather than supersedes ADR 0016, and says which reads carry what.** The operator actions log rides the existing gated monitoring poll as an additive sibling key; the canceled fate joins the same bounded ended set; the paused bit rides `GET /v1/status`; the participant's cancel attribution is one narrow anonymous read called ONCE after a terminal state has already landed. No new event-stream channel exists, which is the property a later phase most plausibly breaks by reaching for SSE again.
- **DEPLOY now documents the runtime controls as an operator would meet them**, in an order that matches doing the job: cancel, finalize, the ABSENT close button (with why it is absent), drain-mode pause and specifically what it does not do, the settings surface and its two rules, the one-way broadcast switch and the fact that turning it back on is a restart, dismissal, and test peers as a solo rehearsal tool. A dedicated "What survives a restart" section answers the question the whole in-memory model provokes, in one place, rather than as a caveat attached to each control.
- **The participant-facing features are documented too, on the grounds that the operator is the one who gets asked.** The chain-endpoint override, including the CORS constraint stated as the thing that will actually generate support questions and distinguished from "unreachable"; the wallet PSBT path; and participation terms with the app-level enforcement boundary stated in its own paragraph rather than as a parenthetical.
- **No specific wallet is named as compatible, anywhere in `docs/`.** RESEARCH assumptions A1 and A2 are search-derived, not tested here. The DEPLOY text says the exported PSBT is standards-correct, that interoperability was not verified in this environment, and that a wallet refusing the data output is a support question rather than a defect. The checklist marks the same leg NON-BLOCKING.
- **`docs/UPSTREAM-LIMITS.md` lifts six limits out of a Phase 4 phase artifact and adds the seventh.** Each entry states the observed behavior, the pinned version, the effect on a running service, and the app-side workaround, plus a filing note where there is a concrete enhancement request. The missing per-seat release API is the one this phase adds, on the strength of re-parking active seat reclaim for the second time. The document states at the top that filing is still QUEUED and not done here, so it cannot be misread as evidence that the batch went out.
- **Six new environment variables are documented in the table AND mirrored into `docker-compose.yml` with the same defaults**, each compose entry carrying the same "editable at runtime, returns on restart, applies to new drafts only" framing so the compose file is not a second, thinner story. Parity was verified variable by variable rather than by the plan's single `TERMS_TEXT` grep.
- **The gate is green and one command.** `pnpm e2e:gate` runs the thirteen hermetic end-to-end legs in sequence. Every leg was run individually first and then through the script, so the script is proven as a composition rather than assumed.
- **The checklist says what the phase did NOT build.** Payments, notifications, contracts, per-seat reclaim, external co-sign, dual-read verification, extension wallets, routed URLs, durable state, an operator-side list of who accepted, and a close button. A verification pass that hunts for an absent thing and reads its absence as a defect is the failure this section exists to prevent.

## Task Commits

1. **Task 1: ADR 0017, the Phase 5 operator controls, and the consolidated upstream limits** - `2d17110` (docs)
2. **Task 2: the phase verification checklist and a one-command e2e gate** - `ccc9ca3` (docs)

## Files Created/Modified

- `docs/adr/0017-runtime-lifecycle-control.md` (new) - Status/Date/Milestone header with `Amends: ADR 0016` and an explicit `Supersedes nothing`; five numbered decisions each with a "Why" grounded in verified library behavior and a "Consequence" naming the guard that keeps it true; a Consequences section; a dedicated amendment section for ADR 0016; and eight alternatives considered, including the ones a reader is most likely to propose (a close button, per-seat reclaim, persisted settings, a reversible switch, silently truncating an over-long window, protocol-level terms).
- `docs/UPSTREAM-LIMITS.md` (new) - the single advert slot, the missing per-seat release API, no seat release on abandonment, the silent duplicate/surplus opt-in drop, the ignored advert repeat interval, the 60 second envelope-skew replay window, and deepest-first coin selection with only a dust floor. Closes with where each came from (source-verified during Phase 5 research versus surfaced by the Phase 4 live walkthrough).
- `docs/DEPLOY.md` - two new top-level sections ("Running the service: the operator's runtime controls" with eight subsections, "What survives a restart"), one more ("Participant-facing features you are hosting") with three subsections, and seven rows added or rewritten in the environment reference table.
- `docker-compose.yml` - six new environment entries with defaults and comments, and the `SERVICE_NAME` comment extended to name the runtime-edit model.
- `package.json` - one new script, `e2e:gate`.
- `.planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md` (new) - prerequisites and a boot recipe that deliberately seeds settings from the environment so the "environment default versus changed this session" labelling has real work to do; four SVC-04 criterion sections each ending with a "Reads true?" honesty block; an absorbed-items section covering all four; PART-05, PART-06, and SVC-05; the did-not-build section; a hermetic evidence table; and a sign-off.

## Decisions Made

- **The ADR records five decisions, not every decision.** Selection criterion: would a later phase undo this by accident? That is why the k-of-n finalize semantics, the ceremony ladder, and the fate taxonomy are not in it (they are visible in the code and in the plans), while the advert-slot repair is (it looks like dead weight until you know the transport holds one slot).
- **`Amends: ADR 0016`, and `Supersedes nothing`, stated explicitly.** ADR 0016 supersedes 0004; stating the negative here stops a reader inferring a chain.
- **The upstream-limits document says the filing is not done.** A consolidated list reads like a filed batch unless it says otherwise.
- **DEPLOY explains the CORS constraint as the participant-facing thing that will generate support questions**, and specifically notes that it is reported distinctly from "unreachable", because a support question misdiagnosed as a network fault is the practical cost of not distinguishing them.
- **The convenience script is `e2e:gate`, not `e2e:hermetic`.** The honest name for a list of thirteen legs is not a name that claims every hermetic leg in the repo, since `e2e`, `e2e:smt`, `e2e:x1`, `e2e:mixed`, `e2e:x1:negative`, `e2e:baked`, and `e2e:ipfs` are hermetic too and are not in it.
- **The checklist runs hermetically by default**, with the two genuinely live-only legs (the broadcast switch, live test peers) marked as such, so the phase's core is verifiable without a chain.

## Deviations from Plan

None. Both tasks executed as written, and nothing in the gate was red, so no fix was needed and no assertion was touched.

### Deliberate readings of the plan

- **Three e2e legs beyond the automated verify list were run and included in `e2e:gate`.** The plan's task action names nine shipped legs (operator, monitor, browse, k-of-n, fallback, live mock, resolve, config, persist) plus the four this phase added; the `<automated>` verify block names ten. `resolve`, `config`, and `persist` appear in the action but not the verify block. All thirteen were run and all thirteen are in the script, because the action's list is the one that describes the phase's dependencies.
- **Environment-variable parity was checked variable by variable, not by the plan's single `TERMS_TEXT` grep.** The acceptance criterion asks for "every new environment variable ... verified by grepping both files for each variable name", so all seven (the six new ones plus `SERVICE_NAME`, whose semantics changed to runtime-editable) were checked individually.
- **`SERVICE_NAME` was rewritten rather than left alone.** Its existing DEPLOY row said "Display text only; no edit surface", which this phase made false. Correcting a now-untrue line is the same obligation as documenting a new one.

## Issues Encountered

- **The owner's verification pass has NOT been run.** The plan's `<human-check>` is the phase's closing gate and requires a running service and a human working the checklist. Everything automatable was automated and is green; what remains is exactly the judgment the hermetic legs deliberately do not make. This is the expected end state for this plan, not a failure, but the phase is not verified until that pass happens.
- **Two live-only checklist legs need a chain.** The broadcast kill switch and the live-mode test-peer confirmation require a `LIVE=1 BROADCAST=1` boot against a real chain (Polar/regtest, as in the Phase 4 walkthrough). They are marked live-only in the checklist so a hermetic pass is not misread as covering them.
- **The upstream issue batch is still not filed.** Seven limits are now consolidated and referenceable, which was this phase's job; filing them against `@did-btcr2/aggregation` and `@did-btcr2/method` remains queued from Phase 4 and is called out at the top of the document so it cannot silently look done.
- **The rendered composition of every Phase 5 surface remains unverified by automated tests**, the carried gap recorded from 05-06 onward. The checklist is where those judgments now live, which is the right home for them, but it does not close the gap.
- **`packages/service/tests/test-peers.spec.ts` still contains an em-dash** from 05-09. Pre-existing, in a test file, outside this plan's grep scope (`docs/` and this phase's planning directory, both clean), and not touched here.

## Known Stubs

None. This plan wrote documentation and one script composed of existing scripts. Every control it documents was built and proven by an earlier plan in this phase, every limit it lists was observed against a pinned version, and every command in the evidence table was run in this session.

## Verification Results

| Check | Result |
|---|---|
| `pnpm test` (composite typecheck + full unit suite) | 60 files, 969 tests pass |
| `pnpm lint` | clean |
| `pnpm --filter @btcr2-aggregation/web build` | clean |
| `pnpm e2e:operator` | pass |
| `pnpm e2e:monitor` | pass |
| `pnpm e2e:cancel` | pass |
| `pnpm e2e:pause` | pass |
| `pnpm e2e:testpeers` | pass |
| `pnpm e2e:fallback` | pass |
| `pnpm e2e:fallback:operator` | pass |
| `pnpm e2e:browse` | pass |
| `pnpm e2e:kofn` | pass |
| `pnpm e2e:live:mock` | pass |
| `pnpm e2e:resolve` | pass |
| `pnpm e2e:config` | pass |
| `pnpm e2e:persist` | pass |
| `pnpm e2e:gate` (all thirteen as one command) | pass |
| Task 1 automated verify (both files exist, `TERMS_TEXT` in DEPLOY and compose, no wallet named in DEPLOY) | pass |
| Env-var parity, each of 7 in both `docs/DEPLOY.md` and `docker-compose.yml` | pass |
| `grep -rilE 'coldcard\|sparrow\|ledger' docs/` | no files |
| `grep -rlP '\x{2014}' docs/ .planning/phases/05-operator-cohort-lifecycle-control/` | no files |
| `grep -c '^## [0-9]' docs/UPSTREAM-LIMITS.md` | 7 |
| `grep -c 'cohort-intent' docs/adr/0017-runtime-lifecycle-control.md` | 1 (the key_links module reference) |
| `docker compose config -q` | clean |
| Owner verification pass against `05-UAT-CHECKLIST.md` | NOT RUN (the phase's closing human gate) |

## User Setup Required

None new. The six new environment variables are all optional seeds with working defaults; a service that sets none of them behaves exactly as before this phase, and every one of them is editable at runtime from the console instead.

## Next Phase Readiness

- **Phase 5 is hermetically complete.** All fourteen plans executed, the gate is green including the four legs this phase added, and the architectural record, the operator documentation, and the upstream limits are written down.
- **The remaining gate is the owner's pass** against `05-UAT-CHECKLIST.md`, which is `/gsd-verify-work 5`.
- **SVC-04, SVC-05, PART-05, and PART-06 have written verification contracts.** The checklist quotes each ROADMAP success criterion above the steps that verify it, so the pass is against the phase's own stated criteria.
- **Phase 6 inherits a clean documentation baseline for HOST-03** (retiring the booth/attendee framing): `docs/DEPLOY.md` now describes the product as something an operator runs and hosts for strangers, with no demo framing in the new sections.
- **The queued upstream issue batch now has a document to file from.** Seven limits with observed behavior, pinned versions, and, where applicable, a concrete enhancement request.
- **CI debt is unchanged and still Phase 6's**: the two red browser e2e jobs, and neither browser capstone (`e2e:browser:participant`, `e2e:browser:operator`) is wired into CI.

## Self-Check: PASSED

- Created files verified present on disk: `docs/adr/0017-runtime-lifecycle-control.md`, `docs/UPSTREAM-LIMITS.md`, `.planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md`.
- Commits verified in git history: `2d17110`, `ccc9ca3`.
- Every task acceptance criterion re-run in this session, and the plan-level `<verification>` block re-run in full and green, except the owner verification pass, which is the plan's `<human-check>` and is recorded above as NOT RUN rather than assumed.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*
