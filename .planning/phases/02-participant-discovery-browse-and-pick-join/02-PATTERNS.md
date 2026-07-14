# Phase 2: Participant Discovery + Browse-and-Pick Join - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 13 (5 new, 5 modified, 3 new tests)
**Analogs found:** 13 / 13

Every file this phase touches has a strong in-repo analog. Phase 2 is a zero-new-backend, zero-new-package phase (verified in RESEARCH): the work is a new anonymous browse surface, a one-line `shouldJoin` predicate change, an `App.tsx` route restructure, and a participant-store lifecycle change. All excerpts below honor the house style: explicit `.js` import extensions (source omits them here because these are TS module specifiers resolved by NodeNext / Vite bundler; new relative imports in `packages/*` MUST carry `.js`), module-prefixed `console.*`, manual shape guards at HTTP boundaries, `credentials: 'omit'` on public reads, and clean operator/service/aggregator framing (no booth/attendee wording).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/web/src/components/browse/BrowseView.tsx` (NEW) | component | request-response (landing composition) | `packages/web/src/components/participant/ParticipantView.tsx` | role-match (composition/gating) |
| `packages/web/src/components/browse/DirectoryList.tsx` (NEW) | component | polling read (~5s) | `packages/web/src/components/operator/PublicStatus.tsx` | exact (anonymous polled read) |
| `packages/web/src/components/browse/CohortRow.tsx` (NEW) | component | presentational row | `packages/web/src/components/operator/OperatorCohortList.tsx` (`CohortRow`) | exact (per-cohort row from primitives) |
| `packages/web/src/components/browse/ServiceIdentityHeader.tsx` (NEW) | component | polling read (~10s) | `packages/web/src/components/operator/PublicStatus.tsx` | exact (status-derived header) |
| `packages/web/src/components/browse/JoinIdentityStep.tsx` (NEW) | component | form / identity | `packages/web/src/components/participant/KeyGenPanel.tsx` | exact (KEY/import identity panel) |
| `packages/web/src/App.tsx` (MODIFIED) | shell/route | request-response | itself (`:37`, `:65-73`) | self (route composition) |
| `packages/web/src/stores/participant.ts` (MODIFIED) | store | event-driven state machine | itself (`join`/`leave`/`teardownLive`) | self |
| `packages/participant/src/index.ts` (MODIFIED) | service (isomorphic runner wrapper) | event-driven (advert filter) | itself (`shouldJoin` `:120-123`) | self |
| `packages/web/src/lib/directory.ts` (NEW, optional re-home) | utility | fetch client | `packages/web/src/lib/operator.ts` (`fetchDirectory`/`fetchStatus`) | exact |
| `e2e/browse-join-cohort.ts` (NEW) | test (e2e) | full lifecycle | `e2e/operator-cohort.ts` | exact (hermetic capstone) |
| `packages/participant/src/index.spec.ts` (NEW) | test (unit) | predicate | `packages/web/src/stores/participant.spec.ts` | role-match (co-located vitest) |
| `packages/web/src/stores/participant.spec.ts` (EXTEND) | test (unit) | store state | itself | self |
| `packages/web/src/components/browse/*.spec.ts` (NEW) | test (unit) | pure fn / render | `packages/web/src/stores/participant.spec.ts` | role-match (nearest web vitest) |

## Pattern Assignments

### `packages/web/src/components/browse/DirectoryList.tsx` + `ServiceIdentityHeader.tsx` (component, polling read)

**Analog:** `packages/web/src/components/operator/PublicStatus.tsx` (whole file, 71 lines)

This is the single most load-bearing analog: the exact `useEffect` -> `setInterval` -> `active`-guard -> `clearInterval` poll pattern that RESEARCH Pattern 2 mandates for both the ~5s directory poll and the ~10s identity-header status poll. Copy it verbatim, swapping `fetchStatus` for `fetchDirectory` and `POLL_MS = 10000` -> `5000`. Crucially, the analog's `.catch(() => setStatus(undefined))` -> "renders nothing" behavior must be **split** into the three distinct D-12 states (empty vs unreachable vs loaded) - do not collapse unreachable into empty.

**Poll pattern** (`PublicStatus.tsx:6-42`):
```typescript
/** Poll cadence for the public status (bounded fetch; no new dependency). */
const POLL_MS = 10000;   // DirectoryList: 5000 (D-05)

useEffect(() => {
  let active = true;
  const load = () => {
    fetchStatus(baseUrl)
      .then((s) => { if (active) { setStatus(s); } })
      .catch(() => { if (active) { setStatus(undefined); } });  // SPLIT for D-12(b) "unreachable"
  };
  load();
  const timer = setInterval(load, POLL_MS);
  return () => { active = false; clearInterval(timer); };
}, [baseUrl]);
```

**Header composition + mainnet network chip** (`PublicStatus.tsx:48-69`) - reuse verbatim for `ServiceIdentityHeader`, adding the origin (`window.location.host`) as the Display heading and the open-cohort count:
```typescript
const net = resolveNetwork(status.network);
const openCopy = status.openCohorts === 0 ? 'No open cohorts right now' : `${status.openCohorts} open cohorts`;
// ...
<StatusDot tone="good" pulse label="service online" />
<span className="text-sm text-ink">Service online</span>
// network chip, incl. the mainnet `· REAL FUNDS` bad-tone variant (UI-SPEC Color):
net.isMainnet
  ? 'rounded-full border border-bad/50 bg-bad/10 px-3 py-1 text-xs font-semibold text-bad'
  : 'rounded-full border border-edge bg-surface px-3 py-1 text-xs text-faint'
```

**Data source:** `fetchDirectory(baseUrl)` / `fetchStatus(baseUrl)` from `lib/operator.ts` (or the re-homed `lib/directory.ts`), both already `credentials: 'omit'`.

---

### `packages/web/src/components/browse/CohortRow.tsx` (component, presentational row)

**Analog:** `packages/web/src/components/operator/OperatorCohortList.tsx` `CohortRow` (`:19-72`)

The operator `CohortRow` is the exact primitive-composition template: a `Card className="space-y-3 p-4"` with a flex header of `Badge` + muted metadata spans + a `CopyField` for the id + a right-aligned action `Button`. Phase 2's row differs in three ways the planner must apply: (1) status `Badge` tone is derived from the plain-language label (Open=`accent`, Filling=`warn`, Collecting updates=`neutral`, Full=`neutral`) per UI-SPEC, not draft/advertised; (2) the action is the single `Join` button, `variant="primary"`, disabled unless `isJoinable`; (3) add the n-of-n threshold and seats captions.

**Row shell + badge + metadata + copyfield + action** (`OperatorCohortList.tsx:29-52`):
```typescript
<Card className="space-y-3 p-4">
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={isDraft ? 'neutral' : 'accent'}>{isDraft ? 'Draft' : 'Advertised'}</Badge>
      <span className="text-sm text-muted">{cohort.network}</span>
      <span className="text-sm text-muted">{beaconLabel(cohort.beaconType)}</span>
      <span className="text-sm text-muted">{cohort.joined}/{cohort.capacity} seats</span>
    </div>
    <Button variant="primary" disabled={isAdvertising} onClick={...}>Advertise cohort</Button>
  </div>
  <CopyField label={isDraft ? 'draft id' : 'cohort id'} value={cohort.draftId} />
</Card>
```

**Joinability + status-label pure functions** (from RESEARCH Code Examples - the semantic gate the planner MUST honor; note `Advertised` is the ONLY joinable phase, Pitfall 1):
```typescript
const JOINABLE_PHASE = 'Advertised';
function isJoinable(row: DirectoryCohortDTO): boolean {
  return row.phase === JOINABLE_PHASE && row.joined < row.capacity;
}
function statusLabel(phase: string): string {
  switch (phase) {
    case 'Advertised':        return 'Open';                 // joinable, accent badge
    case 'CohortSet':         return 'Filling';              // NOT joinable (membership locked)
    case 'CollectingUpdates': return 'Collecting updates';   // NOT joinable
    default:                  return phase;                  // Mono fallback
  }
}
```
Put these in the row module (or a `lib/directory.ts`) and unit-test them (Wave 0 gap). `beaconLabel` (`OperatorCohortList.tsx:7-9`) is reusable verbatim; extend with the D-08 gloss (`CAS · content-addressed` / `SMT · sparse Merkle tree`).

---

### `packages/web/src/components/browse/JoinIdentityStep.tsx` (component, form / identity)

**Analog:** `packages/web/src/components/participant/KeyGenPanel.tsx` (whole file, 172 lines)

D-04's inline identity-at-Join step is a subset/refactor of `KeyGenPanel`: the KEY/EXTERNAL radiogroup, the `generate(kind)` default, the import-secret form, the config-loading gate, and the key-custody note all exist here already. The planner should extract the identity-acquisition portion (generate + import + model toggle) and drop `KeyGenPanel`'s Join/Leave/status-badge tail (that moves to the seated state / `BrowseView`).

**Store hooks + config gate** (`KeyGenPanel.tsx:22-38`):
```typescript
const generate = useParticipant((s) => s.generate);
const importSecret = useParticipant((s) => s.importSecret);
const configStatus = useParticipant((s) => s.configStatus);
// Gate generation/import until GET /v1/config resolves so a DID is never minted on the wrong chain:
const configLoading = configStatus !== 'ready';
```

**KEY/EXTERNAL radiogroup + generate/import** (`KeyGenPanel.tsx:68-100`) - reuse the radiogroup markup verbatim; both onboarding models stay available (D-04). The key-custody note (UI-SPEC copy `Your keys stay in this browser. This service never sees your private key.`) replaces the analog's `text-faint` helper lines.

**Import form** (`KeyGenPanel.tsx:101-126`) - the 64-hex secret form + `importSecret(importValue, kind)` -> `setImportError(err)` pattern is reusable as-is.

**Critical D-04 nuance:** the `Cancel` (ghost) path must not have minted a key if generation has not run - the analog generates only on explicit `generate(kind)` click, which already satisfies "no key material behind the participant's back."

---

### `packages/web/src/components/browse/BrowseView.tsx` (component, landing composition)

**Analog:** `packages/web/src/components/participant/ParticipantView.tsx` (54 lines)

`ParticipantView` is the composition/gating template: it reads store slices, gates the reused tail on `hasResult` (`:20,28`), and lays out `Card`-wrapped panels. `BrowseView` composes `ServiceIdentityHeader` + `DirectoryList` + (on pick) `JoinIdentityStep` + (on seat) the reused tail. RESEARCH Pitfall 4 is the load-bearing constraint: **keep the store as the single lifecycle owner** and reach the tail via the same `hasResult`-style gate; do not duplicate lifecycle logic in the browse component.

**Tail gate to reuse unchanged** (`ParticipantView.tsx:18-35`):
```typescript
const hasResult = useParticipant((s) => s.result !== null);
// ...
{hasResult && (<><ResultCard /><PublishPanel baseUrl={baseUrl} /><RegisterPanel baseUrl={baseUrl} /><ResolvePanel baseUrl={baseUrl} /></>)}
```
D-11: `RegisterPanel`/`PublishPanel`/`ResolvePanel`/`ResultCard` are reused **unchanged** below the seated confirmation. Phase 3 rewires the tail; Phase 2 must not touch those four files.

---

### `packages/web/src/App.tsx` (shell/route, MODIFIED)

**Analog:** itself (`:37`, `:65-73`)

The route composition already branches on `pathname === '/operator'`. D-13 change: the anonymous branch renders `BrowseView` as the landing instead of `PublicStatus` + `ParticipantView`.

**Current anonymous branch** (`App.tsx:37,65-73`) - the exact lines to restructure:
```typescript
const isOperator = pathname === '/operator';
// ...
{isOperator ? (
  <OperatorConsole baseUrl={baseUrl} />
) : (
  <div className="space-y-6">
    <PublicStatus baseUrl={baseUrl} />      // -> replaced by BrowseView (which owns the header)
    <ParticipantView baseUrl={baseUrl} />   // -> the tail moves inside the seated state of BrowseView
  </div>
)}
```
`loadConfig(baseUrl)` on mount (`:33-35`) and `baseUrl = window.location.origin` (`:15`, D-01) stay unchanged.

---

### `packages/participant/src/index.ts` (service/runner wrapper, MODIFIED)

**Analog:** itself (`shouldJoin` at `:120-123`)

The single PART-02 mechanism (D-14). Add `cohortId?: string` to `CreateParticipantOptions` and narrow `shouldJoin`. Verified against `@did-btcr2/aggregation@0.4.0` `participant-runner.js` `#handleAdvert` (RESEARCH): `shouldJoin(advert)` is awaited per discovered advert; `false` => no opt-in sent.

**Current auto-join** (`index.ts:120-123`):
```typescript
shouldJoin: async (advert: CohortAdvert) => {
  cohortBeaconTypes.set(advert.cohortId, normalizeBeaconType(advert.beaconType));
  return true;
},
```

**Narrowed (join-by-filter)** - the exact change:
```typescript
shouldJoin: async (advert: CohortAdvert) => {
  // Browse-and-pick (D-14): ignore every cohort except the one the participant chose.
  if (opts.cohortId !== undefined && advert.cohortId !== opts.cohortId) {
    return false;
  }
  cohortBeaconTypes.set(advert.cohortId, normalizeBeaconType(advert.beaconType));
  return true;
},
```
Add the `cohortId?` field to `CreateParticipantOptions` (`index.ts:14-26`) with a JSDoc noting the omitted-keeps-legacy-accept-all behavior (do not rely on it in Phase 2). Match the file's existing comment density.

---

### `packages/web/src/stores/participant.ts` (store, MODIFIED)

**Analog:** itself (`join` `:407-546`, `leave` `:548-563`, `teardownLive` `:239-248`, `JOIN_WATCHDOG_MS` `:227-231/534-540`)

Three coordinated changes (RESEARCH Pattern 3, D-06/D-12/D-14):

1. **`join(baseUrl)` -> `join(baseUrl, cohortId)`** (signature `:162`, body `:407,423`): thread `cohortId` into `createParticipant({ identity, baseUrl, cohortId })` (`:423`).

2. **Remove `JOIN_WATCHDOG_MS`** (`:227-231,250-255,534-540`) and replace the "no advert received" timer with the directory-driven outcome. The `cohort-joined` handler (`:432-444`) must NOT be treated as "seated" (Pitfall 3): `cohort-joined` = opt-in sent. Use `cohort-ready` (`:445-448`) as the definitive seat and the directory poll for the negative ("that cohort just filled or closed").

3. **Fix the stale comment** at `:233-238`/`:507-508` ("the runner joins EVERY advert") - false under join-by-filter (RESEARCH State of the Art).

**`teardownLive` to keep** (`:239-248`) - the stop-and-forget after complete/fail is still correct; just update its rationale comment (no longer "the booth's next re-advertised cohort" - clean framing, D-09/HOST-03).

**`leave()` to wire into browse** (`:548-563`) - already tears down `live`/`ipfs`/`captured` and returns to `ready`/`no-identity`; D-15 wires it to the "Leave cohort" -> back-to-directory action. No new seat-release protocol (D-15/D-16: no opt-out message exists in the protocol - verified).

**Event-handler wiring template** (`:427-526`) - the `r.on('cohort-...')` block is the pattern for the new seated/waiting/closed states; keep the store the single lifecycle owner (Pitfall 4).

---

### `packages/web/src/lib/directory.ts` (utility, NEW - optional re-home)

**Analog:** `packages/web/src/lib/operator.ts` (`fetchDirectory` `:192-202`, `fetchStatus` `:176-186`, DTO types `:79-95`)

Claude's-discretion re-home (D-08 / CONTEXT `:98`): the public `fetchDirectory`/`fetchStatus` + `DirectoryCohortDTO`/`ServiceStatus` are not operator-only. If relocated, copy the exact `credentials: 'omit'` + bounded-timeout + shape-guard shape verbatim; keep `credentials: 'omit'` (Security V4 - never send the operator session cookie from the anonymous browse surface).

**Public-read template** (`operator.ts:192-202`):
```typescript
export async function fetchDirectory(baseUrl: string): Promise<DirectoryCohortDTO[]> {
  const res = await fetch(endpoint(baseUrl, '/v1/directory'), {
    headers: { accept: 'application/json' },
    credentials: 'omit',                             // PUBLIC: never send the session cookie
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`GET /v1/directory failed: HTTP ${res.status}`);   // manual boundary guard
  }
  return (await res.json()) as DirectoryCohortDTO[];
}
```
`endpoint()` helper + `TIMEOUT_MS = 8000` (`operator.ts:10-14`) come along if re-homed. If NOT re-homed, import directly from `lib/operator.ts` - both are equally acceptable per D-08.

---

## Test Pattern Assignments

### `e2e/browse-join-cohort.ts` (NEW, hermetic capstone)

**Analog:** `e2e/operator-cohort.ts` (whole file, 358 lines)

The Phase 1 capstone is the exact template: `runXxx(options): Promise<string[]>` returning a problems list, `withTimeout` helper (`:82-97`), boot a real `createService` on the offline/fixture path (`:126-131`), capture `signing-complete` for the 64-byte signature (`:137-148`), operator login->create->advertise over real HTTP (`:196-248`), then N real `createParticipant`s discover + join + co-sign (`:279-320`), and the `invokedDirectly` main guard (`:328-357`). Reuse `THRESHOLD = 2` with `threshold === capacity === 2` (the n-of-n norm, RESEARCH Pitfall 2 / A1).

**Phase 2 additions the planner must specify** (RESEARCH Test Map):
- **PART-02 positive:** participants constructed with the picked `cohortId` filter join ONLY that cohort; a second concurrently-advertised cohort is NOT joined (assert its `joined` stays 0 / no `cohort-complete` for it).
- **Criterion-3 negative:** a participant with a `cohortId` for a cohort already past `Advertised` never fires `shouldJoin` -> no `cohort-ready` -> deterministic reject (no dead spinner).
- Register an `e2e:browse` script in `package.json` (mirror `e2e:operator`); do NOT wire into CI (Phase 6 CI debt - the red `e2e:browser*` rewrite).

**Multi-participant lifecycle template** (`operator-cohort.ts:279-320`):
```typescript
const identities = Array.from({ length: THRESHOLD }, () => createIdentity());
const participants = identities.map((identity) => createParticipant({ identity, baseUrl /*, cohortId */ }));
const participantComplete = participants.map((p, i) => new Promise<void>((resolve) => {
  p.runner.on('cohort-complete', () => resolve());
}));
await Promise.all(participants.map((p) => p.start()));
await withTimeout(signingComplete, timeoutMs, 'operator cohort signing');
// ... assert aggregatedSignatureLength === 64 && signedCohortId === cohortId
```
Cookie handling (Node fetch has no jar): capture `operator_session` Set-Cookie on login, echo `name=value` on gated calls (`operator-cohort.ts:205-213`); `operatorCookieSecure: false` for plain-http loopback.

### `packages/participant/src/index.spec.ts` (NEW, unit)

**Analog:** `packages/web/src/stores/participant.spec.ts` (co-located vitest structure) + the `e2e` `.spec.ts` harness-wrappers (`e2e/headless-cohort.spec.ts`, `e2e/x1-cohort.spec.ts`).

Test the `shouldJoin` predicate directly: a matching advert -> opt-in path taken; a non-matching `cohortId` -> skipped. Use the `describe`/`it`/`expect` + `beforeEach` reset shape from `participant.spec.ts:1-19`. This is the first `.spec.ts` in `packages/participant/` - place it co-located per the naming convention (`*.spec.ts` next to source).

### `packages/web/src/stores/participant.spec.ts` (EXTEND) + `packages/web/src/components/browse/*.spec.ts` (NEW)

**Analog:** `packages/web/src/stores/participant.spec.ts` (whole file, 45 lines)

The `useParticipant.setState({...})` -> call action -> `expect(useParticipant.getState()...)` pattern (`:9-45`) extends to the seated/waiting/closed states off runner events + directory, and to asserting `JOIN_WATCHDOG_MS` is gone. Browse component specs cover the pure `isJoinable`/`statusLabel` functions and the empty-vs-unreachable D-12 states (Wave 0 gap).

## Shared Patterns

### Anonymous public read (`credentials: 'omit'`)
**Source:** `packages/web/src/lib/operator.ts:176-202`
**Apply to:** `DirectoryList`, `ServiceIdentityHeader`, `lib/directory.ts` (if re-homed)
The browse surface is anonymous by design (D-03, Security V4). Every browse fetch uses `credentials: 'omit'` + `AbortSignal.timeout(8000)` + an `if (!res.ok) throw` shape guard. Never send the operator session cookie from the browse surface.

### Poll-with-active-guard
**Source:** `packages/web/src/components/operator/PublicStatus.tsx:21-42`
**Apply to:** `DirectoryList` (~5s), `ServiceIdentityHeader` (~10s)
`useEffect` -> `let active = true` -> `setInterval(load, POLL_MS)` -> `clearInterval` + `active = false` on unmount. The only variation Phase 2 introduces: split the single `.catch` into distinct empty/unreachable states (D-12).

### Primitive-only composition (zero new primitives)
**Source:** `packages/web/src/ui/primitives.tsx` (via `OperatorCohortList.tsx`, `KeyGenPanel.tsx`)
**Apply to:** all five new browse components
UI-SPEC locks ZERO new primitives: compose from `Card`/`Button`/`Badge`/`StatusDot`/`SectionTitle`/`Input`/`Select`/`Field`/`Mono`/`CopyField`. Accent is scarce: only the Open badge + the single Join button per row carry accent (UI-SPEC Color).

### Store as single lifecycle owner
**Source:** `packages/web/src/stores/participant.ts:407-526`
**Apply to:** `BrowseView`, `JoinIdentityStep`
All join/leave/seated lifecycle stays in the Zustand store; browse components drive `join(baseUrl, cohortId)` / `leave()` and read `status`/`result`. No duplicated lifecycle logic in components (RESEARCH Pitfall 4).

### Clean framing (no booth/attendee)
**Source:** CONVENTIONS + UI-SPEC Copywriting Contract
**Apply to:** every new/edited string and comment
New Phase 2 code uses operator/service/aggregator/participant framing only. When editing `participant.ts` / `index.ts`, scrub the incidental "booth"/"attendee" wording in touched comments (`participant.ts:233-238,290,507`) - full systematic sweep is Phase 6, but do not add new instances.

## No Analog Found

None. Every file has a strong in-repo analog; this phase adds no capability that lacks a precedent (no new backend, no new package, no new protocol surface - verified in RESEARCH Runtime State Inventory).

## Metadata

**Analog search scope:** `packages/web/src/components/{operator,participant}`, `packages/web/src/{lib,stores}`, `packages/participant/src`, `e2e/`, `packages/*/src/*.spec.ts`
**Files scanned:** ~18 read in full (PublicStatus, operator lib, participant index, App, participant store, OperatorCohortList, KeyGenPanel, ParticipantView, operator-cohort e2e, participant store spec) + directory listings
**Pattern extraction date:** 2026-07-14
</content>
</invoke>
