import type { HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import {
  formatSseComment,
  formatSseEvent,
  type HttpRequestLike,
  type HttpServerTransport,
  type SseStream,
} from '@did-btcr2/aggregation/service';
import { Hono, type Context } from 'hono';

type Env = { Bindings: HttpBindings };

const DEBUG = process.env.SSE_DEBUG === '1';
function dbg(msg: string): void {
  if (DEBUG) {
    console.error(`[adapter] ${msg}`);
  }
}

/** Collect a Hono request's headers into a lowercased-key record (per HttpRequestLike). */
function lowercaseHeaders(c: Context<Env>): Record<string, string> {
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

/** Map a Hono context to the transport's framework-agnostic request shape. */
async function toRequestLike(c: Context<Env>): Promise<HttpRequestLike> {
  const method = c.req.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return {
    method,
    url: c.req.url,
    headers: lowercaseHeaders(c),
    body: hasBody ? await c.req.text() : undefined,
    remoteAddr: c.env.incoming.socket?.remoteAddress,
  };
}

/**
 * Hijack the raw Node response for an SSE GET. `@hono/node-server` exposes the
 * underlying ServerResponse on `c.env.outgoing`; we write `event:/data:/id:` and
 * comment frames straight to it (formatted exactly as the client's SSE parser
 * expects), then return the sentinel that tells Hono the response is already sent.
 */
function openSseStream(c: Context<Env>, transport: HttpServerTransport): Response {
  const res = c.env.outgoing;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  const stream: SseStream = {
    writeEvent(event, data, id) {
      dbg(`SSE write event=${event} id=${id ?? '-'} bytes=${data.length} on ${c.req.url}`);
      res.write(formatSseEvent(event, data, id));
    },
    writeComment(comment) {
      res.write(formatSseComment(comment));
    },
    close() {
      res.end();
    },
    onClose(cb) {
      res.on('close', cb);
    },
  };

  const reqLike: HttpRequestLike = {
    method: c.req.method,
    url: c.req.url,
    headers: lowercaseHeaders(c),
    remoteAddr: c.env.incoming.socket?.remoteAddress,
  };

  transport.handleSse(reqLike, stream);
  return RESPONSE_ALREADY_SENT;
}

/**
 * Mount {@link HttpServerTransport} under Hono. Non-SSE routes pass through
 * `handleRequest` and return a standard `Response`; the two SSE GET routes hijack
 * the raw Node response and stream transport-driven events.
 */
export function createHonoApp(transport: HttpServerTransport): Hono<Env> {
  const app = new Hono<Env>();

  const handle = async (c: Context<Env>): Promise<Response> => {
    const reqLike = await toRequestLike(c);
    const r = await transport.handleRequest(reqLike);
    dbg(`${c.req.method} ${new URL(c.req.url).pathname} -> ${r.status}`);
    return new Response(r.body, { status: r.status, headers: r.headers });
  };

  app.post('/v1/messages', handle);
  app.post('/v1/adverts', handle);
  app.get('/v1/adverts', (c) => {
    dbg(`SSE open GET ${new URL(c.req.url).pathname}`);
    return openSseStream(c, transport);
  });
  app.get('/v1/actors/:did/inbox', (c) => {
    dbg(`SSE open GET ${new URL(c.req.url).pathname}`);
    return openSseStream(c, transport);
  });
  app.get('/v1/.well-known/aggregation', handle);

  return app;
}
