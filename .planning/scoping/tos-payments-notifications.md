# Scoping: ToS, contracts, payments, and participant notifications

**Status:** Scoping only (D-54). No build this phase, and NOT part of the current
11-requirement / 6-phase roadmap. Traces to the folded todo
`2026-07-21-scope-tos-contracts-payments-and-participant-notifications.md` (Phase 3 UAT product
vision). This is milestone-level scope, not a defect of any built phase.

## Problem

The owner's product vision includes four service-relationship concepts that are entirely absent
from the app today. They are what turn the aggregator from a free public utility into a real
commercial service:

1. **Participant notifications:** a participant learns their cohort needs action (fund, submit,
   co-sign, resolve) WITHOUT keeping a browser tab open.
2. **Terms-of-Service acceptance:** a participant formally accepts the service's terms when
   joining, recorded and provable.
3. **Contract signing** between the service and the participant.
4. **A payment flow:** the aggregation service as a PAID service.

None of these are built, and none have requirements. They each need their own requirements
gathering (what is the payment rail, what makes a contract binding here, what transport carries
notifications for a same-origin web app with anonymous participants, how ToS acceptance is
recorded and proven).

## Options (sketch level only)

- **Notifications:** email/webhook opt-in at join time; or a participant-supplied callback URL;
  or a lightweight account. Each trades anonymity (the current model) for reachability, so the
  transport choice is really a product-model choice.
- **ToS / contracts:** because both sides already hold `did:btcr2` identities and signing keys,
  ToS acceptance and a service-participant contract could themselves be DID-signed artifacts,
  which fits the product's own technology and gives provable, non-repudiable acceptance without a
  new trust anchor.
- **Payments:** on-chain (Bitcoin/Lightning, fitting the domain) vs off-chain (card/processor);
  per-cohort vs subscription; who pays (participant, operator, both).

## Recommended scope

DO NOT build this phase or this milestone. This is requirements work: run it through
`/gsd-new-milestone` (or a dedicated requirements discussion) AFTER the current milestone's
phases 4 through 6 land. Capture the four concepts as candidate requirements with the open
questions above, and decide the product model (anonymous utility vs accounts-and-payments
service) before any of it is designed, because that decision cascades into every one of the four.

## Dependencies and open questions

- **Product-model decision first:** anonymous-by-default (today) vs accounts. Notifications and
  payments both effectively require some durable participant handle, which changes the anonymity
  posture the whole app is built on.
- **Synergy to exploit:** DID-signed ToS/contract artifacts reuse the identities both sides
  already hold; worth prototyping as the lowest-new-trust path.
- **Legal/compliance** (what makes a contract binding, payment/KYC obligations) is outside
  engineering scope and must be answered by the owner before design.
- **No upstream library dependency**, but a payment rail and a notification transport are each new
  infrastructure the single-box self-host model (ADR 0014) does not currently include.
