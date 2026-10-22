import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { createWorkflowScheduler, type WorkflowSchedulerConfig } from './scheduler.js';
import { cancelRunRequestSchema, createRun, validateWorkflow, type ExecutionEvent, type RunSnapshot } from './workflow.js';

const MAX_EVENT_HISTORY = 1000;

const getEventSequence = (event: ExecutionEvent) => {
  return event.sequence ?? event.id ?? 0;
};

// Events are stored in append order with sequences assigned once, so this is already sorted.
const getEventsAfterCursor = (run: RunSnapshot, cursor: number): ExecutionEvent[] => {
  return run.events.filter((event) => getEventSequence(event) > cursor);
};

const isTerminalStatus = (status: RunSnapshot['status']) => status === 'succeeded' || status === 'failed' || status === 'cancelled';

const parseCursor = (value: string | string[] | undefined): number => {
  const rawValue = Array.isArray(value) ? value[0] : value ?? '0';
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
};

export const createApp = async (options: { schedulerConfig?: WorkflowSchedulerConfig } = {}) => {
  const app = Fastify({
    logger: false,
  });
  const runs = new Map<string, RunSnapshot>();
  const listeners = new Map<string, Set<(run: RunSnapshot) => void>>();
  const activeSchedulers = new Map<string, ReturnType<typeof createWorkflowScheduler>>();

  const setRun = (run: RunSnapshot) => {
    runs.set(run.id, run);

    const listenersForRun = listeners.get(run.id) ?? new Set();
    for (const listener of listenersForRun) {
      try {
        listener(run);
      } catch (error) {
        console.error('Failed to notify run listener', error);
      }
    }
  };

  // Appends one event to the run's log with the next sequence number. Sequences are
  // assigned exactly once and never renumbered, so client cursors stay valid.
  const recordEvent = (runId: string, event: ExecutionEvent) => {
    const run = runs.get(runId);
    if (!run) {
      return;
    }

    const sequence = (run.events.at(-1)?.sequence ?? 0) + 1;
    const nextRun: RunSnapshot = {
      ...run,
      updatedAt: event.timestamp,
      events: [...run.events, { ...event, id: sequence, sequence, runId }].slice(-MAX_EVENT_HISTORY),
    };

    if (event.type === 'run-started') {
      nextRun.status = 'running';
      nextRun.startedAt = event.timestamp;
    }

    if (event.type === 'run-terminal') {
      nextRun.status = event.status;
      nextRun.finishedAt = event.timestamp;
    }

    setRun(nextRun);
  };

  const startSchedulerForRun = async (run: RunSnapshot) => {
    const scheduler = createWorkflowScheduler({
      ...options.schedulerConfig,
      runId: run.id,
      onEvent: (event) => {
        recordEvent(run.id, event);
        options.schedulerConfig?.onEvent?.(event);
      },
    });
    activeSchedulers.set(run.id, scheduler);

    try {
      await scheduler.run(run.workflow);
    } catch (error) {
      const currentRun = runs.get(run.id);
      if (currentRun && !isTerminalStatus(currentRun.status)) {
        recordEvent(run.id, { type: 'run-terminal', timestamp: new Date().toISOString(), status: 'failed', runId: run.id });
      }
      console.error('Workflow scheduler failed for run', run.id, error);
    } finally {
      activeSchedulers.delete(run.id);
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
    const query = request.query as Record<string, string | string[] | undefined>;
    const cursor = parseCursor(typeof query.after === 'string' ? query.after : request.headers['last-event-id'] as string | undefined);
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

    const query = request.query as Record<string, string | string[] | undefined>;
    const cursor = parseCursor(typeof query.after === 'string' ? query.after : request.headers['last-event-id'] as string | undefined);

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

    const closeStream = () => {
      if (closed) {
        return;
      }

      closed = true;
      unsubscribe();
      reply.raw.end();
    };

    const flushRunEvents = (latestRun: RunSnapshot) => {
      const nextEvents = getEventsAfterCursor(latestRun, currentCursor);
      for (const event of nextEvents) {
        writeEvent(event);
        currentCursor = Math.max(currentCursor, getEventSequence(event));
      }

      if (isTerminalStatus(latestRun.status) && nextEvents.length > 0) {
        closeStream();
      }
    };

    const unsubscribe = subscribeToRun(run.id, (updatedRun) => {
      if (closed) {
        return;
      }

      flushRunEvents(updatedRun);
    });

    for (const event of getEventsAfterCursor(run, cursor)) {
      writeEvent(event);
      currentCursor = Math.max(currentCursor, getEventSequence(event));
    }

    if (isTerminalStatus(run.status)) {
      closeStream();
      return reply.code(200);
    }

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
      void startSchedulerForRun(result.run);
      // The scheduler has already recorded its first events synchronously; return the live snapshot.
      return reply.code(201).send({ ...result, run: runs.get(result.run.id) ?? result.run });
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

    const parsed = cancelRunRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid cancel request.' });
    }

    // A finished run keeps its real outcome.
    if (isTerminalStatus(currentRun.status)) {
      return reply.code(200).send({ run: currentRun, cancelled: false });
    }

    const reason = parsed.data.reason ?? 'Cancelled by operator.';
    const scheduler = activeSchedulers.get(params.id);
    if (scheduler) {
      // Records the cancelled nodes and the terminal event synchronously through onEvent.
      scheduler.cancel(reason);
    } else {
      recordEvent(params.id, { type: 'run-terminal', timestamp: new Date().toISOString(), status: 'cancelled', runId: params.id });
    }

    const cancelledRun = runs.get(params.id) ?? currentRun;
    setRun({ ...cancelledRun, cancelReason: reason });
    return reply.code(200).send({ run: runs.get(params.id), cancelled: true });
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
