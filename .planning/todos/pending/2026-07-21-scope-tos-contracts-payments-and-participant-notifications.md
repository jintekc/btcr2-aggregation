---
created: 2026-07-21T18:07:57.964Z
title: Scope ToS contracts payments and participant notifications
area: product
files: []
---

## Problem

The user's product vision (2026-07-21, Phase 3 UAT session) includes four service-relationship concepts that are entirely absent from the app and from the current 11-requirement, 6-phase roadmap:

1. Participant notifications (a participant learns their cohort needs action without keeping the tab open)
2. Terms-of-Service registration (a participant formally accepts the service's terms when joining)
3. Contract signing between service and participant
4. A payment flow (the aggregation service as a paid service)

These make the aggregator a real commercial service rather than a free public utility. None are defects of built phases; they are new milestone-level scope requiring their own requirements gathering (what is the payment rail, what makes a contract binding here, what transport carries notifications for a same-origin web app, how ToS acceptance is recorded and proven).

## Solution

TBD. This is requirements work, not implementation: run it through `/gsd-new-milestone` (or a requirements discussion) after the current milestone's phases 4-6 land. Note possible synergy: ToS acceptance and contract signing could themselves be DID-signed artifacts (both sides already hold did:btcr2 identities and signing keys), which would fit the product's own technology.
