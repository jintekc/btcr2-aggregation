---
created: 2026-07-21T18:07:57.964Z
title: Support external signers instead of pasted private keys
area: security
files:
  - packages/web/src/components/browse/JoinIdentityStep.tsx:1-50
  - packages/web/src/stores/participant.ts
  - packages/shared/src/index.ts
---

## Problem

The join flow offers two identity paths: generate a fresh key in the browser (explicit click, D-04) or import an existing one by pasting the secret (`importSecret` in the participant store). Signing is local and the key never leaves the browser, so the app is self-custodial in the browser-wallet sense, but the import path requires dumping private key material into a web app, which the user (2026-07-21, Phase 3 UAT session) correctly flags as bad practice. There is no way to keep keys in an external signer (hardware wallet, extension wallet, separate signing process) and have the app request signatures.

Hard constraint to record: the cohort co-sign leg is interactive MuSig2 (nonce exchange plus partial signatures, BIP-327 shaped). Hardware wallets and standard PSBT flows do not support MuSig2 partial signing today, so an external signer for the co-sign leg requires a pluggable signer interface in `@did-btcr2/aggregation`'s participant runner (upstream library work, not something this consumer app can bolt on). The registration tx is a plain P2TR key-spend and could support a PSBT/external-signer path much sooner.

## Solution

TBD. Staged sketch: (1) registration leg first, build/serialize the registration tx as a PSBT and accept a signed PSBT back (file or paste), removing the need for the key to be present for that step; (2) evaluate browser extension signers for P2TR key-spend; (3) upstream: propose a signer interface on the aggregation participant runner (keypair object replaced by sign callbacks covering MuSig2 nonce and partial-sig rounds), then integrate here. Also consider at minimum an ephemeral-session warning and never persisting imported secrets.
