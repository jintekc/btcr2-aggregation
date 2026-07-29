---
status: testing
phase: 05-operator-cohort-lifecycle-control
source: [05-VERIFICATION.md, 05-UAT-CHECKLIST.md]
started: 2026-07-29T15:20:00Z
updated: 2026-07-29T15:20:00Z
---

## Current Test

number: 1
name: Lifecycle ceremony ladder renders as specified
expected: |
  Lifecycle ceremony ladder rendered composition: walk 05-UAT-CHECKLIST.md 'SVC-04 criterion 1' and 'criterion 4' and confirm rung 2 (finalize, k-of-n consequence), rung 3 (cancel, short id + seated count), and rung 4 (funded beacon, type-to-confirm + recovery-key disclosure) render as specified, that in-flight labels hold with both buttons disabled, that a failure leaves the surface unchanged, and that Cancel is HIDDEN rather than disabled after broadcast. Every predicate is unit-tested and every route is behaviorally proven by pnpm e2e:cancel and pnpm e2e:fallback:operator, but no automated test renders the composed confirm panels.
awaiting: user response

## Tests

These are the items `05-VERIFICATION.md` judged to need a human at a running service. The phase scored 7/7 on its ROADMAP success criteria at code level with zero gaps, so nothing here is a known failure: these are the judgments an automated check cannot make. Step-by-step detail for each lives in `05-UAT-CHECKLIST.md`.

Two items (6 and 7) need a real chain or a real wallet and cannot be done hermetically. Item 8 needs a LIVE plus BROADCAST boot.

### 1. Lifecycle ceremony ladder renders as specified
expected: Lifecycle ceremony ladder rendered composition: walk 05-UAT-CHECKLIST.md 'SVC-04 criterion 1' and 'criterion 4' and confirm rung 2 (finalize, k-of-n consequence), rung 3 (cancel, short id + seated count), and rung 4 (funded beacon, type-to-confirm + recovery-key disclosure) render as specified, that in-flight labels hold with both buttons disabled, that a failure leaves the surface unchanged, and that Cancel is HIDDEN rather than disabled after broadcast. Every predicate is unit-tested and every route is behaviorally proven by pnpm e2e:cancel and pnpm e2e:fallback:operator, but no automated test renders the composed confirm panels.
result: [pending]

### 2. Automatic close is narrated as a stage, with no Close button
expected: Automatic-close acknowledgement: confirm on the drill-down timeline that the Closed stage appears with its caption ('Every seat filled, so this cohort locked and stopped accepting joins.') when the nth seat fills, and that no Close button exists anywhere on the console. This is the one deliberate divergence from the literal wording of roadmap SC 1; CONTEXT D-01 locks close as an automatic nth-seat lock because no AggregationServiceRunner primitive exists and a partially filled n-of-n cohort that stopped accepting joins could never proceed. Owner acknowledgement of that re-reading is a judgment call, not a code check.
result: [pending]

### 3. Service controls card and the public paused notice
expected: Service controls card and public paused notice rendered: pause advertising, then load the public directory both with open rows and with none. Confirm the restart-honesty line and full-quiesce guidance are present, that with open rows the paused notice sits ABOVE a still-rendering list, that with no rows the empty-state body reads distinctly from the idle body, and that the controls row wraps on narrow widths. Drain semantics and the served paused bit are proven by pnpm e2e:pause; the composed card and notice are not rendered by any test.
result: [pending]

### 4. Settings surface composition and the long service-name backstop
expected: Settings surface rendered composition plus the 05-07 long-service-name backstop: change beacon type, size, threshold and both windows; save with one invalid field; then save a very long SERVICE_NAME. Confirm each field shows its source caption (env default vs changed this session with the env value), that an invalid field applies NO field, and that a long name renders on both the console health strip and the public directory header without pushing chips off-screen, as plain escaped text. Route semantics (401/413/400), all-or-nothing apply, and read-per-request are unit-tested and passing.
result: [pending]

### 5. Participation terms join step, long body and narrow viewport
expected: Terms join step with terms actually set, plus two 05-13 backstops: set TERMS_TEXT to a long document containing unbroken tokens and URLs, then join at a narrow viewport height. Confirm the body scrolls inside its capped container, wraps unbroken tokens, never escapes the card, never renders as markup or a link target, that the join controls stay reachable below it, and that the app-level enforcement caption is visible. Server-side signature verification, wrong-key refusal, terms-hash binding, no-listing-endpoint and uniform-refusal are all unit-tested and passing (15 tests in packages/service/tests/tos.spec.ts).
result: [pending]

### 6. PART-05 live leg against real third-party esplora hosts
expected: PART-05 live leg against real third-party esplora hosts: try a wrong-chain endpoint, a host that blocks browser requests (no CORS), an unreachable host, and a non-https string. Confirm four distinguishable messages (mismatch naming BOTH chains, browser-rejected, unreachable, malformed) and that no silent fallback occurs in either direction, with the explicit switch-back control offered on failure. Classification, https-only refusal, genesis-hash guard and the single-parameterized-call-site design are unit-tested (packages/web/tests/tx-client.spec.ts, 636 lines) but real CORS and real wrong-chain hosts cannot be exercised hermetically.
result: [pending]

### 7. PART-06 real wallet PSBT round trip
expected: PART-06 real wallet round trip plus the 05-12 large-PSBT backstop: export the unsigned PSBT, sign it in an actual desktop or hardware wallet, return it, and broadcast. Confirm the wallet accepts the exported .psbt, the returned PSBT validates against the template, the broadcast produces the same txid the local path would, and a large pasted PSBT keeps its field scrolling internally without reflowing the step. No wallet interoperability was verified in this environment (RESEARCH assumptions A1/A2), and the 05-14 prohibition correctly forbids claiming any specific wallet works.
result: [pending]

### 8. LIVE plus BROADCAST boot leg and the kill switch
expected: LIVE+BROADCAST boot leg: boot with LIVE=1 BROADCAST=1, engage Disable broadcast, and add test peers to a live cohort. Confirm Disable broadcast is offered only in that boot mode, that after engaging the health strip STILL reports the live boot mode with a separate warn chip beside it, that no route turns broadcast back on, and that the test-peer confirm states BEFORE the act that the peers co-sign for real with throwaway keys. The one-way guarantee, advertise-timestamp mode selection, fail-closed default and absent enable route are unit-tested (packages/service/tests/kill-switch.spec.ts) and the hermetic peer path is proven by pnpm e2e:testpeers.
result: [pending]

### 9. Cancel settle-race backstop
expected: Cancel settle-race backstop (05-01): attempt to cancel a cohort at the instant its signing round completes. Expect a 404 with nothing changed, and never two ended records for one cohort id. The 05-01 plan classified this 'verification: backstop' because the timing race cannot be reliably driven from a test harness.
result: [pending]

## Summary

total: 9
passed: 0
issues: 0
pending: 9
skipped: 0
blocked: 0

## Gaps

<!-- Populated by /gsd-verify-work when a test reports an issue. -->
<!-- NOTE: eight defects confirmed by the adversarial audit are recorded separately in 05-AUDIT.md and routed as todos under .planning/todos/pending/. They are NOT listed here, because this file tracks the human UAT pass, not the audit. -->
