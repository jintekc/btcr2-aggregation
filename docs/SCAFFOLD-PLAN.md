# Scaffold Plan: btcr2-aggregation (Milestone 1, one-shot build spec)

> This document is written to be executed start-to-finish by a fresh Claude Code
> session with no further questions. Read [PROJECT-CONTEXT.md](./PROJECT-CONTEXT.md)
> first for the goal and upstream API.
>
> The code patterns below are transcribed from the library's working reference E2E
> (`packages/aggregation/lib/operations/aggregation/e2e-http-transport.ts` and
> `packages/aggregation/tests/aggregation.spec.ts`). Those files are NOT in the
> published npm package, so they cannot be read from `node_modules` here - they are
> inlined below. The published packages DO ship their `src` and `dist/types`, so
> verify every exact signature against `node_modules/@did-btcr2/*/src` and
> `node_modules/@did-btcr2/*/dist/types` as you build. Where a property is
> uncertain, check the type, do not guess.

## Goal of Milestone 1

A **headless, real-HTTP end-to-end** run: one aggregation **service** on a real
local port and **N participants** over `HttpClientTransport` (real HTTP + SSE),
driving a full CAS cohort to a valid 64-byte aggregated Taproot signature. No UI,
no Bitcoin node, no broadcast (the beacon tx spends a fixture prevout). This is the
foundation every later phase builds on; the library proves the same flow over the
real HTTP transport in its (unpublished) `lib/operations` reference, which M1 ports
to Hono and the workspace layout.

## Decisions (locked 2026-06-29)

1. **Structure** - pnpm workspace monorepo (`packages/{shared,service,participant,web}` + `e2e/`). M1 builds `shared`, `service`, `participant`, `e2e`; `web` is M2.
2. **Service framework** - Hono (+ `@hono/node-server`).
3. **Test runner** - vitest for unit; e2e as a real-service `tsx` script (no mocking).
4. **Dependency source** - published `@did-btcr2/*` from npm (caret ranges).
5. **Network label** - `mutinynet` for DID/config strings (cosmetic in M1; no chain interaction until M3).

## Directory structure

```
btcr2-aggregation/
├── package.json                 # private workspace root
├── pnpm-workspace.yaml          # packages: ["packages/*", "e2e"]
├── tsconfig.base.json           # strict, ES2022, NodeNext, "type":"module"
├── eslint.config.js
├── docs/                        # PROJECT-CONTEXT.md, SCAFFOLD-PLAN.md, adr/
├── packages/
│   ├── shared/                  # @btcr2-aggregation/shared
│   │   └── src/index.ts         # keys/DIDs, network constants, the buildSignedUpdate + buildFixtureTxData helpers
│   ├── service/                 # @btcr2-aggregation/service
│   │   └── src/
│   │       ├── index.ts         # createService(opts) -> { start(port), stop(), runner }
│   │       ├── hono-adapter.ts  # HttpServerTransport <-> Hono (routes + SSE bridge)
│   │       └── tx.ts            # buildFixtureTxData (onProvideTxData impl)
│   └── participant/             # @btcr2-aggregation/participant (isomorphic)
│       └── src/index.ts         # createParticipant(opts) -> runner wired to HttpClientTransport
└── e2e/                         # @btcr2-aggregation/e2e
    ├── headless-cohort.ts       # the tsx harness (pnpm e2e)
    └── headless-cohort.spec.ts  # vitest wrapper asserting the harness result
```

## Dependencies (exact, caret ranges; current published versions 2026-06-29)

**Root** `package.json` (`"private": true`, `"type": "module"`, `engines.node >=22`):
- devDeps: `typescript ^5.9`, `@types/node ^22`, `tsx ^4`, `vitest ^2`, `eslint ^9`, `typescript-eslint ^8`, `rimraf ^6`.
- scripts: `"typecheck": "tsc -b"`, `"test": "vitest run"`, `"e2e": "tsx e2e/headless-cohort.ts"`, `"lint": "eslint ."`, `"build": "pnpm -r build"`.

**packages/shared** `@btcr2-aggregation/shared`:
- `@did-btcr2/method ^0.45.0`, `@did-btcr2/keypair ^0.13.1`, `@did-btcr2/aggregation ^0.3.0`, `@did-btcr2/common ^9.1.0`, `@scure/btc-signer ^1.8.1`, `@noble/hashes ^1.8.0`.

**packages/service** `@btcr2-aggregation/service`:
- `@btcr2-aggregation/shared workspace:*`, `@did-btcr2/aggregation ^0.3.0`, `@did-btcr2/method ^0.45.0`, `@did-btcr2/keypair ^0.13.1`, `@scure/btc-signer ^1.8.1`, `@noble/hashes ^1.8.0`, `hono ^4`, `@hono/node-server ^1`.

**packages/participant** `@btcr2-aggregation/participant` (no Node-only APIs):
- `@btcr2-aggregation/shared workspace:*`, `@did-btcr2/aggregation ^0.3.0`, `@did-btcr2/method ^0.45.0`, `@did-btcr2/keypair ^0.13.1`.

**e2e** `@btcr2-aggregation/e2e` (`"private": true`):
- `@btcr2-aggregation/service workspace:*`, `@btcr2-aggregation/participant workspace:*`, `@btcr2-aggregation/shared workspace:*`.

## Imports and their sources (verify against node_modules types)

| Symbol | Import from |
|---|---|
| `SchnorrKeyPair`, `LocalSigner` | `@did-btcr2/keypair` |
| `DidBtcr2`, `Updater`, `Resolver`, `resolveBtcr2SenderPk` | `@did-btcr2/method` |
| `AggregationServiceRunner`, `HttpServerTransport`, types `SigningTxData` / `CohortConfig` / `HttpRequestLike` / `HttpResponseLike` / `SseStream` | `@did-btcr2/aggregation/service` |
| `AggregationParticipantRunner`, `HttpClientTransport` | `@did-btcr2/aggregation/participant` |
| `musig2`, `p2tr`, `Transaction`, `Script` | `@scure/btc-signer` |
| `bytesToHex` | `@noble/hashes/utils` |

## Reference patterns (inlined; transcribed from the library, verify signatures)

### Keys and DIDs
```ts
// from tests/aggregation.spec.ts:635-640
const keys = SchnorrKeyPair.generate();
const did = DidBtcr2.create(keys.publicKey.compressed, { idType: 'KEY', network: 'mutinynet' });
```
Create one identity for the service and one per participant. `keys.publicKey.compressed`
is the 33-byte compressed key; its x-only coordinate is `compressed.slice(1)` (32 bytes).

### Exact transport shapes (from `@did-btcr2/aggregation/service`)
```ts
// SigningTxData (src/service/service.ts)
interface SigningTxData { tx: Transaction; prevOutScripts: Uint8Array[]; prevOutValues: bigint[]; }

// HttpServerTransport request/response/SSE (src/service/http-server.ts)
interface HttpRequestLike { method: string; url: string; headers: Record<string,string>; body?: string; remoteAddr?: string; } // header names MUST be lowercased
interface HttpResponseLike { status: number; headers: Record<string,string>; body: string; }
interface SseStream { writeEvent(event: string, data: string, id?: string): void; writeComment(c: string): void; close(): void; onClose(cb: () => void): void; }
```

### Service: CohortConfig + runner + fixture tx
`CohortConfig` requires `beaconType`, `minParticipants`, `network`, **and** `recoveryKey`
(64-hex x-only) **and** `recoverySequence` (>=1) - the last two are easy to miss and
will throw if absent (ADR 042 recovery leaf).
```ts
// recoveryKey: a valid x-only 64-hex key. Derive one to avoid invalid-point issues:
const recoveryKey = bytesToHex(SchnorrKeyPair.generate().publicKey.compressed.slice(1)); // 64 hex chars
const config: CohortConfig = { beaconType: 'CASBeacon', minParticipants: 2, network: 'mutinynet', recoveryKey, recoverySequence: 144 };

// onProvideTxData fixture (from tests/aggregation.spec.ts:656-662 + buildDummyTx:66-78).
// Reaches into the finalized cohort for its aggregate keys + committed signal.
function buildFixtureTxData(runner: AggregationServiceRunner): SigningTxData {
  const cohort = runner.session.cohorts[0];                       // AggregationCohort; verify shape in types
  const aggPk = musig2.keyAggExport(musig2.keyAggregate(cohort.cohortKeys));
  const payment = p2tr(aggPk);                                    // @scure/btc-signer P2TR for the aggregate key
  const prevOutValue = 100000n;
  const tx = new Transaction({ version: 2, allowUnknownOutputs: true });
  tx.addInput({ txid: '00'.repeat(32), index: 0, witnessUtxo: { amount: prevOutValue, script: payment.script } });
  tx.addOutput({ script: payment.script, amount: prevOutValue - 500n });
  tx.addOutput({ script: Script.encode([ 'RETURN', cohort.signalBytes! ]), amount: 0n }); // bind approval to the signal
  return { tx, prevOutScripts: [payment.script], prevOutValues: [prevOutValue] };
}

const runner = new AggregationServiceRunner({
  transport, did: serviceDid, keys: serviceKeys, config,
  onProvideTxData: async () => buildFixtureTxData(runner),
});
```

### Participant: signed update via `Updater.sign`
```ts
// from lib/operations/aggregation/e2e-http-transport.ts:151-170
function buildSignedUpdate(did: string, kp: SchnorrKeyPair, beaconAddress: string) {
  const doc = Resolver.deterministic({ genesisBytes: kp.publicKey.compressed, hrp: 'k', idType: 'KEY', version: 1, network: 'mutinynet' });
  const vm = doc.verificationMethod![0];
  const unsigned = Updater.construct(doc, [{
    op: 'add', path: '/service/-',
    value: { id: `${did}#beacon-cas`, type: 'CASBeacon', serviceEndpoint: `bitcoin:${beaconAddress}` },
  }], 1);
  return Updater.sign(did, unsigned, vm, new LocalSigner(kp.raw.secret!)); // verify LocalSigner ctor arg in keypair types
}

const participant = new AggregationParticipantRunner({
  transport, did, keys,
  shouldJoin: async () => true,
  onProvideUpdate: async ({ beaconAddress }) => buildSignedUpdate(did, keys, beaconAddress),
});
```

### Envelope auth wiring (both transports use the same resolver)
The server verifies each participant's signed envelope by resolving its DID to a
public key, and the client verifies the server's. For KEY DIDs this is one function:
```ts
// server
const transport = new HttpServerTransport({ resolveSenderPk: resolveBtcr2SenderPk, heartbeatIntervalMs: 0 });
transport.registerActor(serviceDid, serviceKeys);
// client (per participant)
const transport = new HttpClientTransport({ baseUrl: 'http://127.0.0.1:PORT', resolveSenderPk: resolveBtcr2SenderPk });
transport.registerActor(did, keys);
```
No manual `registerPeer` is needed when `resolveBtcr2SenderPk` is supplied and all
identities are did:btcr2 KEY DIDs.

### Hono adapter (service)
Wrap `HttpServerTransport`. Map each Hono request to `HttpRequestLike` (lowercase
header names; read the body for POSTs), then:
- non-SSE -> `const r = await transport.handleRequest(reqLike); return c.body(r.body, r.status, r.headers);`
- SSE GETs (`GET /v1/adverts`, `GET /v1/actors/:did/inbox`) -> back an `SseStream` and call `transport.handleSse(reqLike, stream)`.

Routes to mount: `POST /v1/messages`, `POST /v1/adverts`, `GET /v1/adverts` (SSE),
`GET /v1/actors/:did/inbox` (SSE), `GET /v1/.well-known/aggregation`.

For SSE under `@hono/node-server`, back the `SseStream` with the raw Node
`ServerResponse` (exposed on the Hono context env by `@hono/node-server`; verify the
property name in its types) and write `event:/data:/id:` frames in `writeEvent`,
`: comment` in `writeComment`, `.end()` in `close()`, and `res.on('close', cb)` in
`onClose`. If the raw-response bridge proves awkward, fall back to a plain Node
`http` server for the service in M1 (the library reference uses exactly that) and
introduce Hono in M2 - record the choice in an ADR either way.

## Milestone 1: the headless E2E (`e2e/headless-cohort.ts`)

Mirror `tests/aggregation.spec.ts:634-715`, but with real HTTP instead of
`MockTransport`:
1. Generate service identity + N=2 participant identities (KEY DIDs, mutinynet).
2. Start the service (`@btcr2-aggregation/service`) on `127.0.0.1:<port>` with the
   CAS `config` and the fixture `onProvideTxData`.
3. Create 2 participants (`@btcr2-aggregation/participant`) with
   `HttpClientTransport({ baseUrl })`, `shouldJoin: () => true`, and the
   `buildSignedUpdate` `onProvideUpdate`.
4. `await p.start()` for each participant, then `const result = await service.runner.run()`.
5. Assert: `result.signature.length === 64`, `result.signedTx` exists, and the
   service saw `cohort-advertised -> opt-in-received -> keygen-complete ->
   signing-started -> signing-complete` and each participant saw
   `cohort-discovered -> cohort-joined -> cohort-ready -> cohort-complete`.
6. Tear down: stop participants and the service; exit 0 on success, non-zero on
   failure or timeout (wrap the run in a ~30s timeout so a stall fails loudly).

`e2e/headless-cohort.spec.ts` is a thin vitest wrapper that runs the harness and
asserts it resolves with a 64-byte signature.

## Build sequence (do in order)

1. Scaffold the workspace: root `package.json`, `pnpm-workspace.yaml`,
   `tsconfig.base.json`, `eslint.config.js`, and the four package dirs with their
   `package.json` + `tsconfig.json` (composite, extends base) + `src/`.
2. `pnpm install`. If any `@did-btcr2/*` version is not on npm, STOP and report;
   the fallback is `pnpm` `link:`/`file:` to the local `did-btcr2-js` checkout at
   `/home/jintek/projects/github/@dcdpr/did-btcr2-js` (do not silently switch).
3. Open `node_modules/@did-btcr2/aggregation/dist/types` and confirm the exact
   shapes used above: `SigningTxData`, `CohortConfig` (and its required fields),
   `HttpRequestLike`/`HttpResponseLike`/`SseStream`, the runner option/callback
   types, and `runner.session.cohorts[0]` (`cohortKeys`, `signalBytes`). Adjust the
   inlined code to match if anything differs.
4. Implement `shared` (keys/DIDs helpers, `buildSignedUpdate`, `buildFixtureTxData`).
5. Implement `service` (`hono-adapter.ts`, `tx.ts`, `createService`).
6. Implement `participant` (`createParticipant`).
7. Implement `e2e/headless-cohort.ts` + the vitest wrapper.
8. `pnpm typecheck`, then `pnpm e2e`, then `pnpm test`. Iterate until green.

## Verification / definition of done

- `pnpm install` succeeds.
- `pnpm typecheck` (`tsc -b`) is clean.
- `pnpm e2e` prints a successful run and exits 0, having produced a 64-byte
  aggregated signature and a signed tx over real HTTP (service on a port,
  participants over `HttpClientTransport`).
- `pnpm test` (the vitest wrapper) passes.
- `pnpm lint` is clean.
- No em-dash characters or unicode arrows in any file (use `,` `:` `()` `.` or `->`).
- An ADR under `docs/adr/` records the service framework wiring (Hono vs the Node
  http fallback if taken) and the M1 fixture-tx approach.

## Gotchas and fallbacks

- **Missing `recoveryKey`/`recoverySequence`** in `CohortConfig` throws at advertise
  time. Both are required; derive a valid x-only `recoveryKey` as shown.
- **`runner.session.cohorts[0]`** is white-box but is the supported way the
  reference reads `cohortKeys`/`signalBytes` in `onProvideTxData`; the cohort is
  populated by keygen before `onProvideTxData` is called.
- **OP_RETURN in the fixture tx is required**: the signing approval binds to the
  validated signal, so the tx must carry `Script.encode(['RETURN', signalBytes])`.
- **SSE under Hono** is the fiddliest piece; the raw-Node-response bridge or the
  Node-http fallback (then Hono in M2) are both acceptable - just keep the service
  on a real port so the transport is genuinely exercised over HTTP.
- **ESM only**: the `@did-btcr2/*` packages and their deps are ESM; keep
  `"type": "module"` everywhere and use `import`.
- **Published-package assumption**: if npm install of `@did-btcr2/*` fails, switch
  to local `link:` and say so; do not stub the library.

## Phasing beyond M1

- **M2 - web UI.** `packages/web` (Vite + React, decide React vs Svelte then):
  in-browser participant (generate keys, join, submit, sign) + a service dashboard,
  rendered off the runner event streams. Reuses `participant` unchanged.
- **M3 - live + deploy.** Swap the fixture `onProvideTxData` for a real
  `@did-btcr2/bitcoin` connection on mutinynet; fund and broadcast a real beacon tx
  (reuse the library scenario tooling patterns); deploy the service publicly and
  serve the web build. Add SMT alongside CAS.
```
