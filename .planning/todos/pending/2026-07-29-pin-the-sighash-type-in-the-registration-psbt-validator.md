---
created: 2026-07-29T15:20:00.000Z
title: Pin the sighash type in the registration PSBT validator
area: web
severity: high (real funds)
source: .planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md
files:
  - packages/web/src/lib/psbt.ts:96
  - packages/web/tests/psbt.spec.ts
---

## Problem

`validateSignedPsbt` anchors on `bytesToHex(tx.unsignedTx)`, which encodes version, inputs, outputs and locktime but carries no signature metadata. The only signature check is a presence test (`!tx.getInput(0)?.tapKeySig`). The sighash flag lives in the PSBT and the witness, NOT in `unsignedTx`, so it is the one tampering dimension the byte comparison cannot see.

An auditor executed the shipped library and confirmed a PSBT signed under SIGHASH_NONE (0x02) returns `{ ok: true }` and its `rawHex` is handed straight to `broadcastTx`. Both skeptics reproduced it; one confirmed 0x02, 0x82 (NONE|ANYONECANPAY) and 0x83 (SINGLE|ANYONECANPAY) all pass, and that 0x03 (SINGLE) leaves the OP_RETURN unbound. A signature made under those flags does not commit to the transaction outputs.

The module docstring currently claims the opposite: "A tampered input, output, amount, address or OP_RETURN payload all change those bytes, so all of them are caught by one comparison."

Preconditions: participant chooses "Sign with my own wallet"; broadcast reaches a real chain (a service with a real BitcoinConnection, or the participant own esplora with direct broadcast, which bypasses the service entirely); and something between browser and signer sets PSBT_IN_SIGHASH_TYPE to a value the signer honours. The realistic actor is a transport-level intermediary on the return leg, not a compromised wallet (which already holds the key).

## Solution

Add a flag check beside the presence check. A 64-byte BIP340 signature is SIGHASH_DEFAULT; a 65-byte one carries an explicit flag in its trailing byte, and only DEFAULT and ALL (0x01) commit to every output. Reject anything else with a distinct verdict so the panel can explain it rather than showing the generic tampering message. Add spec rows for 0x02, 0x82, 0x83 and 0x03 asserting refusal, and for 64-byte and 0x01 asserting acceptance. Both skeptics independently proposed the same shape; see 05-AUDIT.md for their exact suggested code.

## Provenance

Found by the Phase 5 adversarial audit (2026-07-29) and CONFIRMED: both independent skeptics, whose instructions were to refute it, failed to do so. Full finder report, both skeptic verdicts, their corrections and their suggested fixes are in `.planning/phases/05-operator-cohort-lifecycle-control/05-AUDIT.md`.
