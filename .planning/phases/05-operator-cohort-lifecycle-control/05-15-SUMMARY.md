---
phase: 05-operator-cohort-lifecycle-control
plan: 15
subsystem: security
tags: [bitcoin, psbt, taproot, bip341, sighash, scure-btc-signer, react, vitest]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control
    provides: "the wallet-signing path (05-11, 05-12): exportRegistrationPsbt, validateSignedPsbt, WalletSignPanel and the register() broadcast that consumes the verdict"
provides:
  - "isAcceptedTapKeySig: the single, exported definition of which taproot key signatures commit to every output of the transaction they sign"
  - "the bad-sighash member of the PsbtVerdict refusal union, returned before any finalize so no broadcastable hex is produced for a refused signature"
  - "VERDICT_BAD_SIGHASH: its own participant-facing sentence, so the switch default arm no longer mislabels it as unparseable"
  - "the per-flavour spec matrix (0x02, 0x82, 0x03, 0x83, 0x81 refused; 64-byte and explicit 0x01 accepted) plus direct predicate rows for the default-refuse branch"
affects: [wallet-signing, registration-broadcast, psbt-validation, security-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Positive accepted-set gates rather than blacklists for security-relevant enums, so an unenumerated value is refused by default"
    - "One rule, one exported definition, one call site: the predicate is exported specifically because its default branch is unreachable through the public API, so it can be pinned directly instead of only through a path that cannot reach it"
    - "A test that cannot be reached honestly is scoped honestly: the impossible-length row asserts the LIBRARY's existing refusal and names the coder that produces it, rather than asserting the app-level reason it can never produce"

key-files:
  created: []
  modified:
    - packages/web/src/lib/psbt.ts
    - packages/web/src/components/cohort/WalletSignPanel.tsx
    - packages/web/tests/psbt.spec.ts

key-decisions:
  - "Pinned the ACCEPTED sighash set (64-byte SIGHASH_DEFAULT, or 65-byte trailing 0x01) rather than blacklisting SIGHASH_NONE, because five non-default flavours passed and each breaks a different guarantee"
  - "Extracted the rule into an exported isAcceptedTapKeySig with exactly one call site, so the default-refuse branch is testable directly and no inline duplicate of the comparison survives"
  - "Kept the impossible-length public-API row, constructed by splicing ONLY the tapKeySig field's length prefix and value, asserting the library's own SignatureSchnorr message plus the existing unparseable verdict"
  - "Corrected the psbt.ts docstring's completeness claim: the witness-free byte comparison pins version, inputs, outputs, amounts, scripts and locktime, and provably cannot see the sighash flag"

patterns-established:
  - "Accepted-set over blacklist: security enums are gated by what is allowed, never by what is known to be bad"
  - "Honest test scoping: a row that a dependency refuses first asserts the dependency's outcome and names the coder, and the app-level branch is pinned at the predicate instead"

requirements-completed: [PART-06]

coverage:
  - id: D1
    description: "A returned PSBT signed under a sighash flavour that does not commit to every output is refused with its own bad-sighash verdict, before any finalize, so its raw hex never reaches a broadcast call"
    requirement: PART-06
    verification:
      - kind: unit
        ref: "packages/web/tests/psbt.spec.ts#returns the bad-sighash verdict for a signature that does not commit to the outputs"
        status: pass
      - kind: unit
        ref: "packages/web/tests/psbt.spec.ts#the accepted sighash set, one row per flavour the audit executed > refuses 0x02 / 0x82 / 0x03 / 0x83 / 0x81"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both legitimate signature shapes still pass: a 64-byte BIP340 signature (SIGHASH_DEFAULT, the shipped browser path) and a 65-byte signature whose trailing byte is an explicit SIGHASH_ALL"
    requirement: PART-06
    verification:
      - kind: unit
        ref: "packages/web/tests/psbt.spec.ts#accepts a 64-byte signature, which is SIGHASH_DEFAULT and the common wallet default"
        status: pass
      - kind: unit
        ref: "packages/web/tests/psbt.spec.ts#accepts a 65-byte signature whose flag is an explicit SIGHASH_ALL"
        status: pass
      - kind: unit
        ref: "packages/web/tests/psbt.spec.ts#returns the ok verdict for a correctly signed round trip, despite differing raw hex"
        status: pass
    human_judgment: false
  - id: D3
    description: "The accepted-set rule has one exported definition and one call site, and its default-refuse branch is pinned directly over the full length and trailing-byte table"
    requirement: PART-06
    verification:
      - kind: unit
        ref: "packages/web/tests/psbt.spec.ts#isAcceptedTapKeySig > accepts the two legitimate shapes and nothing else"
        status: pass
      - kind: unit
        ref: "packages/web/tests/psbt.spec.ts#isAcceptedTapKeySig > refuses by DEFAULT, so a length nobody enumerated is not silently blessed"
        status: pass
      - kind: other
        ref: "grep -c 'isAcceptedTapKeySig' packages/web/src/lib/psbt.ts == 3; grep -v '^\\s*[/*]' packages/web/src/lib/psbt.ts | grep -c \"reason: 'bad-sighash'\" == 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "The refusal renders its own participant-facing sentence rather than falling through to the unparseable copy, and every verdict in the union still maps one to one onto a distinct string"
    requirement: PART-06
    verification:
      - kind: unit
        ref: "packages/web/tests/psbt.spec.ts#gives each of the six verdicts its OWN sentence, and none before anything comes back"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-30
status: complete
---

# Phase 5 Plan 15: Pin the sighash type in the registration PSBT validator Summary

**`validateSignedPsbt` now pins the ACCEPTED taproot sighash set (64-byte SIGHASH_DEFAULT, or 65 bytes trailing 0x01) through one exported `isAcceptedTapKeySig`, so a PSBT whose signature does not commit to this transaction's outputs is refused with its own verdict and its own sentence before any finalize, instead of being blessed as ok and broadcast.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-30T14:07:00Z
- **Completed:** 2026-07-30T14:15:00Z
- **Tasks:** 2 (both TDD, 4 commits)
- **Files modified:** 3

## Accomplishments

- Closed audit defect 1 (05-AUDIT.md entry 3, HIGH, real funds): every one of the five non-default sighash flavours the audit executed against the shipped validator is now refused.
- The rule is an accepted set, not a blacklist, so an unenumerated flavour is refused by default rather than silently blessed.
- The refusal is returned between the unsigned check and the fee band, so `tx.finalize()` and `tx.extract()` are never reached for it and no broadcastable hex exists for a refused signature.
- The participant gets a sentence that names the real problem (their wallet locked the wrong thing) and the real action (re-sign with the wallet's default signature type), instead of being told the PSBT is unparseable when it parses perfectly.
- The `psbt.ts` docstring's false completeness claim is corrected: the witness-free comparison pins version, inputs, outputs, amounts, scripts and locktime, and the sighash flag is provably outside those bytes.

## Red-before-green, recorded

**Task 1, SIGHASH_NONE (0x02), observed against the pre-fix validator.** The new assertion failed exactly as the audit predicted. Verbatim from the run:

```
AssertionError: expected { ok: true, feeSats: 1000n, ...(4) } to deeply equal { ok: false, reason: 'bad-sighash' }
+   "feeSats": 1000n,
+   "ok": true,
+   "paysSats": 99000n,
+   "toAddress": "tb1pkuewyvlssrh5l3v2jrftaajkmulsre2yjwc09ajquj8pzwypyw4qmvk40z",
+   "txid": "3ecd4bc46422ce603a0a5fe76e1d6cfd2a4f0804e2bfac462fcd9794ecc87746",
```

A PSBT whose signature commits to no output at all returned `ok: true` carrying a valid txid and broadcastable `rawHex`. The `psbtVerdictMessage` row was red alongside it (`expected 5 to be 6`).

**Task 2, all five flavours, observed against the pre-fix validator.** The Task 2 matrix was run with `packages/web/src/lib/psbt.ts` temporarily restored to its pre-fix content (`git show 8bdd4ad:packages/web/src/lib/psbt.ts`), which is the honest way to observe red for rows written after Task 1's partial gate already landed. All eight new assertions failed:

```
× refuses 0x02, because NONE commits to no output at all ...
× refuses 0x82, because NONE|ANYONECANPAY frees the outputs AND lets an attacker append inputs
× refuses 0x03, because SINGLE commits to output 0 but leaves the OP_RETURN at vout 1 rewritable
× refuses 0x83, because SINGLE|ANYONECANPAY leaves the OP_RETURN rewritable and the input set open
× refuses 0x81, because ALL|ANYONECANPAY commits to the outputs but lets an attacker append inputs
× isAcceptedTapKeySig > accepts the two legitimate shapes and nothing else
× isAcceptedTapKeySig > refuses by DEFAULT, so a length nobody enumerated is not silently blessed
Tests  8 failed | 11 passed (19)
```

The two acceptance rows and the impossible-length row passed pre-fix, which is correct: they assert behaviour that must NOT change.

## The impossible-length row was KEPT, not dropped

The plan permitted dropping the 63-byte / 66-byte public-API row if the bytes could not be produced without a stub. They could. The row splices ONLY the `tapKeySig` field's length prefix and value inside an otherwise valid serialized PSBT (`spliceTapKeySigLength`), locating the BIP-174 field marker by scan and throwing on an ambiguous scan rather than guessing. The parsed transaction is never stubbed and the PSBT is never generically corrupted, so the row really does exercise signature length.

Its scope is stated in the test itself and is deliberately narrow: it asserts that `@scure/btc-signer@1.8.1`'s own `SignatureSchnorr` coder throws `Schnorr signature should be 64 or 65 bytes long` inside `Transaction.fromPSBT`, and that the public-API outcome is therefore the EXISTING `unparseable` verdict, not the new one. The app's own default-refuse branch is pinned by the `isAcceptedTapKeySig` rows instead, which is exactly what the predicate was extracted for.

## Task Commits

1. **Task 1 (tracer, TDD) RED** - `8bdd4ad` (test): the `walletSignWithSighash` helper, the SIGHASH_NONE row, the six-sentence count.
2. **Task 1 GREEN** - `9e5ead7` (fix): the `bad-sighash` union member, the gate beside the signature-presence check, the docstring correction, the `VERDICT_BAD_SIGHASH` copy and its `case`.
3. **Task 2 RED** - `f0acc46` (test): the five-flavour matrix, the two acceptance rows, the direct predicate block, the spliced impossible-length row.
4. **Task 2 GREEN** - `9f542ac` (fix): `isAcceptedTapKeySig` as the single definition, called once from `validateSignedPsbt`, with Task 1's inline comparison deleted.

**Plan metadata:** see the final `docs(05-15)` commit.

## Files Created/Modified

- `packages/web/src/lib/psbt.ts` - Added `'bad-sighash'` to the refusal union; added the exported `isAcceptedTapKeySig` predicate with its rationale (why an accepted set, why exported, why no inline duplicate); read `tapKeySig` into a local and applied the predicate as check (3b), between the unsigned check and the fee band; corrected the docstring's completeness claim and the ordered-check list.
- `packages/web/src/components/cohort/WalletSignPanel.tsx` - Added the `VERDICT_BAD_SIGHASH` copy constant and its `case` in the `psbtVerdictMessage` switch, so the `default` arm no longer absorbs the reason into the unparseable sentence.
- `packages/web/tests/psbt.spec.ts` - Added `walletSignWithSighash` and `spliceTapKeySigLength` helpers; the SIGHASH_NONE end-to-end row; the five-flavour refusal matrix; both acceptance rows with the signature shape asserted before the verdict; the direct `isAcceptedTapKeySig` block including an exhaustive sweep of all 256 trailing-byte values; the spliced impossible-length row; and the verdict-sentence count corrected from five to six.

## Decisions Made

- **Accepted set, not a blacklist.** Both audit skeptics converged on this independently, and the corrected taxonomy is why: 0x02 and 0x82 free the outputs (change theft), 0x03 and 0x83 leave the OP_RETURN at vout 1 rewritable (the registration signal is destroyed or substituted), 0x81 lets an attacker append inputs. Three different failure modes, one gate.
- **The predicate is exported, and that is load-bearing rather than incidental.** The library refuses a non-64-or-65-byte `tapKeySig` before this app sees it, so "an unenumerated length is refused" cannot be observed end to end. Exporting the rule is what lets that property be pinned honestly.
- **Exactly one definition, exactly one call site.** Task 1's inline comparison was deleted when Task 2's predicate landed, verified by grep (`isAcceptedTapKeySig` appears 3 times: the definition, the `{@link}` in the check comment, and the single call; `reason: 'bad-sighash'` appears exactly once outside comments). A surviving inline copy beside an exported predicate is the shape of audit defect 8.
- **The 65-byte explicit-ALL case is accepted.** A wallet that always writes the flag byte is legitimate and must not be locked out; 0x01 commits to every output, which is the property being protected.

## Deviations from Plan

None - plan executed exactly as written.

The one plan-permitted branch point (whether to keep or drop the impossible-length public-API row) resolved to KEEP, with the byte-splice approach the plan explicitly allowed and the scope comment it required. No substitution through generic corruption was made.

## Issues Encountered

- The first draft of `spliceTapKeySigLength` hardcoded the 65-byte field marker (`0x01 0x13 0x41`) while the row feeds it a 64-byte SIGHASH_DEFAULT signature. Corrected before any run by deriving the current signature length from the parsed input, which also makes the helper work for either shape.
- `packages/web/tests/psbt.spec.ts` contains one long dash, at line 288, inside the pre-existing `expect(m).not.toMatch(...)` copy-contract assertion whose regex literal IS that character. It is the assertion's own subject and cannot be written without it, and it is pre-existing rather than authored here. Both source files this plan touches are clean, which is what the acceptance criterion greps.

## Verification

- `pnpm vitest run packages/web/tests/psbt.spec.ts packages/shared/tests/psbt.spec.ts` green. The shared spec is a read-only regression run per this round's rule and no expectation in it moved, so it stayed out of `files_modified`.
- `pnpm test` green: **60 files, 980 tests**. The pre-fix count was 969 and this plan adds exactly 11 rows, so nothing was removed or silently skipped.
- `pnpm --filter @btcr2-aggregation/web exec tsc --noEmit` clean.
- `pnpm --filter @btcr2-aggregation/web build` green.
- `pnpm lint` green.
- `grep -rlP '\x{2014}' packages/web/src` lists no files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The wallet-signing return leg is closed against the one tampering dimension the template byte comparison could not see. `register()` now only ever receives `rawHex` for a signature that binds every output.
- Still open from the audit, deliberately out of scope here: `tx.fee` is read from the returned PSBT's own `witnessUtxo.amount`, which the template comparison does not pin. That finding did not clear the refutation threshold and stays in `05-AUDIT.md` under "Reported but not refuted" for triage.
- Wave 1 gap plans 05-16 through 05-20 are unaffected: this plan touched no file in their `files_modified`.

## Self-Check: PASSED

- `packages/web/src/lib/psbt.ts` FOUND
- `packages/web/src/components/cohort/WalletSignPanel.tsx` FOUND
- `packages/web/tests/psbt.spec.ts` FOUND
- Commits `8bdd4ad`, `9e5ead7`, `f0acc46`, `9f542ac` all FOUND in git log

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-30*
