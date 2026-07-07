# ADR 0014: Deployment topology - one container, one process, any network

- Status: Accepted
- Date: 2026-07-07
- Milestone: M4 (self-hostability: containerize the coordinator + operator runbook)

## Context

M3 delivered the "live" half of the original three-step plan (real beacon
broadcasts, resolution, the regtest CI gate). The "deploy the service to a public
server" half (PROJECT-CONTEXT.md step 3) was never built: there was no container,
no compose, no operator runbook, and ADR 0003 explicitly deferred deployment. The
North Star is an app "ANYONE can self-host and run as a REAL aggregator over the
public internet," so packaging is the direct gap.

The runtime shape was already deploy-friendly and only two env holes blocked a
container:

1. The `demo-server.ts` entrypoint threaded `PORT` from the environment but not
   `HOST`, so it always bound `127.0.0.1` - unreachable from outside a container.
2. Resolution + the tx proxy used the network registry's esplora host with no
   override, so a self-hoster running their own node (a private indexer, or
   `regtest` off the registry default) had no way to redirect it.

## Decision

### 1. One container, one process, same-origin

Package the coordinator as a single image that runs the compiled
`packages/service/dist/demo-server.js`. It serves the aggregation API AND the built
SPA from one port (the same-origin topology, ADR 0003), so there is no nginx inside
the container and no CORS. TLS is terminated by a reverse proxy in front of it
(documented in docs/DEPLOY.md), not by the app: the app has no business holding
certificates, and every real deployment already fronts services with a proxy.

### 2. One image, any network (no rebuild to switch chains)

The SPA reads the operator's chain at runtime from `GET /v1/config` (M3f runtime
network injection), so the image is network-agnostic: `NETWORK` at `docker run`
selects the chain, and one build serves mutinynet / signet / regtest / mainnet.
This is why the build takes no network argument.

### 3. Close the two env holes in the entrypoint

- `HOST` is now read by the entrypoint (default unset -> the code's `127.0.0.1`,
  preserving safe local behavior); the image sets `HOST=0.0.0.0`.
- `ESPLORA_HOST` overrides the resolved network's esplora REST host (via the
  existing `resolveNetwork(name, esploraHost)` second argument), plumbed through a
  new `DemoServerOptions.esploraHost`. Only meaningful under `LIVE`.

Both are additive and default to today's behavior; no existing path changes.

### 4. Build hygiene matches CI

The Dockerfile installs with `pnpm install --frozen-lockfile --trust-lockfile`
(the same supply-chain-policy bypass CI uses: the committed lockfile is the trusted
base, so pnpm 11's 24h `minimumReleaseAge` re-verification must not fail a build
when a dep is freshly published), pins pnpm 11.4.0 and Node 22, and builds all
packages. The runtime copies the built workspace wholesale so the service's
`../../web/dist` SPA path and the pnpm workspace symlinks resolve exactly as in
development. `pnpm prune --prod` is deliberately NOT run: in this workspace it
rewrites the virtual-store symlinks and breaks the service's package resolution
(e.g. `@did-btcr2/bitcoin`) once the tree is copied to the runtime stage. A slim
prod-only variant (`pnpm deploy --prod`) is deferred (see Consequences).

### 5. Liveness via `GET /v1/config`

The unconditional config route (no chain, no store) is the container `HEALTHCHECK`
and the documented probe for load balancers.

## Consequences

- `docker compose up --build` yields a working mutinynet-offline coordinator; the
  same compose file drives live, self-run-node, mainnet, and IPFS deployments via
  environment variables, all covered in docs/DEPLOY.md.
- The "anyone can self-host over the public internet" North Star claim is now
  concretely true: a stranger can clone, `docker compose up`, and front it with
  Caddy/nginx.
- Deferred, and honestly labelled in the runbook: image-size optimization (a
  `pnpm deploy --prod` slim variant instead of the wholesale workspace copy). A
  correct, obvious build was prioritized over a minimal one for a reference app.
- The trusted-coordinator variant remains a separate future repo (ADR 0006);
  nothing here changes the p2p, no-service-key model.
