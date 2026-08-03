# Deploying a did:btcr2 aggregation coordinator

This guide takes you from `docker compose up` to a public, TLS-terminated
aggregator that anyone can join over the internet. The design decisions behind it
are recorded in [ADR 0014](adr/0014-deployment-topology.md); this is the how-to.

## What you are running

One process, one port. The coordinator is a Node service (Hono) that serves BOTH
the aggregation protocol/API and the built web SPA from the same origin (the
same-origin topology, [ADR 0003](adr/0003-same-origin-topology.md)), so there is
no CORS and no second web server. It advertises the cohorts YOU create from the
operator console, accepts browser participants into them, coordinates the n-of-n
MuSig2 co-signing (it holds no signing key,
[ADR 0006](adr/0006-keep-p2p-defer-trusted-coordinator-app.md)), and can resolve
DIDs and proxy the first-update registration transaction.

**It advertises nothing on its own.** A cohort comes into existence only when the
authenticated operator advertises a draft, so a freshly booted service serves an
empty public directory until you create one. That is the product: the operator
decides what this service offers, rather than a boot loop deciding for you.

One image serves any network. The browser reads the operator's chain at runtime
from `GET /v1/config`, so you switch networks with the `NETWORK` variable and never
rebuild.

## Quick start (mutinynet, offline)

Set an operator password first. The compose file leaves `OPERATOR_PASSWORD` empty
by default, and empty means fail-closed: the public participant surface still
serves, but the operator console and every mutating cohort route stay unmounted,
with a loud boot warning. Since a cohort exists only when the operator advertises
one, a run with no password can never produce a cohort at all.

```bash
echo "OPERATOR_PASSWORD=$(openssl rand -base64 24)" >> .env
docker compose up --build
```

(Compose reads that `.env` from the directory you run it in. Keep it out of git and
out of the image; never bake a real password into a build.)

This runs on **mutinynet** with an **offline** chain connection: DIDs and beacon
addresses are minted, cohorts co-sign the fixture beacon transaction, but nothing
is broadcast and resolution returns the genesis document. It is the zero-risk way
to see the whole flow.

Then, in order:

1. Open http://localhost:8080/operator and log in with the password you just set.
   This is the console described under "Running the service: the operator's runtime
   controls" below.
2. Create a cohort draft (it starts from the `DEFAULT_*` seeds in the environment
   reference) and advertise it. Only now does the public directory have anything in
   it.
3. Open http://localhost:8080 in another tab as a participant, browse the directory,
   and join the cohort you just advertised.
4. To rehearse the whole loop by yourself, without a second human, use the
   `Fill remaining seats with test peers` control in the cohort's drill-down. It
   fills the remaining seats with real in-process participants; see "Test peers
   (rehearse your service by yourself)" below for what they do and do not do.

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

## Broadcasting cohort beacons for real (BROADCAST=1)

`LIVE=1` alone gives you real resolution and a real registration-tx proxy, but cohort
co-signing still spends the zero-chain FIXTURE beacon transaction: nothing about the
aggregate cohort touches the chain. To make a cohort actually anchor on Bitcoin (the
n-of-n MuSig2 beacon transaction built, funded, and broadcast for real), opt in with
`BROADCAST=1`. It REQUIRES `LIVE=1` and refuses to boot without it (there is no point
broadcasting the fixture tx), and it is one more layer on the ADR 0010 guard rails, so
the hermetic fixture path stays the default and nothing changes until you set it.

```bash
LIVE=1 BROADCAST=1 NETWORK=mutinynet \
  OPERATOR_PASSWORD=... RECOVERY_KEY=<x-only-hex> \
  docker compose up --build
```

On a live+broadcast boot the coordinator logs a loud banner naming exactly what is live
(each cohort's beacon tx is broadcast on-chain, the operator must fund each beacon
address within its funding window, and whether the recovery key is operator-held or a
throwaway). Read it: it is the same loud-boot idiom as the mainnet rails.

**The flagship live story is MUTINYNET.** It is a real public signet-based network with a
free faucet, so you can stand up a genuinely broadcasting aggregator and fund real cohort
beacons without spending real money. `regtest` behind Polar (or any bitcoind + esplora
pair) is the LOCAL-development story: your own chain, you mine your own blocks (this is
what `pnpm uat:live` drives). `bitcoin` mainnet is real funds end to end and is gated
behind `ALLOW_MAINNET=1` on top of everything else (see below). Hermetic (no `LIVE`, no
`BROADCAST`) remains the boot default and the zero-risk way to see the whole flow.

### Funding a cohort beacon (the operator's job)

Under `BROADCAST=1`, a cohort cannot anchor until its beacon address holds a spendable,
confirmed UTXO. That funding is the OPERATOR's responsibility, from the operator's own
wallet, and the operator console walks you through it:

1. When a cohort's seats fill, MuSig2 key aggregation runs and the cohort's Taproot beacon
   address comes into existence. The operator console surfaces a `Needs funding` chip on the
   cohort and a funding stage in its drill-down showing the beacon address (with a copy
   button and an explorer link) and ONE suggested minimum in sats.
2. Send at least the suggested minimum to that beacon address from your wallet as a SINGLE
   confirmed UTXO. The suggested minimum is the same number the tx builder will actually
   check: it is `max(2000 sats, the fee-plus-outputs-derived need)`. Deeper, larger UTXOs
   are preferred by the library's selection, so top up in one clean payment rather than
   dribbling dust.
3. The funding stage advances honestly through three states: waiting (no spendable UTXO
   yet), seen (an unconfirmed UTXO is in the mempool), and funded (a confirmed UTXO at or
   above the minimum). Co-signing proceeds automatically once it reads funded.
4. There is a TERMINAL dead-end: if the selected confirmed UTXO is BELOW the suggested
   minimum, topping up cannot fix it (new funding confirms shallower and is never selected
   first), so the stage says so plainly rather than waiting forever.
5. There is a funding WINDOW (`FUNDING_WINDOW_MS`, default 12 minutes). If the beacon is
   not funded before the window elapses, the cohort dead-ends with an honest "funding never
   arrived" reason. The window is clamped per-cohort against the remaining cohort TTL and
   disclosed when it is truncated; a mid-flight esplora outage freezes the funding readout
   stale-honestly rather than lying about it.

**Recovery key before you fund anything.** Set `RECOVERY_KEY` to an x-only public key whose
secret you hold offline (the ADR 042 recovery leaf, spendable by its holder after the
relative timelock). Without it every cohort gets a THROWAWAY recovery key whose secret is
discarded, so funds sent to a cohort that then fails below its fallback threshold are
UNRECOVERABLE, on any network, mutinynet included. The live+broadcast boot banner warns
loudly when `RECOVERY_KEY` is unset, and the funding stage always discloses whether the
recovery key is operator-held or throwaway. Derive the key offline; only the public half
belongs on the server.

**Change routing.** By default the beacon tx returns change to the beacon address itself
(timelocked under the same script). Set `LIVE_CHANGE_ADDRESS` to route change to an
operator wallet instead, avoiding address reuse; on mainnet the funding stage shows the
change-routing line explicitly.

**Timer invariant.** Under `BROADCAST=1` the coordinator fail-fast-validates at boot that
`PHASE_TIMEOUT_MS` exceeds `FUNDING_WINDOW_MS`, so the funding wait can surface its own
specific reason before the generic phase-stall timer fires. If you shorten one, keep the
ordering or the boot throws with both values named.

## Running the service: the operator's runtime controls

Everything in this section is done from the authenticated operator console at `/operator`, while
the process keeps running. None of it needs a restart, and none of it is persisted: see
"What survives a restart" below. The decisions behind these controls, and the library behavior that
forced their shape, are recorded in
[ADR 0017](adr/0017-runtime-lifecycle-control.md).

### Cancel a cohort

`Cancel cohort` ends a cohort deliberately, at any point BEFORE its beacon transaction is
broadcast. Seated participants lose their seats, the cohort stops being joinable immediately, and
it is recorded with its own `Canceled` fate, never folded into "failed". A seated participant is
told the operator canceled it, rather than getting the generic "this service didn't say why" line.

The confirmation is laddered by consequence: an ordinary cancel names the cohort and its seated
count, and canceling a FUNDED live cohort asks you to type the cohort id and states the
recovery-key situation, because money has already arrived at the beacon address.

Once the beacon transaction has broadcast the action is HIDDEN rather than disabled: the
transaction is out on the network, and there is nothing left to cancel. A draft that was never
advertised is discarded, not canceled.

### Finalize a stalled signing round

`Finalize now` commits the k-of-n script-path fallback so a cohort that is stuck waiting for a
missing co-signer can still anchor. It is available only while the cohort is in one of the three
signing phases, because that is the only window in which the library's fallback can be started; at
any other point the button renders disabled with the reason. The same fallback also fires
automatically on the stall timer, so this control moves the moment forward rather than adding a
new outcome. It is idempotent: a second click is a no-op, not a second finalize.

### There is no "close" button, and that is deliberate

Seats are `min == max == n`, so the nth participant to join both locks the roster and starts key
aggregation. Closing therefore happens by itself, and the console narrates it as a stage rather
than offering a control. There is no way to keep a partially filled n-of-n cohort while refusing
further joins, because such a cohort could never anchor. If you want a half-filled cohort gone,
cancel it.

### Pause advertising (drain mode)

`Pause advertising` stops NEW cohorts from being offered. It is a drain, not a kill switch:

- Cohorts advertised BEFORE the pause stay in the public directory, stay joinable, and keep
  filling.
- In-flight cohorts run to completion. Seated participants are untouched.
- Resolve, the anchor reads, the artifact routes, monitoring, export, cancel, finalize, and draft
  editing all keep working.
- Advertise and re-advertise refuse with an honest reason; the draft is left intact.

The public directory shows an honest paused notice, and `GET /v1/status` carries a `paused` bit so
a headless client can tell a paused service from an idle one (a paused service and an idle service
both show zero open cohorts, so an empty list is never evidence of a pause).

A full quiesce is pause PLUS canceling each remaining open cohort individually. There is no bulk
retract, on purpose: each cancel throws away real participants' seats and gets its own
confirmation.

`Resume advertising` reverses it. Neither direction asks for confirmation, because both are
reversible and spending friction here would dilute the ceremony that cancel depends on.

### Service settings

The settings surface edits, for the running process: the service display name, the defaults a NEW
draft starts from (beacon type, size n, threshold k, discovery window, funding window), and the
participation terms text.

Two rules govern it:

- **Settings apply to NEW cohorts only.** A draft reads the defaults once, when it is created. An
  advertised or in-flight cohort's shape never changes: its advert is public and its seats may be
  filling.
- **Saves are all-or-nothing.** If any field in a save is invalid, nothing is applied, so the
  surface can never show a half-saved state.

Each field displays where its current value came from, either the environment default or a change
made this session, with the environment value named so you can see what a restart would restore.

The discovery window can only be SHORTENED. The underlying library has no per-cohort timing value
at all, so this service enforces the window itself and can only cut a cohort short of the
runner-level `COHORT_TTL_MS`. A larger value is never accepted and quietly not honored, and the two
paths that can set it answer differently on purpose:

- **A runtime SAVE above the ceiling is REFUSED**, naming the real maximum. You chose and typed
  that number, so the honest answer is to tell you it cannot be enforced.
- **A boot SEED above the ceiling is CLAMPED down** to the maximum, with a warning at boot naming
  both your value and the enforced one. Boot configuration is often inherited rather than chosen,
  and every other out-of-range boot value in this service warns and falls back rather than refusing
  to start; a typo in an env file should not become a crash loop. The clamped value is then what
  the console reports as the environment default, because it is the value actually in force.

### Turning broadcast off (one way, this session)

`Disable broadcast` stops the money-moving leg for NEW cohorts: they are created on the fixture
path instead, so they never wait for funding and never read a UTXO. LIVE esplora reads stay up, so
resolve, anchor observation, and the health strip are unaffected. Cohorts already advertised when
you flip the switch finish under the mode they started with.

**There is no way to turn it back on from the console.** Re-enabling broadcast is a restart with
`BROADCAST=1` in the environment. That is deliberate: the layered environment opt-in
([ADR 0010](adr/0010-mainnet-guard-rails.md)) is the only path to money movement, and a runtime
control may only ever point toward safety. The health strip keeps reporting the LIVE mode the
service really booted with, with a separate chip stating that broadcast is off for this session.

### Dismissing an ended cohort

Ended records (anchored, failed, expired, canceled) are bounded telemetry, not protocol state. A
`Dismiss` action removes one from the console ahead of the automatic eviction. There is no undo,
and the dismissal itself is written to the operator actions log, so the one action whose purpose is
to remove evidence is not the one that goes unrecorded.

### Test peers (rehearse your service by yourself)

From a cohort's drill-down, `Fill remaining seats with test peers` fills the remaining seats with
in-process participants so one operator can rehearse the whole loop alone instead of needing a
second human. It works in
hermetic AND live mode. Test peers are REAL participants: on a live cohort they co-sign for real
with throwaway keys and their DIDs are anchored on the network you named, which the confirmation
states before you commit.

They are badged as test peers everywhere they appear in the console, and stamped in the activity
log. Nothing in the protocol distinguishes a test peer from a stranger, so the badge comes from
this service's own record of the DIDs it spawned, never from an inference about someone else's
identity.

Each peer's own first-update registration is deliberately SKIPPED, with a note saying so. A first
update needs its own funded singleton beacon address and a confirmed registration
([ADR 0007](adr/0007-resolve-driver-and-first-update-discovery.md)), so attempting it per peer would demand a
funding step each and would fail where nobody would look.

## What survives a restart

Nothing in the section above does. Pause, the broadcast switch, and every runtime setting live in
memory for the life of the process, and a restart returns the service to its boot environment:
whatever `docker-compose.yml` or your `.env` says. This is the same in-memory posture as cohort
state itself (single box, [ADR 0014](adr/0014-deployment-topology.md)); durability is a deliberate
future decision, not an accident of omission, and the console says so plainly.

So the way to make a setting permanent is to put it in the environment. The runtime controls are
for running the service today.

## Participant-facing features you are hosting

These are used by the strangers who point their browser at your service, not by you, but you are
the one who has to explain them, so they are documented here too.

### Participants can use their own chain endpoint

By default a participant's browser makes its chain reads through this service's same-origin proxy,
which needs zero configuration and is the recommended path. A participant may instead supply their
own esplora endpoint, in which case their UTXO checks and anchor confirmations go directly there.
Broadcasting through their own endpoint is a SECOND explicit opt-in on top of that.

An endpoint whose chain disagrees with this service's network is refused before any read, by
comparing chain markers rather than trusting a label. Four failure cases are reported distinctly:
a chain mismatch, an endpoint that does not allow browser requests, an unreachable endpoint, and a
malformed URL. There is no silent fallback in either direction: a refused endpoint is never
activated, and a failing override never quietly reverts to your proxy.

**The browser-request constraint is the one you will get asked about.** A browser can only read
from an endpoint that sends permissive CORS headers. Many public esplora deployments do; a
self-hosted electrs behind a default proxy usually does not, and there is nothing the participant
can do about it from their side. That case gets its own message rather than being reported as
"unreachable".

### Participants can sign the registration transaction in their own wallet

Instead of pasting a private key into the browser, a participant can export the first-update
registration transaction as an unsigned PSBT, sign it in whatever wallet they use, and return the
signed PSBT for validation and broadcast. The app validates the returned PSBT against the exact
template it created before anything is broadcast, and the same real-funds guard rails apply as in
the in-browser path.

The exported PSBT is a standards-correct P2TR key-spend. **Wallet interoperability was not verified
in this environment, so no specific wallet is named here as compatible.** If a participant's wallet
refuses the transaction (its data output is the usual sticking point), that is a support question,
not a defect in the round trip: the round trip itself is proven programmatically.

Nothing from the round trip is written to browser storage.

### Participation terms

Set `TERMS_TEXT` at boot, or the participation terms field in the settings surface at runtime, and
joining through the web app requires the participant to read the terms and agree. The agreement is
recorded as a DID-signed artifact, verified server-side before anything is stored, and bound to the
HASH of the exact document that was shown, so editing the terms afterwards cannot rewrite what
somebody agreed to. Clearing the terms removes the step entirely; the feature is absent, not empty.

The terms are capped at **20000 characters** (roughly 3500 words), on both paths that set them. A
runtime save above the cap is refused with the limit named. A boot value above it is ignored with a
warning and is never truncated to fit, because a truncated document is one participants would
DID-sign in mutilated form; until you shorten it, the join flow has no terms step at all.

**Be honest with yourself about what this enforces.** The aggregation protocol carries no message
that could hold an acceptance, so enforcement is app-level: it applies to participants joining
through the web app. A client speaking the protocol directly opts in WITHOUT the step. That limit
is stated in the console, in the participant-facing copy, and here. Do not represent it as
protocol-level consent.

Terms text is rendered as plain escaped text, never as HTML and never as a link.

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

nginx equivalent (with the participant advert SSE stream kept unbuffered; the
operator monitoring surface is polled snapshots now, not SSE, per ADR 0016):

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
        # Server-Sent Events (GET /v1/adverts) must not be buffered or a browsing
        # participant never sees live cohort adverts. (The operator console reads
        # polled snapshots over plain fetch, so it needs no SSE tuning, ADR 0016.)
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
server IP rate-limited. Throttle `POST /v1/terms/acceptance` too when you set
participation terms: it is the other anonymous endpoint worth limiting, because it
verifies a signature per request. Add a throttle at the proxy, e.g. nginx:

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
# {"network":"mutinynet","label":"Mutinynet (signet)","isMainnet":false,
#  "serviceName":"Acme aggregation","serviceDid":"did:btcr2:...","termsText":"..."}
```

The network fields are unconditional; the other three are ADDITIVE and each is
served only when the value exists. `serviceName` appears once you set
`SERVICE_NAME` (or the display name in the settings surface) and `termsText` once
you set participation terms, so both are absent on a default boot. `serviceDid` is
present for any service built by `createService`, which is every path this runbook
documents (the Docker image, compose, and the compiled entrypoint below), and is
absent only for a caller wiring the Hono app directly with no service DID. Probe
liveness on the response status, not on a fixed key set.

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `NETWORK` | `mutinynet` | Chain for the coordinator + browser. Unknown name fails at boot. |
| `PORT` | `8080` | Published port. |
| `HOST` | `0.0.0.0` (in image) | Bind address. The image sets `0.0.0.0`; the bare entrypoint defaults to `127.0.0.1`. |
| `LIVE` | unset | `1` = real esplora connection (resolve + tx proxy). Cohort co-sign stays fixture unless `BROADCAST=1`. |
| `BROADCAST` | unset | `1` = build + broadcast a REAL aggregate beacon tx per cohort. Requires `LIVE=1` (throws otherwise). |
| `ESPLORA_HOST` | registry default | Override the esplora REST host (needs `LIVE=1`). |
| `ALLOW_MAINNET` | unset | Required for `NETWORK=bitcoin`, even offline. |
| `RECOVERY_KEY` | unset | x-only recovery pubkey for funded cohorts. Required before funding (else keys are throwaway). |
| `FUNDING_WINDOW_MS` | `720000` (12m) | How long co-signing waits for a cohort beacon to be funded before it dead-ends (needs `BROADCAST=1`; must be < `PHASE_TIMEOUT_MS`). Also SEEDS `DEFAULT_FUNDING_WINDOW_MS` when that is unset, and is subject to the same whole-minute rule on that path. |
| `LIVE_CHANGE_ADDRESS` | beacon address | Route the beacon tx change to an operator wallet instead of the beacon address (needs `BROADCAST=1`). |
| `SERVICE_NAME` | unset | Display name shown in the operator console health strip and the public directory header. Plain escaped text, at most **200 characters**: a longer value is IGNORED at boot with a warning naming both lengths, and the name is left unset until you shorten it. Editable at runtime from the settings surface; a restart returns it to this value. |
| `DEFAULT_BEACON_TYPE` | `CASBeacon` | Beacon type a NEW cohort draft starts from (`CASBeacon` or `SMTBeacon`). Runtime-editable; a malformed value warns at boot and falls back. |
| `DEFAULT_SIZE` | `2` | Seats (n) a NEW cohort draft starts from. Must be a whole number: a fractional value warns at boot and falls back to the built-in default. Seeded from `MIN_PARTICIPANTS` when unset. Runtime-editable. |
| `DEFAULT_THRESHOLD` | same as `DEFAULT_SIZE` | Fallback signing threshold (k) a NEW cohort draft starts from; clamped to n. Must be a whole number: a fractional value warns at boot and falls back to n. Runtime-editable. |
| `DEFAULT_DISCOVERY_WINDOW_MS` | unset (seeded from `COHORT_TTL_MS`) | Discovery window a NEW cohort draft starts from, in ms, minimum 60000. Stored to the nearest WHOLE MINUTE at or below what you supply (the console edits this field in minutes), with a boot warning naming both numbers; a non-integer value warns and falls back. Can only SHORTEN a cohort relative to `COHORT_TTL_MS`: a value above it here is CLAMPED down to that maximum at boot with a warning naming both numbers, while a runtime save above it is REFUSED with the maximum named. A value that is BOTH over the maximum and not a whole minute gets both warnings, the whole-minute one first, each naming the value it actually acted on. Every one of these lines names the variables that can set this window, so nothing sends you looking for an internal field name. Runtime-editable. |
| `DEFAULT_FUNDING_WINDOW_MS` | unset (seeded from `FUNDING_WINDOW_MS`) | Per-cohort funding window a NEW cohort draft starts from, in ms, minimum 60000. Stored to the nearest WHOLE MINUTE at or below what you supply, with a boot warning naming both numbers; a non-integer value warns and falls back. Runtime-editable. |
| `TERMS_TEXT` | unset | Participation terms shown at join in the web app, at most **20000 characters** (roughly 3500 words). Set = a DID-signed acceptance is required to join through the web app (app-level enforcement only, see above). Empty = no terms step at all. A LONGER value is IGNORED at boot with a warning naming both lengths, and is never truncated to fit (participants would otherwise sign a mutilated document), so the join flow has no terms step until you shorten it. Runtime-editable. |
| `PHASE_TIMEOUT_MS` | (built-in default) | Per-phase stall budget. Under `BROADCAST=1` it must exceed `FUNDING_WINDOW_MS` (boot-validated). |
| `COHORT_TTL_MS` | (built-in default) | Overall wall-clock budget per cohort, from advertise to signing-complete. Also SEEDS `DEFAULT_DISCOVERY_WINDOW_MS` when that is unset (and supplies the shorten-only ceiling either way), so it is subject to the same whole-minute rule on that path: `COHORT_TTL_MS=90000` seeds a 1 min discovery default, with ONE boot warning, naming both numbers and naming `COHORT_TTL_MS` as a variable that sets the window. Setting this one variable never produces a second warning about a window you did not set. |
| `OPERATOR_PASSWORD` | unset | Operator console password (HOST-01, ADR 0015). Set it to enable the login-gated console + gated telemetry. Unset = fail-closed: public participant surface still serves, operator surface disabled with a loud boot warning. Keep it in a `.env` file, never bake it into the image. |
| `OPERATOR_SESSION_TTL_MS` | `86400000` (24h) | Operator session lifetime in ms. |
| `OPERATOR_COOKIE_SECURE` | on | Session cookie `Secure` flag. Leave on behind a TLS proxy; set `0` ONLY for a local plain-http run (else the browser drops the cookie). |
| `MIN_PARTICIPANTS` | `2` | FALLBACK seed for the seat count (n) a NEW cohort draft starts from, overridable per draft. `DEFAULT_SIZE` seeds the same thing and wins, and the compose file always sets it, so on the documented compose path this variable is fully shadowed. On the path where it is NOT shadowed it is subject to the same whole-number rule: `MIN_PARTICIPANTS=2.5` warns at boot and falls back to the built-in default. It does not decide what completes a cohort: that is the per-draft n the operator advertised. |
| `AUTO_FALLBACK` | on | `0` opts OUT of the ADR 042 k-of-n script-path fallback on a signing stall. Behavior-changing: with it off, a signing round stuck on a missing co-signer no longer recovers on its own and the operator must use `Finalize now` (or the cohort fails). Leave it on unless you want every anchor to be full n-of-n. |
| `SSE_DEBUG` | unset | `1` logs the participant advert SSE transport's per-connection activity. Diagnostics only; noisy, and it changes no behavior. |
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
