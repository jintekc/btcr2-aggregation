# External Integrations

**Analysis Date:** 2026-07-07

## APIs & External Services

**Bitcoin chain data (esplora-compatible REST indexers):**
- Per-network public esplora hosts, defined in `packages/shared/src/networks.ts` (`NETWORK_REGISTRY`):
  - `bitcoin` (mainnet): `https://blockstream.info/api`, explorer `https://mempool.space/tx/:txid`
  - `mutinynet` (default): `https://mutinynet.com/api`, explorer `https://mutinynet.com/tx/:txid`
  - `signet`: `https://mempool.space/signet/api`
  - `testnet3`: `https://mempool.space/testnet/api`
  - `testnet4`: `https://mempool.space/testnet4/api`
  - `regtest`: `http://127.0.0.1:3000` (local, expects a self-hosted esplora-electrs; used by CI's regtest job, `e2e/lib/regtest.ts`)
  - Client: `@did-btcr2/bitcoin`'s `BitcoinConnection` (published package), consumed in `packages/service/src/*` (e.g. `broadcast.ts`, `resolve.ts`, `tx.ts`) and `e2e/`
  - Override: `ESPLORA_HOST` env var (or `resolveNetwork(name, esploraHost)` second arg) points at a self-hosted indexer instead of the public default
  - Auth: none - these are public, unauthenticated REST APIs
  - Access is entirely opt-in / gated: real network I/O only occurs when `LIVE=1` (server) or an in-browser live flow is explicitly enabled; the default is offline/fixture mode with zero chain access (this is also enforced in CI - the hermetic gate job runs with no `LIVE`/`NETWORK` env at all)

**IPFS network (opt-in, ADR 0011):**
- Helia (`@helia/*`) + libp2p (`libp2p`, `@libp2p/*`, `@chainsafe/libp2p-noise`, `@chainsafe/libp2p-yamux`) form an embedded IPFS node, not a hosted API call
- Server-side node: `packages/service/src/ipfs.ts` - persists blocks via `blockstore-fs`/`datastore-fs` to `IPFS_DIR` (defaults ephemeral if unset); can advertise multiaddrs via `IPFS_ANNOUNCE` (comma-separated, e.g. a `wss` multiaddr behind a TLS proxy) so browsers can dial in over Bitswap
- Browser-side node: `packages/web/src/lib/ipfs-node.ts` - in-tab Helia node, one per browser session, connects out over libp2p websockets/noise/yamux
- Auth: none - IPFS/Bitswap has no authentication; content addressing (CIDs) is the integrity mechanism
- Gated by `IPFS=1` env var on the service; entirely absent from the default hermetic path

**Core protocol dependency (not a network call, but the primary external integration surface):**
- Published `@did-btcr2/*` npm packages (`method`, `aggregation`, `keypair`, `common`, `bitcoin`, `smt`) - this app is a pure consumer, not a fork, of the did:btcr2 method + aggregation library. All DID creation, update-signing, MuSig2 cohort coordination, and resolution logic is delegated to these packages. See `docs/adr/*` for app-level integration decisions on top of them.

## Data Storage

**Databases:**
- None. No SQL/NoSQL database, no ORM, no database driver anywhere in the dependency tree.

**File Storage:**
- Local filesystem only, used for two purposes:
  - Cohort/artifact persistence: `packages/service/src/persist.ts`, `packages/service/src/store.ts` (content-addressed artifact store, CAS)
  - IPFS block/data stores: `blockstore-fs` + `datastore-fs` under `IPFS_DIR` (opt-in, service-side only; browser IPFS node uses in-memory/browser-backed stores)
- No S3/GCS/cloud object storage integration

**Caching:**
- None (no Redis, no in-memory cache library beyond application-level Maps)

## Authentication & Identity

**Auth Provider:**
- **None. There is no authentication or authorization layer anywhere in this codebase.**
  - No login, session, JWT, OAuth, API key, or bearer-token mechanism was found in `packages/service`, `packages/participant`, or `packages/web` (confirmed by grep across all `.ts`/`.tsx` for `auth`, `jwt`, `session`, `bearer`, `oauth`, `passport`, `apikey`).
  - The word "session" appears only in the domain sense of a MuSig2/cohort "signing session" (e.g. `packages/web/src/stores/dashboard.ts:367`, `packages/service/src/index.ts:368`), not an authenticated user session.
  - All `/v1/*`, `/dashboard/*`, `/resolve/*`, and `/cas/*` HTTP routes served by `packages/service/src/hono-adapter.ts` are unauthenticated and open to any caller who can reach the port.
  - "Identity" in this app means DID/keypair identity (`@did-btcr2/keypair`), not user auth - anyone holding a private key can act as that DID's controller; there is no separate access-control layer restricting who may call the service's HTTP API.
  - **Integration gap:** any production/public deployment relies entirely on network-level controls (reverse proxy, firewall, rate limiting) since the app itself performs no request authentication. This should be treated as an explicit, deliberate gap to flag before exposing a coordinator instance to the public internet beyond the documented demo/self-host use case.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, or similar APM/error-tracking SDK)

**Logs:**
- Plain `console.log`/stdout logging in the service process (`packages/service/src/demo-server.ts` prints startup config); no structured logging library, no log shipping/aggregation
- Dashboard telemetry is pushed to the browser via Server-Sent Events (`packages/service/src/dashboard-sse.ts`, ADR 0004) - this is an app-internal SSE channel for cohort/signing progress, not an external monitoring integration

## CI/CD & Deployment

**Hosting:**
- Self-hosted only (no managed PaaS integration like Vercel/Netlify/Heroku/Fly detected)
- `Dockerfile` + `docker-compose.yml` package the coordinator as a single container (ADR 0014); operator fronts it with their own TLS-terminating reverse proxy (documented in `docs/DEPLOY.md`)

**CI Pipeline:**
- GitHub Actions: `.github/workflows/ci.yml`
  - `hermetic` job: 16-check gate (`typecheck`, `lint`, `test`, and 13 `e2e:*` legs) with zero chain/network env vars, plus Playwright Chromium install for browser legs
  - regtest live-path job (ADR 0013): spins up a throwaway `bitcoind` + esplora-electrs via `e2e/lib/regtest.ts`, runs `LIVE=1 LIVE_NETWORK=regtest` e2e legs against a real (local, disposable) chain
  - All third-party Actions are pinned by full commit SHA (supply-chain hardening), matching the pnpm `minimumReleaseAge` posture

## Environment Configuration

**Required env vars (all optional with documented defaults; none are strictly required to boot in default/offline mode):**
- `NETWORK` (default `mutinynet`) - which Bitcoin network the coordinator/browser target
- `ESPLORA_HOST` - override the public esplora indexer for `NETWORK`
- `LIVE` - `1` enables real esplora I/O (server-side resolution + `/v1/tx/*` registration proxy); unset = fully offline
- `ALLOW_MAINNET` - explicit opt-in required before `NETWORK=bitcoin` is permitted even offline
- `RECOVERY_KEY` - operator x-only pubkey (64 hex) for cohort recovery leaf; omitting it means a throwaway, discarded key (fine for fixtures, unsafe for real funds)
- `MIN_PARTICIPANTS`, `FILLERS` - cohort sizing/filler co-signer counts
- `IPFS`, `IPFS_DIR`, `IPFS_ANNOUNCE` - opt-in IPFS publish/pinning (ADR 0011)
- `HOST`, `PORT` - bind address/port (`HOST` unset = loopback only; Docker sets `HOST=0.0.0.0`)
- `COHORT_TTL_MS`, `PHASE_TIMEOUT_MS` - protocol timing overrides
- `COORDINATOR_ORIGIN` - dev-only, Vite proxy target for the web dev server

**Secrets location:**
- No secrets are committed. No `.env` or `.env.example` file exists in the repo.
- `RECOVERY_KEY` is the closest thing to an operator secret (though it's a public x-only key, not a private key) and is documented to be supplied via env/`.env` next to `docker-compose.yml`, kept out of the built image (see `docs/DEPLOY.md` and the `.env`-out-of-image lesson noted in project memory)
- Any real per-DID private keys are generated/held client-side (browser or e2e harness), never persisted server-side by the coordinator

## Webhooks & Callbacks

**Incoming:**
- None. No webhook receiver endpoints exist; the service exposes protocol/aggregation HTTP+SSE routes (`/v1/*`, `/dashboard/*`, `/resolve/*`, `/cas/*`) but these are direct RPC/streaming endpoints for the DID/participant protocol, not third-party webhook callbacks.

**Outgoing:**
- None (no outbound webhook delivery to third-party systems)

---

*Integration audit: 2026-07-07*
