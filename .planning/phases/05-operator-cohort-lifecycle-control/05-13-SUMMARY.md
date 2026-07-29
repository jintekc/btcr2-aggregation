---
phase: 05-operator-cohort-lifecycle-control
plan: 13
subsystem: participation-terms-acceptance
tags: [tos, did-signed, schnorr, jcs-canonicalization, content-addressed, react, zustand, vitest]

# Dependency graph
requires:
  - phase: 05-operator-cohort-lifecycle-control (plan 07)
    provides: the operator half - the termsText runtime setting and its additive ride on GET /v1/config
  - phase: 05-operator-cohort-lifecycle-control (plan 04)
    provides: createRuntimeSettings, the per-service env-seeds / runtime-overrides holder the route reads terms from
provides:
  - packages/shared/src/tos.ts - TermsAcceptance, buildTermsAcceptance, termsHashHex, termsAcceptanceBytes, termsAcceptanceHashHex, termsAcceptanceSigningBytes, and the frozen TERMS_ACCEPTANCE_FIELDS pin
  - the 'acceptance' artifact kind plus putAcceptance, served by the existing hash-addressed GET /cas/acceptance/:hash
  - POST /v1/terms/acceptance - the anonymous, verify-before-store acceptance route with one uniform refusal body
  - serviceDid on GET /v1/config (additive), so a browser can build the record it signs before it joins
  - TermsStep + termsStepVisible + TERMS_COPY - the join-flow terms step
  - buildTermsEnvelope + termsAcceptedFor + TERMS_ACCEPTANCE_FAILED - the browser signing seam and the cohort-keyed join gate
affects: [05-14 phase capstone]

# Tech tracking
tech-stack:
  added:
    - "None. No new package in any manifest; the record reuses @did-btcr2/common canonicalization, @noble/hashes sha256, and the participant's existing SchnorrKeyPair."
  patterns:
    - "A proof format is frozen by a KEY-SET EQUALITY pin, not a presence check: a presence check passes happily while an eighth field joins the record"
    - "One canonicalization per codebase: the browser and the service call the same shared builder and the same shared signing-bytes function, and the spec asserts the equivalence"
    - "A record binds the HASH of what was shown, never the text, so the shower cannot rewrite it afterwards"
    - "Every refusal on an anonymous route returns the byte-same body, asserted by deep equality ACROSS reasons rather than one row per reason"
    - "The gate lives in the method that performs the act, not only in the surface that renders the control"
    - "A per-round fact that carries its own key (cohortId) needs no teardown path: the comparison, not the cleanup, is what makes it correct"

key-files:
  created:
    - packages/shared/src/tos.ts
    - packages/shared/tests/tos.spec.ts
    - packages/service/tests/tos.spec.ts
    - packages/web/src/components/browse/TermsStep.tsx
    - packages/web/tests/terms.spec.ts
  modified:
    - packages/shared/src/index.ts
    - packages/service/src/store.ts
    - packages/service/src/hono-adapter.ts
    - packages/service/src/index.ts
    - packages/web/src/lib/config.ts
    - packages/web/src/stores/participant.ts
    - packages/web/src/components/browse/JoinIdentityStep.tsx

key-decisions:
  - "The signing input is the 32-byte canonical HASH of the record, not the canonical JSON, mirroring how this app already signs a did:btcr2 update (the OP_RETURN payload is updateHashBytes). A fixed-size signing input also means an unbounded terms document can never grow the signing operation"
  - "An EXTERNAL (x1) participant carries its self-verifying genesis document in-band, exactly as it does on a cohort opt-in. Without it, resolveBtcr2SenderPk returns undefined for every x1 DID and the whole terms step would be silently unusable for half the onboarding models this app supports"
  - "serviceDid rides GET /v1/config additively. The record names the service it is addressed to (so an acceptance cannot be replayed to another service publishing identical terms), and the browser builds that record BEFORE it joins anything, so it cannot read the DID off an advert it has not seen"
  - "A well-formed but UNKNOWN cohort id is accepted on purpose. Refusing it would turn this anonymous route into an enumeration oracle for exactly what the uniform refusal body exists to hide, and neither of the record's real security properties depends on the cohort being recognized"
  - "The join gate lives inside the store's join(), not only in the component: a future second entry point, or a component that forgets, is refused by construction rather than seating someone with no acceptance on record"
  - "The recorded acceptance is COHORT-KEYED, which is why it does not live in INITIAL_OUTCOME. An acceptance for cohort A fails the id comparison for cohort B, so correctness is a property of the gate rather than of remembering to clear a slice on every teardown path"
  - "The failure sentence is authored in the store beside the code that SETS it; the rest of the copy lives in TermsStep. A message set in one file and authored in another is how the two come to disagree"
  - "The checkbox state is LOCAL and the acceptance is SERVED: keeping them apart is what makes checked-but-not-yet-recorded a state the join button can show"

requirements-completed: [SVC-05]

coverage:
  - deliverable: "The acceptance record shape is frozen before any real acceptance exists"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/shared/tests/tos.spec.ts#carries exactly the frozen field set, asserted by key-set equality"
        status: pass
      - kind: test
        ref: "packages/shared/tests/tos.spec.ts#changes when ANY single field changes, field by field over the frozen set"
        status: pass
      - kind: test
        ref: "packages/shared/tests/tos.spec.ts#are insensitive to the ORDER the fields were written in (JCS canonicalization)"
        status: pass
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#refuses a record carrying an EXTRA field, so the frozen shape cannot be widened by a caller"
        status: pass
  - deliverable: "The acceptance binds the hash of the exact terms shown"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/shared/tests/tos.spec.ts#changes for ANY difference in the text, including whitespace"
        status: pass
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#leaves an already stored acceptance byte-unchanged and still naming the ORIGINAL hash"
        status: pass
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#refuses a terms hash that does not match this service CURRENT terms"
        status: pass
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#names the terms HASH, never the terms text, so the text never travels"
        status: pass
  - deliverable: "The service verifies the signature before storing anything"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#accepts, stores, and returns the hash reference for a correctly signed record"
        status: pass
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#refuses a signature made by a DIFFERENT key and stores nothing"
        status: pass
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#accepts an EXTERNAL (x1) participant that carries its self-verifying genesis in-band"
        status: pass
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#refuses when this service has NO terms set: there is nothing to accept"
        status: pass
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#refuses an OVERSIZED body at the boundary, before it is parsed"
        status: pass
  - deliverable: "The route is not an existence oracle and has no listing surface"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#answers every refusal with the byte-SAME body, so it is not an existence oracle"
        status: pass
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#appears on NO listing endpoint: only the hash-addressed read serves it"
        status: pass
      - kind: test
        ref: "packages/service/tests/tos.spec.ts#refuses an unparseable body with the generic message while logging the real error"
        status: pass
  - deliverable: "The browser signs the same bytes the service verifies, with the key never leaving the tab"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#produces the SAME record the shared builder produces for identical inputs"
        status: pass
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#signs the shared signing bytes with the participant own key, verifiably"
        status: pass
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#posts ONLY the record, its signature and the genesis: never the private key"
        status: pass
  - deliverable: "No terms means no step, and a failed acceptance stops the join"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#is false for absent, null, empty, and whitespace-only terms"
        status: pass
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#refuses the join outright when terms are set and nothing is recorded"
        status: pass
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#refuses the join when the recorded acceptance is for a DIFFERENT cohort"
        status: pass
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#leaves the documented failure line and NO acceptance when the service refuses"
        status: pass
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#does not gate a service that set NO terms: the join path is unchanged"
        status: pass
      - kind: command
        ref: "pnpm e2e:browse and pnpm e2e:browser:participant (both green with no terms set)"
        status: pass
  - deliverable: "Operator text renders as escaped, scroll-capped, wrapping plain text"
    human_judgment: false
    verification:
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#uses no dangerous HTML prop of any kind"
        status: pass
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#never renders the operator text as a link target"
        status: pass
      - kind: test
        ref: "packages/web/tests/terms.spec.ts#caps the terms container height, scrolls it, and wraps unbroken tokens"
        status: pass
  - deliverable: "The rendered terms step and its copy in a real viewport"
    human_judgment: true
    rationale: "Whether the terms card reads as something to actually read rather than a formality, whether the signature disclosure lands at the moment the checkbox is offered, whether a 20-page terms document scrolls inside its container while leaving the join controls reachable at a narrow viewport height (the two backstop must_haves), and whether the honest-limit caption reads as candor rather than a disclaimer, are judgments no unit test makes. Same carried gap 05-06 through 05-12 recorded."

# Metrics
duration: ~35 min
completed: 2026-07-29
status: complete
---

# Phase 5 Plan 13: DID-Signed Participation Terms Summary

**A participant now reads an operator's terms as plain escaped text, agrees with a BIP340 signature made in their own browser over a frozen canonical record that binds the hash of exactly the document they were shown, and the service refuses to store a single byte until it has independently rebuilt those bytes and verified that signature against the key resolved from the claimed DID, with the app-level limit of that enforcement stated on the step rather than implied away.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-29
- **Tasks:** 3 (two TDD, so each of those has a RED then a GREEN commit)
- **Files:** 12 (5 created, 7 modified)

## Accomplishments

- **The format was frozen before a single real acceptance existed, which is the only moment it can be.** `TERMS_ACCEPTANCE_FIELDS` is exported from the record module and the spec pins the built record's key set against it by EQUALITY, not by presence. A presence check passes happily while an eighth field joins; equality fails the moment one does. The same list drives the per-field hash-sensitivity rows, so a field added to the record without being thought about fails a test rather than going uncovered. The server enforces the same set on the wire, so a caller cannot widen a stored artifact whose entire value is that its shape is known.
- **There is exactly ONE canonicalization, and the spec proves both sides use it.** The browser and the service both call `buildTermsAcceptance` and `termsAcceptanceSigningBytes` from `packages/shared`. `packages/web/tests/terms.spec.ts` rebuilds the record independently through the shared builder and asserts deep equality against what the browser envelope carries, then verifies the browser's signature over the shared signing bytes with the participant's own public key. Two canonicalizations in one codebase is how a proof format silently diverges, and the failure mode is the worst kind: an unexplainable invalid signature months later, on records nobody can re-derive.
- **The record binds the terms HASH, and the binding is proved from both directions.** Store an acceptance, edit the terms, and the stored record is byte-unchanged and still names the hash of the document that was shown. Then submit a fresh acceptance of the OLD terms and it is refused. One test does both, because a hash binding that only holds for stored records is half a binding.
- **Nothing reaches the store until every check has passed, and every refusal row asserts that.** The route is anonymous, so each refusal path is also a potential store-growth path (T-05-13-04). Every refusal test in `packages/service/tests/tos.spec.ts` asserts the store is still EMPTY, not merely that the response was a 400. The order inside `recordTermsAcceptance` IS the security argument and is documented as such at the function: terms set, frozen shape, this service, current terms hash, then the signature, then the write.
- **The refusals are compared to each other, not to a literal.** Six differently-broken bodies (wrong key, wrong terms, undecodable DID, malformed cohort id, structurally wrong, missing signature) are POSTed and every result is asserted deep-equal to the first. Six separate `toEqual({ error: ... })` rows would still pass if one of them started answering 404 or grew a reason field, and that divergence is precisely what would turn this route into a probe for which DIDs and cohorts this service has seen (T-05-13-06).
- **An unknown cohort id is accepted on purpose, and the spec says why in the test body.** Checking that the cohort exists would make this anonymous route an enumeration oracle for exactly the thing the uniform refusal body is built to hide. Neither of the record's real properties (the signature and the terms binding) depends on the cohort being recognized, and nothing downstream reads an acceptance as evidence the cohort was real. That reasoning lives in a test named `ACCEPTS a well-formed but unknown cohort id, on purpose`, so the next reader meets the decision rather than the gap.
- **EXTERNAL (x1) participants can accept.** An x1 DID is a hash commitment to a genesis document, so `resolveBtcr2SenderPk` returns `undefined` for one with no document in hand, and a route that only passed the DID would have made this feature silently unusable for half the onboarding models this app supports. The genesis rides in-band exactly as it does on a cohort opt-in (ADR 066), and the resolver recomputes its hash against the DID, so a forged document cannot be substituted. A KEY participant omits the key entirely rather than sending `undefined`.
- **The join gate lives in the method that joins.** `join()` refuses when terms are set and no acceptance is recorded FOR THAT COHORT, independently of the component that renders the checkbox. A component bug, or a future second entry point, is refused by construction. The recorded reference is cohort-keyed, which is also why it does not sit in `INITIAL_OUTCOME`: an acceptance for cohort A fails the id comparison for cohort B, so correctness is a property of the comparison rather than of remembering to clear a slice on every teardown path.
- **Checked and recorded are two different facts, and the button shows the difference.** The checkbox is local component state; the acceptance is a served hash. Between the click and the stored record the join button holds `Joining…` and is disabled, so checked-but-not-yet-recorded is visible rather than inferred (UI-SPEC E15 partial).
- **The operator's text is treated as what it is: a string from a stranger, shown to strangers.** It renders as a plain React text child inside a `max-h-64 overflow-auto` container with `whitespace-pre-wrap break-words`, so the operator's own paragraphs survive while a single 3000-character URL wraps instead of widening the card. The spec walks the component SOURCE for `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, any anchor tag and any `href`, because the property being defended is that those do not EXIST in the file, which no rendered snapshot can prove.
- **The limit is on the step, in the route's own comment, and in the spec.** The aggregation protocol carries no message type that could hold an acceptance, so a headless client joins without ever seeing this. The caption says so in the words the UI-SPEC authored, the route's comment says so where the next implementer will look, and a test asserts the sentence still contains both halves of the claim so it cannot be softened into a marketing line.
- **No package entered the repository.** The record needs a canonicalizer this app already depends on, a sha256 it already bundles, and a keypair the participant already holds. Every manifest is untouched.

## Task Commits

Tasks 1 and 2 are TDD, so each has a RED then a GREEN commit:

1. **Task 1 (RED): failing spec for the frozen terms-acceptance record** - `b653bab` (test)
2. **Task 1 (GREEN): the frozen, canonical record and its hashes** - `68ab351` (feat)
3. **Task 2 (RED): failing spec for the verified acceptance route** - `e1ab22f` (test)
4. **Task 2 (GREEN): verify, hash-address and serve the acceptance** - `777b0da` (feat)
5. **Task 3: the join step, escaped and honest about its limits** - `b7b1af5` (feat)

## Files Created/Modified

- `packages/shared/src/tos.ts` (new) - `TermsAcceptance` and the frozen `TERMS_ACCEPTANCE_FIELDS`, `BTCR2_CONTEXT` (the URI the sidecar and the store already use, not a new one), `TERMS_ACCEPTANCE_TYPE`, `buildTermsAcceptance`, `termsHashHex`, `termsAcceptanceBytes`, `termsAcceptanceHashHex`, `termsAcceptanceSigningBytes`. The module docstring names every consumer and states what freezing means.
- `packages/shared/tests/tos.spec.ts` (new, 12 tests) - the key-set pin, determinism, field-order insensitivity, per-field hash sensitivity driven from the frozen list, and the whitespace and UTF-8 rows on `termsHashHex`.
- `packages/shared/src/index.ts` - one re-export line.
- `packages/service/src/store.ts` - the fifth artifact kind `acceptance` (documented as NOT a resolution artifact, and deliberately absent from `exportSidecar`), `putAcceptance` with the caller's verification obligation stated, and the `/cas/acceptance/:hash` segment mapping.
- `packages/service/src/hono-adapter.ts` - `ResolveSenderPk`, `ACCEPTANCE_REFUSED`, `recordTermsAcceptance` (the ordered verify-then-store function), the `serviceDid` + `resolveSenderPk` options, the additive `serviceDid` on `GET /v1/config`, and `POST /v1/terms/acceptance` in the PUBLIC block with its 16 KiB body limit.
- `packages/service/src/index.ts` - threads `serviceDid: did` and `resolveSenderPk: resolveBtcr2SenderPk`, and re-exports `putAcceptance`.
- `packages/service/tests/tos.spec.ts` (new, 15 tests) - the happy path, the x1 path, the hash-addressed read, the no-listing assertion, seven refusal rows that each assert an empty store, the cross-reason deep-equality row, the two-directional terms-edit binding, and the config-DTO pin.
- `packages/web/src/lib/config.ts` - `serviceDid` + `termsText` on `RuntimeConfigDTO`, `TermsAcceptanceEnvelope`, and `postTermsAcceptance` (bounded fetch, hash-shape validated on the way back).
- `packages/web/src/stores/participant.ts` - `serviceDid` / `termsText` / `termsAcceptance` / `termsAccepting` / `termsError` state, the exported `TERMS_ACCEPTANCE_FAILED`, the pure exported `buildTermsEnvelope` and `termsAcceptedFor`, the `acceptTerms` action with its re-entrancy guard, the widened `loadConfig` adoption, and the gate at the top of `join()`.
- `packages/web/src/components/browse/TermsStep.tsx` (new) - `TERMS_COPY`, `acceptedAtLine`, `termsStepVisible`, and the step itself.
- `packages/web/src/components/browse/JoinIdentityStep.tsx` - mounts the step ahead of the identity step, adds the local checkbox state, the `termsBlocking` / `joinBusy` derivations, the disabled-reason beside the button, and the `doJoin` accept-then-join handler.
- `packages/web/tests/terms.spec.ts` (new, 20 tests) - the render predicate, the browser/shared byte equivalence, the signature verification, the x1 genesis carriage, the source walk for escaping, the full UI-SPEC copy pin, and six store-gate rows.

## Decisions Made

- **The signing input is the 32-byte canonical HASH**, not the canonical JSON. Same shape as how this app already signs an update (the OP_RETURN payload is `updateHashBytes`), and it keeps an unbounded terms document from ever growing the signing operation. The record's `@context` and `type` provide the domain separation.
- **The genesis document rides in-band for x1**, exactly as it does on a cohort opt-in. Without it, every EXTERNAL participant would be refused.
- **`serviceDid` rides `GET /v1/config` additively.** The browser builds the record before it joins anything, so it cannot read the DID off an advert it has not seen. The DID is already public on every advert.
- **An unknown cohort id is accepted.** Refusing it would build the oracle the uniform refusal is designed to prevent.
- **The join gate is in `join()`.** Construction, not discipline.
- **The acceptance reference is cohort-keyed**, which is what lets it live outside the per-round teardown slice safely.
- **The failure sentence lives with its setter**, the rest of the copy with the step.
- **Every refusal is one body.** The route cannot be used to probe.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] An EXTERNAL (x1) participant could never have accepted**

- **Found during:** Task 2
- **Issue:** The plan and RESEARCH both specify verifying with `resolveBtcr2SenderPk(participantDid)`. For an `x1` DID that function returns `undefined` unless the genesis document is supplied: the DID is a hash commitment to that document, so there is no key in the DID string. As written, every EXTERNAL participant would have hit the generic refusal with no way forward, on a route whose refusals are deliberately unexplained. Half of this app's onboarding models would have been silently locked out of joining any service that set terms.
- **Fix:** The envelope accepts an optional `genesisDocument`, threaded into the resolver exactly as the transport threads it on a bootstrap opt-in (ADR 066). The document is self-verifying: the resolver recomputes its canonical hash against the DID and throws on a mismatch, so accepting it in-band adds no trust. The browser sends it only for an x1 identity and omits the key entirely for k1.
- **Files modified:** packages/service/src/hono-adapter.ts, packages/web/src/lib/config.ts, packages/web/src/stores/participant.ts
- **Verification:** `packages/service/tests/tos.spec.ts` accepts a real `createExternalIdentity` acceptance and stores it; `packages/web/tests/terms.spec.ts` asserts the key is present for x1 and absent (not undefined-valued) for k1.
- **Committed in:** `777b0da`

**2. [Rule 3 - Blocking] The browser had no way to learn this service's DID**

- **Found during:** Task 2
- **Issue:** The acceptance record names `serviceDid`, and the participant's browser signs that record BEFORE joining anything. Nothing on the anonymous surface carried the service's DID: `DirectoryCohortDTO` is byte-frozen (D-26), and the advert that does carry it is only seen after opting in. Without it the record could not be built at all.
- **Fix:** `serviceDid` rides `GET /v1/config` as a third additive key, beside `serviceName` and `termsText`, present only when a DID was threaded in. Every existing config pin is untouched (those apps thread none), and the frozen network fields stay byte-identical, asserted by a new `toEqual` pin over the full DTO.
- **Files modified:** packages/service/src/hono-adapter.ts, packages/service/src/index.ts, packages/web/src/lib/config.ts, packages/web/src/stores/participant.ts
- **Verification:** `pnpm test` (all pre-existing `config.spec.ts` pins green), `pnpm e2e:config` green.
- **Committed in:** `777b0da`

**3. [Rule 1 - Bug] The refusal spec's own helper defaulted away the case it was testing**

- **Found during:** Task 2 (the first GREEN run)
- **Issue:** The shared `refusal(build, terms = TERMS)` helper gave `terms` a default, so the no-terms row passing an explicit `undefined` silently received the real terms instead. That row returned 200 and the spec caught it, but the same defaulting would have made any future "absent" row a false green.
- **Fix:** The default was removed and every call site names its terms explicitly, with a comment on the helper stating why the parameter has no default.
- **Files modified:** packages/service/tests/tos.spec.ts
- **Verification:** the no-terms row now fails against a service with terms and passes against one without.
- **Committed in:** `777b0da`

### Deliberate readings of the plan

- **One spec row is an ACCEPTANCE, not a refusal.** The plan's threat model asks the route not to be an existence oracle; enforcing that means an unknown cohort id must be accepted rather than refused. That is recorded as its own named test with the reasoning in the body, so it reads as a decision rather than a missing check.
- **One file outside `files_modified` changed: `packages/web/src/lib/config.ts`.** The DTO it owns is where `serviceDid` and `termsText` arrive, and `postTermsAcceptance` is the sibling of `fetchNetworkConfig` (same route family, same bounded-fetch treatment). Putting the client call in the store instead would have been the only alternative, and it would have been the first fetch in that module not to live in `lib/`.
- **The signing input is the canonical hash rather than the canonical JSON string.** The plan says "sign its canonical bytes"; both readings are defensible, and the hash is the one this app already uses for the analogous act. `termsAcceptanceBytes` is exported too, so the canonical JSON is available and asserted; the signing function names itself `termsAcceptanceSigningBytes` so no reader has to guess which one the signature covers.
- **`termsAcceptanceSigningBytes` and `termsAcceptanceBytes` were added beyond the three exports the plan names.** The plan's acceptance criterion (the three exports exist) holds; these two exist because "the canonical bytes" and "the bytes that are signed" are different values and naming only one of them would have left the other implicit at three call sites.
- **The checkbox disables itself once an acceptance is recorded.** Un-ticking a box after the signed record exists would imply the acceptance could be withdrawn, which it cannot: the artifact is stored and content-addressed. The step shows the accepted line and its reference instead.

---

**Total deviations:** 3 auto-fixed (1 missing-critical that would have locked out every EXTERNAL participant, 1 blocking wire gap, 1 spec-helper defect caught by its own suite), plus 5 documented readings of the plan text.
**Impact on plan:** One file outside `files_modified` changed (`packages/web/src/lib/config.ts`). No shipped behavior changed for any service that sets no terms: both named e2e legs pass byte-unchanged, and the config DTO for such a service grows only `serviceDid`.

## Issues Encountered

- **The rendered step is unverified by any automated test**, only its predicate, its copy constants, its signing seam, and its source-level escaping properties. The two backstop `must_haves` (a very long terms body scrolling inside its container, and the join controls staying reachable below it at a narrow viewport height) are viewport judgments that belong to the phase walkthrough. Same carried gap 05-06 through 05-12 recorded.
- **There is no operator-side view of who accepted.** The UI-SPEC describes a `Terms accepted` member-row badge on the drill-down; this plan builds the participant half and the artifact, not that badge. An operator can read any acceptance by its hash, but nothing lists the acceptances for a cohort (deliberately: the artifact appears on no listing endpoint). Surfacing it to the operator would need the monitor to retain the reference at acceptance time, which no task here specifies.
- **An acceptance is not linked to a seat.** The route accepts a record for any cohort id, and the protocol's opt-in carries nothing that could reference the acceptance, so the service cannot prove that the participant who accepted is the participant who later seated. Both facts name the same DID, which is as close as the protocol allows. This is the same D-19 limit as the headless bypass, from a different angle.
- **A terms edit invalidates in-flight acceptances.** A participant who loaded the page before an edit and clicks Join after it signs the old hash and is refused with the generic message; retrying reloads nothing, so they must reload the page. This is the correct trade (the binding is what makes the record meaningful) but nothing tells them to reload.
- **`packages/service/tests/test-peers.spec.ts` still contains an em-dash** from 05-09. Pre-existing, in a test file, outside the plan's grep scope (`packages/*/src`), and not touched here.

## Known Stubs

None. The whole path is wired end to end: the browser really signs with the participant's key, the route really resolves the DID and verifies the signature, the store really holds the record, and the hash-addressed read really serves it back.

## Verification Results

| Check | Result |
|---|---|
| `pnpm vitest run packages/shared/tests/tos.spec.ts` (task 1 gate) | 12 tests pass |
| `pnpm typecheck` (task 1 and 2 gate) | clean |
| `pnpm vitest run packages/service/tests/tos.spec.ts packages/service/src/store.spec.ts` (task 2 gate) | 40 tests pass |
| `pnpm vitest run packages/web/tests/terms.spec.ts` (task 3 gate) | 20 tests pass |
| `pnpm --filter @btcr2-aggregation/web build` (task 3 gate) | clean |
| `pnpm lint` (task 3 gate) | clean |
| `pnpm test` (full suite, `tsc -b` gated) | 60 files, 969 tests pass |
| `pnpm e2e:browse` | pass (join flow byte-unchanged with no terms set) |
| `pnpm e2e:browser:participant` | pass (browser capstone, full loop) |
| `pnpm e2e:config` | pass (runtime network injection unchanged by the additive `serviceDid`) |
| `pnpm e2e:operator` | pass (login, create, advertise, monitor, cancel legs all unchanged) |
| `grep -rc 'dangerouslySetInnerHTML' packages/web/src` | 0 in every file |
| `grep -rlP '\x{2014}' packages/shared/src packages/service/src packages/web/src` | no files |
| `grep -rlP '\x{2014}' packages/web/src/components/browse` | no files |
| `grep -c 'canonical' packages/shared/src/tos.ts` | 19 |
| `git diff` over every `package.json` and `pnpm-lock.yaml` | empty (no new dependency) |

## User Setup Required

None new. `TERMS_TEXT` (or the console's `Participation terms` setting) already shipped in 05-07; setting it now turns the join-flow step on. A service that sets no terms is byte-unchanged.

## Next Phase Readiness

- **SVC-05 holds.** An operator's terms render as plain escaped text, a participant's agreement is signed with their own DID key in their own browser, the service verifies that signature and binds the terms hash before storing anything, the format is frozen before real acceptances exist, and the app-level enforcement boundary is stated rather than overclaimed.
- **Payments, notifications, and contracts remain unbuilt**, as scoped. They stay requirements capture for the next milestone, behind the anonymous-utility versus accounts product-model decision.
- **All three folded scoping builds are done** (05-11 esplora override, 05-12 PSBT registration leg, 05-13 participation terms), which was the SLIP-FIRST tier (D-22). Nothing in the CORE tier depended on any of them.
- **The acceptance artifact is reusable.** Anything that later needs a DID-signed statement from a participant (a payment authorization, a notification consent) now has a frozen record shape, a verify-before-store route pattern, and a browser signing seam rather than a reason to invent a second one.
- **Carried gap, unchanged from 05-06 onward:** the rendered composition of each new surface is unverified by automated tests. This plan adds one more surface to that list, plus the two viewport backstops named above.

## Self-Check: PASSED

- Created files verified present on disk: `packages/shared/src/tos.ts`, `packages/shared/tests/tos.spec.ts`, `packages/service/tests/tos.spec.ts`, `packages/web/src/components/browse/TermsStep.tsx`, `packages/web/tests/terms.spec.ts`.
- Commits verified in git history: `b653bab`, `68ab351`, `e1ab22f`, `777b0da`, `b7b1af5`.
- Every task acceptance criterion re-run in this session, and the plan-level `<verification>` block re-run in full and green, including both named e2e legs and both greps.

---
*Phase: 05-operator-cohort-lifecycle-control*
*Completed: 2026-07-29*

