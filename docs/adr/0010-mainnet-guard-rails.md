# ADR 0010: Mainnet guard rails - layered opt-ins on every path that can move real money

- Status: Accepted
- Date: 2026-07-06
- Milestone: M3f (mainnet guard rails; the HIGH real-money item on the M3-PLAN risk register)

## Context

The app treats the Bitcoin network as pure config: `bitcoin` (mainnet) has been a
first-class registry entry since M3a, and the M3f runtime injection (`GET /v1/config`)
means one operator env var (`NETWORK=bitcoin`) retargets the whole stack - the
coordinator identity, every cohort config, the esplora connection, and every DID and
beacon address the browser mints. That is the design goal (self-hostable on any
network), but it also means a single typo'd env var could put **real money** in play
on three distinct paths:

1. **The live aggregate beacon tx** (`createService` with `live`/`broadcast`): spends
   a real UTXO at the cohort's MuSig2 beacon address and broadcasts it.
2. **The browser first-update registration** (ADR 0008): the controller funds their
   genesis P2TR beacon address and the SPA builds, signs, and broadcasts an
   `OP_RETURN <updateHash>` spend of it through the same-origin `/v1/tx/*` proxy.
3. **The demo/operator server** (`startDemoServer`): even offline it hands the
   browser mainnet DIDs plus a beacon address it invites the controller to FUND, and
   under `LIVE=1` its tx proxy relays raw signed transactions to mainnet.

Two further real-money hazards are not about *broadcasting* but about *custody*:

- **Throwaway recovery keys.** Every cohort config needs a `recoveryKey` (the x-only
  key of the ADR 042 Taproot recovery leaf) and a `recoverySequence` (a BIP-68
  block-based relative timelock; 144 blocks is roughly one day). `buildCohortConfig`
  derives a fresh key and **discards the secret**, so the recovery path exists
  structurally but nobody can ever use it. Harmless when the beacon tx is the
  zero-chain fixture; a silent funds-loss mode the moment a funded mainnet cohort
  needs the escape hatch (a vanished participant leaves the n-of-n key path dead and
  the k-of-n fallback below threshold).
- **Public secrets in the live e2e.** `e2e/live-broadcast-cohort.ts` uses fixed
  participant/recovery secrets so the beacon address is stable for manual faucet
  funding. Those secrets are in this public repo: on mainnet the funded beacon would
  be **anyone-can-spend** (the n-of-n key path is reconstructable immediately; the
  recovery leaf becomes sweepable by anyone after `recoverySequence` blocks).

Existing hooks before this ADR: `assertNetworkAllowed` (mainnet requires
`allowMainnet: true`) guarded `createService`'s live path, the live e2e required
`ALLOW_MAINNET=1`, the served `NetworkConfigDTO` carried `isMainnet`, and the
registration builder refused a UTXO that could not cover fee + dust-safe change.

## Decision

**Layer explicit opt-ins so mainnet can never be reached by accident, keep every
mainnet default OFF, and document the custody semantics (recovery, change, dust)
instead of pretending the app can enforce them.**

1. **Operator server: mainnet requires `ALLOW_MAINNET=1`** (or
   `allowMainnet: true`), *even offline*, because an offline mainnet coordinator
   still mints real addresses and invites funding them. When allowed, boot logs a
   loud real-funds banner naming exactly what is live (proxy relaying, registration
   fees, recovery-key state). The `RECOVERY_KEY` env threads an operator-held x-only
   recovery key into every advertised cohort config; without it the banner calls out
   the throwaway default. It stays optional here because demo cohorts sign the
   fixture tx and the cohort beacon is never funded.
2. **`createService` keeps guarding only the live path.** Serving mainnet
   *resolution* (`GET /resolve/:did`) or the read-only artifact routes is harmless
   and legitimate, so a bare `bitcoin` connection does not demand the opt-in; the
   `live` flag (the only funds-moving switch at this layer) still does, via
   `assertNetworkAllowed`.
3. **Browser: the runtime `isMainnet` flag drives visible + enforced guards.** The
   header badge flips to a red `REAL FUNDS` pill. The register panel shows a
   real-funds warning (fee amount, where change goes, save-your-secret) and disables
   the broadcast button behind an acknowledgment checkbox. Defense in depth: the
   store's `register()` itself refuses on mainnet without `acknowledgeMainnet: true`,
   before any network I/O, so no future UI path can skip the gate.
4. **Dust-aware outputs, both builders.**
   - The library beacon-tx builder (method ADR 044/045) already sizes fees
     analytically, validates a `changeAddress` for the network, and absorbs
     below-dust change into the fee. The app adds a pre-flight funding floor
     (`MIN_LIVE_FUNDING_SATS`) applied to the UTXO the builder will *actually
     spend*: the pre-flight runs the library's own `selectSpendableUtxo` (the
     DEEPEST confirmed UTXO above its 546-sat limit, deliberately not the largest),
     so selection parity holds by construction and a dusty, unconfirmed-only, or
     deep-small-UTXO balance fails before MuSig2 signing starts, with the address,
     the doomed UTXO, and why topping up cannot fix it (new funding confirms
     shallower and is never selected first) all named.
   - The in-browser registration builder keeps refusing a UTXO below
     fee + P2TR dust (`MIN_REGISTRATION_FUNDING_SATS`) and now also refuses a
     non-positive fee and any fee above `MAX_REGISTRATION_FEE_SATS` (20k sats for a
     ~150 vB tx), so a fat-fingered override cannot burn the funding UTXO.
5. **Live e2e: mainnet needs more than a flag.** `ALLOW_MAINNET=1` alone is refused
   on mainnet unless `LIVE_PARTICIPANT_SECRETS` and `LIVE_RECOVERY_SECRET` are
   explicitly set AND none of them equal the public built-in defaults.
   `LIVE_CHANGE_ADDRESS` optionally routes the beacon tx change to an operator
   wallet instead of back to the beacon address (address reuse); the run logs which
   routing is in effect.
6. **Recovery + change custody semantics are documented, not simulated.**
   `buildCohortConfig` accepts an operator `recoveryKey` (validated as a real
   x-only point so an off-curve key fails at config time, not deep in keygen); only
   the PUBLIC key belongs on the server - derive it offline and keep the secret in
   cold storage. Change handling per path: the aggregate beacon tx returns change to
   the beacon address unless `changeAddress` says otherwise; the registration tx
   always returns change to the controller's own genesis beacon address (spendable
   by their identity key, so "save your secret" is part of the mainnet warning).

## Consequences

- `NETWORK=bitcoin` without `ALLOW_MAINNET=1` now fails fast at boot with an
  actionable message (previously it silently served a mainnet config; under `LIVE=1`
  it would have relayed real transactions with zero friction). `e2e/config.ts`
  asserts the refusal, the opted-in boot via both the option and the
  `ALLOW_MAINNET=1` env (the operator interface), and the `RECOVERY_KEY` env
  reaching config validation; the prod browser e2e drives the rails through the
  real UI against an offline mainnet coordinator (REAL FUNDS badge, warning card,
  checkbox-gated registration reaching the funds check).
- Reaching a real mainnet broadcast now takes, in combination: `NETWORK=bitcoin` +
  `ALLOW_MAINNET=1` (+ `LIVE=1` for the proxy), and for the aggregate path
  `live: true` + `allowMainnet: true` + fresh non-default secrets, and for the
  browser path a user-ticked acknowledgment. No single mistake spans all layers.
- The guard rails are deliberately *not* a wallet: fee estimation, coin selection,
  and key custody remain the operator's and controller's responsibility; this ADR
  only ensures the app never spends real money silently and never manufactures an
  unusable recovery path for funded value without saying so.
- Test networks are untouched: no new flags, prompts, or friction anywhere off
  mainnet, keeping the hermetic gate and the public mutinynet demo flow identical.
