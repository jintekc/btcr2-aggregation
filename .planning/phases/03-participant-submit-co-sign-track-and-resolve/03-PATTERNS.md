# Phase 3: Participant Submit, Co-Sign, Track, and Resolve - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 8 (1 new service module + 3 service edits + 1 participant edit + 2 web areas + 1 new e2e; plus 3 deletions)
**Analogs found:** 8 / 8 (every new/modified file has a strong in-repo analog; zero new packages)

The research (`03-RESEARCH.md`) already fixed the file delta and the mechanisms. This map assigns each file its closest existing analog and the exact excerpts to copy from, so plans reference concrete line ranges instead of prose.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/service/src/anchor-state.ts` (NEW) | service | event-driven -> retained-state | `packages/service/src/operator-cohorts.ts` (bounded map + eviction) + `packages/service/src/broadcast.ts` (emitter subscribe) | exact (compose of two) |
| `packages/service/src/hono-adapter.ts` (+`GET /v1/anchor/:cohortId`) | route | request-response | same file, `GET /v1/directory` + `GET /v1/ipfs` mounts (lines 234-261) | exact (in-file) |
| `packages/service/src/operator-cohorts.ts` (widen directory phases; fix `status()` count) | service | CRUD/read | same file, `OPEN_PHASES` + `directory()` + `status()` | exact (self-edit) |
| `packages/participant/src/index.ts` (+opt-in submit gate) | service | event-driven | same file, existing `onProvideUpdate` async callback (lines 158-187) | exact (self-edit) |
| `packages/web/src/stores/participant.ts` (stage model, `pendingSubmit`, anchor poll, unreachable counter, post-seat cohort-gone) | store | event-driven + polling | same file, `directoryPoll`/`directoryEpoch`/`joinGrace` + `ipfsEpoch` module-scope patterns | exact (self-edit) |
| `packages/web/src/components/cohort/*.tsx` (NEW CohortPage, StageTimeline, stage internals) | component | request-response/UI | `packages/web/src/components/browse/BrowseView.tsx` + `ui/primitives.tsx` + surviving `participant/{RegisterPanel,PublishPanel,ResolvePanel,ResultCard}.tsx` logic | role-match |
| `e2e/browser-participant-cohort.ts` (NEW capstone, `e2e:browser:participant`) | test | request-response (browser) | `e2e/lib/browser-harness.ts` + `e2e/browse-join-cohort.ts` (service boot/advert ordering) | exact |
| DELETE `participant/{FlowStepper,ParticipantView,KeyGenPanel}.tsx` | component | - | n/a (dead code; sole importer is ParticipantView per RESEARCH grep) | n/a |

## Pattern Assignments

### `packages/service/src/anchor-state.ts` (NEW - service, retained-event-state)

**Analogs:** `broadcast.ts` (the emitter to subscribe to) + `operator-cohorts.ts` (the bounded-map + eviction idiom).

**Subscribe-once to the typed emitter** - copy the listener shape from `broadcast.ts` `BeaconBroadcaster` (lines 39-60 define `on/off/emit` over `BeaconAnchorEvents`; the three payloads are at lines 12-28):
```typescript
// BeaconAnchorEvents (broadcast.ts:12-28) - the exact facts to retain:
'beacon-broadcast': { cohortId: string; txid: string };
'beacon-anchored': { cohortId: string; txid: string; confirmed: boolean };
'beacon-broadcast-failed': { cohortId: string; reason: string };
```
Fold these into a `Map<cohortId, { state: 'broadcast'|'confirmed'|'failed'; txid?; reason? }>` (`beacon-anchored{confirmed:true}` -> `confirmed`; `confirmed:false` stays `broadcast`; failed -> `failed`).

**Bounded map + oldest-first eviction** - copy verbatim from `operator-cohorts.ts` `MAX_TERMINAL`/`rememberTerminal` (lines 268, 296-305):
```typescript
const MAX_TERMINAL = 24;                       // reuse the same cap (D-20 sizing)
function rememberTerminal(cohortId, config, reason) {
  terminal.set(cohortId, { config, reason });
  while (terminal.size > MAX_TERMINAL) {
    const oldest = terminal.keys().next().value;  // Map preserves insertion order
    if (oldest === undefined) break;
    terminal.delete(oldest);
  }
}
```

**`enabled` mode-honesty bit + explorer URL** - `enabled` = broadcaster present (mirrors the `GET /v1/ipfs` `{enabled:false}` probe, hono-adapter.ts:255-261). Derive `explorerUrl` via `network.explorerTxUrl(txid)` inside a try/catch exactly as `dashboard-sse.ts` does (lines 139-145):
```typescript
const explorerUrl = (txid: string): string => {
  try { return network?.explorerTxUrl(txid) ?? ''; } catch { return ''; }
};
```

**Per-service closure state, NOT a module singleton** - follow `createOperatorCohorts` (operator-cohorts.ts:270-287): return a `createAnchorState(broadcaster?, network?)` factory whose maps live in the closure, so two services in one process (tests) never share state.

**Spec co-located** as `anchor-state.spec.ts` (Wave 0 gap): event fold, bounds/eviction, `enabled`, unknown-cohort -> `{state:'none'}`.

---

### `packages/service/src/hono-adapter.ts` (+ `GET /v1/anchor/:cohortId` - route, request-response)

**Analog:** the public route block already in this file - `GET /v1/directory`/`/v1/status` (lines 234-250) and `GET /v1/ipfs` (255-261). Mount the new read in the SAME block, OUTSIDE the `if (operatorAuth)` gate (line 299) so it stays public (D-21/ADR 0015).

**Guard-first, cheap 400 before lookup** (house pattern; RESEARCH Code Examples):
```typescript
app.get('/v1/anchor/:cohortId', (c) => {
  const cohortId = c.req.param('cohortId');
  if (!/^[0-9a-zA-Z-]{1,64}$/.test(cohortId)) {
    return c.json({ error: 'invalid cohort id' }, 400);   // cheap 400 before any lookup
  }
  return c.json(anchorState ? anchorState.read(cohortId) : { enabled: false, state: 'none' });
});
```
Note the fail-open default mirrors `/v1/directory` (line 243: `operatorCohorts ? ... : []`) - when no anchor state is wired, return `{enabled:false, state:'none'}`, never a 500. Unknown cohort returns `{state:'none'}` (not 404) to avoid an existence oracle (Security Domain).

---

### `packages/service/src/operator-cohorts.ts` (widen directory phases; fix `status()` - service, read)

**Analog:** self-edit. The exact lines to change:

**`OPEN_PHASES`** (lines 71) currently `{Advertised, CohortSet, CollectingUpdates}`. D-26 adds a DISPLAY-only in-flight tier including the signing phases (`SigningStarted, NoncesCollected, AwaitingPartialSigs`). **Do not fold this into `OPEN_PHASES`** - `directory()` filters on it (line 350) and `status().openCohorts` reuses `directory().length` (line 494). Widening it silently inflates the public open count (Pitfall 3). Introduce a separate display set / phase-tier and keep the joinable count on the Advertised-tier only.

**`DirectoryCohortDTO`** (lines 144-154) already carries `phase: string` - the client already receives the raw phase for `statusLabel` (D-26 "In progress" copy is client-side; unknown phases already fall back to the raw string, line comment 192 of RESEARCH).

**Leave byte-untouched:** `pickedCohortClosed`/`isJoinable` filter on `Advertised` client-side (RESEARCH Finding 5) - the Phase 2 grace logic depends on them. Spec both the widened display list AND the unchanged joinable count.

---

### `packages/participant/src/index.ts` (+ opt-in submit gate - service, event-driven)

**Analog:** self-edit of the existing `onProvideUpdate` callback (lines 158-187). Two invariants to preserve:

1. **The decline path runs BEFORE the gate** (lines 167-174): a `classifyCohortFit === 'mismatch'` returns `null` (cooperative non-inclusion) and must never reach a submit window (D-15/D-19 backstop; Finding 1).
2. **Build the update ONCE, then gate** (lines 175-186): `buildSignedUpdate` is BIP340-non-deterministic, so the previewed body must be the submitted body (D-12/D-29). Build at window-open, hold it, resolve the deferred with that exact object. `submittedUpdates.set(...)` (line 185) then works unchanged.

**Gate is strictly opt-in** (Pitfall 1): add an optional option (e.g. `onSubmitGate`) to `CreateParticipantOptions` (lines 14-39, additive-optional only). Absent = today's auto-submit, which every e2e peer + `FILLERS` relies on. Never reject/throw inside the callback (Pitfall 2: an `onProvideUpdate` throw sends neither submit nor decline - the whole-cohort staller, documented at lines 162-166).

The `getSubmittedUpdate`/`getDeclineReason` accessors (lines 81-91, 204-205) already expose exactly what the round-trip check (D-29) and non-inclusion outcome (D-10) consume - do not add new capture.

---

### `packages/web/src/stores/participant.ts` (stage model + pendingSubmit + anchor poll - store, event-driven + polling)

**Analog:** self-edit. Reuse three proven module-scope patterns already in this file.

**Deferred submit via module-scope resolver** - model on `live`/`captured` (lines 236-247) and the `ipfsEpoch` teardown (lines 261-264). Store only a serializable projection in Zustand; the deferred + built body at module scope:
```typescript
// module scope, like `live` (participant.ts:236) - epoch-clearable like ipfsEpoch
let pendingSubmit: { cohortId: string; update: SubmittedUpdate; resolve: (u: SubmittedUpdate) => void } | null = null;
// user clicks "Submit my DID update":
submitUpdate() { pendingSubmit?.resolve(pendingSubmit.update); pendingSubmit = null; }
```
Teardown rule: `leave()`/terminal/`teardownLive` (line 321) must CLEAR `pendingSubmit` without settling it (Pitfall 2).

**Anchor poll (post-sign only, epoch-guarded)** - copy the cadence + round-token idiom from `directoryPoll`/`directoryEpoch` (lines 280-289, 705-712) and `clearDirectoryPoll` (334-342):
```typescript
const epoch = anchorEpoch;                    // mirrors directoryEpoch (line 705)
anchorPoll = setInterval(() => {
  fetchAnchor(baseUrl, cohortId).then((dto) => {
    if (epoch !== anchorEpoch) return;        // stale-continuation guard (WR-01 class)
    set({ anchor: dto });
    if (dto.state === 'confirmed' || dto.state === 'failed') clearAnchorPoll();  // D-22 freeze
  }, () => { /* unreachable counter (D-24), never terminal by itself */ });
}, 5000);
```

**Stage as a DERIVED value, not a second state machine** (RESEARCH Pattern 3): add a pure exported `deriveStage(state)` selector spec-tested like `pickedCohortClosed` (line 361), deriving from existing facts (`status`, `optedIn`, `seated`, `pendingSubmit != null`, `steps`, `anchor`, resolve status). Do NOT store a parallel stage enum.

**Post-seat cohort-gone detection** is a NEW concern with its OWN predicate - never route post-seat snapshots through `handleDirectorySnapshot` (lines 727-791), which encodes "left Advertised = closed" and would fail a legitimately-signing cohort (Pitfall 6). Treat the join-through-seat block (`handleDirectorySnapshot`, grace-timer, `awaitingSeats`) as FROZEN; ADD around it (Pitfall 5).

**`StepKey`/`steps` migration:** `steps: Record<StepKey, StepStatus>` (line 114, `INITIAL_STEPS` at 365) is superseded by the stage derivation - migrate or remove, do not leave both (RESEARCH State of the Art).

---

### `packages/web/src/components/cohort/*.tsx` (NEW - component, UI)

**Analogs:** `browse/BrowseView.tsx` (view composition + baseUrl prop + store subscription), `ui/primitives.tsx`, and the surviving `participant/{RegisterPanel,PublishPanel,ResolvePanel,ResultCard}.tsx` logic (absorbed as stage internals per D-31).

**Build the timeline/expander/summary from primitives** (`ui/primitives.tsx` exports): `Card`, `SectionTitle`, `Badge` (tone), `Button`, `Input`, `Select`, `Field`, `StatusDot` (the "Your cohort" live dot, D-03), `Mono`, `CopyField` (DID/txid/beacon-address as copyable, D-06). No new UI kit.

**View mount** follows `App.tsx` (lines 66-72): `App` switches `OperatorConsole` vs `BrowseView` on `pathname`; the CohortPage is internal SPA view state (D-11, no routed URL) selected off store state, NOT a new route. Copy the store-subscription shape from `App.tsx` (`useParticipant((s) => ...)`).

**Mode-honest copy branches on `anchor.enabled`** (Pitfall 4): every anchor/resolve string gates on the anchor read's `enabled`; hermetic path never renders "Anchored"/txid/"reflected". Absorb `RegisterPanel` (live-only conditional stage) and IPFS publish (`PublishPanel`) as POST-completion stages, not at submit (Finding 8). Round-trip check has three honest outcomes (Finding 7 / RESEARCH Code Examples).

**No em-dash in copy; no booth/attendee wording** (Anti-Patterns; blocked a Phase 2 plan-check iteration).

---

### `e2e/browser-participant-cohort.ts` (NEW capstone - test, browser)

**Analogs:** `e2e/lib/browser-harness.ts` (exports `getFreePort`, `resolveChromium`, `waitForApp`, `trackPageErrors`, `launchBrowser`) + `e2e/browse-join-cohort.ts` (service boot / operator login+advertise / headless in-process peers / advert-ordering discipline).

**Reuse harness plumbing** (Don't Hand-Roll): `launchBrowser()`/`waitForApp()`/`trackPageErrors()` solve Chromium resolution, cookie handling, page-error tracking. Boot the service + operator advertise from `browse-join-cohort.ts`'s pattern (imports at its top: `createParticipant`, `createService`, `buildCohortConfig`, `createIdentity`).

**Advert-ordering discipline is load-bearing** (Pitfall 7; documented at length in `browse-join-cohort.ts` header, lines ~35-52): the server transport keeps a SINGLE most-recent advert slot; advertise the picked cohort LAST (or advertise a single cohort) and synchronize on hard completion events, never bare timers.

**Drives ONE real Chromium page** (the participant) while headless in-process peers fill remaining seats; asserts: browse -> pick -> join -> explicit submit CLICK -> co-sign -> mode-honest SIGNED (not "anchored") state -> auto-resolve -> round-trip check, plus criterion 4 (directory is the landing; no KeyGen-first stepper affordance). Script: `e2e:browser:participant`. CI wiring stays Phase 6 debt (D-32).

---

### DELETE `participant/{FlowStepper,ParticipantView,KeyGenPanel}.tsx`

Dead code after the rewire (RESEARCH State of the Art: the sole importer of all three is `ParticipantView` itself, per grep). KeyGen/import survive ONLY in `browse/JoinIdentityStep.tsx` (one identity moment, D-31); Register/Publish/Resolve/Result LOGIC survives as cohort-page stage internals.

## Shared Patterns

### Bounded map + oldest-first eviction (DoS bound)
**Source:** `packages/service/src/operator-cohorts.ts:268,296-305` (`MAX_TERMINAL`, `rememberTerminal`)
**Apply to:** `anchor-state.ts` retained map. Same cap (24), same insertion-order eviction.

### Public read outside the auth block, guard-first
**Source:** `packages/service/src/hono-adapter.ts:234-261` (`/v1/directory`, `/v1/status`, `/v1/ipfs`)
**Apply to:** the new `GET /v1/anchor/:cohortId`. Public (D-21), cheap 400 shape-guard before lookup, fail-open default DTO, no request body, unknown -> non-oracle answer.

### Explorer URL derivation (try/catch)
**Source:** `packages/service/src/dashboard-sse.ts:139-145`
**Apply to:** `anchor-state.ts` DTO (`explorerUrl` from `network.explorerTxUrl(txid)`).

### Module-scope non-reactive state + epoch stale-guard
**Source:** `packages/web/src/stores/participant.ts:236-247` (`live`/`captured`), `261-264`+`334-342` (`ipfsEpoch`/`directoryEpoch` teardown + round-token)
**Apply to:** `pendingSubmit` deferred, `anchorPoll`/`anchorEpoch`, post-seat cohort-gone poll, unreachable counter.

### Pure exported predicate, spec-tested
**Source:** `packages/web/src/stores/participant.ts:361` (`pickedCohortClosed`), `packages/participant/src/index.ts:48-53` (`matchesPickedCohort`)
**Apply to:** `deriveStage(state)` and the D-29 round-trip outcome function - pure, exported, co-located spec.

### Per-service closure state (never a module singleton)
**Source:** `packages/service/src/operator-cohorts.ts:270-287`; `index.ts` `seatedRosterKeys`/`genesisStaging` closures
**Apply to:** `createAnchorState(...)` factory.

### UI primitives + route-off-pathname shell
**Source:** `packages/web/src/ui/primitives.tsx`, `packages/web/src/App.tsx:66-72`
**Apply to:** all new `components/cohort/*.tsx`.

## No Analog Found

None. Every file in the Phase 3 delta has a strong in-repo analog (mostly self-edits of files that already own the exact idiom). Zero new packages, zero speculative structures.

## Metadata

**Analog search scope:** `packages/service/src/{anchor-state(new),broadcast,dashboard-sse,operator-cohorts,hono-adapter}.ts`, `packages/participant/src/index.ts`, `packages/web/src/{stores/participant.ts,App.tsx,ui/primitives.tsx,components/{browse,participant}}`, `e2e/{browse-join-cohort.ts,lib/browser-harness.ts}`
**Files scanned:** 9 read in full/targeted + import-graph greps
**Pattern extraction date:** 2026-07-17
</content>
</invoke>
