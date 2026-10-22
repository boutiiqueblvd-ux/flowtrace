import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { cancelRun, createRun, validateWorkflow, type ExecutionEvent, type RunSnapshot } from './workflow.js';

const MAX_EVENT_HISTORY = 1000;

const getEventSequence = (event: ExecutionEvent) => {
  return event.sequence ?? event.id ?? 0;
};

const normalizeRunEvents = (run: RunSnapshot): RunSnapshot => {
  const deduplicated = new Map<number, ExecutionEvent>();

  const orderedEvents = [...run.events].sort((left, right) => getEventSequence(left) - getEventSequence(right));

  for (const [index, event] of orderedEvents.entries()) {
    const explicitSequence = typeof event.sequence === 'number' ? event.sequence : typeof event.id === 'number' ? event.id : undefined;
    const sequence = explicitSequence && explicitSequence > 0 ? explicitSequence : index + 1;

    deduplicated.set(sequence, {
      ...event,
      id: sequence,
      sequence,
      runId: event.runId ?? run.id,
    } satisfies ExecutionEvent);
  }

  const events = Array.from(deduplicated.values())
    .sort((left, right) => getEventSequence(left) - getEventSequence(right))
    .slice(-MAX_EVENT_HISTORY);

  return {
    ...run,
    events,
  };
};

const getEventsAfterCursor = (run: RunSnapshot, cursor: number): ExecutionEvent[] => {
  return [...run.events]
    .sort((left, right) => getEventSequence(left) - getEventSequence(right))
    .filter((event) => getEventSequence(event) > cursor);
};

const parseCursor = (value: string | string[] | undefined): number => {
  const rawValue = Array.isArray(value) ? value[0] : value ?? '0';
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
};

export const createApp = async () => {
  const app = Fastify({
    logger: false,
  });
  const runs = new Map<string, RunSnapshot>();
  const listeners = new Map<string, Set<(run: RunSnapshot) => void>>();

  const setRun = (run: RunSnapshot) => {
    const normalizedRun = normalizeRunEvents(run);
    runs.set(normalizedRun.id, normalizedRun);

    const listenersForRun = listeners.get(normalizedRun.id) ?? new Set();
    for (const listener of listenersForRun) {
      try {
        listener(normalizedRun);
      } catch (error) {
        console.error('Failed to notify run listener', error);
      }
    }
  };

  const subscribeToRun = (runId: string, listener: (run: RunSnapshot) => void) => {
    const runListeners = listeners.get(runId) ?? new Set();
    runListeners.add(listener);
    listeners.set(runId, runListeners);

    return () => {
      const currentListeners = listeners.get(runId);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);
      if (currentListeners.size === 0) {
        listeners.delete(runId);
      }
    };
  };

  app.get('/health', async () => {
    return {
      ok: true,
      service: 'flowtrace-api',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/runs', async () => {
    return {
      runs: Array.from(runs.values()).map((run) => ({
        id: run.id,
        status: run.status,
        workflowId: run.workflowId,
        updatedAt: run.updatedAt,
      })),
    };
  });

  app.get('/runs/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const run = runs.get(params.id);

    if (!run) {
      return reply.code(404).send({ error: 'Run not found.' });
    }

    return run;
  });

  app.get('/runs/:id/events', async (request, reply) => {
    const params = request.params as { id: string };
    const cursor = parseCursor(typeof request.query.after === 'string' ? request.query.after : request.headers['last-event-id'] as string | undefined);
    const run = runs.get(params.id);

    if (!run) {
      return reply.code(404).send({ error: 'Run not found.' });
    }

    const events = getEventsAfterCursor(run, cursor);
    const nextCursor = events.length > 0 ? getEventSequence(events.at(-1) as ExecutionEvent) : cursor;

    return reply.code(200).send({
      runId: run.id,
      status: run.status,
      events,
      nextCursor,
      total: run.events.length,
    });
  });

  app.get('/runs/:id/stream', async (request, reply) => {
    const params = request.params as { id: string };
    const run = runs.get(params.id);

    if (!run) {
      return reply.code(404).send({ error: 'Run not found.' });
    }

    const cursor = parseCursor(typeof request.query.after === 'string' ? request.query.after : request.headers['last-event-id'] as string | undefined);

    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders?.();

    const writeEvent = (event: ExecutionEvent) => {
      const id = getEventSequence(event);
      reply.raw.write(`id: ${id}\n`);
      reply.raw.write('event: run\n');
      reply.raw.write(`data: ${JSON.stringify({ ...event, runId: event.runId ?? run.id })}\n\n`);
    };

    let currentCursor = cursor;
    let closed = false;

    for (const event of getEventsAfterCursor(run, cursor)) {
      writeEvent(event);
      currentCursor = Math.max(currentCursor, getEventSequence(event));
    }

    const unsubscribe = subscribeToRun(run.id, (updatedRun) => {
      if (closed) {
        return;
      }

      const nextEvents = getEventsAfterCursor(updatedRun, currentCursor);
      for (const event of nextEvents) {
        writeEvent(event);
        currentCursor = Math.max(currentCursor, getEventSequence(event));
      }
    });

    const closeStream = () => {
      if (closed) {
        return;
      }

      closed = true;
      unsubscribe();
      reply.raw.end();
    };

    request.raw.on('close', closeStream);
    request.raw.on('end', closeStream);
    reply.raw.on('close', closeStream);
    reply.raw.on('error', () => {
      closeStream();
    });

    return reply.code(200);
  });

  app.post('/workflows/validate', async (request, reply) => {
    const result = validateWorkflow(request.body);
    return reply.code(result.valid ? 200 : 400).send(result);
  });

  app.post('/runs', async (request, reply) => {
    try {
      const result = createRun(request.body);
      setRun(result.run);
      return reply.code(201).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Run creation failed.';
      return reply.code(400).send({ error: message });
    }
  });

  app.post('/runs/:id/cancel', async (request, reply) => {
    const params = request.params as { id: string };
    const currentRun = runs.get(params.id);

    if (!currentRun) {
      return reply.code(404).send({ error: 'Run not found.' });
    }

    const result = cancelRun(currentRun, request.body ?? {});
    setRun(result.run);
    return reply.code(200).send(result);
  });

  return app;
};

export const startServer = async () => {
  const app = await createApp();

  try {
    await app.listen({ port: 3001, host: '0.0.0.0' });
    console.log('FlowTrace API running on http://localhost:3001');
  } catch (error) {
    console.error('Failed to start FlowTrace API', error);
    process.exit(1);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
