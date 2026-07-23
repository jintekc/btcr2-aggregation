# Phase 4: Operator Cohort Monitoring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-07-22 / 2026-07-23
**Phase:** 4-operator-cohort-monitoring
**Areas discussed:** Todo folding, Monitoring surface shape, Fresh-load truth, Member/submission depth, Live-path enablement, Round-2 emergent (core priority, scoping form, ADR posture, live docs), Round-3 (live story, UI spec, human UAT), plus two ultracode adversarial audit rounds

The selected option is marked with a check; "(R)" marks the option Claude recommended. The owner followed the recommendation in every case except the JSON export.

---

## Todo folding (cross-reference step)

All 7 pending todos were folded, including the 3 Claude flagged as weak fits (participant esplora override, external signers, ToS/payments) - later resolved as scoping-deliverables-only during Live-path discussion.

## Monitoring surface shape (18 questions)

| Question | Options | Selected |
|---|---|---|
| Where does the live view live? | Drill-down per cohort (R) / Enrich global board / List+drill-down+feed | Drill-down per cohort ✓ |
| Fate of booth-era Dashboard tab? | Retire; log goes per-cohort (R) / Retire cards, keep global log / Keep as-is | Retire; log per-cohort ✓ |
| Routed URL for drill-down? | SPA-internal (R) / Routed operator URLs / Routed both sides | SPA-internal ✓ |
| Attention on the list? | Status chips (R) / Chips+strip / Chips+tab-title | Status chips ✓ |
| Drill-down organization? | Timeline + concern sections (R) / Sectioned cards / Dense table | Timeline + sections ✓ |
| Service-level metrics? | Compact live counts (R) / Cumulative counters / Drop entirely | Compact live counts ✓ |
| Navigation model? | Full-view switch (R) / Inline expansion / Side panel | Full-view switch ✓ |
| List ordering? | Group by state (R) / Newest-first flat / Active-history tabs | Group by state ✓ |
| Drafts in drill-down? | List-row only (R) / Drill-down for all | List-row only ✓ |
| Expired + re-advertise placement? | Ended group + row action (R) / Drill-down with history | Ended group + row action ✓ |
| Create form placement? | Behind New-cohort button (R) / Keep alongside | Behind button ✓ |
| Cross-cohort attention in drill-down? | Badge on back link (R) / Nothing / Toast | Badge on back link ✓ |
| Copy register? | Plain-first, raw in expander (R) / Protocol-first | Plain-first ✓ |
| Post-advertise landing? | Open drill-down (R) / Stay on list | Open drill-down ✓ |
| Dismiss ended cohorts? | No dismissal this phase (R) / Dismiss per row | No dismissal ✓ |
| View-as-participant? | Simple link to / (R) / None / Embedded preview | Simple link ✓ |
| Session expiry mid-monitoring? | Honest re-login redirect (R) / Inline overlay | Re-login redirect ✓ |
| Service-health strip? | Compact health row (R) / Behind expander | Compact health row ✓ |

## Fresh-load truth (11 questions)

| Question | Options | Selected |
|---|---|---|
| Data transport? | Server snapshot, polled (R) / Snapshot+SSE overlay / SSE with replay | Server snapshot, polled ✓ |
| Activity log source? | Server-side ring (R) / Client-accumulated | Server-side ring ✓ |
| Ended-cohort retention? | Bounded cap 24 (R) / Time window / Session-lifetime | Bounded cap 24 ✓ |
| Restart treatment? | Honest empty state (R) / No explanation | Honest empty ✓ |
| Read shape? | Summary list + detail read (R) / Single full read | Summary + detail ✓ |
| Poll failure? | Mirror participant D-24 (R) / Error takeover | Mirror D-24 ✓ |
| Freshness display? | Quiet live indicator (R) / None | Quiet indicator ✓ |
| Public directory touched? | Untouched (R) / Enrich slightly | Untouched ✓ |
| Merge with operator list read? | One merged read (R) / Separate / You decide | One merged read ✓ |
| Log fidelity? | All events, server-stamped (R) / Curated | All events ✓ |
| Accumulator vs anchor-state? | You decide (R) / Independent / Shared | You decide ✓ |

## Member/submission depth (10 questions)

| Question | Options | Selected |
|---|---|---|
| Member identity? | Full DID, standard treatment (R) / Short only | Full DID ✓ |
| Submission detail? | Who + status, raw in expander (R) / Counts only / Inline docs | Who + status ✓ |
| Co-sign granularity? | Per-participant when possible (R) / Aggregate only | Per-participant ✓ |
| Pre-seat opt-ins? | Distinct pending state (R) / Seated only | Distinct pending ✓ |
| Fallback outcome? | Mirror D-23 per-member (R) / Path only | Mirror D-23 ✓ |
| Validation/rejection on member row? | Yes, on row (R) / Log only | On row ✓ |
| Export? | Not this phase (R) / Simple JSON download | **JSON download ✓ (diverged from recommendation)** |
| Export contents? | Monitoring record only (R) / Full artifact bundle | Record only ✓ |
| Cross-cohort DID correlation? | Defer (R) / Light now | Defer ✓ |
| Member pubkeys? | Expander only (R) / Not shown | Expander only ✓ |

## Live-path enablement (11) + emergent cross-cutting (4)

| Question | Options | Selected |
|---|---|---|
| Boot enablement? | Env passthrough + loud banner (R) / Console toggle / Both | Env passthrough ✓ |
| Funding surfacing? | Watch-only auto-detect (R) / Manual refresh / Guided flow | Watch-only auto-detect ✓ |
| Participant sees awaiting-funding? | Honest waiting copy (R) / Operator-only | Honest waiting copy ✓ |
| Stall-copy scope? | Fix attribution honestly (R) / Broader taxonomy | Fix attribution ✓ (later audit-corrected wording) |
| Unconfirmed-signal resolve? | Honest not-yet-confirmed response (R) / Wait-and-retry / You decide | Honest response ✓ |
| Weak-three folds mean? | Scoping deliverables only (R) / Build buildable slices / Unfold | Scoping only ✓ |
| Live proof? | Hermetic gate + formalized harness (R) / Hermetic only / CI live leg | Hermetic + harness ✓ (later audit-corrected: mocked-chain live leg) |
| Funding window? | Tunable window, honest death (R) / Existing timeouts / Wait forever | Tunable window ✓ (later audit-corrected mechanics) |
| Amount guidance? | Suggested minimum (R) / Address only | Suggested minimum ✓ |
| Mainnet extra? | Warn-tone funding banner (R) / Rails only | Warn banner ✓ |
| Esplora down mid-flight? | Health row + honest freeze (R) / Health row only | Health row + freeze ✓ |
| Browser operator capstone? | Yes, local (R) / Headless only | Yes ✓ |
| SERVICE_NAME? | Env-var display only (R) / Keep deferred / Editable | Env display ✓ |
| Operator anchor depth? | Mirror D-22 (R) / Live conf count | Mirror D-22 ✓ |
| Resolve-traffic visibility? | Defer (R) / Simple counter | Defer ✓ |

## Round-2 emergent + Round-3 (7 questions)

| Question | Options | Selected |
|---|---|---|
| Phase core priority? | Both core; extras slip (R) / Monitoring first / Live path first | Both core ✓ |
| Scoping deliverable form? | Decision one-pagers (R) / Full PRDs / Expand todos | One-pagers ✓ |
| ADR posture? | New ADR supersedes 0004 (R) / No new ADR | New ADR ✓ |
| Going-live docs? | DEPLOY.md live section (R) / New OPERATOR.md / Defer to P6 | DEPLOY.md section ✓ |
| Flagship live story? | Mutinynet live (R) / Regtest-first | Mutinynet ✓ |
| UI-SPEC before planning? | Yes (R) / Skip | Yes ✓ |
| Human live UAT planned? | Yes, walkthrough checklist (R) / Automated suffices | Yes ✓ |

## Owner-raised scope question (mid-discussion)

Multi-tenant / multi-network on both sides? Answered from the locked record (service-side multi-cohort already true; single network per boot; participant one-at-a-time; single operator). Owner chose **Keep locks, note revisit (R)** - multi-network + PMG-01 flagged for the next milestone discussion.

## Ultracode adversarial audit round 1 (52 agents: 5 finders, dedup, 2 verifiers per finding)

37 raw findings -> 23 canonical -> 9 survivors. Three resolved as verifier-confirmed mechanical amendments (stall-copy positive signal via validation-requested fact; hermetic funding e2e must be a mocked-chain live leg; env mapping LIVE=1 preserved + new BROADCAST=1). Six went to the owner:

| Finding | Options | Selected |
|---|---|---|
| Funding window vs library timers | Boot invariant + service timer (R) / Fit inside timers / Accept generic death | Boot invariant + service timer ✓ |
| One-shot broadcast send | Bounded internal auto-retry (R) / Accept + narrate / Gated re-broadcast | Bounded auto-retry ✓ |
| Partial-sig leg blind | Honest now + upstream request (R) / Adapter-tap workaround / Accept only | Honest + upstream ✓ |
| Funding sub-states | Three states + dead-end (R) / Binary + upfront rules / Advance on mempool | Three states + dead-end ✓ |
| RECOVERY_KEY posture | Warn loudly + stage disclosure (R) / Refuse boot / Ack gate / Mainnet-only | Warn + disclosure ✓ |
| Funding wait vs tab-bound seats | Join notice + modest window (R) / Long windows, fallback valve / Seat persistence pull-forward | Join notice + modest window ✓ |

14 rejected findings were preserved as planning notes in CONTEXT.md where true-but-planning-settleable.

## Ultracode adversarial audit round 2 (22 agents: 3 finders, dedup, 2 verifiers per finding)

13 raw -> 9 canonical -> 4 survivors. Two mechanical amendments (funding-watch predicates mirror selectSpendableUtxo on the SELECTED UTXO; suggested minimum = max(2000, fee-derived), dead-end re-worded). Two went to the owner:

| Finding | Options | Selected |
|---|---|---|
| TTL leg (armed at advertise, no extension API) | Per-cohort clamp + disclosure (R) / Inflate TTL worst-case / No TTL on live boots | Per-cohort clamp ✓ |
| Blind lapse during esplora outage | Positive reason only when observed (R) / Pause window / Lapse with generic copy | Positive-only-when-observed ✓ |

## Claude's Discretion

Poll intervals, DTO fields, env var names, retry constants, ring sizes; accumulator topology (byte-untouched public anchor read); participant mid-round funding-signal vehicle; SERVICE_NAME carrier DTO; exact copy/layout (UI phase); funding-watch loop placement.

## Deferred Ideas

Multi-network + participant multi-cohort (owner-flagged priority revisit next milestone); Phase 5 contract absorption of parked items; routed URLs; building the weak-three; upstream partial-sig event + block_time fix adoption; resolve-traffic telemetry; cross-cohort correlation; artifact-bundle export; OPERATOR.md; seat persistence; adapter-tap workaround (rejected).
