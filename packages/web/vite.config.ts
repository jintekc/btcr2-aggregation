import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The participant dependency chain is browser-safe (@noble/@scure over WebCrypto,
// fetch + SSE transport). The one hazard is @did-btcr2/method's root barrel
// pulling in @web5/dids -> level/classic-level (native) + did-dht. `resolve.conditions`
// puts 'browser' first so @did-btcr2/method and @did-btcr2/aggregation resolve their
// prebundled dist/browser.mjs; optimizeDeps.exclude keeps the native level binding
// out of the dev prebundle. Verified by a `vite build` + headless-Chromium keygen smoke
// (M2 Phase 0): no node-only modules in the bundle, in-browser keygen works.
// Forward the protocol + dashboard routes to the coordinator so the browser
// client transport (baseUrl = window.location.origin) needs no CORS. SSE
// streams (adverts, inbox, dashboard) must not be buffered by the proxy. The
// coordinator origin is overridable (COORDINATOR_ORIGIN) so the browser E2E can
// run the coordinator on an ephemeral port and inject it here.
const COORDINATOR_ORIGIN = process.env.COORDINATOR_ORIGIN ?? 'http://127.0.0.1:8080';
const PROXY = {
  '/v1': { target: COORDINATOR_ORIGIN, changeOrigin: true },
  '/dashboard': { target: COORDINATOR_ORIGIN, changeOrigin: true },
} as const;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: ['browser', 'import', 'module', 'default'],
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    exclude: ['level', 'classic-level', '@dnsquery/dns-packet', 'bencode'],
  },
  define: {
    'process.env': '{}',
  },
  // Applied to both `vite dev` and `vite preview`; the latter serves the
  // production build that the headless E2E exercises.
  server: { proxy: PROXY },
  preview: { proxy: PROXY },
  build: {
    target: 'es2022',
  },
});
