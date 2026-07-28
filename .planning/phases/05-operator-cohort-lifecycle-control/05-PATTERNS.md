# Phase 5: Operator Cohort Lifecycle Control - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 31 (11 new, 20 modified)
**Analogs found:** 29 / 31 (2 have no close analog)

Scope drawn from `05-CONTEXT.md` (D-01..D-22 + planning notes 1-9) and `05-RESEARCH.md`
(Recommended Project Structure, Patterns 1-10, Pitfalls 1-10).

Every analog below was read this session. Line numbers are against the working tree at the
time of mapping. Authoring rule honored: no em-dash anywhere; arrows are ASCII `->`.

---

## File Classification

### New files

| New file | Role | Data flow | Closest analog | Match quality |
|----------|------|-----------|----------------|---------------|
| `packages/service/src/cohort-intent.ts` | service (per-service registry) | event-driven / in-memory fold | `packages/service/src/anchor-state.ts` | exact (closure-scoped bounded Map factory) |
| `packages/service/src/runtime-settings.ts` | config holder | request-response (read per request) | `packages/service/src/demo-server.ts` env-resolution block + `anchor-state.ts` factory shape | role-match |
| `packages/service/src/advert-republish.ts` | utility (transport repair) | event-driven, fire-and-forget | `packages/service/src/operator-cohorts.ts` `settleCompletion` (:325-342) | role-match |
| `packages/service/src/test-peers.ts` | service (spawner + teardown) | event-driven, abortable | `packages/service/src/funding-watch.ts` (abortable unref'd loop + `stop()` handle) | role-match |
| `packages/shared/src/tos.ts` | model (canonical record) | transform (hash + sign) | `packages/web/src/lib/sidecar.ts` `Sidecar` + `buildSidecar` (:10-54) | role-match |
| `packages/web/src/lib/esplora.ts` | client (probe + guard) | request-response | `packages/web/src/lib/tx-client.ts` (whole file) | exact |
| `packages/web/src/lib/psbt.ts` | utility (pure predicate) | transform | `packages/web/src/stores/participant.ts` `terminalReason` (:894-937, exported pure fn) | role-match |
| `packages/web/src/components/operator/ServiceControls.tsx` | component | request-response + confirm ceremony | `packages/web/src/components/operator/HealthStrip.tsx` + the inline confirm in `OperatorCohortList.tsx` (:146-187) | role-match |
| `packages/web/src/components/operator/SettingsView.tsx` | component (form) | CRUD (read + save-as-a-set) | `packages/web/src/components/operator/CreateCohortForm.tsx` | exact |
| `packages/web/src/components/operator/DraftEditForm.tsx` | component (form) | CRUD (update) | `packages/web/src/components/operator/CreateCohortForm.tsx` | exact |
| `packages/web/src/components/operator/LifecycleActions.tsx` | component (actions) | request-response | `OperatorCohortList.tsx` row-actions + confirm block (:146-187) | exact |

### Modified files

| Modified file | Role | Data flow | Pattern source (in-file or sibling) | Match quality |
|---------------|------|-----------|-------------------------------------|---------------|
| `packages/service/src/operator-cohorts.ts` | service | CRUD + event-driven | itself (`settleCompletion`, `rememberTerminal`, `validateDraft`, `directory`) | exact (extend in place) |
| `packages/service/src/monitor.ts` | service (projection) | event-driven fold | itself (`noteFunding` :1111-1134, `rememberEnded`, `summary` :1159-1210) | exact |
| `packages/service/src/index.ts` | composition root | event-driven wiring | itself (closure-scoped `seatedRosterKeys` / `genesisStaging`; `stopController.signal` at :608) | exact |
| `packages/service/src/hono-adapter.ts` | route adapter | request-response | itself, gated block :355-500 | exact |
| `packages/service/src/demo-server.ts` | entry point | config | itself, `numericKnob` :274-289 and the env block :302-475 | exact |
| `packages/service/src/anchor-state.ts` | service | event-driven fold | itself (funding-watch retirement on cancel) | exact |
| `packages/service/src/broadcast.ts` / `tx.ts` | service | streaming / chain I/O | itself (kill-switch mode selection at the `signing-complete` handoff) | role-match |
| `packages/shared/src/phases.ts` | model (constants) | n/a | itself (`OPEN_PHASES` / `IN_FLIGHT_PHASES` doc-comment idiom) | exact |
| `packages/shared/src/index.ts` | model + builders | transform | itself, `buildSingletonRegistrationTx` :650-699 | exact |
| `packages/web/src/lib/operator.ts` | client | request-response | itself (`FetchResult` discipline, `advertise`, `discardDraft`) | exact |
| `packages/web/src/lib/tx-client.ts` | client | request-response | itself (`fetchUtxos` / `broadcastTx` / `TxProxyError`) | exact |
| `packages/web/src/lib/operator-rows.ts` | utility (mapper) | transform | itself (`chipForCohort` :59-65, `groupForChip` :77) | exact |
| `packages/web/src/stores/operator.ts` | store | request-response state machine | itself (`discard` / `exportCohort` action idiom :374-399) | exact |
| `packages/web/src/stores/participant.ts` | store | request-response state machine | itself (`terminalReason`, the single `register()` gate at :1885-1897) | exact |
| `packages/web/src/ui/primitives.tsx` | UI primitives | n/a | itself (`Input`, `Select`, `Button`, `Field`) | exact |
| `packages/web/src/components/operator/CohortDetail.tsx` | component | request-response | itself (:343-350 action + `actionError` render) | exact |
| `packages/web/src/components/operator/OperatorCohortList.tsx` | component | request-response | itself (:146-187) | exact |
| `packages/service/src/operator-cohorts.spec.ts` | test | n/a | itself (`operatorCohortApp` harness :24-60) | exact |
| `packages/service/tests/monitor.spec.ts` | test | n/a | itself (key-set pin :634) | exact |
| `e2e/operator-cohort.ts` | test harness | request-response | itself (cookie-echo harness, header doc block) | exact |

---

## Pattern Assignments

### `packages/service/src/cohort-intent.ts` (NEW; service registry, in-memory fold)

**Analog:** `packages/service/src/anchor-state.ts`

This is the phase's tracer (RESEARCH Pattern 1). The analog is the closest structural match in
the repo: a per-service closure factory holding a bounded Map, exposing a tiny read surface, with
a module docstring that states why it exists.

**Module docstring + factory-scoping pattern** (`anchor-state.ts:1-27, 92-95`):

```typescript
/**
 * ... Three properties are load-bearing:
 * - It is a per-service closure factory (never a module singleton), mirroring
 *   `createOperatorCohorts`'s closure-scoped Maps (operator-cohorts.ts:270-287), so two
 *   services in one process (tests) never share anchor state.
 * - The retained Map is bounded at {@link MAX_TERMINAL} with oldest-first
 *   (insertion-order) eviction, reusing the `rememberTerminal` idiom ...
 */
export function createAnchorState(broadcaster?: BeaconBroadcaster, network?: NetworkConfig): AnchorState {
  const enabled = Boolean(broadcaster);
  const entries = new Map<string, AnchorEntry>();
```

**Bounded oldest-first eviction, copy verbatim** (`anchor-state.ts:97-109`):

```typescript
function remember(cohortId: string, entry: AnchorEntry): void {
  // Re-set moves the key to the end of the insertion order ...
  entries.delete(cohortId);
  entries.set(cohortId, entry);
  while (entries.size > MAX_TERMINAL) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    entries.delete(oldest);
  }
}
```

`MAX_TERMINAL = 24` is the repo-wide bound (`anchor-state.ts:69`, `operator-cohorts.ts:277`).
Use the same constant name and value.

**Interface shape** to author (RESEARCH Pattern 1): `declare(cohortId, intent)` / `read(cohortId)`
/ `clear(cohortId)` with `CohortIntent = 'canceled' | 'window-expired'`.

---

### `packages/service/src/operator-cohorts.ts` (MODIFIED; service, CRUD + event-driven)

**Analog:** itself. Every Phase 5 addition (cancel, draft edit, pause gate, canceled fate, paused
bit) has an in-file precedent. Do not invent a new module for these.

**Fate branch goes here** - existing fate-blind reject branch (`:325-342`):

```typescript
function settleCompletion(cohortId: string, completion: Promise<unknown>): void {
  void completion
    .then(
      () => { advertised.delete(cohortId); },
      (err) => {
        const config = advertised.get(cohortId);
        advertised.delete(cohortId);
        if (config) {
          rememberTerminal(cohortId, config, reasonString(err));
        }
      },
    )
    .catch(() => { /* defensive: settlement is total ... */ });
}
```

Extend `rememberTerminal` with a fate argument (`'expired' | 'canceled'`) and read the intent
registry in the reject branch. RESEARCH Pitfall 2 lists the mirrored sites that must change in
the SAME change: this function, `listCohorts`'s `expiredDtos` map (`:502-512`), the
`OperatorCohortDTO.state` union (`:133`), `packages/web/src/lib/operator.ts:84`, and
`packages/web/src/lib/operator-rows.ts` (`ChipKey` :33, `chipForCohort` :59-65, `groupForChip` :77).

**Validation pattern for draft edit** (reuse `validateDraft` verbatim, `:243-264`):

```typescript
function validateDraft(input: DraftInput, autoFallbackOnStall: boolean): {...} {
  const { beaconType, size, threshold } = input;
  if (typeof beaconType !== 'string' || !KNOWN_BEACON_TYPES.has(beaconType)) {
    throw new Error(`operator: unknown beacon type "${String(beaconType)}" ...`);
  }
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(SIZE_ERROR);
  }
  const k = threshold ?? size;
  if (!Number.isInteger(k) || k < 1 || k > size) {
    throw new Error(THRESHOLD_ERROR);
  }
  ...
}
```

Key discipline the doc-comment states and the edit path must keep: guard BEFORE
`buildCohortConfig` "so a raw library throw can never be the 400 body". Exact UI-SPEC copy lives
in module constants (`SIZE_ERROR` :81, `THRESHOLD_ERROR` :88, `FALLBACK_OFF_ERROR` :95) and is
mirrored byte-identically in `CreateCohortForm.tsx:8-10`.

**Pause gate, exactly two call sites** (`advertiseDraft` :426, `readvertiseExpired` :463). The
module docstring (:9-14) is the standing proof that these are the ONLY `runner.advertiseCohort`
callers; extend that docstring rather than adding a gate elsewhere.

**Paused bit** rides `ServiceStatusDTO` (`:166-170`) and its single construction site (`:518-525`).
Its derivation discipline is stated in place: reuse ONE derivation so the public claim and the
gate cannot drift.

---

### `packages/service/src/monitor.ts` (MODIFIED; service projection, event-driven fold)

**Analog:** itself, the `noteFunding` push seam.

**Push-seam pattern for a fact the runner does not emit** (`:1111-1134`), which `noteCanceled`
must mirror exactly (RESEARCH Pitfall 1: `stopCohort` emits nothing):

```typescript
noteFunding(cohortId: string, view: FundingView): void {
  // Store the latest funding view for the gated detail read + the `needs-funding` summary chip.
  // A no-op off the broadcasting path ...
  if (serviceMode !== 'live') {
    return;
  }
  const previous = fundingViews.get(cohortId);
  if (previous?.state === 'funded' && view.state !== 'funded') {
    return;
  }
  rememberFunding(cohortId, view);
}
```

**Ended-fate capture at event time** (`:931`), the site the `canceled` chip joins:

```typescript
rememberEnded(cohortId, { chip: 'failed', seatsJoined, capacity, reason: reason || 'cohort failed' });
```

**Ended rows projection** (`:1193-1208`) shows the live-wins-over-ended defensive skip; a
canceled record must be projected through this same loop, and `EndedChip` (`:255`) plus
`CohortChip` (`:166`) both widen. Mirrored client type: `packages/web/src/lib/operator.ts:323`.

**Activity ring append** (`:647-657`) is the pattern for operator-action log entries
(cancel, finalize, pause, kill switch, dismissal, test peers):

```typescript
entry.activity.push({ id: entry.activitySeq, t: Date.now(), level, text });
entry.activitySeq += 1;
while (entry.activity.length > ACTIVITY_RING_SIZE) {
  entry.activity.shift();
}
```

**Health projection to extend with paused / broadcastDisabled bits** (`:1095-1102`). Note the
in-file constraint the kill switch must respect (RESEARCH Pattern 6): `serviceMode` is fixed at
construction and must not be re-derived.

---

### `packages/service/src/hono-adapter.ts` (MODIFIED; route adapter, request-response)

**Analog:** itself, the gated operator block (`:355-500`).

**Gate ordering comment + mounts** (`:347-366`) - every new mutating route mounts after these:

```typescript
if (operatorAuth) {
  app.use('/v1/operator/*', requireSameOrigin());
  app.post('/v1/operator/login', bodyLimit({ maxSize: 4 * 1024, ... }), loginHandler(operatorAuth));
  app.use('/v1/operator/*', requireOperator(operatorAuth.sessions));
```

**Mutating action route shape** (copy for cancel / finalize / pause / dismiss / test-peers,
`:426-438`):

```typescript
app.post('/v1/operator/cohorts/:id/advertise', (c) => {
  const dto = operatorCohorts.advertiseDraft(c.req.param('id'));
  return dto ? c.json(dto) : c.json({ error: 'unknown draft' }, 404);
});
```

**Body-bounded JSON route with a user-facing 400** (copy for `PATCH` draft edit and
`PUT /v1/operator/settings`, `:374-397`):

```typescript
app.post(
  '/v1/operator/cohorts',
  bodyLimit({ maxSize: 4 * 1024, onError: (c) => c.json({ error: 'request too large' }, 413) }),
  async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch {
      return c.json({ error: 'expected a JSON body { beaconType, size, threshold }' }, 400);
    }
    try {
      const dto = operatorCohorts.createDraft(body as DraftInput);
      return c.json(dto, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  },
);
```

**Cheap id-shape guard before any lookup** (copy for every new `:id` route, `:340-343` and
`:446-450`):

```typescript
const id = c.req.param('id');
if (!/^[0-9a-zA-Z-]{1,64}$/.test(id)) {
  return c.json({ error: 'invalid cohort id' }, 400);
}
```

**Public read with a fail-open non-oracle default** (copy for the new public `GET /v1/cohort-fate/:id`,
`:339-345`): the anchor/funding reads answer a neutral shape rather than 404 or 500.

**`/v1/config` per-request read** for the runtime SERVICE_NAME edit (`:253`) - currently a
closure-captured boot constant; RESEARCH Pattern 5 requires it become a holder read while keeping
the additive-only shape:

```typescript
app.get('/v1/config', (c) => c.json(serviceName ? { ...networkDto, serviceName } : networkDto));
```

`triggerFallback` route must map an `AggregationServiceError` to 409, never 500 (Pitfall 4);
`validateDraft`'s "pre-guard so a raw library throw is never the body" is the precedent.

---

### `packages/service/src/runtime-settings.ts` (NEW; config holder, request-response)

**Analogs:** `packages/service/src/demo-server.ts` env-resolution block (seeding) +
`anchor-state.ts` factory shape (holder).

**Env-seed idiom, including the mandated NaN guard** (`demo-server.ts:274-289`, the WR-04 lesson;
RESEARCH Runtime State Inventory requires every new numeric seed to ride it):

```typescript
function numericKnob(
  name: string,
  raw: string | number | undefined,
  fallback: number | undefined,
  warn: (msg: string) => void,
  minimum = 1,
): number | undefined {
  if (raw === undefined || raw === '') { return fallback; }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < minimum) {
    warn(`ignoring malformed ${name}="${String(raw)}"; using ${fallback ?? 'the built-in default'}`);
    return fallback;
  }
  return n;
}
```

**Optional-string seed idiom** (`demo-server.ts:435`), the shape `serviceName` and `termsText` follow
(empty collapses to `undefined` so the DTO stays additive):

```typescript
const serviceName = (opts.serviceName ?? process.env.SERVICE_NAME)?.trim() || undefined;
```

**Boolean opt-in idiom** (`demo-server.ts:342, 347, 377`): `process.env.LIVE === '1'`,
`process.env.BROADCAST === '1'`, `process.env.AUTO_FALLBACK !== '0'`.

Author `SettingField<T> { value; envDefault; changed }` per RESEARCH Pattern 5. Save-as-a-set:
validate all fields, apply none on any failure (mirrors `validateDraft`'s guard-clause-first
posture).

---

### `packages/service/src/advert-republish.ts` (NEW; utility, event-driven fire-and-forget)

**Analog:** the fire-and-forget side-effect posture in `operator-cohorts.ts:325-342` and the
`index.ts` listener convention (a failure here must never disturb the protocol).

**Swallow-and-log pattern** (`operator-cohorts.ts:339-341`):

```typescript
.catch(() => {
  /* defensive: settlement is total, but never let a stray rejection escape. */
});
```

**Selection input:** the newest entry of the `advertised` Map (insertion-ordered) whose phase is in
`OPEN_PHASES` - the same phase-set import already used at `operator-cohorts.ts:65-71`. Message
construction uses `createCohortAdvertMessage` + `transport.publishRepeating(message, did, 0)`
(RESEARCH Pattern 3); do not hand-roll the message body or the envelope signature.

---

### `packages/service/src/test-peers.ts` (NEW; service spawner, event-driven abortable)

**Analog:** `packages/service/src/funding-watch.ts` for the lifecycle/teardown handle; the e2e
harnesses for the spawn itself.

**Stop-handle + abortable, unref'd loop** (`funding-watch.ts:187-196` and the `delay` helper
:200-224):

```typescript
/** Handle for a running funding watch. */
export interface FundingWatchHandle {
  /**
   * Stop polling (idempotent). Safe to call after the loop has already retired itself ...
   */
  stop(): void;
}
```

```typescript
const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
if (typeof (timer as { unref?: () => void }).unref === 'function') {
  (timer as { unref: () => void }).unref();
}
signal?.addEventListener('abort', onAbort, { once: true });
```

**Spawn shape** (`e2e/operator-cohort.ts:1-4`): `createParticipant` from
`@btcr2-aggregation/participant`, identity via `createIdentity` from
`@btcr2-aggregation/shared`. Thread the existing `stopController.signal` from `index.ts:608` so
`service.stop()` tears peers down on the established path (RESEARCH Pattern 10).

**Badging** is a per-`createService` Set of test-peer DIDs, mirroring `seatedRosterKeys` /
`genesisStaging` closure scoping in `index.ts` (documented at `operator-cohorts.ts:54-56`).

---

### `packages/shared/src/tos.ts` (NEW; model, transform)

**Analog:** `packages/web/src/lib/sidecar.ts` (context-tagged canonical record + builder).

**Record shape + context constant** (`sidecar.ts:10-26, 36-54`):

```typescript
export interface Sidecar {
  '@context': string;
  genesisDocument?: object;
  updates?: object[];
  ...
}
const SIDECAR_CONTEXT = 'https://btcr2.dev/context/v1';

export function buildSidecar(input: {...}): Sidecar {
  const sidecar: Sidecar = { '@context': SIDECAR_CONTEXT, updates: [input.update] };
  ...
  return sidecar;
}
```

Reuse this context constant for `TermsAcceptance` (RESEARCH Pattern 9) and hash with the same
canonicalization `updateHashBytes` uses. Storage/read analog is
`packages/service/src/store.ts`: `ArtifactStore.put(kind, hashHex, value)` (:59-63), the typed
put helpers (:187-210), and the public `mountArtifactRoutes` read (:270-292).

**Constant-block doc style for a frozen contract** is `packages/shared/src/phases.ts:1-26` (states
who consumes it and what drifted before). Freeze the acceptance field set in a spec test the way
the public DTOs are pinned.

---

### `packages/shared/src/index.ts` (MODIFIED; PSBT split, transform)

**Analog:** itself, `buildSingletonRegistrationTx` (`:650-699`). RESEARCH Pattern 8 splits this
into `buildRegistrationTemplate` (everything up to `sign`) + the existing composed signer.

**The guards to carry verbatim into the template builder** (`:659-679`):

```typescript
const network = opts.network ?? resolveNetwork(NETWORK);
const fee = opts.fee ?? REGISTRATION_FEE_SATS;
if (fee <= 0n) { throw new Error(`fee must be positive, got ${fee} sats (a zero-fee tx never relays)`); }
if (fee > MAX_REGISTRATION_FEE_SATS) { throw new Error(`fee ${fee} sats exceeds the ...`); }
const value = BigInt(opts.utxo.value);
if (value < fee + P2TR_DUST_SATS) { throw new Error(`funding UTXO (${value} sats) is too small; ...`); }
if (opts.updateHash.length !== 32) { throw new Error(`updateHash must be 32 bytes, got ...`); }
```

**The tx body, unchanged, becomes the template** (`:680-694`):

```typescript
const internalKey = opts.keys.publicKey.compressed.slice(1, 33);
const pay = p2tr(internalKey, undefined, network.scureNetwork);
const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
tx.addInput({ txid: opts.utxo.txid, index: opts.utxo.vout,
  witnessUtxo: { amount: value, script: pay.script }, tapInternalKey: pay.tapInternalKey });
// Change FIRST, OP_RETURN LAST (the indexer reads the final vout).
tx.addOutput({ script: pay.script, amount: change });
tx.addOutput({ script: Script.encode(['RETURN', opts.updateHash]), amount: 0n });
```

Existing constants stay the source of truth: `REGISTRATION_FEE_SATS` (:621), `P2TR_DUST_SATS`
(:623), `MAX_REGISTRATION_FEE_SATS` (:632). The output-ordering comment on :692 is load-bearing;
keep it on the template builder.

---

### `packages/shared/src/phases.ts` (MODIFIED; add `FINALIZABLE_PHASES`)

**Analog:** itself. Copy the existing declaration + doc-comment style (`:36-40, 59-67`):

```typescript
export const OPEN_PHASES: ReadonlySet<string> = new Set<string>([
  'Advertised',
  'CohortSet',
  'CollectingUpdates',
]);
```

The module docstring (:1-26) is the model for the new set's comment: name every consumer and
state the drift hazard. RESEARCH Pattern 2 warns explicitly against reusing `IN_FLIGHT_PHASES`
for the Finalize-now predicate (it is wider than the library's signing set); mirror the library's
three signing phases only.

---

### `packages/web/src/lib/tx-client.ts` (MODIFIED) and `packages/web/src/lib/esplora.ts` (NEW)

**Analog:** `tx-client.ts` itself (74 lines, whole file read).

**Error type + detail extraction to reuse** (`:18-36`):

```typescript
/** Thrown on a proxy error; `status` is the HTTP status (0 = unreachable). */
export class TxProxyError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'TxProxyError'; }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? `HTTP ${res.status}`;
  } catch { return `HTTP ${res.status}`; }
}
```

**Fetch shape to parameterize, not duplicate** (`:39-51`):

```typescript
export async function fetchUtxos(baseUrl: string, address: string): Promise<Utxo[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/tx/utxos/${encodeURIComponent(address)}`;
  let res: Response;
  try { res = await fetch(url, { headers: { accept: 'application/json' } }); }
  catch (err) { throw new TxProxyError(err instanceof Error ? err.message : String(err), 0); }
  if (!res.ok) { throw new TxProxyError(await errorDetail(res), res.status); }
  return (await res.json()) as Utxo[];
}
```

Note `status: 0` already encodes "unreachable/thrown fetch", which is the CORS-classification
hook RESEARCH Pattern 7 needs. The broadcast path's `{ txid }` JSON vs esplora's bare-text txid
asymmetry (`:69-73` vs RESEARCH) is the one real difference to handle.

`esplora.ts` (probe + genesis-hash network guard) is the same file's `fetch` + `TxProxyError`
shape against `GET {base}/block-height/0`. Genesis hashes belong in
`packages/shared/src/networks.ts`, the declared single source of truth for chain parameters.

---

### `packages/web/src/lib/psbt.ts` (NEW; pure predicate, transform)

**Analog:** `packages/web/src/stores/participant.ts` `terminalReason` (`:894-937`), the repo's
exemplar of an exported pure classifier with a discriminated result and a doc-comment that
justifies each branch:

```typescript
export function terminalReason(input: {
  error: string | null;
  steps: Record<StepKey, StepStatus>;
  validationRequested: boolean;
}): string {
  const raw = (input.error ?? '').trim();
  ...
}
```

Its header comment states the design rule the PSBT validator should also follow: "Exported as a
pure function so CohortPage renders it and the ... predicate is unit-testable." Return a
discriminated union (RESEARCH's `PsbtVerdict`) rather than throwing, and order the checks parse
-> template match -> signature presence -> finalize (Pitfall 9: compare `tx.unsignedTx`, never
raw hex).

---

### `packages/web/src/lib/operator.ts` (MODIFIED; client, request-response)

**Analog:** itself. Every new gated action gets a typed client here.

**Discriminated result vocabulary, mandatory for new actions** (`:156-159`):

```typescript
export type FetchResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'unauthorized' }
  | { kind: 'unreachable' };
```

**Mutating-action client to copy** (`discardDraft` :464-479):

```typescript
export async function discardDraft(baseUrl: string, id: string): Promise<FetchResult<true>> {
  let res: Response;
  try {
    res = await fetch(endpoint(baseUrl, `/v1/operator/cohorts/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { return { kind: 'unreachable' }; }
  if (res.status === 401) { return { kind: 'unauthorized' }; }
  return res.ok ? { kind: 'ok', value: true } : { kind: 'unreachable' };
}
```

The WR-06 doc-comments on `downloadExport` / `discardDraft` state the rule plainly: an action
that returns a bare boolean the caller discards is a silent no-op. New actions (cancel, finalize,
pause, settings save, dismiss, test-peers, kill switch) all return `FetchResult`.

**Server-message-preserving result for validated bodies** (`createDraft` :120-148) is the shape
for `PATCH` draft edit and settings save:

```typescript
export type CreateDraftResult = { ok: true; dto: OperatorCohortDTO } | { ok: false; error: string };
```

**Public vs gated credential discipline** (`:524-534` vs `:396-413`): public reads use
`credentials: 'omit'`, gated reads use `'same-origin'`. The paused bit rides `ServiceStatus`
(:101-105), which is one of the six pin sites listed in RESEARCH Pitfall 6.

---

### `packages/web/src/stores/operator.ts` (MODIFIED; store, request-response state machine)

**Analog:** itself. New actions follow the `discard` / `exportCohort` idiom exactly (`:374-399`):

```typescript
async discard(baseUrl, id) {
  set({ actionError: undefined });
  const result = await apiDiscardDraft(baseUrl, id);
  if (result.kind === 'unauthorized') {
    // Session expiry takes the same honest re-login path as every gated read (D-16).
    get().expireSession();
    return;
  }
  if (result.kind === 'unreachable') {
    set({ actionError: DISCARD_FAILED });
    return;
  }
  await get().refreshCohorts(baseUrl);
}
```

**One shared expiry path** (`expireSession` :260-275) - never branch a 401 two ways.

**Transient success copy with a guarded clear** (`advertise` :322-350):

```typescript
setTimeout(() => {
  if (get().advertiseMessage === ADVERTISED_OK) {
    set({ advertiseMessage: undefined });
  }
}, 4000);
```

**Exact-copy constants live at module top** (`:41-64`), em-dash-free, marked "UI-SPEC verbatim".
New ceremony/disabled-reason strings from 05-UI-SPEC go here the same way.

**Never default a mode client-side** (`:296-301`): the served `monitoring.health` sets `health`,
undefined renders "Checking mode". The paused / broadcast-disabled bits must follow this rule.

---

### `packages/web/src/stores/participant.ts` (MODIFIED; canceled narration, ToS, override, PSBT)

**Analog:** itself.

**Add the `canceled` input to `terminalReason` and check it FIRST** (`:894-937`; Pitfall 5). The
current first branch is exactly the one that misfires:

```typescript
if (
  /stalled|collectingupdates|collecting updates|waiting for all members/.test(e) ||
  (submittedButUnsigned && !input.validationRequested && unexplained)
) {
  return 'This service stalled while collecting updates.';
}
```

Do not add a `/cancel/` regex; add a boolean field, per the D-45 lesson the doc-comment records.

**Single-gate discipline for the esplora override** (Pitfall 8): the ADR 0010 real-funds gate at
`:1885-1897` sits at the top of `register()`. Thread the endpoint as a parameter into the one
existing `register()` and the one broadcast call site; never fork a second flow.

---

### Operator components: `ServiceControls.tsx`, `SettingsView.tsx`, `DraftEditForm.tsx`, `LifecycleActions.tsx` (NEW)

**Form analog:** `packages/web/src/components/operator/CreateCohortForm.tsx` (whole file).

```typescript
import { Badge, Button, Card, Field, Input, Select, SectionTitle } from '../../ui/primitives';
/** Exact UI-SPEC validation string; the server returns the same copy on its 400. */
const SIZE_ERROR = 'Cohort size must be at least 1 signer.';

export function CreateCohortForm({ baseUrl }: { baseUrl: string }) {
  const createStatus = useOperator((s) => s.createStatus);
  const formError = useOperator((s) => s.formError);
  const submitDraft = useOperator((s) => s.submitDraft);
  const [sizeText, setSizeText] = useState('2');
  const [clientError, setClientError] = useState<string | undefined>(undefined);
  ...
  // Show the client validation message if present, else the server's 400 message.
  const shownError = clientError ?? formError;
```

Load-bearing conventions from this file: per-field selector subscriptions (never the whole
store), client validation mirroring the server copy byte-identically, the read-only network Badge
(never an editable control), the `Field` + help-caption structure (`:94-98`), the error banner
class string (`:115`), and the busy label (`Creating…`).

**Confirm-ceremony analog:** the inline confirm in `OperatorCohortList.tsx` (`:146-187`) - the
laddered D-03 ceremonies extend this, they do not replace it:

```typescript
{isDraft && !confirming ? (
  <div className="flex flex-wrap gap-2">
    <Button variant="primary" disabled={isAdvertising} onClick={() => void advertise(baseUrl, id)}>
      {isAdvertising ? 'Advertising…' : 'Advertise cohort'}
    </Button>
    <Button variant="danger" onClick={() => setConfirming(true)}>Discard draft</Button>
  </div>
) : null}
...
{confirming ? (
  <div className="space-y-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
    <p>Discard this draft? It hasn&rsquo;t been advertised, so nothing has been published to the directory yet.</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="danger" onClick={() => void discard(baseUrl, id)}>Discard draft</Button>
      <Button variant="ghost" onClick={() => setConfirming(false)}>Keep draft</Button>
    </div>
  </div>
) : null}
```

Both buttons are action verbs; the danger tone is a border + tint + text color, never color alone.
The type-to-confirm top rung (funded live cancel) has NO analog: build it on `Input` + this block.

**Service-level chip strip analog for `ServiceControls`:** `HealthStrip.tsx` (whole file), where
the paused / broadcast-off chips sit:

```typescript
<Card className="flex flex-wrap items-center gap-2 px-4 py-2">
  <Badge tone="neutral">{mode ? MODE_LABEL[mode] : 'Checking mode'}</Badge>
  {serviceName ? <span className="text-sm text-ink">{serviceName}</span> : null}
  ...
```

Its docstring states two rules Phase 5 inherits: operator-supplied text renders as plain
auto-escaped React text content (never markup or a URL), and the strip is `flex-wrap gap-2` so new
chips wrap instead of pushing content off-screen.

**Action-error render analog:** `CohortDetail.tsx:343-350`:

```typescript
<Button variant="ghost" onClick={() => void exportCohort(baseUrl, cohortId)}>...</Button>
{actionError ? (<p ...>{actionError}</p>) : null}
```

---

### `packages/web/src/ui/primitives.tsx` (MODIFIED; add `TextArea`, `ConfirmPanel`)

**Analog:** `Input` (`:105-139`) and `Select` (`:142-175`) in the same file.

```typescript
export function Input({ value, onChange, type = 'text', placeholder, id, name, autoComplete,
  disabled = false, className = '' }: {...}) {
  return (
    <input id={id} name={name} type={type} value={value} placeholder={placeholder}
      autoComplete={autoComplete} disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-faint transition focus:border-edge-strong focus:outline-none focus:ring-2 focus:ring-edge-strong disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    />
  );
}
```

`TextArea` (terms text) copies this class string verbatim plus a rows prop. `ConfirmPanel`
promotes the `OperatorCohortList` confirm block, exactly as `Expander` was promoted from
`CompletionSummary.tsx` (see the `Expander` docstring `:29-35` for the promotion precedent and
how to document it). Tone tokens: `TONE_CLASS` (:55-61), `DOT_CLASS` (:203-209), `Button`
variants `primary | ghost | danger` (:92-96).

---

### Tests

**Service unit-spec analog:** `packages/service/src/operator-cohorts.spec.ts:24-60` - the
in-memory operator-enabled app harness (real runner, no port, no chain) that every new gated route
spec should reuse:

```typescript
function operatorCohortApp(autoFallbackOnStall = true) {
  const identity = createIdentity(resolveNetwork(ACTIVE_NETWORK));
  const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
  transport.registerActor(identity.did, identity.keys);
  const runner = new AggregationServiceRunner({ transport, did: identity.did, keys: identity.keys,
    onProvideTxData: async () => { throw new Error('signing not exercised in this spec'); } });
  transport.start();
  ...
  const operatorCohorts = createOperatorCohorts({ activeNetwork: ACTIVE_NETWORK, runner, autoFallbackOnStall });
  const app = createHonoApp(transport, { operatorAuth, operatorCohorts, networkName: ACTIVE_NETWORK });
  return { app, runner };
}
```

The harness comment notes `runner.stop()` must be called in every test to clear the advert
republish timer, which matters doubly for cancel tests.

**New-tests location rule (project-wide):** new spec files go in `packages/*/tests/`, NOT
co-located with source. Existing co-located specs stay where they are; extend them in place only
when the change is to an already-covered surface (for example the `ServiceStatusDTO` pins).

**DTO pin sites** (RESEARCH Pitfall 6, all six must migrate in one change):
`packages/service/tests/monitor.spec.ts:634` (key-set), `packages/service/src/operator-cohorts.spec.ts:568`
(full equality), `packages/service/src/operator-cohorts.ts:166-170, 524`,
`packages/service/src/hono-adapter.ts:267`, `packages/web/src/lib/operator.ts:100-108`,
`e2e/operator-cohort.ts:81-86`.

**E2E analog:** `e2e/operator-cohort.ts`. Its header block (`:6-46`) is the model for documenting a
lifecycle harness, including the cookie-echo note (Node's fetch has no cookie jar; capture
`operator_session` on login and echo it as the `cookie` header) and `operatorCookieSecure: false`
for plain-http loopback. Local interface declarations mirror the wire DTOs (`:57-110`).
RESEARCH Pitfall 3 requires the cancel e2e to cover the TWO-cohort case with a freshly constructed
participant; a single-cohort test will pass while the defect is live.

---

## Shared Patterns

### Gated mutating routes (ADR 0015)
**Source:** `packages/service/src/hono-adapter.ts:347-366`
**Apply to:** every new lifecycle, settings, dismissal, test-peer, and kill-switch route.
Registration order is load-bearing: `requireSameOrigin` -> public login -> `requireOperator` ->
gated routes. Public reads (directory, status, anchor, funding, the new fate read) mount BEFORE
the `if (operatorAuth)` block.

### Discriminated client results + one expiry path
**Source:** `packages/web/src/lib/operator.ts:156-159, 464-479`; `packages/web/src/stores/operator.ts:260-275, 374-399`
**Apply to:** every new browser action. A 401 always routes through `expireSession()`; anything
else non-ok sets `actionError` with exact UI-SPEC copy. Never return a discarded boolean.

### Per-service closure state, never a module singleton
**Source:** `packages/service/src/operator-cohorts.ts:54-56` (the rule), `anchor-state.ts:92-95` (the shape)
**Apply to:** the intent registry, the settings holder, the test-peer DID set, the kill-switch
engage timestamp.

### Bounded in-memory retention (cap 24, oldest-first)
**Source:** `packages/service/src/anchor-state.ts:97-109`, `operator-cohorts.ts:304-314`, `monitor.ts:647-657`
**Apply to:** intent tags, canceled ended records, dismissal (operates on these bounded stores,
never on protocol state).

### Fire-and-forget side effects never disturb the protocol
**Source:** `packages/service/src/operator-cohorts.ts:339-341`
**Apply to:** advert re-publish, funding-watch retirement on cancel, test-peer teardown,
activity-log writes.

### Guard before the library call; a raw library throw is never an HTTP body
**Source:** `packages/service/src/operator-cohorts.ts:243-264` + its doc-comment (:236-241)
**Apply to:** draft edit, settings save, `triggerFallback` (409 with UI-SPEC copy, not 500),
cancel (404 on unknown/settled).

### Exact copy strings as named constants, mirrored client and server
**Source:** `operator-cohorts.ts:81, 88, 95` <-> `CreateCohortForm.tsx:8-10`; `stores/operator.ts:41-64`
**Apply to:** every new ceremony, disabled-reason, and validation string from 05-UI-SPEC.
Em-dash-free at the source (MEMORY: em-dashes in authored copy propagate into shipped UI and get
checker-blocked).

### Non-oracle public reads
**Source:** `packages/service/src/anchor-state.ts:41-56, 128-133`; `monitor.ts:1136-1157`
**Apply to:** the new public cohort-fate read and the paused bit: unknown / never-existed /
evicted must be indistinguishable, and no internals (raw errors, member DIDs, amounts) leak.

### Phase sets are one cross-package source of truth
**Source:** `packages/shared/src/phases.ts:1-26`
**Apply to:** `FINALIZABLE_PHASES` and the canceled fate. RESEARCH planning note 3 and the
in-file docstring both record that mirrored copies drifted before and nothing pinned them equal.

### Operator-supplied text renders as plain auto-escaped React text
**Source:** `packages/web/src/components/operator/HealthStrip.tsx:34-38, 79`
**Apply to:** SERVICE_NAME edit and ToS terms text (both are operator-controlled strings shown to
anonymous participants).

---

## No Analog Found

| File / capability | Role | Data flow | Reason |
|---|---|---|---|
| Type-to-confirm ceremony (top rung of D-03, funded live cancel) | component | request-response | No type-to-confirm interaction exists anywhere in the codebase. Build it from `Input` (`primitives.tsx:105-139`) inside the `OperatorCohortList.tsx:172-187` confirm block; take exact copy from 05-UI-SPEC. |
| PSBT export/import round-trip UI (`components/cohort/*` additions for D-21) | component | file-I/O | No file-upload or paste-import surface exists. Nearest partial: the download half only, `packages/web/src/lib/sidecar.ts:59-73` (`downloadJson`) and `lib/operator.ts:428-457` (`downloadExport`, including the deferred `URL.revokeObjectURL` lesson). The upload/paste leg and the ephemeral-session warning are new. |

Two further capabilities have only partial analogs worth flagging to the planner:

- **Settings save-as-a-set** (validate all, apply none on failure): no transactional multi-field
  save exists. Compose it from `validateDraft`'s guard-clause-first style.
- **`PATCH` verb:** the codebase has no PATCH route today (POST/GET/DELETE only,
  `hono-adapter.ts:233-500`). The draft-edit route is the first; mount it with the same
  `bodyLimit` + JSON-parse-guard shape as the create POST.

---

## Metadata

**Analog search scope:** `packages/service/src`, `packages/service/tests`, `packages/shared/src`,
`packages/web/src/{lib,stores,ui,components}`, `e2e/`
**Files scanned:** 70+ enumerated; 18 read in full or in targeted ranges
**Pattern extraction date:** 2026-07-28
