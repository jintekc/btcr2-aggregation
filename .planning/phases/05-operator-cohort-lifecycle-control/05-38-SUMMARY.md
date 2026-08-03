---
phase: 05-operator-cohort-lifecycle-control
plan: 38
subsystem: service
tags: [runtime-settings, body-limit, derivation, docs, traceability, gap-closure]
status: complete
requires:
  - "05-33 (SETTINGS_BODY_LIMIT_BYTES and the measurement block this plan extends)"
  - "05-31 (textKnob and the two character caps this plan reads and does not move)"
provides:
  - "settingsBodyLimitBytes: the settings body budget as a pure function of BOTH character caps"
  - "MAX_SERVICE_NAME_CHARS exported, so the measurement reads the shipped cap instead of retyping it"
  - "cap-pair property rows that go red the moment the derivation stops carrying a term"
  - "a measured punctuation allowance whose docstring figure has a row"
  - "a DEPLOY.md participation-terms paragraph that names the byte budget"
  - "a serviceName option docstring describing the runtime-editable holder seed it actually is"
  - "SVC-04 and SVC-05 carrying the same status their two peer requirements carry"
affects:
  - packages/service/src/runtime-settings.ts
  - packages/service/tests/runtime-settings.spec.ts
  - packages/service/src/index.ts
  - docs/DEPLOY.md
  - .planning/REQUIREMENTS.md
tech-stack:
  added: []
  patterns:
    - "a bound that covers more than one field is derived from every field it carries, and pinned as a property over the FIELDS rather than over the encodings of one of them"
    - "an input a spec retypes is an input the spec has frozen: exactly one row may retype a constant, and that row is the record of a deliberate change"
    - "a figure quoted in a docstring is a claim, so it gets a row the same way the code does"
    - "an anti-vacuity control pointed at the field the previous derivation ignored, in the same shape as the row that kills a too-small multiplier"
key-files:
  created: []
  modified:
    - packages/service/src/runtime-settings.ts
    - packages/service/tests/runtime-settings.spec.ts
    - packages/service/src/index.ts
    - docs/DEPLOY.md
    - .planning/REQUIREMENTS.md
decisions:
  - "The budget is exported as a FUNCTION of the two caps, with the shipped constant defined as one application of it, so the spec can assert the RULE over cap pairs rather than re-deriving the number from the same constants."
  - "WORST_CASE_TERMS_BYTES_PER_CODE_UNIT keeps its name (the plan left the rename optional and warned about diff noise against a docstring 05-33 wrote carefully); its docstring now states the claim generally, that six bytes per code unit is a property of JSON string encoding and therefore true of every string field in this body."
  - "The punctuation allowance is 1024 bytes, roughly six times the MEASURED 169 byte body with both string fields empty, and that 169 is pinned by a row so the docstring figure cannot rot the way the 184 byte claim did."
  - "The budget FALLS from 124096 to 122224 bytes. It still clears the largest legal console body (121369) by 855 bytes, still sits inside the 4 KiB to 512 KiB range this service uses elsewhere, and the drop is what proves the number is derived rather than padded."
  - "MAX_SERVICE_NAME_CHARS is exported, superseding 05-33's sentence that it stays module-local, for the reason 05-33 itself gave one field over: a bound another layer derives from cannot stay private, and here the other layer is this module's own spec."
  - "The cap-pair table includes a pair with the two caps SWAPPED (name 20000, terms 200), so neither string field can be the special one in the derivation."
metrics:
  duration: 18 min
  completed: 2026-08-03
actuals:
  tokens: 64900
  tasks: 3
  commits: 3
---

# Phase 05 Plan 38: The Derived Settings Body Budget Summary

The gated settings route's byte budget now has nothing chosen in it except one measured allowance: it is derived from both character caps it has to carry, pinned as a property over cap pairs including name caps far past the point where the old fixed headroom stopped bounding anything, and the three documents that describe this phase's shipped behavior say what it actually does.

## What Was Built

### Task 1: the budget carries every field it has to carry (IN-06) - `66c8e34`

`packages/service/src/runtime-settings.ts` replaced the name-blind fixed headroom with a pure derivation:

```ts
export function settingsBodyLimitBytes(maxServiceNameChars: number, maxTermsChars: number): number {
  return (
    (maxServiceNameChars + maxTermsChars) * WORST_CASE_TERMS_BYTES_PER_CODE_UNIT +
    SETTINGS_BODY_FIXED_FIELD_BYTES
  );
}

export const SETTINGS_BODY_LIMIT_BYTES = settingsBodyLimitBytes(
  MAX_SERVICE_NAME_CHARS,
  MAX_TERMS_CHARS,
);
```

The measurements behind every figure now in the docstrings, taken byte-exact against the real console patch shape:

| body | bytes |
|---|---|
| both string fields EMPTY (the allowance's target) | 169 |
| 200 character ASCII name, no terms | 369 |
| 200 character control-character name, no terms | 1369 |
| terms at the cap in ASCII, ASCII name | 20369 |
| terms at the cap in control characters, control-character name at the cap (the largest legal body) | 121369 |
| the budget this plan ships | 122224 |
| the budget it replaced | 124096 |

The budget FELL by 1872 bytes and still clears the worst legal body by 855. The old headroom's docstring claimed the non-terms body measured 184 bytes and that 4096 was therefore "roughly twenty times what it needs": it is neither the worst-case measurement (1369) nor the ordinary one (369), and the real margin was roughly threefold. The allowance that replaces it states the measured 169 and calls its slack slack.

`MAX_SERVICE_NAME_CHARS` is now exported and the terms cap's docstring sentence claiming it stays module-local is corrected in the same edit. `WORST_CASE_TERMS_BYTES_PER_CODE_UNIT` keeps its name and gained a paragraph saying the six-bytes-per-code-unit bound is a property of JSON string encoding, true of every string field in the body, which is what makes it correct to charge the name at the same rate.

`packages/service/src/hono-adapter.ts` is unedited: the route consumes the exported constant by name, so the new derivation reached the wire with no route edit. That was the property that made this a one-file fix.

**Spec changes** in `packages/service/tests/runtime-settings.spec.ts`, all extending 05-33's measurement block rather than opening another:

- `encodedBodyBytes` takes a **name parameter**. The four shipped call sites pass `ASCII_NAME_AT_CAP`, the exact value they always assumed, so every shipped assertion keeps its meaning.
- A row measuring the **largest legal console body**, both string fields at their cap in the six-byte class, asserting the budget bounds it and that it really is worse than the same terms beside an ASCII name.
- **Four cap-pair rows plus a property row over the whole table**: today's caps, a name cap of 700 (just past the old break-even), 5000 (far past it), and the two caps swapped.
- An **anti-vacuity row** showing the name-blind derivation this replaced (`termsCap * 6 + 4096`) would NOT have bounded the 5000-name pair, in the same shape as the shipped row that kills the smaller multiplier.
- A row measuring the **169 byte bare body** and asserting the allowance alone covers it.
- **One** row retyping each cap's value (`200`, `20_000`). Every other row derives from the imported constants. The spec's local `MAX_SERVICE_NAME_CHARS = 200` literal is gone.

`docs/DEPLOY.md`'s participation-terms paragraph stopped claiming the character count is the only limit either path applies. It now names the console save path's request size budget, states that it is derived from the same character cap and charges every character at the most expensive encoding JSON can give it, so a document at the cap fits whatever script it is written in. The environment-variable row is unedited: it speaks about the character cap and the refusal, both still true.

### Task 2: the serviceName option says what it is (IN-08) - `3ebcaa6`

`CreateServiceOptions.serviceName`'s docstring dropped the two false clauses ("A boot-time constant", "no edit surface") and now describes a boot SEED for the runtime settings holder, runtime-editable from the operator console since D-16, resolved from `SERVICE_NAME` exactly like the six seeds documented directly beneath it, with `GET /v1/config` reading the name back off the holder per request, which is why a rename applies without a restart. Every still-true clause survives: display text only, plain auto-escaped text with no markup, omitted from the config DTO when unset so the frozen public network fields stay byte-identical.

`git diff packages/service/src/index.ts` filtered to non-comment lines is EMPTY: no signature, type, call site or behavior changed.

### Task 3: the traceability table matches the phase's own status - `018171f`

`.planning/REQUIREMENTS.md` SVC-04 and SVC-05 moved from `Complete` to `Gaps Found`, the status PART-05 and PART-06 already carry for the identical reason. The diff touches exactly those two lines; no coverage figure, footer or other row moved.

## Test-First Record: which rows were red when

The plan asked for the worst-legal-body row to be written FIRST and its colour recorded, because the shipped budget probably already bounded it.

**1. Worst-legal-body row, against the shipped constants, before any source change: GREEN.**

```
 ✓ packages/service/tests/runtime-settings.spec.ts (93 tests | 92 skipped) 2ms
 Test Files  1 passed (1)
      Tests  1 passed | 92 skipped (93)
```

121369 bytes against a 124096 byte budget. On its own this row proves nothing about the derivation, which is exactly why the cap-pair rows exist.

**2. The load-bearing rows, before the source change: RED.**

```
TypeError: settingsBodyLimitBytes is not a function
 Test Files  1 failed (1)
      Tests  20 failed | 81 passed (101)
```

(20 rather than 7 because the spec had already switched to the imported `MAX_SERVICE_NAME_CHARS`, which the module did not yet export, so every row using it failed too.)

**3. After the source change: GREEN.**

```
 Test Files  2 passed (2)
      Tests  161 passed (161)
```

## Mutation Check (run explicitly, RED verified, restored)

Dropped the name term from the derivation (`(maxServiceNameChars + maxTermsChars) * ...` became `maxTermsChars * ...`) and ran the spec file:

```
   × ... bounds the LARGEST legal console body: both string fields at their cap, both at the worst encoding
   × ... derives a budget that bounds the worst legal body for today's shipped caps
   × ... derives a budget that bounds the worst legal body for a name cap just past the old break-even point
   × ... derives a budget that bounds the worst legal body for a name cap far past it
   × ... derives a budget that bounds the worst legal body for the two caps swapped, so neither field is the special one
   × ... bounds every cap pair at once, as a property over the table
   × ... is not vacuously large in the NAME field either: the fixed headroom this replaced would have failed a real cap pair
 Test Files  1 failed (1)
      Tests  7 failed | 94 passed (101)
```

Exactly the shape the plan predicted: the seven new rows RED, **every shipped row green** (the five encoding classes, the cross-class property, the smaller-multiplier anti-vacuity row and the other-routes range row all sat in the 94 that passed). That is the coupling, demonstrated: a name-blind budget is invisible to a table that varies only the terms encoding.

Restored and re-ran:

```
 Test Files  2 passed (2)
      Tests  161 passed (161)
```

## Verification Results

| gate | result |
|---|---|
| `pnpm test` | **68 files / 1304 tests passed** (round baseline: 68 files / 1271 tests; 05-36 took it to 1291, 05-37 to 1295, this plan adds 9) |
| `pnpm lint` | green |
| `pnpm --filter @btcr2-aggregation/web build` | green |
| `pnpm e2e:gate` | green, exit 0, all 13 legs (run once for the round here per plan) |
| `pnpm typecheck` | green, the new export and derivation compile with no cast |
| `git diff --stat pnpm-lock.yaml` | empty |
| `packages/service/src/hono-adapter.ts` | unedited |
| em-dash sweep over all five touched files | no files |
| raw control bytes in the spec | none (the new escape-forcing character is built with `String.fromCharCode(1)`, the existing row keeps its `` escape) |

## Deviations from Plan

None. Every task executed as written, with two small judgement calls the plan explicitly delegated:

- **The multiplier was NOT renamed.** The plan left the rename optional and warned it adds diff noise against a docstring 05-33 wrote carefully; the docstring was generalised instead, and it now says the name records where the bound was first derived rather than what it applies to.
- **The allowance is 1024, not the review's sketched 2048.** The sketch called its figure a suggestion and the plan required a measured one. 1024 is roughly six times the measured 169 byte bare body, and the row that pins 169 is what keeps the docstring honest.

One incidental correction worth recording: the first spec edit landed a RAW control byte inside a string literal (the editing tool resolved a `` escape into the character itself). It was replaced with `String.fromCharCode(1)` before any commit, and `grep -cP '\x01'` over both touched service files reports 0.

## The break-even number, measured

The review put the point where raising the service-name cap would re-open the settings-save wedge at "roughly 682". Measured here against the real patch shape, a worst-encoding body is `169 + 6 * nameCap + 120000` bytes, so the old 124096 byte budget stopped bounding it at a name cap of **655**. The spec's docstring records 655 as the measured figure and the cap-pair table straddles it (700 and 5000).

## Human Items and Traceability

`05-UAT.md` is unedited. Its front matter still reads `pending: 16` and all 16 items still read `result: [pending]`: this round added none and closed none (05-37 amended an existing backstop rather than adding one). `/gsd-secure-phase 5` remains the phase's other outstanding gate.

This is the **third** correction of the premature-completion pattern in Phase 5, after `118cb9b` and `4a2445a`. It is on the record here so a fourth occurrence is recognised rather than rediscovered.

## Known Stubs

None. No placeholder value, hardcoded empty collection or unwired data source was introduced; every change is a derivation, an export, measurement rows, two docstrings, one documentation paragraph and two table cells.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema at a trust boundary. The plan's own register is satisfied: the streaming request-size bound MOVED and was never removed (T-05-38-02), the derived budget closes the silent name-field wedge (T-05-38-01), the two prose overclaims are corrected (T-05-38-03, T-05-38-04), the traceability misreport is corrected (T-05-38-05), and the one accepted chosen number now carries a measured figure and a row (T-05-38-06). No package was installed (T-05-38-SC), and the lockfile diff is empty.

## Self-Check: PASSED

- `packages/service/src/runtime-settings.ts` FOUND, exports `settingsBodyLimitBytes` and `MAX_SERVICE_NAME_CHARS`
- `packages/service/tests/runtime-settings.spec.ts` FOUND, contains `encodedBodyBytes` with a name parameter and the `CAP_PAIRS` table
- `packages/service/src/index.ts` FOUND, `serviceName` docstring reworded
- `docs/DEPLOY.md` FOUND, participation-terms paragraph corrected
- `.planning/REQUIREMENTS.md` FOUND, both rows read `Gaps Found`
- Commit `66c8e34` FOUND
- Commit `3ebcaa6` FOUND
- Commit `018171f` FOUND
