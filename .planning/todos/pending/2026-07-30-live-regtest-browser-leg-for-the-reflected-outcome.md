---
created: 2026-07-30T19:20:00.000Z
title: Live regtest browser leg for the reflected round-trip outcome
area: e2e
severity: medium (honesty; the honest-success half of D-29 has no end-to-end witness)
source: .planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT-2.md (entry 19, defect #28)
status: FILED, not built. Nothing in this todo exists yet and no work on it is scheduled.
files:
  - e2e/live-uat.ts
  - package.json
  - packages/web/src/components/cohort/CompletionSummary.tsx
  - e2e/browser-participant-cohort.ts
---

## Problem

The participant's honest-success sentence, `Your update is reflected. The resolved DID document now
lists this cohort's beacon service`, is the copy that tells a participant their update actually
landed. No test in this repo has ever seen it rendered by a real page against a real chain, and
none can.

`e2e/browser-participant-cohort.ts` asserts the NEGATIVE: it FAILS if that sentence appears, because
it runs a structurally hermetic boot where a reflected round trip is impossible. So before 05-27 the
only automated opinion the repo held about this copy rewarded its disappearance: deleting the arm or
renaming the sentence made that leg MORE green, and both were measured shipping green through the
whole suite.

05-27 added the cheap half: `packages/web/tests/completion-summary.spec.ts` pins the sentence, its
single call site, and its rendering through the store fake. That closes the rename and the
deletion. It does NOT close the real question, which is whether a genuine live success reaches the
arm at all, or degrades to the warn-toned "Your update was not found in the resolved document yet"
box a participant reads as a failure.

## Why no existing harness can reach it

Every browser harness in this repo is hermetic by construction (`browser-cohort.ts`,
`browser-prod-cohort.ts`, `browser-participant-cohort.ts`, `browser-operator.ts` all boot with no
`live` and no `broadcast`). `roundTripOutcome` returns `reflected` only when the resolved document
carries this DID's aggregate beacon AND the service broadcasts. With no chain there is no beacon
signal to discover, so the arm is unreachable, not merely untested. Faking it would mean stubbing
the component's own resolve logic, which pins the stub rather than the product.

## What is needed

1. **A Chromium page bolted onto `e2e/live-uat.ts`**, the existing Polar/regtest live harness that
   already boots `createService({ live, broadcast })` with a funding wait and a runner-event tap.
   The page drives the participant loop the way `e2e/browser-participant-cohort.ts` does (browse,
   join, submit, wait for the co-sign, wait for the auto-resolve) against that live service instead
   of a hermetic one.
2. **A new `package.json` e2e script entry**, alongside `uat:live` and the four `e2e:browser*`
   entries. It is NOT part of `pnpm e2e:gate`: it needs a funded regtest node, so it stays an
   opt-in leg like `e2e:live:regtest`.
3. **The assertion, in both directions**: after the beacon tx confirms and the auto-resolve settles,
   the page shows the reflected sentence (import or mirror `reflectedRoundTripSentence` so the two
   cannot drift), and does NOT show the not-found warn box. The hermetic leg's existing negative
   assertion stays exactly as it is; the two together are the pair.

## Note on the harness

`e2e/live-uat.ts` was written during the Phase 3 live UAT and is owned outside the GSD commit flow.
Whoever picks this up should confirm its current shape before building on it rather than assuming
the Phase 3 description still holds.

## Provenance

`.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT-2.md` entry 19 and its
"New infrastructure required" note, which says in as many words: ship the cheap hermetic copy pin
now and file the live leg. 05-27 did the first and this is the second.
