// @vitest-environment node
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs the real vite.config.ts dev server in front of a stub API, so the test checks what the
// browser would get: same-origin /api/* requests forwarded to the API's unprefixed routes.

type Recorded = { method: string; url: string; body: string; origin?: string };

const recorded: Recorded[] = [];
let releaseStream: () => void = () => undefined;
let upstream: Server;
let vite: ViteDevServer;
let base: string;

const readBody = (request: IncomingMessage) => new Promise<string>((resolve) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => resolve(body));
});

const handleUpstream = async (request: IncomingMessage, response: ServerResponse) => {
  const body = await readBody(request);
  recorded.push({ method: request.method ?? '', url: request.url ?? '', body, origin: request.headers.origin });

  if (request.url?.startsWith('/runs/run-1/stream')) {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write('id: 3\nevent: run\ndata: {"type":"node-started","nodeId":"a","sequence":3}\n\n');
    releaseStream = () => {
      response.write('id: 4\nevent: run\ndata: {"type":"run-terminal","status":"succeeded","sequence":4}\n\n');
      response.end();
    };
    return;
  }

  if (request.url === '/runs/missing') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Run not found.' }));
    return;
  }

  response.writeHead(request.method === 'POST' && request.url === '/runs' ? 201 : 200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ path: request.url }));
};

beforeAll(async () => {
  upstream = createHttpServer((request, response) => void handleUpstream(request, response));
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));

  process.env.FLOWTRACE_API_TARGET = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  vite = await createViteServer({
    configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'silent',
  });
  await vite.listen();
  base = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.FLOWTRACE_API_TARGET;
  await vite?.close();
  await new Promise((resolve) => upstream?.close(resolve));
});

describe('vite /api proxy', () => {
  it('forwards run creation with its JSON body to POST /runs', async () => {
    const payload = JSON.stringify({ workflow: { id: 'wf' } });
    const response = await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });

    expect(response.status).toBe(201);
    expect(recorded.at(-1)).toMatchObject({ method: 'POST', url: '/runs', body: payload });
  });

  it.each([
    ['POST', '/api/runs/run-1/cancel', '/runs/run-1/cancel'],
    ['POST', '/api/workflows/validate', '/workflows/validate'],
    ['GET', '/api/runs/run-1', '/runs/run-1'],
    ['GET', '/api/runs/run-1/events?after=3', '/runs/run-1/events?after=3'],
    ['GET', '/api/health', '/health'],
  ])('maps %s %s to %s', async (method, path, upstreamPath) => {
    const response = await fetch(`${base}${path}`, { method, ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}) });

    expect(response.status).toBe(200);
    expect(recorded.at(-1)).toMatchObject({ method, url: upstreamPath });
  });

  it('passes API error statuses through unchanged', async () => {
    const response = await fetch(`${base}/api/runs/missing`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Run not found.' });
  });

  it('streams SSE frames as they are written instead of buffering the response', async () => {
    const response = await fetch(`${base}/api/runs/run-1/stream?after=2`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(recorded.at(-1)).toMatchObject({ method: 'GET', url: '/runs/run-1/stream?after=2' });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader.read()).value);
    // The upstream has not finished the response yet, so this frame arrived through the proxy live.
    expect(first).toContain('id: 3');
    expect(first).not.toContain('id: 4');

    releaseStream();
    let rest = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      rest += decoder.decode(value, { stream: true });
    }
    expect(rest).toContain('id: 4');
  });

  it('leaves non-API paths to Vite', async () => {
    const before = recorded.length;
    await fetch(`${base}/sample-workflow.json`);

    expect(recorded.length).toBe(before);
  });
});
