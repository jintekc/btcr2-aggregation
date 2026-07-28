# Phase 5: Operator Cohort Lifecycle Control - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 5-operator-cohort-lifecycle-control
**Areas discussed:** Lifecycle verbs + cancel, Pause/cancel advertising, Reconfigure w/o restart, Parked-items absorption, Folded builds

---

## Area selection + scoped-todo fold

| Option | Description | Selected |
|--------|-------------|----------|
| Lifecycle verbs + cancel | open->close->finalize mapping onto the library | ✓ |
| Pause/cancel advertising | drain semantics, paused directory view, persistence | ✓ |
| Reconfigure w/o restart | what criterion 3 adds beyond the Phase 1 create form | ✓ |
| Parked-items absorption | mandatory settle of the 04 planning-note-5 list | ✓ |

**User's choice:** All four areas.
**Notes:** On the parallel question about the three Phase-4 scoping one-pagers, the first answer selected both "Keep all three deferred" and all three folds; a clarifying question resolved it to **Fold all three** (an explicit owner divergence from the keep-deferred recommendation). The ToS fold was later bounded in the Folded-builds area.

---

## Lifecycle verbs + cancel

Research presented: destructive-action friction ladder (SaaSUI, GitLab Pajamas, NN/g, Smashing Magazine) - match friction to risk, type-to-confirm only for the worst rung, tell affected users.

| Option | Description | Selected |
|--------|-------------|----------|
| Honest primitives | Cancel (stopCohort) + Finalize now (triggerFallback); close = automatic nth-seat lock narrated as a stage | ✓ |
| Close = directory retract | Synthetic close verb hiding the row; leaky at the protocol level | |
| All three as buttons | Synthetic state machine over missing primitives | |

| Option | Description | Selected |
|--------|-------------|----------|
| Specific if carried | "Operator canceled" when the channel carries attribution; else honest D-25 fallback | ✓ |
| Always generic | D-25 fallback for all cancels | |
| Build a side channel | New public fate read for guaranteed attribution | |

| Option | Description | Selected |
|--------|-------------|----------|
| Laddered friction | Explicit-consequence dialog; funded-live cancel = type-to-confirm + recovery-key line; Finalize-now = simple confirm | ✓ |
| Uniform dialog | One confirm for everything | |
| Type-to-confirm everywhere | Maximum friction on all cancels | |

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-broadcast + distinct fate | Cancel Advertised through signing; distinct 'canceled' ended chip | ✓ |
| Pre-broadcast, folded into failed | Reuse 'failed' fate with a reason string | |
| Filling-only cancel | Cancel only before CohortSet locks | |

**User's choice:** All four recommended options.
**Notes:** Moved to next area at the gate (Finalize-now visibility details left to discretion).

---

## Pause/cancel advertising

Research presented: drain mode as the canonical pattern (Azure AVD), runtime intake toggles in self-hosted tools (Vaultwarden, Zammad, GitLab approval states), restart-requiring env toggles as the anti-pattern (Langfuse).

| Option | Description | Selected |
|--------|-------------|----------|
| Drain mode | Pause blocks new advertise/re-advertise only; in-flight untouched; full quiesce = pause + individual cancels | ✓ |
| Pause + auto-retract | Bulk-cancel unfilled advertised cohorts on pause | |
| Directory blackout | Empty the public directory including in-flight rows | |

| Option | Description | Selected |
|--------|-------------|----------|
| Honest paused notice | Paused copy replaces empty-state line; /v1/status paused bit | ✓ |
| Indistinguishable empty | Paused looks like idle | |
| Notice, no status bit | SPA copy only | |

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory, console switch | Runtime flag, gated route, restart resets to unpaused | ✓ |
| In-memory + boot default env | Plus PAUSED=1-style boot seed | |
| Persist to disk | Durable pause flag | |

| Option | Description | Selected |
|--------|-------------|----------|
| Everything except advertise | Drafts CRUD + cancel/finalize/monitoring/export stay; advertise disabled with honest note | ✓ |
| Read-only while paused | All mutating actions frozen except unpause | |
| Block drafts too | Fully quiet service | |

**User's choice:** All four recommended options.

---

## Reconfigure w/o restart

Research presented: settings-UI vs env-var precedence models (Appsmith env-wins, Open WebUI DB-wins + reset hatches, n8n lock flags); simplified for this app's no-database posture to env-seeds/runtime-overrides.

| Option | Description | Selected |
|--------|-------------|----------|
| Draft edit + defaults | In-place draft editing + settings-surface defaults for the create form | ✓ |
| Defaults only | Draft editing stays discard+recreate | |
| Draft edit only | No defaults surface | |

| Option | Description | Selected |
|--------|-------------|----------|
| Per-draft advanced fields | Discovery + funding windows as optional per-draft fields seeded from env | ✓ |
| Settings-page overrides | Service-level runtime override per knob | |
| Stay env-only | Timing remains boot-time | |

| Option | Description | Selected |
|--------|-------------|----------|
| Env seeds, runtime overrides | Console edits in-memory values; restart returns to env; per-setting source label | ✓ |
| Read-only settings page | Display-only | |
| Persist overrides to disk | First durable operator state | |

| Option | Description | Selected |
|--------|-------------|----------|
| Next-cohort-only, hard rule | Advertised/in-flight shape immutable; "applies to new cohorts only" | ✓ |
| Cancel-and-redraft helper | Convenience action running the cancel ceremony first | |
| Attempt live mutation | Not viable upstream | |

**User's choice:** All four recommended options.

---

## Parked-items absorption

Research presented: kill-switch enable/disable asymmetry (Upstat, Fowler), audit/authz expectations for high-risk toggles; mapped to ADR 0010 (runtime enable would bypass the env rails).

| Option | Description | Selected |
|--------|-------------|----------|
| Live/broadcast kill switch | Runtime DISABLE only, new cohorts | ✓ |
| Ended-cohort dismissal | Gated dismiss ahead of bounded eviction | ✓ |
| SERVICE_NAME edit | Joins the settings surface | ✓ |
| Operator test peers | Fill remaining seats to rehearse the service | ✓ |

**User's choice:** Absorb all four (multi-select).

| Option | Description | Selected |
|--------|-------------|----------|
| Re-park + workaround copy | Seat release pending upstream API; drill-down documents Cancel + re-advertise | ✓ |
| Re-park silently | No workaround surfaced | |
| Attempt app-level kick | Violates consumer-not-fork | |

| Option | Description | Selected |
|--------|-------------|----------|
| Any mode, marked operator-side | Test peers in hermetic AND live; badged + logged; "rehearse your service" framing | ✓ |
| Hermetic-only | No solo live rehearsal | |
| Env-gated visibility | TEST_PEERS=1 boot flag | |

| Option | Description | Selected |
|--------|-------------|----------|
| Broadcast only | Kill the money leg for new cohorts; esplora reads stay up; one-way per session | ✓ |
| Broadcast + live reads | Blinds anchor observation | |
| Reversible in-session | Runtime re-enable | |

**User's choice:** All recommended options.

---

## Folded builds

Research presented: 2026 PSBT taproot key-spend landscape (BIP-371; Coldcard 5.5+, Ledger 2.x, Sparrow coordination) validating the registration-leg PSBT path; the ToS one-pager's own do-not-build recommendation surfaced honestly before asking.

| Option | Description | Selected |
|--------|-------------|----------|
| ToS slice + requirements | Build DID-signed ToS acceptance at join; payments/notifications/contracts = candidate requirements for next milestone | ✓ |
| Requirements capture only | No build | |
| Build more than ToS | Notifications or payments this phase | |

| Option | Description | Selected |
|--------|-------------|----------|
| As scoped: reads + opt-in broadcast | Optional endpoint field; direct UTXO/anchor reads; broadcast second opt-in; CORS + network-mismatch guards | ✓ |
| Reads only | Broadcast always proxied | |
| Add dual-read verification | Proxy + override disagreement flagging | |

| Option | Description | Selected |
|--------|-------------|----------|
| PSBT leg + import warning | Registration-tx PSBT round trip + ephemeral-session warning on paste-import | ✓ |
| Import warning only | Fold in name only | |
| PSBT + extension wallets | Extra integration surface | |

| Option | Description | Selected |
|--------|-------------|----------|
| Three tiers | Core = SVC-04; second = absorptions; slip-first = folded builds | ✓ |
| Core + everything equal | Ad hoc slicing | |
| Nothing slips | Accept running long | |

**User's choice:** All recommended options; ended the discussion with "I'm ready for context."

## Claude's Discretion

Route paths, DTO field names, env var names, poll/retry constants; Finalize-now visibility mechanics; settings-surface knob inventory + layout; ToS artifact storage + proof shape (DID-signed locked); PSBT transfer UX details; test-peer limits/naming/teardown; all copy/layout (UI-SPEC via /gsd-ui-phase 5 recommended, mirroring Phase 4).

## Deferred Ideas

Payments/notifications/contracts (candidate requirements, next milestone); active seat reclaim (upstream seat-release API); MuSig2 external co-sign (upstream signer interface); dual-read esplora verification; extension-wallet signers; cancel-and-redraft helper; bulk pause auto-retract; pause boot-default env; settings persistence (DUR-01); reversible in-session kill switch; runtime live/broadcast ENABLE (rejected on ADR 0010 grounds); dismissal undo.
