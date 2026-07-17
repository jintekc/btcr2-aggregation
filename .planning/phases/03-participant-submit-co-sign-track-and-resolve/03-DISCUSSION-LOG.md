# Phase 3: Participant Submit, Co-Sign, Track, and Resolve - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-07-16
**Phase:** 3-participant-submit-co-sign-track-and-resolve
**Areas discussed:** Post-seat journey shape, Submit moment + update content, Tracking source + degraded states, Resolve + stepper retirement, Proof strategy, Phase 4 seam, Co-sign consent semantics, Import-time fit validation, Identity reuse, Solo testing

The owner selected all four initially-presented gray areas, then chose "More questions" / "Explore more gray areas" at nearly every gate (consistent with the Phase 2 thoroughness pattern), yielding 51 decisions across 10 areas. In every case the owner selected the recommended option; the recurring selection logic was maximum truthfulness in copy with minimum new backend.

---

## Post-seat journey shape

| Question | Options presented | Selected |
|---|---|---|
| Shape of the post-seat experience | One live cohort page (Recommended) / Guided step wizard / Status page + action modals | One live cohort page |
| Directory landing while mid-flight | Directory stays reachable (Recommended) / Cohort page takes over | Directory stays reachable |
| End state after resolve | Completion summary stays (Recommended) / Auto-return to directory / You decide | Completion summary stays |
| Leave once signing starts | Hide Leave once signing starts (Recommended) / Keep Leave with a warning / You decide | Hide Leave once signing starts |
| Absorb Phase 2 waiting-for-seats state? | One page from join onward (Recommended) / Cohort page starts at lock | One page from join onward |
| Refresh mid-flight posture | Keep-tab-open limitation (Recommended) / Persist identity + re-attach attempt / You decide | Keep-tab-open limitation |
| Other members' progress display | Aggregate counts only (Recommended) / Own status only / Member list | Aggregate counts only |
| Stage timeline language | Plain labels + detail expander (Recommended) / Plain language only / Technical-first | Plain labels + detail expander |
| URL-addressability of the cohort page | Internal view state (Recommended) / Routed URL | Internal view state |
| Stage-change awareness while browsing | Live 'Your cohort' indicator (Recommended) / Indicator + tab title / Nothing extra | Live 'Your cohort' indicator |
| Anchor stage honesty on hermetic services | Mode-honest stage copy (Recommended) / Uniform 'Anchored' stage / You decide | Mode-honest stage copy |
| Previous completion record on next join | Replaced on next join (Recommended) / Keep a session history | Replaced on next join |
| Timeline visibility | Full timeline upfront (Recommended) / Progressive reveal | Full timeline upfront |
| Time communication on active stage | Elapsed time on active stage (Recommended) / Stage-timeout countdown / No timers | Elapsed time on active stage |
| Own-identity display | Compact identity section (Recommended) / No identity display / You decide | Compact identity section |
| Directory row for the joined cohort | 'Your cohort' row state (Recommended) / Disabled Join only | 'Your cohort' row state |
| Where terminal failures land | Terminal state on cohort page (Recommended) / Bounce to directory + toast | Terminal state on cohort page |
| Cooperative non-inclusion presentation | Distinct 'not included' outcome (Recommended) / Treat as terminal failure / You decide | Distinct 'not included' outcome |
| Start-over affordance | Start over with custody warning (Recommended) / Keep identity across cohorts / You decide | Start over with custody warning |

---

## Submit moment + update content

| Question | Options presented | Selected |
|---|---|---|
| Submit trigger | Explicit submit action (Recommended) / Pre-authorized at join / Auto-submit with notice | Explicit submit action |
| Update content + pre-submit visibility | Auto-built + preview (Recommended) / Auto-built, no preview / User-editable update | Auto-built + preview |
| Identity model coverage | KEY golden path, x1 kept working (Recommended) / Full parity both models / KEY only this phase | KEY golden path, x1 kept working |
| LIVE KEY registration placement | Conditional stage when live (Recommended) / Defer live registration UX / You decide | Conditional stage when live |
| Miss-the-window treatment | Urgent attention + honest outcome (Recommended) / Last-moment auto-submit safety net / No escalation | Urgent attention + honest outcome |
| IPFS publish placement | Conditional at submit stage (Recommended) / Defer IPFS integration / You decide | Conditional at submit stage |
| Pre-submit preview depth | Plain summary + raw expander (Recommended) / Raw JSON only / Summary only | Plain summary + raw expander |
| Explicit sit-out? | No sit-out UI this phase (Recommended) / Explicit sit-out option | No sit-out UI this phase |

---

## Tracking source + degraded states

| Question | Options presented | Selected |
|---|---|---|
| Live progress data source | Runner events + minimal public anchor read (Recommended) / New public per-cohort status endpoint / Directory poll only | Runner events + minimal public anchor read |
| Anchor status visibility | Public/anonymous read (Recommended) / Participant-scoped read / You decide | Public/anonymous read |
| k-of-n fallback anchor display | Explicit fallback outcome (Recommended) / Generic anchored / You decide | Explicit fallback outcome |
| Service unreachable mid-flight | Distinct banner + auto-retry (Recommended) / Fail fast to terminal / You decide | Distinct banner + auto-retry |
| Anchor stage granularity | Signed -> Broadcast -> Confirmed (Recommended) / Single anchored state / You decide | Signed -> Broadcast -> Confirmed |
| Failure reason specificity | Best-effort specific + honest unknown (Recommended) / Generic 'cohort ended' / You decide | Best-effort specific + honest unknown |
| Directory visibility of in-flight cohorts | Visible as in-progress, non-joinable (Recommended) / Drop rows at lock / You decide | Visible as in-progress, non-joinable |
| Not-included keeps tracking cohort outcome? | Yes, show the cohort's outcome (Recommended) / Stop tracking at non-inclusion | Yes, show the cohort's outcome |
| Timestamped activity log? | Log inside the detail expander (Recommended) / Stages only | Log inside the detail expander |
| Confirmation depth after first conf | Freeze at first confirmation (Recommended) / Live confirmation count | Freeze at first confirmation |

---

## Resolve + stepper retirement

| Question | Options presented | Selected |
|---|---|---|
| Resolve trigger | Auto-resolve + re-run action (Recommended) / Manual 'Resolve now' button / You decide | Auto-resolve + re-run action |
| Resolved document presentation | Plain summary + raw expander (Recommended) / Raw document front and center / You decide | Plain summary + raw expander |
| Stepper retirement depth | Delete dead code (Recommended) / Leave unreachable / Dev-flag escape hatch | Delete dead code |
| Round-trip verification | Yes, truthful round-trip check (Recommended) / Display only | Yes, truthful round-trip check |
| Sidecar/artifact export placement | In the completion summary (Recommended) / Detail expander only / Defer sidecar in new flow | In the completion summary |
| Resolve-before-resolvable lag | Honest retry state (Recommended) / Wait until resolvable / You decide | Honest retry state |
| Fate of KeyGenPanel + import flow | Absorbed into join identity step (Recommended) / Keep a standalone identity page | Absorbed into join identity step |

---

## Proof strategy

| Question | Options presented | Selected |
|---|---|---|
| What the hermetic capstone e2e drives | Browser-level capstone (Recommended) / Headless capstone + UI later / Both layers | Browser-level capstone |

## Phase 4 seam

| Question | Options presented | Selected |
|---|---|---|
| Shaping the new public anchor read | Minimal now, Phase 4 extends (Recommended) / Design the full status read now / You decide | Minimal now, Phase 4 extends |

## Co-sign consent semantics

| Question | Options presented | Selected |
|---|---|---|
| Single consent at submit for the whole round? | One consent at submit (Recommended) / Second approval before tx signature / You decide | One consent at submit |
| Beacon-tx meaning in the preview? | Yes, brief tx line in preview (Recommended) / Document change only | Yes, brief tx line in preview |

## Import-time fit validation

| Question | Options presented | Selected |
|---|---|---|
| When does a bad-fit import surface? | Warn at the identity step (Recommended) / Block bad-fit joins / Keep late non-inclusion only | Warn at the identity step |

## Identity reuse

| Question | Options presented | Selected |
|---|---|---|
| Offer reusing the in-memory identity on a new join? | Offer 'use current identity' (Recommended) / Always fresh or explicit import / You decide | Offer 'use current identity' |

## Solo testing

| Question | Options presented | Selected |
|---|---|---|
| Solo-demo affordance this phase? | No new affordance; document FILLERS (Recommended) / Operator test-peer control / You decide | No new affordance; document FILLERS |

---

## Claude's Discretion

- Exact shape/path of the minimal public anchor read + polling mechanics.
- What the protocol does when a seated participant never submits (drives the missed-window outcome copy).
- Whether a signing pause hook exists in the runner (context only; one-consent decision stands).
- Exact stage copy, empty/error strings, visual treatment (UI phase).
- Participant store restructure details (stages, log accumulation, staleness guards).
- Which client-side fit checks are reliably computable pre-seat.
- Registration/IPFS stage ordering relative to submit/anchor.
- e2e harness structure for the browser capstone.

## Deferred Ideas

- Routed `/cohorts/:id` URL (pairs with Phase 4 patterns).
- Session-local completed-cohort history (v2 PMG-01).
- Identity persistence / mid-flight re-attach (v2 DUR-01).
- Explicit voluntary sit-out action.
- User-editable DID update content.
- Full x1/EXTERNAL polish parity (fold-in after Phase 3).
- Live confirmation count / reorg UX beyond first confirmation.
- Operator test-peer control (Phase 5).
- Full per-cohort status DTO (Phase 4).
- Tab-title notifications beyond the submit-window urgency exception.
- CI wiring of the new browser capstone + rewiring the red browser e2e jobs (Phase 6).
