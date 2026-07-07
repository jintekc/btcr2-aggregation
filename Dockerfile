# Self-hostable did:btcr2 aggregation coordinator (ADR 0014).
#
# One image, any network: the SPA is network-agnostic and reads the operator's
# chain at runtime from GET /v1/config (M3f), so a single build serves mutinynet,
# signet, regtest, or mainnet - the operator picks with NETWORK at `docker run`.
#
# The same-origin topology means ONE process serves both the API and the built
# SPA on one port; no nginx inside the container. Terminate TLS at a reverse proxy
# in front of it (see docs/DEPLOY.md).
#
# Deps are pure JS (@scure/@noble crypto, fetch-based esplora, the native-free
# Helia stack), so a slim base with no build toolchain suffices.

# ---- base: pin the toolchain once (Node 22, pnpm 11.4.0 - matches CI) ----------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@11.4.0
WORKDIR /app

# ---- builder: install every dep, build all packages + the SPA, then prune ------
FROM base AS builder
COPY . .
# --trust-lockfile: the committed lockfile is the reviewed, trusted base, so skip
# pnpm 11's 24h minimumReleaseAge re-verification that would otherwise fail a build
# whenever any dep is freshly published (same rationale as .github/workflows/ci.yml).
RUN pnpm install --frozen-lockfile --trust-lockfile
RUN pnpm -r build
# NB: `pnpm prune --prod` is deliberately NOT run here. In this pnpm workspace it
# rewrites the virtual-store symlinks and breaks the service's package resolution
# (e.g. @did-btcr2/bitcoin) once the tree is copied to the runtime stage. The
# runtime therefore ships the full built workspace, which resolves exactly as in
# development. A slim prod-only variant (`pnpm deploy --prod`) is future work; see
# docs/DEPLOY.md.

# ---- runtime: copy the built, pruned workspace and run compiled JS --------------
FROM base AS runtime
ENV NODE_ENV=production
# Bind all interfaces inside the container (the entrypoint defaults to loopback);
# the operator fronts this with a TLS-terminating reverse proxy.
ENV HOST=0.0.0.0
ENV PORT=8080
# Copy the whole built workspace so the service's `../../web/dist` SPA path and the
# pnpm workspace symlinks resolve exactly as they do in development.
COPY --from=builder /app /app
# Pre-create the documented durable IPFS path owned by `node`: Docker seeds a fresh
# named volume from the image path's ownership, so without this an IPFS_DIR volume
# mounts root-owned and the unprivileged runtime cannot write pins to it.
RUN mkdir -p /data/ipfs && chown -R node:node /data
EXPOSE 8080
# The unconditional GET /v1/config route is the cheapest liveness signal (it never
# touches the chain or the store), so it is a safe container healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/v1/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Drop root: the app needs no privileged ports (8080) and writes only to an
# optional IPFS_DIR the operator mounts writable.
USER node
CMD ["node", "packages/service/dist/demo-server.js"]
