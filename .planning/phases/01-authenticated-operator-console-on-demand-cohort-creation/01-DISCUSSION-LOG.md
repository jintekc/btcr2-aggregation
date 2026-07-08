# Phase 1: Authenticated Operator Console + On-Demand Cohort Creation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 1-authenticated-operator-console-on-demand-cohort-creation
**Areas discussed:** Operator auth model + architecture (split question), Public dashboard fate, Cohort create surface, Auto-advertise loop, Fail-closed auth default, Session lifetime & logout, Create vs advertise steps, Cohort close trigger, Directory listing boundary + source of truth, Phase 1 console scope, Draft management depth

---

## Operator auth model + architecture (the split question)

The owner interrupted the initial auth question to probe a deeper architectural fork: should the app split into two separate `btcr2-aggregation-participant` + `btcr2-aggregation-service` client/server apps that find each other over HTTP/REST? A 5-agent multi-lens analysis (topology/ADR fidelity, product/North-Star scope, participant-as-client protocol reality, adversarial steelman-the-split, + synthesis) ran; all four lenses independently returned "experience split, same deployment" at high confidence.

| Option | Description | Selected |
|--------|-------------|----------|
| Experience split, one deploy | One same-origin service; operator console = distinct login-gated route/bundle, server-enforced; participant anonymous. No second deployable. | ✓ |
| Full two-app split | Separate participant + service apps discovering each other over HTTP/REST; supersedes ADRs 0003/0005/0014, adds CORS, pulls v2 (PMG-01) forward. | |
| Defer / think more | Sit with the trade-offs before committing. | |

**User's choice:** Experience split, one deploy.
**Notes:** Owner confirmed the service-side gets its own dedicated operator UI (login + config + management), just not its own separate deployment. Full split's one real win (audited single participant client) noted as a v2 trust upgrade. Supersedes ADR 0004's public-read-only-dashboard posture; warrants a new auth ADR.

| Option (credential) | Description | Selected |
|--------|-------------|----------|
| Env secret + login + session | Secret set at boot via env; login screen; server-issued httpOnly session cookie; operator routes require it. | ✓ |
| Static bearer token only | Long-lived token via env, sent as Authorization header; no login/session. | |
| You decide | Default to env secret + login + session. | |

**User's choice:** Env secret + login + session.

---

## Public dashboard fate

| Option | Description | Selected |
|--------|-------------|----------|
| Participant experience only | Anonymous landing = participant experience only; live coordinator feed fully gated. | |
| Participant + minimal status | Participant experience + small public status (service up, network, open-cohort count); detailed feed gated. | ✓ |
| You decide | Default to participant-only, telemetry gated. | |

**User's choice:** Participant + minimal status.

---

## Cohort create surface

| Option (network) | Description | Selected |
|--------|-------------|----------|
| Fixed to service network | Network is the boot network, shown read-only. | |
| Per-cohort network | Operator picks network per cohort. | (initially chosen, then refined) |
| Selectable, one active network | Service targets one network at a time, operator-configurable (allow-set, nothing hardcoded); no simultaneous multi-network. | ✓ |
| True simultaneous multi-network | Cohorts on different networks live at once; supersedes single-network constraint; likely own phase. | |

**User's choice:** Per-cohort network, refined to "Selectable, one active network."
**Notes:** The owner first picked per-cohort network. Flagged the hard tension with the config-driven-single-network constraint and the wide cost range; owner refined to the tractable middle path (one active network at a time). No superseding ADR needed. Runtime network-switching without restart deferred to Phase 5.

| Option (roster) | Description | Selected |
|--------|-------------|----------|
| Capacity-only for MVP | beacon type, threshold, capacity; roster/pre-provisioning deferred. | ✓ |
| Include roster now | Pre-provision a fixed roster (rosterPks) at create time (ADR 0012 machinery). | |
| You decide | Default to capacity-only. | |

**User's choice:** Capacity-only for MVP.

---

## Auto-advertise loop

| Option (loop) | Description | Selected |
|--------|-------------|----------|
| Remove entirely | Operator on-demand creation becomes the only cohort driver. | ✓ |
| Keep behind default-off flag | Opt-in AUTO_ADVERTISE for dev/e2e; off in prod. | |
| You decide | Default to remove entirely. | |

**User's choice:** Remove entirely.

| Option (fillers) | Description | Selected |
|--------|-------------|----------|
| e2e harness; fillers dev-only | Prove lifecycle via automated e2e; fillers become dev+test aid, default-off in prod. | ✓ |
| Keep fillers as operator feature | Fillers stay in the running product so a solo operator can seed co-signers. | |
| You decide | Default to e2e-harness proof, fillers dev-only. | |

**User's choice:** e2e harness; fillers dev-only.

---

## Fail-closed auth default

| Option | Description | Selected |
|--------|-------------|----------|
| Boot, lock console, warn loudly | Serve public participant surface; disable operator console + mutating/telemetry routes; loud boot warning. | ✓ |
| Refuse to boot | Hard-fail startup if no credential. | |
| Open if unset (dev only) | Console open when no credential; insecure. | |

**User's choice:** Boot, lock console, warn loudly.

| Option (credential form) | Description | Selected |
|--------|-------------|----------|
| Operator-chosen password | OPERATOR_PASSWORD, typed on login, constant-time compare, never logged. | ✓ |
| Opaque token | High-entropy token via env, pasted on login. | |
| You decide | Default to operator-chosen password. | |

**User's choice:** Operator-chosen password.

---

## Session lifetime & logout

| Option | Description | Selected |
|--------|-------------|----------|
| Config TTL + real logout | httpOnly cookie, configurable TTL (~24h default), explicit server-invalidating logout. | ✓ |
| Until browser close | Short-lived session tied to browser; frequent re-login. | |
| You decide | Default to config TTL + real logout. | |

**User's choice:** Config TTL + real logout.

---

## Create vs advertise steps

| Option | Description | Selected |
|--------|-------------|----------|
| Two-step: create draft, then advertise | Create/configure an unadvertised draft, review, then advertise to publish. | ✓ |
| One-step: create-and-advertise | Single action creates and immediately publishes. | |
| You decide | Default to two-step. | |

**User's choice:** Two-step: create draft, then advertise.

---

## Cohort close trigger (Phase 1)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto: capacity or min+timeout | Self-trigger co-sign at capacity or min-participants + TTL/phase timeout (reuse existing machinery). | ✓ |
| Minimal operator 'go/close now' | Pull a tiny slice of Phase 5 forward. | |
| You decide | Default to auto-trigger. | |

**User's choice:** Auto: capacity or min+timeout. Operator open/close/finalize stays Phase 5.

---

## Directory listing boundary + source of truth

| Option (boundary) | Description | Selected |
|--------|-------------|----------|
| Build listing in Phase 1 | Queryable directory listing (data model + GET endpoint) shipped in Phase 1. | ✓ |
| Defer listing to Phase 2 | Only advertise over /v1/adverts now; listing endpoint in Phase 2. | |
| You decide | Default to building the listing in Phase 1. | |

**User's choice:** Build listing in Phase 1.

| Option (source) | Description | Selected |
|--------|-------------|----------|
| Derive from live advertised set | Read the same live advertised-cohort set the runner broadcasts; one source of truth. | ✓ |
| Separate operator-written list | A side table the operator's advertise writes to; risks drift. | |
| You decide | Default to deriving from the live set. | |

**User's choice:** Derive from live advertised set.

---

## Phase 1 console scope

| Option | Description | Selected |
|--------|-------------|----------|
| Basic cohort list | Draft vs advertised + basic fields, to confirm advertise worked; rich monitoring is Phase 4. | ✓ |
| Create+advertise only | Strictly the create+advertise action; listing in Phase 4. | |
| You decide | Default to a basic cohort list. | |

**User's choice:** Basic cohort list.

---

## Draft management depth

| Option | Description | Selected |
|--------|-------------|----------|
| Create, advertise, discard draft | Minimal; editing + advertised-cancel are Phase 5. | ✓ |
| Add draft editing | Also edit a draft's config before advertising. | |
| You decide | Default to create/advertise/discard. | |

**User's choice:** Create, advertise, discard draft.

---

## Claude's Discretion

Left to research/planning: exact operator-route inventory; password hashing vs constant-time raw compare + cookie flags (SameSite/Secure); precise directory-listing endpoint path/DTO; create-form field defaults/validation; `demo-server.ts` restructure once the loop is gone; separate route vs separate bundle for the console; operator console URL (deferred to UI phase); exact content of the new auth ADR.

## Deferred Ideas

- v2: full two-app split for the audited-single-participant-client trust upgrade (ADR 0006 + PMG-01).
- v2: roaming/wallet-like participant client across many services (PMG-01).
- Later: true simultaneous multi-network cohorts (own ADR).
- Later: roster/pre-provisioning (baked-genesis, ADR 0012) in the create form.
- Phase 5: operator open/close/finalize, pause/cancel, reconfigure, runtime network-switching, draft editing, cancel advertised cohort.
- Phase 4: rich live cohort monitoring.
- Phase 6: systematic booth/attendee framing retirement.
- UI phase: operator console URL.
