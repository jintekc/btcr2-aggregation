# Phase 5 verification walkthrough (owner-run)

**Purpose:** the phase's closing human gate. Phase 5 removed the last hardwired, uncontrollable
behavior: the operator now cancels, finalizes, pauses, reconfigures, and sets terms on a RUNNING
service. This checklist is what "it works" means, written down, so the closing verification is
against criteria rather than recollection.

**What is already proven hermetically** (do not re-do by hand): the full unit suite under the
composite typecheck (`pnpm test`), the linter, the web production build, and thirteen end-to-end
legs, four of them added by this phase. One command runs the e2e legs in sequence:

```bash
pnpm test && pnpm lint && pnpm --filter @btcr2-aggregation/web build && pnpm e2e:gate
```

`pnpm e2e:gate` covers `operator`, `monitor`, `cancel`, `pause`, `testpeers`, `fallback`,
`fallback:operator`, `browse`, `kofn`, `live:mock`, `resolve`, `config`, and `persist`. What is
left for a human is what no test asserts: whether each surface reads honestly, whether the
ceremonies land where they should, and whether the whole thing is runnable by a stranger.

**Mode:** everything below runs HERMETICALLY (the boot default: no `LIVE`, no `BROADCAST`) except
where a section says otherwise. The two live-only legs are marked. Real-money behavior was already
gated in Phase 4 and is unchanged here.

---

## Prerequisites

- [ ] The repo built: `pnpm -r build`.
- [ ] Nothing else on port 8080.

## Boot

- [ ] Start a hermetic service with an operator password and a couple of settings seeded from the
      environment, so you can watch the "environment default" versus "changed this session"
      labelling do real work:

      ```bash
      OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 \
        SERVICE_NAME="Phase 5 check" DEFAULT_SIZE=2 \
        pnpm demo
      ```

- [ ] Open http://localhost:8080 (the participant surface) and http://localhost:8080/operator
      (the console) in separate windows. Sign in with the operator password.
- [ ] Confirm the health strip names the service, the network, and a hermetic mode, and that the
      public directory header carries the same service name.

---

## SVC-04 criterion 1: advertise, the automatic close, finalize

> "The operator moves a cohort through open -> close -> finalize from the console and the
> directory reflects each state change."

- [ ] Create a cohort (`New cohort`), size 2, and advertise it. Confirm you land in its drill-down.
- [ ] In the participant window, confirm the cohort appears in the public directory as joinable
      with its seat count.
- [ ] Join from the participant window. Confirm the console's member list shows the seat and the
      chip moves to `Filling`.
- [ ] Fill the last seat (join from a second participant window, or use `Fill remaining seats with
      test peers` from the drill-down). Confirm:
      - the console's stage timeline shows a `Closed` stage reached AUTOMATICALLY, with no button
        that could have caused it,
      - the cohort leaves the joinable tier of the public directory,
      - the chip moves to `Co-signing`.
- [ ] Confirm there is NO "close cohort" control anywhere. Closing is the nth seat locking the
      roster; a button would be a synthetic state (ADR 0017, alternatives considered).
- [ ] While the cohort is co-signing, confirm `Finalize now` is offered. Let the round complete
      normally instead of using it (the finalize path itself is covered below and by
      `pnpm e2e:fallback:operator`), and confirm the cohort ends `Signed` in the Ended group.
      NOT `Anchored`: this run is hermetic, so the cohort co-signed a fixture transaction and
      anchored nothing, and `Anchored` would be a claim about Bitcoin this service cannot make.
      That word is reserved for a beacon transaction this service watched confirm on-chain.
      - Metrics consequence: on a hermetic run the `anchored` counter stays at 0 by construction,
        however many cohorts you complete. Completions are counted by the Ended group, not by that
        column. A `0` there is the honest reading, not a fault.
      - Unchanged: a k-of-n script-path cohort still surfaces under `Needs attention`, exactly
        where it does today. Its chip now reads `Signed via fallback` rather than claiming an
        anchor, but nothing moved out of that group.

**Reads true?**

- [ ] Every state change the console showed was also visible from the participant side, with no
      window in which the two disagreed.

## SVC-04 criterion 2: pause advertising is a drain, not a kill

> "The operator pauses or cancels advertising so new cohorts stop being offered, without killing
> the running service."

- [ ] With ONE cohort advertised and unfilled, click `Pause advertising` on the Service controls
      card. Confirm no confirmation dialog appears (pause is reversible; friction here would dilute
      the cancel ceremony).
- [ ] In the participant window, confirm:
      - the paused notice appears in the public directory,
      - the already-advertised cohort is STILL listed and STILL joinable, and a fresh participant
        can actually join it,
      - resolve still answers (`GET /resolve/:did` or the participant resolve surface).
- [ ] In the console, confirm `Advertise cohort` on a draft is refused with an honest
      advertising-is-paused reason, and that the draft is left intact (not discarded, not
      half-created).
- [ ] Confirm drafts can still be created and edited, and that cancel, finalize, monitoring, and
      export all still work while paused.
- [ ] Check the paused bit is on the wire for a headless client:
      `curl -s localhost:8080/v1/status` shows `"paused":true`.
- [ ] Click `Resume advertising`. Confirm the notice clears, the status bit flips, and advertising
      works again.

**Reads true?**

- [ ] A paused service is distinguishable from an idle one, both in the UI and in `/v1/status`.
      (This is why the bit exists: both show zero open cohorts.)

## SVC-04 criterion 3: reconfigure without restarting

> "The operator reconfigures cohort shape without editing env vars or restarting the process."

- [ ] Create a draft, then EDIT it in place (not discard and recreate): change its size and beacon
      type, save, and confirm the change is reflected.
- [ ] On the same draft, set a discovery window shorter than the service maximum. Confirm it saves.
- [ ] Now try a discovery window LARGER than the service maximum. Confirm it is REFUSED at save,
      with the real maximum named in the message, rather than accepted and quietly not honored.
- [ ] Open Service settings. Change the default size, the default beacon type, and the service
      name. Confirm each field shows where its value came from, and that a field you changed reads
      as changed this session with the environment value still named.
- [ ] Confirm the service name change is visible on BOTH the console health strip and the public
      directory header without a restart.
- [ ] Create a NEW draft and confirm it starts from the changed defaults.
- [ ] Advertise a cohort, THEN change the defaults again. Confirm the advertised cohort is
      completely unaffected: its size, threshold, and windows do not move.
- [ ] Deliberately submit an invalid settings save (for example k greater than n). Confirm NOTHING
      is applied, not even the valid fields in the same save.

**Reads true?**

- [ ] Nothing in this section required editing an environment variable or restarting the process,
      and nothing reshaped a cohort that was already public.

## SVC-04 criterion 4: a canceled cohort stops being joinable

> "A canceled or closed cohort no longer appears as joinable in the participant directory."

- [ ] Advertise a cohort and join it from a participant window so there is a real seat at stake.
- [ ] From the drill-down, click `Cancel cohort`. Confirm the confirmation names the cohort and
      states how many seated participants will lose their seats. Confirm it.
- [ ] Confirm in the console the cohort ends with a distinct `Canceled` fate (not `Failed`, not
      `Expired`), carrying a real server timestamp, and that the cancel appears in the operator
      actions log.
- [ ] In the participant window, confirm the cohort disappears from the joinable directory.
- [ ] Confirm the SEATED participant is told the OPERATOR canceled it, not the generic "the cohort
      ended and this service didn't say why" line, and NOT the stall copy.
- [ ] **The sibling-cohort check (the defect this phase found):** advertise cohort A, then cohort
      B. Cancel B. Then, from a FRESH participant window (an already-open one holds the advert and
      will pass regardless), confirm cohort A is still discoverable AND actually joinable.
- [ ] Confirm that after the beacon transaction has broadcast, the cancel action is HIDDEN rather
      than disabled. (Live only; skip hermetically, or take it from `pnpm e2e:cancel`.)

**Reads true?**

- [ ] Canceled, failed, and expired are three visibly different outcomes, and the participant was
      never told a story the service could not support.

## Absorbed items

### The one-way broadcast switch (LIVE + BROADCAST boot only)

- [ ] Boot with `LIVE=1 BROADCAST=1` against a chain you control. Confirm the Service controls card
      offers `Disable broadcast` (it is absent in hermetic and live-no-broadcast modes).
- [ ] Engage it. Confirm the confirmation is danger-toned and states the consequence, that the
      health strip STILL reports the live mode the service booted with, and that a separate line
      says broadcast is off for this session.
      **Which chip on that strip is still live:** you are confirming the MODE chip and the
      broadcast-off line, and only those. The `Esplora reachable` badge beside them is NOT being
      refreshed for cohorts advertised after the switch, because the funding watch was its only
      feeder and a stood-down cohort no longer starts one. It reports whatever it last read, or its
      optimistic initial value if nothing ever wrote it. Do not treat that badge as evidence of
      anything here. See the amended kill-switch consequences in
      `docs/adr/0017-runtime-lifecycle-control.md` (T-05-16-05).
- [ ] Confirm the control is REPLACED, not merely disabled: there is no path back from the console,
      and the copy names the boot environment as the way to re-enable.
- [ ] Confirm a cohort advertised BEFORE the switch still broadcasts, and a cohort advertised AFTER
      it is created on the fixture path (it never waits for funding).
- [ ] Confirm the action appears in the operator actions log.

### Ended-record dismissal

- [ ] With at least one ended cohort in the Ended group, click `Dismiss` on it. Confirm the
      confirmation is a simple, neutral one (no typing).
- [ ] Confirm the record disappears and does NOT come back on the next poll.
- [ ] Confirm the dismissal itself is recorded in the operator actions log. (The one action whose
      purpose is to remove evidence must not be the one that goes unrecorded.)
- [ ] Confirm `Dismiss` is offered ONLY on ended rows, never on a live or draft one.

### Runtime service-name edit

- [ ] Covered in criterion 3. Additionally: restart the process and confirm the name returns to
      `SERVICE_NAME` from the environment, and that the console's restart-honesty line said this
      would happen BEFORE you restarted.

### Test peers (solo rehearsal)

- [ ] On a filling cohort's drill-down, click `Fill remaining seats with test peers`. Confirm the
      seats fill and the cohort proceeds.
- [ ] Confirm each spawned member carries the `Test peer` badge and the row line saying the
      operator added it, and that a REAL participant in the same cohort carries neither.
- [ ] Confirm the spawn is stamped in the operator actions log.
- [ ] Confirm the action refuses honestly on a cohort with no remaining seats (rather than
      appearing to work).
- [ ] **Live only:** confirm the confirmation states BEFORE the act that the peers co-sign for real
      and their DIDs are anchored on the named network, and that an honest note says each peer's
      own first-update registration is skipped and why.

## PART-05: the participant's own chain endpoint

> "A participant can point their browser's chain reads at their own esplora endpoint, with a
> network-mismatch guard, four distinguishable failure messages, no silent fallback, and every
> real-funds guard rail unweakened."

- [ ] In the participant surface, find the chain endpoint field. Confirm the default is the
      service's same-origin proxy and that leaving it alone changes nothing.
- [ ] Set a VALID endpoint for the service's network. Confirm it is accepted and that the
      participant's UTXO checks and anchor confirmations go there.
- [ ] Set an endpoint for a DIFFERENT chain. Confirm it is REFUSED before any read, with the chain
      mismatch message, and that it is not activated.
- [ ] Set an endpoint that does not send permissive CORS headers. Confirm you get the specific
      "does not allow browser requests" message, NOT "unreachable".
- [ ] Set an unreachable host. Confirm the unreachable message.
- [ ] Set a malformed URL (or a non-http scheme). Confirm the malformed message, with no request
      made.
- [ ] Confirm there is no silent fallback in either direction: a refused endpoint is never
      activated, and a failing override never quietly reverts to the service proxy.
- [ ] Confirm broadcasting through the override is a SECOND explicit opt-in, and that it cannot be
      raised without an endpoint set and is dropped when the endpoint is cleared.
- [ ] **Real-funds gates:** confirm the mainnet acknowledgment, the re-entrancy guard, and the
      funding check all fire IDENTICALLY whether or not an override is set.

**Reads true?**

- [ ] Every one of the four failures told the participant something they could act on, and none of
      them was reported as another one.

## PART-06: sign the registration in your own wallet

> "A participant can sign the registration transaction in their own wallet through a PSBT round
> trip that is validated against the exact template the app created before anything is broadcast."

- [ ] On the completion screen of an included KEY participant, find the wallet registration path.
      Export the unsigned PSBT (download and/or copy).
- [ ] Return a MODIFIED PSBT (change an output, or return an unsigned one). Confirm the validation
      refuses it with a message you can act on, and that NOTHING is broadcast.
- [ ] Return the correctly signed PSBT. Confirm it validates and broadcasts through the same
      guarded path as the in-browser flow, showing the registration txid.
- [ ] Confirm nothing from the round trip is written to browser storage (reload and confirm the
      PSBT slice is gone).
- [ ] Confirm the paste-import path carries its ephemeral-session warning.
- [ ] Confirm the MuSig2 co-sign limit is stated honestly: this path covers the registration
      transaction only, not the cohort co-sign, which needs an upstream signer interface.

- [ ] **NON-BLOCKING: the external-wallet leg.** If you have a hardware or desktop wallet handy,
      try the real round trip and report what it did with the exported PSBT. The round trip itself
      is proven programmatically (`packages/shared/tests/psbt.spec.ts` pins the txid, fee, change,
      and witness-free body), and wallet interoperability was NOT verified in this environment, so
      no wallet is named as compatible in any shipped copy. **A wallet that refuses the data output
      is a support note, not a phase failure.**

## SVC-05: participation terms

> "Participation terms set by the operator are accepted at join and recorded as a DID-signed,
> server-verified, terms-hash-bound artifact, with the app-level enforcement boundary disclosed
> honestly."

- [ ] With NO terms set, join a cohort from the participant surface. Confirm the join flow has no
      terms step at all (the feature is absent, not empty).
- [ ] Set participation terms from Service settings. Confirm the settings help states the
      app-level enforcement boundary.
- [ ] Reload the participant surface and start a join. Confirm the terms step appears, renders the
      text as plain escaped text (paste something with markup and a very long unbroken URL and
      confirm neither renders as HTML nor widens the card), and scrolls inside its container while
      the join controls stay reachable.
- [ ] Confirm the join button will not proceed until the terms are accepted, and that the moment
      between clicking accept and the record existing is visible (a busy state), not inferred.
- [ ] Accept. Confirm the acceptance reference is shown, and fetch it at
      `GET /cas/acceptance/<hash>` to confirm the artifact really exists and names the terms HASH,
      never the text.
- [ ] EDIT the terms, then re-read that same stored acceptance. Confirm it is byte-unchanged and
      still names the ORIGINAL hash. A terms edit cannot rewrite what somebody agreed to.
- [ ] Clear the terms. Confirm the step disappears entirely and joining is byte-unchanged from the
      first step of this section.

**Reads true?**

- [ ] The honest-limit caption reads as candor rather than as a disclaimer, and nothing anywhere
      implies the protocol enforces this.

---

## What this phase deliberately did NOT build

Do not look for these; their absence is not a defect.

- **Payments, notifications, and contracts.** Requirements capture only, for the next milestone.
  The anonymous-utility versus accounts product-model decision comes first (D-19).
- **Active per-seat reclaim or kick.** Re-parked: `@did-btcr2/aggregation@0.4.0` has no
  seat-release API at all, so the console states the real workaround (cancel and re-advertise)
  rather than offering a control that could only pretend. See `docs/UPSTREAM-LIMITS.md` limit 2.
- **External co-sign for MuSig2.** Upstream-blocked on a signer interface. The PSBT leg covers the
  registration transaction only.
- **Dual-read esplora verification** (flagging disagreement between the proxy and an override).
  A later refinement on top of PART-05.
- **Extension-wallet signer integration.** After the PSBT leg lands.
- **Routed URLs.** The console drill-down is SPA-internal view state, as in Phase 4.
- **Durable state.** Pause, the broadcast switch, and every runtime setting are in-memory for the
  session; a restart returns the service to its boot environment. That is the stated model
  (ADR 0017 decision 3), and durability is DUR-01 in v2.
- **An operator-side list of who accepted the terms.** An acceptance is readable by its hash and
  appears on no listing endpoint, deliberately.
- **A "close cohort" button.** There is no close primitive and there could not usefully be one.

## Hermetic evidence of record

| Check | Command |
|---|---|
| Composite typecheck + full unit suite | `pnpm test` |
| Linter | `pnpm lint` |
| Web production build | `pnpm --filter @btcr2-aggregation/web build` |
| All thirteen hermetic e2e legs in sequence | `pnpm e2e:gate` |
| Browser capstones (local, not in CI) | `pnpm e2e:browser:participant`, `pnpm e2e:browser:operator` |
| Live walkthrough harness (owner-run, real chain) | `pnpm uat:live` |

---

## Sign-off

- [ ] **PASS:** the four SVC-04 sections and the absorbed-items section all behaved as written, and
      the PART-05, PART-06, and SVC-05 sections behaved as written with the external-wallet leg
      treated as non-blocking.

Reply `approved` to close Phase 5, or describe any section that did not match its written criteria
for gap closure.
