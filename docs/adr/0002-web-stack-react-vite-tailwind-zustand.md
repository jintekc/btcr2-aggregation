# ADR 0002: Web UI stack (React 19 + Vite 8 + Tailwind v4 + Zustand 5)

- Status: Accepted
- Date: 2026-06-30
- Milestone: M2 (stay-online co-signing web UI)

## Context

M2 adds an in-browser participant client and a coordinator dashboard over the
already-shipped `@did-btcr2/aggregation` HTTP transport. The participant chain is
sans-I/O and browser-clean (`@noble`/`@scure` over WebCrypto, fetch + SSE), so the
UI is wiring, not protocol code. We needed to pick a frontend stack that bundles
the participant chain cleanly, stays small, and maps the runner's event stream
onto a live UI with minimal ceremony.

## Decision

`packages/web` is a Vite 8 (Rolldown) single-page app:

- **React 19** with `@vitejs/plugin-react`. One `App.tsx` shell toggles between a
  Participant view and a Coordinator view (local state, not URL routes).
- **Tailwind v4** via `@tailwindcss/vite` and zero-config `@import "tailwindcss"`;
  a small `@theme` block defines the palette (dark slate + bitcoin-orange accent).
- **Zustand 5** for state: two stores (`stores/participant.ts`,
  `stores/dashboard.ts`) fed by runner / EventSource events. Non-serializable
  live objects (the `Participant`, the `EventSource`) are held in module-level
  variables, NOT in reactive state, so React only diffs the serializable
  projection.
- TypeScript is type-checked in CI: `packages/web` runs `tsc --noEmit` as part of
  its `build` script (Rolldown strips types without checking, and the standalone
  web tsconfig is not in the root `tsc -b` project graph).

## Consequences

- `vite build` is clean (~1 MB / ~316 KB gzip, no `node:` builtins, no
  `level`/`classic-level`/`did-dht` in the bundle). The chunk-size warning is
  accepted for a demo (code-splitting deferred).
- Browser-compat is handled in `vite.config.ts` (see ADR 0005 for the one runtime
  fix and the `@did-btcr2/method` barrel mitigation): `resolve.conditions` puts
  `browser` first, `optimizeDeps.exclude` keeps the native `level` binding out of
  the dev prebundle, and `define: {'process.env': '{}'}` (no Buffer polyfill
  needed).
- The two-store split keeps the participant (signing) concern fully independent of
  the dashboard (telemetry) concern (ADR 0004).
