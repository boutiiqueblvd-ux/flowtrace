import { describe, expect, it } from 'vitest';
import { createApp } from './index.js';
import { createControlledExecutor } from './testing.js';

const workflowFixture = {
  id: 'demo-workflow',
  name: 'Demo workflow',
  nodes: [
    {
      id: 'input-1',
      type: 'input',
      position: { x: 0, y: 0 },
      config: {
        label: 'Input',
        description: 'Starts the workflow',
        defaultValue: 'hello',
      },
    },
    {
      id: 'transform-1',
      type: 'transform',
      position: { x: 200, y: 0 },
      config: {
        label: 'Transform',
        description: 'Transforms the input',
        expression: 'value.toUpperCase()',
      },
    },
    {
      id: 'output-1',
      type: 'output',
      position: { x: 400, y: 0 },
      config: {
        label: 'Output',
        description: 'Emits output',
        sink: 'console',
      },
    },
  ],
  edges: [
    { id: 'edge-1', source: 'input-1', target: 'transform-1' },
    { id: 'edge-2', source: 'transform-1', target: 'output-1' },
  ],
};

describe('health endpoint', () => {
  it('returns ok status', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: 'flowtrace-api',
    });
  });
});

describe('run events replay', () => {
  it('returns the run history after a given cursor', async () => {
    const app = await createApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: { workflow: workflowFixture, metadata: { request: 'replay' } },
    });

    expect(createResponse.statusCode).toBe(201);
    const runId = createResponse.json().run.id;

    const eventsResponse = await app.inject({
      method: 'GET',
      url: `/runs/${runId}/events?after=0`,
    });

    expect(eventsResponse.statusCode).toBe(200);
    const body = eventsResponse.json();
    expect(body).toMatchObject({ runId });
    expect(body.nextCursor).toBe(body.events.at(-1).sequence);
    expect(Array.isArray(eventsResponse.json().events)).toBe(true);
    expect(eventsResponse.json().events[0]).toMatchObject({
      runId,
      type: 'run-created',
    });
  });

  it('starts a real scheduler and records the execution events in history', async () => {
    const app = await createApp({
      schedulerConfig: {
        maxConcurrency: 2,
        defaultFailureRate: 0,
        delay: async () => undefined,
        random: () => 0.2,
        executionFn: async (node) => {
          if (node.type === 'output') {
            return { status: 'succeeded' };
          }
          return { status: 'succeeded' };
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: { workflow: workflowFixture },
    });

    expect(response.statusCode).toBe(201);
    const runId = response.json().run.id;

    await new Promise((resolve) => setTimeout(resolve, 50));

    const runResponse = await app.inject({
      method: 'GET',
      url: `/runs/${runId}`,
    });

    expect(runResponse.statusCode).toBe(200);
    const run = runResponse.json();
    expect(run.status).toBe('succeeded');
    expect(run.events.some((event: any) => event.type === 'run-started')).toBe(true);
    expect(run.events.some((event: any) => event.type === 'node-succeeded')).toBe(true);
  });

  it('delivers real scheduler events over the SSE endpoint', async () => {
    const app = await createApp({
      schedulerConfig: {
        maxConcurrency: 2,
        defaultFailureRate: 0,
        delay: async () => undefined,
        random: () => 0.4,
        executionFn: async () => ({ status: 'succeeded' }),
      },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });

    const createResponse = await fetch('http://127.0.0.1:' + (app.server.address() as any).port + '/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflow: workflowFixture }),
    });

    expect(createResponse.status).toBe(201);
    const createJson = await createResponse.json() as { run: { id: string } };
    const runId = createJson.run.id;

    const streamResponse = await fetch('http://127.0.0.1:' + (app.server.address() as any).port + `/runs/${runId}/stream?after=0`, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    });

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream');

    const text = await streamResponse.text();
    expect(text).toContain('event: run');
    expect(text).toMatch(/run-started|node-succeeded|run-terminal/);

    await app.close();
  });

  it('replays only events beyond a stale cursor and exposes the stream response', async () => {
    const app = await createApp();
    await app.listen({ port: 0, host: '127.0.0.1' });

    const createResponse = await fetch('http://127.0.0.1:' + (app.server.address() as any).port + '/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflow: workflowFixture }),
    });

    expect(createResponse.status).toBe(201);
    const createJson = await createResponse.json() as { run: { id: string } };
    const runId = createJson.run.id;

    const replay = await fetch('http://127.0.0.1:' + (app.server.address() as any).port + `/runs/${runId}/events?after=999`, {
      method: 'GET',
    });

    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      events: [],
      nextCursor: 999,
    });

    const streamResponse = await fetch('http://127.0.0.1:' + (app.server.address() as any).port + `/runs/${runId}/stream?after=0`, {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    });

    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream');

    const reader = streamResponse.body?.getReader();
    expect(reader).toBeDefined();
    const firstChunk = await reader!.read();
    expect(firstChunk.done).toBe(false);
    expect(new TextDecoder().decode(firstChunk.value)).toContain('event: run');

    await reader!.cancel();
    await app.close();
  });
});

const startControlledApp = async () => {
  const executor = createControlledExecutor();
  const app = await createApp({ schedulerConfig: { maxConcurrency: 2, executionFn: executor.executionFn } });
  const createResponse = await app.inject({ method: 'POST', url: '/runs', payload: { workflow: workflowFixture } });
  expect(createResponse.statusCode).toBe(201);
  const runId: string = createResponse.json().run.id;
  const getRun = async () => (await app.inject({ method: 'GET', url: `/runs/${runId}` })).json();
  return { app, executor, runId, getRun };
};

const summarize = (events: any[]) => events.map((event) => (event.nodeId ? `${event.type}:${event.nodeId}` : event.type));

const readStreamUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, predicate: (text: string) => boolean) => {
  const decoder = new TextDecoder();
  let text = '';
  while (!predicate(text)) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text;
};

const parseSseIds = (text: string) => [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));

describe('live execution lifecycle', () => {
  it('records scheduler events as they happen, with stable contiguous sequences', async () => {
    const { executor, getRun } = await startControlledApp();

    let run = await getRun();
    expect(run.status).toBe('running');
    expect(summarize(run.events)).toEqual(['run-created', 'run-started', 'node-started:input-1']);

    await executor.finish('input-1');
    run = await getRun();
    expect(summarize(run.events).slice(-2)).toEqual(['node-succeeded:input-1', 'node-started:transform-1']);

    await executor.finish('transform-1');
    await executor.finish('output-1');
    run = await getRun();
    expect(run.status).toBe('succeeded');
    expect(run.events.map((event: any) => event.sequence)).toEqual(run.events.map((_: unknown, index: number) => index + 1));
    expect(run.events.filter((event: any) => event.type === 'run-terminal')).toHaveLength(1);
  });

  it('streams each event over SSE before the run finishes', async () => {
    const { app, executor, runId, getRun } = await startControlledApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;

    const reader = (await fetch(`${base}/runs/${runId}/stream?after=0`)).body!.getReader();
    let text = await readStreamUntil(reader, (current) => current.includes('"nodeId":"input-1"'));
    expect((await getRun()).status).toBe('running');

    await executor.finish('input-1');
    text += await readStreamUntil(reader, (current) => current.includes('"nodeId":"transform-1"'));
    expect(text).not.toContain('run-terminal');

    await executor.finish('transform-1');
    await executor.finish('output-1');
    text += await readStreamUntil(reader, () => false);

    expect(text).toContain('"status":"succeeded"');
    const ids = parseSseIds(text);
    expect(ids).toEqual(ids.map((_, index) => index + 1));

    await app.close();
  });

  it('resumes from a cursor via ?after and Last-Event-ID without gaps or duplicates', async () => {
    const { app, executor, runId } = await startControlledApp();
    await executor.finish('input-1');

    const replay = (await app.inject({ method: 'GET', url: `/runs/${runId}/events?after=2` })).json();
    expect(replay.events.map((event: any) => event.sequence)).toEqual([3, 4, 5]);
    expect(replay.nextCursor).toBe(5);

    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    const reader = (await fetch(`${base}/runs/${runId}/stream`, { headers: { 'last-event-id': '3' } })).body!.getReader();
    let text = await readStreamUntil(reader, (current) => parseSseIds(current).includes(5));

    await executor.finish('transform-1');
    await executor.finish('output-1');
    text += await readStreamUntil(reader, () => false);

    const ids = parseSseIds(text);
    expect(ids[0]).toBe(4);
    expect(ids).toEqual(ids.map((_, index) => index + 4));

    await app.close();
  });

  it('cancels the real scheduler and keeps the history of nodes that ran', async () => {
    const { app, executor, runId, getRun } = await startControlledApp();
    await executor.finish('input-1');

    const cancelResponse = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel`, payload: { reason: 'operator stop' } });
    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json()).toMatchObject({ cancelled: true, run: { status: 'cancelled', cancelReason: 'operator stop' } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const run = await getRun();

    expect(run.status).toBe('cancelled');
    expect(summarize(run.events)).toEqual([
      'run-created',
      'run-started',
      'node-started:input-1',
      'node-succeeded:input-1',
      'node-started:transform-1',
      'node-cancelled:transform-1',
      'node-cancelled:output-1',
      'run-terminal',
    ]);
    expect(run.events.filter((event: any) => event.type === 'node-cancelled').map((event: any) => event.interrupted)).toEqual([true, false]);
    expect(executor.started).toEqual(['input-1', 'transform-1']);
  });

  it('keeps the scheduler running after an SSE client disconnects', async () => {
    const { app, executor, runId, getRun } = await startControlledApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;

    const controller = new AbortController();
    const reader = (await fetch(`${base}/runs/${runId}/stream?after=0`, { signal: controller.signal })).body!.getReader();
    await readStreamUntil(reader, (current) => current.includes('"nodeId":"input-1"'));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await executor.finish('input-1');
    await executor.finish('transform-1');
    await executor.finish('output-1');

    expect((await getRun()).status).toBe('succeeded');
    await app.close();
  });

  it('returns a readable 400 for an invalid run request', async () => {
    const app = await createApp();
    const workflow = structuredClone(workflowFixture);
    workflow.nodes[0].config.label = '';

    const response = await app.inject({ method: 'POST', url: '/runs', payload: { workflow } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('node "input-1" config.label');
  });

  it('treats cancelling a finished run as a no-op', async () => {
    const { app, executor, runId, getRun } = await startControlledApp();
    await executor.finish('input-1');
    await executor.finish('transform-1');
    await executor.finish('output-1');
    const before = await getRun();

    const cancelResponse = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel`, payload: {} });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json()).toMatchObject({ cancelled: false, run: { status: 'succeeded' } });
    expect(await getRun()).toEqual(before);
  });
});
