# Scoping: participant-supplied esplora endpoint

**Status:** Scoping only (D-54). No build this phase. Traces to the folded todo
`2026-07-21-let-participants-supply-their-own-esplora-endpoint.md` (Phase 3 UAT
trust-minimization critique).

## Problem

Today a participant browser never talks to a Bitcoin esplora node directly. Every chain
read and broadcast goes through the coordinator's same-origin proxy
(`GET /v1/tx/utxos/:address`, `POST /v1/tx/broadcast`, and the anchor/funding reads), so a
participant must fully trust the operator's chain view: UTXO existence, confirmation status,
and broadcast acceptance are all reported by the service they joined. The operator can point
the service at any indexer (`ESPLORA_HOST`), but a participant has no way to verify against
their own. For a product whose whole pitch is "trustless by design," the chain-truth leg is
currently operator-mediated.

The proxy exists for good reasons (same-origin topology, ADR 0003; it avoids third-party
esplora CORS problems and keeps the browser bundle simple), so this is an ADDITION, not a
replacement.

## Options

1. **Do nothing.** The proxy stays the single chain path. Cheapest; leaves the trust gap the
   UAT flagged.
2. **Optional participant-side override (recommended shape).** A participant setting accepts an
   esplora base URL; when set, the participant store's UTXO checks, anchor polling, and
   optionally the broadcast go direct to that endpoint instead of the proxy. The proxy stays the
   zero-config default. `@did-btcr2/bitcoin@0.8.0` already ships the browser esplora REST client,
   so the client capability exists.
3. **Dual-read verification.** Read from both the proxy and the participant's endpoint and flag
   disagreement. Strongest trust story, most UI and failure-mode surface; likely a later
   refinement on top of option 2.

## Recommended scope

Option 2, staged and small: a single optional endpoint field surfaced in the browse/settings
surface, feeding the existing participant-store chain reads. Keep the proxy default. Broadcast
via the participant endpoint is opt-in within the opt-in (a mis-set endpoint must not silently
drop a real transaction).

## Dependencies and open questions

- **CORS on third-party esplora hosts** is the main constraint: many public esplora deployments
  do not allow browser origins. The UI must surface a clear failure mode ("this endpoint does not
  allow browser requests") rather than a generic error.
- **Network-mismatch guard:** refuse an endpoint whose chain does not match the cohort's
  advertised network (compare against `GET /v1/config`), or the participant reads truth from the
  wrong chain.
- **No upstream library change required:** the browser esplora client already exists; this is
  app-level wiring and UI.
- **Interaction with the mainnet rails (ADR 0010):** a participant-supplied endpoint must not
  weaken the existing real-funds acknowledgment gates.
