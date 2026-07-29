---
phase: 05-operator-cohort-lifecycle-control
plan: 12
subsystem: participant-external-signing
tags: [psbt, taproot, external-signer, bip174, bip340, react, zustand, vitest]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 11)
    provides: the single guarded register() path with its ChainEndpoint parameter, which the wallet path rides unchanged
  - phase: 04-operator-cohort-monitoring (plan 06)
    provides: the MIN_REGISTRATION_FUNDING_SATS funding check both signing paths share
provides:
  - buildRegistrationTemplate + exportRegistrationPsbt + psbtBytesToBase64 / psbtBase64ToBytes (packages/shared)
  - validateSignedPsbt + PsbtVerdict (packages/web/src/lib/psbt.ts) - the five-verdict returned-PSBT predicate
  - SigningMethod + the store's ephemeral PSBT slice + setSigningMethod / exportPsbt / submitSignedPsbt / clearPsbt
  - selectFundingUtxo - the ONE funding-coin rule the export and the register path share
  - WalletSignPanel + psbtVerdictMessage - the two-step round trip inside the shipped registration section
affects: [05-14 phase capstone]

# Tech tracking
tech-stack:
  added:
    - "@scure/btc-signer ^1.8.1 DECLARED in packages/web (already in the bundle via shared; zero new packages)"
    - "@noble/hashes ^1.8.0 DECLARED in packages/web (same reason)"
  patterns:
    - "A transaction handed out and taken back is compared on its WITNESS-FREE bytes, because signing changes the witness and leaves the transaction id alone"
    - "The second signing path forks as LATE as possible, below every guard, so no guard can be routed around"
    - "A validated artifact is read from the store by the acting method, never passed in as a parameter, so there is no channel for an unvalidated one"
    - "Ephemerality is a placement decision: state that must not outlive a round lives in the slice every teardown already clears"
    - "A source pin located by brace matching, never by slicing to the next known declaration"

key-files:
  created:
    - packages/shared/tests/psbt.spec.ts
    - packages/web/src/lib/psbt.ts
    - packages/web/tests/psbt.spec.ts
    - packages/web/src/components/cohort/WalletSignPanel.tsx
  modified:
    - packages/shared/src/index.ts
    - packages/shared/src/registration.spec.ts
    - packages/web/src/stores/participant.ts
    - packages/web/src/components/cohort/CompletionSummary.tsx
    - packages/web/src/ui/primitives.tsx
    - packages/web/tests/tx-client.spec.ts
    - packages/web/package.json
    - pnpm-lock.yaml

key-decisions:
  - "Raw hex is never compared. An externally-signed transaction has an IDENTICAL transaction id and DIFFERENT raw hex (BIP340 auxiliary randomness lands in the witness, which the txid excludes), so the anchor is the witness-free unsignedTx bytes and both halves of that fact are asserted"
  - "The signed rawHex could not be pinned as a golden literal for the same reason, so the before-and-after pin asserts txid, fee, change and the witness-free body, and says why the fifth value is absent"
  - "The wallet path reads its validated hex from the store rather than taking it as a register() parameter: there is no channel through which unvalidated bytes could reach the broadcast at all"
  - "register() forks below the re-entrancy guard, the mainnet acknowledgment, the chain source and the funding check, so all four fire identically on both paths"
  - "The PSBT slice lives in INITIAL_OUTCOME, so every teardown the store already has clears it; that placement is what makes the ephemeral warning a fact rather than a promise"
  - "Standard padded base64 comes from multiformats (already a shared dependency), not from a new codec and not from a Node-only Buffer"
  - "The fee-out-of-band verdict carries the fee it rejected and the ok verdict carries the txid, because both sentences name a number the participant is asked to act on"
  - "The upload leg sniffs the BIP-174 magic bytes, so a binary .psbt file and a base64 text file are both accepted without guessing at encoding"
  - "The co-sign limit renders under the chooser on BOTH paths, because the expectation it corrects is created by the option existing, not by choosing it"

requirements-completed: [PART-06]

coverage:
  - deliverable: "The registration builder splits into a template and a signer with behavior preserved"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/shared/src/registration.spec.ts#returns the same transaction id, fee, change and transaction body for a fixed input"
        status: pass
      - kind: test
        ref: "packages/shared/tests/psbt.spec.ts#carries every guard the signing builder applies, with identical messages"
        status: pass
      - kind: test
        ref: "packages/shared/tests/psbt.spec.ts#builds the same body the signing builder builds: change first, OP_RETURN last"
        status: pass
      - kind: command
        ref: "pnpm test (57 files, 922 tests)"
        status: pass
  - deliverable: "The transaction is handed out as an unsigned PSBT and comes back as the same transaction"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/shared/tests/psbt.spec.ts#serializes a parseable base64 PSBT that parses back to the exact template it reports"
        status: pass
      - kind: test
        ref: "packages/shared/tests/psbt.spec.ts#reproduces the SAME transaction id as the fully local path"
        status: pass
      - kind: test
        ref: "packages/shared/tests/psbt.spec.ts#produces DIFFERENT raw hex from the local path, which is why raw hex must never be compared"
        status: pass
      - kind: test
        ref: "packages/shared/tests/psbt.spec.ts#refuses to name a transaction id before finalizing, so the validator must not ask"
        status: pass
      - kind: test
        ref: "packages/shared/tests/psbt.spec.ts#tolerates whitespace on the way back in and refuses non-base64 text"
        status: pass
  - deliverable: "A tampered PSBT can never reach broadcast"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/psbt.spec.ts#returns the mismatched verdict for a valid PSBT for a DIFFERENT transaction"
        status: pass
      - kind: test
        ref: "packages/web/tests/psbt.spec.ts#returns the unparseable verdict for anything that is not a PSBT"
        status: pass
      - kind: test
        ref: "packages/web/tests/psbt.spec.ts#returns the unsigned verdict for the app own template, without attempting a finalize"
        status: pass
      - kind: test
        ref: "packages/web/tests/psbt.spec.ts#returns the fee-out-of-band verdict when the transaction pays more than expected"
        status: pass
      - kind: test
        ref: "packages/web/tests/psbt.spec.ts#never throws, for any input, including a template hex that is nonsense"
        status: pass
  - deliverable: "Each of the five verdicts renders its own message"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/psbt.spec.ts#gives each of the five verdicts its OWN sentence, and none before anything comes back"
        status: pass
  - deliverable: "Every real-funds guard rail fires identically on the wallet path"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#keeps exactly ONE register path, ONE UTXO call site and ONE broadcast call site"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#keeps the three guards ahead of the chain reads in source order"
        status: pass
      - kind: test
        ref: "packages/web/tests/tx-client.spec.ts#fires the mainnet real-funds gate identically with and without an endpoint"
        status: pass
  - deliverable: "The shipped browser-signing registration path is unchanged"
    human_judgment: false
    verification:
      - kind: command
        ref: "pnpm e2e:resolve"
        status: pass
      - kind: command
        ref: "pnpm e2e:browser:participant"
        status: pass
      - kind: command
        ref: "pnpm --filter @btcr2-aggregation/web build"
        status: pass
  - deliverable: "Nothing from the round trip is persisted to browser storage"
    human_judgment: false
    verification:
      - kind: command
        ref: "grep -rnE 'localStorage|sessionStorage|indexedDB' packages/web/src/lib/psbt.ts packages/web/src/components/cohort/WalletSignPanel.tsx packages/web/src/stores/participant.ts (no matches)"
        status: pass
  - deliverable: "The rendered two-step round trip and its copy"
    human_judgment: true
    rationale: "Whether the chooser reads as an addition rather than a fork in the road, whether each of the five validation sentences lands at the moment it appears, whether a long PSBT scrolls rather than reflowing the step in a real viewport, and whether a real wallet (Sparrow, Coldcard, Ledger) actually signs this Taproot key-spend with a data output, are judgments no unit test makes. RESEARCH classified wallet interoperability LOW confidence (A1/A2) and recommended a non-blocking owner check; it belongs to the phase walkthrough alongside the same gap recorded by 05-06 through 05-11."

# Metrics
duration: ~40 min
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 12: PSBT Registration Leg Summary

**A participant can now keep their key in their own wallet for the KEY first-update registration: the app hands out the transaction as an unsigned PSBT, takes a signed one back, and refuses to broadcast anything whose witness-free bytes are not byte for byte the transaction this page created, with the broadcast riding the one already-guarded register path, nothing from the round trip touching browser storage, and the MuSig2 co-sign limit stated rather than implied away.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-07-29
- **Tasks:** 3 (two TDD, so each of those has a RED then a GREEN commit), plus one fix
- **Files modified:** 12 (4 created, 8 modified, 2 of which are the package manifest and lockfile)

## Accomplishments

- **The one fact that decides the whole design was measured, not assumed.** An externally-signed transaction has an **identical** transaction id and **different** raw hex: BIP340 signing mixes in auxiliary randomness, that randomness lands in the witness, and the transaction id is taken over the witness-free serialization. Both halves are asserted in `packages/shared/tests/psbt.spec.ts` rather than described, because every other decision here follows from them. A validator comparing raw hex would reject every legitimately signed PSBT; a validator asking for `Transaction.id` before `finalize()` would throw (`Transaction is not finalized`). The anchor is `unsignedTx`, and the check order (parse, template match, signature presence, fee band, finalize) exists because each step is what makes the next one legal.
- **The same fact made one planned assertion impossible, and the spec says so instead of quietly dropping it.** The plan asks the before-and-after pin to compare raw hex. It cannot: two runs of the unchanged builder over the same input already produce different raw hex, so a golden literal would fail against the code it was captured from. The pin therefore captures txid, fee, change and the witness-free body (all deterministic, all captured by running the builder before the split), re-parses the signed transaction to assert the last two, and carries a paragraph explaining which value is absent and why. Everything "the same transaction" can mean here is pinned; nothing is pinned that would have been a lie.
- **The wallet path forks as late as it possibly can.** `register()` runs the re-entrancy guard, the ADR 0010 mainnet acknowledgment, the identity and inclusion guards, builds the participant's chain-source parameter and performs the funding read and the funding minimum, and only THEN asks which signing method is in play. Below the fork both paths converge on the same `broadcastTx` call. There is still exactly one `async register(`, one `fetchUtxos(` and one `broadcastTx(` inside it, and the gate-parity rows from 05-11 pass unchanged.
- **There is no channel through which unvalidated bytes could reach the broadcast.** The wallet branch does not accept a `signedRawHex` parameter; it re-reads the verdict from the store and refuses unless it is `ok`. A caller cannot hand `register()` a transaction, which is a stronger property than validating one that was handed in, and it means the byte comparison is unavoidably on the path rather than merely usually on it (T-05-12-01, T-05-12-03).
- **Ephemerality is a placement decision, so the warning is a fact.** The signing method, the exported PSBT, its template anchor, the returned text and the verdict all live in `INITIAL_OUTCOME`, the per-round slice that `adopt()`, the join reset and the initial state all spread. Every teardown the store already had now clears the round trip too, without a new teardown path to remember. A repository grep for the three browser storage APIs over the validator, the panel and the whole participant store returns nothing (T-05-12-02).
- **The success copy describes what the wallet actually signed.** The fee, the amount paid and the destination address in the ok verdict are all read off the returned transaction (`tx.fee`, `tx.getOutput(0).amount`, `tx.getOutputAddress(0, ...)`), never from remembered state, and the spec asserts the address really is this participant's own beacon address rather than a literal that happens to match (T-05-12-05).
- **The rejection sentences name their numbers.** The fee-out-of-band verdict carries the fee it rejected, because the copy asks the participant to go check that fee in their wallet and cannot ask them to check a number it did not tell them. The ok verdict carries the transaction id, readable only after `finalize()`, which is also what the failed-broadcast branch keeps so a transaction that may have landed can still be looked up.
- **One funding rule, two consumers.** `selectFundingUtxo` is exported and shared by the export and the register path, so the transaction handed to a wallet spends the coin the registration would have spent. Two copies of that rule is exactly how the exported PSBT and the funding check would come to disagree.
- **Both interchange forms are accepted without guessing.** A `.psbt` file is binary and a pasted PSBT is base64; the upload leg sniffs the BIP-174 magic bytes to tell them apart, and the base64 decoder strips all whitespace first, because a PSBT that travelled through a wallet, a chat window or a text file arrives wrapped. A decode failure returns null rather than throwing, so the caller produces a sentence instead of handling an exception.
- **No new package entered the repository.** The PSBT round trip needs none: `@scure/btc-signer`'s `Transaction` IS a PSBT and already builds this exact transaction, and standard padded base64 comes from `multiformats`, already a shared dependency. The two entries added to `packages/web/package.json` declare libraries that were ALREADY in the browser bundle through `@btcr2-aggregation/shared`; the lockfile grew by six lines and pnpm downloaded and added nothing.

## Task Commits

Tasks 1 and 2 are TDD, so each has a RED then a GREEN commit:

1. **Task 1 (RED): failing specs for the registration PSBT round trip** - `7f87280` (test)
2. **Task 1 (GREEN): split the registration builder into a template and a signer** - `ddaf379` (feat)
3. **Task 2 (RED): failing specs for the returned-PSBT validator** - `c38ef1a` (test)
4. **Task 2 (GREEN): the pure returned-PSBT validator with five discriminated verdicts** - `b89a7d8` (feat)
5. **Task 3: the wallet round trip, its ephemeral warning and the honest co-sign limit** - `91febc0` (feat)
6. **Fix: brace-match the register() body in the guard-rail pins** - `7896fed` (fix)

## Files Created/Modified

- `packages/shared/src/index.ts` - `RegistrationTxOptions`, `buildRegistrationTemplate` (every guard and every construction step verbatim, up to but not including `sign()`, with the load-bearing output-ordering comment kept on the body it governs), `exportRegistrationPsbt` (`{ base64, templateHex }`), `psbtBytesToBase64` / `psbtBase64ToBytes`, and `buildSingletonRegistrationTx` recomposed from the template, reading `fee` and `change` back off the built transaction rather than recomputing them.
- `packages/shared/tests/psbt.spec.ts` (new, 8 tests) - guard parity, the export and its anchor, whitespace-tolerant decoding, the round trip's txid parity and raw-hex divergence, the pre-finalize `id` throw, and the address read from the transaction. The first spec under `packages/shared/tests/`.
- `packages/shared/src/registration.spec.ts` (+1 test) - the golden before-and-after pin, captured by running the builder pre-refactor, with the two long runs written as repeats of the fixed inputs so a transcription typo cannot fake a pass.
- `packages/web/src/lib/psbt.ts` (new) - `PsbtVerdict` and `validateSignedPsbt`, pure and DOM-free, with a doc-comment that justifies each branch and states both traps and the reason for the ordering.
- `packages/web/tests/psbt.spec.ts` (new, 8 tests) - each verdict from its own real transaction (a different update hash, a different key, a different UTXO, the unsigned template, an out-of-band fee, four kinds of non-PSBT bytes), plus the five distinct messages.
- `packages/web/src/stores/participant.ts` - `SigningMethod`, the ephemeral PSBT slice inside `INITIAL_OUTCOME`, `setSigningMethod` / `exportPsbt` / `submitSignedPsbt` / `clearPsbt`, the exported `selectFundingUtxo`, and the late fork inside the one `register()`.
- `packages/web/src/components/cohort/WalletSignPanel.tsx` (new) - the chooser, the co-sign limit, the two numbered steps, the binary `.psbt` download and the base64 copy, the upload plus the `Paste instead` expander with its warn-tone warning, the per-verdict message, the ephemeral note, and the exported `BROADCAST_LABEL` and `psbtVerdictMessage`.
- `packages/web/src/components/cohort/CompletionSummary.tsx` - mounts the panel inside the shipped `Register first update` section and relabels its ONE inherited primary button to `Broadcast signed transaction`, disabled for every verdict except ok.
- `packages/web/src/ui/primitives.tsx` - `copyToClipboard` exported (one keyword) so the `Copy PSBT (base64)` button reuses the shipped non-secure-origin fallback instead of a second copy of it.
- `packages/web/tests/tx-client.spec.ts` - the `register()` extractor now brace-matches, plus an assertion that it really stopped at the method's own closing brace.
- `packages/web/package.json` + `pnpm-lock.yaml` - `@scure/btc-signer` and `@noble/hashes` declared; six lockfile lines, nothing downloaded.

## Decisions Made

- **The comparison anchor is `unsignedTx`.** Never raw hex, never `extract()` output, and `id` is never requested before `finalize()`.
- **The pin asserts what is deterministic and says what is not.** Signed raw hex cannot be a golden literal; txid, fee, change and the witness-free body can.
- **The wallet path reads its hex from the store.** No parameter, therefore no injection surface.
- **The fork sits below every guard.** Sharing the guards is the safety argument; a branch above them would be how one stops firing.
- **The round trip lives in the per-round slice.** Placement, not discipline, is what clears it.
- **Base64 comes from a dependency that is already here.** `multiformats` `base64pad`, not a new codec and not a Node-only `Buffer`.
- **Rejections name their numbers.** The fee verdict carries the fee; the ok verdict carries the txid.
- **The upload sniffs the magic bytes.** Binary and base64 are both accepted, neither is guessed at.
- **The co-sign limit renders on both paths.** The option creates the expectation; the correction belongs beside the option.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/web` could not import the libraries the validator needs**

- **Found during:** Task 2 (and again in its spec)
- **Issue:** The plan and RESEARCH both place `Transaction.fromPSBT` inside `packages/web/src/lib/psbt.ts`, but under pnpm's strict layout `packages/web` had neither `@scure/btc-signer` nor `@noble/hashes` declared, so neither resolved from that directory. The spec could not even load.
- **Fix:** Declared both in `packages/web/package.json` at the versions already in the lockfile. Both were ALREADY in the browser bundle: `packages/web` imports `@btcr2-aggregation/shared`, which imports both to build this very transaction, and the participant store already calls `buildSingletonRegistrationTx` in the browser. So this changes nothing about what ships and adds nothing to the supply chain: `pnpm install` reported `downloaded 0, added 0` and the lockfile grew six lines linking versions it already carried. It makes an import that was going to exist anyway honest, rather than relying on hoisting.
- **Files modified:** packages/web/package.json, pnpm-lock.yaml
- **Verification:** `ls packages/web/node_modules/@scure` resolves to the existing `.pnpm` entry; `pnpm --filter @btcr2-aggregation/web build` green; the built chunk sizes are unchanged in kind (scure was already inside them).
- **Committed in:** `c38ef1a`

**2. [Rule 1 - Bug] The 05-11 guard-rail pin fails for the wrong reason as soon as anything is added after `register()`**

- **Found during:** Task 3 (`pnpm test` after the store change)
- **Issue:** `registerBody()` sliced the source from `async register(` to `async resolve(`. The four new PSBT actions sit between those two, so the slice swallowed `exportPsbt` and its funding read was counted as a SECOND `fetchUtxos(` call site inside `register()`. The pin is the one that proves the override did not create a second chain-read path, so a false alarm there is worse than none: the next reader disarms it.
- **Fix:** Walk from `async register(` to its own matching closing brace, and assert in the row itself that the slice really stopped there (it must not contain `async exportPsbt(` and must end on a brace), so the extractor cannot silently widen again.
- **Files modified:** packages/web/tests/tx-client.spec.ts
- **Verification:** all 45 rows in `tx-client.spec.ts` pass, including the one-register-path / one-UTXO-call / one-broadcast-call row it now measures correctly; `pnpm test` 922 tests green.
- **Committed in:** `7896fed`

**3. [Rule 3 - Blocking] The clipboard helper was module-private**

- **Found during:** Task 3
- **Issue:** The UI-SPEC calls for a ghost `Copy PSBT (base64)` button, but `copyToClipboard` (with its non-secure-origin `execCommand` fallback) was private to `primitives.tsx`.
- **Fix:** Exported it (one keyword). A second copy of that fallback in the panel is exactly the drift the primitives module exists to prevent.
- **Files modified:** packages/web/src/ui/primitives.tsx
- **Verification:** `pnpm lint`, `tsc --noEmit` and the web build all green; `CopyField` is unchanged and still uses it.
- **Committed in:** `91febc0`

### Deliberate readings of the plan

- **The raw-hex equivalence assertion was replaced, and the replacement is documented in the spec rather than only here.** The plan's task-1 behavior list and acceptance criteria both ask that the signing builder return "the same raw hex" for a fixed input. It never did and never could: `pnpm vitest` proves two consecutive calls with an identical fixed key and UTXO already differ. Writing the assertion as specified would have produced a red suite against unmodified code. The pin covers txid, fee, change and the witness-free body, and re-parses the signed transaction to confirm both of the latter.
- **The wallet path takes no rawHex parameter.** The plan says to "feed the validated raw hex into the SAME broadcast call site". It does, but by reading the verdict inside `register()` rather than by accepting bytes from the panel. Same call site, one fewer way to get it wrong.
- **The verdict union is slightly wider than RESEARCH's sketch.** The ok variant also carries `txid` (readable only after `finalize()`), and the fee-out-of-band variant carries `feeSats`. Both exist because the UI-SPEC sentences name those numbers and the failed-broadcast branch needs a txid to keep.
- **The export runs automatically when the wallet path is chosen.** It needs a funding read the participant cannot perform, so making it a button would have meant a step that says "download" but sometimes means "look up your coins first". It does NOT retry after a failure: the failure renders its own retry, so an unreachable endpoint cannot become a request loop.
- **Four strings were authored beyond the UI-SPEC set**, in the 05-11 tradition of saying so: the `Where to sign` chooser micro-label, the `Unsigned PSBT (base64)` expander title, and the export's busy line plus its `Try again` (an export can fail on a chain read, and a state with no way forward is worse than one more sentence). The copy button's transient labels follow `CopyField`'s shipped pattern.
- **`selectFundingUtxo` was extracted and exported.** The plan does not mention it, but the export and the register path must pick the same coin or the transaction handed out is not the one the funding check verified.
- **The panel's own expander is the shared primitive**, not a local one, so the base64 sits inside the same scroll-capped disclosure treatment as every other detail on the page.

---

**Total deviations:** 3 auto-fixed (1 real defect in the plan's factual premise about raw hex, which is also recorded as a deliberate reading because it changes an acceptance criterion; 1 pre-existing fragile pin promoted to a real failure by this plan's additions; 1 blocking visibility fix), plus 7 documented readings of the plan text.
**Impact on plan:** Three files outside `files_modified` changed: `packages/web/src/ui/primitives.tsx` (one keyword), `packages/web/tests/tx-client.spec.ts` (the extractor), and `packages/web/package.json` with the lockfile. No shipped behavior outside the registration section changed.

## Issues Encountered

- **The rendered panel is unverified by any automated test**, only its inputs, its verdict mapping and its copy constants. Whether the chooser reads as an addition rather than a fork, whether each of the five sentences lands at the moment it appears, and whether a long PSBT scrolls rather than reflowing the step in a real viewport belong to the phase walkthrough. Same gap 05-06 through 05-11 recorded.
- **No wallet was tested.** RESEARCH classified wallet interoperability as its single LOW-confidence claim (A1/A2) and recommended a non-blocking owner check rather than a blocking gate. The PSBT this app emits is standards-correct and empirically round-tripped through `@scure/btc-signer`, and no shipped copy claims compatibility with any named wallet. Whether Sparrow, Coldcard or Ledger signs a Taproot key-spend carrying an `OP_RETURN` output is an owner UAT item for 05-14.
- **The funding coin can change between export and return.** If the beacon address is spent or re-funded while the participant is off signing, the returned transaction spends a coin that no longer exists and the broadcast fails with the node's own message. That is honest rather than silent, and re-exporting fixes it, but nothing warns about it up front.
- **A returned PSBT for a template built with a non-default fee would validate ok against a lower expected fee only if it is not higher.** The app only ever exports at `REGISTRATION_FEE_SATS`, so the band is exact in practice; the fee branch survives as defence in depth for a future looser comparison, and its spec row builds its own template to reach it.

## Known Stubs

None. The whole path is wired end to end: the export really reads the chain and builds the real transaction, the validator really parses and finalizes real PSBTs, the panel really drives the store, and the broadcast really goes through the shipped `broadcastTx` call inside the shipped `register()`.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/shared/tests/psbt.spec.ts packages/shared/src/registration.spec.ts` (task 1 gate) | 19 tests pass |
| `pnpm typecheck` (task 1 gate) | clean |
| `pnpm vitest run packages/web/tests/psbt.spec.ts` (task 2 gate) | 8 tests pass |
| `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` (task 2 and 3 gate) | clean |
| `pnpm --filter @btcr2-aggregation/web build` (task 3 gate) | clean |
| `pnpm lint` (task 3 gate) | clean |
| `pnpm test` (full suite, `tsc -b` gated) | 57 files, 922 tests pass |
| `pnpm e2e:resolve` | pass (KEY and EXTERNAL, CAS and SMT, unchanged) |
| `pnpm e2e:browser:participant` | pass (browser capstone, full loop, shipped signing path) |
| `grep -rnE 'localStorage\|sessionStorage\|indexedDB'` over `psbt.ts`, `WalletSignPanel.tsx`, `participant.ts` | no matches |
| `grep -rlP '\x{2014}'` over `packages/web/src packages/shared/src` | no files |
| `git diff packages/shared/package.json` | empty (no new dependency in shared) |
| `grep -c 'async register' packages/web/src/stores/participant.ts` | 1 (unchanged) |
| `grep -c 'await broadcastTx(' packages/web/src/stores/participant.ts` | 1 (unchanged) |
| `grep 'variant=' WalletSignPanel.tsx` | 3 matches, all `ghost` (no new accent button) |

## User Setup Required

None. No new environment variable and no new boot requirement. A participant who never opens the chooser sees the shipped registration flow, byte for byte.

## Next Phase Readiness

- **PART-06 holds.** The registration transaction is exported as an unsigned PSBT, signed anywhere the participant keeps their key, returned, validated strictly enough that a tampered PSBT cannot reach broadcast, and broadcast through the same guarded path as the browser flow. Nothing from the round trip is persisted, and the co-sign limit is stated rather than implied away.
- **The template split is reusable.** Anything that later needs the registration transaction without signing it (a fee-bump preview, a second export format, a QR leg) now has `buildRegistrationTemplate` instead of a reason to copy the builder.
- **The wallet path inherits 05-11 for free.** It reads and broadcasts through the same `fetchUtxos` / `broadcastTx` calls, so a participant with their own esplora endpoint keeps it on this path with no extra work, exactly as 05-11 predicted.
- **One folded build remains** (05-13 participation terms), the last of the three slip-first items.
- **Carried gap, unchanged from 05-06 onward:** the rendered composition of each new surface is unverified by automated tests. This plan adds one more surface to that list, plus the wallet-interoperability check noted above.

## Self-Check: PASSED

- Created files verified present on disk: `packages/shared/tests/psbt.spec.ts`, `packages/web/src/lib/psbt.ts`, `packages/web/tests/psbt.spec.ts`, `packages/web/src/components/cohort/WalletSignPanel.tsx`.
- Commits verified in git history: `7f87280`, `ddaf379`, `c38ef1a`, `b89a7d8`, `91febc0`, `7896fed`.
- Every task acceptance criterion re-run in this session (with the one factual correction documented above), and the plan-level `<verification>` block re-run in full and green, including both named e2e legs and both greps.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*
