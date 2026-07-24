# Scoping: external signers instead of pasted private keys

**Status:** Scoping only (D-54). No build this phase. Traces to the folded todo
`2026-07-21-support-external-signers-instead-of-pasted-private-keys.md` (Phase 3 UAT
security critique).

## Problem

The join flow offers two identity paths: generate a fresh key in the browser (explicit click)
or import an existing one by pasting the secret (`importSecret` in the participant store).
Signing is local and the key never leaves the browser, so the app is self-custodial in the
browser-wallet sense, but the import path requires dumping private key material into a web app,
which is bad practice. There is no way to keep keys in an external signer (hardware wallet,
extension wallet, a separate signing process) and have the app REQUEST signatures.

The hard constraint that shapes everything here: the cohort co-sign leg is interactive MuSig2
(nonce exchange plus partial signatures, BIP-327 shaped). Hardware wallets and standard PSBT
flows do not support MuSig2 partial signing today, so an external signer for the CO-SIGN leg
requires a pluggable signer interface in `@did-btcr2/aggregation`'s participant runner, which is
upstream library work this consumer app cannot bolt on. The registration transaction, by
contrast, is a plain P2TR key-spend and could support a PSBT / external-signer path much sooner.

## Options

1. **Do nothing.** Keep paste-import. Cheapest; leaves the "paste your secret into a web app"
   footgun the UAT flagged.
2. **Registration-leg PSBT first (recommended near-term).** Build and serialize the first-update
   registration transaction as a PSBT, hand it out (download or copy), and accept a signed PSBT
   back (upload or paste). This removes the need for the key to be present for the registration
   step. It is fully doable in this app: the registration tx is a plain key-spend.
3. **Browser extension signer for P2TR key-spend.** Evaluate wallet extensions that expose a
   P2TR signing capability for the registration leg (and, eventually, for identity proof).
4. **Full external-signer co-sign (upstream-gated).** Propose a signer interface on the
   aggregation participant runner: replace the in-memory keypair with sign callbacks covering the
   MuSig2 nonce and partial-signature rounds, then integrate here once released. This is the only
   path that removes pasted keys from the co-sign leg.

## Recommended scope

Stage it: option 2 (registration-leg PSBT) is the first concrete, self-contained win and needs
no upstream change. Option 4 is the real end state but is BLOCKED on an upstream signer interface
in `@did-btcr2/aggregation`; file the request and adopt when released. As an immediate,
zero-dependency mitigation regardless of staging: add an ephemeral-session warning on the import
path and never persist an imported secret.

## Dependencies and open questions

- **Upstream (hard blocker for the co-sign leg):** a pluggable signer interface on the
  aggregation participant runner (MuSig2 nonce + partial-sig callbacks). Without it, the co-sign
  leg cannot use an external signer at all. This is the same upstream posture as the
  partial-sig-received event request (D-32).
- **PSBT round-trip UX:** how the participant moves the unsigned/signed PSBT (file vs paste), and
  how the app validates the returned PSBT before broadcasting.
- **Extension-wallet landscape:** which extensions actually expose P2TR key-spend signing today,
  and whether any expose MuSig2 (none known at time of writing).
- **Interaction with the mainnet rails (ADR 0010):** an external signer must still pass the
  real-funds acknowledgment gates before any broadcast.
