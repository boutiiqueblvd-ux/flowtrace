import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { cancelRun, createRun, validateWorkflow, type RunSnapshot } from './workflow.js';

export const createApp = async () => {
  const app = Fastify({
    logger: false,
  });
  const runs = new Map<string, RunSnapshot>();

  app.get('/health', async () => {
    return {
      ok: true,
      service: 'flowtrace-api',
      timestamp: new Date().toISOString(),
    };
  });

  app.post('/workflows/validate', async (request, reply) => {
    const result = validateWorkflow(request.body);
    return reply.code(result.valid ? 200 : 400).send(result);
  });

  app.post('/runs', async (request, reply) => {
    try {
      const result = createRun(request.body);
      runs.set(result.run.id, result.run);
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
    runs.set(params.id, result.run);
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
