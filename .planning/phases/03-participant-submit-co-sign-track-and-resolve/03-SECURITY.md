---
phase: 3
slug: participant-submit-co-sign-track-and-resolve
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-22
---

# Phase 3 - Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

All nine Phase 3 plans (03-01 through 03-09) authored `<threat_model>` blocks at plan time
(register_authored_at_plan_time: true). With every register entry closed and ASVS level 1,
the L1 short-circuit applies: classification is grep-depth against the implementation plus
the phase's verification evidence (03-VERIFICATION.md 8/8 truths across four passes,
03-REVIEW.md deep review with 0 blockers, 364/364 unit tests). Load-bearing high-severity
mitigations were additionally spot-verified directly in source (cited per threat below).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| participant runner <- onProvideUpdate callback | Library awaits an app-controlled callback deciding whether/when to submit the signed update | Signed DID update payload |
| in-browser key -> signed update | BIP340 signing with the participant's key; built body must be the submitted body | Private key (never leaves browser), signed update |
| in-browser key -> UI display | Secret shown for backup only | Private key material (display only) |
| anonymous client -> GET /v1/anchor/:cohortId | Untrusted public read of per-cohort anchor fact | Public chain facts (state/txid/explorer URL) |
| anonymous client -> GET /v1/directory + /v1/status | Public reads for cohort discovery | Non-sensitive cohort DTO fields |
| BeaconBroadcaster -> retained map | Server-internal transient frames folded into last-known state | Anchor lifecycle frames |
| public read block vs operatorAuth block | Mount site decides whether a route inherits the session guard | Route access control |
| in-tab runner callback -> store | Awaited submit gate + runner events cross into store state | Lifecycle state |
| public anchor read -> store poll | Public anchor DTO drives render stages | Public anchor DTO |
| async continuations vs round resets | leave/re-join/new-identity can invalidate in-flight polls/deferreds | Epoch tokens |
| render copy vs service mode | Anchor/signed copy must reflect the true broadcast mode | Mode-honest narration |
| terminal/degraded detection -> UI | Transient failures never shown as terminal; unknowns never invented | Failure narration |
| in-browser key -> Start over | Identity wipe is irreversible, gated behind explicit warning | Key destruction |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01-01 | DoS (protocol) | onSubmitGate awaited callback | medium | mitigate | Never-resolved gate bounded by service phaseTimeoutMs; store clears deferred without settling on teardown (participant.ts:347,526) | closed |
| T-03-01-02 | Tampering | signed update body | high | mitigate | Update built once, captured object submitted/compared; never rebuilt (BIP340); getSubmittedUpdate single source; anti-pattern documented + regression-checked (VERIFICATION Truth 1) | closed |
| T-03-01-03 | Repudiation | cooperative non-inclusion | low | mitigate | Decline path runs before the gate; getDeclineReason records why | closed |
| T-03-02-01 | Info disclosure | anchor DTO | medium | mitigate | DTO carries only public chain facts + enabled bit; failure reason generic; no member DIDs/keys | closed |
| T-03-02-02 | Info disclosure | unknown-cohort answer | low | mitigate | Unknown cohortId returns {state:'none'}, identical for never-existed and evicted (no existence oracle) | closed |
| T-03-02-03 | DoS | retained map growth | medium | mitigate | Bounded ~24 with oldest-first eviction; O(1) reads; no chain I/O on read path | closed |
| T-03-02-04 | EoP / access control | route mount site | high | mitigate | SPOT-VERIFIED: /v1/anchor/:cohortId mounts at hono-adapter.ts:315, before the `if (operatorAuth)` block at :331; operator gating untouched | closed |
| T-03-02-05 | DoS | esplora-on-public-read | high | mitigate | Read returns retained broadcaster state only; never touches esplora; hermetic default stays chain-free | closed |
| T-03-03-01 | Info disclosure | widened directory rows | low | mitigate | Rows carry only existing non-sensitive DirectoryCohortDTO fields | closed |
| T-03-03-02 | Tampering (invariant) | status().openCohorts | medium | mitigate | Open count counts Advertised-tier only; display widening never inflates it (spec-pinned) | closed |
| T-03-03-03 | Info disclosure | expired/completed leakage | low | mitigate | Expired stays operator-only; completed prunes from public directory | closed |
| T-03-04-01 | DoS (protocol) | pending submit deferred teardown | high | mitigate | SPOT-VERIFIED: module-scope deferred cleared without settling on every teardown (participant.ts:342-347, Pitfall-2 comment at :526) | closed |
| T-03-04-02 | Tampering | round-trip verification | high | mitigate | roundTripOutcome compares findAppendedBeacon + captured updateHashHex; update never rebuilt | closed |
| T-03-04-03 | Spoofing (stale state) | anchor/directory poll continuations | medium | mitigate | Epoch tokens (anchorEpoch/directoryEpoch) drop prior-round in-flight snapshots | closed |
| T-03-04-04 | Repudiation / honesty | degraded-state reasons | medium | mitigate | Best-effort D-25 reasons with explicit 'didn't say why' fallback; transient never terminal (D-24) | closed |
| T-03-04-05 | Info disclosure | aggregate counts | low | mitigate | Counts cover seats/updates/co-sign progress only, never member identities (D-08) | closed |
| T-03-05-01 | Info disclosure | key custody | high | mitigate | SPOT-VERIFIED: secret renders via in-browser CopyField only; no code path transmits it (no fetch/post usage of secret in participant.ts) | closed |
| T-03-05-02 | Repudiation / misrepresentation | signed/anchor copy | high | mitigate | Every anchor/signed string branches on anchor.enabled; hermetic never claims txid/anchor (D-07); hardened further by 03-07/08/09 | closed |
| T-03-05-03 | DoS (protocol) | submit consent | medium | mitigate | One consent at submit; no second mid-round gate (D-14); UAT Test 2 passed | closed |
| T-03-05-04 | Tampering (UX integrity) | join fit gate | low | accept | preSeatFitWarning warns but never blocks; late cooperative non-inclusion is the honest backstop (D-19), intended non-blocking design | closed |
| T-03-06-01 | Repudiation / misrepresentation | round-trip + anchor copy | high | mitigate | Anchor/resolve strings branch on anchor.enabled; hermetic-genesis rendered as expected (D-07/D-29); capstone asserts SIGNED wording | closed |
| T-03-06-02 | DoS / honesty | degraded-state detection | medium | mitigate | Transient unreachable freezes with quiet retry, never terminal (D-24); honest fallback (D-25) | closed |
| T-03-06-03 | Tampering | Start over identity wipe | high | mitigate | Wipe behind danger-variant explicit key-custody confirmation; sidecar-export reminder precedes it (D-10) | closed |
| T-03-06-04 | Info disclosure | conditional live stages | medium | mitigate | Registration/IPFS stages render only when live/enabled; hermetic path exposes no funding surface (D-17) | closed |
| T-03-07-01 | Repudiation | handlePostSeatSnapshot streak | medium | mitigate | Bounded POST_SEAT_GONE_CONFIRMATIONS streak; cohort-complete tears down poll before streak on success; pinned by unit tests (VERIFICATION Truth 5) | closed |
| T-03-07-02 | Info disclosure | CompletionSummary Signed-line copy | low | accept | Narrates only the participant's own public anchor state + network label | closed |
| T-03-07-03 | DoS | shouldAutoResolve on 'failed' | low | accept | Bounded RESOLVE_LAG_MAX_ATTEMPTS (3) retries; no new unbounded loop | closed |
| T-03-07-SC | Tampering | package installs | low | accept | Zero installs in 03-07/08/09 gap closures; supply-chain surface unchanged (also covers T-03-08-SC, T-03-09-SC) | closed |
| T-03-08-01 | Info disclosure | StageTimeline label + narration | low | accept | Truthfulness fix only; no new disclosure | closed |
| T-03-08-02 | DoS | render path ('checking' member + selector call) | low | accept | No new poll/interval/retry/unbounded work | closed |
| T-03-09-01 | Info disclosure | anchorSummaryState / deriveStage / heading | low | accept | Truthfulness fix only (unconfirmed-broadcast window); no new disclosure | closed |
| T-03-09-02 | DoS | render path (two selector calls + boolean) | low | accept | No new poll/retry/unbounded work; shouldAutoResolve and poll cadence unchanged | closed |

*Status: open · closed · open - below high threshold (non-blocking)*
*Severity: critical > high > medium > low - only open threats at or above workflow.security_block_on (high) count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-03-01 | T-03-05-04 | Non-blocking join fit warning is the intended design (D-19); cooperative non-inclusion is the honest backstop | plan 03-05 (user-approved plan) | 2026-07-22 |
| R-03-02 | T-03-07-02, T-03-08-01, T-03-09-01 | Narration copy exposes only the participant's own public anchor state; the changes reduce truthfulness defects | plans 03-07/08/09 | 2026-07-22 |
| R-03-03 | T-03-07-03, T-03-08-02, T-03-09-02 | Render/resolve paths introduce no new unbounded work; retries bounded | plans 03-07/08/09 | 2026-07-22 |
| R-03-04 | T-03-07-SC (+ 03-08-SC, 03-09-SC) | Zero-install gap closures; supply-chain surface unchanged | plans 03-07/08/09 | 2026-07-22 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-22 | 31 | 31 | 0 | Claude (secure-phase L1 short-circuit; plan-time register, spot-verified high-severity mitigations, verification evidence 8/8) |

Notes carried forward (documented, out of Phase 3 scope, non-blocking):
- Phase 1 pre-deploy hardening still pending before public internet exposure: T-01-06 proxy-aware login throttle + WR-02 NaN-TTL (tracked in 01-SECURITY.md / 01-REVIEW.md).
- Live-path defects found in Phase 3 UAT are routed to .planning/todos/pending/ (unconfirmed-signal resolution failure in @did-btcr2/method; terminalReason misattribution; both honesty/availability issues, not new attack surface).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-22
