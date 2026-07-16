---
phase: 2
slug: participant-discovery-browse-and-pick-join
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-16
---

# Phase 2 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time across all nine plans (02-01..02-09); this audit
> verified each mitigation exists in the implementation at L1 grep depth
> (short-circuit rule: threats_open 0 + plan-time register + ASVS L1).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| participant client -> public /v1/adverts transport | The opt-in rides the existing public protocol transport; the picked cohortId is untrusted client input selecting which advert to opt into | cohortId, opt-in payload (sender-key authenticated by the library) |
| anonymous browser -> public /v1/directory + /v1/status | The browse surface and the join-time poll read only these two public endpoints, cookie-less | DirectoryCohortDTO counts only (no member DIDs/keys) |
| operator create form -> gated POST /v1/operator/cohorts | size and threshold (k) are untrusted operator input, re-validated server-side | { beaconType, size, threshold? } wire body |
| operator -> gated POST /v1/operator/cohorts/:id/readvertise | Mutating operator action behind the session gate + same-origin CSRF check, like advertise | cohort id (path param), session cookie |
| store lifecycle <- directory poll (authority) | Best-effort public snapshots drive the join outcome; a fetch error must never read as a closed cohort | public directory rows |
| store <- runner events | cohort-ready is the seat authority; cohort-joined is only "opted in" | runner lifecycle events (cohortId, beaconAddress) |
| participant identity keypair -> browser only | The inline identity step generates/imports a real DID keypair that never leaves the browser | private key material (browser-only) |
| operator k -> committed beacon address (ADR-042 fallback leaf) | createDraft sets fallbackThreshold = k explicitly so the advertised address commits the operator's floor | fallbackThreshold in CohortConfig |
| real-money broadcast path | The k-of-n fallback only produces a broadcastable spend on the opt-in LIVE path; inert on the fixture/offline default | signed beacon tx (opt-in only) |
| terminal-record map | App-side map keyed by cohort id; unbounded growth would be a memory-exhaustion vector | expired CohortConfig + reason (operator-only) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | Tampering / Spoofing | join-by-filter shouldJoin (picked cohortId) | medium | mitigate | `matchesPickedCohort` gate in `packages/participant/src/index.ts:152` joins ONLY the picked cohortId; server sender-auth + phase gating reject a non-Advertised opt-in; `e2e/browse-join-cohort.ts` negative controls (B-picker + random-id picker) prove no seat | closed |
| T-02-02 | Repudiation / Integrity | "seated" derived from the wrong event | medium | mitigate | `seated` flips ONLY in the `cohort-ready` handler (`packages/web/src/stores/participant.ts:584-589`, documented at :118); cohort-joined = "waiting to fill"; capstone asserts the signed cohort id === the picked cohort | closed |
| T-02-03 | Denial of Service | opt-in flood / abandoned seats on the public transport | low | accept | Existing HttpServerTransport RateLimiter + cohortTtlMs/phaseTimeoutMs reclaim (D-16) apply unchanged; see Accepted Risks Log | closed |
| T-02-04 | Information Disclosure | public directory DTO rendered in the browse rows | high | mitigate | DirectoryCohortDTO exposes only cohortId/beaconType/network/threshold/capacity/joined/phase (`packages/service/src/operator-cohorts.ts:145-153`); never member DIDs/keys, only counts | closed |
| T-02-05 | Elevation of Privilege / Info Disclosure | anonymous browse/poll fetch attaching the operator session cookie | medium | mitigate | `fetchStatus`/`fetchDirectory` hard-code `credentials: 'omit'` (`packages/web/src/lib/operator.ts:206,222`); browse + join-time poll reuse these | closed |
| T-02-06 | Denial of Service / UX | unreachable service masquerading as empty/closed | low | mitigate | `directoryView` tracks `reachable` separately from `rows` (`packages/web/src/components/browse/DirectoryList.tsx:19-21`, D-12); store's `handleDirectorySnapshot` runs only on a SUCCESSFUL fetch | closed |
| T-02-07 | Spoofing (crypto) | hand-rolled identity/crypto | low | mitigate | No crypto written this phase: identity reuses the store generate/importSecret over shared helpers; MuSig2/signing stays in `@did-btcr2/aggregation`; custody note rendered (`JoinIdentityStep.tsx:75`) | closed |
| T-05-01 | Tampering / Integrity | hand-crafted create body claiming capacity > threshold | medium | mitigate | Wire body carries no separate capacity; `validateDraft` accepts `{ beaconType, size, threshold? }` and `createDraft` pins `min === max === n` (`operator-cohorts.ts:383`), so a phantom seat is unrepresentable server-side | closed |
| T-05-02 | Information Disclosure | the directory misrepresenting the signing set | low | mitigate | Superseded by the 02-08 two-field model: threshold = k (committed signing floor) and capacity = n (seats) are both truthful by construction; DTO still exposes only counts (see T-KOFN-05) | closed |
| T-06-01 | Elevation of Privilege | anonymous re-advertise | high | mitigate | Route registered inside the `if (operatorCohorts)` block after the requireSameOrigin + requireOperator `/v1/operator/*` prefix guards (`hono-adapter.ts:300,308,362`); spec asserts the no-cookie 401 (`operator-cohorts.spec.ts:463-467`) | closed |
| T-06-02 | Denial of Service | unbounded terminal-record growth | medium | mitigate | `MAX_TERMINAL = 24` with oldest-first eviction in `rememberTerminal` (`operator-cohorts.ts:268,296-300`) | closed |
| T-06-03 | Information Disclosure | an expired cohort leaking to participants | low | mitigate | `terminal` map is NEVER read by `directory()`/`status()` (documented + enforced, `operator-cohorts.ts:287` comment); expired records surface only via the gated `listCohorts()` | closed |
| T-07-01 | Tampering / Elevation | k-of-n fallback spending with fewer than n signers | medium | mitigate | Fallback is the library's ADR-042 script path over the tapleaf committed into the beacon address; `fallbackThreshold` validated integer in `[1, participants]` (`packages/shared/src/index.ts:352-357`); n-of-n key path remains the primary spend | closed |
| T-07-02 | Denial of Service | a single defector failing the whole cohort | low | mitigate | `autoFallbackOnStall` wired through `createService` (`packages/service/src/index.ts:184,432,549`): a stalled round recovers via k-of-n instead of a hard cohort-failed (positive/liveness mitigation) | closed |
| T-07-03 | Real-funds safety | an unintended live fallback broadcast | low | accept | Fallback is inert on the fixture/offline default; live broadcast stays behind the existing `live` + `broadcast` + mainnet guard rails (ADR 0010), unchanged; see Accepted Risks Log | closed |
| T-KOFN-01 | Info Disclosure / Integrity | the co-sign caption implying only k routinely sign | low | mitigate | Caption states the unanimous norm: `all co-sign; anchors if at least k of n sign`, degrading to `all signers required` when k == n (`packages/web/src/lib/directory.ts:103-111`); form help names the stall condition (`CreateCohortForm.tsx:95`) | closed |
| T-KOFN-02 | Repudiation / Integrity | a k over-promise on a service booted with AUTO_FALLBACK=0 | medium | mitigate | `validateDraft` rejects `k < size` with FALLBACK_OFF_ERROR when `autoFallbackOnStall` is off (`operator-cohorts.ts`, Decision 4); k == n stays allowed; undefined treated as OFF (library-parity default) | closed |
| T-KOFN-03 | Tampering | threshold > size / non-integer / null reaching the raw library throw as the 400 body | medium | mitigate | `validateDraft` normalizes `k = threshold ?? size` and guards integer `[1, size]` with the exact THRESHOLD_ERROR before build; the shared library guard (`shared/src/index.ts:355`) stays as a backstop | closed |
| T-KOFN-04 | Tampering | un-pinning min == max == n reintroducing the F1b phantom seat | medium | mitigate | Only `fallbackThreshold` carries k; `config.maxParticipants = size` kept verbatim (`operator-cohorts.ts:383`); config-contract unit assertion pins `fallbackThreshold <= maxParticipants === minParticipants` (`operator-cohorts.spec.ts:480-494`) | closed |
| T-KOFN-05 | Integrity | a partial semantic flip (display changes, server mappers do not) | high | mitigate | All FOUR server emit sites coalesce `threshold: fallbackThreshold ?? minParticipants` / `capacity: maxParticipants ?? minParticipants` (createDraft + directory `operator-cohorts.ts:360-361` + readvertise `:454-455` + listCohorts expired `:480-481`) and landed in ONE plan with the web display; specs assert the read paths on a k < n draft (`operator-cohorts.spec.ts:119-137`) | closed |
| T-KOFN-06 | Integrity | `undefined-of-n` from a legacy config with no fallbackThreshold | low | mitigate | `createDraft` always sets k; every read path coalesces `config.fallbackThreshold ?? config.minParticipants`, so a legacy config emits n-of-n rather than undefined | closed |
| T-KOFN-07 | Integrity (test) | an e2e false-green (fallback completing regardless of the operator's k) | high | mitigate | `e2e/kofn-cohort.ts` uses n = 4 / k = 2, DISTINGUISHABLE from the library's n-1 = 3 default (documented at file header); lower-bound leg (drop 3 -> cohort-failed, NOT signing-complete) proves k gates anchoring; hard event race with no silent skip | closed |
| T-02-G2-01 | Denial of Service (liveness) | an opted-in participant hanging forever while the picked cohort never fills | medium | mitigate | Wait bounded server-side by the cohort's 30-min discovery window (02-06); on expiry the row vanishes, the poll observes the departure and arms the grace, resolving to the filled-or-closed terminal; proven by `participant.spec.ts:151` | closed |
| T-02-G2-02 | Integrity | the grace re-arming on every ~5s poll tick (stacked timers / repeated fail) | high | mitigate | Arming is one-shot, guarded by the `joinGraceLogged` flag (`packages/web/src/stores/participant.ts:312`), cleared on seat/complete/fail/leave; proven by the arm-once spec (`participant.spec.ts:181`) | closed |
| T-02-G2-03 | Integrity (CR-01) | tearing down a genuine member mid-keygen when its cohort locks and leaves Advertised | high | mitigate | The poll never fails an opted-in member directly; the bounded grace window arms only at observed departure and cohort-ready during it seats + clears the timer; proven by `participant.spec.ts:135,168` | closed |
| T-02-G2-04 | Information Disclosure | awaitingSeats leaking more than the public counts | low | accept | `awaitingSeats` carries only `{ joined, capacity }`, both already public in the directory row; no DIDs or keys; see Accepted Risks Log | closed |
| T-02-SC | Tampering (supply chain) | npm/pnpm installs across all nine plans (also registered per-plan as T-05-SC, T-06-SC, T-07-SC, T-KOFN-SC, T-02-G2-SC) | low | accept | Zero new packages the whole phase, verified: `pnpm-lock.yaml` untouched since phase start; the only package.json commits (3c2a9a9, c216b9b, b448712) add e2e scripts only; see Accepted Risks Log | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-03 | Opt-in flood / abandoned seats ride the existing public transport protections: the library HttpServerTransport RateLimiter plus the cohortTtlMs/phaseTimeoutMs reclaim (D-16). No new seat-release protocol was added this phase; residual risk is a low-severity nuisance bounded by the cohort's own 30-min lifetime. | plan-time register (02-01), confirmed at audit | 2026-07-16 |
| AR-02-02 | T-07-03 | An unintended live fallback broadcast is prevented by layering, not new code: the fallback is inert on the fixture/offline default and a real spend still requires the pre-existing `live` + `broadcast` + mainnet opt-in rails (ADR 0010), all unchanged by this phase. | plan-time register (02-07), confirmed at audit | 2026-07-16 |
| AR-02-03 | T-02-G2-04 | `awaitingSeats` exposes only the joined/capacity counts already public in the directory row it was read from; no member DIDs or key material crosses the boundary. | plan-time register (02-09), confirmed at audit | 2026-07-16 |
| AR-02-04 | T-02-SC (+ per-plan SC entries) | Supply-chain exposure is nil this phase: zero new dependencies. Verified at audit: `pnpm-lock.yaml` has no commits since phase start (2026-07-13); the three package.json commits (3c2a9a9, c216b9b, b448712) add only `e2e:browse`/`e2e:fallback`/`e2e:kofn` script lines. | plan-time register (all plans), confirmed at audit | 2026-07-16 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-16 | 25 | 25 | 0 | gsd-secure-phase orchestrator (L1 grep-depth, short-circuit: plan-time register + threats_open 0 + ASVS L1) |

Notes:
- 25 = 24 unique functional threats + the per-plan supply-chain accepts collapsed into T-02-SC.
- T-05-02's plan-time mitigation ("threshold === capacity") was intentionally superseded by the
  02-08 two-field k-of-n model; the underlying threat (directory misrepresenting the signing set)
  is closed by T-KOFN-05's truthful two-field emit sites instead.
- Carry-over reminders from Phase 1 (not Phase 2 scope, tracked in `01-SECURITY.md` / PROJECT.md
  Key Decisions): WR-01 login-throttle keys on raw `socket.remoteAddress` behind a proxy;
  WR-02 NaN `OPERATOR_SESSION_TTL_MS` disables session expiry. Both remain pre-public-deploy
  follow-ups.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-16
