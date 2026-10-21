import { describe, expect, it } from 'vitest';
import { createApp } from './index.js';

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
    expect(eventsResponse.json()).toMatchObject({
      runId,
      nextCursor: 1,
    });
    expect(Array.isArray(eventsResponse.json().events)).toBe(true);
    expect(eventsResponse.json().events[0]).toMatchObject({
      runId,
      type: 'run-created',
    });
  });

  it('replays only events beyond a stale cursor and exposes the stream response', async () => {
    const app = await createApp();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/runs',
      payload: { workflow: workflowFixture },
    });

    const runId = createResponse.json().run.id;

    const replay = await app.inject({
      method: 'GET',
      url: `/runs/${runId}/events?after=999`,
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.json().events).toEqual([]);
    expect(replay.json().nextCursor).toBe(999);

    const stream = await app.inject({
      method: 'GET',
      url: `/runs/${runId}/stream?after=0`,
    });

    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.body).toContain('event: run\n');
    expect(stream.body).toContain('data:');
  });
});
