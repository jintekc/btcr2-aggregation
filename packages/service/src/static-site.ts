import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';

type Env = { Bindings: HttpBindings };

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

interface ServedFile {
  body: Buffer;
  type: string;
}

async function readFileSafe(path: string): Promise<ServedFile | null> {
  try {
    const body = await readFile(path);
    return { body, type: CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

/**
 * Serve a built Vite SPA (e.g. `packages/web/dist`) from an ABSOLUTE directory.
 * `@hono/node-server`'s `serveStatic` only accepts a CWD-relative root, which is
 * fragile for a workspace command run from anywhere, so we read files directly.
 *
 * Registered as a trailing `GET *` so it never shadows the protocol routes
 * (`/v1/*`, `/dashboard/*`) registered earlier; any of those that slip through
 * (an unknown API path) return 404 rather than the SPA shell. Real asset paths
 * are served with the right content type and an immutable cache (Vite
 * content-hashes them); everything else falls back to `index.html` (the SPA is
 * a single page today, but the fallback keeps client routes working if added).
 */
export function mountStaticSite(app: Hono<Env>, webDistDir: string): void {
  const root = normalize(webDistDir);
  const indexHtml = join(root, 'index.html');

  app.get('*', async (c) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);

    // Never serve the SPA for protocol namespaces; an unmatched API path is a 404.
    if (pathname.startsWith('/v1/') || pathname.startsWith('/dashboard/')) {
      return c.text('not found', 404);
    }

    const requested = pathname === '/' ? '/index.html' : pathname;
    const resolved = normalize(join(root, requested));

    // Block path traversal: the resolved path must stay within the dist root.
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      return c.text('not found', 404);
    }

    const file = resolved === indexHtml ? null : await readFileSafe(resolved);
    if (file) {
      return new Response(new Uint8Array(file.body), {
        headers: {
          'content-type': file.type,
          // Vite content-hashes assets, so they are safe to cache immutably.
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // SPA fallback (and the explicit index.html request).
    const index = await readFileSafe(indexHtml);
    if (!index) {
      return c.text('web build not found', 404);
    }
    return new Response(new Uint8Array(index.body), {
      headers: { 'content-type': index.type, 'cache-control': 'no-cache' },
    });
  });
}
