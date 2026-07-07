# ADR 0013: Regtest CI node - the automated live-path gate

- Status: Accepted
- Date: 2026-07-07
- Milestone: M3f (the last M3 item: M3-PLAN "regtest CI node for an automated live-path gate")

## Context

Every real-chain behavior in this repo was, until now, either mocked (the
hermetic gate's fixture/mock-esplora paths) or manual (`e2e:live:broadcast`,
which prints a beacon address and waits up to 30 minutes for an operator to fund
it). M3-PLAN's definition of done requires more: `pnpm e2e:resolve` must
broadcast a REAL beacon transaction on regtest in CI - both beacon types, both
onboarding models - and resolve the participant's DID document from it. The
`LIVE=1` branch of `e2e:resolve` was a print-only note, and the repo had no CI
workflow at all.

Constraints discovered up front:

1. **The app's entire chain surface is the esplora REST API** - `GET
   /blocks/tip/height`, `/address/:addr/{utxo,txs}`, `/tx/:txid[/hex]`, `POST
   /tx` - via `BitcoinConnection.rest`. Signal discovery
   (`BeaconSignalDiscovery.indexer`) string-matches the trailing vout's
   `scriptpubkey_asm` against `OP_RETURN OP_PUSHBYTES_32 <64 hex>`. A bare
   bitcoind JSON-RPC node cannot serve any of this; an esplora-fork electrs can
   (verified empirically on regtest: asm format, content types, `POST /tx`
   semantics all match).
2. **The KEY model double-publishes its first update on a real chain**: the
   singleton registration tx (ADR 0008) AND the aggregate beacon tx both carry
   material for the same update. ADR 0007's spike table recorded this as an
   error (`sourceHash !== currentDocumentHash`) - but that was observed under
   `method@0.45.0`, whose resolver restarted its version counter each discovery
   round. `method@0.51.0` threads `{currentVersionId, updateHashHistory}` across
   rounds: round 1 applies the update from the singleton signal, round 2
   resolves the aggregate signal to the byte-identical update and confirms it as
   a duplicate. **That ADR 0007 row is stale as of 0.51.0.** Two residues
   remain: the confirmed duplicate still increments the version counter (the
   resolved `metadata.versionId` reads 2 or 3 depending on indexing rounds), and
   the inflated counter means a LATER genuine update for that DID would trip
   `LATE_PUBLISHING` - the doubly-published DID must stay first-update-terminal.
3. **Funding must precede the run.** The live tx builder spends the deepest
   confirmed UTXO at the cohort beacon address (ADR 0010); the manual leg solves
   "the address is only known after keygen" with a throwaway LEARN cohort plus
   an operator. But `deriveCohortBeaconAddress` is pure over the roster (ADR
   0012) and a KEY member's cohort key IS its DID key (ADR 0006) - so when the
   e2e itself mints the member keys, the address is derivable and fundable
   BEFORE the cohort runs, for BOTH models. No LEARN pass, no mid-run race.
4. **pnpm 11's supply-chain verification re-applies `minimumReleaseAge` (default
   24h) to every lockfile entry on every install**, and this repo has observed
   `minimumReleaseAgeExclude` being honored asymmetrically (pnpm 11.4.0). A CI
   install would go red whenever any dep is <24h old, with zero code change.

## Decision

### 1. The live variant lives inside `e2e:resolve` (`LIVE=1`), regtest-default

`e2e/resolve-cohort.ts` keeps its four hermetic legs untouched and, under
`LIVE=1`, runs four LIVE legs: {KEY, BAKED} x {CAS, SMT}.

- **KEY**: pre-fund the pre-derived cohort beacon address; the cohort co-signs
  and broadcasts the real aggregate beacon tx; the member then funds its genesis
  P2TR and broadcasts the ADR 0008 singleton registration tx
  (`buildSingletonRegistrationTx`'s first end-to-end Node use). Both txs
  on-chain; resolution exercises the 0.51.0 duplicate-confirmation path.
  Assertions accept `versionId` 2 or 3 and pin document CONTENT (the appended
  beacon service at the real funded address).
- **BAKED**: the aggregate beacon is in the genesis (ADR 0012); one tx total;
  sidecar-less resolution at exactly `versionId` 2.
- Classic-x1 stays hermetic-only: its chain interaction at the beacon is
  identical to baked; what differs (sidecar genesis delivery via `POST
  /resolve`) is chain-independent and already pinned by `e2e:resolve` and
  `e2e:baked`.

Every leg resolves over the real HTTP `GET /resolve/:did` route against the same
injected live connection the service broadcast through - the strongest
end-to-end claim the app offers. Path-unique assertions (the anti-false-green
rule): the broadcast tx must spend one of the leg's own funded txids (never the
all-zero fixture prevout; a SET because the builder spends the DEEPEST confirmed
above-dust UTXO, which on an operator-funded address with history need not be
the payment that satisfied the funding poll), carry the cohort's real 32-byte
signal in its last vout, and read as confirmed via a direct esplora fetch that
is independent of the app's own `isConfirmed` polling.

On `LIVE_NETWORK=regtest` (the default) the run is fully self-contained via the
harness below. `LIVE_NETWORK=mutinynet` keeps the operator in the funding loop
(printed prompt + esplora poll) - the documented manual leg of the DoD. mainnet
is refused outright: this leg mints throwaway keys and burns fees.

### 2. A process-owned regtest harness, host binaries, no docker

`e2e/lib/regtest.ts` spawns a throwaway `bitcoind -regtest` (mkdtemp datadir,
ephemeral ports, `-txindex`) plus an esplora-fork `electrs` (`--http-addr`,
`--jsonrpc-import` to index via RPC and avoid the fresh-datadir blk-parsing
race), mines 101 blocks for a mature coinbase, and exposes: `fund(address,
sats)` (wallet send -> mine 1 -> wait until esplora serves the confirmed UTXO),
`mine(n)` (with index-sync wait), and an auto-miner (a block every ~1.5s) so the
app's OWN confirmation polling runs unmodified against real blocks. Binaries
resolve from PATH or `BITCOIND_EXEC`/`BITCOIN_CLI_EXEC`/`ELECTRS_EXEC`.

Rejected alternatives:

- **nigiri / chopsticks**: its proxy auto-mines a block on `POST /tx`, which
  would short-circuit the app's confirmation logic - a false-green by
  construction.
- **blockstream/esplora all-in-one image**: ~400 MB compressed, bundles its own
  bitcoind/nginx/tor, known regtest out-of-box issues.
- **romanz/electrs (incl. getumbrel images)**: Electrum protocol only, no
  esplora REST API - cannot serve this app at all.
- **cargo-building Blockstream electrs in CI**: 10-20 min cold (rocksdb) for no
  benefit over a 4.3 MB pinned prebuilt.

### 3. CI provisioning: SHA256-pinned downloads, BDK-precedented

`.github/workflows/ci.yml` (this repo's first workflow) runs two jobs:

- **hermetic**: the 16-check gate, byte-for-byte the local sequence. Job env
  sets NOTHING the legs read (no LIVE/NETWORK/IPFS/ALLOW_MAINNET/...): most e2e
  legs consume ambient env directly and a stray value would silently flip them
  onto other paths.
- **regtest-live**: provisions `bitcoind` from the official bitcoincore.org
  29.3 tarball and `electrs` from the RCasatta/electrsd `esplora_a33e97e1`
  prebuilt (the same 0.4.1-lineage Blockstream fork the dev machine runs; there
  are NO official Blockstream electrs binary releases). Both artifacts are
  SHA256-pinned in the workflow and cached; this exact combination is what BDK's
  ubuntu-latest CI pins, which also proves glibc compatibility. Then:
  `LIVE=1 LIVE_NETWORK=regtest pnpm e2e:resolve` - the DoD command, verbatim.

Both jobs install with `pnpm install --frozen-lockfile --trust-lockfile` and set
`pnpm_config_verify_deps_before_run=false` job-wide: the reviewed lockfile is
the trusted base, so the 24h `minimumReleaseAge` re-verification must not gate
CI (constraint 4). pnpm is pinned to 11.4.0 in the workflow (the repo pins no
`packageManager` field; pinning here keeps CI deterministic without changing
local behavior).

## Consequences

- The M3-PLAN definition of done is met and AUTOMATED: `pnpm e2e:resolve` under
  `LIVE=1` broadcasts real beacon txs on regtest in CI, both beacon types, both
  onboarding models, and resolves each document over real esplora. Locally,
  `pnpm e2e:live:regtest` runs the same gate in ~2 minutes with system
  binaries.
- The hermetic gate is unchanged (16 checks, zero chain access); the live gate
  is additive and opt-in.
- ADR 0007's "publish at both beacons -> error" spike row is superseded for
  `method >= 0.51.0` (duplicate confirmed cleanly; counter inflation noted
  above). Do not assert `versionId === '2'` for a doubly-published KEY first
  update, and never publish a SECOND update for such a DID - it becomes
  unresolvable (`LATE_PUBLISHING` against the inflated counter). A follow-up
  library issue may be warranted; until then this is load-bearing app knowledge.
- `e2e:live:broadcast` remains the operator-driven manual leg (mutinynet); its
  identities now correctly carry the run's network instead of the compile-time
  default (a latent bug this slice fixed).
- Bumping the pinned chain tooling is a one-line change per artifact in the
  workflow env block (`BITCOIN_CORE_VERSION`/`SHA256`, `ELECTRS_BUILD`/`SHA256`).
