// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { followRunStream } from './runStream';
import type { ExecutionEvent } from './types';

const event = (sequence: number, terminal = false): ExecutionEvent => (terminal
  ? { type: 'run-terminal', status: 'succeeded', timestamp: '2024-01-01T00:00:00.000Z', sequence, id: sequence, runId: 'run-1' }
  : { type: 'node-started', nodeId: `n${sequence}`, timestamp: '2024-01-01T00:00:00.000Z', sequence, id: sequence, runId: 'run-1' });

const sse = (events: ExecutionEvent[]) => events.map((item) => `id: ${item.sequence}\nevent: run\ndata: ${JSON.stringify(item)}\n\n`).join('');

const streamResponse = (text: string) => new Response(new ReadableStream({
  start(controller) {
    // Split mid-event to exercise buffering across chunks.
    const middle = Math.floor(text.length / 2);
    controller.enqueue(new TextEncoder().encode(text.slice(0, middle)));
    controller.enqueue(new TextEncoder().encode(text.slice(middle)));
    controller.close();
  },
}));

// Records applied events the way the execution store does: in order, ignoring anything at or below the cursor.
const createSink = () => {
  const applied: number[] = [];
  let finished = false;
  return {
    applied,
    getCursor: () => applied.at(-1) ?? 0,
    isFinished: () => finished,
    onEvent: (item: ExecutionEvent) => {
      const sequence = item.sequence ?? 0;
      if (sequence <= (applied.at(-1) ?? 0)) {
        return;
      }
      applied.push(sequence);
      finished = item.type === 'run-terminal';
    },
  };
};

const createFetch = (responses: Array<Response | Error | ((url: string) => Response)>) => {
  const urls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected request ${url}`);
    }
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === 'function' ? next(url) : next;
  }) as typeof fetch;
  return { fetchFn, urls };
};

const follow = (sink: ReturnType<typeof createSink>, fetchFn: typeof fetch, signal = new AbortController().signal) => followRunStream({
  apiBaseUrl: 'http://api',
  runId: 'run-1',
  signal,
  fetchFn,
  wait: async () => undefined,
  ...sink,
});

describe('followRunStream', () => {
  it('reconnects after a dropped connection and resumes from the last applied sequence', async () => {
    const sink = createSink();
    const { fetchFn, urls } = createFetch([
      streamResponse(sse([event(1), event(2)])),
      streamResponse(sse([event(2), event(3), event(4, true)])),
    ]);

    const outcome = await follow(sink, fetchFn);

    expect(outcome).toBe('finished');
    expect(urls).toEqual(['http://api/runs/run-1/stream?after=0', 'http://api/runs/run-1/stream?after=2']);
    expect(sink.applied).toEqual([1, 2, 3, 4]);
  });

  it('retries after a network error', async () => {
    const sink = createSink();
    const { fetchFn, urls } = createFetch([
      new TypeError('Failed to fetch'),
      streamResponse(sse([event(1), event(2, true)])),
    ]);

    expect(await follow(sink, fetchFn)).toBe('finished');
    expect(urls).toHaveLength(2);
    expect(sink.applied).toEqual([1, 2]);
  });

  it('fills a sequence gap from the replay endpoint before applying later events', async () => {
    const sink = createSink();
    const { fetchFn, urls } = createFetch([
      streamResponse(sse([event(1), event(4), event(5, true)])),
      new Response(JSON.stringify({ events: [event(2), event(3), event(4)] })),
    ]);

    expect(await follow(sink, fetchFn)).toBe('finished');
    expect(urls[1]).toBe('http://api/runs/run-1/events?after=1');
    expect(sink.applied).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops when the run no longer exists', async () => {
    const sink = createSink();
    const { fetchFn } = createFetch([new Response('{}', { status: 404 })]);

    expect(await follow(sink, fetchFn)).toBe('not-found');
  });

  it('stops reconnecting once aborted', async () => {
    const sink = createSink();
    const controller = new AbortController();
    const { fetchFn, urls } = createFetch([
      () => {
        controller.abort();
        return streamResponse(sse([event(1)]));
      },
    ]);

    expect(await follow(sink, fetchFn, controller.signal)).toBe('aborted');
    expect(urls).toHaveLength(1);
  });
});
