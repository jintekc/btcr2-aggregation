# Phase 5 UAT: exact step-by-step procedures

Companion to `05-UAT.md`. One runnable procedure per checkpoint, authored against the real
components, routes and env vars, then adversarially audited for invented UI strings, wrong
commands, wrong routes, unrunnable steps and overclaims. Every quoted string carries a
`file:line` citation.

Generated 2026-07-30 by a 28-agent authoring plus audit plus critique pass. The cross-cutting
critique (boot consistency, ordering, unverified clauses, real-money danger review, and what
the whole suite still never exercises) is the final section and is worth reading first.

## Recommended order

Run **1 through 14, then 18, then 15, 16, 17**. Test 18 is hermetic and was sitting after
three live tests, which would force a hermetic boot in between two live ones.

Adjacency that helps: 3 then 9 then 12 share the fill-with-test-peers setup; 4 then 10 then
11 are the cancel chain; 2 then 7 share the settings surface; 5 then 15 both raise the TTL
knobs and both drive the participant chain-endpoint panel.

Every test boots its own service. No test may reuse the previous one's process: the env
differs materially between them, and since all state is in memory a fresh boot is a full
reset.

---

<a id="test-1"></a>

## Test 1: Cold Start Smoke Test

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (12 problem(s) found and corrected).

# Test 1: Cold Start Smoke Test

**Hermetic.** No `LIVE`, no `BROADCAST`, no chain I/O, no disk state. Everything below was executed
against this repo before publication except the browser-only observations, which were verified by
reading the components that render them.

**What this test is for:** kill any running coordinator, clear ephemeral state, boot the service
from scratch on the hermetic default, and confirm that the process boots clean, `GET /v1/config`
answers with the resolved network, the operator can sign in at `/operator`, the public directory
renders, and the 05-18 boot clamp warning names both numbers rather than failing silently.

---

## Preconditions

- Working directory for every command:
  `cd /home/jintek/projects/github/@jintekc/btcr2-aggregation`
- Node >= 22 and pnpm 11.4.0 on PATH. `curl`, `lsof` and `jq` available.
- No environment overrides in the shell you boot from. Check with:

  ```bash
  env | grep -E '^(ALLOW_MAINNET|AUTO_FALLBACK|BROADCAST|COHORT_TTL_MS|DEFAULT_|ESPLORA_HOST|FUNDING_WINDOW_MS|HOST|IPFS|LIVE|MIN_PARTICIPANTS|NETWORK|OPERATOR_|PHASE_TIMEOUT_MS|PORT|RECOVERY_KEY|SERVICE_NAME|SSE_DEBUG|TERMS_TEXT)=' \
    || echo 'no overrides in this shell'
  ```

  That list is the full set `packages/service/src/demo-server.ts` reads. `TERMS_TEXT` matters most:
  it adds a `termsText` key to `GET /v1/config` (`hono-adapter.ts:631-636`) and would make step 5
  read as a failure against a service that is behaving correctly.
- Port 8080 free (step 1 clears it).
- Two terminals plus a browser.
- Storage note, so you know what a reload does and does not reset: a repo-wide grep for
  `localStorage`, `sessionStorage` and zustand `persist(` over `packages/web/src` returns no hits,
  so the app itself stores nothing client-side. It does NOT follow that a reload is a cold client
  for the operator surface: a successful login sets an httpOnly session cookie at path `/` with
  `Max-Age` from `OPERATOR_SESSION_TTL_MS`, default 24h (`packages/service/src/operator-auth.ts:249-255`,
  `packages/service/src/index.ts:688`), so a reload stays signed in. A service RESTART does reset it,
  because the session store is per-`createService` and in memory (`packages/service/src/index.ts:691`).

---

## Steps

### 1. Free port 8080

```bash
pkill -f "packages/service/src/demo-server.ts" || true
lsof -i :8080 -sTCP:LISTEN -P -n || echo "8080 free"
```

**Look for:** the second command prints exactly `8080 free` and no LISTEN row.

**Caution:** that `pkill` pattern is machine-wide and will kill every demo-server on this host, not
only the one on 8080. If you have another coordinator running on another port, kill by PID instead:
`kill $(lsof -t -i :8080 -sTCP:LISTEN)`.

If a LISTEN row remains, something else owns 8080 and every later step measures the wrong process.

### 2. Confirm there is no on-disk state to clear

```bash
env | grep -E '^(IPFS|IPFS_DIR|IPFS_ANNOUNCE)=' || echo 'ipfs off'
```

**Look for:** `ipfs off`.

On the hermetic default there is nothing else to clear, and killing the process in step 1 IS the
state clear. The artifact store is in memory (`packages/service/src/demo-server.ts:292` constructs
`MemoryArtifactStore`; the only disk-backed store in the repo, `FileSystemArtifactStore` at
`packages/service/src/store.ts:157-158`, is never constructed by `demo-server.ts`). Runtime settings
have no write path at all, and `runtime-settings.ts` says so at its own head and pins the absence in
its spec. The only on-disk state a boot can create is an IPFS data directory, and that requires both
`IPFS=1` and `IPFS_DIR` (`demo-server.ts:463-467`); with `IPFS_DIR` unset the node is in memory.

### 3. Build the workspace

```bash
pnpm -r build
```

**Look for:** `packages/shared build: Done`, `packages/participant build: Done`,
`packages/service build: Done`, and for web a vite section that lists `dist/index.html` plus hashed
`dist/assets/*.css` and `dist/assets/*.js`, ending in `packages/web build: Done`. No TypeScript
errors. A `(!) Some chunks are larger than 500 kB after minification.` warning from the web build is
expected and is not a failure.

This step is technically redundant (`pnpm demo` runs `pnpm -r build` first, see `package.json`
`scripts.demo`), but running it separately lets you read the build result without it scrolling past
under the boot output.

### 4. Boot the hermetic default

In terminal A:

```bash
OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" pnpm demo
```

**Look for:** after the build output, exactly these two lines and nothing else:

```
[demo] service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))
[demo] idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)
```

No stack trace, no `[demo] !!! OPERATOR CONSOLE DISABLED !!!` banner, no `[settings]` line.
`web served` (not `web not served`) confirms the SPA is being served from this same port.
Source: `packages/service/src/demo-server.ts:531-539`.

### 5. Read the resolved network

In terminal B:

```bash
curl -s http://127.0.0.1:8080/v1/config | jq .
```

**Look for:** exactly these five keys, in this order:

```json
{
  "network": "mutinynet",
  "label": "Mutinynet (signet)",
  "isMainnet": false,
  "serviceName": "Phase 5 check",
  "serviceDid": "did:btcr2:k1q..."
}
```

The `serviceDid` value differs on every boot (a fresh identity per process, `demo-server.ts` passes
`createIdentity(net)` into `createService`) and that is expected; only the `did:btcr2:k1` prefix is
asserted. The `network` / `label` / `isMainnet` trio is the resolved-network claim under test
(`packages/shared/src/networks.ts:115-120,199-201`). A sixth `termsText` key means `TERMS_TEXT` is
exported in your shell, not a defect: go back to the preconditions.

### 6. Read the public status and directory

```bash
curl -s http://127.0.0.1:8080/v1/status; echo; curl -s http://127.0.0.1:8080/v1/directory; echo
```

**Look for:** exactly

```
{"up":true,"network":"mutinynet","openCohorts":0,"paused":false}
[]
```

`openCohorts: 0` and an empty directory are correct: this service advertises nothing on its own
(`demo-server.ts:255-259`; routes at `hono-adapter.ts:647,652-663`).

### 7. Load the participant page

Open `http://localhost:8080` in the browser. The service binds `127.0.0.1` only, so `localhost`
works via the browser's IPv6-to-IPv4 fallback; use `http://127.0.0.1:8080` if your browser will not
connect.

**Look for, top to bottom:**

- App header: the heading `did:btcr2 aggregation` (`packages/web/src/App.tsx:80`), the subtitle
  `Browse this service's open cohorts and pick one to join and co-sign.` (`App.tsx:85`, plain ASCII
  apostrophe in the source), and a chip reading `Mutinynet (signet) · key-path Taproot`
  (`App.tsx:106`; the separator is a middot).
- A card showing `Phase 5 check` above a large heading that is the origin you typed
  (`localhost:8080` if you used localhost, `127.0.0.1:8080` if you used the IP: it renders
  `window.location.host`, `ServiceIdentityHeader.tsx:48-49`), a chip reading `Mutinynet (signet)`
  (`:58`), a green pulsing dot beside `Service online` (`:63-64`), and `No open cohorts right now`
  (`:33`).
- A second card: `No open cohorts right now` over
  `This service isn't advertising any cohorts right now. Check back soon.`
  (`DirectoryList.tsx:26,29,152-155`; both use plain ASCII apostrophes).

### 8. Check the console and network tabs

Open devtools (Console and Network), then reload the page.

**Look for:** no uncaught exceptions in Console. Network shows 200 for `/v1/config`, `/v1/status`,
`/v1/directory` and `/v1/ipfs` (the last is probed in parallel with the config read,
`stores/participant.ts:1530` and `lib/ipfs.ts:35`; it answers `{"enabled":false}` on this boot), plus
200 for `index.html` and the hashed JS/CSS assets. `/v1/status` and `/v1/directory` repeat on a poll
(10s and 5s respectively, `BrowseView.tsx:12`, `DirectoryList.tsx:7`); that is expected.

A 404 or 500 on any of those reads, or a red uncaught error, is a boot failure even though the page
rendered.

### 9. Load the operator route

Navigate to `http://localhost:8080/operator`.

**Look for:** briefly a card reading `Checking session…` while the `GET /v1/operator/session` probe
is in flight (`OperatorConsole.tsx:43-45,71-77`), then a login card with:

- heading `Operator console` (`LoginPanel.tsx:25`),
- body `Sign in with this service’s operator password to create and advertise cohorts.`
  (`LoginPanel.tsx:26-28`; the source uses `&rsquo;`, so the apostrophe renders curly),
- one field whose label text is `Operator password` (`LoginPanel.tsx:36`), rendered uppercase by the
  shared `Field` primitive (`ui/primitives.tsx:245-250`), so it reads OPERATOR PASSWORD on screen,
- a full-width `Sign in` button (`LoginPanel.tsx:50`) that stays disabled until you type something
  (`:49`).

The page is served by the SPA catch-all (`static-site.ts:57-92`, which 404s only `/v1/` and
`/dashboard/` prefixes), so it must NOT 404. Verified: `GET /operator` returns 200.

### 10. Reject a wrong password

Type `nope` and press the sign-in button.

**Look for:** a red inline message reading exactly
`Incorrect password. Check the operator password set for this service and try again.`
(`stores/operator.ts:80-81`, rendered at `LoginPanel.tsx:46-48`). You stay on the login card.

In terminal A, on **stderr** (`console.warn`, `operator-auth.ts:245`):

```
[operator] failed login attempt from 127.0.0.1
```

You will also already see one or more `[operator] denied GET /v1/operator/session: no valid session`
lines on stderr from the anonymous session probe (`operator-auth.ts:168`). Those are expected, not
failures. The `from 127.0.0.1` value is the socket's remote address (`operator-auth.ts:153-155`) and
reads that way because the service binds IPv4 loopback.

### 11. Sign in

Type `phase5` and press the sign-in button.

**Look for:** in terminal A, on **stdout** (`console.log`, `operator-auth.ts:257`):

```
[operator] login succeeded from 127.0.0.1
```

Then the console renders, top to bottom:

**Health strip** (`HealthStrip.tsx:92-145`), one wrapping chip row:

- first badge reads `Checking mode` (`:94`) until the first list read returns. Sign-in fires that
  read immediately (`stores/operator.ts:755`), so on loopback it flips to `Hermetic` (`:9`) almost at
  once; if the first read fails, the next attempt is 4s later (`OperatorConsole.tsx:13`).
- `Phase 5 check` as plain text (`:104`),
- a `Mutinynet (signet)` chip (`:113`),
- an `IPFS off` badge (`:139`),
- a right-aligned freshness label whose source text is `Connecting` and then `Updated {n}s ago`
  (`:88-90`), rendered uppercase by its span (`:143`), so it reads CONNECTING then UPDATED 0S AGO and
  counts up.

There must be NO `Esplora reachable` / `Esplora unreachable` badge: that chip renders only on a live
mode (`:119-123`).

**Service controls card** (`ServiceControls.tsx:209-332`):

- a section heading whose source text is `Service controls` (`:212`), rendered uppercase by
  `SectionTitle` (`ui/primitives.tsx:31-35`),
- the line `New cohorts are being advertised normally.` (`stores/operator.ts:119`),
- a `Pause advertising` button (`ServiceControls.tsx:27`),
- a `Service settings` button (`ServiceControls.tsx:38`),
- the line `Pause, broadcast, and settings changes live in memory for this session. A restart returns
  this service to its boot environment.` (`stores/operator.ts:141-142`),
- the line `Pausing does not end cohorts that are already open. Cancel each one if you need this
  service fully quiet.` (`stores/operator.ts:149-150`, rendered at `ServiceControls.tsx:299`),
- an `Operator actions` section (`stores/operator.ts:285`, uppercase via `SectionTitle`) showing
  `Checking operator actions` (`:294`) before the first read, then `No operator actions this session.`
  (`:286`) over `Actions you take here, like pausing advertising or canceling a cohort, are listed as
  you take them. This service keeps them in memory, so a restart clears them.` (`:287-288`).

There must be NO broadcast kill-switch button: it renders only on the served `live` mode
(`ServiceControls.tsx:128-136`).

**List view** (`OperatorConsole.tsx:122-175`, `OperatorCohortList.tsx:338-361`):

- heading `Operator console` (`OperatorConsole.tsx:130`),
- a `Sign out` button (`:133`),
- a `New cohort` button (`:146`),
- a `View the public directory` link (`:159`),
- a four-cell metrics row reading `0` above each of four captions whose source text is `open`,
  `in flight`, `anchored`, `failed` (`OperatorCohortList.tsx:68-71`), rendered uppercase by
  `SectionTitle` (`:78`),
- the empty state `No cohorts yet` (`:356`) over `Create a cohort to advertise it into this
  service’s directory. This service keeps cohort state in memory, so a restart clears it.`
  (`:357-360`; the source uses `&rsquo;`, so the apostrophe renders curly).

### 12. Shut down

Press Ctrl+C in terminal A.

**Look for:** the process exits within about 3 seconds (a forced-exit backstop is armed at
`demo-server.ts:590`). Then:

```bash
lsof -i :8080 -sTCP:LISTEN -P -n || echo "8080 free"
```

expects `8080 free`.

### 13. Boot with an over-ceiling discovery-window seed (the 05-18 clamp)

One hour, against this service's 30-minute cohort TTL (`DEFAULT_COHORT_TTL_MS = 1_800_000`,
`demo-server.ts:47`):

```bash
OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" \
  DEFAULT_DISCOVERY_WINDOW_MS=3600000 pnpm demo
```

**Look for:** before the two `[demo]` lines, exactly this one line, on **stderr** with a `[settings]`
prefix rather than a `[demo]` prefix:

```
[settings] defaultDiscoveryWindowMs=3600000 exceeds this service's cohort TTL; using 1800000 instead, the longest discovery window this service can enforce
```

Both numbers are named, in the milliseconds you supplied (`runtime-settings.ts:378-385`; the
`[settings]` prefix at `:302`; the ceiling seeded from `cohortTtlMs` at `index.ts:680`). The service
then boots normally and keeps listening. A refusal to boot, a crash, or a silent boot with no warning
are all failures.

Verified live: this exact line, on stderr, followed by the normal two-line boot on stdout.

### 14. Confirm the clamped value is what the gated read serves

In terminal B:

```bash
rm -f /tmp/op.jar && curl -s -c /tmp/op.jar -X POST http://127.0.0.1:8080/v1/operator/login \
  -H 'content-type: application/json' -d '{"password":"phase5"}' && echo && \
  curl -s -b /tmp/op.jar http://127.0.0.1:8080/v1/operator/settings | jq '.defaultDiscoveryWindowMs'
```

**Look for:** `{"ok":true}` then

```json
{
  "value": 1800000,
  "envDefault": 1800000,
  "changed": false
}
```

Both halves are the clamped number, so the console's `env default` caption names a window this
service can actually enforce (`hono-adapter.ts:897`, snapshot shape at `runtime-settings.ts:151-159`).
A `value` or `envDefault` of `3600000` means the clamp did not apply.

**Honest scope of this check:** it is only meaningful in combination with step 13. A boot with no
`DEFAULT_DISCOVERY_WINDOW_MS` set at all serves the identical `1800000 / 1800000 / false`, because
the seed falls back to `cohortTtlMs` (`index.ts:674`). So this read distinguishes "clamped" from
"stored raw at 3600000", but it cannot by itself distinguish "clamped" from "the env var was never
read". Step 13's warning is what proves the value was read.

`OPERATOR_COOKIE_SECURE=0` is load-bearing here: without it the session cookie is issued `Secure`
and curl will not send it back over plain http.

### 15. Optional, same family of guard: a malformed value

Ctrl+C, then:

```bash
OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 DEFAULT_DISCOVERY_WINDOW_MS=12m pnpm demo
```

**Look for:** on **stdout**, before the listening line:

```
[demo] ignoring malformed DEFAULT_DISCOVERY_WINDOW_MS="12m"; using the built-in default
```

then a normal boot (`runtime-settings.ts:89`, reached via `demo-server.ts:418-423`). No `NaN`
anywhere, no crash. Verified live.

### 16. Fail-closed variant: no operator password

Ctrl+C, then:

```bash
pnpm demo
```

**Look for:** in terminal A, on stdout:

```
[demo] !!! OPERATOR CONSOLE DISABLED !!!
[demo]   - no OPERATOR_PASSWORD set at boot; the public participant surface still serves
[demo]   - the operator console, mutating cohort routes, and gated monitoring are OFF
[demo]   - set OPERATOR_PASSWORD (and restart) to enable operator sign-in
[demo] service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))
[demo] idle; set OPERATOR_PASSWORD to enable the operator console and advertise cohorts
```

(`demo-server.ts:446-451,531-539`.)

Then in terminal B:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/v1/operator/cohorts
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/v1/operator/session
curl -s http://127.0.0.1:8080/v1/status; echo
```

**Look for:** `404`, `404`, then `{"up":true,"network":"mutinynet","openCohorts":0,"paused":false}`.
The 404 (rather than 401) is the point: the whole operator block is unmounted
(`hono-adapter.ts:823`), and the SPA catch-all refuses to shadow `/v1/` paths
(`static-site.ts:60-63`). Verified live: body `not found`.

In the browser, `http://localhost:8080/operator` renders a card headed `Operator console is disabled`
over `This service booted without an operator password, so the console is turned off. Set
OPERATOR_PASSWORD and restart the service to enable operator sign-in.`
(`OperatorConsole.tsx:79-89`; the store reaches that state from the 404 on the session probe,
`lib/operator.ts:50-60`, `stores/operator.ts:759`).

Stop the service when done.

---

## Pass

- Step 4 produces exactly the two `[demo]` lines with `web served`, no stack trace, no fail-closed
  banner, no `[settings]` line.
- Step 5: `GET /v1/config` returns `network` `mutinynet`, `label` `Mutinynet (signet)`,
  `isMainnet` `false`, `serviceName` `Phase 5 check`, and a `serviceDid` beginning `did:btcr2:k1`.
- Step 6: `GET /v1/status` returns `{"up":true,"network":"mutinynet","openCohorts":0,"paused":false}`
  and `GET /v1/directory` returns `[]`.
- Steps 7 and 8: the participant page renders the service name, the origin heading, `Service online`,
  and the idle empty-state pair verbatim, with no console errors and 200s on `/v1/config`,
  `/v1/status`, `/v1/directory` and `/v1/ipfs`.
- Steps 9 to 11: a wrong password is refused with the exact copy, and a correct password lands on the
  console with the `Hermetic` mode badge, the `Mutinynet (signet)` chip, the `IPFS off` badge, the
  metrics row at all zeros, and the `No cohorts yet` empty state.
- Steps 13 and 14: the over-ceiling seed produces the single `[settings]` warning naming BOTH
  `3600000` and `1800000`, the service still boots, and the gated settings read shows `1800000` in
  both `value` and `envDefault`.
- Step 16: with no `OPERATOR_PASSWORD` the four-line banner prints, `/v1/operator/cohorts` and
  `/v1/operator/session` are 404, `/v1/status` still answers, and `/operator` renders the disabled
  card.

## Fail signals

- Any stack trace, unhandled rejection, or non-zero exit during boot.
- `web not served` in the listening line: the SPA was not built, so every browser step is invalid.
- `/v1/config` missing `network`, or reporting a network other than `mutinynet` with no `NETWORK`
  override set. (An extra `termsText` key is an exported `TERMS_TEXT`, not a defect.)
- The mode badge stuck on `Checking mode` for more than a few seconds, or reading `Live` or
  `Live (no broadcast)` on this boot.
- An `Esplora reachable` or `Esplora unreachable` badge visible on the hermetic boot, or a
  broadcast kill-switch button on the Service controls card.
- Booting with `DEFAULT_DISCOVERY_WINDOW_MS=3600000` exits non-zero, OR boots with no `[settings]`
  line at all, OR emits a warning that names only one of the two numbers.
- The gated settings read shows `defaultDiscoveryWindowMs.value` or `.envDefault` as `3600000` after
  the clamp warning.
- With no `OPERATOR_PASSWORD`: `/v1/operator/cohorts` answers anything other than 404, or `/operator`
  renders a login form instead of the disabled card.

## Limits

This is a loopback `pnpm demo` boot on the hermetic fixture path, so it proves nothing about the LIVE
esplora connection, the BROADCAST path, mainnet guard rails, or any real Bitcoin behavior; nothing
about the Docker image, `HOST=0.0.0.0` binding, TLS termination, or the reverse-proxy deployment in
`docs/DEPLOY.md`; nothing about the `Secure` session-cookie path, since `OPERATOR_COOKIE_SECURE=0` is
used throughout for plain http; and nothing about the cohort lifecycle (advertise, join, co-sign,
anchor, resolve), none of which is exercised here. Durability is out of scope by design: nothing is
persisted. The clamp check is reached only because step 13 deliberately sets an over-ceiling seed, and
step 14 alone cannot prove the clamp (see the note in that step), so a passing default boot says
nothing about it. The clamp warning is emitted on stderr via `console.warn`, so an operator who
redirects only stdout will not see it; that is a real property of this boot, not a step failure.

---

<a id="test-2"></a>

## Test 2: Draft creation, in-place edit, and per-cohort timing windows

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (8 problem(s) found and corrected).

# Test 2: Draft creation, in-place edit, and per-cohort timing windows

**Mode:** hermetic (no `LIVE`, no `BROADCAST`). No wallet, no chain, no funds.

## Preconditions

- Working directory: `/home/jintek/projects/github/@jintekc/btcr2-aggregation`. Every command below is run from there.
- Port 8080 free. Copy-paste this (it does not depend on `lsof` being installed):

  ```bash
  pkill -f "packages/service/src/demo-server.ts" || true
  curl -s -o /dev/null -m 2 http://127.0.0.1:8080/v1/config && echo "STILL LISTENING on 8080" || echo "8080 free"
  ```

- Boot exactly this in terminal A (`pnpm demo` runs `pnpm -r build` first, so no separate build step is needed):

  ```bash
  OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" pnpm demo
  ```

- Do NOT set `COHORT_TTL_MS`, `DEFAULT_DISCOVERY_WINDOW_MS`, or `AUTO_FALLBACK`:
  - `COHORT_TTL_MS` moves the ceiling this test reads back (default 1 800 000 ms = 30 min, `demo-server.ts:47`), and the runtime discovery default falls back to it (`index.ts:674`), so both the caption figure and the refusal figure are 30 minutes on this boot.
  - `AUTO_FALLBACK=0` would make every k < n draft refuse first, with a different message (`operator-cohorts.ts:143-144`, thrown at `:709-711`), and steps 10 and 11 both use k=2 of n=3. The boot default is ON (`demo-server.ts:274`).
- Terminal B is for `curl`. These calls send no `Origin` or `Referer` header, so the same-origin guard (`operator-auth.ts:184-205`) does not apply to them; that guard is only exercised by the in-browser saves in this same test.
- Case note: the console transforms several strings to uppercase in CSS, so compare words and not letter case. Section titles and group headings (`Create a cohort`, `Edit draft`, `Drafts`, `Active`, `Service controls`) come from `SectionTitle` (`ui/primitives.tsx:31-35`); the `Advanced timing` expander row is uppercase (`ui/primitives.tsx:51`); the copy-field label `draft id` / `cohort id` is uppercase (`ui/primitives.tsx:432`); the settings source caption is uppercase (`SettingsView.tsx:376`). Everything else on this test renders as written.

## Steps

**1. Sign in, both in the browser and on the wire.**
Open `http://127.0.0.1:8080/operator`, enter the password `phase5` in the `Operator password` field and press `Sign in` (`LoginPanel.tsx:36,50`). In terminal B:

```bash
rm -f /tmp/op.jar && curl -s -c /tmp/op.jar -X POST http://127.0.0.1:8080/v1/operator/login \
  -H 'content-type: application/json' -d '{"password":"phase5"}'
```

Look for: browser shows the `Hermetic` mode chip (`HealthStrip.tsx:9`; it reads `Checking mode` for the instant before the first gated read lands) and the `No cohorts yet` empty state (`OperatorCohortList.tsx:356`). Terminal B prints `{"ok":true}` (`operator-auth.ts:258`).

**2. Read this service's current timing defaults.**

```bash
curl -s -b /tmp/op.jar http://127.0.0.1:8080/v1/operator/cohorts | jq '.defaults'
```

Look for: `discoveryWindowMs` 1800000 and `fundingWindowMs` 720000. These are the only figures the create form's help is allowed to name (`hono-adapter.ts:1107-1119`). 1800000 ms is 30 min.

**3. Open the create form and its timing expander.**
Click `New cohort` (`OperatorConsole.tsx:147`), then click `Show` on the `Advanced timing` row (`ui/primitives.tsx:54`, `DraftEditForm.tsx:71`).

Look for: a card titled `Create a cohort` with a read-only `Network: mutinynet` badge (`CreateCohortForm.tsx:128-129`), `Beacon type` showing `CAS`, `Signing threshold (k)` = 2, `Cohort size (n)` = 2 (`CreateCohortForm.tsx:139,150,164`). Inside the expander: exactly ONE field, `Discovery window (minutes)`, EMPTY, captioned `How long this cohort stays advertised before it expires. Leave it empty to use this service's default of 30 min.` (`lib/cohort-form.ts:84-89`). There is deliberately no `Funding window (minutes)` field: it renders only when the served mode is `live` (`DraftEditForm.tsx:58,84-96`), and this boot is hermetic.

**4. Create the draft with the timing field left empty.**
Leave both numbers at 2 and the window EMPTY. Click `Create draft` (`CreateCohortForm.tsx:195`).

Look for: a row under the `Drafts` heading (`OperatorCohortList.tsx:35-40`) carrying a `Draft` chip (`lib/operator-rows.ts:110`), `mutinynet`, `CAS`, `0/2 seats`, `Co-sign: 2-of-2` (`OperatorCohortList.tsx:165-172`, `lib/directory.ts:163-165`), a copy field labelled `draft id` (`OperatorCohortList.tsx:244`), and three buttons: `Advertise cohort`, `Edit draft`, `Discard draft` (`OperatorCohortList.tsx:184,193,197`). Copy the draft id; call it ID. The create form stays open behind the list; that is expected and is used in step 8.

**5. Wire check: empty is an ABSENT key, never a 0.**

```bash
curl -s -b /tmp/op.jar http://127.0.0.1:8080/v1/operator/cohorts | jq '.cohorts[0]'
curl -s -b /tmp/op.jar http://127.0.0.1:8080/v1/operator/cohorts | jq '.cohorts[0] | has("discoveryWindowMs")'
```

Look for: the object carries `"defaultDiscoveryWindowMs": 1800000` and `"defaultFundingWindowMs": 720000` and NO `discoveryWindowMs` key; the second command prints `false` (`operator-cohorts.ts:787-794`). A `"discoveryWindowMs": 0` here is the exact defect this step exists to catch.

**6. Open the in-place edit form.**
Click `Edit draft` on that row, then open its `Advanced timing`.

Look for: an `Edit draft` card mounted INSIDE the row, with the chip, the seats and the draft id still visible above it (`OperatorCohortList.tsx:249`). Pre-filled: `Beacon type` CAS, `Signing threshold (k)` 2, `Cohort size (n)` 2 (`DraftEditForm.tsx:126-130,172,184,192`). The discovery field is EMPTY with the same caption naming `30 min`, sourced from this draft's OWN captured defaults (`DraftEditForm.tsx:207-208`). The row's `Advertise cohort` / `Edit draft` / `Discard draft` group is gone while editing (`OperatorCohortList.tsx:177`). Below the fields: `Applies to new cohorts only. A cohort that is already advertised keeps the shape it was advertised with.` (`stores/operator.ts:63-64`) and the two buttons `Save changes` and `Cancel edit` (`DraftEditForm.tsx:222,225`).

**7. k greater than n on the EDIT path.**
Leave `Cohort size (n)` at 2, set `Signing threshold (k)` to 5, click `Save changes`.

Look for: a red inline message inside the edit card reading exactly `Signing threshold must be a whole number between 1 and the cohort size.` (`lib/cohort-form.ts:34`). The form stays open, the row above still reads `0/2 seats` and `Co-sign: 2-of-2`, and terminal A logs NO `[operator] updated draft` line (`operator-cohorts.ts:1252`).

**8. The same input on the CREATE path.**
Click `Cancel edit`. The create form from step 3 is still on screen (creating a draft does not dismiss it, and the `New cohort` button is hidden while it is open, `OperatorConsole.tsx:145-151`), so type into that form: `Signing threshold (k)` 5 with `Cohort size (n)` 2, then click `Create draft`.

Look for: the SAME message, byte for byte, `Signing threshold must be a whole number between 1 and the cohort size.` Both forms call one shared validator (`lib/cohort-form.ts:127-146`), so a differently worded message on either path is a failure. No second draft row appears. Now dismiss the create form with the `Cancel` button below it (`OperatorConsole.tsx:166-168`).

**9. Wire confirmation of the same parity (substitute your ID).**

```bash
curl -s -b /tmp/op.jar -X POST http://127.0.0.1:8080/v1/operator/cohorts \
  -H 'content-type: application/json' -d '{"beaconType":"CASBeacon","size":2,"threshold":5}' ; echo
curl -s -w ' [%{http_code}]\n' -b /tmp/op.jar -X PATCH http://127.0.0.1:8080/v1/operator/cohorts/ID \
  -H 'content-type: application/json' -d '{"beaconType":"CASBeacon","size":2,"threshold":5}'
```

Look for: both print `{"error":"Signing threshold must be a whole number between 1 and the cohort size."}` and the PATCH reports `[400]` (`hono-adapter.ts:1060-1067` and `:1148-1152`, one validator at `operator-cohorts.ts:681-735`).

**10. A discovery window above the ceiling is refused at save.**
Click `Edit draft`, open `Advanced timing`, set `Cohort size (n)` 3, `Signing threshold (k)` 2, `Beacon type` `SMT`, and type `31` into `Discovery window (minutes)`. Click `Save changes`.

Look for: the button reads `Saving…` briefly, then a red inline message in the SAME slot reading exactly `This service ends a cohort after 30 minutes, so the discovery window must be 30 minutes or less.` (`operator-cohorts.ts:172-175`, thrown at `:725-733`). This message comes from the SERVER: the browser deliberately does not judge this ceiling (`lib/cohort-form.ts:118-126`). The form stays open and the row above is unchanged (`0/2 seats`, `CAS`).

**11. A window inside the ceiling saves in place.**
Change the window from 31 to 5, leaving size 3 / threshold 2 / SMT. Click `Save changes`.

Look for: the edit form CLOSES and the row re-renders from the service (`stores/operator.ts:934-938`): `SMT`, `0/3 seats`, `Co-sign: 2-of-3`, plus the caption `all co-sign; anchors if at least 2 of 3 sign` (`lib/directory.ts:172-177`). The `draft id` is the SAME ID as before, because an edit replaces under the same key (`operator-cohorts.ts:1249-1251`). Terminal A logs `[operator] updated draft <ID> (SMTBeacon 2-of-3)`.

**12. The saved window round-trips as minutes.**
Click `Edit draft` again and open `Advanced timing`.

Look for: `Discovery window (minutes)` shows `5`, `Cohort size (n)` 3, `Signing threshold (k)` 2, `Beacon type` SMT (`lib/cohort-form.ts:64-66`). Not `300000`.

**13. Clearing the field round-trips as empty, not zero.**
Select all in `Discovery window (minutes)`, delete, click `Save changes`. Click `Edit draft` again and reopen `Advanced timing`. Then in terminal B:

```bash
curl -s -b /tmp/op.jar http://127.0.0.1:8080/v1/operator/cohorts | jq '.cohorts[0]'
curl -s -b /tmp/op.jar http://127.0.0.1:8080/v1/operator/cohorts | jq '.cohorts[0] | has("discoveryWindowMs")'
```

Look for: the field is EMPTY again, not `0`. On the wire there is no `discoveryWindowMs` key (`has(...)` prints `false`), only `defaultDiscoveryWindowMs` (`lib/cohort-form.ts:152-160`, `operator-cohorts.ts:787-794`). Leave the edit form open for the next step.

**14. `Cancel edit` destroys nothing.**
With the edit form open, change `Cohort size (n)` to 9, then click `Cancel edit`.

Look for: the form closes with NO request sent (`stores/operator.ts:922-926`), the row still reads `0/3 seats` and `Co-sign: 2-of-3` with the SAME draft id, and the draft is still listed under `Drafts`. Discarding remains the separate red `Discard draft` button. Re-run the terminal B list read and confirm `capacity` is still 3.

**15. Captured defaults versus current defaults.**
Click `Service settings` on the `Service controls` card (`ServiceControls.tsx:38,229-231`). Set `Default discovery window (minutes)` to 10 (`SettingsView.tsx:290`) and click `Save settings` (`SettingsView.tsx:21`). Read the screen BEFORE navigating away: the green line `Settings updated for this session.` (`stores/operator.ts:188`) clears itself after about 4 seconds (`stores/operator.ts:1201-1205`), and the discovery field's source caption must now read `changed this session (environment default: 30 min)` (`SettingsView.tsx:43-45,53-55`). Then click `Back to cohorts` (`SettingsView.tsx:196`). Click `Edit draft` on the existing draft and open `Advanced timing`; then, WITHOUT saving, click `Cancel edit`, click `New cohort`, and open that form's `Advanced timing`.

Look for: the EXISTING draft's edit form still says `Leave it empty to use this service's default of 30 min.` (its own captured defaults, `DraftEditForm.tsx:207-208`), while the NEW create form says `Leave it empty to use this service's default of 10 min.` (this service's current defaults, `CreateCohortForm.tsx:183-184`). The create form's figure arrives with the next gated list read, so allow one 4 second poll tick (`OperatorConsole.tsx:13,51-57`). Honest note: saving that edit form would RE-CAPTURE the current defaults into the draft (`operator-cohorts.ts:1235-1238`), so do not save if you want to repeat this comparison.

**16. Next-cohort-only, once the cohort is public.**
Dismiss the create form with `Cancel`. On the draft row click `Advertise cohort`. You land in the new cohort's drill-down (`stores/operator.ts:958-963`); click `Back to cohorts` (`CohortDetail.tsx:339-340`). Then in terminal B, substituting the ID you captured in step 4:

```bash
curl -s -w ' [%{http_code}]\n' -b /tmp/op.jar -X PATCH http://127.0.0.1:8080/v1/operator/cohorts/ID \
  -H 'content-type: application/json' -d '{"beaconType":"CASBeacon","size":2,"threshold":2}'
curl -s -w ' [%{http_code}]\n' -b /tmp/op.jar -X PATCH http://127.0.0.1:8080/v1/operator/cohorts/does-not-exist \
  -H 'content-type: application/json' -d '{"beaconType":"CASBeacon","size":2,"threshold":2}'
```

Look for: the row is now under `Active` with no `Edit draft` button, and instead the line `Only a draft can be edited. This cohort is already advertised.` (`stores/operator.ts:71`, rendered on advertised rows only at `OperatorCohortList.tsx:206`). Its copy field is now labelled `cohort id` and carries a DIFFERENT id than the draft did, because advertising deletes the draft and the library mints a fresh cohort id (`operator-cohorts.ts:1272-1290`). Both curl calls print `{"error":"unknown draft"} [404]`: the lookup runs before validation, so a non-draft id is a 404 rather than a validation verdict (`operator-cohorts.ts:1213-1215`, `hono-adapter.ts:1148-1150`). Stop the service in terminal A when finished.

## Pass

- A draft created with the timing field left empty carries no `discoveryWindowMs` key on the gated read, both at creation and after a clear-and-save; `has("discoveryWindowMs")` prints `false` in steps 5 and 13.
- The edit form opens pre-filled on every field from the draft's own served values, and its help names the draft's captured default (30 min) rather than the service default that was changed afterwards (steps 6 and 15).
- k greater than n is refused with the identical string on both the create and the edit path, client-side, with nothing saved (steps 7, 8, 9).
- A 31 minute discovery window is refused at save with `This service ends a cohort after 30 minutes, so the discovery window must be 30 minutes or less.` and the draft is left unchanged (step 10).
- A 5 minute window saves, closes the form, updates the row in place under the same draft id, and reads back as `5` (steps 11 and 12).
- `Cancel edit` closes the form and changes nothing: same size, same threshold, same draft id, draft still present (step 14).
- An advertised cohort offers no edit control and states the reason; PATCH on the old draft id and on an unknown id both answer 404 `unknown draft` (step 16).

## Fail signals

- `"discoveryWindowMs": 0` or a null appearing on a draft whose timing field was left empty or cleared, or `has("discoveryWindowMs")` printing `true`.
- The edit form opening blank, or with any field missing its current value.
- Different wording, or a different first problem, between the create form and the edit form for the same invalid input.
- A 31 minute window being accepted, or refused with a message that names no number, or one that names milliseconds instead of minutes.
- The refusal naming a maximum other than 30 minutes on this boot (that means `COHORT_TTL_MS` was set and the preconditions were not followed).
- A refusal mentioning the stall fallback or `AUTO_FALLBACK` on the size 3 / threshold 2 save (that means `AUTO_FALLBACK=0` was set; this test's k less than n saves require the boot default).
- A save producing a NEW draft row (a new draft id) instead of updating the existing one.
- `Cancel edit` deleting the draft, sending a PATCH, or leaving the typed-but-unsaved value applied.
- An `Edit draft` button present on an advertised row, or PATCH on a non-draft id returning 400 or 200 instead of 404.
- A `Funding window (minutes)` field appearing anywhere on this hermetic boot.

## Limits

This runs entirely on the hermetic fixture path, so the funding-window half of per-cohort timing is NOT covered: that field renders only when the served mode is `live` (`DraftEditForm.tsx:58`), and the funding wait itself only runs under `LIVE=1 BROADCAST=1` against a real chain with a real funded address. The discovery window is proven to be validated, stored, round-tripped and refused at the ceiling, but the app-side timer actually ENDING an advertised cohort when its window closes is not exercised here (that needs an advertised cohort plus a wait of the full window; it is covered hermetically by `packages/service/tests/discovery-window.spec.ts`). Step 15 shows the captured-versus-current defaults split for the HELP CAPTION only; it does not prove what an advertised cohort's effective window is at runtime. The curl legs send no `Origin` header, so they say nothing about the same-origin/CSRF guard, which only the in-browser saves exercise. Nothing here proves durability: every draft, setting and pause state is in memory and a restart clears it by design.

---

<a id="test-3"></a>

## Test 3: Automatic close is narrated as a stage, with no Close button

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (9 problem(s) found and corrected).

# Test 3: Automatic close is narrated as a stage, with no Close button

**Mode:** hermetic (the boot default: no `LIVE`, no `BROADCAST`).

**What this proves:** on the operator drill-down timeline the `Closed` stage appears with its caption the moment the nth seat fills, and no control anywhere on the console closes a cohort. Deliberate divergence from literal roadmap SC 1 wording; CONTEXT D-01 locks close as an automatic nth-seat lock.

## Preconditions

- Repo root is `/home/jintek/projects/github/@jintekc/btcr2-aggregation`.
- Nothing is listening on port 8080. Check with:
  ```bash
  curl -sS http://localhost:8080/v1/config
  ```
  Expect a `curl: (7) Failed to connect` error, not JSON.
- A Chromium or Chrome browser. Two windows are used: window 1 for the operator, window 2 for the participant.
- Boot command (run from the repo root, leave it running in its own terminal). The first run also builds every package, so allow a minute:
  ```bash
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation && OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" DEFAULT_SIZE=3 pnpm demo
  ```
- `OPERATOR_COOKIE_SECURE=0` is required over plain http, otherwise the session cookie is dropped by the browser and sign-in appears to succeed and then fails (`packages/service/src/demo-server.ts:445`).
- `DEFAULT_THRESHOLD` is deliberately NOT set, so the create form opens with k equal to n. This test has nothing to do with the k-of-n fallback path.
- No `LIVE`, no `BROADCAST`: this is the hermetic zero-chain default boot, so no `Funding` stage row will appear on the timeline (`packages/web/src/components/operator/OperatorStageTimeline.tsx:98-105`, the funding stage is inserted only when the detail carries a funding view).

## Steps

1. **Run the fast hermetic pre-check from the repo root:**
   ```bash
   pnpm vitest run packages/web/tests/operator-stage.spec.ts packages/web/tests/lifecycle.spec.ts
   ```
   Look for: `Test Files 2 passed (2)` and `Tests 43 passed (43)`. These pin the exact stage label and caption strings you are about to read on screen (`packages/web/tests/operator-stage.spec.ts:133-136`). If this fails, stop: the UI copy no longer matches the contract.

2. **Run the boot command from the Preconditions and watch the terminal.** Every line is prefixed `[demo] ` (`packages/service/src/demo-server.ts:262`). Look for a line containing `service listening on http://127.0.0.1:8080`, `web served`, and `(offline)` rather than `(live esplora)`, followed by a line containing `idle until the operator advertises a cohort from the console` (its full text ends `(POST /v1/operator/cohorts/:id/advertise)`, `demo-server.ts:537`). There must be NO `!!! OPERATOR CONSOLE DISABLED !!!` block (`demo-server.ts:447-450`); if you see it, `OPERATOR_PASSWORD` did not reach the process.

3. **Open `http://localhost:8080/operator` in browser window 1.** Use exactly that path, with no trailing slash. Look for: a page headed `Operator console` with a single field labelled `Operator password` and a `Sign in` button (`packages/web/src/components/operator/LoginPanel.tsx:25,36,50`). If you instead see the participant surface, you used a trailing slash: the SPA matches the path exactly (`packages/web/src/App.tsx:67`, `pathname === '/operator'`).

4. **Type `phase5` into the password field and click `Sign in`.** Look for: the console shell loads. The health strip's mode chip reads `Checking mode` for the first instant and settles on `Hermetic` once the first list poll lands, about four seconds (`packages/web/src/components/operator/HealthStrip.tsx:8-12` mode labels; `OperatorConsole.tsx:13` `LIST_POLL_MS = 4000`). The strip also carries the service name `Phase 5 check`. Below it is a `Service controls` card, and below that a `New cohort` button (`OperatorConsole.tsx:147`).

5. **Click `New cohort`.** The form opens PREFILLED from this service's settings: `Signing threshold (k)` renders first, then `Cohort size (n)` (`packages/web/src/components/operator/CreateCohortForm.tsx:150,164`; the seed comes from the served snapshot, `CreateCohortForm.tsx:31-44,76-79`). Because you booted with `DEFAULT_SIZE=3` and no `DEFAULT_THRESHOLD`, size reads `3`. Set the threshold field to `3` as well, then click `Create draft` (`CreateCohortForm.tsx:195`). Look for: a draft row in the list carrying a `Draft` chip (`packages/web/src/lib/operator-rows.ts:110`) and an `Advertise cohort` button (`packages/web/src/components/operator/OperatorCohortList.tsx:184`).

6. **Click `Advertise cohort` on that draft row.** Look for: you land in the cohort drill-down (`packages/web/src/stores/operator.ts:959-966` opens the freshly minted live id), headed `Cohort ` followed by a shortened id ending in an ellipsis character (`packages/web/src/components/operator/CohortDetail.tsx:56-58,349`). The top card is the stage timeline (`CohortDetail.tsx:362-364`): a vertical list of rows reading `Advertised`, `Filling`, `Closed`, `Submissions`, `Co-signing`, `Anchor`. There is no `Funding` row (hermetic boot).

7. **Look at the row labelled `Closed`. Hover the small round dot to its left and wait for the tooltip.** Look for: the `Closed` label is dim (the pending treatment) and there is NO caption sentence beneath it (`OperatorStageTimeline.tsx:201-203` renders the caption only when the stage is not pending). The dot tooltip reads exactly `Closed: pending` (`OperatorStageTimeline.tsx:192-196` builds the label as `${label}: ${position}`; `packages/web/src/ui/primitives.tsx:378-382` sets both `aria-label` and `title` from it).

8. **Open `http://localhost:8080` in browser window 2 (the participant surface).** Find the directory row whose id matches the one you just advertised and click `Join` (`packages/web/src/components/browse/CohortRow.tsx:80`). The identity step opens on the chooser because this browser holds no identity yet: leave the onboarding model on `KEY (k1)` and click `Generate a new identity` (`packages/web/src/components/browse/JoinIdentityStep.tsx:164`). The panel switches to the confirm state; click `Join cohort` (`JoinIdentityStep.tsx:227`). Look for: window 2 moves to the live cohort page. Within about four seconds window 1's Members card reads `Seats: 1/3.` and lists one seated member (`CohortDetail.tsx:37` `POLL_INTERVAL_MS = 4000`, `:379-382`).

9. **In window 1, hover the `Closed` dot again.** Look for: still no caption under `Closed`, and the tooltip still reads `Closed: pending`. The `Filling` row is the bold/active one and its dot tooltip reads `Filling: active`. This is the "before" half of the check: the automatic close has NOT been narrated while a seat is open (`packages/web/src/lib/lifecycle.ts:138-143`, `closedAtNthSeat` requires `seatsJoined >= capacity`).

10. **In window 1, scroll to the Members card and click `Fill remaining seats with test peers`** (`packages/web/src/stores/operator.ts:312`). Look for: an inline warn-toned confirmation panel headed `Add 2 test peers to this cohort?` (`stores/operator.ts:316-317`), with a confirm button reading `Add 2 test peers` (`stores/operator.ts:328`) and a cancel button reading `Cancel` (`stores/operator.ts:329`). There is no typed-value field at this rung (`packages/web/src/components/operator/CohortDetail.tsx:169-186` passes no type-to-confirm prop).

11. **Click `Add 2 test peers` and watch the Members card and the stage timeline for the next 10 seconds.** Look for: seats reach `Seats: 3/3.` and two extra members appear, each carrying a neutral `Test peer` badge and the line `Test peer added by the operator.` (`CohortDetail.tsx:79-80`). Within one 4-second poll the `Closed` timeline row gains a caption sentence directly beneath its label, reading exactly:
    `Every seat filled, so this cohort locked and stopped accepting joins.`
    (`OperatorStageTimeline.tsx:60`.)

12. **Hover the `Closed` dot once more.** Look for: the tooltip reads `Closed: complete`. You may briefly catch `Closed: active` in the moment between the nth seat and the phase change, which is correct: the caption renders for both. The caption from step 11 is still on screen. Nothing you clicked was a close control: you filled seats, and the close narrated itself.

13. **IMPORTANT: do NOT click `Submit my DID update` in window 2** (`packages/web/src/components/cohort/SubmitPanel.tsx:148`). Leave the cohort waiting for that update. **Now scan the whole drill-down page in window 1 from top to bottom and list every button you can see.** The complete set is:
    - on the `Service controls` card, which the console shell renders above the drill-down (`OperatorConsole.tsx:98-106`): `Pause advertising` (`ServiceControls.tsx:27`) and `Service settings` (`ServiceControls.tsx:38`);
    - on the cohort page itself: `Back to cohorts` (`CohortDetail.tsx:339`), `Cancel cohort` (`packages/web/src/components/operator/LifecycleActions.tsx:44`), `Finalize now` rendered disabled with the reason `Available once this cohort's signing round starts.` beside it (`LifecycleActions.tsx:58-59`; `finalizeAvailability` returns `not-signing` outside the three signing phases, `packages/web/src/lib/lifecycle.ts:108-120`), `Fill remaining seats with test peers` now disabled with `This cohort has no seats left.` beside it (`stores/operator.ts:337`), `Download monitoring record (JSON)` (`CohortDetail.tsx:497`), plus per-row `copy` buttons and `Show`/`Hide` expander toggles (`packages/web/src/ui/primitives.tsx:54,441`).

    There must be NO button that closes, locks, seals, or stops joins on the cohort. There is no broadcast kill switch here, which is correct on a hermetic service (`ServiceControls.tsx:127-133`).

14. **With window 1 focused, press Ctrl+F and search for:** `close`. Look for: the only match is the word `Closed` in the timeline stage row. No button, link, or menu item matches. Note the scope: find-in-page searches only text currently rendered, so collapsed `Technical detail` expanders are not covered; step 17 is what covers the source.

15. **Click `Back to cohorts` and repeat the Ctrl+F search for `close` on the cohort list view. Then click `Service settings` on the Service controls card and repeat the search there.** Look for: no match on either screen. The settings surface's back control reads `Back to cohorts`, not `Close` (`packages/web/src/components/operator/SettingsView.tsx:195-197` renders it; the string is defined at `packages/web/src/stores/operator.ts:217`).

16. **Cross-check that the automatic close is real on the wire and not just a label.** In a second terminal:
    ```bash
    curl -s http://localhost:8080/v1/directory
    ```
    Look for: a JSON array (`packages/service/src/hono-adapter.ts:647`). The entry for your cohort shows `"joined":3` and `"capacity":3`, and its `"phase"` is `CohortSet` or `CollectingUpdates` (it stays there because you did not submit from window 2). That combination is exactly what makes the row non-joinable to a stranger (`packages/web/src/lib/directory.ts:55-57`: joinable requires phase `Advertised` AND a free seat), so the close the timeline narrated has a participant-visible consequence.

17. **Run the source-level checks from the repo root.** First:
    ```bash
    grep -rnE "Close cohort|Close now|>[[:space:]]*Close[[:space:]]*<|'Close'|\"Close\"" /home/jintek/projects/github/@jintekc/btcr2-aggregation/packages/web/src/
    ```
    Then the broader wording sweep, which filters out code comments and the legitimate `Closed` stage and `disclosure` hits:
    ```bash
    grep -rniE "close|lock roster|stop joins|seal cohort" /home/jintek/projects/github/@jintekc/btcr2-aggregation/packages/web/src --include=*.tsx | grep -viE "closeCohort|closeSettings|closed|disclos" | grep -vE ":[0-9]+:[[:space:]]*(\*|//|/\*)"
    ```
    Look for: no output from either command (exit status 1). No component anywhere in the web source renders a control labelled Close or any synonym.

18. **Stop the service with Ctrl+C in the boot terminal.** The process exits. Both browser windows will now show their unreachable treatments; that is expected and is not part of this test.

## Pass

- Before the nth seat, the `Closed` timeline row is dim, has no caption, and its dot tooltip reads `Closed: pending`.
- After the nth seat fills, the `Closed` row carries the caption exactly as written: `Every seat filled, so this cohort locked and stopped accepting joins.`
- The close happened without the operator clicking anything that names closing: the only acts were a participant join and adding test peers into the remaining seats.
- No control on any console screen (drill-down, cohort list, settings) closes a cohort; the Ctrl+F search for `close` matches only the stage label.
- The full control enumeration in step 13 matches what is on screen, with no unexplained extra button.
- Both greps in step 17 return nothing.
- `GET /v1/directory` shows `joined` equal to `capacity` for the cohort, which is what makes it non-joinable.

## Fail signals

- A button, link, or menu item on any console screen that closes or locks a cohort, in any wording (Close, Lock roster, Stop joins, Seal cohort).
- The `Closed` row shows its caption while seats are still open (caption visible at 1 of 3 or 2 of 3 seats).
- The `Closed` row never gains its caption after seats reach 3/3 and more than about 8 seconds (two poll cycles) have passed.
- The caption text differs in any character from `Every seat filled, so this cohort locked and stopped accepting joins.`
- The dot tooltip does not follow the `<Label>: <pending|active|complete>` form, or reports `complete` for a stage the cohort has not reached.
- The timeline gains a clickable element: the whole timeline card must be read-only.
- Either grep in step 17 prints a line.

## Limits

This proves the console you actually rendered has no close control and narrates the close as a stage; it does not probe the server for a close verb, though none is registered (`packages/service/src/hono-adapter.ts:1169-1240` mounts advertise, readvertise, cancel, and finalize only). It exercises only the hermetic path, so the live-only `Funding` stage row is absent and its interaction with the `Closed` stage is unobserved; seeing that needs a real chain, a funded wallet, and a `LIVE=1 BROADCAST=1` boot. The tooltip observation depends on your browser rendering `title` attributes on hover; if it does not, fall back to the visual dim/bold/caption difference, which carries the same information. It does not prove what a seated participant sees when the close happens beyond the directory row becoming non-joinable. Steps 13 through 17 are not racing a clock: on this boot no phase timeout is armed (`PHASE_TIMEOUT_MS` is unset and the library returns without arming a timer when it is undefined), and no cohort TTL or discovery window is armed either (`COHORT_TTL_MS` unset, and the default discovery window falls back to it, `packages/service/src/index.ts:674`), so the cohort will sit in `CollectingUpdates` for as long as you need.

---

<a id="test-4"></a>

## Test 4: Lifecycle ceremony ladder renders as specified

> Hermetic: **no**. Audit verdict: NEEDS_FIX (8 problem(s) found and corrected).

# Test 4: Lifecycle ceremony ladder renders as specified

**Hermetic:** no. Steps 1 to 20 run on the hermetic default boot. Steps 21 to 29 need a real chain, a real esplora, and a real wallet payment.

**What this must let you verify:** rung 2 (finalize) states the real k-of-n consequence including that unsigned signers are excluded and that fewer than k cannot anchor. Rung 3 (ordinary cancel) names the short id and the seated count. Rung 4 (funded beacon) requires type-to-confirm and discloses the recovery-key situation. In flight, both buttons disable and the confirm label holds. A failed action renders the action-error line and leaves every cohort fact untouched with no optimistic chip. Cancel is HIDDEN, not disabled, after broadcast. A 401 routes through the shared session-expiry path.

## Preconditions

- Repo root is `/home/jintek/projects/github/@jintekc/btcr2-aggregation`. Run every command from there.
- Nothing is listening on port 8080. Check with `curl -sS http://localhost:8080/v1/config` and expect connection refused.
- Chromium or Chrome with DevTools. You will use three DevTools features: Network request blocking, cookie deletion, and custom network throttling profiles. DevTools must stay OPEN in the window it applies to, for both throttling and blocking.
- Hermetic boot (steps 1 to 20):

  ```bash
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation && OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 DEFAULT_SIZE=3 DEFAULT_THRESHOLD=2 pnpm demo
  ```

  `pnpm demo` runs `pnpm -r build` first, which includes the web `vite build`, so the service serves the SPA on the same port. `OPERATOR_COOKIE_SECURE=0` is required over plain http on localhost or the session cookie is never stored.
- Live boot (steps 21 to 29) needs a Bitcoin network you control with an esplora REST endpoint and a wallet that can pay an address on it. Two known-good shapes: (a) the owner's regtest setup, where you control confirmation by mining, `regtest` defaults to `http://127.0.0.1:3000` (`packages/shared/src/networks.ts:165`); (b) mutinynet, the project default, public esplora at `https://mutinynet.com/api` (`packages/shared/src/networks.ts:118`), where blocks arrive about every 30 seconds.

  ```bash
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation && OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 LIVE=1 BROADCAST=1 NETWORK=regtest ESPLORA_HOST=http://127.0.0.1:3000 DEFAULT_SIZE=2 DEFAULT_THRESHOLD=2 pnpm demo
  ```

- Boot refuses if `BROADCAST=1` is set without `LIVE=1` (`packages/service/src/demo-server.ts:338-347`), and refuses unless `PHASE_TIMEOUT_MS` exceeds `FUNDING_WINDOW_MS` (`demo-server.ts:359-370`). The defaults are 1800000 and 720000, which satisfy it, so leave both unset.
- Leave `RECOVERY_KEY` unset for the live block so you get the throwaway disclosure, which is both the default and the more alarming of the two lines. To see the operator-held wording instead, set `RECOVERY_KEY` to a valid 64-hex x-only public key; after a build you can mint one with:

  ```bash
  bun -e 'const m = await import("./packages/shared/dist/index.js"); console.log(m.deriveRecoveryKey());'
  ```

## Steps

1. **Hermetic pre-check.** Run:

   ```bash
   pnpm vitest run packages/web/tests/lifecycle.spec.ts packages/web/tests/operator-stage.spec.ts
   ```

   Look for: 43 tests passing across 2 files. These pin the availability and rung-selection rules whose rendered form you are about to inspect.

2. **Boot and sign in.** Start the hermetic service with the steps 1 to 20 command. Open `http://localhost:8080/operator` in window 1 and sign in with `phase5`.
   Look for: the console loads and the health strip carries a mode chip reading `Hermetic`.

3. **Create and advertise.** Click `New cohort`. The form renders `Signing threshold (k)` FIRST and `Cohort size (n)` SECOND, and both are already seeded from the boot env, so k should read 2 and n should read 3. Correct them if they do not. Click `Create draft`, then click `Advertise cohort` on the new draft row.
   Look for: you land in the drill-down automatically. Below the stage timeline is a card whose heading renders in uppercase as LIFECYCLE (the heading style uppercases it; the authored string is `Lifecycle`).

4. **Read the Lifecycle card without clicking anything.**
   Look for two things. (a) A red/danger button reading `Cancel cohort` with a muted sentence beside it reading exactly: `Available until this cohort's beacon transaction is broadcast.` (b) A ghost button reading `Finalize now` rendered DISABLED (dimmed, not clickable) with a muted sentence beside it reading exactly: `Available once this cohort's signing round starts.` Finalize is disabled and visible, not hidden.

5. **Click `Cancel cohort`.**
   Look for: an inline panel with no modal overlay and no dimmed backdrop, the page behind it still readable, headed `Cancel this cohort?`, whose body reads exactly:
   `No one has joined cohort <8 characters> yet. Canceling removes it from the directory so it can never be joined or anchored. This cannot be undone.`
   Buttons: `Cancel cohort` (armed immediately) and `Keep it running`. There is NO type-to-confirm input at this rung.

6. **Seat one real participant.** Click `Keep it running`. Open `http://localhost:8080` in window 2, find the cohort in the directory and click `Join`. The identity step appears: click `Generate a new identity`, wait until the `did` and `secret (save to re-import)` copy fields render, then click `Join cohort`.
   Look for: window 1's Members card reads `Seats: 1/3.` with one seated member listed and no `Test peer` badge on it.

7. **Re-open the cancel confirm in window 1 and read the body.**
   Look for: heading `Cancel this cohort?`, body reading exactly:
   `Cohort <8 characters> has 1 seated participants. Canceling ends the cohort for all of them: seats are lost, joining stops, and it will never anchor. This cannot be undone.`
   The 8 characters are the first 8 of the cohort id shown in the page heading, with no ellipsis (the heading appends one, the confirm value does not). Note: the shipped copy does not singularize at one seat. Record that as an observation, not a failure of this test.

8. **Arm request blocking.** Leave the confirm panel open. Click into window 1's DevTools so it has focus, press Ctrl+Shift+P, run `Show Network request blocking`, tick the enable checkbox, click `+` and add the pattern `*/cancel` (a plain `/cancel` substring pattern works too).
   Look for: the pattern is listed and blocking is enabled.

9. **Click the `Cancel cohort` confirm button inside the open panel.**
   Look for, within a second, a bad-toned line reading exactly:
   `That action didn't go through. Nothing about this cohort changed.`
   It renders in TWO places on this page and both are the same store field: at the bottom of the Lifecycle card, and again inside the Export card near the foot of the drill-down. Two copies is correct, not a defect.
   Also look for: the confirm panel stays open. The Members card still reads `Seats: 1/3.` No `Canceled` chip appears anywhere. The freshness indicator at the top of the drill-down still shows a good-tone dot with the label that renders in uppercase as LIVE (the authored string is `Live`; the stale variant would read `Reconnecting`). Nothing froze and nothing was optimistically repainted.

10. **Click `Back to cohorts` and inspect the list.**
    Look for: the cohort is still in its live group with its normal chip. There is no `Canceled` chip and no row under `Ended`. The action-error line from step 9 is STILL visible above the list, which is expected: closing a drill-down does not clear it. The failed action changed nothing about the cohort.

11. **Clear blocking and re-open.** Remove the `*/cancel` pattern or untick blocking. Re-open the cohort with its `Open` button.
    Look for: you are back in the drill-down, and the action-error line is gone from both the list and the drill-down. It is cleared when a drill-down opens, because it belongs to the surface that raised it.

12. **401 during the action.** Click `Cancel cohort` to open the confirm panel again. In DevTools open Application > Storage > Cookies > `http://localhost:8080`, select the cookie named `operator_session`, and delete it. Immediately click the `Cancel cohort` confirm button.
    Look for: the entire console is replaced by the sign-in screen showing the message:
    `Your operator session ended. Sign in again to keep monitoring. Monitoring rebuilds from this service's state after you sign in.`
    You are NOT shown an inline error inside a still-rendered Lifecycle card. If the screen flips before you can click, that is the 4 second poll winning the race, which is the same shared expiry path and the same expected screen.

13. **Sign in again with `phase5` and open the same cohort.**
    Look for: the cohort is intact. Still listed, still `Seats: 1/3.`, no `Canceled` chip. The 401 lost nothing and canceled nothing.

14. **Add a slow throttling profile.** In window 1's DevTools press F1 to open Settings, go to Throttling > Network throttling profiles > Add profile. Name it `UAT slow`, set Download 500 kbit/s, Upload 500 kbit/s, Latency 3000 ms. Save, then select `UAT slow` in the Network panel's throttling dropdown.
    Look for: `UAT slow` is selected in the dropdown, and the console's 4 second polls become visibly slower.

15. **Watch the in-flight treatment.** Click `Cancel cohort`, then click the `Cancel cohort` confirm button and watch the panel closely for the next 3 seconds.
    Look for: the confirm button's label changes to `Canceling…` and BOTH that button and `Keep it running` become disabled (dimmed, unclickable) for the duration of the request. The label does not flicker back to `Cancel cohort` mid-flight.

16. **Let the request finish.**
    Look for: the drill-down closes and you return to the cohort list. The cohort now appears under the `Ended` heading with a NEUTRAL (not red) chip reading `Canceled`, and a line beneath it reading `Canceled by the operator at ` followed by a local wall-clock time. That chip arrived from the server read, not from an optimistic local edit.

17. **Check the participant directory.** Set the throttling dropdown back to `No throttling`. Reload window 2 (F5), which returns the participant to the public directory with a clean, identity-free session.
    Look for: the canceled cohort is gone from the joinable directory. What the seated participant is told about the cancel is a separate criterion and is not this test.

18. **Set up the finalize rung.** In window 1 create and advertise a fresh cohort, confirming `Signing threshold (k)` is 2 and `Cohort size (n)` is 3. In window 2 (already reloaded and clean) click `Join`, then `Generate a new identity`, then `Join cohort`.
    Look for: window 1 reads `Seats: 1/3.`

19. **Throttle the participant, then fill the cohort.** In WINDOW 2's DevTools (the participant window, not the console), add and select a custom throttling profile with Latency 20000 ms using the same Add profile flow as step 14; name it `UAT stall`. Then in window 1 click `Fill remaining seats with test peers` and confirm with `Add 2 test peers`. Finally, in window 2, click `Submit my DID update` as soon as it appears.
    Look for in window 1: seats reach `Seats: 3/3.` and the two added members carry a `Test peer` badge. The Submissions card flips each member from `<short did>: not yet submitted` to `<short did> submitted at <time>`, the two test peers within a few seconds and the throttled participant later.

20. **Catch and hold the signing round, then read rung 2.** Watch window 1's Co-sign card. It renders `<n> of 3 nonces received.` The moment it reads `2 of 3 nonces received.`, the cohort is in a signing phase with only the throttled participant's nonce outstanding: switch window 2's throttling dropdown to `Offline` to park it there. Now click `Finalize now` in window 1, which should no longer be dimmed.
    Look for: a warn-toned (not red) inline panel headed `Finalize this cohort now?` whose body reads exactly:
    `This stops waiting for every seat and anchors on the k-of-n fallback path with 2 of 3 signatures. Signers who have not signed yet are not included. If fewer than 2 signatures have arrived, this cohort cannot anchor.`
    Buttons: `Finalize now` and `Keep waiting`. No type-to-confirm input at this rung. The 2 and the 3 must match the cohort's configured threshold and size.
    Optional commit: click `Finalize now`. The drill-down STAYS OPEN, unlike a cancel, and within a poll or two the finalize block is replaced by the line `This cohort already finalized on the k-of-n fallback path.`
    If the Co-sign card never reaches 2 of 3, the throttled participant either stalled before signing or beat you to its nonce: set window 2 back to `No throttling`, repeat from step 18, and switch window 2 to `Offline` immediately after its update shows as submitted in the Submissions card.

21. **LIVE BLOCK. Reboot live.** Stop the hermetic service with Ctrl+C and boot with the live command from the preconditions. Read the boot banner.
    Look for: a loud banner line of the form `!!! LIVE + BROADCAST: <NETWORK> !!!` naming the network in upper case. With `RECOVERY_KEY` unset you also get:
    `!!! RECOVERY_KEY UNSET: cohort recovery keys are THROWAWAY (secret discarded) !!!`
    followed by two indented lines saying funds sent to a cohort that fails below its fallback threshold are unrecoverable on any network.

22. **Create an all-test-peer live cohort.** Sign in at `http://localhost:8080/operator`. Create and advertise a cohort with `Signing threshold (k)` 2 and `Cohort size (n)` 2. In the drill-down click `Fill remaining seats with test peers` and read the confirmation before accepting.
    Look for: the health strip mode chip reads `Live`. The confirm panel is headed `Add 2 test peers to this cohort?` and its confirm button reads `Add 2 test peers`. In addition to its normal body it carries a line reading:
    `This is a live cohort, so test peers co-sign for real and their DIDs are anchored on <network>.`
    Accept it. Note that both seats are now operator-spawned test peers, so the seated count of 2 you will see at rung 4 refers to them.

23. **Read the funding stage.** Wait for the seats to fill and scroll to the card whose heading renders in uppercase as FUNDING.
    Look for: a copyable field labelled with the network name whose value begins `bitcoin:` followed by the beacon address; a muted line reading `Send at least <N> sats to this address in a single payment.`; a warn-toned waiting line; and a warn-toned recovery-key line reading exactly:
    `Throwaway recovery key: if this cohort fails below the fallback threshold, funds sent to this address are unrecoverable.`

24. **Fund it.** From your own wallet send at least the stated number of sats to that address in ONE payment. On regtest, do NOT mine a block yet.
    Look for: within a poll or two the funding state line changes to `Funding seen in the mempool. Waiting for it to confirm.`

25. **Read rung 4 with funds in the mempool.** Click `Cancel cohort` in the Lifecycle card.
    Look for: the ceremony has visibly escalated. Heading reads `Cancel this funded cohort?`. Body line 1 reads:
    `Cohort <8 characters> is funded on <network>. Canceling ends it for its 2 seated participants, and it will never anchor.`
    Body line 2 reads exactly:
    `Throwaway recovery key: funds sent to this cohort's beacon address are unrecoverable.`
    Below that, an instruction reading `Type <8 characters> to confirm.` with a text input. The confirm button reads `Cancel funded cohort` and is DISABLED. The other button reads `Keep it running`.

26. **Try three near misses.** Type the 8 characters in UPPERCASE. Then clear and type only the first 7 characters. Then clear and paste in something longer that starts with them.
    Look for: `Cancel funded cohort` stays disabled for all three. No near miss arms a destructive action.

27. **Type it exactly as shown.**
    Look for: `Cancel funded cohort` becomes enabled. Do NOT click it. Click `Keep it running` instead so the cohort can proceed.

28. **Confirm the funding and let it anchor.** Mine a block on regtest, or wait for the next block on mutinynet. Watch the Funding and Anchor cards.
    Look for: the funding line becomes `Funded and confirmed. This cohort can anchor on-chain.` Shortly after, the Anchor card's `Broadcast` sub-step turns done and a txid appears.

29. **Read the Lifecycle card after broadcast.** With the txid on screen, scan the entire page for any cancel control.
    Look for: there is NO `Cancel cohort` button anywhere, not even a dimmed one. In its place is a single muted line reading exactly:
    `This cohort's beacon transaction is already broadcast, so there is nothing left to cancel.`
    A disabled `Finalize now` with its own reason beside it may still be present; that is a different control and is not a failure here.

## Pass

- Rung 2 (finalize) is warn-toned, states the k-of-n consequence with the real k and n from the cohort, says unsigned signers are not included, and says fewer than k cannot anchor. No typed value is demanded.
- Rung 3 (ordinary cancel) names the cohort by its 8-character short id, plus the seated count when seats exist; at zero seats it states that no one has joined instead of a count. Neither variant demands a typed value.
- Rung 4 (funded cancel) demands the exact short id typed before its confirm button arms, and states the recovery-key situation in plain words before the button can arm.
- A near-miss typed value (case difference, prefix, superstring) never arms the rung-4 confirm.
- While an action is in flight, the confirm button shows its in-flight label (`Canceling…`) and BOTH buttons are disabled.
- A failed action renders exactly `That action didn't go through. Nothing about this cohort changed.` and leaves seats, chips, groups, and the drill-down untouched, with no optimistic `Canceled` chip anywhere.
- A 401 during the action drops the whole console to the sign-in screen with the session-ended line, rather than an inline error, and cancels nothing.
- After the beacon transaction broadcasts, the cancel control is absent (replaced by the nothing-left-to-cancel line), never present-and-disabled.
- Every confirmation renders inline with the page still visible behind it, never as a modal overlay.

## Fail signals

- A cancel confirm at any rung that names neither the cohort nor the seated count (and, at zero seats, does not say that no one has joined).
- A funded cancel (mempool, confirmed, or dead-end) that arms without typing, or whose typed gate accepts a case-different or partial value.
- A funded cancel that never states the recovery-key situation, or that states operator-held when `RECOVERY_KEY` was not set.
- A disabled `Cancel cohort` button visible after the beacon transaction is out (the rule is hidden, not disabled).
- A finalize control that is HIDDEN before the signing round instead of disabled with its reason, or that is offered with no reason beside it.
- Finalize confirm copy that omits the exclusion of unsigned signers, or omits that fewer than k cannot anchor, or interpolates a k or n that disagrees with the cohort's configured threshold and size.
- Any cohort fact changing on a failed action: a `Canceled` chip appearing, seats changing, the row moving to `Ended`, or the drill-down closing.
- A 401 rendering as an inline error while the console stays signed in.
- Both confirm buttons remaining clickable while a request is in flight, or the confirm label reverting to its idle text mid-flight.
- A confirmation that renders as a modal overlay with a dimmed backdrop.

## Limits

Steps 21 to 29 CANNOT be run on the hermetic default boot: the funding view is constructed only when the service is booted with both live and broadcast (`packages/service/src/index.ts:1111`) and the drill-down only surfaces it when the served mode is `live` (`packages/service/src/monitor.ts:1428`), so rung 4, the recovery-key disclosure, and the hidden-after-broadcast behavior all need a real chain, a real esplora, and a real wallet payment. Skipping them leaves those three claims unobserved; the only hermetic backing is the unit spec at `packages/web/tests/lifecycle.spec.ts`. The existing `05-UAT-CHECKLIST.md:156-157` line offering `pnpm e2e:cancel` as a substitute for the after-broadcast check is inaccurate: that leg (`e2e/operator-cohort.ts`, the `--cancel` path) advertises two cohorts, cancels one, and asserts directory and fate; it never broadcasts a beacon transaction. Step 20 is timing dependent even with the offline hold: the hermetic signing round completes in milliseconds unless a co-signer is slowed, and reaching `2 of 3 nonces received.` behind a 20 second latency is likely but not guaranteed, so expect to retry. The deterministic proof of the finalize ROUTE and of a real k-of-n fallback anchor is `pnpm e2e:fallback:operator`, which proves nothing about the rendered copy. Step 12's 401 cannot be attributed to your click with certainty, because the drill-down polls every 4 seconds and both the poll and the action take the same shared expiry path by design. Step 15's in-flight observation is made under artificial latency and says nothing about behavior on a real slow network. Nothing here checks what the seated participant is told when a cohort is canceled, which is a separate criterion.

## Source evidence

- `packages/web/src/components/operator/LifecycleActions.tsx:44-60` (every rung constant, verbatim), `:72-87` (rung 3 bodies), `:94-104` (rung 4 body), `:111-119` (finalize body), `:145-146` (n and k from the served projection), `:151-169` (cancel hidden and replaced when availability is broadcast), `:174-205` (finalize committed line, warn-tone confirm, disabled-with-reason branch), `:207-209` (action error inside the card).
- `packages/web/src/lib/lifecycle.ts:43-58` (cancel availability, broadcast check first, txid-based), `:75-81` (rung 4 for awaiting-confirmation, funded, dead-end), `:111-122` (finalize availability), `:172-178` (exact, case-sensitive typed gate), `:188-190` (plain 8-character short id, no ellipsis).
- `packages/shared/src/phases.ts:98-102` (`FINALIZABLE_PHASES`: SigningStarted, NoncesCollected, AwaitingPartialSigs).
- `packages/web/src/ui/primitives.tsx:289-296` (renders inline, no portal, no modal overlay), `:315-322` (arming through the tested predicate), `:324-342` (`Type <value> to confirm.` plus the input), `:343-354` (both buttons disabled while busy, confirm renders busyLabel), `:31-35` (SectionTitle uppercases its heading).
- `packages/web/src/stores/operator.ts:97-102` (`ACTION_FAILED` and `actionFailedWith`), `:153-156` (`Canceling…`, `Finalizing…`), `:163-164` (session-expired copy), `:312-328` (test-peer label, heading, live line, confirm label), `:827-863` (`expireSession`, the one shared path), `:1031-1054` (cancel: 401 to expireSession, unreachable to actionError only, success closes the drill-down and re-reads), `:1056-1080` (finalize: success keeps the drill-down open and re-polls), `:1220-1237` (openCohort clears actionError, closeCohort does not), `:952-970` (advertise lands in the drill-down).
- `packages/web/src/lib/operator.ts:805-820` (cancel client: fetch failure and non-ok both map to unreachable, 401 to unauthorized).
- `packages/web/src/lib/operator-rows.ts:48-50` (`Canceled by the operator at <time>.`), `:132` (canceled chip: neutral tone, label `Canceled`, no pulse).
- `packages/web/src/components/operator/OperatorCohortList.tsx:35-39` (group headings), `:184` (`Advertise cohort`), `:219-221` (`Open`), `:239` (canceled ended line), `:348-350` (action error on the list).
- `packages/web/src/components/operator/CohortDetail.tsx:37` (4000 ms detail poll), `:56-58` (heading short id appends an ellipsis), `:79` (`Test peer` badge), `:218-230` (submission rows), `:326-344` (freshness labels `Live` / `Reconnecting` / `Checking freshness`, uppercased), `:339-341` (`Back to cohorts`), `:378-381` (`Seats: n/m.`), `:406-411` (test-peer control), `:416` (Submissions), `:430-441` (Co-sign nonce count), `:463` (Anchor), `:253` (`Broadcast` sub-step), `:499-503` (the same action error again, inside Export).
- `packages/web/src/components/operator/CreateCohortForm.tsx:32-46` (form seeded from the served settings), `:149-175` (threshold first, size second), `:195` (`Create draft`).
- `packages/web/src/components/operator/HealthStrip.tsx:8-12` (`Hermetic`, `Live (no broadcast)`, `Live`).
- `packages/web/src/components/operator/FundingStage.tsx:36-59` (state lines), `:86-105` (bitcoin URI field, single-payment minimum), `:128-139` (always-shown recovery-key disclosure).
- `packages/web/src/components/browse/CohortRow.tsx:79-81` (`Join`), `JoinIdentityStep.tsx:164` (`Generate a new identity`), `:227` (`Join cohort`), `packages/web/src/components/cohort/SubmitPanel.tsx:148` (`Submit my DID update`), `CohortPage.tsx:135/146` (`Browse cohorts`), `:315/324` (`Start over`).
- `packages/service/src/index.ts:1111-1120` (funding view only under broadcast and live; recoveryKeyState from recoveryKeyOperatorHeld), `packages/service/src/monitor.ts:1415-1424` (fallback k from `effectiveFallbackThreshold`, n from capacity), `:1428` (funding view gated on mode `live`), `:867` (mode fixed at construction).
- `packages/service/src/demo-server.ts:38` (`DEFAULT_PHASE_TIMEOUT_MS` 1800000), `:64` (`DEFAULT_FUNDING_WINDOW_MS` 720000), `:338-347` (BROADCAST without LIVE refuses), `:359-370` (phase timeout must exceed funding window), `:374-385` (live and broadcast banner plus the RECOVERY_KEY UNSET warning), `:416-417` (`DEFAULT_SIZE`, `DEFAULT_THRESHOLD`), `:434-445` (`OPERATOR_PASSWORD`, `OPERATOR_SESSION_TTL_MS`, `OPERATOR_COOKIE_SECURE`), `:500-509` (live and broadcast both tied to BROADCAST=1, recoveryKeyOperatorHeld from RECOVERY_KEY).
- `packages/service/src/hono-adapter.ts:1001` (`POST /v1/operator/cohorts/:id/test-peers`), `:1199-1205` (`POST /v1/operator/cohorts/:id/cancel`, opaque 404), `:1217-1231` (`POST /v1/operator/cohorts/:id/finalize`, 409 with an app-authored reason).
- `packages/service/src/operator-auth.ts:39` (`SESSION_COOKIE = 'operator_session'`), `:252` (Secure flag from `cookieSecure`).
- `packages/shared/src/index.ts:300` (`deriveRecoveryKey`), `:342-353` (recoveryKey must be 64 hex chars and a valid x-only point), `packages/shared/src/networks.ts:118` (mutinynet esplora), `:165` (regtest esplora).
- `e2e/operator-cohort.ts:733-880` (the `--cancel` leg: advertise A and B, cancel B, assert directory, fate and chip; no beacon broadcast anywhere), `e2e/fallback-cohort.ts:229-242` (the withhold-only-the-nonce technique that parks a cohort in a signing phase).

---

<a id="test-5"></a>

## Test 5: Worst-case lifecycle block layout, and the Chain endpoint disclosure across every E16 state

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (8 problem(s) found and corrected).

## Test 5: worst-case lifecycle block layout, and the Chain endpoint disclosure across every E16 state

Hermetic except where noted. Steps 1 to 12 and step 25 need no network at all. Steps 13 to 24 need outbound internet from the browser to two public esplora hosts and cannot be run offline.

### Preconditions

- Build once: `cd /home/jintek/projects/github/@jintekc/btcr2-aggregation && pnpm -r build` (`pnpm demo` repeats this, so it is only to get the failure early).
- Nothing else on port 8080: `ss -ltn | grep :8080` should print nothing.
- Boot in one terminal and leave it running. BOTH timing knobs are raised: `COHORT_TTL_MS` sets the discovery-window default and its ceiling (packages/service/src/index.ts:674 and :680), while `PHASE_TIMEOUT_MS` is the single inter-phase stall timer that would otherwise tear an idle advertised cohort down after the 30 minute default (packages/service/src/demo-server.ts:20-38). Raising only one is not enough for a walkthrough this long.

  ```bash
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation
  OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" \
    COHORT_TTL_MS=5400000 PHASE_TIMEOUT_MS=5400000 pnpm demo
  ```

- Wait for these two boot lines before touching the browser (packages/service/src/demo-server.ts:531-538):
  `service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))`
  `idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)`
  If you see `!!! OPERATOR CONSOLE DISABLED !!!` (demo-server.ts:446-450) the password did not reach the process. Fix that first.
- Three browser tabs, same profile is fine (this app writes nothing to localStorage or sessionStorage, verified by a repo-wide grep, so each tab is an independent participant): tab OP on `http://127.0.0.1:8080/operator`, tab A on `http://127.0.0.1:8080`, tab B on `http://127.0.0.1:8080`. Use the loopback IP, not `localhost`: the service binds 127.0.0.1 only.
- Do not reload tab A or tab B once they have joined. The cohort page says so itself: `Keep this tab open. Refreshing loses your seat, and this service does not save your session yet.` (packages/web/src/components/cohort/CohortPage.tsx:240-243).

### Steps

1. **Sign in.** In tab OP enter `phase5` in the field labeled `Operator password` and click `Sign in`.
   Look for: the console loads; the health strip carries a neutral chip reading `Hermetic`, the service name `Phase 5 check`, and a network chip reading `Mutinynet (signet)`; a `Service controls` card sits directly under the strip.

2. **Create a 3-of-3 draft.** Click `New cohort`. In the `Create a cohort` form set `Signing threshold (k)` to 3 and `Cohort size (n)` to 3 (both seed to 2 from this service's defaults), then click `Create draft`.
   Look for: a row under the `Drafts` heading showing `0/3 seats` and `Co-sign: 3-of-3`.

3. **Advertise and open.** On that draft row click `Advertise cohort`, then click `Open` on the resulting advertised row.
   Look for: the drill-down heading `Cohort ` plus the first 8 characters of the id and a horizontal ellipsis, a copyable full cohort id under it, a stage timeline card, and a `Lifecycle` card directly beneath the timeline.

4. **First participant joins.** In tab A click `Join` on the cohort row, then `Generate a new identity`, then `Join cohort`.
   Look for: tab A switches to the cohort page (stage timeline, `Your identity` card, the keep-this-tab-open line, and a collapsed `Chain endpoint` expander below it).

5. **The three elements together.** Return to tab OP and wait up to 4 seconds for the next detail poll (CohortDetail.tsx:37).
   Look for all three at once:
   (a) the `Lifecycle` card shows a danger-toned `Cancel cohort` button with `Available until this cohort's beacon transaction is broadcast.` beside it;
   (b) directly under it a ghost `Finalize now` button rendered DISABLED with `Available once this cohort's signing round starts.` beside it;
   (c) the `Members` card shows `Seats: 1/3.`, one seated member row, then the note `A single seat can't be released. If someone joined and went quiet, cancel this cohort and advertise a new one, or wait for its discovery window to expire.`, then a ghost `Fill remaining seats with test peers` button with its help sentence.

6. **Open the cancel confirm (do not confirm).** Click `Cancel cohort`.
   Look for: the button is replaced in place by an inline bad-toned confirm panel headed `Cancel this cohort?`, with a body naming the cohort's 8-character id and its seated count, and two buttons, `Cancel cohort` and `Keep it running`. Write down the body sentence verbatim at a seated count of one (see fail signals).

7. **Back out.** Click `Keep it running`.
   Look for: the confirm disappears, the `Cancel cohort` button and its availability note return, nothing else on the page changed, and the cohort is still advertised.

8. **Second participant joins.** In tab B click `Join`, then `Generate a new identity`, then `Join cohort`. Return to tab OP and wait one poll.
   Look for: `Seats: 2/3.` with two seated member rows, and the seat-reclaim note still present (the cohort is not full).

9. **The busiest block.** Click `Cancel cohort` again and leave the confirm open. Scroll so the `Lifecycle` card and the `Members` card are both visible.
   Look for: one readable stack, top to bottom: `Lifecycle` heading, the open cancel confirm (heading, body paragraph, `Cancel cohort` and `Keep it running`), the disabled `Finalize now` with its reason, then the `Members` card with two seat rows, the seat-reclaim note, and the `Fill remaining seats with test peers` button with its help line. No text clipped, no element overlapping another, no horizontal scrollbar.

10. **380px.** Open DevTools, toggle the device toolbar, set the viewport width to 380px, keep the confirm open.
    Look for: every row wraps rather than overflowing. The two confirm buttons wrap onto separate lines, the `Finalize now` button and its reason wrap, the test-peer button and its help wrap, every sentence wraps inside its card, the 8-character id in the confirm body stays fully readable, and the page still has no horizontal scrollbar.

11. **Restore and back out.** Set the viewport back to a normal width, close the device toolbar, click `Keep it running`.
    Look for: the confirm is gone and the cohort still reads `Seats: 2/3.`

12. **Card inventory.** Scroll the drill-down top to bottom and list the cards.
    Look for: stage timeline, `Lifecycle`, `Members`, `Submissions`, `Co-sign`, `Anchor`, `Activity`, `Export`. There is NO funding card between `Co-sign` and `Anchor`, and no empty placeholder in its place: on a zero-chain boot the detail carries no funding view, so the card is simply absent (CohortDetail.tsx:455-459).

13. **Open the participant disclosure.** Switch to tab A, click the `Chain endpoint` expander, open DevTools on this tab, select the Network panel and leave it open for the rest of the run.
    Look for: `This browser reads the chain through this service. That is the default and needs no setup.`, a field labeled `Esplora endpoint (optional)` with placeholder `https://esplora.example.com`, the help line `Set your own esplora endpoint to read the chain directly instead of through this service.`, and a single `Use this endpoint` button. No broadcast checkbox and no switch-back button yet.

14. **Malformed (no request).** Type `http://mutinynet.com/api` and click `Use this endpoint`.
    Look for: `Enter a full https URL, for example https://esplora.example.com.`, and NO request at all in the Network panel (https is enforced before any fetch, packages/web/src/lib/esplora.ts:71-86).

15. **Browser-rejected.** Clear the field, type `https://mutinynet.com` (no `/api` path) and click `Use this endpoint`.
    Look for: `This endpoint does not allow browser requests, so it can't be used from here.` The Network panel shows a failed request to `https://mutinynet.com/block-height/0` and the console shows a CORS error (that path answers 200 text/html with no `access-control-allow-origin`, verified by direct request 2026-07-30). Note that no `Use this service's chain reads` button is offered here: it renders only while an endpoint is active (ChainEndpointPanel.tsx:134-138) and none is.

16. **Unreachable.** Clear the field, type `https://mutinynet.com/api/bogus` and click `Use this endpoint`.
    Look for: `Couldn't reach that endpoint.`, and NOT the sentence from step 15. That host answers `/api/bogus/block-height/0` with a 404 that DOES carry permissive CORS, so the browser reads the response and the app classifies it as unreadable rather than as a browser rejection (esplora.ts:204-219).

17. **Mismatch, naming both chains.** Clear the field, type `https://mempool.space/signet/api` and click `Use this endpoint`.
    Look for: `That endpoint is on Signet, but this service is on Mutinynet (signet). It was not used.` The Network panel shows exactly two requests, `block-height/0` then `block-height/1`: plain signet and mutinynet share block zero, so the height-1 marker is what separates them (packages/shared/src/networks.ts:115-143).

18. **Accepted.** Clear the field, type `https://mutinynet.com/api` and click `Use this endpoint`.
    Look for: the failure line disappears; the top line reads `Reading the chain from ` followed by `mutinynet.com` in mono and a period (three separate elements with a small gap, ChainEndpointPanel.tsx:109-113); a second button `Use this service's chain reads` now renders; an UNCHECKED checkbox labeled `Also broadcast my transactions through this endpoint.` appears with the help line `Off by default. While it is off, your registration transaction is still relayed through this service.`; and below it the caption `This service still reports this cohort's anchor. Your endpoint only double-checks a transaction it named.`

19. **Long input.** Paste a very long https URL into the field (for example `https://` followed by 300 letters, then `.example.com/api`) and, before clicking, look at the card's width. Then click `Use this endpoint`.
    Look for: the input never widens the card (it is `w-full`) and the page has no horizontal scrollbar at any point. After the click one of the four failure sentences renders (most likely the browser-request one, since a DNS failure also surfaces as a thrown fetch) and it wraps inside the card. None of the four sentences echoes the URL.

20. **A refusal never displaces an active endpoint.** Clear the field, type `https://mempool.space/signet/api` again and click `Use this endpoint`.
    Look for: the mismatch sentence renders again AND the active line still names `mutinynet.com`. Nothing reverted to the service. The verdict is answered from an in-memory cache here (esplora.ts:196), so the Network panel may show no new request; that is expected.

21. **Clear back to the default.** Tick `Also broadcast my transactions through this endpoint.`, then click `Use this service's chain reads`.
    Look for: the panel returns to the default state showing `This browser reads the chain through this service. That is the default and needs no setup.`, and the checkbox, the anchor caption, the switch-back button AND the mismatch sentence are all gone (clearChainEndpoint nulls the verdict, packages/web/src/stores/participant.ts:2641-2652).

22. **The second opt-in does not survive a clear.** Type `https://mutinynet.com/api` again and click `Use this endpoint`.
    Look for: the endpoint is active again and the broadcast checkbox reappears UNCHECKED.

23. **In-flight state.** In DevTools set network throttling to a slow profile, then enter `https://mempool.space/api` and click `Use this endpoint`. Turn throttling off afterwards.
    Look for: while the probe runs, the input and BOTH buttons are disabled and the line `Checking this endpoint…` renders, with no verdict sentence until the probe returns. The verdict it settles on is `Couldn't reach that endpoint.`, not a mismatch: this service is signet-family, so a required height-1 marker is never observed from a mainnet endpoint and the guard refuses rather than guessing (esplora.ts:176-178). That is documented refuse-on-unverifiable behavior, not a failure of this step.

24. **The log corroborates.** Still in tab A, expand `Technical detail` and read the activity log.
    Look for: a good-tone entry `reading the chain from https://mutinynet.com/api`, warn entries of the form `chain endpoint not used (mismatch)` and `chain endpoint not used (unreachable)`, and an info entry `reading the chain through this service`, in the order you performed those actions (participant.ts:2632, :2638, :2651).

25. **Fill the last seat and watch the note go.** Return to tab OP. In the `Members` card click `Fill remaining seats with test peers`.
    Look for: a warn-toned confirm headed `Add 1 test peers to this cohort?` with the body `They join the remaining seats and co-sign like any other participant. They are badged as test peers everywhere on this console.` and buttons `Add 1 test peers` and `Cancel`. Confirm it, then wait one poll and check that `Seats: 3/3.` and the seat-reclaim note is GONE. Record the exact singular wording you saw on the button, help line, and confirm (see fail signals).

### Pass

- Steps 5, 9 and 10: the cancel control (or its open confirm), the disabled `Finalize now` with its reason, and the seat-reclaim note render together, in that order, with the test-peer control below them, with no clipping, no overlap and no horizontal scrollbar, at both a normal width and 380px.
- Steps 6 and 9: the confirm body names the cohort's 8-character id and the seated count, and states that seats are lost, joining stops, and it will never anchor.
- Step 12: no funding card on this zero-chain boot, and its absence is silent.
- Steps 14 through 17: four refusals, four DIFFERENT sentences, each the documented one for that cause, none generic.
- Step 14: no network request at all for the non-https input.
- Steps 18, 20, 21, 22: an accepted endpoint activates and says so by host; a refused endpoint never activates and never displaces an active one; clearing returns the default state, clears the failure line, and drops the broadcast opt-in.
- Step 23: the in-flight state disables the field and both buttons and claims no result.
- Step 24: the activity log independently corroborates every state transition you observed.
- Step 25: the seat-reclaim note disappears once every seat is filled.

### Fail signals

- Any of the lifecycle elements pushes another off screen, is cut off, or produces a horizontal scrollbar at 380px.
- A `Close` or `Close cohort` button exists anywhere on the drill-down. Closing is automatic at the nth seat and must never be a control. (`Back to cohorts` at the top of the drill-down is navigation, not a cohort verb.)
- `Finalize now` is hidden rather than disabled-with-a-reason while the cohort is filling, or is enabled and clickable while the cohort is Advertised.
- The seat-reclaim note is missing at 1/3 or 2/3 seats, or is still present at 3/3.
- COPY DEFECT to report, not a blocker: at a seated count of one the confirm body reads `has 1 seated participants`. packages/web/src/components/operator/LifecycleActions.tsx:72-87 has a zero-seat variant and a plural variant, and no singular form. Record the exact string from step 6.
- COPY DEFECT to report, not a blocker: at one remaining seat the test-peer copy reads `Adds 1 in-process test participants ...`, `Add 1 test peers to this cohort?` and `Add 1 test peers` (packages/web/src/stores/operator.ts:312-328, same missing singular form). Record what you saw at step 25.
- Two of the four endpoint failures render the SAME sentence, or any renders a generic "something went wrong".
- A request appears in the Network panel for the non-https input at step 14.
- The mismatch message names only one chain, or names the wrong pair.
- A refused endpoint becomes the active one, or an active endpoint silently reverts to the service after a failure.
- The broadcast checkbox is checked by default, can be ticked with no endpoint active, or survives a clear.

### Limits

This does not exercise the finalize ceremony: the procedure deliberately stops at a partly filled cohort where `Finalize now` is correctly disabled, so the warn-toned confirm body is out of scope here (its availability rules are unit-pinned in packages/web/tests/lifecycle.spec.ts, the server verb by `pnpm e2e:fallback:operator`, and the enabled-state confirm belongs to the SVC-04 criterion 1 section of 05-UAT-CHECKLIST.md; no automated test renders that confirm body). It also does not exercise the genuinely worst case that includes funding: the funding stage card, the rung-4 funded cancel confirm, its type-to-confirm gate and its recovery-key line all need a `LIVE=1 BROADCAST=1` boot against a chain you control with real funds at the cohort's beacon address, so that denser block is unproven here. Steps 13 to 24 depend on outbound internet and on two third-party hosts behaving as they did on 2026-07-30, verified by direct request: `mutinynet.com/api` and `mempool.space/signet/api` answer `/block-height/0` and `/block-height/1` with permissive CORS and hashes matching packages/shared/src/networks.ts:115-143; `mutinynet.com/api/bogus` 404s WITH CORS; bare `mutinynet.com` answers HTML WITHOUT CORS. If a host changes behavior the verdict for that URL changes and the step's expectation is void, not failed. The browser-rejected versus unreachable split is best-effort by construction and documented as such (esplora.ts:14-31): a DNS failure renders as the browser-request sentence, which is the documented behavior rather than a defect. On a mutinynet service the mismatch sentence is only reachable from another signet-family endpoint; every non-signet chain lands on the unreachable sentence by design (esplora.ts:176-178). Truncation of a long host in the active-state line cannot be exercised, because only an endpoint that passes the chain check becomes active and no long-hostname mutinynet esplora exists; only the input's long-text behavior is checked (step 19). None of this touches the real-funds gates (mainnet acknowledgment, re-entrancy guard, funding minimum), which are the PART-05 section of 05-UAT-CHECKLIST.md and are unit-pinned in packages/web/tests/tx-client.spec.ts:456-513.

### Evidence for every quoted string

- LifecycleActions.tsx:44 `Cancel cohort`, :45 availability note, :48 `Keep it running`, :49 `Cancel this cohort?`, :56 `Finalize now`, :57 finalize reason, :72-87 rung-3 body, :150 `Lifecycle`, :163 and :191-204 the two wrapping control rows.
- CohortDetail.tsx:37 the 4s poll, :52-53 seat-reclaim note, :349 `Cohort ` heading, :369 LifecycleActions under the timeline, :373 and :380-382 `Members` and `Seats: n/m.`, :400-402 note render, :405-411 test-peer control, :416 `Submissions`, :430 `Co-sign`, :455-459 funding card gate, :463 `Anchor`, :486 `Activity`, :495 `Export`.
- stores/operator.ts:312-329 test-peer label, help, heading, confirm and cancel labels; :337 no-seats reason.
- lib/lifecycle.ts:43-58, :111-122, :138-143, :157-162 the predicates; shared/src/phases.ts:42-46 and :98-102 the phase sets.
- ui/primitives.tsx:289-356 ConfirmPanel (inline, heading, body, wrapping button row), :113-146 Input (`w-full`).
- cohort/CohortPage.tsx:240-243 keep-tab-open line, :248 panel mount, :250 `Technical detail`.
- cohort/ChainEndpointPanel.tsx:25, :28-29, :31-34, :36, :38, :41, :43-45, :48-51, :54-56, :59, :66-67, :109-113, :134-138.
- lib/esplora.ts:71-86, :95-110, :154-189, :196, :204-219.
- stores/participant.ts:2620-2639, :2641-2652, :2654-2660.
- operator/OperatorConsole.tsx:147 `New cohort`; CreateCohortForm.tsx:128, :150, :164, :195; OperatorCohortList.tsx:35-40 group headings, :170 `n/m seats`, :172 `Co-sign: k-of-n`, :184 `Advertise cohort`, :220-222 `Open`; LoginPanel.tsx:36 `Operator password`, :50 `Sign in`; HealthStrip.tsx:8-12 `Hermetic`, :104 service name, :113 network label; ServiceControls.tsx:212 `Service controls`.
- browse/CohortRow.tsx:80 `Join`; browse/JoinIdentityStep.tsx:164 `Generate a new identity`, :227 `Join cohort`.
- service/demo-server.ts:20-38 phase-timeout rationale, :38 and :47 the two 30 minute defaults, :446-450 operator-disabled banner, :531-538 boot lines, :566-569 HOST/COHORT_TTL_MS/PHASE_TIMEOUT_MS parsing; service/index.ts:674 and :680 discovery-window default and ceiling; hono-adapter.ts:1001 the test-peers route; package.json:43 `demo`.

---

<a id="test-6"></a>

## Test 6: Service controls card and the public paused notice, with rows and without

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (6 problem(s) found and corrected).

# Test 6: Service controls card and the public paused notice, with rows and without

Hermetic: yes. No LIVE, no BROADCAST, no chain, no internet.

## Preconditions

- Repo root is `/home/jintek/projects/github/@jintekc/btcr2-aggregation`.
- Nothing else is listening on port 8080:

  ```bash
  ss -ltnp | grep :8080
  ```

  should print nothing.
- Boot the service in one terminal and leave it running (`pnpm demo` runs `pnpm -r build` first, so no separate build step is needed):

  ```bash
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation
  OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" pnpm demo
  ```

  `OPERATOR_COOKIE_SECURE=0` is load-bearing: without it the operator session cookie carries `Secure` and will not be stored over plain http (packages/service/src/demo-server.ts:445).
- Wait for this line in the boot log before continuing (packages/service/src/demo-server.ts:537):

  `idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)`

- Open two browser tabs side by side: tab OP on `http://localhost:8080/operator`, tab PUB on `http://localhost:8080`. Keep a second terminal for curl. If either fails to connect, use `http://127.0.0.1:8080` instead: the service binds loopback only unless `HOST` is set.
- Poll cadences to keep in mind: the public directory refetches every 5s (packages/web/src/components/browse/DirectoryList.tsx:7) and the public status that carries the paused bit every 10s (packages/web/src/components/browse/BrowseView.tsx:12). Give tab PUB up to about 10 seconds to reflect a toggle.

## Steps

1. **Read the idle empty state, before creating anything.** In tab PUB there are two cards. The TOP card is the service identity header: a large heading showing this service's host, the name `Phase 5 check`, `Service online`, and a count line that also reads `No open cohorts right now` while zero cohorts are open. Ignore that top card for the rest of this test. The observable is the card DIRECTLY BELOW it, the directory card. Write down its two lines verbatim. Expect the heading `No open cohorts right now` and, under it, the body `This service isn't advertising any cohorts right now. Check back soon.`

2. **Sign in and read the controls card.** In tab OP enter `phase5` in the field labeled `Operator password` and press `Sign in`. Then read the `Service controls` card directly under the health strip. Expect, in this order: the title `Service controls`; the state line `New cohorts are being advertised normally.`; a `Pause advertising` button; a `Service settings` button; then two muted lines, `Pause, broadcast, and settings changes live in memory for this session. A restart returns this service to its boot environment.` and `Pausing does not end cohorts that are already open. Cancel each one if you need this service fully quiet.`; then an `Operator actions` section reading `No operator actions this session.` with a muted line under it. There is NO `Disable broadcast` button, because this service is not broadcasting.

3. **Pause, with no confirmation.** Click `Pause advertising` once. Expect no confirmation panel, modal, or type-to-confirm of any kind: the request goes straight out. The state line must not move until the service answers, and then it becomes `New cohorts are not being advertised. Cohorts already advertised keep filling, and everything else on this service keeps running.` and the button label becomes `Resume advertising`. A green-toned box reading `Advertising paused.` appears and clears itself after about 4 seconds. The `Operator actions` section switches from its empty text to a log list containing an entry reading `Paused advertising.` with a wall-clock time. (The button also dims while the request is in flight, but on a loopback service that window is too short to catch by eye. Do not treat a missed dim as a failure.)

4. **Check the health strip above the card.** A warn-toned chip `Advertising paused` has been ADDED to the strip. The neutral `Hermetic` mode chip is still there, unchanged, and the service name `Phase 5 check` and the network chip are still there. The paused chip replaced nothing.

5. **Check the wire.** In the second terminal run:

   ```bash
   curl -s localhost:8080/v1/status
   ```

   Expect JSON containing `"paused":true` alongside `"openCohorts":0` and `"up":true`.

6. **Read the paused empty state.** Switch to tab PUB and wait up to 10 seconds for the status poll. On the LOWER (directory) card the heading is still `No open cohorts right now`, but the body has changed to `This service isn't offering new cohorts right now. Check back soon.` Compare it word for word with what you wrote down in step 1: the two bodies must differ ("offering new cohorts" versus "advertising any cohorts"). The top identity card's count line is unchanged and is not the observable here.

7. **Confirm the pause gates only the advertise verb.** Back in tab OP click `New cohort`, then `Create draft`, accepting the prefilled threshold and size. The create form stays open after submitting, so scroll down to the `Drafts` group heading to find the new row. On that row, `Advertise cohort` is DISABLED and the line `Advertising is paused.` renders beside it. `Edit draft` and `Discard draft` are both still enabled and clickable.

8. **Resume.** Click `Resume advertising` on the `Service controls` card. The state line returns to `New cohorts are being advertised normally.`, the button returns to `Pause advertising`, a green box reads `Advertising resumed.` briefly, the `Operator actions` log gains an entry reading `Resumed advertising.`, and the `Advertising paused` chip disappears from the health strip. `Advertise cohort` on the draft row is enabled again with no reason line beside it.

9. **Advertise, and check the unpaused public view.** Click `Advertise cohort` on the draft. Tab OP switches to that cohort's drill-down: the cohort list is replaced, while the health strip and the `Service controls` card stay above it, and a `Back to cohorts` link returns to the list. Switch to tab PUB and wait up to 5 seconds. Expect the `Open cohorts` heading with one cohort row beneath it carrying an enabled `Join` button, and NO notice card of any kind above the heading.

10. **Pause with rows open.** Back in tab OP (still on the drill-down) click `Pause advertising`. Switch to tab PUB and wait up to 10 seconds. A notice card appears ABOVE the `Open cohorts` heading reading `This service isn't offering new cohorts right now. The cohorts below are already open, and you can still join one.` The heading and the cohort row still render BELOW it, and the row's `Join` button is still enabled.

11. **Narrow width.** In tab OP click `Back to cohorts` to return to the list view. Open DevTools, toggle the device toolbar, and set the viewport width to 380px. Scroll to the `Service controls` card. Its top row wraps onto multiple lines: the `Service controls` title, the paused state line, the `Resume advertising` button and the `Service settings` button are all fully visible and none is cut off. The health strip chips also wrap. The list view has no horizontal scrollbar.

12. **Resume and confirm both sides agree.** Set the viewport back to a normal width, close the device toolbar, and click `Resume advertising`. Switch to tab PUB and wait up to 10 seconds: the notice card above `Open cohorts` disappears while the cohort row keeps rendering exactly as before. Then run `curl -s localhost:8080/v1/status` again and expect `"paused":false` with `"openCohorts":1`.

## Pass

- Step 3: pause takes NO confirmation, and the state line only changes after the service answers.
- Step 2: both the restart-honesty line and the full-quiesce guidance are present, verbatim, on the card.
- Steps 3 and 8: each transition appends exactly one entry to the `Operator actions` log, `Paused advertising.` and `Resumed advertising.` respectively.
- Step 4: the `Advertising paused` chip is added BESIDE the `Hermetic` mode chip and never replaces it.
- Steps 1 and 6: on the directory card, the paused body and the idle body are visibly different sentences under the same heading, so a stranger can tell a deliberate pause from an idle service.
- Step 10: with open rows the paused notice sits ABOVE the `Open cohorts` heading and the list keeps rendering below it, still joinable.
- Steps 5 and 12: the `paused` bit on `GET /v1/status` agrees with what the console and the public directory show, in both directions.
- Step 7: the paused state disables only the advertise verb, with the reason beside it, and leaves every other draft control working.
- Step 11: on the list view the controls row wraps at 380px with no horizontal scrollbar and nothing clipped.

## Fail signals

- A confirmation panel, modal, or type-to-confirm appears when `Pause advertising` is clicked.
- The `Advertising paused` chip replaces the `Hermetic` mode chip, or the mode chip disappears while paused.
- The paused notice renders BELOW the list, or the cohort rows are suppressed or hidden while paused.
- On the directory card, the paused body is identical to the idle body (a stranger then cannot tell a pause from a dead service).
- A paused notice appears in tab PUB before `GET /v1/status` reports `"paused":true`, or persists after it reports false.
- `Advertise cohort` is enabled while paused, or is disabled with no reason line beside it, or `Edit draft` / `Discard draft` are disabled by the pause.
- The state line flips to paused and then flips back, which would mean an optimistic paint got rolled back.
- The `Operator actions` log records nothing for a transition, or records a second entry for a repeated click that changed nothing.
- On the list view at 380px the controls row overflows, clips a button, or produces a horizontal scrollbar.

## Limits

This does not observe the card's pre-first-read UNKNOWN state (no state line, no toggle, restart-honesty line only), because a successful sign-in triggers the first list read immediately (packages/web/src/stores/operator.ts:755); that window is pinned instead by packages/web/tests/service-controls.spec.ts. It does not exercise the failed-toggle path: the action-error line renders only when the pause request itself fails, which requires killing the service between the click and the response. Because the advertise button is DISABLED while paused, no click is sent, so the server's 409 refusal wording and the survival of the draft through a refusal are not proven here; `pnpm e2e:pause` covers both over real HTTP. The restart-honesty line's claim (a restart returns this service to its boot environment) is asserted on screen but not verified here; verifying it means restarting the process, which is the criterion-3 section of .planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md. Nothing here touches the broadcast kill switch, which is absent by design on a non-broadcasting boot and needs `LIVE=1 BROADCAST=1` to appear at all.

---

<a id="test-7"></a>

## Test 7: Settings surface composition, source captions, all-or-nothing save, and the long service-name backstop

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (8 problem(s) found and corrected).

## Test 7: Settings surface composition, source captions, all-or-nothing save, and the long service-name backstop

Hermetic: yes for everything except where a step says otherwise.

### Preconditions

- Repo root: `cd /home/jintek/projects/github/@jintekc/btcr2-aggregation`
- Nothing listening on 8080: `ss -ltn | grep ':8080' || echo free`
- Boot (hermetic default: no `LIVE`, no `BROADCAST`) from the repo root. `pnpm demo` runs `pnpm -r build` first, so the built SPA is served by the service itself on the same port:

  ```bash
  OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" DEFAULT_SIZE=2 pnpm demo
  ```

- A second terminal for `curl`, and a browser with devtools available. `python3` is used to generate long strings.
- `OPERATOR_COOKIE_SECURE=0` is required because you are on plain http on localhost; without it the session cookie is `Secure`-only and sign-in will not stick (`packages/service/src/demo-server.ts:444-445`, `packages/service/src/operator-auth.ts:249-255`).
- Use `127.0.0.1` rather than `localhost` in the browser: the service binds `127.0.0.1` only (`demo-server.ts:530`).

### Steps

1. **Wait for boot.** In the boot terminal, look for a line containing `service listening on http://127.0.0.1:8080 (minParticipants=2,` and a following line containing `idle until the operator advertises a cohort from the console` (`demo-server.ts:531-539`; the logger prefixes each line with `[demo] `). No cohort is advertised at boot, which is correct for Phase 5.

2. **Capture the boot snapshot the console will render from.** In the second terminal:

   ```bash
   curl -s -c /tmp/op.jar -X POST http://127.0.0.1:8080/v1/operator/login -H 'content-type: application/json' -H 'origin: http://127.0.0.1:8080' -d '{"password":"phase5"}'
   curl -s -b /tmp/op.jar http://127.0.0.1:8080/v1/operator/settings
   ```

   Look for: the first command prints `{"ok":true}`. The second prints a JSON object with exactly seven keys: `serviceName`, `defaultBeaconType`, `defaultSize`, `defaultThreshold`, `defaultDiscoveryWindowMs`, `defaultFundingWindowMs`, `termsText` (`packages/service/src/runtime-settings.ts:549-561`). Every one carries `"changed": false`. Values: `serviceName` `"Phase 5 check"`, `defaultBeaconType` `"CASBeacon"`, `defaultSize` `2`, `defaultThreshold` `2`, `defaultDiscoveryWindowMs` `1800000`, `defaultFundingWindowMs` `720000`, and `termsText` carries no `value` and no `envDefault` key at all (both are undefined and JSON drops them).

3. **Sign in to the console.** Open `http://127.0.0.1:8080/operator`. Type `phase5` into the field labelled `Operator password` and press `Sign in` (`packages/web/src/components/operator/LoginPanel.tsx:36,50`).

   Look for: the console renders. The health strip at the top shows a `Hermetic` chip, the text `Phase 5 check`, and a `Mutinynet (signet)` chip (`packages/web/src/components/operator/HealthStrip.tsx:9,104,113`; label from `packages/shared/src/networks.ts:117`). The strip may read `Checking mode` for a moment until the first gated read lands (`HealthStrip.tsx:94`). Check the STRIP chip, not the app header chip above it, which reads `Mutinynet (signet) · key-path Taproot` (`packages/web/src/App.tsx:106`).

4. **Open the settings view.** On the `Service controls` card, click the `Service settings` button (`packages/web/src/components/operator/ServiceControls.tsx:38,212`).

   Look for: a heading reading `Service settings` with a `Back to cohorts` ghost link on the same row (`SettingsView.tsx:194`, `stores/operator.ts:217`). The `Service settings` entry point disappears from the controls card while this view is open (`ServiceControls.tsx:229`). Note for the rest of this test: card titles, field labels and the source captions all render in letter-spaced CAPITALS (`ui/primitives.tsx:31-34` and `:245-250`, `SettingsView.tsx:376`); the heading does not. The wording is what is under test, never the casing.

5. **Read the two lines directly under the heading** (`SettingsView.tsx:202-203`).

   Look for, verbatim:
   - `Environment variables set these at boot. Changes here apply to this running service only, and a restart returns every value to its environment default.` (`stores/operator.ts:184-185`)
   - `Applies to new cohorts only. A cohort that is already advertised keeps the shape it was advertised with.` (`stores/operator.ts:63-64`)

6. **Read the card titles and field labels down the page.**

   Look for three cards: `This service` with one field `Service name`; `New cohort defaults` with `Default beacon type` (a dropdown offering `CAS` and `SMT`, `DraftEditForm.tsx:17-20`), `Default cohort size (n)`, `Default signing threshold (k)`, `Default discovery window (minutes)`; and `Participation terms` with one large text area also labelled `Participation terms` (`SettingsView.tsx:218,220,236,238,255,271,290,330,332`). `Default funding window (minutes)` is deliberately ABSENT on this hermetic boot: it renders only when the served mode is `live` (`SettingsView.tsx:144,309`). Its absence here is a pass, not a gap.

7. **Read the small caption at the bottom of each rendered field** (the last line inside each field block).

   Look for: all six rendered fields read `env default` (`SettingsView.tsx:27,43-45,376`). No field claims a change yet.

8. **Read the help lines under the `Participation terms` text area.**

   Look for its own help sentence `Leave empty for no terms step. When set, participants must accept these terms before joining, and their acceptance is recorded as a signed record.` (`SettingsView.tsx:342-345`), then two further captions, both present:
   - `These terms are enforced in this web app. A client that speaks the protocol directly can still opt in without accepting them.` (`stores/operator.ts:196-197`)
   - the 05-17 retention note: `Acceptances are kept in memory on this service and a restart clears them. Only the most recent few hundred are retained, oldest dropped first, and re-accepting for the same cohort replaces the earlier record.` (`stores/operator.ts:213-214`)

9. **Change four fields in one pass.** Set the beacon dropdown to `SMT`, `Default cohort size (n)` to 3, `Default signing threshold (k)` to 3, `Default discovery window (minutes)` to 10. Press `Save settings`.

   Look for: a green confirmation reading `Settings updated for this session.` (`stores/operator.ts:188`), which clears itself after about four seconds (`stores/operator.ts:1201-1205`). The button label swaps to `Saving…` while the request is in flight (`SettingsView.tsx:21,24,360`); on a hermetic service this may be too brief to catch, so its absence is not a failure.

10. **Re-read the source caption on each of those four fields.**

    Look for: beacon type `changed this session (environment default: CASBeacon)`; size `changed this session (environment default: 2)`; threshold `changed this session (environment default: 2)`; discovery window `changed this session (environment default: 30 min)` (`SettingsView.tsx:43-45,53-55`). `Service name` and `Participation terms` still read `env default`.

11. **Cross-check that the caption reports SERVED state, not a browser guess.**

    ```bash
    curl -s -b /tmp/op.jar http://127.0.0.1:8080/v1/operator/settings
    ```

    Look for: `defaultBeaconType` value `SMTBeacon` changed true; `defaultSize` value 3 changed true; `defaultThreshold` value 3 changed true; `defaultDiscoveryWindowMs` value 600000 changed true. `serviceName`, `defaultFundingWindowMs` and `termsText` all still changed false (the funding key is omitted from the patch entirely on a non-broadcasting service, `SettingsView.tsx:102`). Every `envDefault` still holds its boot value.

12. **Set the three numeric fields BACK to their boot values:** size 2, threshold 2, discovery window 30. Leave the beacon dropdown on `SMT`. Press `Save settings`.

    Look for: the confirmation again; the size, threshold and discovery-window captions revert to `env default`; the beacon-type caption still reads `changed this session (environment default: CASBeacon)`. This is the point of the check: `changed` is derived live as `!Object.is(value, envDefault)` on every read (`runtime-settings.ts:406`), not a sticky flag.

13. **Prove the discovery-window ceiling is real.** Set `Default discovery window (minutes)` to 40 and press `Save settings`.

    Look for: a red inline error reading `This service ends a cohort after 30 minutes, so the discovery window must be 30 minutes or less.` (`packages/service/src/operator-cohorts.ts:172-175`, ceiling seeded from `cohortTtlMs`, `packages/service/src/index.ts:674-680`). No caption changes. Re-run the curl from step 11 and confirm `defaultDiscoveryWindowMs` is still 1800000. This is a SERVER refusal: the client deliberately does not know the ceiling (`packages/web/src/lib/cohort-form.ts:122-125`). Reset the field to 30 before continuing.

14. **Client-side refusal leg.** Open devtools and select the Network tab. Set `Default cohort size (n)` to 2 and `Default signing threshold (k)` to 5, then press `Save settings`.

    Look for: a red inline error reading `Signing threshold must be a whole number between 1 and the cohort size.` (`packages/web/src/lib/cohort-form.ts:34`) and NO request to `/v1/operator/settings` in the Network tab. This proves the FORM refused; it does not prove the service applies nothing. Reset threshold to 2.

15. **Server-side all-or-nothing leg (this is the one that proves the checkpoint claim).** Generate a 201-character name in the second terminal with `python3 -c "print('N'*201)"` and paste it into `Service name`. In the SAME save, also change the beacon dropdown from `SMT` back to `CAS`. Press `Save settings`.

    Look for: a red inline error reading `Service name must be 200 characters or fewer.` (`packages/service/src/runtime-settings.ts:277,480-482`). The `Service name` caption still reads `env default` and the beacon-type caption still reads `changed this session (environment default: CASBeacon)`, meaning the valid sibling field in the same save was NOT applied (`runtime-settings.ts:474-546`, validate-all-then-apply). The input boxes keep the text you typed: the form re-seeds only when a NEW snapshot lands (`SettingsView.tsx:158-163`). Confirm with the curl from step 11 that `serviceName` is still `"Phase 5 check"` and `defaultBeaconType` is still `"SMTBeacon"`.

16. **Read the operator actions log.** Click `Back to cohorts`, then wait up to about four seconds. The list poll that feeds this log runs only on the list view (`OperatorConsole.tsx:51-57`), `saveSettings` never refreshes it (`stores/operator.ts:1189-1218`), and `closeSettings` does not force an immediate read, so the log is stale until the next 4-second tick (`OperatorConsole.tsx:13`). Read the `Operator actions` log on the `Service controls` card (`stores/operator.ts:285`).

    Look for: the counter reading `7 events` (`components/LogPanel.tsx:50`), oldest first. From the step-9 save, in this order: `Changed the default beacon type.`, `Changed the default cohort size.`, `Changed the default signing threshold.`, `Changed the default discovery window.` Then from the step-12 save, three more: `Changed the default cohort size.`, `Changed the default signing threshold.`, `Changed the default discovery window.` (texts from `hono-adapter.ts:150-158` plus `monitor.ts:124`; only a repeat of the IMMEDIATELY previous entry is de-duplicated, so these repeats are correct). No entry names the service name or the participation terms, because neither moved. The two refused saves (steps 13 and 15) contributed nothing.

17. **Long-name backstop, realistic name.** Return to `Service settings`. Generate a 200-character name made of ordinary words:

    ```bash
    python3 -c "print(('Phase 5 aggregation service for regression checks ' * 5)[:199] + '.')"
    ```

    Paste it into `Service name`, press `Save settings`, then RELOAD the browser page. A reload is required: the name reaches both surfaces through `GET /v1/config`, which the SPA reads once on mount (`App.tsx:39-41`, `hono-adapter.ts:629-638`).

    Look for: the save succeeds. After the reload the health strip shows the whole 200-character name as plain text, wrapping onto extra lines inside the strip card, with the `Hermetic`, `Mutinynet (signet)` and `IPFS off` chips still visible on screen (`HealthStrip.tsx:93,104,113,139`).

18. **Measure the console layout.** With devtools open on the console page, run in the JS console:

    ```js
    [window.innerWidth, document.documentElement.scrollWidth, document.documentElement.clientWidth]
    ```

    Look for: scrollWidth equal to clientWidth. Any positive difference means the long name pushed the layout wider than the viewport, which is a FAIL of the backstop for a name that contains ordinary break opportunities.

19. **Measure the public surface.** Open `http://127.0.0.1:8080` in a second window and reload it.

    Look for: the same 200-character name as plain muted text above the origin heading, with the `Mutinynet (signet)` chip still on screen beside it (`components/browse/ServiceIdentityHeader.tsx:37,48,58`). Run the same measurement in that window and expect scrollWidth equal to clientWidth.

20. **Unbroken-token stress probe (record, do not assume).** Back in `Service settings`, replace the name with a single unbreakable token:

    ```bash
    python3 -c "print('Aggregation-Service-' + 'X'*180)"
    ```

    Save, reload both windows, and record `[window.innerWidth, document.documentElement.scrollWidth, document.documentElement.clientWidth]` on each.

    Look for: the exact numbers, not a pass/fail guess. Be aware of what the code supports before you judge it: neither render site sets a wrapping style (`HealthStrip.tsx:104`, `ServiceIdentityHeader.tsx:48`), while the comparable operator-supplied terms body does (`components/browse/TermsStep.tsx:101`, `whitespace-pre-wrap break-words`), and `flex-wrap` wraps between flex items rather than inside one word. A 180-character run with no space or hyphen therefore has no break opportunity and is expected to widen the page at a typical window width. If scrollWidth exceeds clientWidth here, that is a genuine finding about the two service-name render sites, not a mis-run test. Record the window width with it, because the outcome depends on it.

21. **Boot-seed path beyond the runtime cap.** Stop the service (Ctrl+C) and reboot with a name longer than any runtime save would accept:

    ```bash
    SERVICE_NAME=$(python3 -c "print('Aggregation-Service-' + 'X'*380)") OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 pnpm demo
    ```

    Then run `curl -s http://127.0.0.1:8080/v1/config`.

    Look for: a `serviceName` 400 characters long, uncapped. The 200-character limit applies to a runtime SAVE only (`runtime-settings.ts:480-482`); the boot seed is only trimmed (`runtime-settings.ts:284-288,387`).

22. **Confirm nothing persisted across the restart, then re-observe both surfaces.** Reload `http://127.0.0.1:8080/operator` and sign in again with `phase5`: the session store is per-service (`packages/service/src/index.ts:689-699`), so the old cookie is dead and the login panel is what you will see first. Then, in the second terminal:

    ```bash
    curl -s -c /tmp/op2.jar -X POST http://127.0.0.1:8080/v1/operator/login -H 'content-type: application/json' -H 'origin: http://127.0.0.1:8080' -d '{"password":"phase5"}'
    curl -s -b /tmp/op2.jar http://127.0.0.1:8080/v1/operator/settings
    ```

    Look for: every field reports `"changed": false`, `defaultBeaconType` is back to `CASBeacon` and `defaultSize` is back to 2 (this boot sets no `DEFAULT_SIZE`, so the built-in 2 applies), proving the SMT default set at step 9 did not survive the restart, exactly as the model line in step 5 promised. Then load `http://127.0.0.1:8080` and the signed-in console and record the same measurement from step 20 on both. The 400-character token is the same unbroken-token case as step 20 and is judged the same way.

23. **Markup probe.** Stop the service and reboot with a name that is markup:

    ```bash
    SERVICE_NAME='<b>x</b>' OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 pnpm demo
    ```

    Load `http://127.0.0.1:8080`, and sign in at `http://127.0.0.1:8080/operator`. In each window's JS console run:

    ```js
    [...document.querySelectorAll('a')].filter((a) => a.textContent.includes('<b>x</b>') || a.getAttribute('href')?.includes('x')).length
    ```

    Look for: the literal characters `<b>x</b>` shown as text on the health strip and above the public origin heading, not a bold `x`, and the filter above returning 0. React renders both sites as escaped text content (`HealthStrip.tsx:96-104`, `ServiceIdentityHeader.tsx:39-48`).

### Pass

- All six fields the hermetic boot renders start captioned `env default`, and the two model lines are present verbatim under the heading.
- A changed field captions as `changed this session (environment default: {boot value})` with the correct boot value, including `30 min` for the discovery window and `CASBeacon` for the beacon type.
- A field set back to its boot value returns to `env default` while a still-changed sibling keeps its changed caption.
- A save containing one invalid field applies NO field, proven by the valid sibling (the beacon type in step 15) staying at its previously served value in both the caption and `GET /v1/operator/settings`.
- The discovery-window ceiling is refused at save with the real maximum named in minutes.
- The operator-actions log holds exactly the seven entries the two successful saves produced, with no entry for a field that did not move and none for the two refused saves.
- A 200-character service name made of ordinary words renders as plain escaped text on both the console health strip and the public directory header, wrapping rather than widening, with scrollWidth equal to clientWidth on both pages and the mode and network chips still on screen.
- A markup service name renders as literal characters and never as an element or a link.
- After a restart, every setting reports `changed: false` at its boot value.
- The 05-17 retention note is present under the `Participation terms` setting, verbatim.

### Fail signals

- Any caption reading `changed this session` for a field whose value equals its boot value, or `env default` for a field that was changed and saved.
- The environment default named inside a caption disagreeing with `envDefault` in `GET /v1/operator/settings`.
- A rejected save moving ANY field: a caption changing, or `GET /v1/operator/settings` showing the valid sibling applied.
- A 400 response leaving the console showing a value the service does not hold (a half-saved surface).
- The operator-actions log naming a field that did not move, or missing one that did, or recording anything for the two refused saves.
- A horizontal page scrollbar, or a mode or network chip pushed out of the viewport, with the ordinary-words 200-character name of step 17.
- The service name appearing as a link, as bold or italic markup, or with the literal angle brackets stripped.
- The retention note or the app-level enforcement caption missing from the participation-terms field.
- Any setting surviving the step 21 restart.

### Limits

This walkthrough cannot exercise `Default funding window (minutes)`: it renders only when the served mode is `live` (a real broadcasting boot, `LIVE=1 BROADCAST=1` against a chain you control, `SettingsView.tsx:144,309`), so on a hermetic boot only one of the two windows is testable through the UI. The served snapshot still carries `defaultFundingWindowMs` via curl, but that field's rendering, its source caption and its clear-to-null behavior are unverified here (its omission from the patch is covered by a unit test at `packages/web/tests/settings.spec.ts:156`, not by this procedure). Step 14 proves only that the FORM refuses before sending; only step 15 proves the SERVICE applies nothing, so do not treat step 14 as evidence of the all-or-nothing contract. Steps 20 and 22 are stress observations, not pass criteria: their outcome depends on window width, and neither service-name render site sets a wrapping style, so a positive scrollWidth delta there is a finding to file rather than a test error. Every layout measurement is a single browser at a single zoom and window width, not a responsive-design guarantee. No automated test covers the rendered composition of this view (recorded as a known gap in `.planning/phases/05-operator-cohort-lifecycle-control/05-07-SUMMARY.md:187`), so a layout regression here would be caught only by this walkthrough.

---

<a id="test-8"></a>

## Test 8: Participation terms join step with a long body and unbroken tokens at a narrow viewport

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (8 problem(s) found and corrected).

## Test 8: Participation terms join step with a long body and unbroken tokens at a narrow viewport

Hermetic. No chain, no wallet, no funds.

### Preconditions

1. Repo root:

   ```bash
   cd /home/jintek/projects/github/@jintekc/btcr2-aggregation
   ```

2. Port 8080 free:

   ```bash
   ss -ltn | grep ':8080' || echo free
   ```

3. Build the long terms document into an env file (copy-paste the whole block):

   ```bash
   python3 - <<'PY' > /tmp/terms-env.sh
   import shlex
   lines = [
     'Terms of participation, version 1.', '',
     'Markup probe: <b>bold?</b> <script>alert(1)</script> <a href="https://evil.example">link?</a>', '',
     'Unbroken URL: https://example.com/terms/' + 'a' * 400, '',
     'Unbroken token: ' + 'X' * 300, '',
   ]
   for i in range(1, 121):
       lines.append(f'{i}. This service aggregates did:btcr2 updates into an n-of-n MuSig2 beacon transaction. Participation is at your own risk and confers no warranty of any kind.')
   print('export TERMS_TEXT=' + shlex.quote('\n'.join(lines)))
   PY
   ```

   This produces a 19,982-character document.

4. Boot hermetically with those terms and an operator password. `pnpm demo` runs `pnpm -r build` first, so allow a couple of minutes on a cold tree. The operator must advertise a cohort before anyone can join: there is no auto-advertise loop.

   ```bash
   source /tmp/terms-env.sh
   OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Terms check" pnpm demo
   ```

5. A browser with devtools. Keep the terminal that ran `source` open: step 15 has to undo that export deliberately.

6. Why the boot seed and not the console: `PUT /v1/operator/settings` is bounded at a 4 KiB request body (`hono-adapter.ts:904`) and the terms field at 20,000 characters (`runtime-settings.ts:278`), so a 19,982-character document can only reach the service through `TERMS_TEXT`. The boot seed is not length-capped (`runtime-settings.ts:393` trims only).

### Steps

1. **Confirm the service is serving the terms.**

   ```bash
   curl -s http://localhost:8080/v1/config | python3 -c "import json,sys; d=json.load(sys.stdin); print(sorted(d)); print('terms chars', len(d.get('termsText','')))"
   ```

   Look for: the key list contains `termsText`, `serviceDid` and `serviceName` (alongside `network`, `label`, `isMainnet`), and the count reads `terms chars 19982`. If `termsText` is missing, the boot did not pick up the env var and every later step falsely passes as "no terms step".

2. **Advertise a cohort as the operator.** Open http://localhost:8080/operator, sign in with `phase5`, click `New cohort`, leave the shape at its defaults (size 2, threshold 2), click `Create draft`, then click `Advertise cohort` on the resulting draft row.

   Look for: the console lands in the freshly advertised cohort's drill-down. Confirm the public directory now carries it:

   ```bash
   curl -s http://localhost:8080/v1/directory | python3 -m json.tool
   ```

   One entry, with `"phase": "Advertised"`, `"joined": 0`, `"capacity": 2`.

3. **Open the participant surface at a narrow, short viewport.** In a second browser window go to http://localhost:8080, open devtools, toggle the device toolbar, set a custom size of 390 x 640, and reload.

   Look for: the service identity header, then a section headed `Open cohorts` with one row.

4. **Click the row's `Join` button.**

   Look for: the inline join step replaces the list. At the TOP of it, above the identity controls, is a section headed `Participation terms` containing a bordered box of terms text.

5. **Measure the container.** Paste into the JS console of that window:

   ```js
   (() => { const b = document.querySelector('.max-h-64.overflow-auto');
     return { clientH: b.clientHeight, scrollH: b.scrollHeight,
       scrollsVertically: b.scrollHeight > b.clientHeight + 1,
       boxOverflowsX: b.scrollWidth > b.clientWidth + 1,
       pageOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()
   ```

   Look for: `clientH` at or under 256 (expect 254: `max-h-64` is 256px on a border-box element with a 1px border), `scrollH` in the thousands, `scrollsVertically` true, `boxOverflowsX` false, `pageOverflowsX` false. `boxOverflowsX` true is an unambiguous FAIL: the 400-character URL or the 300-character token escaped the container. `pageOverflowsX` true with `boxOverflowsX` false means something ELSE on the join screen is too wide at 390px, so find the offender before recording a terms failure:

   ```js
   (() => [...document.body.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 5).map(e => e.className))()
   ```

6. **Run the markup and link probes.**

   ```js
   (() => { const b = document.querySelector('.max-h-64.overflow-auto');
     return { boldEl: b.querySelector('b'), scriptEl: b.querySelector('script'), anchorEl: b.querySelector('a'),
       literalMarkupShown: b.textContent.includes('<b>bold?</b>') && b.textContent.includes('<a href="https://evil.example">link?</a>') }; })()
   ```

   Look for: `boldEl`, `scriptEl` and `anchorEl` all null, `literalMarkupShown` true. Visually, the box shows the characters `<b>bold?</b>` and the `<a href=...>` string as ordinary text: nothing bold, nothing clickable.

7. **Scroll test.** Put the pointer inside the terms box and scroll, then move it outside the box and scroll.

   Look for: scrolling inside moves the terms text through its own scroll region while the rest of the card stays put; scrolling outside moves the page; the terms box never grows to fit its content.

8. **Read the elements below the terms box.** In order: a checkbox whose label reads `I accept these terms.`, then a small caption reading `Accepting signs a short record with your DID so this service can show that you agreed. The signing happens in this browser and your private key never leaves it.`, then, as the LAST line of the terms section (directly above the heading `Choose an identity to join`), the caption `These terms are enforced in this web app. A client that speaks the protocol directly can join without this step.`

9. **Get an identity.** Scroll past the terms step to the identity controls and click `Generate a new identity`.

   Look for: a `did` value appears in a copy field (plus a `secret (save to re-import)` field), and a `Join cohort` button appears with `Use a different identity` and `Cancel` beside it. `Join cohort` is DISABLED and the text `Accept the terms to join.` sits next to it.

10. **Confirm the join controls are reachable at 390 x 640.** Without resizing, scroll the page to the bottom, then run:

    ```js
    (() => { const btns = [...document.querySelectorAll('button')].filter(e => e.textContent.trim() === 'Join cohort');
      const r = btns[0].getBoundingClientRect();
      return { found: btns.length, top: Math.round(r.top), bottom: Math.round(r.bottom),
        insideViewport: r.top >= 0 && r.bottom <= window.innerHeight, disabled: btns[0].disabled }; })()
    ```

    Look for: `found` 1, `insideViewport` true after scrolling, `disabled` true. A `Join cohort` button that cannot be brought into view by scrolling at 390 x 640 is a FAIL of the backstop.

11. **Tick the `I accept these terms.` checkbox.**

    Look for: `Join cohort` becomes enabled and the `Accept the terms to join.` text disappears.

12. **Join.** Open the devtools Network tab, then click `Join cohort`.

    Look for: the button reads `Joining…` and is disabled while the acceptance is signed and recorded. A `POST /v1/terms/acceptance` appears in the Network tab and answers 200 with a body of the shape `{"hash":"<64 hex chars>"}`. The view then moves on to the cohort page for the joined cohort.

13. **Read the stored artifact and check the hash binding.** Copy the hash from that response and substitute it below:

    ```bash
    curl -s http://localhost:8080/cas/acceptance/<hash> | python3 -m json.tool
    curl -s http://localhost:8080/v1/config | python3 -c "import json,sys,hashlib; print('served terms sha256', hashlib.sha256(json.load(sys.stdin)['termsText'].encode()).hexdigest())"
    ```

    Look for: a JSON record with `@context`, `type: "ParticipationTermsAcceptance"`, `serviceDid`, `cohortId`, `termsHash`, `participantDid` and `acceptedAt`. The full terms TEXT is absent: the record binds the hash of what was shown, never the document. The `termsHash` field must equal the `served terms sha256` printed by the second command.

14. **Repeat at desktop width.** Disable the device toolbar, reload http://localhost:8080, and click `Join` on the still-open cohort row (it is 1/2 seats and still `Advertised`, so it is still joinable; the browser holds no persisted identity, so the join step starts fresh).

    Look for: the same terms step, still capped and scrolling. Re-run the step 5 snippet and expect the same result. The cap is not small-screen-only behavior. Do NOT click `Join cohort` here; the row inspection is the whole check.

15. **Negative control: no terms at all.** Stop the service with Ctrl+C, then, IN THE SAME TERMINAL, remove the exported variable before rebooting (the `source` in the preconditions exported it, so a plain reboot would still serve terms):

    ```bash
    unset TERMS_TEXT
    OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 pnpm demo
    ```

    Prove the service really has no terms before looking at the UI:

    ```bash
    curl -s http://localhost:8080/v1/config | python3 -m json.tool
    ```

    There must be NO `termsText` key at all (absent, not empty). Then: reload http://localhost:8080/operator, sign in again with `phase5` (the restart wiped the session, the draft and the cohort), click `New cohort`, `Create draft`, `Advertise cohort`. Reload the participant window and click `Join` on the row.

    Look for: NO `Participation terms` section at all: no heading, no empty box, no checkbox, no honest-limit caption. After generating an identity, `Join cohort` is enabled immediately with no reason text beside it. This proves the step is absent rather than empty when no terms are set.

### Pass

- The terms body renders inside a container capped at `max-h-64` (clientHeight at or under 256, expect 254) that scrolls internally, no matter how long the document is.
- Unbroken tokens (a 400-character URL and a 300-character token) wrap inside the container: the container does not scroll horizontally, and the page gains no horizontal scrollbar attributable to it.
- Operator-supplied markup renders as literal text: no `<b>`, `<script>` or `<a>` element exists inside the terms container, and the raw angle-bracket text is visible.
- At 390 x 640 the checkbox, the `Join cohort` button, its disabled reason and the honest-limit caption are all reachable by scrolling the page.
- The disabled reason `Accept the terms to join.` sits beside the disabled join control, and ticking the box enables the control.
- The caption `These terms are enforced in this web app. A client that speaks the protocol directly can join without this step.` is visible as the last line of the terms section.
- `POST /v1/terms/acceptance` answers 200 with a hash; the stored record names a `termsHash` equal to sha256 of the served terms text, and never carries the terms text.
- With `TERMS_TEXT` unset and `termsText` absent from `/v1/config`, the step does not render at all.

### Fail signals

- `clientHeight` growing past 256 with the document (no cap), or `scrollHeight` equal to `clientHeight` (no internal scroll).
- `b.scrollWidth` greater than `b.clientWidth` on the terms container at any point on the join screen.
- `document.documentElement.scrollWidth` greater than `clientWidth` WITH the terms container also overflowing horizontally (page overflow alone, with the box clean, is a separate layout bug: name the offending element before calling it a terms failure).
- `querySelector('b')`, `('script')` or `('a')` returning a node inside the terms container, or the markup probe rendering as formatting instead of as characters.
- The `Join cohort` button clipped off-screen with no way to scroll to it at 390 x 640.
- A disabled join control with no reason text beside it.
- The honest-limit caption missing, or reworded into a claim that the protocol enforces acceptance.
- `POST /v1/terms/acceptance` answering 400 with `{"error":"acceptance refused"}` on a well-formed accept (check the service log for the real reason: every refusal returns that one body on purpose).
- The stored `termsHash` not matching sha256 of the served terms text.
- A terms step appearing on a service that set no terms (after confirming `/v1/config` really has no `termsText`).

### Limits

This proves rendering and layout at the two viewports you actually test, in one browser, at one zoom level and one font stack; it is not a responsive-design or cross-browser guarantee. The escaping evidence is a DOM observation plus the source-level guarantee that the component contains no HTML-injection prop and no `href` (pinned in `packages/web/tests/terms.spec.ts:155-180`); it says nothing about any other render site. It cannot prove the terms are enforced at the protocol level, and they are not: a headless client speaking the aggregation protocol joins a cohort without ever calling `POST /v1/terms/acceptance`, which is exactly what the honest-limit caption states (`pnpm e2e:browse` joins with no acceptance at all). It does not exercise the console as the source of the terms, because a 19,982-character document cannot fit the 4 KiB settings body. Nothing here touches a chain, a wallet or funds. Finally, the acceptance namespace is bounded at 200 records and evicts oldest-first (`packages/service/src/acceptance-ledger.ts:11,95-103`), so a hash captured here can stop resolving later; that is designed behavior disclosed in the operator's settings help, not a failure of this test.

### Source evidence

- `packages/web/src/components/browse/TermsStep.tsx:39-49` (TERMS_COPY: `Participation terms`, `I accept these terms.`, signature disclosure, `Accept the terms to join.`, `acceptance record`, honest limit), `:100-101` (`max-h-64 overflow-auto` container, `whitespace-pre-wrap break-words` plain-text child), `:106-115` (checkbox and label as one click target), `:117` and `:133` (disclosure and honest-limit render), `:65-67` (absent/empty/whitespace means no step).
- `packages/web/src/components/browse/JoinIdentityStep.tsx:122` (TermsStep mounted above the identity step), `:124` (`Choose an identity to join`), `:163-164` (`Generate a new identity`), `:226-231` (`Join cohort`, `Joining…`, disabled reason beside it), `:232-237` (`Use a different identity`, `Cancel`).
- `packages/web/src/components/browse/CohortRow.tsx:79-80` (`Join`), `DirectoryList.tsx:172` (`Open cohorts`), `BrowseView.tsx:161-176` (join step replaces the list; active lifecycle renders the cohort page).
- `packages/service/src/hono-adapter.ts:788-790` (`POST /v1/terms/acceptance`, 16 KiB bodyLimit), `:807` (200 `{hash}`), `:810` and `:210` (400 `{"error":"acceptance refused"}`), `:629-638` (`serviceName`, `serviceDid`, `termsText` ride `GET /v1/config` additively), `:904` (PUT settings bounded at 4 KiB).
- `packages/service/src/runtime-settings.ts:278` (MAX_TERMS_CHARS 20000, enforced on the PUT patch path at `:533`, not on the boot seed at `:393`), `demo-server.ts:430-432` (TERMS_TEXT trimmed to undefined).
- `packages/service/src/store.ts:32` (the `acceptance` artifact kind), `:326` and `:353` (`GET /cas/:kind/:hash`), `packages/shared/src/tos.ts:74-82,134-136` (frozen field set; termsHash is sha256 of the exact text).
- `packages/web/src/components/operator/OperatorConsole.tsx:147` (`New cohort`), `CreateCohortForm.tsx:195` (`Create draft`), `CreateCohortForm.tsx:16-18` (shipped defaults size 2, threshold 2), `OperatorCohortList.tsx:184` (`Advertise cohort`), `packages/web/src/stores/operator.ts:952-963` (advertise lands in the drill-down).
- Live confirmation on this tree: `/v1/config` served `['isMainnet','label','network','serviceDid','serviceName','termsText']` with `terms chars 19982`; `/v1/directory` returned `"phase": "Advertised"`; a signed acceptance POST answered 200 and `GET /cas/acceptance/<hash>` returned the seven-field record whose `termsHash` equalled sha256 of the served terms text.

---

<a id="test-9"></a>

## Test 9: Test peers rehearsal: the drill-down control, its help line, its zero-seat refusal, its rung-2 confirm, and the live-only registration-skip note

> Hermetic: **no**. Audit verdict: NEEDS_FIX (8 problem(s) found and corrected).

### Test 9: Test peers rehearsal (drill-down control, help line, zero-seat refusal, rung-2 confirm, live-only registration-skip note)

Steps 1 through 18 run on the DEFAULT zero-chain boot. Steps 19 through 25 are LIVE ONLY and cannot be reached hermetically: the extra confirm line and the skip note are gated on the served mode being `live`, which `demo-server` produces only under `LIVE=1` plus `BROADCAST=1` (`packages/service/src/demo-server.ts:338-346,500-501`; `mode = broadcaster ? 'live' : live ? 'live-no-broadcast' : 'hermetic'` at `packages/service/src/index.ts:1041`).

## Preconditions

- Nothing else is listening on port 8080. Check with: `ss -ltn | grep ':8080'`
- Use a Chromium-based browser (Chrome, Chromium, or Edge), the same one you use for Test 10.
- Use the host `127.0.0.1`, not the name `localhost`. The demo server binds `127.0.0.1` by default (`packages/service/src/demo-server.ts:530`) and on an IPv6-first machine `localhost` can resolve to `::1`, which is not bound.
- Leave `TERMS_TEXT` unset. With terms configured the join flow gains a terms step this procedure does not describe.
- **Do not click the participant's submit button until step 17 is finished.** The server's seat-cap refusal (step 16) is only reachable while the cohort is still live in the runner session; submitting completes the cohort and changes the honest answer from 409 to 404 (`packages/service/src/index.ts:1325-1330`, `packages/service/src/hono-adapter.ts:1021-1027`, and the same either-or is asserted in `e2e/operator-cohort.ts:1359-1363`).
- Work through steps 3 to 17 within about 25 minutes of advertising: the per-phase stall timeout and the cohort TTL both default to 30 minutes (`packages/service/src/demo-server.ts:38,47`).
- HERMETIC BOOT (own terminal, leave it running):

  ```bash
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation && OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 test peers" pnpm demo
  ```

- `OPERATOR_COOKIE_SECURE=0` is required for a plain-http run, otherwise the session cookie carries `Secure` and the browser drops it (`packages/service/src/demo-server.ts:237-241,444-445`).

## Steps

1. **Boot.** Run the hermetic boot command and wait for the build plus boot to finish.
   Look for: the last two log lines read `[demo] service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))` and `[demo] idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)` (`packages/service/src/demo-server.ts:531-539`). There is NO line beginning `!!! LIVE + BROADCAST`.

2. **Sign in.** Open http://127.0.0.1:8080/operator . Type `phase5` into the field labelled `Operator password` and click `Sign in` (`packages/web/src/components/operator/LoginPanel.tsx:36,50`).
   Look for: the login card is replaced by the console. Within a second or two of the first list read the health strip shows a neutral chip reading `Hermetic` (`packages/web/src/components/operator/HealthStrip.tsx:8-12`). `Checking mode` on the first frame is correct, not a failure (`HealthStrip.tsx:57-59,94`); it must not settle on `Live` or `Live (no broadcast)`.

3. **Create the draft.** Click `New cohort` (`packages/web/src/components/operator/OperatorConsole.tsx:147`). In the form headed `Create a cohort`, set `Signing threshold (k)` to 3 and `Cohort size (n)` to 3, leave `Beacon type` and the advanced timing fields alone, and click `Create draft` (`packages/web/src/components/operator/CreateCohortForm.tsx:128,139,150,164,195`).
   Look for: scrolling below the form, a row appears under the `Drafts` heading showing `0/3 seats` (`packages/web/src/components/operator/OperatorCohortList.tsx:38,169-171`). The create form stays open; that is expected.

4. **Advertise, and note where it lands you.** On that draft row click `Advertise cohort` (`OperatorCohortList.tsx:184`).
   Look for: the console navigates STRAIGHT INTO the new cohort's drill-down (`packages/web/src/stores/operator.ts:959-966`, `1220-1230`). You do not click `Open` here. The page shows a heading `Cohort <first 8 characters>…`, a stage timeline, a `Lifecycle` card (`packages/web/src/components/operator/LifecycleActions.tsx:150`), and a `Members` card reading `No one has joined yet. Seats: 0/3.` (`packages/web/src/components/operator/CohortDetail.tsx:349,373-377`).

5. **Copy the live cohort id.** Copy the value from the `cohort id` field near the top of the drill-down (`CohortDetail.tsx:350`) into a scratch buffer.
   Look for: this is a NEW server-minted id. Advertising deletes the draft and mints a live cohort, so a draft id copied earlier is the wrong value and would 404 in step 16.

6. **Join once as a human.** In a SECOND browser window open http://127.0.0.1:8080 , find the row whose `Cohort ID` matches what you copied, and click `Join` (`packages/web/src/components/browse/CohortRow.tsx:80,100`). On the identity step click `Generate a new identity`, then click `Join cohort` (`packages/web/src/components/browse/JoinIdentityStep.tsx:164,227`). Keep the DID shown in that window's `did` field visible for step 11.
   Look for: within about 4 seconds (the drill-down poll interval, `CohortDetail.tsx:37`) the operator drill-down `Members` card reads `Seats: 1/3.` and lists one seated member row.

7. **Read the control and its help line WITHOUT clicking.** Scroll to the bottom of the `Members` card.
   Look for: a ghost button reading exactly `Fill remaining seats with test peers` (`packages/web/src/stores/operator.ts:312`, rendered at `CohortDetail.tsx:201-203`). Beside it the help line reads exactly: `Adds 2 in-process test participants so you can rehearse this service on your own. They use throwaway keys created inside this process.` (`operator.ts:313-315`). Directly above the control a separate muted line reads: `A single seat can't be released. If someone joined and went quiet, cancel this cohort and advertise a new one, or wait for its discovery window to expire.` (`CohortDetail.tsx:52-53,400-402`).

8. **Judge the help line as a human reader.** Does it state both the purpose (rehearse alone) and the key custody (throwaway keys created inside this process), and does the count `2` match the two empty seats shown as `Seats: 1/3.` just above it?
   Look for: the number equals capacity minus seats joined (`remaining = Math.max(0, detail.capacity - detail.seatsJoined)`, `CohortDetail.tsx:408`), and the throwaway-key claim appears HERE, in the help line, not in the confirm body you are about to open.

9. **Open the confirm and read it without confirming.** Click `Fill remaining seats with test peers`.
   Look for: a warn-toned inline panel (`CohortDetail.tsx:172`) with heading exactly `Add 2 test peers to this cohort?` (`operator.ts:316-317`), one body paragraph exactly `They join the remaining seats and co-sign like any other participant. They are badged as test peers everywhere on this console.` (`operator.ts:318-320`), a confirm button reading exactly `Add 2 test peers` (`operator.ts:328`), and a second button reading exactly `Cancel` (`operator.ts:329`). There is NO text input and no type-to-confirm instruction: that input renders only when a `typeToConfirm` value is passed, which this confirm does not pass (`packages/web/src/ui/primitives.tsx:328-342`). There is NO sentence containing the words "for real" or "anchored": that line is live-only (`CohortDetail.tsx:178`) and this service is hermetic.

10. **Confirm the spawn.** Click `Add 2 test peers` and watch the panel.
    Look for: the confirm button label changes to `Adding…` while the request is in flight (`operator.ts:331`), then the panel STAYS OPEN. It does not close on success: the only thing that closes it is its own `Cancel` button (`CohortDetail.tsx:167,186`; the store action clears only the in-flight flag and re-polls, `operator.ts:1082-1104`). Within about 4 seconds the `Members` card reads `Seats: 3/3.` and the still-open panel recounts to heading `Add 0 test peers to this cohort?` with confirm label `Add 0 test peers`, because `remaining` is recomputed from the served detail on every render. Record that stuck-open panel and the `Add 0 test peers` wording as a copy observation for this checkpoint. Click `Cancel` to dismiss the panel.

11. **Read all three member rows.**
    Look for: exactly two rows carry a neutral badge reading `Test peer` plus a line reading exactly `Test peer added by the operator.` (`CohortDetail.tsx:79-80,103,105`). The third row, whose `member did` matches the identity you generated in step 6, carries NEITHER.

12. **Read the per-cohort Activity card** (near the bottom of the drill-down, directly above the `Export` card; `CohortDetail.tsx:483-491`).
    Look for: one entry reads exactly `Operator added 2 test peers.` (`packages/service/src/monitor.ts:154-155`). There is NO entry mentioning skipped registrations: that entry is gated on `mode === 'live'` (`packages/service/src/index.ts:1342-1344`).

13. **Read the service-level log.** Click `Back to cohorts` (`CohortDetail.tsx:339-341`), then read the `Operator actions` section inside the `Service controls` card at the top of the console (`packages/web/src/components/operator/ServiceControls.tsx:212,313-326`, title from `operator.ts:285`).
    Look for: one entry reads exactly `Added 2 test peers to cohort XXXXXXXX.` where `XXXXXXXX` is the FIRST 8 CHARACTERS of the cohort id you copied, with no ellipsis (`monitor.ts:106-108,125-126`).

14. **Check the zero-seat state.** Click `Open` on that cohort's row (it is now in the `Active` group with a live chip) and look at the test-peer control now that every seat is filled. Give the first poll a moment; until it lands the card reads `Loading members from this service.` (`CohortDetail.tsx:514`).
    Look for: the button `Fill remaining seats with test peers` is still present but DISABLED (greyed, not clickable, not hidden), and the sentence beside it has changed to exactly `This cohort has no seats left.` (`operator.ts:337`, rendered at `CohortDetail.tsx:201,205`).

15. **Log in over HTTP** (third terminal):

    ```bash
    curl -s -c /tmp/op.jar -X POST http://127.0.0.1:8080/v1/operator/login -H 'content-type: application/json' -d '{"password":"phase5"}'
    ```

    Look for: the command prints `{"ok":true}` and exits 0 (`packages/service/src/operator-auth.ts:228-259`; the route is mounted outside the session guard at `packages/service/src/hono-adapter.ts:824-832`). `/tmp/op.jar` now contains a line naming `operator_session` (`operator-auth.ts:39`). curl sends no `Origin`, so the same-origin CSRF guard passes it through (`operator-auth.ts:186-206`).

16. **Prove the disabled state is a real server refusal, not just a UI guard.** Replace `COHORT_ID` with the id you copied:

    ```bash
    curl -s -w '\n%{http_code}\n' -b /tmp/op.jar -X POST http://127.0.0.1:8080/v1/operator/cohorts/COHORT_ID/test-peers
    ```

    Look for: the body is exactly `{"error":"This cohort has no seats left."}` and the status on the next line is `409` (`packages/service/src/test-peers.ts:45`, `packages/service/src/hono-adapter.ts:1025-1027`). That string is byte-identical to the sentence rendered beside the disabled button in step 14.
    Honest alternative: if you (or a timeout) already ended the cohort, this answers `404` with `{"error":"unknown cohort"}` instead, because seats are read live from the runner session and a settled cohort is no longer there (`packages/service/src/index.ts:1325-1330`; the same either-or is asserted at `e2e/operator-cohort.ts:1359-1363`). A 404 is an honest refusal but does NOT exercise the seat-cap string pairing; to get the 409, re-run steps 3 to 6 and 9 to 16 without submitting in the participant window.

17. **Prove the route is unreachable without a session:**

    ```bash
    curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8080/v1/operator/cohorts/COHORT_ID/test-peers
    ```

    Look for: `401` (`operator-auth.ts:164-173`; the route is registered inside the guarded block, `hono-adapter.ts:999-1001`). Nothing new appears in the `Operator actions` log and the `Members` card still reads `Seats: 3/3.`.

18. **OPTIONAL COPY JUDGMENT (still hermetic).** Back on the console, create and advertise a second cohort with `Signing threshold (k)` 2 and `Cohort size (n)` 2 (advertising again lands you in its drill-down). Join it ONCE from a THIRD, FRESH browser tab at http://127.0.0.1:8080 : the step-6 window still holds an active lifecycle, and while one is active the directory offers no Join at all (`packages/web/src/components/browse/BrowseView.tsx:22-25`, `CohortRow.tsx:51,79`). Then read the help line and confirm heading without confirming.
    Look for: with one seat remaining the help line reads `Adds 1 in-process test participants so you can rehearse this service on your own.`, the heading reads `Add 1 test peers to this cohort?`, and the confirm button reads `Add 1 test peers`. There is no singular form in the copy (`operator.ts:313-328`). Record whether that reads acceptably; it is a copy judgment, not a functional defect.

19. **LIVE LEG BEGINS.** Stop the hermetic service with Ctrl-C in its terminal.
    Look for: the process exits and http://127.0.0.1:8080 stops answering.

20. **Boot a live BROADCASTING service** against a chain you control. Against public mutinynet (needs outbound internet, no wallet, no funding):

    ```bash
    cd /home/jintek/projects/github/@jintekc/btcr2-aggregation && LIVE=1 BROADCAST=1 NETWORK=mutinynet OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 pnpm demo
    ```

    For your own regtest or signet esplora, change `NETWORK=<your network>` and add `ESPLORA_HOST=<your esplora base url>`.
    Look for: a boot block starting `[demo] !!! LIVE + BROADCAST: MUTINYNET (SIGNET) !!!` (the label is uppercased from the network registry, `packages/shared/src/networks.ts:116-118`), including the line `[demo]   - the operator MUST fund each cohort beacon address before its funding window elapses`, and, because `RECOVERY_KEY` is unset, `[demo]   !!! RECOVERY_KEY UNSET: cohort recovery keys are THROWAWAY (secret discarded) !!!` plus its two follow-on lines (`packages/service/src/demo-server.ts:374-386`). Then the listening line, with `resolve=mutinynet (live esplora)`. `BROADCAST=1` without `LIVE=1` refuses to boot (`demo-server.ts:338-346`).

21. **Confirm the served mode.** Sign in at http://127.0.0.1:8080/operator and read the mode chip on the health strip (allow a second or two for the first list read).
    Look for: the mode chip reads exactly `Live` (`HealthStrip.tsx:8-12`). If it settles on `Hermetic`, the live leg is invalid: stop and recheck that BOTH `LIVE=1` and `BROADCAST=1` were set.

22. **Open the live confirm without confirming.** Create a draft with k 2 and n 2 and advertise it (you land in its drill-down), then click `Fill remaining seats with test peers`.
    Look for: the SAME warn-toned panel as step 9, plus ONE ADDITIONAL paragraph inside that same panel reading exactly `This is a live cohort, so test peers co-sign for real and their DIDs are anchored on mutinynet.` (`operator.ts:326-327`, rendered at `CohortDetail.tsx:175-180`; the final word is the network name the service booted with, taken from the runtime config at `CohortDetail.tsx:314,410`). It is inside the same confirm, not a second dialog and not a later page.

23. **Confirm, then read the per-cohort Activity card** (the confirm panel will stay open, as in step 10; scroll past it).
    Look for: alongside `Operator added 2 test peers.` there is a second entry reading exactly `Test peers co-sign this cohort, but their own DID registrations are skipped: a first update needs its own funded beacon address and a confirmed registration.` (`packages/service/src/monitor.ts:165-167`, gated at `packages/service/src/index.ts:1342-1344`).

24. **Read the live service's stdout.**
    Look for: a line of the form `[service] cohort <id>: added 2 operator test peers; they co-sign for real, and their own DID registrations are skipped (a first update needs its own funded beacon address and a confirmed registration)` (`packages/service/src/index.ts:1348-1354`).

25. **Clean up.** In the drill-down `Lifecycle` card click `Cancel cohort` and confirm (`packages/web/src/components/operator/LifecycleActions.tsx:44,165,253`), so the cohort does not sit waiting for a funding payment you are not going to send. Click `Back to cohorts`, then Ctrl-C the service.
    Look for: the cohort appears in the `Ended` group with a `Canceled` chip (`packages/web/src/lib/operator-rows.ts:132`), and the process exits. Because no funds were sent, this is the lighter confirm, not the type-to-confirm ceremony.

## Pass

- Step 7: the control label is exactly `Fill remaining seats with test peers` and the help line names both the remaining-seat count and the throwaway keys created inside this process.
- Step 9: the confirm is a single warn-toned inline panel with the exact heading, body, confirm label and `Cancel` label listed, with NO typed-value input, and on the hermetic boot with NO for-real / anchored sentence.
- Step 10: the spawn takes and the seat count reaches `Seats: 3/3.`; the panel staying open and recounting to `Add 0 test peers` is recorded as an observation, not treated as a pass or fail of the disclosure itself.
- Step 11: exactly the spawned peers carry the `Test peer` badge and the `Test peer added by the operator.` line, and the human-joined participant carries neither.
- Steps 12 and 13: the spawn is stamped BOTH per cohort (`Operator added 2 test peers.`) and service level (`Added 2 test peers to cohort <8 chars>.`).
- Steps 14 and 16: at zero remaining seats the control is disabled rather than hidden, the reason rendered beside it is `This cohort has no seats left.`, and the server independently returns 409 with that exact same string while the cohort is still live.
- Step 17: an anonymous POST to the test-peer route is 401.
- Steps 22 through 24: on a service whose mode chip reads `Live`, the confirm carries the extra network-naming line BEFORE the act, and after confirming both the drill-down Activity entry and the server stdout state that the peers' own DID registrations are skipped and why.

## Fail signals

- The confirm on the HERMETIC boot contains any sentence claiming the peers co-sign for real or that DIDs are anchored. That line is gated on the live mode, and its appearance hermetically would be a false claim about Bitcoin.
- The confirm on the LIVE boot is missing the network-naming line. The operator would then only learn from a block explorer that real co-signing happened.
- A member the operator did NOT spawn (the identity generated in step 6) carries the `Test peer` badge, or a spawned peer carries no badge. Either direction mislabels who is in the cohort.
- At 3/3 seats the control disappears entirely, or stays enabled, or the sentence beside it differs in any character from the 409 body in step 16. A drifted pair means the sentence read before clicking is not the sentence the service enforces.
- Step 16 returns 200 with a spawned count, meaning the seat cap is not enforced server side and the browser's stale seat count is load bearing. (A 404 is not this failure: it means the cohort had already settled.)
- Step 17 returns anything other than 401, in particular a 404 or a 409, which would leak whether the cohort id exists to an unauthenticated caller.
- The spawn appears in only one of the two logs, or the service-level entry interpolates the full cohort id instead of the first 8 characters.
- The confirm panel shows a type-to-confirm input. That is the rung-4 funded-cancel ceremony and would be the wrong weight for an act that adds participants.
- On the live boot the Activity card shows the spawn entry but NOT the registration-skip entry, which would mean the limit is silently omitted rather than spoken.

## Limits

Steps 19 through 25 CANNOT be run on the default boot and are not covered by any test in the repository: the extra confirm line, the Activity skip note, and the stdout line are all gated on the served mode being `live`, which needs `LIVE=1` plus `BROADCAST=1` plus a reachable esplora (`.planning/phases/05-operator-cohort-lifecycle-control/05-09-SUMMARY.md:132-137` marks exactly these two deliverables `human_judgment` with that rationale). Nothing here proves the peers' own DID registrations would have succeeded if attempted; it only proves the service says they are skipped, so what is unproven hermetically is the DISCLOSURE copy, not the spawning behavior (the peers are ordinary participants in both modes). Known open defect carried from gap plan 05-16: `liveTestPeersLine` renders from `health.mode` alone, so on a live service where the one-way broadcast kill switch has already been engaged the confirm still says the peers co-sign for real even though a post-switch cohort runs on the fixture path (`05-16-SUMMARY.md:240-244`); do not report that combination as a new finding. Step 10's stuck-open confirm panel and step 18's missing singular form are copy and behavior judgments for this checkpoint, not correctness failures of the seat cap. This procedure does not exercise the 502 or 503 verdicts (`hono-adapter.ts:1028-1033`), which are unreachable from the shipped console. `pnpm e2e:testpeers` covers the hermetic route semantics, the badge set, and peer teardown, but asserts nothing about any rendered string.

---

<a id="test-10"></a>

## Test 10: Cancel reaches the participant as a cancel, not a stall: both terminal narrations and the next-step line

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (11 problem(s) found and corrected).

# Test 10: cancel reaches the participant as a cancel, not a stall

Both terminal narrations and the next-step line.

**What this checkpoint must let you verify:** cancel a cohort a participant is seated in; the
participant's terminal card names the cancel and never narrates it as a stall or a timeout; both
narration variants and the shared next-step line read correctly.

**Hermetic.** Default zero-chain boot: no chain, no wallet, no `LIVE`, no `BROADCAST`.

## Preconditions

- Nothing else listening on port 8080. Check with `ss -ltn | grep ':8080'`.
- A Chromium-based browser (Chrome, Chromium, or Edge). Step 9 needs its network request blocking
  panel.
- Use the host `127.0.0.1`, not `localhost` (the server binds 127.0.0.1; `localhost` can resolve
  to `::1`).
- Leave `TERMS_TEXT` unset, so the join flow has no terms step
  (`packages/web/src/components/browse/JoinIdentityStep.tsx:79-81`: with no terms text the whole
  branch is inert).
- You need THREE browser windows: one operator console and two independent participant windows.
  The participant store is not persisted to any browser storage (no `localStorage`,
  `sessionStorage`, or zustand `persist` anywhere in `packages/web/src`), so two ordinary windows
  are two independent participants.
- **Arrange the three windows so both participant windows stay visible** (tiled, or on separate
  displays). Do not park them as background tabs of one window. The post-seat watch is a plain
  `setInterval` at 5000 ms (`packages/web/src/stores/participant.ts:731`, armed at `:1761`), and
  Chromium throttles timers in hidden or fully occluded tabs, which would stretch the cadence to
  about once a minute and make the terminal card look like it never lands.
- Boot (own terminal, leave running):

  ```bash
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation && OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 cancel" pnpm demo
  ```

  `OPERATOR_COOKIE_SECURE=0` is read at `packages/service/src/demo-server.ts:444-445`;
  `SERVICE_NAME` at `:396`; `OPERATOR_PASSWORD` is what keeps the operator surface from being
  fail-closed.

## Steps

1. **Run the boot command and wait for the build and start to finish.**
   Look for, on stdout:
   `[demo] service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))`
   followed by
   `[demo] idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)`
   (`packages/service/src/demo-server.ts:532-538`, prefix at `:262`).

2. **Open `http://127.0.0.1:8080/operator`, sign in with `phase5`, click `New cohort`
   (`packages/web/src/components/operator/OperatorConsole.tsx:147`), confirm `Signing threshold (k)`
   and `Cohort size (n)` both read `2`, then click `Create draft`.**
   Both fields open on 2 by default (built-in size 2 at
   `packages/service/src/runtime-settings.ts:282`, threshold defaults to size at `:320-321`; the
   browser-side fallbacks are `packages/web/src/components/operator/CreateCohortForm.tsx:17-18`),
   so you should not have to type anything. Field labels and the submit button are at
   `CreateCohortForm.tsx:150`, `:164`, `:195`.
   Look for: a new row under the `Drafts` heading
   (`packages/web/src/components/operator/OperatorCohortList.tsx:38`) carrying an
   `Advertise cohort` button (`OperatorCohortList.tsx:184`).

3. **Click `Advertise cohort`.**
   Look for: the console navigating you straight into that cohort's drill-down. This is automatic
   (`packages/web/src/stores/operator.ts:965` calls `openCohort` on the LIVE cohort id the
   advertise response returned). You do NOT click an `Open` button here, and the id in the
   drill-down is a fresh live cohort id, not the draft id (the draft is deleted server-side,
   `packages/service/src/operator-cohorts.ts:1272-1278`).
   Also look for: the `Members` card reading `No one has joined yet. Seats: 0/2.`
   (`packages/web/src/components/operator/CohortDetail.tsx:374-377`) and a `Lifecycle` card
   offering `Cancel cohort` (`packages/web/src/components/operator/LifecycleActions.tsx:44,150`).

4. **Copy the cohort id out of the `cohort id` field in the drill-down**
   (`CohortDetail.tsx:350`) into a scratch buffer. You need it at step 16.

5. **In participant window A (`http://127.0.0.1:8080`), click `Join` on that cohort's row, then
   `Generate a new identity`, then `Join cohort`.**
   Button text at `packages/web/src/components/browse/CohortRow.tsx:80`,
   `JoinIdentityStep.tsx:164`, `JoinIdentityStep.tsx:227`.
   Look for: within about 5 seconds (the pre-seat directory poll is also 5000 ms,
   `participant.ts:651`, and it is what sets the seat counts at `participant.ts:1966`), a line
   reading `Waiting for the cohort to fill (1/2 seats).` (`participant.ts:880`).

6. **In a SEPARATE participant window B (`http://127.0.0.1:8080`), click `Join` on the same
   cohort's row, then `Generate a new identity`, then `Join cohort`.**
   Look for: both windows leaving the waiting state; each showing a panel with a button reading
   `Submit my DID update` (`packages/web/src/components/cohort/SubmitPanel.tsx:147-149`); the
   operator drill-down reading `Seats: 2/2.` (`CohortDetail.tsx:380-382`). Both participants are
   SEATED only at this point: `seated` flips true only on `cohort-ready`
   (`participant.ts:1719-1724`), which is why both seats have to fill before the cancel.

7. **In window A ONLY, click `Submit my DID update`. Do NOT touch the submit button in window B.**
   Look for: window A's submit step completing. Expand `Technical detail`
   (`packages/web/src/components/cohort/CohortPage.tsx:250`) and confirm the activity log contains
   a line beginning `submitted signed DID update for ` (`participant.ts:1796`) and does NOT contain
   `validating aggregated cohort data` (`participant.ts:1807`). The second line fires only after
   the service has collected EVERY member's update, and window B has not submitted.

8. **Confirm the trap is armed. In window B, expand `Technical detail` and read its activity log.**
   Look for: its opt-in line and its keygen line, but NO `submitted signed DID update` line and NO
   `validating aggregated cohort data` line. Window A is now in the exact state that produces stall
   copy when the cancel fact is false: submitted, unsigned, no validation requested
   (`participant.ts:1238-1243`).

9. **In window B, open DevTools and turn on network request blocking for the fate read.**
   Open the command menu (Ctrl-Shift-P), search for the network request blocking panel, open that
   drawer tab, tick its enable checkbox, and add the pattern `*cohort-fate*`.
   *The exact DevTools labels are Chrome's own and were NOT verified against any source in this
   repository; they move between Chrome versions, so navigate by role rather than by wording.*
   Look for: the pattern listed and blocking enabled. Leave DevTools open in window B for the rest
   of the test. Do NOT do this in window A. The URL you are blocking is
   `http://127.0.0.1:8080/v1/cohort-fate/<id>` (base URL is `window.location.origin`,
   `packages/web/src/App.tsx:21`; path built at `packages/web/src/lib/cohort-fate.ts:50`).

10. **In the operator drill-down, click `Cancel cohort` in the `Lifecycle` card and read the
    confirmation WITHOUT confirming.**
    Look for: a confirmation panel headed `Cancel this cohort?`
    (`LifecycleActions.tsx:49,251`); a body naming the cohort's short id and stating it has 2
    seated participants and that canceling ends the cohort for all of them
    (`LifecycleActions.tsx:81-86`); a confirm button reading `Cancel cohort`
    (`LifecycleActions.tsx:44,253`); and a second button reading `Keep it running`
    (`LifecycleActions.tsx:48,254`). There must be NO typed-value input: this hermetic cohort
    carries no funding view (`packages/service/src/monitor.ts:1428` gates it on live mode), so
    `cancelRung` returns 3 (`packages/web/src/lib/lifecycle.ts:75-81`).

11. **Click `Cancel cohort`. Do this within a couple of minutes of both seats filling.**
    If either participant window lands a terminal card BEFORE you click, the cohort died on its
    own, the run is void, and you restart from step 2.
    Look for: the drill-down closing back to the cohort list (the store closes it explicitly,
    `packages/web/src/stores/operator.ts:1052`, then re-reads the list) and the cohort appearing
    under `Ended` (`OperatorCohortList.tsx:39`) with a NEUTRAL chip reading `Canceled`
    (`packages/web/src/lib/operator-rows.ts:132`) and a line of the form
    `Canceled by the operator at <local time>.` (`operator-rows.ts:48-50`, rendered at
    `OperatorCohortList.tsx:238-239`). The timestamp is the server's own wall clock
    (`packages/service/src/monitor.ts:1071`).

12. **Watch participant window A for up to 30 seconds and read the bad-toned terminal card when it
    appears.** Expect it in roughly 5 to 10 seconds (two consecutive absent directory reads on the
    5000 ms post-seat interval), plus up to the fate read's 8 second budget
    (`packages/web/src/lib/cohort-fate.ts:41`) for the wording to settle.
    Look for: a bad-toned card of TWO lines (two paragraphs), in this order:
    - `The operator canceled this cohort.` (`participant.ts:1170`)
    - `Your keys and identity are still in this browser. Pick another cohort from the directory when one opens.` (`CohortPage.tsx:18-19`)

    with a `Back to cohorts` button below them (`CohortPage.tsx:220`).
    It must NOT read `This service stalled while collecting updates.` (`participant.ts:1180`), must
    NOT read `The cohort ended and this service didn't say why.` (`participant.ts:1177`), and must
    NOT mention a timeout (`participant.ts:1250-1251`).

13. **In window A, expand `Technical detail` and read the last THREE activity log entries, at the
    bottom of the list** (entries are appended in order, `participant.ts:1387-1391`, and rendered in
    array order, `CohortPage.tsx:263-268`).
    Look for, in this order:
    - `cohort <id> is not in the directory; a completion may still be arriving` (`participant.ts:2135`)
    - `cohort <id> left the directory before completing` (`participant.ts:2142`)
    - `service reports cohort <id> was canceled by the operator` (`participant.ts:2164`)

    That ordering proves the honest fallback landed FIRST from the two-read gone streak
    (`fail(HONEST_TERMINAL_FALLBACK)` at `participant.ts:2143`) and that the cancel attribution only
    upgraded it afterwards (`participant.ts:2151-2167`).

14. **Switch to participant window B and read its terminal card.**
    Look for: a bad-toned card whose first line is
    `The cohort ended and this service didn't say why.` (`participant.ts:1177`, reached via the
    unexplained fall-through at `participant.ts:1262-1263`) followed by the identical next-step line
    `Your keys and identity are still in this browser. Pick another cohort from the directory when one opens.`
    It must NOT say the operator canceled anything: window B's fate read was blocked, and an
    unreachable read must never fabricate an accusation (`cohort-fate.ts:58-63` returns
    `unreachable` on every failure; the caller drops it at `participant.ts:2158`).

15. **In window B's DevTools, switch to the Network tab and find the request to
    `/v1/cohort-fate/`.**
    Look for: the request present and rendered as blocked (Chrome shows blocked rows in red with a
    devtools-blocked status; *the exact status string was not verified against this repo*). This
    confirms window B's fallback copy came from an unreachable read, not from a broken feature.

16. **Prove the service itself holds the cancel fact, anonymously.** In a terminal, replacing
    `COHORT_ID` with the id you copied at step 4:

    ```bash
    curl -s -w '\n%{http_code}\n' http://127.0.0.1:8080/v1/cohort-fate/COHORT_ID
    ```

    Look for: body exactly `{"canceled":true}` and status `200`. No cookie was sent. Route at
    `packages/service/src/hono-adapter.ts:757-763`, mounted in the PUBLIC block; the body is one
    expression over the retained record's own fate and carries no second key
    (`packages/service/src/operator-cohorts.ts:1507-1519`).

17. **Confirm the read is not an existence oracle:**

    ```bash
    curl -s -w '\n%{http_code}\n' http://127.0.0.1:8080/v1/cohort-fate/never-existed-cohort
    ```

    Look for: body exactly `{"canceled":false}` and status `200`, never `404`, byte-identical in
    shape to step 16's answer. (`never-existed-cohort` satisfies the route's shape guard
    `/^[0-9a-zA-Z-]{1,64}$/` at `hono-adapter.ts:759`, so it reaches the 200 path rather than the
    400.)

18. **Judge the two cards as a human reader.** Re-read window A's card and window B's card side by
    side.
    Look for: window A's sentence reading as informative attribution rather than an accusation;
    window B's reading as candid uncertainty rather than a shrug; and the identical second line
    landing correctly under BOTH. Record any wording that reads as blaming the operator or as
    implying the service malfunctioned.

19. **OPTIONAL REGRESSION CROSS-CHECK.** In a SECOND terminal, with the demo service still running
    (the leg binds its own ephemeral port, `e2e/operator-cohort.ts:764`, so you do not stop
    anything):

    ```bash
    cd /home/jintek/projects/github/@jintekc/btcr2-aggregation && pnpm e2e:cancel
    ```

    Look for: the leg passing, including its anonymous cohort-fate assertions
    (`e2e/operator-cohort.ts:861-889`). This checks the service half over real HTTP; it does not
    drive a browser participant.

## Pass

- Step 12: window A, which had SUBMITTED and whose cohort never reached validation, renders
  `The operator canceled this cohort.` and never the stall sentence. That exact state is the input
  that produced stall copy before this slice landed, which is the whole point of the checkpoint.
- Steps 12 and 14: the next-step line
  `Your keys and identity are still in this browser. Pick another cohort from the directory when one opens.`
  renders under BOTH narrations, identically.
- Step 13: the activity log ordering shows the honest fallback landing first and the cancel
  attribution arriving afterwards, so the two-read gone-streak timing was not shortened to deliver
  the news faster.
- Step 14: with the fate read blocked, the participant gets the honest fallback and is NOT told an
  operator canceled anything.
- Steps 16 and 17: the anonymous read answers 200 with a single `canceled` key for both a real
  cancel and an id that never existed, and never answers 404.
- Step 11: the operator side records a distinct `Canceled` fate with a server timestamp, not
  `Failed` and not `Expired`.

## Fail signals

- **Window A shows `This service stalled while collecting updates.`** Before concluding the cancel
  fact is not checked ahead of the stall branch, check window A's activity log for the three
  gone-streak lines from step 13 and for any line beginning `error: `. There is exactly ONE fate-read
  call site in the whole bundle (`participant.ts:2153`) and it lives inside the gone-streak branch.
  If the runner's error handler (`participant.ts:1885-1895`) fired on cohort disposal, `fail()` ran,
  `teardownLive()` cleared the post-seat poll, the streak never completed, the fate read never ran,
  and the stall copy is the honest output of a DIFFERENT defect: the composed error path preempting
  the streak. Absent gone-streak lines plus an `error: ` line means that path, not an ordering bug.
  Present gone-streak lines with the stall copy anyway means the ordering bug.
- **Window A shows `The cohort ended: phase timed out.` or any sentence mentioning a timeout.** A
  deliberate operator act narrated as a timing failure is the same defect wearing different words.
- **Window A shows only `The cohort ended and this service didn't say why.` and its activity log
  never gains the `service reports cohort ... was canceled by the operator` line.** Check the
  Network tab for the `/v1/cohort-fate/` request first: if it returned 200 with `canceled` true and
  the copy still did not upgrade, the browser is discarding a valid answer.
- **Either window lands a terminal card whose sentence starts `The cohort ended: ` followed by a
  transport or connection message.** That means the SSE stream errored on cohort disposal and failed
  the round through the runner error path BEFORE the directory gone streak could run, bypassing the
  fate read entirely. Capture the exact sentence and the activity log; this composed path has no
  automated coverage.
- **Window B shows `The operator canceled this cohort.` while its `/v1/cohort-fate/` request is
  marked blocked.** A blocked read must never produce an attribution.
- **Step 17 returns 404, or returns a body with more than the single `canceled` key.** Either would
  make the anonymous read a probe for which cohorts this service has run.
- **The next-step line appears under one narration but not the other, or its wording differs.**
- **The terminal card appears in one participant window and never in the other**, leaving a seated
  participant with a frozen live page after the cohort was ended. Before filing this, confirm the
  silent window was VISIBLE throughout (a hidden or occluded window gets its 5 second poll throttled
  by the browser).

## Limits

No automated test drives a real browser participant through seat, cancel, two directory polls, the
fate read, and the rendered card; `05-10-SUMMARY.md:223-225` records exactly this as an open gap, so
this walkthrough is the first time the composed path runs end to end. Whether the aggregation runner
emits a transport error to a seated participant when its cohort is disposed is NOT covered by any
test in this repository: the `e2e:cancel` leg deliberately constructs a FRESH participant after the
cancel (`e2e/operator-cohort.ts:891-898`), which is why that path is a fail signal here rather than
an assumed impossibility. Step 9 uses DevTools request blocking to force the unreachable branch;
that proves the fallback renders when the read fails, but it does not prove the fallback renders for
a cohort that genuinely died of something other than a cancel (that would need a separate boot with
a short `PHASE_TIMEOUT_MS` and is not covered here). The latency you observe (roughly 5 to 10 seconds
to the terminal, plus up to 8 more for the attribution) is by design, not a defect. Nothing here is
exercised on a live chain, and none of it touches broadcast, funding, or anchoring.

---

<a id="test-11"></a>

## Test 11: Dismissal actually dismisses, and discloses its cost

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (3 problem(s) found and corrected).

> Hermetic. One terminal for the service, one for curl, one browser window. No wallet, no chain, no funds.

## Preconditions

```bash
cd /home/jintek/projects/github/@jintekc/btcr2-aggregation
```

```bash
# nothing else may hold port 8080 (expect NO output):
ss -ltn | grep ':8080'
```

```bash
# terminal 1, the service (this runs `pnpm -r build` first, so allow a few minutes on a cold tree):
OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" DEFAULT_SIZE=2 pnpm demo
```

- Wait for terminal 1 to print exactly:
  `[demo] service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))`
- Keep a SECOND terminal open for the curl checks. It needs no env vars.
- Browser: one window at `http://localhost:8080/operator` (exact path, no trailing slash: the SPA matches `pathname === '/operator'`).
- Hermetic default: do NOT set `LIVE` or `BROADCAST` for this procedure.

## Steps

1. **Sign in.** Load `http://localhost:8080/operator`. Type `phase5` into the field labelled `Operator password` and click `Sign in`.
   Look for: the console loads with the heading `Operator console`, a health strip carrying a neutral `Hermetic` chip and the service name `Phase 5 check`, and a `New cohort` button. The list re-reads every 4 seconds, so any list observation below can lag by up to about 4 seconds unless the step says otherwise.

2. **Create a draft.** Click `New cohort`. Leave `Signing threshold (k)` and `Cohort size (n)` at their seeded value of 2, and click `Create draft`.
   Look for: a row under the `Drafts` group heading carrying a neutral `Draft` chip, `0/2 seats`, and a `draft id` copy field. The create form stays open after a successful create (only the `Cancel` button beneath it closes it); that is expected and blocks nothing.

3. **Advertise it.** On that draft row click `Advertise cohort`.
   Look for: the console leaves the list and opens that cohort's drill-down (stage timeline, then `Lifecycle`, `Members`, `Submissions`, `Co-sign`, `Anchor`, `Activity`, `Export`). Copy the `cohort id` from the drill-down and keep it. Advertising mints a NEW live cohort id server-side, so this is not the draft id from step 2.

4. **Open the cancel ceremony.** In the drill-down's `Lifecycle` card, click the danger-toned `Cancel cohort` button.
   Look for: a bad-toned confirm panel replaces the button, headed `Cancel this cohort?`. Because nobody has joined, its body is the zero-seat sentence beginning `No one has joined cohort` followed by the short cohort id. Its two buttons read `Cancel cohort` and `Keep it running`. There is no field to type into (this is rung 3, not rung 4).

5. **Cancel.** Click `Cancel cohort` in that confirm panel.
   Look for: the console returns to the list by itself. A row appears under the `Ended` group heading with a neutral `Canceled` chip, `0/2 seats`, and a line reading `Canceled by the operator at <a local clock time>.` The `Operator actions` log on the Service controls card gains an entry reading `Canceled cohort <first 8 characters of the cohort id>.` at the BOTTOM of the log (entries render oldest first and the panel auto-scrolls).

6. **Read the fate anonymously (before dismissal).** In terminal 2, substituting the cohort id from step 3:

   ```bash
   curl -s http://localhost:8080/v1/cohort-fate/PASTE_COHORT_ID_HERE; echo
   ```

   Look for: exactly `{"canceled":true}`. No cookie and no session are involved.

7. **Open the dismissal confirm on the canceled row.** Back in the browser, click `Dismiss` on that canceled row.
   Look for: the `Dismiss` button disappears and a neutral confirm panel opens inside that row card, below the `cohort id` field, headed `Remove this record?`. Its body is exactly ONE paragraph: `This clears the ended cohort's record and its activity log from your console for this session. The cohort itself already ended, so nothing on the chain or in the directory changes. There is no undo.` Its buttons read `Dismiss record` and `Keep it`. There must be NO second paragraph here: a canceled row never offered Re-advertise, so it has no re-advertise affordance to lose.

8. **Dismiss.** Click `Dismiss record`.
   Look for: the row leaves the `Ended` group as soon as the dismissal's own list re-read lands, which is effectively immediate (the store re-reads the list itself after the DELETE rather than waiting for the next 4 second tick). If it was your only cohort, the empty-state card renders with the line `No cohorts yet`. The `Operator actions` log gains `Dismissed the record for cohort <first 8 characters>.` beneath the earlier cancel entry.

9. **Prove it stays gone.** Wait about 15 seconds (three or four polls), then reload the page with F5 and stay on `http://localhost:8080/operator`.
   Look for: you are still signed in (the session cookie survives a reload) and the dismissed row does NOT come back. The `Operator actions` log still shows both the cancel and the dismissal.

10. **Read the fate anonymously (after dismissal).** In terminal 2, repeat for the SAME cohort id:

    ```bash
    curl -s http://localhost:8080/v1/cohort-fate/PASTE_COHORT_ID_HERE; echo
    ```

    Look for: still exactly `{"canceled":true}`. The dismissal removed the operator's record without removing the one out-of-band fact a canceled participant can still read. Anything else, in particular `{"canceled":false}`, is a FAIL.

11. **Optional: check BOTH server-side record sources are clear**, not just the one the row rendered from.

    ```bash
    curl -s -c /tmp/op.jar -X POST http://localhost:8080/v1/operator/login -H 'content-type: application/json' -d '{"password":"phase5"}'; echo
    curl -s -b /tmp/op.jar http://localhost:8080/v1/operator/cohorts
    ```

    Look for: the login prints `{"ok":true}`. The list read shows the dismissed cohort id in NEITHER `cohorts` (the operator terminal records) NOR `monitoring.rows` (the monitoring ended records). `monitoring.operatorActions` still contains the `Dismissed the record for cohort ...` text. This curl session is separate from the browser's; it does not sign the browser out.

12. **Build the EXPIRED row.** Click `New cohort` (the F5 in step 9 closed the create form, so the button is back). Click the `Advanced timing` row to expand it (its right-hand side reads `Show`), type `1` into `Discovery window (minutes)`, leave threshold and size at 2, and click `Create draft`.
    Look for: a new draft row under `Drafts`. The help under the discovery field ends with `Leave it empty to use this service's default of 30 min.`, so the 1 you typed is an explicit override.

13. **Advertise it and go back.** Click `Advertise cohort` on that draft, copy the `cohort id` from the drill-down you land on, then click `Back to cohorts`.
    Look for: you are back on the list with the cohort under `Active` carrying an accent `Filling` chip and `0/2 seats`.

14. **Let the window close.** Wait 70 seconds without touching anything.
    Look for: the row moves into the `Ended` group with a bad-toned `Expired` chip, the line `Expired: the discovery window closed`, and a primary `Re-advertise` button beside a `Dismiss` button. This row exists ONLY as an operator terminal record: the app-side window expiry calls `stopCohort`, which emits no runner event, so the monitoring fold recorded nothing. That is exactly the case that used to answer 404 on dismissal.

15. **Open the dismissal confirm on the expired row.** Click `Dismiss` on it.
    Look for: the neutral confirm headed `Remove this record?` with TWO stacked paragraphs. The first is the same body as in step 7. The second reads exactly: `This also removes the cohort from your cohort list, so it can no longer be re-advertised.` Buttons are `Dismiss record` and `Keep it`. A missing second paragraph here is a FAIL.

16. **Dismiss the expired row.** Click `Dismiss record`.
    Look for: the row disappears on the dismissal's own re-read, taking its `Re-advertise` button with it. It does NOT stay on screen, and no bad-tone error line reading `That action didn't go through. Nothing about this cohort changed.` appears above the list groups. The `Operator actions` log gains a second `Dismissed the record for cohort <first 8 characters>.` entry naming this cohort.

17. **Prove the expiry was never mislabelled.** Reload the page with F5, then in terminal 2:

    ```bash
    curl -s http://localhost:8080/v1/cohort-fate/PASTE_EXPIRED_COHORT_ID_HERE; echo
    ```

    Look for: the row is still gone after the reload, and the fate read prints exactly `{"canceled":false}`. An expiry must never be reported as an operator cancel.

18. **Stop.** Ctrl+C in terminal 1.
    Look for: the process exits. All cohort state is in memory, so nothing survives.

## Pass

- A dismissed canceled row disappears from the `Ended` group and is still absent after three or four polls and a full page reload.
- The anonymous `GET /v1/cohort-fate/<id>` answers `{"canceled":true}` both before and after the dismissal of a canceled cohort.
- The canceled row's dismissal confirm carries exactly one paragraph (the standard dismissal body) and no re-advertise sentence.
- The expired row's dismissal confirm carries the standard body PLUS the exact line `This also removes the cohort from your cohort list, so it can no longer be re-advertised.`
- Dismissing the expired row succeeds: the row disappears, no action-error line renders, and the operator actions log records the dismissal.
- `GET /v1/operator/cohorts` shows the dismissed ids in neither `cohorts` nor `monitoring.rows`.
- `GET /v1/cohort-fate/<expired id>` answers `{"canceled":false}`.

## Fail signals

- The dismissed row reappears on a later 4 second poll, or after F5.
- A bad-tone line reading `That action didn't go through. Nothing about this cohort changed.` appears above the list groups after clicking `Dismiss record` and the row stays put. That is the store's action-failed copy, raised when the DELETE answers 404 or is unreachable. On the expired row this is the exact 05-19 defect regressing. (Do not confuse it with `Can't reach this service. Showing the last known state and retrying quietly.`, which is the separate list-poll banner and says nothing about the dismissal.)
- The row only vanishes on a later background poll rather than on the dismissal's own re-read.
- `GET /v1/cohort-fate/<canceled id>` flips to `{"canceled":false}` after the dismissal: the operator tidied their console and silently withdrew the one honest answer a canceled participant can still get.
- `GET /v1/cohort-fate/<expired id>` answers `{"canceled":true}`: an expiry mislabelled as an operator cancel.
- The re-advertise sentence renders on the CANCELED row (it has nothing to lose there) or is missing from the EXPIRED row (where the cost is real).
- `Dismiss` appears on a draft row or on a live `Filling` / `Co-signing` row: it is for ended rows only.
- The dismissal is missing from the `Operator actions` log. The one action whose purpose is to remove evidence must not be the unrecorded one.
- `GET /v1/operator/cohorts` still lists the id under `cohorts` while the browser row is gone (one source cleared, not both).

## Limits

This proves nothing about live or broadcasting services: the whole run is hermetic, so no cohort ever touched Bitcoin. The canceled-fate carry is BOUNDED at 24 entries (`MAX_DISMISSED_CANCELED` equals `MAX_TERMINAL`, packages/service/src/operator-cohorts.ts:748 and :757); dismissing more than 24 canceled cohorts evicts the oldest and its fate legitimately reverts to `{"canceled":false}`, and this procedure does not reach that bound. It does not exercise the still-in-flight phase guard (a dismissal is refused while a cohort is still filling or co-signing) because reaching that state by hand is racy; that guard is covered by the vitest suite only (packages/service/tests/lifecycle-routes.spec.ts). Nothing here checks what the SEATED participant is told about the cancel (that is SVC-04 criterion 4 in 05-UAT-CHECKLIST.md and needs a real participant window). All state is in memory, so "stays gone" is proven across polls and a page reload, never across a service restart. Finally, the confirm panel's copy and its conditional second paragraph are pinned by source-containment unit specs (packages/web/tests/operator-rows.spec.ts reads the component source and matches the `dismissDropsReadvertise(...)` guard) rather than by rendering; the repo does have browser e2e legs that render the operator console in headless Chromium (`pnpm e2e:browser:operator`, e2e/browser-operator.ts), but none of them exercises the dismissal ceremony, so the panel as rendered is verified only by this human read.

## Evidence (verified against the repo)

- packages/web/src/stores/operator.ts:257 `DISMISS_LABEL = 'Dismiss'`; :258 `DISMISS_HEADING = 'Remove this record?'`; :259-260 `DISMISS_BODY`; :273-274 `DISMISS_READVERTISE_LINE`; :275 `DISMISS_CONFIRM_LABEL = 'Dismiss record'`; :276 `KEEP_RECORD_LABEL = 'Keep it'`; :285 `OPERATOR_ACTIONS_TITLE = 'Operator actions'`; :97 `ACTION_FAILED`; :100-102 `actionFailedWith`; :1136-1153 `dismissEnded` (re-reads the served list itself).
- packages/web/src/components/operator/OperatorCohortList.tsx:36-39 group headings; :214 `Re-advertise`; :228-231 `Dismiss` rendered only when `group === 'ended'`; :241 the `Expired: ${reason}` line; :263-282 the rung-1 ConfirmPanel, with :270 guarding `DISMISS_READVERTISE_LINE` on `dismissDropsReadvertise(cohort)` inside the body prop; :337-339 the shared `actionError` line; :356 `No cohorts yet`.
- packages/web/src/lib/operator-rows.ts:48-50 `canceledEndedLine`; :71-73 `dismissDropsReadvertise` returns `cohort?.state === 'expired'`; CHIP_PRESENTATION labels `Draft`, `Filling`, `Expired`, `Canceled`.
- packages/web/src/components/operator/LifecycleActions.tsx:43-49 `Cancel cohort`, `Keep it running`, `Cancel this cohort?`; :70-79 the zero-seat rung-3 body.
- packages/web/src/components/operator/OperatorConsole.tsx:13 `LIST_POLL_MS = 4000`; :16 `UNREACHABLE_BANNER` (list poll only); :147 `New cohort`; :145-151 the button is hidden while the create form is open.
- packages/web/src/components/operator/CreateCohortForm.tsx:195 `Create draft`; DraftEditForm.tsx:71 `Advanced timing`, :73 `Discovery window (minutes)`; ui/primitives.tsx:44-58 the Expander's `Show` / `Hide` toggle; lib/cohort-form.ts:83-86 the discovery help text.
- packages/web/src/components/operator/LoginPanel.tsx:36 `Operator password`, :50 `Sign in`; HealthStrip.tsx:9 `Hermetic`; CohortDetail.tsx:341 `Back to cohorts`, :350 the `cohort id` CopyField.
- packages/web/src/lib/operator.ts:1015-1022 the DELETE wrapper mapping 404 to `unreachable`.
- packages/service/src/hono-adapter.ts:757-763 anonymous `GET /v1/cohort-fate/:id`; :826 `POST /v1/operator/login`; :1093-1121 `GET /v1/operator/cohorts` (`cohorts`, `monitoring.rows|metrics|health|operatorActions`, `defaults`); :962-981 `DELETE /v1/operator/ended/:id` calling BOTH `monitor.dismissEnded` and `operatorCohorts.forgetTerminal`.
- packages/service/src/operator-cohorts.ts:183 `the discovery window closed`; :190 `canceled by the operator`; :867-895 `armWindowTimer`; :1435-1467 `forgetTerminal`; :1507-1519 `cohortFate`; :748 and :757 the bounds.
- packages/service/src/monitor.ts:119 `Canceled cohort {short}.`; :122-123 `Dismissed the record for cohort {short}.`; :1555-1578 `dismissEnded`; :1612-1663 `summary()` (live rows come from the session, so a stopped cohort has none).
- packages/service/src/demo-server.ts:445 `OPERATOR_COOKIE_SECURE=0`; :531-534 the listening log line; :561 `PORT` default 8080.

---

<a id="test-12"></a>

## Test 12: The Anchored chip is reserved for confirmed anchors

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (5 problem(s) found and corrected).

## Test 12: the Anchored chip is reserved for confirmed anchors

Hermetic. Verifies that a completed hermetic co-sign round reads as `Signed` in the Ended group, that the `anchored` counter stays at zero because nothing confirmed on chain, and that a k-of-n script-path completion keeps its own distinct label and its own Needs-attention bucket.

**Rendering note, true for every heading and caption quoted below:** section titles and list-group headings render through the `SectionTitle` primitive, which applies CSS `uppercase` (`packages/web/src/ui/primitives.tsx:31-35`). The authored strings are exactly as quoted here, but on screen `anchored` reads ANCHORED, `Ended` reads ENDED, `Members` reads MEMBERS, and so on. Chip labels, button labels and body copy are NOT uppercased.

### Preconditions

```bash
cd /home/jintek/projects/github/@jintekc/btcr2-aggregation
```

```bash
# nothing else may hold port 8080 (expect NO output):
ss -ltn | grep ':8080'
```

```bash
# terminal 1, the service, hermetic default (no LIVE, no BROADCAST):
OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" DEFAULT_SIZE=2 pnpm demo
```

Wait for terminal 1 to print a line of the form:

```
[demo] service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))
[demo] idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)
```

Keep a SECOND terminal for the curl and command-line cross-checks. Open one browser window at `http://localhost:8080/operator`.

`DEFAULT_SIZE=2` is belt-and-braces: 2 is already the built-in default (`packages/service/src/runtime-settings.ts:282`), and `DEFAULT_THRESHOLD` is unset so k seeds to n (`runtime-settings.ts:321-322`), giving a 2-of-2 create form.

### Steps

1. **Sign in.** Load `http://localhost:8080/operator`, type `phase5` into the `Operator password` field, click `Sign in`.
   Look for: the console loads and the health strip carries a neutral badge reading `Hermetic`. (Until the first list read lands the strip says `Checking mode`; wait for it to settle.) This mode is what makes the rest of the test meaningful: a hermetic service co-signs a fixture transaction and broadcasts nothing.

2. **Read the metrics row** at the top of the list, left to right.
   Look for: four counters captioned `open`, `in flight`, `anchored`, `failed` (rendered uppercase). All four read 0 on a fresh boot.

3. **Create and advertise a cohort.** Click `New cohort`. Leave `Signing threshold (k)` and `Cohort size (n)` at 2. Click `Create draft`. The new row appears under the `Drafts` heading; click `Advertise cohort` on it.
   Look for: you land in that cohort's drill-down automatically (the advertise action opens the LIVE cohort id, which is a NEW id, not the draft id). Copy the value from the `cohort id` field under the heading. The stage timeline shows `Advertised` complete with `Filling` active.

4. **Open the test-peer confirm.** Scroll to the `Members` card and click `Fill remaining seats with test peers`.
   Look for: a warn-toned confirm headed `Add 2 test peers to this cohort?`, with a confirm button reading `Add 2 test peers` and a cancel button reading `Cancel`. Because this service is hermetic there is NO extra line about peers co-signing for real (that line is gated on `health.mode === 'live'`).

5. **Fill the seats.** Click `Add 2 test peers` and wait for the next detail poll (up to 4 seconds; give it 10 to be safe).
   Look for, all at once:
   - two seated member rows, each carrying a neutral badge reading `Test peer` and the line `Test peer added by the operator.`
   - the stage timeline with `Advertised`, `Filling`, `Closed` and `Submissions` rendered complete, `Co-signing` as the ACTIVE stage, and `Anchor` still pending
   - the `Closed` row carrying its caption `Every seat filled, so this cohort locked and stopped accepting joins.`
   - the Activity log ending with `Co-signing complete.`

   Honest note: do NOT expect to watch the stages tick over one by one. Measured on this exact flow, opt-in through co-sign completion takes about 220 ms, while the drill-down polls every 4000 ms (`CohortDetail.tsx:37`). The timeline is already at its settled shape by the first poll after your click. For the same reason `Finalize now` cannot be caught by hand on this path.

6. **Read the last stage, then the anchor card.** Read the LAST label in the stage timeline, then scroll to the `Anchor` card.
   Look for: the last stage reads `Anchor`, never `Anchored` (the relabel is gated on a confirmed anchor, `OperatorStageTimeline.tsx:188`). The `Anchor` card's only body text is `This no-broadcast service does not publish to Bitcoin, so there is no on-chain anchor to show.` There is no txid, no explorer link, and no Signed/Broadcast/Confirmed sub-steps.

7. **Return to the list.** Click `Back to cohorts`.
   Look for: under the `Ended` group heading, one row for this cohort carrying a NEUTRAL chip labelled `Signed` with a non-pulsing dot, and the text `2/2 seats`. The row shows no network and no beacon type: a successful completion is pruned from the operator list, so this row renders from the monitoring record alone, and the missing fields are deliberately not invented. The row offers `Open` and `Dismiss`.

8. **Read the metrics row again.**
   Look for: `anchored` reads 0. `open`, `in flight` and `failed` also read 0. The completion is counted by the presence of the row under `Ended`, not by any counter.

9. **Confirm the bucket.** Scan the whole list for a `Needs attention` heading.
   Look for: there is no `Needs attention` group at all on this run. A group heading renders only when its group is non-empty (`OperatorCohortList.tsx`, the `grouped[g].length === 0 ? null : ...` branch). A plain key-path co-sign is settled, so it belongs under `Ended`.

10. **Do it a second time.** Repeat steps 3 through 7 for a SECOND cohort. The create form is STILL OPEN from step 3 (nothing closes it, so the `New cohort` button is not on the page), so click `Create draft` directly, then `Advertise cohort`, then `Fill remaining seats with test peers` plus its confirm, then `Back to cohorts`. Only if you clicked the form's `Cancel` at some point do you need `New cohort` again.
    Look for: two `Signed` rows now sit under `Ended`, and `anchored` STILL reads 0. Completing more cohorts never moves that counter on a hermetic service.

11. **Cross-check the served list read.** In terminal 2:

    ```bash
    curl -s -c /tmp/op.jar -X POST http://localhost:8080/v1/operator/login -H 'content-type: application/json' -d '{"password":"phase5"}'; echo
    curl -s -b /tmp/op.jar http://localhost:8080/v1/operator/cohorts
    ```

    Look for: the login returns `{"ok":true}`. Each completed cohort appears in `monitoring.rows` with `"chip":"co-signed"` (never `"anchored"`), `"seatsJoined":2`, `"capacity":2`, `"phase":"ended"`. `monitoring.metrics` reads `"anchored":0` (and `"failed":0`). The top-level `cohorts` array is empty, because a successful completion is pruned from the operator list. `monitoring.health.mode` reads `"hermetic"`.

12. **Cross-check the per-cohort projection.** Substitute a completed cohort id you copied in step 3 or 10:

    ```bash
    curl -s -b /tmp/op.jar http://localhost:8080/v1/operator/cohorts/PASTE_COHORT_ID_HERE
    ```

    Look for: `"phase":"Complete"`, `"anchor":{"enabled":false,"state":"none"}`, `"fallback":{"used":false,...}`, `"coSign":{"noncesReceived":2,"total":2,"awaitingPartialSigs":false}`, and both members carrying `"testPeer":true`. Nothing in the projection claims an anchor.

13. **Run the script-path leg a browser cannot produce by hand.** In terminal 2 (you may leave the service in terminal 1 running: this harness binds its own ephemeral loopback port, `e2e/fallback-cohort.ts:357`):

    ```bash
    pnpm e2e:fallback:operator
    ```

    Look for: exit 0 and a final line beginning `OPERATOR FALLBACK E2E PASSED`.
    What this leg proves: it drives a real 2-of-3 signing round hermetically, drops one signer at `signing-requested`, salvages the round through `POST /v1/operator/cohorts/:id/finalize`, asserts the result is a `script-path` completion, asserts the gated detail read reports `fallback.used`, and asserts the finalize is attributed exactly once in the activity ring. What it does NOT do: it asserts nothing about the list chip and nothing about the metrics.

14. **Run the rule that decides the script-path row's label and bucket.**

    ```bash
    pnpm exec vitest run packages/web/tests/operator-rows.spec.ts
    ```

    Look for: `1 passed (1)` files and `26 passed (26)` tests. The rows that matter here are `renders a completed SCRIPT-PATH co-sign warn-toned, matching the fallback chip it sits beside` (line 141), `gives every chip its OWN label, across the whole set` (line 156), and `confirmation decides the word, the script path decides the bucket` (line 184), which pins co-signed to Ended, co-signed-fallback to attention, fallback to attention, and anchored to Ended in one assertion block.

15. **Read the two chip definitions.** Open `packages/web/src/lib/operator-rows.ts` at lines 120, 125 and 205.
    Look for: line 120 `'co-signed': { tone: 'neutral', label: 'Signed', pulse: false }`; line 125 `'co-signed-fallback': { tone: 'warn', label: 'Signed via fallback', pulse: false }`; line 205 listing `'co-signed-fallback'` EXPLICITLY in the `groupForChip` attention branch, so a script-path completion keeps both its own label and its own bucket. Line 127 keeps `anchored: { tone: 'good', label: 'Anchored', pulse: false }` for the confirmed case only.

### Pass

- A completed hermetic key-path cohort renders under the `Ended` heading with a neutral chip labelled `Signed`, not `Anchored`, and not under `Needs attention`.
- The `anchored` counter stays at 0 through two completed cohorts.
- The drill-down's last timeline stage reads `Anchor` (not `Anchored`), and the `Anchor` card states this no-broadcast service publishes nothing to Bitcoin.
- `GET /v1/operator/cohorts` serves `"chip":"co-signed"` for each completed cohort and `"anchored":0` in `monitoring.metrics`, with the top-level `cohorts` array empty.
- `GET /v1/operator/cohorts/:id` serves `"anchor":{"enabled":false,"state":"none"}` and `"fallback":{"used":false,...}`.
- `pnpm e2e:fallback:operator` exits 0.
- `pnpm exec vitest run packages/web/tests/operator-rows.spec.ts` passes 26 tests, including the four-way grouping row and the whole-set label distinctness row.

### Fail signals

- Any completed hermetic cohort shows the good-toned `Anchored` chip: the console would be claiming a Bitcoin confirmation this service never made.
- The `anchored` counter increments on a completed hermetic cohort.
- The stage timeline's final stage relabels to `Anchored` with nothing confirmed.
- The served chip is `"anchored"` or `"fallback"` in `monitoring.rows` on this hermetic boot.
- The `Signed` chip pulses, or renders good-toned green: a pulse says still in flight, green says success on chain.
- A chip labelled `Co-signed` appears (one character from the live `Co-signing` chip); the shipped label is `Signed`.
- `groupForChip` sends `'co-signed-fallback'` to `ended` (the vitest four-way row goes red): that would silently take the script-path row out of `Needs attention`.
- Two chips share a label (the whole-set distinctness row goes red).

### Limits

The hermetic path cannot exercise the promotion half of the rule: nothing here proves that a CONFIRMED beacon transaction promotes the record to `Anchored` and increments the anchored counter, nor that a beacon tx that is broadcast but never confirms correctly STAYS at `Signed` (the mainline live case gap plan 05-20 was filed about), and both need `LIVE=1 BROADCAST=1` against a chain you control, funded and watched to confirmation; a k-of-n script-path completion cannot be produced by hand in the browser at all, because it needs a signer that drops at exactly the signing-requested moment while the hermetic round passes through that window in roughly 220 ms, so steps 13 through 15 verify that leg as a service-level e2e plus a pure-rule unit spec plus a source read, never as a rendered row; `packages/web` has no DOM test harness (no jsdom, no happy-dom, no testing-library, no spec that renders a component), so `chipPresentation` is verified as DATA the component reads and never as the rendered badge, meaning a `StatusChip` that called the accessor and then hard-coded a tone would still pass every automated check, which is exactly why the browser steps are worth doing by eye; and the completed-cohort row survives only as long as the monitor's bounded 24-entry retention (`MAX_TERMINAL = 24`, `packages/service/src/monitor.ts:74`), with all state in memory and cleared by a restart.

---

<a id="test-13"></a>

## Test 13: The three console surfaces read well at a real viewport

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (12 problem(s) found and corrected).

# Test 13: The three console surfaces read well at a real viewport

**Checkpoint:** at a real browser viewport the operator console list, the drill-down, and the health strip read well together: nothing overflows, chips stay on screen, grouping is legible without horizontal scrolling.

**Hermetic:** yes for steps 1 through 18. Step 19 is a second boot in LIVE+BROADCAST mode that still contacts no chain.

---

## Preconditions

- `cd /home/jintek/projects/github/@jintekc/btcr2-aggregation`
- Nothing else is listening on port 8080: `ss -ltn '( sport = :8080 )'` prints only the header line.
- A Chromium-based browser (Chrome / Chromium / Edge) with DevTools. The device toolbar (`Ctrl+Shift+M`) sets exact viewport widths; the Console tab runs two overflow probes.
- Boot command (hermetic default: no `LIVE`, no `BROADCAST`). The long `SERVICE_NAME` is deliberate: it is the health strip's wrap backstop under test.

  ```bash
  OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 viewport check aggregation service" DEFAULT_SIZE=2 DEFAULT_THRESHOLD=2 pnpm demo
  ```

  `pnpm demo` is `pnpm -r build && tsx packages/service/src/demo-server.ts` (package.json:43), so the first run also builds the SPA.
- `OPERATOR_COOKIE_SECURE=0` makes the session cookie non-Secure. The default is `cookieSecure: true` (`packages/service/src/index.ts:696`) and the cookie is written with `secure: cookieSecure`, `sameSite: 'Strict'` (`packages/service/src/operator-auth.ts:250-253`). Chromium accepts a Secure cookie on `http://localhost`, so this is a safety belt rather than a hard requirement; keep it so a browser that disagrees cannot make login appear to succeed and then bounce back to the login panel.
- If `http://localhost:8080` does not connect, use `http://127.0.0.1:8080`: the service binds loopback IPv4 unless `HOST` is set (`packages/service/src/demo-server.ts:530`).
- Step 19 (optional) uses a second boot:

  ```bash
  LIVE=1 BROADCAST=1 NETWORK=regtest ESPLORA_HOST=http://127.0.0.1:1 OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 viewport check aggregation service" pnpm demo
  ```

  Constructing the live `BitcoinConnection` issues no HTTP request (`packages/service/src/demo-server.ts:454`), and no esplora read happens until a live+broadcast cohort is advertised, which this leg never does. The boot invariant at `demo-server.ts:363` passes with defaults, because `DEFAULT_PHASE_TIMEOUT_MS` 1800000 (`demo-server.ts:38`) exceeds `DEFAULT_FUNDING_WINDOW_MS` 720000 (`demo-server.ts:64`).

---

## Steps

**1. Boot.** Run the boot command and wait for the build to finish.

Look for two lines with the `[demo]` prefix (`demo-server.ts:262`): `service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))` and `idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)` (`demo-server.ts:531-537`). The word `served` rather than `not served` is required, otherwise the SPA was not built and there is nothing to look at.

**2. Open the console at 1440 x 900.** Press `Ctrl+Shift+M`, choose Responsive, type 1440 x 900. Navigate to `http://localhost:8080/operator` and log in with `phase5`.

Look for the login panel being replaced by the console: a `New cohort` button (`packages/web/src/components/operator/OperatorConsole.tsx:147`) and a `Sign out` control (`OperatorConsole.tsx:132`). Either one is the proof; the page heading is not. `Operator console` (`OperatorConsole.tsx:130`) reads identically on the login panel (`packages/web/src/components/operator/LoginPanel.tsx:25`), so it is present on both sides of the sign-in boundary and can never have told you whether the sign-in succeeded, which is what this step used to cite it for (corrected by 05-27, `05-AUDIT-2.md` entry 24). If you instead see `Operator console is disabled` (`OperatorConsole.tsx:82`), the service booted without `OPERATOR_PASSWORD`; stop and re-boot.

**3. Read the health strip (the top card) left to right.**

Look for one wrapping chip row containing, in order: a `Hermetic` chip (`packages/web/src/components/operator/HealthStrip.tsx:9` and :94), the plain-text service name `Phase 5 viewport check aggregation service` (`HealthStrip.tsx:104`), a `Mutinynet (signet)` network chip (`HealthStrip.tsx:113`, label from `packages/shared/src/networks.ts:117`), an `IPFS off` chip (`HealthStrip.tsx:139`), and at the far right a status dot plus an `Updated Ns ago` label that counts up once per second (`HealthStrip.tsx:90`). There is NO `Esplora reachable` chip: it is live-modes-only (`HealthStrip.tsx:119-123`). The first chip should stop reading `Checking mode` (`HealthStrip.tsx:94`) as soon as the first gated read lands, which happens immediately after login (`packages/web/src/stores/operator.ts:686`), not on the 4 second poll.

**4. Read the second card, directly under the strip.**

Look for a `Service controls` card (`packages/web/src/components/operator/ServiceControls.tsx:212`) carrying the line `New cohorts are being advertised normally.` (`packages/web/src/stores/operator.ts:119`), a `Pause advertising` button (`ServiceControls.tsx:27`), a `Service settings` button (`ServiceControls.tsx:38`), then two muted lines: `Pause, broadcast, and settings changes live in memory for this session. A restart returns this service to its boot environment.` (`stores/operator.ts:141-142`) and `Pausing does not end cohorts that are already open. Cancel each one if you need this service fully quiet.` (`stores/operator.ts:149-150`). Below them an `Operator actions` block (`stores/operator.ts:285`) with TWO paragraphs: `No operator actions this session.` (`stores/operator.ts:286`) and the muted body beginning `Actions you take here, like pausing advertising or canceling a cohort, are listed as you take them.` (`stores/operator.ts:287-288`). There is NO `Disable broadcast` button: it renders only on the served `live` mode (`ServiceControls.tsx:132`, :237).

**5. Create THREE drafts.** Click `New cohort` (`OperatorConsole.tsx:147`). In the `Create a cohort` form (`packages/web/src/components/operator/CreateCohortForm.tsx:128`) set `Signing threshold (k)` to 2 (`CreateCohortForm.tsx:150`) and `Cohort size (n)` to 2 (`CreateCohortForm.tsx:164`), then click `Create draft` (`CreateCohortForm.tsx:195`) three times. The form does not clear its fields between creates (`stores/operator.ts:903-910`), so three clicks give three identical drafts. Then click `Cancel` (`OperatorConsole.tsx:167`) once to close the form.

Look for a `Drafts` group heading above three rows (`packages/web/src/components/operator/OperatorCohortList.tsx:38`, rendered at :367). Each draft row shows a neutral `Draft` chip (`packages/web/src/lib/operator-rows.ts:110`), `mutinynet`, `CAS`, `0/2 seats` (`OperatorCohortList.tsx:157-171`), `Co-sign: 2-of-2` (`OperatorCohortList.tsx:172`, value from `packages/web/src/lib/directory.ts:164`), an `Advertise cohort` button (`:184`), an `Edit draft` button (`:193`), a `Discard draft` button (`:197`), and a `draft id` copy field (`:244`). The metrics row above shows four counters captioned `open`, `in flight`, `anchored`, `failed` (`OperatorCohortList.tsx:68-71`).

**6. Advertise the FIRST draft.** Click its `Advertise cohort`.

Look for the view switching to that cohort's drill-down (wired in the store's advertise action, `stores/operator.ts:965`): a `Back to cohorts` control (`packages/web/src/components/operator/CohortDetail.tsx:340`), a `Cohort <8 chars>…` heading (`CohortDetail.tsx:349`, shortener at `:56`), a stage timeline card, a `Lifecycle` card (`packages/web/src/components/operator/LifecycleActions.tsx:148`) carrying a danger-toned `Cancel cohort` button (`LifecycleActions.tsx:43`) with `Available until this cohort's beacon transaction is broadcast.` (`:44`) beside it and a disabled `Finalize now` (`:57`) with `Available once this cohort's signing round starts.` (`:58`), then cards titled `Members`, `Submissions`, `Co-sign`, `Anchor`, `Activity` and `Export` (`CohortDetail.tsx:373, 416, 430, 463, 485, 495`). The `Anchor` card reads `This no-broadcast service does not publish to Bitcoin, so there is no on-chain anchor to show.` (`CohortDetail.tsx:476-477`). The health strip and the `Service controls` card are STILL above all of it (`OperatorConsole.tsx:100-104`): this is the screen where all three surfaces are on one page.

**7. Join from a second window.** Click `Back to cohorts`, then open a SECOND browser window (not a tab in the device-toolbar window) at `http://localhost:8080`. Find the advertised cohort in the directory and click `Join` on its row (`packages/web/src/components/browse/CohortRow.tsx:80`). On the identity step click `Generate a new identity` (`packages/web/src/components/browse/JoinIdentityStep.tsx:164`), then click `Join cohort` (`JoinIdentityStep.tsx:227`).

Look for the join to complete without an error banner. The `Generate a new identity` click is not optional: with no identity in this browser the chooser branch renders and `Join cohort` does not exist until an identity is generated or imported (`JoinIdentityStep.tsx:103`).

**8. Watch the Active group appear.** Return to the operator window.

Look for, within about 4 seconds (the list poll interval, `OperatorConsole.tsx:13`), an `Active` group (`OperatorCohortList.tsx:37`) with that cohort showing an accent `Filling` chip (`lib/operator-rows.ts:111`) and `1/2 seats`.

**9. Fill the last seat with test peers.** Click `Open` on the Active row (`OperatorCohortList.tsx:221`). In the `Members` card click `Fill remaining seats with test peers` (`stores/operator.ts:312`) and confirm on the warn-toned panel.

Look for the seat filling and a second member row carrying a `Test peer` badge and the line `Test peer added by the operator.` (`CohortDetail.tsx:79-80`, rendered at `:103-105`); the real participant's row carries neither.

**10. Submit the participant's update.** Switch to the participant window. The cohort is now closed and the browser participant holds an OPEN submit window.

Look for a warn-toned panel headed `Your update is needed` (`packages/web/src/components/cohort/SubmitPanel.tsx:106`) with the line `The cohort is waiting on your submission before it can co-sign.` (`SubmitPanel.tsx:108`). Click `Submit my DID update` (`SubmitPanel.tsx:148`). This click is mandatory: the round does not advance until the store's deferred resolves (`packages/web/src/stores/participant.ts:1686-1687`, `:2032-2041`), and without it the cohort sits until the 30 minute phase timeout and then fails.

Back in the operator window, look for the cohort to finish within a few polls and, after `Back to cohorts`, to appear under an `Ended` group (`OperatorCohortList.tsx:39`) with a neutral `Signed` chip (`lib/operator-rows.ts:120`) plus `Open` and `Dismiss` controls (`OperatorCohortList.tsx:221`, `:224-228`, label at `stores/operator.ts:257`). The `anchored` counter stays at 0: a hermetic co-sign counts in neither the anchored nor the failed column (`packages/service/src/monitor.ts:1697-1713`).

**11. Advertise the SECOND draft, then come straight back.** On the list, click `Advertise cohort` on the second draft, then click `Back to cohorts`.

Look for three groups now on one screen: `Active` (the newly advertised cohort, `Filling`, `0/2 seats`), `Drafts` (the one remaining draft), and `Ended` (the completed cohort). The advertised row also carries `Only a draft can be edited. This cohort is already advertised.` (`stores/operator.ts:71`, rendered at `OperatorCohortList.tsx:200`).

**12. Pause advertising.** Click `Pause advertising` on the controls card.

Look for: no confirmation dialog; the strip gaining a warn `Advertising paused` chip beside the `Hermetic` chip (`HealthStrip.tsx:129`); the controls card line changing to `New cohorts are not being advertised. Cohorts already advertised keep filling, and everything else on this service keeps running.` (`stores/operator.ts:115-116`); the button becoming `Resume advertising` (`ServiceControls.tsx:30`); the remaining draft's `Advertise cohort` button disabled with `Advertising is paused.` beside it (`stores/operator.ts:133`, rendered at `OperatorCohortList.tsx:187`). The `Operator actions` log is ALREADY a scrolling `LogPanel` rather than the empty state, because adding test peers recorded a service-level action in step 9 (`packages/service/src/index.ts:1337`, served at `packages/service/src/hono-adapter.ts:1105`); pausing appends a further timestamped entry (`hono-adapter.ts:857`).

**13. Page overflow probe at 1440.** Still at 1440 x 900 on the LIST view, open the DevTools Console tab, paste this, press Enter:

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth
```

Look for `0`. Any positive number means the page scrolls horizontally at a 1440px viewport, which is a fail.

**14. Element overflow probe at 1440.** In the same Console, paste this and press Enter:

```js
[...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > document.documentElement.clientWidth + 1 || r.left < -1); }).map(e => `${e.tagName}.${typeof e.className === 'string' ? e.className.slice(0,60) : ''}`)
```

Look for `[]`. If it returns entries, scroll to each named element and look at it. A hit whose class list contains `overflow-y-auto` (the log box, `packages/web/src/components/LogPanel.tsx:54`) means a long log line scrolls inside its own box, which is contained as long as step 13 returned `0`. A hit anywhere else is a real overflow.

**15. Re-probe at 1024 x 768.** Change the device-toolbar viewport to 1024 x 768 and re-run both probes on the list view, then look at the centred column and the metrics row.

Look for step 13 returning `0` and step 14 returning `[]`. The content column is the window width minus padding: the app container is `mx-auto ... max-w-6xl ... px-4 py-6 sm:px-6` (1152px max, `packages/web/src/App.tsx:75`), so at 1024 it fills the window. The metrics row is still four columns across (`grid-cols-2 sm:grid-cols-4`, `OperatorCohortList.tsx:74`). Each of `Active`, `Drafts`, and `Ended` is readable with its rows beneath it and no row content clipped.

**16. Re-probe at 390 x 844 (a phone width).** Change the viewport and re-run both probes on the list view.

Look for step 13 returning `0` and step 14 returning `[]`. The health strip chips wrap onto several lines rather than running off the right edge (the strip is `flex flex-wrap items-center gap-2`, `HealthStrip.tsx:93`). The metrics row is 2 x 2. Each row's chip, network, beacon type, seats and `Co-sign: 2-of-2` wrap (`OperatorCohortList.tsx:157-172`), the action buttons wrap to their own line, and each `cohort id` / `draft id` value truncates with an ellipsis inside its field with the `copy` button still fully visible on the right (`packages/web/src/ui/primitives.tsx:431-433` and `:439`). On the drafts row check `Advertise cohort` plus its `Advertising is paused.` reason specifically: a button and a sentence on one flex line is the most likely wrap failure here.

**17. Drill-down at 390.** Click `Open` on the ended cohort. In the `Members` card expand `Technical detail` on a member row (`CohortDetail.tsx:108`, expander at `primitives.tsx:44-57`, toggle text `Show` / `Hide` at `primitives.tsx:54`). In the `Submissions` card expand `Raw signed update` (`CohortDetail.tsx:232`). Re-run both probes.

Look for step 13 returning `0`. The raw JSON block wraps and breaks long tokens rather than widening the card (`whitespace-pre-wrap break-all`, `CohortDetail.tsx:233`) and the expander scrolls internally past its own height (`max-h-80 overflow-auto`, `primitives.tsx:56`). The `member did` copy field (`CohortDetail.tsx:106`) truncates rather than pushing its `copy` button off screen. Step 14 may name elements inside those two scrolling boxes; that is contained as long as step 13 is `0`. Also check the `Lifecycle` card on the still-Active cohort at this width: its danger button plus availability sentence must wrap, not overlap.

**18. Log containment.** Scroll to the `Activity` log at the bottom of the drill-down, then go back to the list and scroll inside the `Operator actions` log on the controls card, using the mouse wheel in each.

Look for each log scrolling WITHIN its own bordered box while the surrounding page does not jump. The `Activity` log is a fixed 24rem tall (`CohortDetail.tsx:489`, `h-[24rem]`) and the `Operator actions` log a fixed 12rem (`ServiceControls.tsx:328`, `h-48`); both show an `N events` counter in their header (`LogPanel.tsx:50`). Timestamps sit in a `shrink-0` gutter that does not push the message text off the right edge (`LogPanel.tsx:62-63`).

**19. OPTIONAL, maximum chip density (required if you want to answer judgment A in step 20).** Stop the service with `Ctrl+C`, boot the second command from the preconditions, log in again at 1440 x 900, click `Pause advertising`, then click the danger-toned `Disable broadcast` button (`stores/operator.ts:226`, rendered at `ServiceControls.tsx:237-241`) and confirm on the three-line panel (`ServiceControls.tsx:253-273`).

Look for the strip carrying SIX chips plus the service name plus the freshness label, in this order: `Live` (`HealthStrip.tsx:11`), the name, `Regtest (local)` (`packages/shared/src/networks.ts:164`), `Esplora reachable` (`HealthStrip.tsx:121`), `Advertising paused` (`HealthStrip.tsx:129`), `Broadcast off (this session)` (`HealthStrip.tsx:24`, rendered at `:137`), `IPFS off` (`HealthStrip.tsx:139`). The `Disable broadcast` button is GONE, replaced by the line `Broadcast is off for new cohorts. Restart this service with BROADCAST=1 to turn it back on.` (`stores/operator.ts:242-243`, rendered at `ServiceControls.tsx:248`). Re-run both probes: step 13 returns `0`. This is the densest the strip ever gets. Do NOT read the `Esplora reachable` badge as evidence of anything: it starts optimistically true and nothing has contacted a chain (`packages/service/src/monitor.ts:871`, and the T-05-16-05 disclosure in `.planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md:171-179`). This boot has no cohorts, so the list shows the `No cohorts yet` empty state (`OperatorCohortList.tsx:356`).

**20. Make the judgment this checkpoint exists for.** At 1440 and at 1024, look at the whole drill-down screen (strip, controls card, drill-down, all three at once) and record a yes or no for each:

- **A.** Does the kill-switch ceremony read as grave enough for a one-way money action? Answerable only if step 19 was run; record "not exercised" otherwise.
- **B.** Does the `Operator actions` log sit comfortably at the bottom of the controls card rather than dominating it?
- **C.** Do two warn chips beside the mode chip crowd the strip? (Both warn chips together require step 19; at step 12 you have one warn chip beside the mode chip, which answers a weaker version of the question.)

These are the three judgments deferred to this walkthrough by `.planning/phases/05-operator-cohort-lifecycle-control/05-08-SUMMARY.md:149` and `:282`, and no unit test asserts any of them.

---

## Pass

- At every viewport tested (1440, 1024, 390) and on both composite screens (list view and drill-down view), `document.documentElement.scrollWidth - document.documentElement.clientWidth` is `0`.
- The element-overflow probe returns `[]`, or returns only elements inside an `overflow-y-auto` / `overflow-auto` log or expander box while the page probe stays `0`.
- At 390px every health-strip chip is fully on screen on some line: no chip is half cut by the right edge and none is pushed under another.
- The `Active`, `Drafts`, and `Ended` group headings each sit above their own rows with visible separation, and no row's chip, seats text, or action buttons overlap another row's.
- Long values (cohort ids, member DIDs, raw JSON) are truncated, wrapped, or internally scrolled, never allowed to widen their card.
- Both fixed-height logs scroll inside their own box; the page does not grow to fit their contents.
- The three judgments in step 20 are answered and recorded, with A (and the two-warn-chip half of C) marked "not exercised" if the optional step 19 was skipped.

## Fail signals

- A horizontal page scrollbar at any tested width, that is, step 13 returning any positive number.
- A health-strip chip clipped by the right edge or overlapping the freshness label at 390px (the strip's `flex-wrap` backstop, `HealthStrip.tsx:93`, failing).
- The metrics row failing to collapse to two columns at 390px, or its counters colliding with their captions.
- A `cohort id`, `draft id`, or `member did` value pushing its `copy` button off screen instead of truncating (a broken `min-w-0` / `truncate` pair, `primitives.tsx:431-433`).
- The `Operator actions` log growing without bound and pushing the cohort list below the fold instead of scrolling inside its 12rem box.
- A row's action buttons overlapping its chips or its id field at any width instead of wrapping; likewise the `Lifecycle` card's button-plus-sentence rows.
- Group headings rendering with no visual separation from the previous group's last row, so `Ended` rows read as part of `Drafts`.

## Limits

This does not exercise the `Needs attention` group: producing a `Signed via fallback` or `Failed` row hermetically needs a signing round that stalls with a missing co-signer, which is not reproducible on demand from a browser (all four groups render through the same `SectionTitle` heading plus the same `CohortRow` component in one loop, `OperatorCohortList.tsx:364-373`, so exercising three of them exercises the fourth's layout but not its specific chip labels in situ). It does not exercise the `FundingStage` card at all: that card renders only when the served detail carries a funding view, which only a live broadcasting cohort produces (`CohortDetail.tsx:456-459`). The optional step 19 leg gets the maximum chip count onto the strip but contacts no chain, so nothing it shows is evidence about esplora, funding, or broadcast behaviour, and the `Esplora reachable` badge there is an optimistic initial value, not an observation. Finally, this is one browser engine at 100% zoom: it proves nothing about Safari or Firefox layout, other zoom levels, or OS-level font scaling.

---

<a id="test-14"></a>

## Test 14: The runbook describes what actually ships

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (12 problem(s) found and corrected).

## Test 14: The runbook describes what actually ships

Hermetic. No chain, no wallet, no funds.

### Preconditions

- `cd /home/jintek/projects/github/@jintekc/btcr2-aggregation`
- Nothing else is listening on port 8080: `ss -ltn '( sport = :8080 )'` prints only the header line.
- PATH A (the document's own quick start) needs Docker and Docker Compose plus outbound network for the image build. Check with `docker compose version`.
- PATH B (fallback, if Docker is unavailable) uses the runbook's own "Running the compiled server without Docker" section at docs/DEPLOY.md:517-526 and needs Node 22 plus pnpm.
- Steps 10 onward run `pnpm demo` (package.json:43 = `pnpm -r build && tsx packages/service/src/demo-server.ts`), so they need workspace dependencies installed locally. PATH B testers already have them. PATH A testers must run the install command the runbook prints at docs/DEPLOY.md:523 before reaching step 11.
- Every boot in this procedure binds 8080. Stop the previous container or process before starting the next one.
- Read ONLY docs/DEPLOY.md while running steps 1 through 9. The point of this test is whether the document alone gets a stranger to a working operator console; consulting the source or the UAT checklist mid-run destroys the measurement. Steps 10 onward are the truth-checks and DO read source.

### Steps

1. **Read the quick start cold.** Read docs/DEPLOY.md from the top through the end of the `## Quick start (mutinynet, offline)` section (lines 1 to 63) and stop there.

   Look for: the section opens with a paragraph telling you to set an operator password first, giving the reason (an empty password means fail-closed, and since the service advertises nothing on its own, no password means no cohort can ever exist) at docs/DEPLOY.md:29-33. This is the sentence 05-18 added. If the section jumps straight to `docker compose up`, the runbook regressed.

2. **Run the document's own boot command.**

   PATH A: run the two commands exactly as printed at docs/DEPLOY.md:36-37.

   ```bash
   echo "OPERATOR_PASSWORD=$(openssl rand -base64 24)" >> .env
   docker compose up --build
   ```

   `.env` is gitignored (.gitignore:6), so this leaves nothing committable behind.

   PATH B: run the block exactly as printed at docs/DEPLOY.md:523-525, and note whether the document told you to carry OPERATOR_PASSWORD into this invocation.

   ```bash
   pnpm install --frozen-lockfile --trust-lockfile
   pnpm -r build
   HOST=0.0.0.0 NETWORK=mutinynet node packages/service/dist/demo-server.js
   ```

   Look for: PATH A, the image builds and the container logs the coordinator listening on 8080. PATH B, the compiled entrypoint starts, BUT because that snippet carries no OPERATOR_PASSWORD it prints the fail-closed banner. The exact first line is `[demo] !!! OPERATOR CONSOLE DISABLED !!!` followed by three indented reason lines (packages/service/src/demo-server.ts:446-451, prefixed by the `[demo] ` logger at :262). Record that as a finding against the section: line 525 is the only run instruction in the whole document that does not carry the password, because every other run command is a `docker compose up` that reads `.env`. To continue, re-run WITHOUT `HOST=0.0.0.0` so the service binds loopback rather than every interface (the bare entrypoint's documented default, demo-server.ts:562-566):

   ```bash
   OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 NETWORK=mutinynet node packages/service/dist/demo-server.js
   ```

3. **Run the document's liveness probe.** Exactly as printed at docs/DEPLOY.md:470.

   ```bash
   curl -fsS http://localhost:8080/v1/config
   ```

   Look for: a JSON object with exactly four keys on this default boot (no SERVICE_NAME, no TERMS_TEXT), for example `{"network":"mutinynet","label":"Mutinynet (signet)","isMainnet":false,"serviceDid":"did:btcr2:..."}`. The document's sample at docs/DEPLOY.md:471-472 shows six keys, and the prose at docs/DEPLOY.md:475-482 accounts for the difference: three keys are ADDITIVE, of which serviceName and termsText are absent on a default boot while serviceDid is present on every path this runbook documents. Confirm the prose matches what you got, not just the sample.

4. **Follow quick-start step 1 verbatim** (docs/DEPLOY.md:50-52): open http://localhost:8080/operator and log in with the password. For PATH A read it back with `cat .env`.

   Look for: the console loads and offers a `New cohort` button (packages/web/src/components/operator/OperatorConsole.tsx:147), which is rendered by the signed-in console and by nothing else. Do NOT read the `Operator console` heading (OperatorConsole.tsx:130) as the proof: LoginPanel.tsx:25 renders the identical string, so it is on both sides of the sign-in boundary (corrected by 05-27, `05-AUDIT-2.md` entry 24). If the login form accepts the password and then immediately returns you to the login form, you have hit the Secure-cookie case: the session cookie is set with `secure` and `sameSite: 'Strict'` (packages/service/src/operator-auth.ts:249-255). Only record that as a finding if it actually reproduces for you; modern browsers treat http://localhost as a trustworthy origin, so it may not. If it does, note that the runbook mentions the fix only in the environment table at docs/DEPLOY.md:509 and never in the quick start, then continue by setting `OPERATOR_COOKIE_SECURE=0` (PATH A: add it as a line in `.env` and re-run `docker compose up`, because compose passes it through at docker-compose.yml:99; PATH B: prefix it on the command line).

5. **Confirm the directory is empty before you act.** In a second terminal:

   ```bash
   curl -fsS http://localhost:8080/v1/directory
   ```

   Look for: `[]`. This is the observation that makes the document's claim at docs/DEPLOY.md:19-21 ("It advertises nothing on its own") checkable rather than assumed, and it must be made BEFORE you advertise anything.

6. **Follow quick-start step 2 verbatim** (docs/DEPLOY.md:52-55): create a cohort draft and advertise it.

   Look for: the `New cohort` button (OperatorConsole.tsx:147) opens a `Create a cohort` form (CreateCohortForm.tsx:128); `Create draft` (CreateCohortForm.tsx:195) produces a row chipped `Draft` (packages/web/src/lib/operator-rows.ts:110); `Advertise cohort` (packages/web/src/components/operator/OperatorCohortList.tsx:184) moves it into the directory and lands you in its drill-down (that navigation is deliberate: packages/web/src/stores/operator.ts:955-966). The form opens on 2 seats. If you want to check the served seed rather than the rendered field, the gated read is `GET /v1/operator/settings`, which returns `"defaultSize":{"value":2,"envDefault":2,"changed":false}` on a boot that sets no seat variables. Re-run the step 5 curl now: the directory holds one entry with `"phase":"Advertised"`.

7. **Follow quick-start step 3 verbatim** (docs/DEPLOY.md:56-57): open http://localhost:8080 in another tab as a participant, browse the directory, and join the cohort.

   Look for: the cohort appears in the public directory. Click `Join` on its row (packages/web/src/components/browse/CohortRow.tsx:80), accept the identity the next step presents (it shows the DID and a save-to-re-import secret; there are also import and use-a-different-identity controls), then click `Join cohort` (packages/web/src/components/browse/JoinIdentityStep.tsx:227). With TERMS_TEXT unset there is no terms step. Back on the console the Members card reads `Seats: 1/2.` (packages/web/src/components/operator/CohortDetail.tsx:376 and :381).

8. **Follow quick-start step 4 verbatim** (docs/DEPLOY.md:58-61): from the cohort's drill-down use the control the document names as `Fill remaining seats with test peers`.

   Look for: a control with EXACTLY that label in the drill-down's Members card (the label is packages/web/src/stores/operator.ts:312, rendered at packages/web/src/components/operator/CohortDetail.tsx:201-206, inside the `Members` card at CohortDetail.tsx:372-412). It is a two-step control: the first click reveals a confirm, whose confirm label interpolates the remaining seat count (packages/web/src/stores/operator.ts:328), so with one seat left it reads `Add 1 test peers`, beside `Cancel` (operator.ts:329); the in-flight label is `Adding…` (operator.ts:331). If the cohort is already full the button is disabled with `This cohort has no seats left.` beside it (operator.ts:337). After confirming, the remaining seat fills and the cohort co-signs and finishes. This is the step that proves the runbook's rehearse-alone story: the retired filler-knob story it replaced would have had you set a boot variable instead. The same path is covered hermetically by `pnpm e2e:testpeers`.

9. **Grep for the retired knob.** Search the whole document for any instruction to set a boot-time seat-padding knob, then run from the repo root:

   ```bash
   grep -rin 'filler' docs/ docker-compose.yml || echo '(no matches)'
   ```

   Look for: `(no matches)`. Any hit in those two places is a fail. Do NOT widen this grep: a repo-wide search is not expected to be clean, because an inert `fillers?: number` option survives for source compatibility and is documented as dev/test-only and default-0 (packages/service/src/demo-server.ts:74-81). No code reads a FILLERS environment variable.

10. **Stop reading only the document.** Re-read the three environment-reference rows under test: docs/DEPLOY.md:510 (`MIN_PARTICIPANTS`), :511 (`AUTO_FALLBACK`), :512 (`SSE_DEBUG`), and the matching compose entries at docker-compose.yml:100-106 and :107-113.

    Look for: MIN_PARTICIPANTS described as a FALLBACK seed for a new draft's seat count, overridable per draft, shadowed by DEFAULT_SIZE which the compose file always sets, and explicitly NOT what completes a cohort. AUTO_FALLBACK described as default-on with `0` opting out, and flagged behavior-changing. SSE_DEBUG described as diagnostics only that changes no behavior. All three present in the compose environment block too.

11. **Verify those three rows against what the service actually reads.**

    ```bash
    grep -n 'MIN_PARTICIPANTS\|AUTO_FALLBACK' packages/service/src/demo-server.ts
    grep -rn 'SSE_DEBUG' packages/service/src/
    grep -n 'defaultSize: opts.defaultSize' packages/service/src/index.ts
    ```

    Look for: `AUTO_FALLBACK` at demo-server.ts:274 as `process.env.AUTO_FALLBACK !== '0'`, that is, default on with `0` opting out. `MIN_PARTICIPANTS` at demo-server.ts:567, which reaches `buildCohortConfig(minParticipants, ...)` at demo-server.ts:490 by way of the option guard at demo-server.ts:267, and then the settings seed `defaultSize: opts.defaultSize ?? opts.config.minParticipants` at index.ts:672. That `??` is exactly the shadowing the doc row describes: an explicit DEFAULT_SIZE wins, and the compose file always sets one (docker-compose.yml:56). `SSE_DEBUG` at hono-adapter.ts:71 as `process.env.SSE_DEBUG === '1'`, gating a logger only (the single match proves there is no second consumer).

12. **Prove the SSE_DEBUG row's claim is observable.** Stop the service, re-boot it with the diagnostic on:

    ```bash
    OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SSE_DEBUG=1 pnpm demo
    ```

    Then, in a second terminal, open the participant advert stream directly:

    ```bash
    timeout 5 curl -sN http://localhost:8080/v1/adverts
    ```

    Look for: the service terminal prints `[adapter] SSE open GET /v1/adverts` (hono-adapter.ts:591-593, via the `[adapter]` prefix at :74). curl being killed by the timeout is expected. Do NOT expect merely loading http://localhost:8080 in a browser to produce this line: the browse surface polls `GET /v1/directory` (packages/web/src/lib/operator.ts:1131), and the advert SSE is opened by the participant runner only once you JOIN a cohort (packages/web/src/stores/participant.ts:1680 and :1898). Loading the page, the directory and the config route emits no `[adapter]` output at all. The advert stream path matches the one the runbook's nginx block tells you not to buffer (docs/DEPLOY.md:389-391). Nothing about cohort behavior changes.

13. **Prove the /v1/config sample's additive keys.** Stop the service and re-boot with both optional values set:

    ```bash
    OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Acme aggregation" TERMS_TEXT="Be excellent to each other." pnpm demo
    ```

    Then print the served key set:

    ```bash
    curl -fsS http://localhost:8080/v1/config | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s)).sort().join(',')))"
    ```

    Look for: `isMainnet,label,network,serviceDid,serviceName,termsText`. That is exactly the sample's six keys at docs/DEPLOY.md:471-472. Cross-check the shape against the handler at packages/service/src/hono-adapter.ts:629-638 (the three network keys from `toNetworkConfigDTO`, packages/shared/src/networks.ts:199-201, spread with three conditional keys).

14. **Run the full environment-reference coverage check**, which compares every variable the service reads against the DEPLOY table and the compose environment block:

    ```bash
    for v in $(grep -rhno "process\.env\.[A-Z_][A-Z_0-9]*" packages/service/src | sed 's/.*process\.env\.//' | sort -u | grep -v '^X$'); do grep -q "| \`$v\`" docs/DEPLOY.md || echo "MISSING FROM DEPLOY TABLE: $v"; grep -q "^      $v:" docker-compose.yml || echo "not in compose environment block: $v"; done; echo '(end of list)'
    ```

    Look for: EXACTLY these five lines and no others.

    ```
    not in compose environment block: COHORT_TTL_MS
    not in compose environment block: HOST
    not in compose environment block: PHASE_TIMEOUT_MS
    not in compose environment block: PORT
    (end of list)
    ```

    Zero `MISSING FROM DEPLOY TABLE` lines is the hard requirement: every variable the service reads is documented. The four compose omissions are known and partly deliberate (PORT is used in the compose `ports:` mapping at docker-compose.yml:21; HOST is fixed to 0.0.0.0 by the image at Dockerfile:41). COHORT_TTL_MS and PHASE_TIMEOUT_MS are genuinely absent from the compose environment block while documented in the DEPLOY table at docs/DEPLOY.md:505-506; record that as an observation, not a fail. The `grep -v '^X$'` drops a `process.env.X` that appears only inside a comment at packages/service/src/runtime-settings.ts:54.

15. **Check the two positional quick-start guarantees 05-18 added**, which a file-wide grep cannot prove:

    ```bash
    awk '/^## Quick start/{f=1;next} /^## /{f=0} f' docs/DEPLOY.md | grep -c 'OPERATOR_PASSWORD'
    awk '/^## Quick start/{f=1;next} /^## /{f=0} f' docs/DEPLOY.md | grep -c '/operator'
    ```

    Look for: both print a count of 1 or more (today they print 2 and 1). A `0` from either means the quick start no longer names the operator password or no longer sends you to the console, which is the exact stranded-stranger defect 05-18 closed.

16. **Exercise the boot half of the discovery-window rule.** Read the `DEFAULT_DISCOVERY_WINDOW_MS` row at docs/DEPLOY.md:502 and the settings prose at docs/DEPLOY.md:241-252, then stop the service and boot with a value above the ceiling:

    ```bash
    OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 DEFAULT_DISCOVERY_WINDOW_MS=3600000 pnpm demo
    ```

    Look for: the service BOOTS (it does not refuse) and prints, before the listening line, `[settings] defaultDiscoveryWindowMs=3600000 exceeds this service's cohort TTL; using 1800000 instead, the longest discovery window this service can enforce` (packages/service/src/runtime-settings.ts:302 for the `[settings]` prefix and :381-384 for the message; 1800000 is `DEFAULT_COHORT_TTL_MS` at demo-server.ts:47). Both the supplied value and the enforced maximum are named. That is the clamp-at-boot half. The refuse-at-save half is what the console does with a typed value and is covered by criterion 3 of .planning/phases/05-operator-cohort-lifecycle-control/05-UAT-CHECKLIST.md:121-123. Both halves are stated distinctly in the doc row, so a doc that describes only one of them is a fail.

17. **Make the reviewer's judgment.** Answer, in writing: could a stranger with this repo and this document alone reach a logged-in operator console with a cohort advertised, joined and co-signed, without reading a source file or asking a question. Name every point where you had to guess or look outside the document.

    Look for: a recorded yes or no plus the list of guess points. The two candidates this procedure surfaces are the missing OPERATOR_PASSWORD in the no-Docker snippet at docs/DEPLOY.md:525 (step 2) and the OPERATOR_COOKIE_SECURE plain-http caveat living only in the environment table at docs/DEPLOY.md:509 rather than in the quick start (step 4). A third candidate to judge for yourself: the quick start names the test-peer control by its button label but does not say it is behind a confirm (step 8). If none of them bit you, say so.

### Pass

- The quick start sets OPERATOR_PASSWORD before anything else and states why (docs/DEPLOY.md:29-33).
- `GET /v1/directory` returns `[]` before the operator advertises anything, and one `"phase":"Advertised"` entry afterwards.
- Following the quick start's four numbered steps in order reaches a logged-in console, an advertised cohort, a joined participant, and a completed co-sign, using only labels the document prints.
- Every control name the quick start quotes exists verbatim in the shipped UI, in particular `Fill remaining seats with test peers` (packages/web/src/stores/operator.ts:312).
- `grep -rin 'filler' docs/ docker-compose.yml` returns no matches.
- MIN_PARTICIPANTS, AUTO_FALLBACK and SSE_DEBUG each appear in both the DEPLOY table and the compose environment block, and each row's description matches the code at demo-server.ts:567 plus index.ts:672, demo-server.ts:274, and hono-adapter.ts:71.
- With SSE_DEBUG=1, opening the advert SSE prints `[adapter] SSE open GET /v1/adverts` and nothing about cohort behavior changes.
- The coverage check in step 14 emits zero `MISSING FROM DEPLOY TABLE` lines.
- The served /v1/config key set on a name-and-terms boot is exactly the six keys in the doc's sample, and the doc's additive-key prose matches the default boot's four keys.
- Both positional quick-start greps in step 15 return a non-zero count.
- An over-ceiling DEFAULT_DISCOVERY_WINDOW_MS clamps with a warning naming both numbers and does not refuse to boot.

### Fail signals

- The quick start reaches its last numbered step without ever having sent you to /operator, or without a password having been set.
- The directory is non-empty on a fresh boot before the operator advertises anything.
- Any control name the document quotes does not exist in the UI, or exists with different wording.
- Any hit from the step 9 filler grep in docs/ or docker-compose.yml.
- Any `MISSING FROM DEPLOY TABLE` line in step 14: a variable the service reads that the runbook does not document.
- A key present in the served /v1/config that the document's sample and prose do not account for, or a key the document promises unconditionally that is absent on a default boot.
- Either positional grep in step 15 returning 0.
- The service REFUSING to boot on an over-ceiling DEFAULT_DISCOVERY_WINDOW_MS, which would contradict docs/DEPLOY.md:502 and the clamp 05-18 shipped.
- You had to open a source file, the compose file, or another document to get past a quick-start step (steps 1 through 9).

### Limits

Every step here is hermetic: no chain, no wallet, no funds. Nothing in it verifies the runbook's `Going live`, `Broadcasting cohort beacons for real`, funding-stage, mainnet, or IPFS sections, which need a real chain, a real wallet and, on mainnet, real funds; no amount of reading proves the funding-window or recovery-key copy is accurate. The AUTO_FALLBACK row's behavior claim (that with it off a stalled signing round no longer recovers on its own) is NOT proven: step 11 proves only that the variable is read with the polarity the doc states, and producing an actual signing stall needs a co-signer that goes silent mid-round. PATH A depends on Docker and on outbound network for the image build, so a green PATH B run says nothing about whether the compose file and Dockerfile actually work together, and vice versa. The step 14 coverage check compares against variables read under packages/service/src only; a variable read elsewhere in the workspace would not be caught. Step 12 proves the SSE debug line is emitted on a direct stream open, which is the same route a browser participant's runner opens on join, but it does not prove the browser path end to end. Finally, this measures the runbook as it stands today against the code as it stands today: it cannot tell you whether a reader unfamiliar with did:btcr2 would understand the conceptual sections.

---

<a id="test-15"></a>

## Test 15: PART-05: the participant's own esplora endpoint against real third-party hosts

> Hermetic: **no**. Audit verdict: NEEDS_FIX (7 problem(s) found and corrected).

## Test 15 - PART-05: the participant's own esplora endpoint against real third-party hosts

**Hermetic: NO.** This test needs outbound https to `mutinynet.com`, `mempool.space`, `blockstream.info` and `example.com`. Without internet the four verdicts cannot be produced.

### Preconditions

- Nothing else listening on port 8080: `ss -ltnp | grep :8080` should print nothing.
- Terminal 1, from the repo root. The extra TTL knobs buy headroom (see the timing note below); both are read from the environment at `packages/service/src/demo-server.ts:567-568`:

```
cd /home/jintek/projects/github/@jintekc/btcr2-aggregation
OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="PART-05 check" COHORT_TTL_MS=7200000 PHASE_TIMEOUT_MS=7200000 pnpm demo
```

- `pnpm demo` is `pnpm -r build && tsx packages/service/src/demo-server.ts` (package.json:43). The built SPA is served by the service on the same port, so no `pnpm dev` is needed.
- The service boot is the DEFAULT zero-chain one: no `LIVE`, no `BROADCAST`.
- The service network is the default mutinynet (`NETWORK` unset, `DEFAULT_NETWORK` at `packages/shared/src/networks.ts:178`). That choice is load-bearing for steps 13, 14 and 15: read those steps before changing it.
- A Chromium or Firefox window with DevTools available. The Network tab and the participant activity log are the two observables.
- **Timing.** Without the two TTL knobs above, the cohort's discovery window and phase timeout are 30 minutes each (`demo-server.ts:38,47`). This procedure creates a 2-of-2 cohort and joins it with ONE browser, so it never seats; when the window closes, an unseated participant is routed to the join-failure card rather than the cohort page (`packages/web/src/components/browse/BrowseView.tsx:94` sends only a SEATED terminal failure to the cohort page), and the Chain endpoint panel disappears. With the knobs set you have two hours; without them, finish steps 5 to 18 inside 30 minutes of advertising.
- **Casing.** Disclosure titles, section headings and field labels render in uppercase via CSS (`packages/web/src/ui/primitives.tsx:44-57`, `:31-35`, `:243-252`), so `Chain endpoint` shows as CHAIN ENDPOINT and `Esplora endpoint (optional)` as ESPLORA ENDPOINT (OPTIONAL). Button text and every message line quoted below render exactly as written.

### Steps

1. **Boot.** Run the command above and wait for the service to report itself.
   Look for: `[demo] service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))`, then `[demo] idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)`.

2. **Sign in.** Open `http://127.0.0.1:8080/operator`. Type `phase5` into the field labelled `Operator password` and click `Sign in`.
   Look for: the login card is replaced by the operator console (health strip, service controls, cohort list). No error banner.

3. **Create a draft.** Click `New cohort`. In the `Create a cohort` form set `Signing threshold (k)` to 2 and `Cohort size (n)` to 2, then click `Create draft`.
   Look for: a draft row in the cohort list carrying a `Draft` chip and an `Advertise cohort` button.

4. **Advertise.** Click `Advertise cohort` on that draft row.
   Look for: the console lands you in the freshly advertised cohort's drill-down. No error text.

5. **Join, part one.** Open `http://127.0.0.1:8080` in a SECOND browser window (the participant surface). Find the cohort row in the directory and click `Join`.
   Look for: the directory is replaced by the identity step headed `Choose an identity to join`, with the `KEY (k1)` / `EXTERNAL (x1)` control showing `KEY (k1)` selected.

6. **Join, part two.** Click `Generate a new identity`, then click `Join cohort`.
   Look for: the live cohort page, with a `Your cohort` card and stage timeline, a `Your identity` card showing the did and a `secret (save to re-import)` field, and further down a collapsed disclosure titled `Chain endpoint`.

7. **Arm the two observables.** In the participant window open DevTools, select the Network tab, leave it recording, and type `block-height` into its filter box. Then on the page open the `Technical detail` disclosure (its right-hand toggle reads `Show`) so the `Activity log` is visible.
   Look for: the activity log already carries timestamped join lines, for example `generated KEY (k1) identity did:btcr2:...`, `connecting to http://127.0.0.1:8080 to join cohort <id>`, and `opt-in sent for cohort <id>; waiting for the cohort to fill`. The Network filter matters: this page polls the service every few seconds on its own, so only a `block-height` entry is evidence that the endpoint guard made a request.

8. **Read the unset state.** Open the `Chain endpoint` disclosure. Read the whole panel before typing anything.
   Look for: exactly this state. One sentence, `This browser reads the chain through this service. That is the default and needs no setup.`; a field labelled `Esplora endpoint (optional)` with placeholder `https://esplora.example.com`; the help line `Set your own esplora endpoint to read the chain directly instead of through this service.`; and ONE button, `Use this endpoint`. There is NO switch-back button, NO broadcast checkbox and NO anchor caption: all three are gated on an endpoint actually being active.

9. **MALFORMED.** Type `http://mutinynet.com/api` (plain http, deliberately) into the endpoint field and click `Use this endpoint`.
   Look for: the message `Enter a full https URL, for example https://esplora.example.com.` in red. With the Network tab filtered on `block-height`, NO new entry appears (the scheme check runs before any fetch). The activity log gains a warn line reading `chain endpoint not used (malformed)`. The unset-state sentence from step 8 is still shown, unchanged.

10. **BROWSER-REJECTED.** Clear the field, type `https://example.com`, click `Use this endpoint`.
    Look for: briefly `Checking this endpoint…`, then `This endpoint does not allow browser requests, so it can't be used from here.` The filtered Network tab shows ONE entry, `https://example.com/block-height/0`, which failed rather than returning a readable body, and the DevTools JS console shows a CORS error for that URL. The activity log gains `chain endpoint not used (browser-rejected)`.

11. **UNREACHABLE.** Clear the field, type `https://blockstream.info/api/nope`, click `Use this endpoint`.
    Look for: `Couldn't reach that endpoint.` The Network tab shows `https://blockstream.info/api/nope/block-height/0` returning HTTP 404 with a readable body (that host does send `Access-Control-Allow-Origin: *` even on a 404, verified with curl, so the difference from step 10 is real rather than incidental). The activity log gains `chain endpoint not used (unreachable)`.

12. **ACCEPTED.** Clear the field, type `https://mutinynet.com/api`, click `Use this endpoint`.
    Look for: the panel's first line changes from the unset sentence to `Reading the chain from ` followed by the host `mutinynet.com` in monospace and a period. The filtered Network tab shows TWO entries, `https://mutinynet.com/api/block-height/0` and `.../block-height/1` (mutinynet is a signet, so block zero alone is not an identity and the height-1 marker is read as well). The activity log gains a good-tone line `reading the chain from https://mutinynet.com/api`. Three new controls appear: a second button `Use this service's chain reads`, an unchecked checkbox labelled `Also broadcast my transactions through this endpoint.` with the help line `Off by default. While it is off, your registration transaction is still relayed through this service.`, and the caption `This service still reports this cohort's anchor. Your endpoint only double-checks a transaction it named.`

13. **MISMATCH, naming both chains.** Leave the endpoint from step 12 active. Clear the field, type `https://mempool.space/signet/api`, click `Use this endpoint`.
    Look for: the message `That endpoint is on Signet, but this service is on Mutinynet (signet). It was not used.` Both chains are named. Critically, the active line ABOVE still reads `Reading the chain from ` + `mutinynet.com`: the refused endpoint was not activated and the working one was not dropped. The `Use this service's chain reads` button stays rendered in the button row directly above the failure message, as the offered next step. The activity log gains `chain endpoint not used (mismatch)`.

14. **CROSS-FAMILY OBSERVATION (record the answer, do not assume it).** Clear the field, type `https://blockstream.info/api` (Bitcoin mainnet, CORS-permissive), click `Use this endpoint`.
    Look for: on this mutinynet boot the message is `Couldn't reach that endpoint.`, NOT the mismatch sentence, and the Network tab shows only ONE new entry (`.../api/block-height/0`). This is by construction: the second marker probe is issued only once block zero already agrees, and a service on a signet-family chain refuses any endpoint whose required second marker was not observed. Record what you actually saw. The mismatch sentence is reachable on this boot only against another signet (step 13).

15. **DNS OBSERVATION (record the answer).** Clear the field, type `https://esplora.invalid` (a reserved TLD that cannot resolve), click `Use this endpoint`.
    Look for: the message `This endpoint does not allow browser requests, so it can't be used from here.`, NOT `Couldn't reach that endpoint.` A browser reports a DNS failure and a cross-origin refusal identically, so after a successful URL parse any thrown fetch is reported as browser-rejected. Record what you saw; this is the documented best-effort split, not a new defect.

16. **THE SECOND OPT-IN.** Tick the checkbox `Also broadcast my transactions through this endpoint.`
    Look for: the checkbox ticks. Note that it exists only because an endpoint is active: it was absent in step 8 and cannot be reached with no endpoint set.

17. **THE EXPLICIT SWITCH BACK.** Click `Use this service's chain reads`.
    Look for: the first line reverts to `This browser reads the chain through this service. That is the default and needs no setup.` The switch-back button, the broadcast checkbox and the anchor caption all disappear together. The activity log gains an info line `reading the chain through this service`. No failure message remains on screen.

18. **RE-ENTRY.** Clear the field, type `https://mutinynet.com/api` again, click `Use this endpoint`.
    Look for: it is accepted again, the filtered Network tab records NO new `block-height` entry (the verdict is cached per endpoint and per chain), and the broadcast checkbox reappears UNCHECKED. The second opt-in did not survive clearing the endpoint it sat inside.

19. **OPTIONAL, live boot only.** This cannot be done on the hermetic boot, and it cannot be done on a regtest/Polar live boot either: the guard accepts https ONLY, so a local `http://127.0.0.1:3000` esplora is refused as malformed. It needs a `LIVE=1` boot on a network whose esplora is reachable over https (mutinynet). On such a run, set `https://mutinynet.com/api` as the endpoint BEFORE clicking `Check funds and register` on the completion summary.
    Look for: the activity log line reads `checking <address> for funds at https://mutinynet.com/api` rather than `checking <address> for funds`, and the Network tab (clear the `block-height` filter first) shows `https://mutinynet.com/api/address/<address>/utxo`. This is the only way to observe that chain READS actually route to the participant's endpoint; the hermetic boot never issues one.

20. **OPTIONAL, same live run.** With the endpoint active, make it fail mid-operation (disconnect this machine's network, or block the host) and click the registration action again.
    Look for: the activity log gains a bad-tone line beginning `funding check failed:` and the page does NOT quietly retry through the service: there is no request to `/v1/tx/utxos/...` in the Network tab for that attempt.

### Pass

- Four DISTINCT sentences were observed, each from its own scenario: the mismatch sentence naming both chains (step 13), the browser-rejected sentence (step 10), the unreachable sentence (step 11), and the malformed sentence (step 9). No two scenarios produced the same sentence within that set.
- The malformed case produced no `block-height` request at all (step 9).
- A refused endpoint was never activated: after step 13 the active line still named the endpoint from step 12.
- A failing entry never reverted the active endpoint on its own; only the explicit `Use this service's chain reads` button did (step 17).
- The broadcast opt-in could not exist without an active endpoint (absent in step 8) and did not survive clearing it (step 18).
- Whenever an endpoint was active, the switch-back button was on screen in the button row directly above the failure message (step 13).

### Fail signals

- Any two of the four scenarios in steps 9 to 13 render the SAME sentence.
- Step 9 produces a `block-height` request in the Network tab.
- Step 13's message names only one chain, or names the wrong pair (anything other than Signet and Mutinynet (signet)).
- After step 13 the active line changes to `mempool.space`, or reverts to the unset sentence: either would mean a refused endpoint was activated, or a working one was silently dropped.
- The broadcast checkbox is visible or tickable while no endpoint is active, or is still ticked after step 18.
- A click on `Use this endpoint` changes neither the active line nor produces any message (a silent no-op).
- The panel shows a generic failure sentence instead of one of the four named ones.

### Limits

These steps prove the guard, the classifier and the rendered copy; they do NOT prove that the participant's chain READS (UTXO fetch, broadcast, anchor double-check) actually go to the chosen endpoint, because on the hermetic boot the only THIRD-PARTY requests the page makes are the marker probes (every other Network entry is this page's own same-origin polling of the service). Steps 19 and 20 are the only ones that would show a real read, and they need a LIVE boot on an https-reachable network. Two scenario-to-message mappings in the checkpoint wording do not hold and were verified not to hold: an unreachable HOST (DNS failure) produces the browser-rejected sentence, not the unreachable one, because a browser cannot distinguish the two (documented in `packages/web/src/lib/esplora.ts:14-27`); and on the default mutinynet network a wrong-chain endpoint outside the signet family produces the unreachable sentence, not the mismatch one, because the required second marker is never observed. Steps 14 and 15 exist to record those two answers rather than hide them. The verdict cache means each base can be judged only once per page load and there is no re-check control in the UI (`clearEndpointCache` is exported but called only from tests), so use a distinct URL per scenario; a reload clears the cache but also loses the cohort session ("Refreshing loses your seat", `CohortPage.tsx:241`). Nothing here exercises a real-funds guard rail: the mainnet acknowledgment, the re-entrancy guard and the funding minimum are only reachable on the live registration path.

---

<a id="test-16"></a>

## Test 16: PART-06: real-wallet PSBT round trip for the registration transaction, including the sighash refusal

> Hermetic: **no**. Audit verdict: NEEDS_FIX (6 problem(s) found and corrected).

## Test 16: PART-06, real-wallet PSBT round trip for the registration transaction, including the sighash refusal

**Hermetic: NO.** Needs a real chain, a real esplora, funded addresses, and (for the interop leg) a real wallet.

### Preconditions

- **This cannot run on the default boot.** The `Register first update` card renders only for a KEY identity that was included, on a service whose anchor read reports enabled, and `enabled` is true only when a broadcaster exists (`packages/service/src/anchor-state.ts`, `const enabled = Boolean(broadcaster)`), which under the product boot requires `BROADCAST=1`, which itself requires `LIVE=1` (`packages/service/src/demo-server.ts:337-345`).
- A Bitcoin chain you control with an esplora REST endpoint. Two workable choices:
  - (a) Polar regtest with esplora, the harness default: `ESPLORA_HOST=http://127.0.0.1:3000`, `NETWORK` unset (the harness defaults to regtest).
  - (b) Public mutinynet (free signet coins, better wallet support): `NETWORK=mutinynet ESPLORA_HOST=https://mutinynet.com/api`.
- Terminal 1, from the repo root, choice (a):

  ```bash
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation
  ESPLORA_HOST=http://127.0.0.1:3000 OPERATOR_PASSWORD=phase5 pnpm uat:live
  ```

  or choice (b):

  ```bash
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation
  NETWORK=mutinynet ESPLORA_HOST=https://mutinynet.com/api OPERATOR_PASSWORD=phase5 pnpm uat:live
  ```

- `pnpm uat:live` is `pnpm -r build && tsx e2e/live-uat.ts` (package.json:37). It throws without `OPERATOR_PASSWORD` (no default), refuses any bind other than loopback, boots on `PORT` (default 8080) with `live: true` and `broadcast: true`, and sets `operatorCookieSecure: false` so plain-http login works on 127.0.0.1.
- A way to fund two addresses on that chain and confirm the payments (Polar's Send plus Mine, or a mutinynet faucet).
- **A note on reading the UI:** every heading and field label quoted below is rendered through an `uppercase` CSS class (`packages/web/src/ui/primitives.tsx:33`, `:51`, `:432`, and `WalletSignPanel.tsx:222`, `:266`). On screen they appear in full caps. Match the wording, not the case.
- **A note on the wallet:** the registration transaction spends a UTXO locked to the participant's own DID key, and the exported PSBT carries only `witnessUtxo` and `tapInternalKey` with no BIP32 derivation (`packages/shared/src/index.ts`, `buildRegistrationTemplate`). Your wallet must hold that exact single key (the 64-hex `secret` from step 5) and be able to sign a Taproot key-path spend whose second output is a zero-value `OP_RETURN`. A wallet that cannot import a raw private key, or that refuses the data output, cannot complete this leg; per the checkpoint that is a support note, not a phase failure.
- Terminal 2 available for the inline signer commands in steps 16, 17, 19 and 20. They run from `packages/web` so `@scure/btc-signer` and `@btcr2-aggregation/shared` resolve. All of them were executed end to end while preparing this procedure.

### Steps

1. **Boot.** Start your chain (Polar network with esplora up, or confirm mutinynet reachability), then run the boot command from the preconditions.
   Look for: `[demo] service listening on http://127.0.0.1:8080 (...)` followed by the `live-UAT harness up` banner. If esplora is unreachable the harness exits with `[live-uat] fatal: esplora unreachable at <host> (...)` before starting.

2. **Two windows.** Open `http://127.0.0.1:8080/operator`, type `phase5` into `Operator password`, click `Sign in`. Open `http://127.0.0.1:8080` in a second window.
   Look for: the operator console loads (the SPA catch-all serves index.html for `/operator`); the participant window shows the public directory.

3. **Create and advertise.** In the console click `New cohort`, set `Signing threshold (k)` to 2 and `Cohort size (n)` to 2, click `Create draft`, then click `Advertise cohort` on the new draft row.
   Look for: you land in that cohort's drill-down automatically (the store opens the freshly minted live id), and the cohort appears as joinable in the participant window.

4. **Join.** In the participant window click `Join` on that row, leave the identity kind on KEY (k1), click `Generate a new identity`, then `Join cohort`.
   Look for: the live cohort page. The `Your identity` card shows a `did` field, a `secret (save to re-import)` field, and a `KEY (k1)` badge. Below it: `Waiting for the cohort to fill (1/2 seats).`

5. **Capture the key.** Click the copy button beside `secret (save to re-import)` and paste it into Terminal 2's scratch buffer. This is the private key the registration input is locked to and the only key that can sign the exported PSBT.
   Look for: a 64-character lowercase hex string. If you intend to sign in a real wallet, import it now as a single-key Taproot (P2TR key-path) wallet on the same chain the service booted on.

6. **Fill the last seat.** Back in the operator drill-down click `Fill remaining seats with test peers`. The confirm is headed `Add 1 test peers to this cohort?`; on this live service it carries the extra line `This is a live cohort, so test peers co-sign for real and their DIDs are anchored on <network>.` Click `Add 1 test peers`.
   Look for: the member list shows your real participant plus one row carrying the `Test peer` badge and the line `Test peer added by the operator.`

7. **Submit your update. Do not skip this.** Switch to the participant window and wait for the warn-toned panel headed `Your update is needed`. Click `Submit my DID update`.
   Look for: the panel appears only once the seats are full, because the runner asks this participant for its update and then BLOCKS on the click (the web store is the only caller that passes a submit gate; the test peer auto-submits). Until you click, the cohort cannot co-sign and nothing later in this procedure can happen. On this live service the panel's warning names the real broadcast on the running network.

8. **Fund the cohort beacon.** Watch Terminal 1 for the banner containing `  FUND THIS ADDRESS (cohort beacon), then mine 1 block in Polar:` followed by the address and a suggested minimum. Send ONE payment of at least that amount and confirm it (mine a block on regtest; wait a block on mutinynet).
   Look for: co-signing proceeds once the funding confirms. The harness prints `BROADCAST cohort=... txid=...` when the beacon transaction goes out.

9. **Anchor it.** Confirm the beacon transaction (mine one block).
   Look for: the harness logs `ANCHORED cohort=... confirmed=true`; the participant completion card heading flips from `Signed` to `Anchored` and the narration reads `Signed and anchored on <network label>.`

10. **Fund the registration address.** Scroll the participant page to the `Register first update` card. Click the copy button beside `fund this genesis beacon (<network label>)` (the displayed value is truncated on screen, so use the copy button), strip the leading `bitcoin:` from what you pasted, and send ONE payment of at least 1330 sats to that address. Confirm it.
   Look for: the card's help line names the same minimum: `Fund it with one payment of at least 1330 sats (a 1000-sat fee plus a dust-safe change output). A smaller UTXO cannot build the registration transaction.` The card is present only because this is a KEY identity that was included on a broadcasting service.

11. **Choose the wallet path.** In the `Where to sign` control inside that card, click `Sign with my own wallet`.
    Look for: the line `Only this registration step can be signed in your own wallet. The cohort's co-signing round still signs in this browser.` under the chooser (it shows on both paths). A step headed `1. Download the unsigned transaction` appears immediately; its body shows `Building the unsigned transaction...` while the export runs, then the buttons `Download PSBT` and `Copy PSBT (base64)` plus a disclosure `Unsigned PSBT (base64)`. The card's single primary button now reads `Broadcast signed transaction` and is DISABLED. If instead the body shows a warn-toned box reading `No spendable funds at that address yet. Send at least 1330 sats in one payment, then try again.` with a `Try again` button, the step 10 funding has not landed yet.

12. **Export.** Click `Copy PSBT (base64)` and paste the value into Terminal 2's scratch buffer. Then click `Download PSBT`.
    Look for: the copy button momentarily reads `Copied` (if the clipboard write fails it reads `Select and copy below` instead, which is not a defect: open the `Unsigned PSBT (base64)` disclosure and copy from there). A binary file downloads named `registration-<up to 24 characters of the DID tail>.psbt`.

13. **THE INTEROP OBSERVATION.** Open the downloaded `.psbt` in your wallet and try to sign it. Record verbatim what the wallet does: whether it opens the file at all, whether it recognises the input as spendable, whether it displays or objects to the zero-value `OP_RETURN` output, and any error text.
    Look for: record the outcome either way. A wallet that opens and signs is a pass for this leg; a wallet that refuses is a support note, and you continue with the fallback signer in step 19. Nothing in the shipped copy names any wallet as compatible.

14. **REFUSAL 1, unsigned.** In the step headed `2. Bring back the signed PSBT`, open the `Paste instead` disclosure and paste the UNSIGNED base64 from step 12 into the field labelled `Signed PSBT (base64)`.
    Look for: `That PSBT isn't signed yet.` in a red-bordered box; the primary button stays disabled; the warn-toned line under the field reads `Anything you paste here stays in this browser tab for this session only. It is never saved and never sent anywhere except to broadcast the transaction you signed.` Open `Technical detail` and confirm the Activity log tail reads `signed PSBT rejected (unsigned)`.

15. **REFUSAL 2, unparseable.** Select all in that field and replace it with the word `hello`.
    Look for: `That doesn't look like a PSBT. Expected base64 text or a .psbt file.` and an Activity log line `signed PSBT rejected (unparseable)`.

16. **REFUSAL 3, mismatched.** In Terminal 2, substituting your two values:

    ```bash
    cd /home/jintek/projects/github/@jintekc/btcr2-aggregation/packages/web && node --input-type=module -e '
    import { Transaction } from "@scure/btc-signer";
    const tx = Transaction.fromPSBT(Uint8Array.from(Buffer.from(process.argv[1], "base64")), { allowUnknownOutputs: true });
    tx.updateOutput(0, { amount: tx.getOutput(0).amount - 1n });
    tx.sign(Uint8Array.from(Buffer.from(process.argv[2], "hex")));
    console.log(Buffer.from(tx.toPSBT(0)).toString("base64"));
    ' "<PSBT_BASE64>" "<SECRET_HEX>"
    ```

    Paste the printed base64 into the field.
    Look for: the command prints one line of base64 (it moves 1 sat off the change output and signs the result). The page shows `That PSBT doesn't match the transaction this page created. Download it again and sign that one.`, the Activity log reads `signed PSBT rejected (mismatched)`, and the primary button stays disabled.

17. **REFUSAL 4, the sighash refusal. This is the point of the test.** If your wallet lets you pick a sighash type, use it to sign the exported PSBT with SIGHASH_NONE (Bitcoin Core: `walletprocesspsbt "<psbt>" true "NONE"`; whether Core accepts that for a taproot input was NOT verified here). Otherwise run in Terminal 2:

    ```bash
    cd /home/jintek/projects/github/@jintekc/btcr2-aggregation/packages/web && node --input-type=module -e '
    import { Transaction } from "@scure/btc-signer";
    const flag = Number.parseInt(process.argv[3], 16);
    const tx = Transaction.fromPSBT(Uint8Array.from(Buffer.from(process.argv[1], "base64")), { allowUnknownOutputs: true });
    tx.updateInput(0, { sighashType: flag });
    tx.sign(Uint8Array.from(Buffer.from(process.argv[2], "hex")), [flag]);
    console.log(Buffer.from(tx.toPSBT(0)).toString("base64"));
    ' "<PSBT_BASE64>" "<SECRET_HEX>" 02
    ```

    Paste the printed base64 into the field.
    Look for: the message is EXACTLY `Your wallet signed that transaction in a way that does not lock in where the money goes. Sign it again using your wallet default signature type.` It must NOT be the unparseable sentence from step 15 and must NOT be the mismatched sentence from step 16: this PSBT parses cleanly and matches the template byte for byte, so either of those would send you back to re-export, which would fix nothing. Confirm the Activity log reads `signed PSBT rejected (bad-sighash)`, not `(unparseable)`. The primary button stays disabled. Repeat with `81` or `03` in place of `02` for a second and third flavour; all three were executed here and all three produce the same sentence.

18. **OVERFLOW.** With that long base64 still in the `Signed PSBT (base64)` field, look at the card's geometry, then scroll inside the field, then open the `Unsigned PSBT (base64)` disclosure in step one and scroll inside that too.
    Look for: the text scrolls INSIDE the field and inside the disclosure (the field is capped by `min-h-32 ... overflow-auto`, the disclosure by `max-h-80 overflow-auto`). The card does not grow wider than the surrounding cards, the verdict box and the primary button BELOW the field stay where they were, and no horizontal page scrollbar appears. Do not drag the field's resize handle; it is `resize-y` by design and dragging it changes the geometry yourself.

19. **THE ACCEPTED SIGNATURE.** Return the correctly signed PSBT: click `Upload signed PSBT` and pick the file your wallet produced, or paste its base64. If your wallet could not sign (step 13), use the fallback signer, which is step 17's command with the two sighash lines removed:

    ```bash
    cd /home/jintek/projects/github/@jintekc/btcr2-aggregation/packages/web && node --input-type=module -e '
    import { Transaction } from "@scure/btc-signer";
    const tx = Transaction.fromPSBT(Uint8Array.from(Buffer.from(process.argv[1], "base64")), { allowUnknownOutputs: true });
    tx.sign(Uint8Array.from(Buffer.from(process.argv[2], "hex")));
    console.log(Buffer.from(tx.toPSBT(0)).toString("base64"));
    ' "<PSBT_BASE64>" "<SECRET_HEX>"
    ```

    Look for: a green-bordered message of the form `This signed transaction checks out: it pays <N> sats to your registration address with a 1000 sat fee.`, where N is your funded amount minus 1000. The primary button `Broadcast signed transaction` becomes ENABLED. Note in your report whether you used the wallet or the fallback: the fallback proves the app's return leg only, not wallet interoperability.

20. **Pin the txid BEFORE broadcasting.** Open `Technical detail` and read the newest Activity log line: `signed PSBT checks out (<txid>)`. Write that txid down. For an independent number (recommended, since the log line and the broadcast both come from this app), compute it yourself in Terminal 2:

    ```bash
    cd /home/jintek/projects/github/@jintekc/btcr2-aggregation/packages/web && node --input-type=module -e '
    import { Transaction } from "@scure/btc-signer";
    const tx = Transaction.fromPSBT(Uint8Array.from(Buffer.from(process.argv[1], "base64")), { allowUnknownOutputs: true });
    tx.finalize();
    console.log(tx.id);
    ' "<SIGNED_PSBT_BASE64>"
    ```

    If your wallet showed a txid on its signed-transaction screen, record that too.
    Look for: a 64-hex transaction id, identical from every source you used.

21. **Broadcast.** Click `Broadcast signed transaction`.
    Look for: the badge beside `Register first update` moves through `broadcasting...` to `registered`. A `registration txid` field appears, plus a link reading `view tx on <network label>`. That txid MUST equal the one from step 20. It is the id esplora returned for the accepted transaction, so equality proves the chain accepted exactly the transaction that was validated.

22. **The branch proof.** Read the tail of the `Activity log` under `Technical detail`.
    Look for: in order, `signed PSBT checks out (<txid>)`, then `checking <address> for funds`, then `funded (<N> sats); broadcasting the externally-signed tx`, then `broadcast first-update registration <txid>`. The third line is the proof the wallet branch ran: the in-browser path logs `funded (<N> sats); building + signing registration tx` instead.

23. **Resolve.** Confirm the registration transaction on-chain (mine a block on regtest), then click `Resolve again` on the `Resolve round-trip` card.
    Look for: the green outcome stating the update is reflected and that the resolved DID document now lists this cohort's beacon service. This is the point of the registration leg: a KEY DID's first update only resolves after its own genesis signal confirms (ADR 0007). If it is not reflected yet, the warn box tells you to try again; give the indexer a moment.

24. **EPHEMERALITY.** Reload the participant page.
    Look for: everything from the round trip is gone (no exported PSBT, no returned text, no verdict) and the page returns to the directory, because the whole session lives in memory. Confirm in DevTools that no PSBT material appears in Application > Local Storage, Session Storage or IndexedDB. (There is no `localStorage` or `sessionStorage` write anywhere in `packages/web/src`, so any hit here is a real regression. The warning that a refresh costs you your seat is shown on the cohort page while the cohort is live, steps 4 through 8, not at completion.)

### Pass

- The unsigned PSBT exported automatically on choosing the wallet path and downloaded as a binary `.psbt` file named after the DID.
- All four refusals rendered their OWN sentence and their OWN log reason: unsigned (14), unparseable (15), mismatched (16), bad-sighash (17). The bad-sighash case was NOT reported as unparseable, on screen or in the log.
- The primary button stayed disabled for every refusal and became enabled only for the accepted signature.
- The broadcast txid in step 21 equals the txid pinned in step 20.
- The activity log shows `broadcasting the externally-signed tx`, not `building + signing registration tx` (22).
- The long base64 scrolled inside its field and inside the disclosure without widening the card or moving the verdict box and primary button (18).
- Nothing from the round trip survived a reload, and nothing appeared in browser storage (24).
- The wallet outcome from step 13 is recorded verbatim, whatever it was.

### Fail signals

- Step 17 shows `That doesn't look like a PSBT. Expected base64 text or a .psbt file.` or the mismatched sentence instead of the sighash sentence, or the log reads `signed PSBT rejected (unparseable)`. That is the exact regression gap plan 05-15 closed.
- Step 17 shows the green success message, or the primary button becomes enabled: a signature that does not commit to the outputs reached a broadcastable state.
- Any two of steps 14, 15, 16 and 17 share a sentence.
- The primary button is enabled before any PSBT has come back, or while a refusal message is on screen.
- Step 21's txid differs from step 20's.
- Step 22 shows `building + signing registration tx`: the broadcast took the in-browser branch even though the wallet path was selected.
- Step 18: the card widens, the page grows a horizontal scrollbar, or the verdict box and primary button are pushed off-screen by the pasted text.
- Step 24: any PSBT material survives the reload or appears in browser storage.
- The `Register first update` card never appears despite a confirmed anchor, a submitted update and an included KEY identity.
- The submit panel in step 7 never appears after the seats fill: the explicit submit gate has regressed.

### Limits

Not hermetic: this needs a real chain, a real esplora, two funded and confirmed addresses, a human click on the explicit submit gate, and a completed live cohort. Wallet interoperability is proven by nothing in the repository and was not verified here; no shipped copy names a compatible wallet. The framing "sign in your own wallet so your key stays out of the browser" is only partly achievable today: the browser already holds the same DID key for the MuSig2 co-signing round, and the exported PSBT identifies its input by `tapInternalKey` with no derivation path, so the wallet must hold that exact raw key. If the wallet leg fails for that reason rather than for a PSBT-format reason, say so. "Broadcast produces the same txid the local path would" cannot be shown directly because the same UTXO cannot be spent twice, so steps 20 and 21 compare a signer-side txid with the txid esplora returned; strict equality between the wallet path and the fully local path is pinned programmatically in `packages/shared/tests/psbt.spec.ts` ("reproduces the SAME transaction id as the fully local path"). If you use the fallback signer in step 19, the accepted-signature leg proves the app's return path only. A signature made by a DIFFERENT key is out of scope: `@scure/btc-signer` refuses to sign this input with a non-matching key (verified here, error `No inputs signed`), so producing that case would need hand-spliced bytes. The Bitcoin Core route to a non-default sighash in step 17 was NOT verified in this environment; the inline command is the verified route, and it was run for flags 0x02, 0x81 and 0x03.

---

<a id="test-17"></a>

## Test 17: LIVE plus BROADCAST boot, the one-way kill switch, and the funding stand-down

> Hermetic: **no**. Audit verdict: NEEDS_FIX (11 problem(s) found and corrected).

> **Test 17: LIVE plus BROADCAST boot, the one-way kill switch, and the funding stand-down**
> Not hermetic. Needs a live boot against a reachable esplora. No funds are sent.

## Preconditions

- Repo root: `cd /home/jintek/projects/github/@jintekc/btcr2-aggregation`
- Nothing else listening on port 8080. Check with:
  ```
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/v1/status
  ```
  Expect `000` (connection refused).
- A reachable esplora for the chosen network. Option A (needs no local chain): `NETWORK=mutinynet`, which resolves to `https://mutinynet.com/api` (`packages/shared/src/networks.ts:118`). Option B (your own chain): `NETWORK=regtest ESPLORA_HOST=http://127.0.0.1:3000` pointing at a Blockstream-fork electrs, per `e2e/lib/regtest.ts`.
- `node` and `curl` on PATH. `node` is used only to pretty-read JSON in the cross-check commands.
- **NO FUNDS ARE SENT IN THIS PROCEDURE.** Nothing broadcasts, because no beacon address is ever funded. Do not send sats to any address this test shows you.
- **Timing budget.** On a default boot the funding window is 12 minutes (`DEFAULT_FUNDING_WINDOW_MS = 720_000`, `packages/service/src/demo-server.ts:64`). Cohort A's funding wait throws when it lapses, which would break step 18. The boot command below widens it to 25 minutes. The boot refuses to start unless `PHASE_TIMEOUT_MS` is strictly greater than `FUNDING_WINDOW_MS` (`demo-server.ts:363`), so keep those two values in that relation if you change them.
- Boot command for steps 1 to 20. Run it in terminal 1 from the repo root and leave it running:
  ```
  OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 LIVE=1 BROADCAST=1 NETWORK=mutinynet SERVICE_NAME="Phase 5 live check" FUNDING_WINDOW_MS=1500000 PHASE_TIMEOUT_MS=1800000 COHORT_TTL_MS=3600000 pnpm demo
  ```
- `OPERATOR_COOKIE_SECURE=0` is required because you are on plain http. Without it the session cookie carries `Secure` and the browser will not send it back (`demo-server.ts:445`, `index.ts:696`).
- Use `http://127.0.0.1:8080` in the browser, not `localhost`. The service binds loopback by default and the boot banner prints the exact base URL.

## Steps

**1. Boot the service.** In terminal 1, run the boot command above.

Look for: after the workspace build, the banner (each line prefixed `[demo] `, `demo-server.ts:262`) includes, in this order:

- `!!! LIVE + BROADCAST: MUTINYNET (SIGNET) !!!`
- `  - each cohort's aggregate beacon tx is BROADCAST on-chain to Mutinynet (signet)`
- `  - the operator MUST fund each cohort beacon address before its funding window elapses`
- `  - funding window: 1500000ms; an unfunded cohort dead-ends with a funding reason (no retry fixes it)`
- `  !!! RECOVERY_KEY UNSET: cohort recovery keys are THROWAWAY (secret discarded) !!!`

then:

- `service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (live esplora))`
- `idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)`

If instead you see a line beginning `Refusing to start: BROADCAST=1 requires LIVE=1`, you dropped `LIVE=1` (`demo-server.ts:339-346`).

**2. Sign in.** Open `http://127.0.0.1:8080/operator` and sign in with the password `phase5`.

Look for: the page renders, top to bottom, a health strip row of chips, then a card headed `Service controls`, then the `Operator console` heading (`OperatorConsole.tsx:121-131`).

**3. Read the health strip.** Read the chip row left to right.

Look for, in this order (`HealthStrip.tsx:92-141`): a neutral chip reading `Live` (not `Hermetic`, not `Live (no broadcast)`, not `Checking mode`); the plain text `Phase 5 live check`; a network chip reading `Mutinynet (signet)`; a badge reading `Esplora reachable`; a chip reading `IPFS off`; and a freshness indicator on the right. There is NO chip reading `Broadcast off (this session)` yet.

Honest note: the `Esplora reachable` badge is not evidence of anything at this moment. `esploraReachable` is initialised to `true` (`monitor.ts:871`) and its only writer in the whole service is the funding watch (`index.ts:1200`), which has not run yet.

**4. Read the Service controls card.** Read the controls row.

Look for: a red (danger) button labelled exactly `Disable broadcast` on the same row as `Pause advertising` and `Service settings` (`ServiceControls.tsx:27`, `:38`, `:234-240`; label constant at `stores/operator.ts:226`).

**5. Cross-check the served health.** In terminal 2, from the repo root, run:

```
JAR=/tmp/op.jar; BASE=http://127.0.0.1:8080
curl -s -c $JAR -H 'content-type: application/json' -d '{"password":"phase5"}' $BASE/v1/operator/login; echo
curl -s -b $JAR $BASE/v1/operator/cohorts | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")).monitoring.health)'
```

Look for: first line `{"ok":true}`. Second line exactly `{"mode":"live","esploraReachable":true,"paused":false,"broadcastDisabled":false}` (key order is fixed by `monitor.ts:1468-1479`). `esploraReachable` is `true` here because that is its initial value, not because anything probed the endpoint.

**6. Create and advertise cohort A.** In the browser click `New cohort`. The form opens on `Signing threshold (k)` = 2 and `Cohort size (n)` = 2 already (`CreateCohortForm.tsx:17-18`; service default `runtime-settings.ts:282`), so change nothing. Click `Create draft`, then click `Advertise cohort` on the new draft row.

Look for: the console navigates straight into the newly advertised cohort's drill-down (`stores/operator.ts:958-966`); you do NOT stay on the list. Copy the full id from the copy field labelled `cohort id` under the `Cohort ...` heading (`CohortDetail.tsx:352`). Call it **A**. Terminal 1 logs `[operator] advertised cohort <A> (from draft ...)` (`operator-cohorts.ts:1289`). The id in that log line is the live id, not the draft id.

**7. Fill cohort A's seats.** You are already in A's drill-down. In the `Members` card, click `Fill remaining seats with test peers`, then click the confirm button in the panel that opens (its label names the seat count).

Look for: because the served mode is `live`, the confirm carries an extra line naming your network (`CohortDetail.tsx:409`, `stores/operator.ts:326-327`). After confirming, the member list fills and the `Members` card reads `Seats: 2/2.` (`CohortDetail.tsx:381`).

**8. Read cohort A's Funding card.** Within a few seconds of keygen completing, scroll A's drill-down to the card headed `Funding`. Read it. **Send nothing.**

Look for (`FundingStage.tsx:82-116`): a copy field whose value begins `bitcoin:`; the line `Send at least 2000 sats to this address in a single payment.` (the number is always 2000 here, `index.ts:1114` calls `computeSuggestedMinSats()` with no fee argument, `funding-watch.ts:55-57`, `tx.ts:217`); a warn-toned waiting state line; and a warn-toned throwaway-recovery-key paragraph. This is the pre-switch funding surface and it must exist.

**9. Cross-check the anonymous funding read.** In terminal 2 (substituting A):

```
curl -s $BASE/v1/funding/<A>; echo
```

Look for: exactly `{"awaitingFunding":true}` (`hono-adapter.ts:733-741`).

**10. Open the kill-switch confirm.** In the browser, on the `Service controls` card, click `Disable broadcast`.

Look for: the `Disable broadcast` button disappears while its own confirm is open (`ServiceControls.tsx:234-240` renders it only when no confirm is showing). This is NOT yet the engaged state. A danger-toned confirm panel appears headed `Disable broadcast for new cohorts?` with three stacked lines (`stores/operator.ts:227-234`):

- `New cohorts will be created on the fixture path and will not publish anything to Bitcoin.`
- `Cohorts already in flight finish under the mode they started with, and chain reads (resolve and anchor tracking) stay on.`
- `You cannot turn broadcast back on from here. Restart this service with its broadcast environment set to re-enable it.`

Its confirm button reads `Disable broadcast` and its cancel reads `Keep broadcast on` (`stores/operator.ts:226`, `:235`).

**11. Engage the switch.** Click the confirm button labelled `Disable broadcast` inside that panel.

Look for: the confirm panel closes and the `Disable broadcast` button does NOT come back. In its place the card renders the line `Broadcast is off for new cohorts. Restart this service with BROADCAST=1 to turn it back on.` (`stores/operator.ts:242-243`, rendered at `ServiceControls.tsx:248`). The control is replaced, not greyed out.

**12. Read the strip and the log.** Read the health strip again, then read the `Operator actions` log at the bottom of the Service controls card.

Look for: the mode chip still reads `Live`. A new warn-tone chip reading `Broadcast off (this session)` now appears on the same strip row, after the `Esplora reachable` badge (`HealthStrip.tsx:24`, rendered at `:137`); the mode chip is unchanged. The `Operator actions` log has one wall-clock-stamped entry reading exactly `Disabled broadcast for new cohorts.` (`monitor.ts:95`).

**13. Prove there is no way back.** In terminal 2:

```
curl -s -b $JAR $BASE/v1/operator/cohorts | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")).monitoring.health)'
for p in enable resume on; do printf '%s ' $p; curl -s -o /dev/null -w '%{http_code}\n' -b $JAR -X POST $BASE/v1/operator/broadcast/$p; done
curl -s -b $JAR -X POST $BASE/v1/operator/broadcast/disable; echo
```

Look for: health reads `{"mode":"live","esploraReachable":true,"paused":false,"broadcastDisabled":true}`. The boot mode is byte-unchanged and `broadcastDisabled` is a separate bit (`monitor.ts:1468-1479`). The three probe paths print `enable 404`, `resume 404`, `on 404`: they carry a valid session, so the 404 proves no such route exists, not that auth blocked them (`hono-adapter.ts:880` mounts only `/disable`; the SPA catch-all is `app.get('*')` at `static-site.ts:57`, so a POST never reaches it). The repeat disable answers `{"broadcastDisabled":true}` and the browser's operator actions log still shows only ONE `Disabled broadcast for new cohorts.` entry (the route records on the transition only, `hono-adapter.ts:883-888`).

**14. Create and advertise cohort B, after the switch.** In the browser click the ghost link `Back to cohorts` at the top of A's drill-down (`CohortDetail.tsx:341-343`). Then click `New cohort`, leave both numbers at 2, click `Create draft`, then `Advertise cohort`. You land in the new cohort's drill-down again. Copy its full id from the `cohort id` field and call it **B**. In its `Members` card click `Fill remaining seats with test peers` and confirm.

Look for: B fills to `Seats: 2/2.` exactly like A did.

**15. Scroll B's drill-down.** Immediately, while B is still co-signing, scroll B's entire drill-down top to bottom.

Look for: there is NO card headed `Funding` anywhere on the page. The card headed `Co-sign` is followed directly by the card headed `Anchor` (`CohortDetail.tsx:430`, `:457-459`, `:463`). No `bitcoin:` address, no sats amount and no recovery-key paragraph appears for this cohort. This is the point of the test: the service never asks for sats on a beacon it will not spend.

**16. Cross-check both reads for B.** In terminal 2 (substituting B):

```
curl -s $BASE/v1/funding/<B>; echo
curl -s -b $JAR $BASE/v1/operator/cohorts/<B> | node -pe 'String(JSON.parse(require("fs").readFileSync(0,"utf8")).funding)'
```

Look for: first line `{"awaitingFunding":false}`. Second line `undefined`: the gated detail read carries no `funding` key at all (`monitor.ts:1429`, `:1448` spreads the key only when a view exists).

**17. Read terminal 1's log for cohort B.** 

Look for three lines, all naming B, each prefixed `[service] cohort <B>: `:

- `broadcast is disabled for this session and this cohort was advertised after the switch engaged; not watching its beacon address for funding (nothing will be spent from it, so nothing should be sent to it)` (`index.ts:1151-1156`)
- `broadcast is disabled for this session and this cohort was advertised after the switch engaged; building the fixture beacon tx and publishing nothing` (`index.ts:866-869`)
- `broadcast is disabled for this session; not publishing its beacon transaction (restart with the broadcast environment set to re-enable)` (`index.ts:1001-1004`)

**18. Confirm the pre-switch cohort kept its surface.** Click `Back to cohorts`, find cohort A in the list, and open it with its `Open` button. Then re-run:

```
curl -s $BASE/v1/funding/<A>; echo
```

Look for: A's drill-down still shows its `Funding` card with the same beacon address, and the anonymous read still answers `{"awaitingFunding":true}`. In the list, A sits under the heading `Needs attention` with a warn chip reading `Needs funding` (`OperatorCohortList.tsx:36`, `lib/operator-rows.ts:113` and `:206`). A cohort advertised before the switch keeps the surface it was advertised under (`index.ts:613-628`).

**19. Confirm the post-switch cohort's terminal chip.** Click `Back to cohorts` and find cohort B's row.

Look for: B sits under the heading `Ended` with a neutral chip reading `Signed` (`lib/operator-rows.ts:120`, grouping at `:214`). It must NOT read `Anchored`: nothing was published, so no anchor may be claimed.

**20. OPTIONAL, only if you control the esplora endpoint (regtest, Option B).** Open cohort A, use `Cancel cohort` on its Lifecycle card, type the short cohort id the confirm panel shows into the input labelled `Type ... to confirm.` (the first 8 characters of the id, `LifecycleActions.tsx:230` and `:238`, `lib/lifecycle.ts:188-190`, `ui/primitives.tsx:329-331`), and confirm. That leaves no pre-switch watch running. Then stop your esplora process, wait about 90 seconds, and re-read the health strip.

Look for: the badge still reads `Esplora reachable` and never flips to `Esplora unreachable`. That is the disclosed cost of the fix, not a bug: the funding watch is the only writer of that bit (`index.ts:1200` is its single call site in the service), so once only post-switch cohorts remain nothing refreshes it. Do not treat that badge as evidence of anything after this point. See `docs/adr/0017-runtime-lifecycle-control.md:132-161`.

**21. Reboot without the broadcast opt-in.** Stop the service in terminal 1 with Ctrl-C, then run:

```
OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 LIVE=1 NETWORK=mutinynet pnpm demo
```

Reload `http://127.0.0.1:8080/operator` and sign in again (sessions are in memory and a restart clears them).

Look for: the mode chip reads **`Hermetic`**, and there is **no esplora badge on the strip at all**. This is what `LIVE=1` alone produces: `demo-server.ts:500-501` passes `live: useBroadcast, broadcast: useBroadcast`, so a boot without `BROADCAST=1` gives `createService({live:false, broadcast:false})` and `index.ts:1041` resolves the mode to `hermetic`. The middle mode `Live (no broadcast)` exists in the type but is not reachable from the environment (`monitor.ts:313`). `LIVE=1` still drives the live esplora used for resolve and the `/v1/tx` proxy, which is why the boot banner says `resolve=mutinynet (live esplora)`, but that is not the cohort broadcast mode the chip reports.

Also look for: the Service controls card has NO `Disable broadcast` button and there is no `Broadcast off (this session)` chip. The switch does not survive a restart, and the console offers the control only on the served live broadcasting mode (`ServiceControls.tsx:128-136`).

Optional cross-check in terminal 2 (re-login first, the old jar is dead):

```
rm -f $JAR
curl -s -c $JAR -H 'content-type: application/json' -d '{"password":"phase5"}' $BASE/v1/operator/login; echo
curl -s -b $JAR $BASE/v1/operator/cohorts | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")).monitoring.health)'
```

Expect `{"mode":"hermetic","esploraReachable":"n/a","paused":false,"broadcastDisabled":false}`.

## Pass

- Step 4: the `Disable broadcast` control is present on the `LIVE=1 BROADCAST=1` boot, and step 21 shows it absent on the `LIVE=1` (no BROADCAST) boot.
- Steps 11 and 12: after engaging, the control is replaced (not merely disabled) by the line naming `BROADCAST=1`, the mode chip still reads `Live`, and a separate warn chip `Broadcast off (this session)` appears on the same strip row.
- Step 13: `/v1/operator/broadcast/{enable,resume,on}` all answer 404 with a valid session, a repeat disable is a 200 no-op, and only one `Disabled broadcast for new cohorts.` entry exists.
- Steps 15 and 16: the post-switch cohort has no Funding card in the console, no `funding` key on the gated detail read, and `{"awaitingFunding":false}` on the anonymous read.
- Steps 17 and 19: the service logs all three stand-down lines for the post-switch cohort, and that cohort ends chipped `Signed`, never `Anchored`.
- Step 18: the pre-switch cohort keeps its Funding card, its beacon address, and `{"awaitingFunding":true}`.
- Step 21: the second boot reports mode `hermetic` and offers no kill-switch control.

## Fail signals

- A Funding card, a `bitcoin:` URI, or a `Send at least ... sats` line appears anywhere on the post-switch cohort's drill-down.
- `/v1/funding/<B>` answers `{"awaitingFunding":true}` after the switch engaged.
- The mode chip changes from `Live` to anything else after engaging, or the served health mode is no longer `live`: the switch must never rewrite how the service booted.
- Any of `/v1/operator/broadcast/enable`, `/resume`, `/on` answers anything other than 404 with a valid session, or any console control re-enables broadcast.
- The `Disable broadcast` button is still rendered (even greyed out) after step 11 completes.
- The pre-switch cohort LOSES its Funding card or flips to `{"awaitingFunding":false}` when the switch engages: in-flight work must finish under the mode it started with.
- The post-switch cohort ends with an `Anchored` chip, or terminal 1 shows a broadcast attempt for it.
- The service log shows only some of the three stand-down lines for the post-switch cohort. A missing tx-data line in particular means the tx was built live and merely not published.
- Step 21 shows a `Disable broadcast` button, or a `Broadcast off (this session)` chip carried across the restart.

## Limits

This procedure never funds a beacon address, so it does NOT prove that a pre-switch cohort actually broadcasts and confirms a real beacon transaction. It proves only that the pre-switch funding SURFACE survives the switch; proving the money leg end to end needs a funded beacon address and a confirmed transaction, which is the owner's separate live walkthrough (`pnpm uat:live`, `e2e/live-uat.ts`). Four further caveats. First, `POST /v1/operator/broadcast/disable` is mounted on EVERY operator-enabled boot, not only the live one (`hono-adapter.ts:880`, inside the shared gated block): on a hermetic service it answers 200 `{"broadcastDisabled":true}` and the strip then shows the broadcast-off chip beside a `Hermetic` mode chip. "Offered only in that boot mode" is a property of the console CONTROL (`ServiceControls.tsx:128-136`), not of route mounting, so step 21 is the check that matters and a curl probe cannot substitute for it. Second, `Live (no broadcast)` cannot be produced from the environment at all, so this procedure cannot exercise that mode; only a programmatic `createService({live:true, broadcast:false})` reaches it. Third, the test-peer confirmation still tells you the peers co-sign for real even on a post-switch cohort, because that line keys on the service mode alone (`CohortDetail.tsx:409`); that is a known, recorded gap (`05-16-SUMMARY.md:238-244`), not a failure of this checkpoint. Fourth, the esplora badge freeze in step 20 is only observable on an endpoint you can take down; on a public endpoint you must take the disclosure on the code evidence (one call site, `index.ts:1200`) rather than on an observation.

---

<a id="test-18"></a>

## Test 18: Cancel settle-race backstop: 404 with nothing changed, never two ended records

> Hermetic: **yes**. Audit verdict: NEEDS_FIX (8 problem(s) found and corrected).

## Test 18: Cancel settle-race backstop (404 with nothing changed, never two ended records)

Hermetic. No chain, no wallet, no broadcast. Budget about 8 to 12 minutes including the first build.

### Preconditions

- Repo root: `cd /home/jintek/projects/github/@jintekc/btcr2-aggregation`
- Dependencies installed (`pnpm install`). `pnpm demo` runs `pnpm -r build` first, so the first boot takes a few minutes; that build is also what produces `packages/web/dist`, which step 8 needs.
- `bash` (the driver uses process substitution), `curl`, `node`, and `awk` on PATH.
- Nothing else listening on port 8080.
- Run the sweep on a FRESH boot. This service retains 24 ended monitoring records (`packages/service/src/monitor.ts:74`), 24 terminal operator records (`packages/service/src/operator-cohorts.ts:748`) and a 100-entry operator-actions ring (`packages/service/src/monitor.ts:92`). A 24-round sweep exactly fills the first cap, so cohorts ended earlier in the same boot push the sweep's own ids out and later checks get confusing for a benign reason.
- `OPERATOR_COOKIE_SECURE=0` is load-bearing, not decoration: without it the session cookie carries `Secure` and curl will not send it back over plain http, so every gated call would 401.

### Steps

1. **Boot the service.** In terminal 1, from the repo root:

   ```bash
   OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 pnpm demo
   ```

   Look for, after the build, these two lines verbatim (verified against a live boot):

   ```
   [demo] service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))
   [demo] idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)
   ```

   `(offline)` confirms the zero-chain path and `web served` confirms the SPA build step 8 needs. Leave this running.

2. **Save the race driver.** In terminal 2, paste exactly:

   ```bash
   cat > /tmp/cancel-race.sh <<'EOF'
   #!/usr/bin/env bash
   # Cancel settle-race backstop driver. Hermetic: no chain, no wallet, no broadcast.
   set -u
   BASE="${BASE:-http://127.0.0.1:8080}"
   PASSWORD="${OPERATOR_PASSWORD:-phase5}"
   ROUNDS="${ROUNDS:-24}"
   STEP="${STEP:-0.02}"
   JAR="$(mktemp)"
   IDS="${IDS:-/tmp/cancel-race-ids.txt}"
   : > "$IDS"

   jsonf() { node -pe 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));'"$1"; }

   curl -s -c "$JAR" -H 'content-type: application/json' \
     -d "{\"password\":\"$PASSWORD\"}" "$BASE/v1/operator/login" > /dev/null
   probe=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/v1/operator/session")
   if [ "$probe" != "200" ]; then
     echo "ABORT: operator login failed (session probe returned $probe). Check OPERATOR_PASSWORD and OPERATOR_COOKIE_SECURE=0."
     exit 1
   fi

   fails=0
   printf 'round  delay  ok404  ok200  listRows  monRows  chip        cohortId\n'
   for r in $(seq 1 "$ROUNDS"); do
     draft=$(curl -s -b "$JAR" -H 'content-type: application/json' \
       -d '{"beaconType":"CASBeacon","size":2}' "$BASE/v1/operator/cohorts" | jsonf 'd.draftId')
     cohort=$(curl -s -b "$JAR" -X POST "$BASE/v1/operator/cohorts/$draft/advertise" | jsonf 'd.draftId')
     case "$cohort" in
       ''|undefined|null)
         echo "ABORT round $r: advertise did not return a cohort id (draft='$draft')."
         exit 1 ;;
     esac
     echo "$cohort" >> "$IDS"
     delay=$(awk -v r="$r" -v s="$STEP" 'BEGIN{printf "%.3f", (r-1)*s}')
     curl -s -b "$JAR" -X POST "$BASE/v1/operator/cohorts/$cohort/test-peers" > /dev/null &
     sleep "$delay"
     n200=0; n404=0; nother=0
     for _ in $(seq 1 40); do
       code=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST \
         "$BASE/v1/operator/cohorts/$cohort/cancel")
       case "$code" in
         200) n200=$((n200+1)) ;;
         404) n404=$((n404+1)) ;;
         *)   nother=$((nother+1)); echo "  unexpected status $code" ;;
       esac
       sleep 0.005
     done
     wait
     sleep 1
     listRows=x; monRows=x; chip=-
     read -r listRows monRows chip < <(curl -s -b "$JAR" "$BASE/v1/operator/cohorts" | \
       jsonf 'const id="'"$cohort"'";const l=(d.cohorts||[]).filter(c=>c.draftId===id);const m=((d.monitoring||{}).rows||[]).filter(x=>x.cohortId===id);`${l.length} ${m.length} ${m.map(x=>x.chip).join(",")||"-"}`')
     bad=''
     [ "$n200" -gt 1 ] && bad="$bad TWO-OK"
     [ "$listRows" = 'x' ] || [ "$listRows" -gt 1 ] && bad="$bad LIST-DUP"
     [ "$monRows" = 'x' ] || [ "$monRows" -ne 1 ] && bad="$bad NOT-ONE-RECORD"
     [ "$nother" -gt 0 ] && bad="$bad BAD-STATUS"
     printf '%5s  %5s  %5s  %5s  %8s  %7s  %-11s %s%s\n' \
       "$r" "$delay" "$n404" "$n200" "$listRows" "$monRows" "$chip" "$cohort" "$bad"
     [ -n "$bad" ] && fails=$((fails+1))
   done
   echo
   echo "cohort ids for this run: $IDS"
   if [ "$fails" -eq 0 ]; then
     echo "PASS: $ROUNDS rounds, exactly one ended record per cohort id and never two accepted cancels."
   else
     echo "FAIL: $fails round(s) violated the invariant."
   fi
   EOF
   ```

   Look for: `/tmp/cancel-race.sh` written. Each round advertises a fresh 2-seat CASBeacon cohort (threshold defaults to n, `operator-cohorts.ts:704`), fills both seats with in-process test peers, waits a per-round delay that sweeps 0.000 s to 0.460 s in 0.02 s steps, then fires 40 cancels 5 ms apart. Only the FIRST cancel of a round can race the settle; the other 39 are the idempotence check, because `cancelCohort` leaves the cohort in the advertised map until `settleCompletion` runs on the next microtask turn (`packages/service/src/operator-cohorts.ts:1309-1349`, `:1017-1058`). On a warm hermetic boot the cohort settles roughly 0.1 to 0.25 s after the test-peers POST; the exact figure is machine-dependent, which is what step 4 exists to check.

3. **Run it.**

   ```bash
   BASE=http://127.0.0.1:8080 OPERATOR_PASSWORD=phase5 ROUNDS=24 bash /tmp/cancel-race.sh
   ```

   Look for: one row per round, each carrying its cohort id. Every row must show `ok200` of 0 or 1, `listRows` of 0 or 1, and `monRows` of exactly 1. The two legal row shapes are:
   - the cancel won: `ok404=39 ok200=1 listRows=1 monRows=1 chip=canceled`
   - the settle won: `ok404=40 ok200=0 listRows=0 monRows=1 chip=co-signed`

   (`listRows=0` on a win by the settle is correct: `settleCompletion` prunes a successful cohort from the operator list and only the monitoring ended record remains. `co-signed`, not `anchored`, is the honest hermetic fate because nothing is broadcast.) The last line must read `PASS: 24 rounds, exactly one ended record per cohort id and never two accepted cancels.`

4. **Read the `ok200` column down the whole table and confirm it is not constant.**

   Look for: at least one round with `ok200=1` (`chip=canceled`, the cancel beat the settle) AND at least one with `ok200=0` (`chip=co-signed`, the settle beat the cancel). The crossover point is machine-dependent (on the machine this was verified on it landed at round 6 in one run and round 8 in another). If every round is the same kind, the sweep never crossed the boundary and the PASS line proves less than it looks: re-run with a finer or later step, for example `STEP=0.01 ROUNDS=48` or `STEP=0.04 ROUNDS=24`, on a fresh boot.

5. **Re-cancel an id whose settle won.** Take a cohort id from a row whose chip read `co-signed` (the last column, or `/tmp/cancel-race-ids.txt`). In terminal 2:

   ```bash
   JAR=/tmp/op18.jar; BASE=http://127.0.0.1:8080
   curl -s -c $JAR -H 'content-type: application/json' -d '{"password":"phase5"}' $BASE/v1/operator/login > /dev/null
   curl -s -b $JAR -o /tmp/body.json -w '%{http_code}\n' -X POST $BASE/v1/operator/cohorts/<that-id>/cancel; cat /tmp/body.json; echo
   ```

   Look for: `404` followed by exactly `{"error":"unknown cohort"}`. Then run the same command with `never-existed-id` in place of the real id and confirm the status and body are byte-identical, so a losing cancel learns nothing and changes nothing (`packages/service/src/hono-adapter.ts:1199-1206`).

6. **Confirm a losing cancel left no trace in the operator log.**

   ```bash
   curl -s -b $JAR $BASE/v1/operator/cohorts | node -pe 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const a=(d.monitoring.operatorActions||[]).map(x=>x.text);JSON.stringify({total:a.length,canceled:a.filter(t=>t.startsWith("Canceled cohort")).length})'
   ```

   Look for: `canceled` equal to the number of rows in step 3's table whose `ok200` column read 1, counted from that table (not from any remembered figure). Each entry reads `Canceled cohort <8-char id>.` (`packages/service/src/monitor.ts:119`). A round in which every cancel answered 404 must contribute nothing. This count is only meaningful while the boot's total actions stay under the 100-entry ring (a 24-round sweep writes up to 48: one test-peers entry and one cancel entry per round), so do not compare across repeated sweeps in one boot.

7. **Cross-check the anonymous fate read**, one id whose cancel won and one whose settle won:

   ```bash
   curl -s $BASE/v1/cohort-fate/<canceled-id>; echo
   curl -s $BASE/v1/cohort-fate/<co-signed-id>; echo
   ```

   Look for: `{"canceled":true}` for the first and `{"canceled":false}` for the second. Never a 404, never both true for one id, and no session required (`packages/service/src/hono-adapter.ts:757-762`).

8. **Presentation check in the browser.** Open `http://127.0.0.1:8080/operator`, sign in with `phase5`, and scroll to the `Ended` group heading (`packages/web/src/components/operator/OperatorCohortList.tsx:39`). Spot-check three cohort ids from the LAST rounds of the table (each row shows its full id in a copy field labelled `cohort id`, same file line 244).

   Look for: each id on exactly ONE row, chipped either `Canceled` (neutral tone, `packages/web/src/lib/operator-rows.ts:132`) with a line naming when the operator ended it, or `Signed` (neutral tone, same file line 120). No id twice, no id carrying both fates. Ids from the earliest rounds may be absent: the ended retention is capped at 24 records and evicts oldest-first, which is retention, not a defect. Treat this whole step as presentation only: `groupRenderRows` keys the union of its two row sources by id (`packages/web/src/lib/operator-rows.ts:227-250`), so the browser cannot detect a server-side duplicate. The `monRows` column from step 3 is the server-side count.

9. **Stop the service** in terminal 1 with Ctrl-C.

   Look for: a clean exit. All state from this test was in memory and is now gone, which is the stated single-box model.

### Pass

- Step 3: every row shows `ok200` of 0 or 1, `listRows` of 0 or 1, `monRows` of exactly 1, and the run ends with the PASS line.
- Step 4: both outcomes appear, so the settle boundary was genuinely crossed.
- Step 5: a cancel that loses the race answers 404 with `{"error":"unknown cohort"}`, byte-identical to an id that never existed.
- Step 6: the operator-actions log holds one `Canceled cohort ...` entry per winning round and none for a losing round.
- Step 7: the anonymous fate read agrees with the recorded fate for both kinds of id.
- Step 8: no cohort id is listed twice in the Ended group, and each carries exactly one fate.

### Fail signals

- Any round prints `TWO-OK`, `LIST-DUP`, `NOT-ONE-RECORD` or `BAD-STATUS`, or the run ends with the FAIL line.
- The script aborts with `ABORT: operator login failed ...` or `ABORT round N: advertise did not return a cohort id` (nothing was exercised; fix the boot or the env before reading any result).
- Any cancel returns a status other than 200 or 404. A 500 means a library throw reached the response.
- A round prints `monRows=0`: the cohort settled and left NO ended record at all, which is as much a defect as leaving two.
- A round prints `ok200` greater than 1: two cancels were both accepted for one cohort id.
- A cohort id shows two chips at once, or a `Canceled cohort` log entry exists for a round in which every cancel answered 404.
- `/v1/cohort-fate/:id` answers `{"canceled":true}` for an id that ended by completing its signing round.

### Limits

This is a BACKSTOP, not a deterministic test, and `05-01-PLAN.md:34-35` classifies it that way for a reason: the interleaving cannot be forced from outside the process. The driver sweeps the first cancel's delay across the window in which the round settles and repeats 24 times, so it exercises both sides of the boundary, but it cannot guarantee that any single request landed in the microtask gap between the completion promise resolving and `settleCompletion` deleting the cohort. What it does prove is the invariant that gap protects: at most one accepted cancel per cohort id, exactly one ended record per cohort id, one opaque 404 for every loser, and no log entry for a cancel that changed nothing. The structural guarantee itself (the ended record is a Map keyed by cohort id, `packages/service/src/monitor.ts:1067-1079`, with `noteCanceled` returning early on an already-canceled id at `:1515-1536`) is code evidence, not something this procedure observes. The run is entirely hermetic, so it says nothing about a cancel racing a real beacon-transaction broadcast on a LIVE plus BROADCAST boot, where the console hides the cancel action once the transaction has gone out; that leg belongs to the live walkthrough.

---

<a id="critique"></a>

# Cross-cutting critique

# Completeness critique: 18 phase-5 UAT procedures

## 1. Boot consistency

Broadly consistent (all use `pnpm demo`, password `phase5`, `OPERATOR_COOKIE_SECURE=0`, port 8080). Four real conflicts:

**A. Test 3 is wrong about timers, and it matters.** Test 3's Limits say "on this boot no phase timeout is armed (`PHASE_TIMEOUT_MS` is unset and the library returns without arming a timer) ... no cohort TTL or discovery window is armed either." That is false. `packages/service/src/demo-server.ts:268-269` defaults BOTH to `1_800_000` unconditionally (`DEFAULT_PHASE_TIMEOUT_MS`, `DEFAULT_COHORT_TTL_MS`, lines 39/47) and passes them into `createService` (`:492-493`). **Test 5 and Test 15 are right**, Test 3 is wrong. Consequence: Test 3's cohort sitting in `CollectingUpdates` through steps 13-17 has a hard 30-minute budget, and an operator who takes a coffee break mid-inventory will see the cohort die and misread it. Fix: Test 3 must either add `COHORT_TTL_MS`/`PHASE_TIMEOUT_MS` like Test 5, or state the 30-minute budget.

**B. `localhost` vs `127.0.0.1` is contradictory.** Test 1 step 7 and Test 13 say use `localhost`; Tests 5, 7, 9, 10, 15 say do NOT use `localhost` (IPv6 `::1`). Test 5/7/9/10/15 are right on an IPv6-first box; `127.0.0.1` always works. Standardise on `http://127.0.0.1:8080`.

**C. `OPERATOR_COOKIE_SECURE=0` necessity is stated three different ways.** Tests 1/2/5/7/9 call it required; Test 13 correctly calls it a safety belt (Chromium treats `http://localhost` and `http://127.0.0.1` as trustworthy origins, so a `Secure` cookie is stored). Test 13 is technically right. Operationally irrelevant since all boots set it, but say it once, accurately.

**D. `TERMS_TEXT` leaks between tests.** Test 8 preconditions do `source /tmp/terms-env.sh`, which EXPORTS `TERMS_TEXT` into that shell. Tests 9 and 10 explicitly require it unset. Test 8 step 15 unsets it only in that one terminal. Any later boot from that shell silently adds a terms step to the join flow and breaks Tests 9, 10, 13, 14.

### Proposed shared preamble (referenced by tests 1-14)

```
## Shared boot preamble (P)

Repo root, every command:
  cd /home/jintek/projects/github/@jintekc/btcr2-aggregation

Before every boot, in the terminal you are about to boot from:
  pkill -f "packages/service/src/demo-server.ts" 2>/dev/null; unset TERMS_TEXT
  curl -s -o /dev/null -m 2 http://127.0.0.1:8080/v1/config && echo "STILL LISTENING" || echo "8080 free"
Expect "8080 free". If you ran Test 14 PATH A, also: docker compose down

Boot (terminal A, leave running). `pnpm demo` = `pnpm -r build && tsx packages/service/src/demo-server.ts`,
so the first boot also builds the SPA (a few minutes) and serves it on the same port:
  OPERATOR_PASSWORD=phase5 OPERATOR_COOKIE_SECURE=0 SERVICE_NAME="Phase 5 check" pnpm demo
Individual tests may ADD env vars to this line; they never remove OPERATOR_PASSWORD.

Wait for both lines (each prefixed "[demo] "):
  service listening on http://127.0.0.1:8080 (minParticipants=2, web served, resolve=mutinynet (offline))
  idle until the operator advertises a cohort from the console (POST /v1/operator/cohorts/:id/advertise)
"web served" is required; "!!! OPERATOR CONSOLE DISABLED !!!" means the password did not reach the process.

Browser: use http://127.0.0.1:8080 (never localhost; the service binds IPv4 loopback).
Operator console: http://127.0.0.1:8080/operator , exact path, no trailing slash.
Sign in: type phase5 in the field labelled `Operator password`, click `Sign in`.
Wait for the health strip mode chip to settle off `Checking mode` before judging anything.

Timers: with no overrides, an advertised cohort dies 30 minutes after advertising
(PHASE_TIMEOUT_MS and COHORT_TTL_MS both default to 1_800_000). Finish any single
walkthrough inside that budget or set both knobs higher.

curl session (terminal B), when a step needs a gated read:
  rm -f /tmp/op.jar && curl -s -c /tmp/op.jar -X POST http://127.0.0.1:8080/v1/operator/login \
    -H 'content-type: application/json' -d '{"password":"phase5"}'
Expect {"ok":true}.

Casing: SectionTitle, field labels, expander toggles and source captions are CSS-uppercased.
Match wording, never letter case. Chip labels, buttons and body copy render as written.

Teardown: Ctrl-C the service. All state is in memory; a restart is a full reset.
```

Each test then reads: "Boot per preamble P, adding `DEFAULT_SIZE=3`."

---

## 2. Ordering

**1..18 is runnable start to finish, but only because every test boots its own service.** No test may reuse a running service from the previous test: the env differs materially (`DEFAULT_SIZE`, `DEFAULT_THRESHOLD`, `TERMS_TEXT`, `COHORT_TTL_MS`, `LIVE`). State itself is never the problem (everything is in memory), so a fresh boot is a full reset.

Specific corrections:

- **Add an explicit "stop the service" final step to Tests 5, 6, 7, 10, 12, 13, 15, 17.** They do not have one. The next test's port check catches it, but only after the operator has typed a boot command that fails.
- **Test 14 PATH A must `docker compose down` before Test 15.** It is the only test that leaves a *container* on 8080; the preamble's `pkill` will not clear it.
- **Test 18 must run on a fresh boot** (it says so): its 24-round sweep exactly fills the 24-entry ended-record cap (`operator-cohorts.ts:748`, `monitor.ts:74`). Never run it after Test 12 on the same process.
- **Test 8 must run in a dedicated terminal** (see 1D), or its `TERMS_TEXT` export contaminates Tests 9, 10, 13, 14.
- **Move Test 18 before the live block.** It is hermetic and sits after three live tests, forcing the operator to boot live, then hermetic, then live again. Recommended order: 1-14, 18, 15, 16, 17.
- Adjacency wins: **3 → 9 → 12** share the fill-with-test-peers setup; **4 → 10 → 11** are the cancel chain (ceremony → participant narration → dismissal); **2 → 7** share the settings/defaults surface. **5 and 15** both need raised TTL knobs and both drive the participant chain-endpoint panel; running 15 immediately after 5 reuses the same mental model and the same third-party host verdicts.
- **Test 11 subsumes Test 2's stated gap** (Test 2 says the discovery-window timer actually ending a cohort is unexercised; Test 11 steps 12-14 exercise exactly that with a 1-minute window). Cross-reference rather than leaving Test 2's limit standing.

---

## 3. Gaps: checkpoint clauses the procedure does not verify

| Test | Unverified clause |
|---|---|
| 3 | "Automatic close ... the moment the nth seat fills." Only observed after a 4 s poll, and the false timer claim means a mid-test teardown will be misread as a caption failure. |
| 4 | Rung 4 is verified only in the **mempool** funding state. `cancelRung` returns 4 for awaiting-confirmation, funded, AND dead-end (`lib/lifecycle.ts:75-81`); the dead-end variant is never opened. The `Finalize now` commit is marked "Optional", so "finalize anchors on the k-of-n fallback path" can pass unobserved. |
| 5 | "Chain endpoint disclosure across every E16 state": an *active* endpoint is never observed serving an actual chain read (its own Limits admit this); only marker probes are seen. |
| 7 | `Default funding window (minutes)` never rendered by any test in the suite, including the live Test 17, which never opens Service settings. Its source caption and clear-to-null behaviour are unobserved everywhere. |
| 8 | The 200-record acceptance-ledger cap and re-accept-replaces behaviour is asserted as *copy* (Test 7 step 8) and never observed. |
| 10 | "never narrates it as a stall" is proven only negatively. **No test in the suite ever produces the stall/timeout terminal copy**, so a regression that made every terminal read "The operator canceled this cohort." would pass Test 10 clean. |
| 12 | The **promotion half** ("a confirmed anchor promotes to `Anchored` and increments the counter") is deferred, and Test 17 deliberately never funds, so no procedure ever observes it. |
| 13 | Judgments A and C are answerable only via the optional step 19; the `Needs attention` group and the `Failed` chip are never rendered anywhere. |
| 14 | The `AUTO_FALLBACK` row's behavioural claim (off = a stalled round no longer self-recovers) is unproven; only the read polarity is checked. |
| 16 | The checkpoint is a **real-wallet** PSBT round trip; every refusal and the accepted signature can be produced by the inline `node` signer, so the whole test can pass with no wallet involved. Wallet interop is record-only. |
| 17 | The pre-switch cohort's actual broadcast is never observed (stated); only the funding surface's survival. |

---

## 4. Danger review of tests 15, 16, 17

**No instruction can move mainnet bitcoin.** Every live boot names `regtest` or `mutinynet`; `ALLOW_MAINNET` is set nowhere, and `assertNetworkAllowed` (`packages/shared/src/networks.ts:228-239`) throws on `bitcoin` without it. Test 17 is exemplary: "NO FUNDS ARE SENT", plus "Send nothing" at the funding card.

Four things to flag:

1. **Test 16 step 5 tells the operator to export a live private key from the browser and import it into a real wallet, with no key-hygiene warning.** The `secret` is the DID key the cohort also co-signs with. Nothing tells the operator to use a throwaway wallet, or warns that importing a raw key into a wallet that also holds real funds is a hazard. Add: "Import into a scratch wallet you can discard. Never into a wallet that holds funds you care about."

2. **Test 16 passes that private key as an argv on the shell command line** in steps 16, 17, 19 and 20 (`"<SECRET_HEX>"`). argv is world-readable via `/proc` on Linux and lands in shell history. Recommend `read -s SECRET` and `process.env.SECRET` instead.

3. **Test 15 step 19-20 (optional live leg) broadcasts a registration transaction and never says so.** It says "click `Check funds and register`", which spends the funded UTXO. On mutinynet these are valueless signet coins, but the step should state plainly that it spends and broadcasts.

4. **Test 16 step 16 signs a PSBT with 1 sat moved off the change output** and prints it. It is never broadcast in-procedure, but the procedure should say "do not broadcast this one" beside the command, since an operator experimenting could push it and burn the sat to fees.

Test 17 needs no change. Its `bitcoin:` URI display is one wallet tap from a payment, and it warns twice.

---

## 5. Still missing overall

**Modalities never exercised**

- **A confirmed on-chain anchor.** No procedure funds a cohort beacon, confirms it, and observes the `Anchored` chip, the `anchored` counter incrementing, and the timeline relabel together. Test 4 step 28 gets closest but its pass criteria are about cancel visibility. This is the single most product-critical claim in the phase and it lives only in the owner's separate `pnpm uat:live`.
- **Resolve.** The last leg of the North Star (advertise → join → submit → co-sign → anchor → **resolve**) appears in exactly one place: Test 16 step 23, on the non-hermetic optional path.
- **Failure presentation.** No test produces a `Failed` chip, a non-zero `failed` counter, a populated `Needs attention` group (except Test 17's `Needs funding`), or the participant's stall/timeout terminal copy. The whole error half of the console is unobserved.
- **Docker.** Test 14 PATH A builds and boots the image, then abandons it for `pnpm demo` at step 10. The image serves exactly one `curl /v1/config` and is never driven through a cohort.
- **IPFS.** `IPFS=1`, `IPFS_DIR`, `IPFS_ANNOUNCE`, `POST /v1/ipfs/pin` and the `IPFS off` chip's opposite state are untouched by all 18 tests.
- **Non-loopback deployment.** `HOST=0.0.0.0`, TLS termination, the reverse-proxy config in `docs/DEPLOY.md`, and the `Secure` cookie path are excluded by construction (every test sets `OPERATOR_COOKIE_SECURE=0`).
- **`Live (no broadcast)` mode.** Test 17 step 21 establishes it is unreachable from the environment, so one of three `HealthStrip` mode labels can never be seen by any operator.
- **Keyboard and assistive access.** Every observation is mouse-plus-eye. No tab order, no focus visibility, no screen-reader label check anywhere, despite `ConfirmPanel` being a destructive-action surface.
- **Session TTL expiry.** Test 4 forces a 401 by deleting the cookie; `OPERATOR_SESSION_TTL_MS` actually lapsing is never exercised.
- **Concurrency.** No test opens two operator consoles, or has two real strangers seated beyond n=2 with test peers filling the rest.

**Claims asserted but never observed**

- "A restart returns this service to its boot environment" is rendered copy checked in Test 6, proven for *settings* in Test 7 step 22 and for *broadcast-disabled* in Test 17 step 21, but **never proven for pause**: no test pauses, restarts, and confirms `paused:false`.
- The acceptance-ledger retention sentence (Test 7 step 8) and the 24-record ended-record cap (Tests 11, 12, 18 all name it in Limits) are stated in operator-facing copy and never demonstrated.
- "Test peers use throwaway keys created inside this process" (Test 9 step 7) is read as a help line; nothing verifies the key custody claim.
