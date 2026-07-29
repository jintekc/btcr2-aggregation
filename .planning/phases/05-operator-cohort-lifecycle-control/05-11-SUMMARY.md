---
phase: 05-operator-cohort-lifecycle-control
plan: 11
subsystem: participant-chain-trust
tags: [esplora, chain-endpoint, trust-minimization, cors, network-guard, react, zustand, vitest]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 10)
    provides: the packages/web/tests/ spec convention and the source-order pin technique this plan reuses
  - phase: 04-operator-cohort-monitoring (plan 06)
    provides: the MIN_REGISTRATION_FUNDING_SATS funding check inside the single register path the endpoint is threaded through
provides:
  - NetworkConfig.genesisHash + NetworkConfig.distinguishingBlock + chainFingerprint - per-network chain identity in the shared registry
  - packages/web/src/lib/esplora.ts - normalizeEndpoint, probeChain, classifyEndpoint, checkEndpoint, confirmTxAt, identifyChain
  - ChainEndpoint - the optional direct-esplora parameter on fetchUtxos and broadcastTx
  - chainEndpointFor + the store's chainEndpoint / chainEndpointVerdict / broadcastDirect / endpointTxConfirmed state
  - packages/web/src/components/cohort/ChainEndpointPanel.tsx - the Chain endpoint disclosure
affects: [05-12 PSBT registration leg, 05-14 phase capstone]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A trust-source override is a PARAMETER on the one existing path, because every guard rail lives at the top of that path and a parallel path is how guards stop firing"
    - "A classification a browser cannot make by reading an error is made by ORDERING the checks instead"
    - "A chain identity is a fingerprint, not a single hash: block zero is ambiguous across the signet family"
    - "An observation that could not be completed is refused, never waved through"
    - "A second opt-in cannot outlive the opt-in it sits inside"
    - "Where a behavioral test would have to fake the thing it proves, a narrow source pin says exactly what it means instead"

key-files:
  created:
    - packages/web/src/lib/esplora.ts
    - packages/web/src/components/cohort/ChainEndpointPanel.tsx
    - packages/web/tests/tx-client.spec.ts
  modified:
    - packages/shared/src/networks.ts
    - packages/shared/src/networks.spec.ts
    - packages/web/src/lib/tx-client.ts
    - packages/web/src/stores/participant.ts
    - packages/web/src/components/cohort/CohortPage.tsx

key-decisions:
  - "Block zero is NOT a chain identity on its own: every signet shares it, so mutinynet (the default network) and plain signet are identical at height 0. The registry carries a second marker at height 1 and the fingerprint is the pair"
  - "The endpoint is one parameter on fetchUtxos and one on broadcastTx inside the single register path, so the ADR 0010 acknowledgment, the re-entrancy guard and the funding check keep firing by construction rather than by discipline"
  - "https only, refused before any request is made: a plain-http endpoint would be blocked as mixed content anyway, and no other scheme belongs in a fetch"
  - "A thrown fetch after a successful URL parse reads as browser-rejected, with unreachable as the documented fallback; the split comes from ordering, never from parsing an opaque TypeError"
  - "An endpoint whose second marker could not be observed is refused as unreachable, because cannot-verify is not the same as verified"
  - "A refused endpoint is never activated, so an endpoint that was typed and an endpoint that is in use can never be confused"
  - "Clearing the endpoint clears the broadcast opt-in with it, and the opt-in cannot be raised without an active endpoint"
  - "The anchor poll still reads the service's cohort-keyed anchor model; the endpoint only confirms a txid the service already named, once per txid"

requirements-completed: [PART-05]

coverage:
  - deliverable: "The zero-config same-origin proxy path is unchanged by this plan"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#reads UTXOs from the shipped proxy route"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#broadcasts through the shipped proxy route and reads the JSON txid"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#treats an endpoint object with no base as no endpoint at all"
        status: pass
      - kind: command
        ref: "pnpm e2e:browse"
        status: pass
      - kind: command
        ref: "pnpm e2e:browser:participant"
        status: pass
  - deliverable: "A participant can read the chain from an endpoint they chose"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#reads UTXOs from the esplora address route"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#activates an endpoint that is on this service's chain"
        status: pass
  - deliverable: "Broadcast through the endpoint is a second explicit opt-in, off by default"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#keeps broadcast on the service while the second opt-in is OFF"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#broadcasts as plain text and reads a BARE txid back, not JSON"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#cannot turn on direct broadcast without an active endpoint"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#drops an active endpoint and its second opt-in on the explicit switch back"
        status: pass
  - deliverable: "A wrong-chain endpoint is refused before any UTXO read, naming both chains"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#names BOTH chains on a mismatch, so the participant can see what happened"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#separates two signet-family chains that SHARE a genesis block"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#refuses rather than passing when a required second marker was not observed"
        status: pass
      - kind: test
        ref: "packages/shared/src/networks.spec.ts#gives every registered network a DISTINCT chain fingerprint"
        status: pass
  - deliverable: "The four failure modes stay four and never collapse"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#keeps browser-rejected and unreachable apart"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#classifies a thrown fetch as browser-rejected, not as unreachable"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#refuses a non-https endpoint BEFORE any request is made"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#tells a browser rejection apart from an unreachable host, in the store too"
        status: pass
  - deliverable: "Every real-funds guard rail fires identically with and without the override"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#fires the mainnet real-funds gate identically with and without an endpoint"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#holds the re-entrancy guard in both modes"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#keeps exactly ONE register path, ONE UTXO call site and ONE broadcast call site"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#keeps the three guards ahead of the chain reads in source order"
        status: pass
  - deliverable: "Nothing ever silently falls back to the service's chain reads"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#has no failure path that quietly retries through the service"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#keeps a refused endpoint INACTIVE and holds its specific verdict"
        status: pass
  - deliverable: "The Chain endpoint disclosure renders every documented E16 state"
    human_judgment: true
    rationale: "Whether the disclosure reads as an addition rather than a missing setting, whether the four failure sentences land as actionable at the moment they appear, and whether a long endpoint truncates gracefully in a real viewport are judgments no unit test makes. Belongs to the phase's participant walkthrough at the end-of-phase gate, alongside the same gap recorded by 05-06 through 05-10."

# Metrics
duration: ~35 min
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 11: Participant Chain Endpoint Override Summary

**A participant can now point their browser's chain reads at an esplora endpoint they chose instead of taking the operator's word for what the chain says, with the same-origin proxy still the zero-config default, broadcast a second deliberate opt-in, a wrong chain refused before it can mislead them, four distinct failure messages, and every real-funds guard rail firing exactly as before because the endpoint is a parameter on the one existing path rather than a second one.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-29
- **Tasks:** 3 (two TDD, so each of those has a RED then a GREEN commit)
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- **Block zero turned out not to be a chain identity, and the default network is exactly where it breaks.** The plan called for a per-network genesis hash and a spec asserting the hashes are distinct. They are not: `mutinynet` and `signet` share block zero, because Bitcoin Core builds a signet's genesis from fixed constants and the signet challenge, the thing that actually separates one signet from another, never enters that hash. Both live endpoints were queried during this plan and returned the identical hash. Left as planned, the guard would have waved a plain-signet endpoint through to a mutinynet participant, which is exactly the confidently-wrong answer T-05-11-03 exists to prevent, on the network this product runs on by default. So a signet-family entry also carries a marker at height 1 (where the two chains have provably diverged, also queried live), and the identity is the PAIR via `chainFingerprint`. The spec asserts fingerprint distinctness, asserts the collision itself so a future Bitcoin Core change would surface rather than rot, and asserts that a marker exists exactly where block zero is ambiguous and nowhere else.
- **The endpoint is a parameter, and that is the entire safety argument.** `register()` opens with the re-entrancy guard, then the ADR 0010 real-funds acknowledgment, then reads UTXOs, then the funding minimum, then broadcasts. All five stay where they were; one value is built once, after the guards, and handed to the two chain calls. There is no second register path, no branch, and nothing to keep in sync. A parallel override flow is precisely how an acknowledgment gate stops firing without anyone deciding it should (05-RESEARCH Pitfall 8), and the gate-parity rows run the same mainnet scenario twice, once with an endpoint active and once without.
- **The four failure modes are four because of ordering, not because of message parsing.** A browser cannot tell a cross-origin rejection from a DNS failure by reading the error: both arrive as an opaque `TypeError`. Guessing from the text would be guesswork dressed as fact. Instead the checks are ordered: parse and scheme-check first (malformed, and no request is made at all), then probe (a thrown fetch is browser-rejected, an answer that cannot be read is unreachable), then compare (mismatch, naming both chains). The split at step two is best-effort by construction, which is why unreachable is the documented fallback and why the browser-rejected copy offers the switch-back button rather than acting on its own.
- **An endpoint that cannot be verified is refused, not trusted.** RESEARCH assumption A3 flagged that the block-height route may not exist on every deployment. The mitigation is implemented literally: an answer that is not a 64-character block hash (an HTML error page, a login wall) classifies as unreachable rather than as a foreign chain, and a signet-family endpoint whose second marker could not be read is refused rather than passed on block zero alone. "Cannot verify" and "verified" are different answers.
- **Nothing silently reverts, in either direction.** A refused endpoint is never activated, so the store can never confuse "an endpoint was typed" with "an endpoint is in use". An active endpoint that fails mid-operation leaves the operation failed with its own message; there is no retry through the service. That is pinned by walking every `catch` block in `register()` (located by brace matching, not by a character window) and asserting neither chain call sits inside one.
- **The second opt-in cannot outlive the first.** Broadcast through the participant's endpoint requires both an active endpoint and an explicit checkbox, defaults off, cannot be raised without an endpoint, and is dropped when the endpoint is cleared. A mis-set endpoint therefore cannot swallow a real transaction on its own; it takes two deliberate acts.
- **The one real difference between the two paths is handled explicitly.** The proxy answers `{ txid }` as JSON; esplora answers the txid as bare text. The direct broadcast reads text and trims. Parsing that as JSON would have thrown on every success, which is the kind of bug a stubbed-fetch spec catches for free and a live test catches expensively.
- **The override does not pretend to replace the anchor read, and says so.** `GET /v1/anchor/:cohortId` is a service read model keyed by COHORT id, and an esplora endpoint has no notion of a cohort. So the anchor poll is untouched: it still reads the service. When an endpoint is active and the service has named a txid, the endpoint is asked about that txid once, as an additional answer, and the panel carries a caption stating plainly which of the two facts came from where.
- **No new dependency, and no chain hash literal in the browser package.** `@did-btcr2/bitcoin` stays out of `packages/web` (the two REST routes are four lines of `fetch`), and every hash the guard compares against is read from the shared registry, including in the specs, so there is exactly one place a chain marker is written down.

## Task Commits

Tasks 1 and 2 are TDD, so each has a RED then a GREEN commit:

1. **Task 1 (RED): failing specs for the chain-endpoint override** - `648aeb1` (test)
2. **Task 1 (GREEN): chain identity in the registry, and a parameterized chain client** - `657c27c` (feat)
3. **Task 2 (RED): failing specs for threading the endpoint through register()** - `d150248` (test)
4. **Task 2 (GREEN): thread the chain endpoint through the ONE register path** - `ca10802` (feat)
5. **Task 3: the Chain endpoint disclosure and its four honest messages** - `d9da394` (feat)

## Files Created/Modified

- `packages/shared/src/networks.ts` - `ChainBlockMarker`, `NetworkConfig.genesisHash`, the optional `NetworkConfig.distinguishingBlock`, and `chainFingerprint` over the pair. Every registered network gets its real block-zero hash; mutinynet and signet also get their height-1 markers, with the reason recorded beside them. The regtest entry states its own honest limit: every regtest chain shares one genesis and no marker can fix that, so the guard's reach there is "a regtest chain", not "your regtest chain".
- `packages/shared/src/networks.spec.ts` (+6 tests) - presence, fingerprint distinctness, the asserted signet-family collision, the marker-exactly-where-needed rule, marker well-formedness, and a pin that the markers stay off the `GET /v1/config` wire DTO.
- `packages/web/src/lib/esplora.ts` (new) - `normalizeEndpoint` (https only, trailing slash stripped), `probeChain` (reusing the shipped `TxProxyError` status-zero convention rather than inventing a second error type), `identifyChain`, the pure `classifyEndpoint`, the cached `checkEndpoint` orchestration, and `confirmTxAt` which never throws.
- `packages/web/src/lib/tx-client.ts` - the `ChainEndpoint` interface and an optional third parameter on `fetchUtxos` and `broadcastTx`. One body, two URL shapes, shared error handling; the direct broadcast reads text and trims.
- `packages/web/src/stores/participant.ts` - `chainEndpoint` / `chainEndpointVerdict` / `chainEndpointProbing` / `broadcastDirect` / `endpointTxConfirmed` state (held outside `INITIAL_OUTCOME`, because an endpoint is a per-browser preference and not per-round state), the exported pure `chainEndpointFor`, the `useChainEndpoint` / `clearChainEndpoint` / `setBroadcastDirect` actions, the endpoint threaded into the two chain calls, and the once-per-txid independent confirmation inside the existing anchor tick.
- `packages/web/src/components/cohort/ChainEndpointPanel.tsx` (new) - the `Chain endpoint` disclosure with every documented state, every string a named module constant.
- `packages/web/src/components/cohort/CohortPage.tsx` - mounts the panel beside the technical-detail expander.
- `packages/web/tests/tx-client.spec.ts` (new, 45 tests) - the byte-identical default path, the direct path, the five verdicts, the store's activate / refuse / clear behavior, the gate-parity rows, and the four source pins.

## Decisions Made

- **A chain identity is a fingerprint.** Block zero plus, where block zero is ambiguous, a second low-height marker. Asserted as a rule (a marker exists exactly where the genesis is shared), not as a list of special cases.
- **https only.** Refused before any request. A plain-http endpoint would be blocked as mixed content on an https deployment anyway, and no other scheme belongs in a `fetch`.
- **Order carries the classification.** Parse, then probe, then compare. No error-message parsing anywhere.
- **Cannot-verify is a refusal.** An unreadable answer or a missing required marker refuses the endpoint rather than passing it on partial evidence.
- **The verdict is cached per endpoint AND per chain.** The same host is a different question on a different chain, and a dead host must not be re-probed on every read.
- **A refused endpoint is never activated.** The store's "active" field and its "verdict" field mean different things and are never conflated.
- **Clearing drops the second opt-in.** An opt-in within an opt-in cannot outlive the one it sits inside.
- **The anchor read stays the service's.** The endpoint confirms a txid; it does not answer about a cohort, because it cannot.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The planned "distinct genesis hash" assertion is false for the default network**

- **Found during:** Task 1
- **Issue:** The plan's acceptance criterion reads "Every registered network has a distinct genesis hash, asserted in the shared spec." Mutinynet and signet share block zero: a signet's genesis is built from fixed constants and its challenge never enters the hash. Confirmed empirically during this plan against both live deployments (`https://mutinynet.com/api/block-height/0` and `https://mempool.space/signet/api/block-height/0` return the same value). Writing the assertion as planned would have required either a false hash in the registry or a spec that cannot pass. Worse, shipping a block-zero-only guard would have let a plain-signet endpoint through to a mutinynet participant, and mutinynet is `DEFAULT_NETWORK`.
- **Fix:** Added the optional `distinguishingBlock` marker (height 1, also queried live for both chains) and `chainFingerprint` over the pair. The spec asserts fingerprint distinctness, plus the collision itself, plus the rule that a marker exists exactly where the genesis is shared. `classifyEndpoint` refuses rather than passes when a required second marker was not observed, and `checkEndpoint` issues the second request only for a signet-family chain and only once block zero already agrees, so the common probe stays one request.
- **Files modified:** packages/shared/src/networks.ts, packages/shared/src/networks.spec.ts, packages/web/src/lib/esplora.ts, packages/web/tests/tx-client.spec.ts
- **Verification:** `packages/web/tests/tx-client.spec.ts#separates two signet-family chains that SHARE a genesis block` fails against a block-zero-only guard and passes now; the shared spec's collision row pins the underlying fact.
- **Committed in:** `657c27c`

**2. [Rule 3 - Blocking] The DTO-leakage assertion did not typecheck**

- **Found during:** Task 1
- **Issue:** `toNetworkConfigDTO(...) as Record<string, unknown>` is a `TS2352` under the repo's strict settings (`NetworkConfigDTO` has no index signature), so `pnpm typecheck`, and therefore `pnpm test`, was red.
- **Fix:** Cast through `unknown`, which is what the compiler asks for and what the neighboring shipped row already does.
- **Files modified:** packages/shared/src/networks.spec.ts
- **Verification:** `pnpm typecheck` clean.
- **Committed in:** `657c27c`

### Deliberate readings of the plan

- **The gate-parity assertions are partly source pins, and the summary says so rather than implying wider coverage.** The plan asks for tests proving the re-entrancy guard and the funding check execute in both modes. Reaching the funding check from a unit test requires the module-private first-update artifacts, which only a real cohort round produces, so a behavioral test there would have to fake the very thing it claims to prove. What is behavioral: the mainnet acknowledgment and the re-entrancy guard, each run twice under the same scenario with and without an active endpoint. What is a source pin: one register path, one UTXO call site, one broadcast call site, both carrying the endpoint, the three guards ahead of them in source order, and no chain call inside any `catch`. The pins are narrow and located by brace matching rather than by a character window, following the 05-10 precedent.
- **`chainEndpointFor` is exported.** The store needs one place that decides what the parameter is, and the specs need to assert that decision without driving a cohort. One exported pure function serves both, rather than a second reading of "is the override on" appearing at each call site.
- **The independent txid confirmation is implemented, with its own copy.** The plan marks it optional. It is in, because the truth list requires the override never to claim it replaced the anchor read, and the clearest way to hold that line is to do the additional check and say plainly what it is. Two lines were authored beyond the UI-SPEC's E16 string set for this: the caption stating the service still reports the cohort's anchor, and the seen / not-seen-yet result.
- **The panel owns its own `Expander`** rather than being wrapped in one by `CohortPage`, whose local `Expander` shadows the shared primitive. The panel imports the shared primitive directly, so it renders the same disclosure treatment as every other one.

---

**Total deviations:** 2 auto-fixed (1 real defect in the plan's factual premise, 1 blocking typecheck), plus 4 documented readings of the plan text.
**Impact on plan:** No file outside `files_modified` changed. The `NetworkConfig` shape gained one more field than the plan named (`distinguishingBlock`), which 05-12 and 05-13 do not consume.

## Issues Encountered

- **The rendered panel is unverified by any automated test**, only its inputs and its copy constants. Whether the disclosure reads as an addition rather than a missing setting, whether each of the four sentences lands as actionable at the moment it appears, and whether a long endpoint truncates gracefully in a real viewport belong to the phase's participant walkthrough. Same gap 05-06 through 05-10 recorded for their surfaces.
- **No test drives a browser participant against a real third-party esplora endpoint.** Doing so would need a reachable, CORS-permitting endpoint on the same chain as the hermetic service, which by construction the hermetic gate does not have. The URL shapes, the classification, the store transitions and the guard parity are each proven; the composed path against a real host is a live-UAT item.
- **The browser-rejected versus unreachable split is best-effort and is documented as such in the source.** After a successful URL parse a thrown `fetch` is more often a browser refusing the cross-origin request than a hostname that vanished, but the browser genuinely does not tell us which. A participant shown the wrong one of these two still has a working next step (the switch-back button, offered with both).
- **The regtest guard cannot distinguish two different local regtest chains.** They share a genesis and their block 1 is deployment-specific, so no marker can be hardcoded. Recorded in the registry beside the entry.

## Known Stubs

None. Every part of this path is wired end to end: the guard compares against real hashes queried from the live chains, the client really targets the esplora routes, the store really threads the parameter into the shipped register path, and the panel really drives the store actions.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/web/tests/tx-client.spec.ts packages/shared/src/networks.spec.ts` (task 1 gate) | 46 tests pass |
| `pnpm typecheck` (task 1 gate) | clean |
| `pnpm vitest run packages/web/tests/tx-client.spec.ts packages/web/src/stores/participant.spec.ts` (task 2 gate) | 110 tests pass |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` (task 2 and 3 gate) | clean |
| `grep -c 'async register' packages/web/src/stores/participant.ts` | 1 (unchanged) |
| `pnpm --filter @btcr2-aggregation/web build` (task 3 gate) | clean |
| `pnpm lint` (task 3 gate) | clean |
| `grep -c 'ConfirmPanel' .../ChainEndpointPanel.tsx` | 0 |
| `grep -c 'const ' .../ChainEndpointPanel.tsx` | 27 (every string a named constant) |
| `pnpm test` (full suite, `tsc -b` gated) | 55 files, 905 tests pass |
| `pnpm e2e:browse` | pass (zero-config default path unchanged) |
| `pnpm e2e:browser:participant` | pass (browser capstone, full loop) |
| `grep -rn '@did-btcr2/bitcoin' packages/web/package.json` | nothing (no new browser dependency) |
| `grep -rlP '\x{2014}' packages/web/src packages/shared/src` | no files |
| `grep -rnE '[0-9a-f]{64}' packages/web/src packages/web/tests` | nothing (no chain hash literal in the browser package) |

## User Setup Required

None. No new environment variable and no new boot requirement. A participant who never opens the disclosure sees no change at all: the same-origin proxy remains the default and needs no setup.

## Next Phase Readiness

- **PART-05 holds.** A participant can read the chain from an endpoint they chose, the proxy is still the zero-config default, broadcast is a second deliberate opt-in, a wrong chain is refused before it can mislead them, the four failure messages stay four, nothing silently reverts in either direction, and every real-funds guard rail fires exactly as it did.
- **The shared registry now carries chain identity**, which is the natural home for any later chain-comparison need (a resolver-side check, a second endpoint, a dual-read verification of the kind the scoping one-pager listed as option 3).
- **`ChainEndpoint` is the shape a later direct-chain caller takes.** 05-12's PSBT leg broadcasts through the same `broadcastTx`, so it inherits the participant's choice with no extra work as long as it keeps using that one call site.
- **Two folded builds remain** (05-12 PSBT registration leg, 05-13 participation terms), both slip-first by the phase's own three-tier order.
- **Carried gap, unchanged from 05-06 onward:** the rendered composition of each new surface is unverified by automated tests and belongs to the end-of-phase walkthrough. This plan adds one more surface to that list, plus the live-endpoint check noted above.

## Self-Check: PASSED

- Created files verified present on disk: `packages/web/src/lib/esplora.ts`, `packages/web/src/components/cohort/ChainEndpointPanel.tsx`, `packages/web/tests/tx-client.spec.ts`.
- Commits verified in git history: `648aeb1`, `657c27c`, `d150248`, `ca10802`, `d9da394`.
- Every task acceptance criterion re-run in this session (with the one factual correction documented above), and the plan-level `<verification>` block re-run in full and green, including both named e2e legs, the dependency grep, and the em-dash grep.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*
