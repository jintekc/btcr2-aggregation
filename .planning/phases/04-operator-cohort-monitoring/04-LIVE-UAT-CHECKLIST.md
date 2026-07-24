# Phase 4 live-UAT walkthrough (owner-run, against Polar/regtest)

**Purpose:** the phase's final human gate (D-50/D-55). This is the "an actual real server
working out-of-the-box" check: a genuinely broadcasting coordinator, a real cohort beacon you
fund from your own wallet, a real on-chain anchor, and a resolve that reflects the update. It
cannot run in CI (real funds, a real chain you mine), so the owner runs it by hand. The hermetic
evidence of record is already automated: the mocked-chain funding leg in `e2e/live-mock-cohort.ts`
(`pnpm e2e:live:mock`) and the fixture monitoring e2e (`pnpm e2e:monitor`).

**What this exercises:** the LIVE-01 live-path operability core built across 04-05 through 04-07,
end to end: `BROADCAST=1` boot enablement, the cohort-beacon funding stage (3 states + dead-end +
recovery-key/mainnet disclosure), the clamped funding wait, the bounded broadcast send retry, and
the participant-side awaiting-funding notice + honest stall/resolve copy. The harness is
`e2e/live-uat.ts`, run via `pnpm uat:live`.

---

## Prerequisites

- [ ] A Polar network running (regtest) with its esplora REST endpoint up, OR any bitcoind +
      esplora pair. Note the esplora REST port (Polar's default is often `http://127.0.0.1:3000`,
      but confirm yours).
- [ ] A funded wallet in Polar you can send from and mine blocks with.
- [ ] The repo built: `pnpm uat:live` runs `pnpm -r build` first, so no separate build step.

## Boot

- [ ] Start the harness against your chain (set the ACTUAL esplora port):

      ```bash
      ESPLORA_HOST=http://127.0.0.1:3000 pnpm uat:live
      ```

      Optional: `RECOVERY_KEY=<x-only-hex>` (throwaway regtest sats, so the unset warning is fine
      to see too), `NETWORK=regtest` (default), `PORT=8080`, `OPERATOR_PASSWORD` (default
      `live-uat`), `FUND_WAIT_MS` (funding window, default 15 min).

- [ ] Confirm the boot banner prints the LIVE + BROADCAST loud banner (each cohort's beacon tx is
      broadcast on-chain; fund each beacon address; the funding window; and the recovery-key state).
      If `RECOVERY_KEY` is unset, confirm the loud THROWAWAY warning appears.
- [ ] Confirm the printed app URL, operator password, esplora host + tip height, and network line.
- [ ] Open the app URL in a browser.

## Operator: create and advertise a live cohort

- [ ] Go to `/operator`, sign in with the operator password.
- [ ] Confirm the health strip reads a LIVE mode (not hermetic), the active network, and esplora
      reachability.
- [ ] Create a cohort (pick a small size, e.g. 2, k = n) and advertise it. Confirm you land in the
      cohort's drill-down (not an empty page).

## Participants: join and submit

- [ ] In one or more participant browser windows (or tabs), browse the directory, pick the cohort,
      generate an identity, join, and submit the DID update. Fill every seat.
- [ ] Confirm the participant sees the join-time on-chain notice and, after seats fill, the honest
      "waiting for the operator to fund this cohort's beacon address" copy (D-44), NOT a generic
      stall.

## Funding (the operator's job, from Polar)

- [ ] When seats fill, keygen runs. Confirm the operator console surfaces the funding stage in the
      drill-down and a `Needs funding` chip on the cohort, showing the beacon address (with copy +
      explorer link) and ONE suggested minimum in sats. The terminal also prints FUND THIS ADDRESS.
- [ ] From Polar, send ONE UTXO at or above the suggested minimum to the beacon address, then mine
      1 block so it confirms.
- [ ] Watch the funding stage advance honestly: waiting -> seen (unconfirmed in mempool, if you
      observe before mining) -> funded (confirmed, at/above minimum). Confirm the recovery-key
      disclosure line is shown throughout (operator-held vs throwaway).

## Co-sign, broadcast, anchor

- [ ] Confirm co-signing proceeds automatically once funded, and completes.
- [ ] Confirm the terminal logs `BROADCAST cohort=... txid=...` and the operator anchor detail
      shows Signed -> Broadcast (with the txid + explorer link).
- [ ] Do NOT mine yet: confirm the UI holds "Broadcast" with "Confirmed: pending" beneath (the
      "Anchored" narration is reserved for a real confirmation). Then mine 1 block in Polar
      PROMPTLY. Confirm every surface flips to Anchored / Confirmed together, and the terminal logs
      `ANCHORED ... confirmed=true`.

## Resolve

- [ ] Resolve the updated DID from the participant surface. Confirm it reflects the update (not a
      stale genesis), OR, if you resolve against a still-unconfirmed signal, that it returns the
      honest retryable "a beacon signal is awaiting confirmation, resolve again after it confirms"
      outcome (D-46), never a raw 500.

## Honesty checks (must all read true)

- [ ] The funding stage never claimed funded before a confirmed at-or-above-minimum UTXO existed.
- [ ] The anchor never claimed "Anchored" before a real confirmation.
- [ ] The resolve reflects the update once confirmed, and the copy read honestly throughout (no
      false "stalled collecting updates" on a genuine co-sign completion; no invented partial-sig
      progress).

## Optional negative legs

- [ ] **Funding dead-end:** fund the beacon with a UTXO BELOW the suggested minimum and mine.
      Confirm the funding stage reaches the terminal dead-end copy ("topping up cannot fix this"),
      not an endless wait.
- [ ] **Funding never arrives:** do not fund at all. Confirm the cohort dead-ends after the funding
      window with the specific "funding never arrived" reason (or, if you kill esplora over the
      lapse, the uncertainty-honest blind-lapse copy), not a generic phase stall.

---

## Sign-off

- [ ] **PASS:** the funding stage advanced honestly, the anchor confirmed, the resolve reflected
      the update, and the stall/resolve copy read honestly end to end.

Reply `approved` in the execute-phase checkpoint to close LIVE-01 and the phase, or describe the
defects observed (funding-stage state, anchor, resolve, or copy) for gap closure.
