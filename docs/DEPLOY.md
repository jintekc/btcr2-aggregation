# Deploying a did:btcr2 aggregation coordinator

This guide takes you from `docker compose up` to a public, TLS-terminated
aggregator that anyone can join over the internet. The design decisions behind it
are recorded in [ADR 0014](adr/0014-deployment-topology.md); this is the how-to.

## What you are running

One process, one port. The coordinator is a Node service (Hono) that serves BOTH
the aggregation protocol/API and the built web SPA from the same origin (the
same-origin topology, [ADR 0003](adr/0003-same-origin-topology.md)), so there is
no CORS and no second web server. It advertises a cohort, accepts browser
participants, coordinates the n-of-n MuSig2 co-signing (it holds no signing key,
[ADR 0006](adr/0006-keep-p2p-defer-trusted-coordinator-app.md)), and can resolve
DIDs and proxy the first-update registration transaction.

One image serves any network. The browser reads the operator's chain at runtime
from `GET /v1/config`, so you switch networks with the `NETWORK` variable and never
rebuild.

## Quick start (mutinynet, offline)

```bash
docker compose up --build
```

Open http://localhost:8080. This runs on **mutinynet** with an **offline** chain
connection: DIDs and beacon addresses are minted, cohorts co-sign the fixture beacon
transaction, but nothing is broadcast and resolution returns the genesis document.
It is the zero-risk way to see the whole flow. `MIN_PARTICIPANTS=2` with `FILLERS=1`
means a single browser attendee completes a real 2-of-2 cohort against one
operator-run honest co-signer.

Stop with Ctrl+C (the container handles SIGTERM with a 3s shutdown backstop).

## Going live (real esplora)

Set `LIVE=1` to use a real esplora connection. Now `GET /resolve/:did` reads real
beacon signals and the `/v1/tx/*` proxy relays the controller's first-update
registration transaction.

```bash
LIVE=1 NETWORK=mutinynet docker compose up --build
```

By default the coordinator uses the registry's public esplora host for the network.
To point at your OWN indexer (a private esplora, or a `regtest` node that does not
sit at the registry default), set `ESPLORA_HOST`:

```bash
LIVE=1 NETWORK=regtest ESPLORA_HOST=http://host.docker.internal:3000 docker compose up
```

(`host.docker.internal` reaches a service on the Docker host from inside the
container; on Linux add `extra_hosts: ["host.docker.internal:host-gateway"]` to the
service, or run your node in the same compose project.)

## TLS and reverse proxy (required for a public deployment)

The container serves plain HTTP on 8080 and binds `0.0.0.0` inside the container.
Do NOT expose it directly on the internet: browsers need a secure context
(`https://`) for WebCrypto, and any live/mainnet path relays signed transactions.
Terminate TLS at a reverse proxy in front of the container.

Caddy (automatic HTTPS) is the shortest path:

```
aggregator.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

nginx equivalent (with the SSE endpoints the dashboard and inbox use kept
unbuffered):

```nginx
server {
    listen 443 ssl;
    server_name aggregator.example.com;
    # ssl_certificate / ssl_certificate_key ... (e.g. certbot)

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Server-Sent Events (GET /v1/adverts, the dashboard, the inbox) must not
        # be buffered or the browser never sees live cohort state.
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Bind the published port to loopback when a proxy on the same host fronts it, so
8080 is never reachable except through TLS:

```yaml
ports:
  - "127.0.0.1:8080:8080"
```

**Rate-limit at the proxy.** The coordinator has no app-layer auth (anonymous
browser participants must reach it), so under `LIVE` the `/v1/tx/broadcast` +
`/v1/tx/utxos/:address` proxy and the `/cas/*` artifact routes are openly
reachable. They only relay valid transactions and public UTXO data (no wallet or
node RPC is exposed), but an unthrottled public endpoint still lets an anonymous
flood load your indexer, and against a shared public esplora it can get your
server IP rate-limited. Add a throttle at the proxy, e.g. nginx:

```nginx
limit_req_zone $binary_remote_addr zone=btcr2:10m rate=10r/s;
# inside the location block:
limit_req zone=btcr2 burst=20 nodelay;
```

## Mainnet (real funds)

Mainnet is refused unless you opt in explicitly, even offline, because the browser
mints real addresses it invites controllers to fund and a live coordinator relays
real transactions ([ADR 0010](adr/0010-mainnet-guard-rails.md)).

```bash
NETWORK=bitcoin ALLOW_MAINNET=1 LIVE=1 RECOVERY_KEY=<x-only-hex> docker compose up
```

Before funding ANY cohort beacon:

- **Set `RECOVERY_KEY`** to an x-only public key whose secret you hold offline. It
  is the ADR 042 recovery leaf, spendable by its holder after `recoverySequence`
  (144 blocks, about a day). Without it, each cohort gets a throwaway key whose
  secret is discarded, and a funded beacon becomes unrecoverable. Derive the key
  offline; only the public half belongs on the server.
- Serve over HTTPS (above). The browser refuses to broadcast mainnet registration
  transactions without an explicit acknowledgment and shows a REAL FUNDS badge.

## IPFS pinning (optional, ADR 0011)

Let browser participants publish their resolution artifacts to a coordinator-run
Helia node:

```bash
IPFS=1 IPFS_DIR=/data/ipfs docker compose up   # (uncomment the ipfs-data volume)
```

`IPFS_DIR` persists pins across restarts (mount the volume shown in
`docker-compose.yml`). The container runs as the unprivileged `node` user
(uid 1000), and the image pre-creates `/data/ipfs` owned by it, so the **named
volume at `/data/ipfs` just works**. If you instead use a bind mount or a
different `IPFS_DIR`, that path is root-owned and the node user cannot write pins
to it (the container exits at boot with an EACCES). Pre-create it and
`chown -R 1000:1000 <hostdir>` first, or stick with the named volume.

For browsers on an https page to dial the node, expose it over secure WebSockets
through your proxy and advertise that address with
`IPFS_ANNOUNCE=/dns4/aggregator.example.com/tcp/443/wss/p2p/<peerId>`.

## Health and liveness

`GET /v1/config` is unconditional (it never touches the chain or the store), so it
is the liveness probe. The image's `HEALTHCHECK` already polls it; a load balancer
or orchestrator can hit the same path.

```bash
curl -fsS http://localhost:8080/v1/config
# {"network":"mutinynet","label":"Mutinynet (signet)","isMainnet":false}
```

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `NETWORK` | `mutinynet` | Chain for the coordinator + browser. Unknown name fails at boot. |
| `PORT` | `8080` | Published port. |
| `HOST` | `0.0.0.0` (in image) | Bind address. The image sets `0.0.0.0`; the bare entrypoint defaults to `127.0.0.1`. |
| `LIVE` | unset | `1` = real esplora connection (resolve + tx proxy). |
| `ESPLORA_HOST` | registry default | Override the esplora REST host (needs `LIVE=1`). |
| `ALLOW_MAINNET` | unset | Required for `NETWORK=bitcoin`, even offline. |
| `RECOVERY_KEY` | unset | x-only recovery pubkey for funded cohorts. Required before funding. |
| `OPERATOR_PASSWORD` | unset | Operator console password (HOST-01, ADR 0015). Set it to enable the login-gated console + gated telemetry. Unset = fail-closed: public participant surface still serves, operator surface disabled with a loud boot warning. Keep it in a `.env` file, never bake it into the image. |
| `OPERATOR_SESSION_TTL_MS` | `86400000` (24h) | Operator session lifetime in ms. |
| `OPERATOR_COOKIE_SECURE` | on | Session cookie `Secure` flag. Leave on behind a TLS proxy; set `0` ONLY for a local plain-http run (else the browser drops the cookie). |
| `MIN_PARTICIPANTS` | `2` | Participants that complete a cohort. |
| `FILLERS` | `1` (compose), `0` (bare image) | Operator-run honest co-signers (own keys). `0` = all-real cohorts. |
| `IPFS` | unset | `1` = run a Helia pinning node. |
| `IPFS_DIR` | in-memory | Durable pin storage path (mount a volume). |
| `IPFS_ANNOUNCE` | listen addr | Comma-separated multiaddrs to advertise (e.g. a `wss` proxy address). |

## Running the compiled server without Docker

The image just runs the compiled entrypoint. To do the same on a host with Node 22
and pnpm:

```bash
pnpm install --frozen-lockfile --trust-lockfile
pnpm -r build
HOST=0.0.0.0 NETWORK=mutinynet node packages/service/dist/demo-server.js
```

## Security notes

- The coordinator holds no signing key; participants co-sign. It does hold the
  optional `RECOVERY_KEY` (public only) and, under IPFS, pins public artifacts.
- Never expose a self-run Bitcoin node's RPC to the container's network beyond the
  esplora REST host it needs.
- Image size is not yet optimized (it copies the built workspace wholesale); a
  `pnpm deploy --prod` slim variant is a future refinement.
