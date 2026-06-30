# ADR 0005: Bind `globalThis.fetch` in the browser participant

- Status: Accepted
- Date: 2026-06-30
- Milestone: M2 (stay-online co-signing web UI)

## Context

M1 drives the participant chain over real HTTP in Node and is green. The first
time the SAME `createParticipant` ran in a browser (the M2 two-attendee E2E), the
UI sat silently in "connecting": no cohort was ever discovered, and no visible
error appeared.

## Decision

`createParticipant` passes `fetchImpl: globalThis.fetch.bind(globalThis)` to
`HttpClientTransport`.

The transport stores `config.fetchImpl ?? globalThis.fetch` and calls it as a BARE
function. The browser's `window.fetch` throws
`TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation` when its
`this` is not the `Window`; Node's `fetch` does not care, which is exactly why M1
passed and only the browser path broke. The transport's broadcast/inbox loops
swallow the thrown error into `console.debug` and retry forever, so the failure is
SILENT: `cohort-discovered` never fires. Binding `fetch` to `globalThis` fixes it
and is a no-op in Node, keeping `createParticipant` isomorphic.

## Consequences

- The browser participant now subscribes, discovers, joins, and co-signs.
- Diagnosing this required capturing ALL browser console levels in the E2E (the
  transport logs via `CONSOLE_LOGGER.debug`/`warn`, not `pageerror` or
  `console.error`), not just uncaught errors. The E2E keeps an opt-in
  `E2E_VERBOSE` mode for that reason.
- Related browser-bundle facts recorded together so they are not rediscovered:
  - `@did-btcr2/method`'s root barrel pulls in `@web5/dids -> level/classic-level`
    (native) + did-dht. Mitigated by `resolve.conditions: ['browser', ...]` (method
    ships `dist/browser.mjs` exporting `resolveBtcr2SenderPk`),
    `optimizeDeps.exclude: ['level','classic-level','@dnsquery/dns-packet','bencode']`,
    and `define: {'process.env': '{}'}`. No Buffer polyfill is needed.
  - The participant base URL must be `window.location.origin`, not `'/'` (which
    makes `new URL()` throw in the browser).
