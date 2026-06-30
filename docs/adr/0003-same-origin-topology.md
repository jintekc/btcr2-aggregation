# ADR 0003: Same-origin topology (Vite proxy in dev, Hono static-serve in prod)

- Status: Accepted
- Date: 2026-06-30
- Milestone: M2 (stay-online co-signing web UI)

## Context

The browser participant's `HttpClientTransport` posts to `/v1/*` and subscribes to
`/v1/adverts`, `/v1/actors/:did/inbox`, and (dashboard) `/dashboard/events`. Its
base URL is `window.location.origin`. We needed the browser to reach the
coordinator with no CORS and no credentials gymnastics, in both local development
and a deployed single-URL demo (the North Star: "attendees visit a public URL").

## Decision

Everything is same-origin; only HOW the static app is served differs by
environment.

- **Dev / preview:** Vite serves the app and proxies `/v1` and `/dashboard` to the
  coordinator. The proxy target is `COORDINATOR_ORIGIN` (default
  `http://127.0.0.1:8080`), read in `vite.config.ts` and applied to both
  `server.proxy` (dev) and `preview.proxy` (production build). Making it an env
  var lets the browser E2E run the coordinator on an ephemeral port and inject it.
- **Prod:** the coordinator's Hono app serves the built SPA itself, so one origin
  hosts the app, the protocol, and the dashboard with no proxy and no CORS.
  `createService({ webDistDir })` mounts `mountStaticSite(app, webDistDir)` as a
  trailing `GET *` registered AFTER the protocol/dashboard routes, so it only
  catches paths they did not. `startDemoServer` serves `packages/web/dist` by
  default when it exists.

`@hono/node-server`'s `serveStatic` only accepts a CWD-relative root, which is
fragile for a workspace command run from anywhere, so `static-site.ts` reads files
directly from an ABSOLUTE dist directory: known asset extensions get the right
content type and an immutable cache (Vite content-hashes them), unknown
non-`/v1`/`/dashboard` paths fall back to `index.html` (SPA fallback), and
`/v1/*` or `/dashboard/*` that slip past the protocol routes return 404. Path
traversal is neutralized by WHATWG URL normalization plus an under-root check.

## Consequences

- The deployed shape is genuinely exercised: `e2e/browser-prod-cohort.ts` points
  Chromium straight at the coordinator origin (no Vite, no proxy) and drives two
  attendees to a real aggregated signature. `e2e/browser-cohort.ts` covers the dev
  (Vite proxy) topology. The two share `e2e/lib/browser-harness.ts`.
- A real deployment needs HTTPS (clipboard / secure-context APIs) and benefits
  from HTTP/2 to lift the HTTP/1.1 ~6-connections-per-origin SSE cap; both are M3
  deployment concerns, out of scope here.
