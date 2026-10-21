import { pathToFileURL } from 'node:url';
import Fastify from 'fastify';

export const createApp = async () => {
  const app = Fastify({
    logger: false,
  });

  app.get('/health', async () => {
    return {
      ok: true,
      service: 'flowtrace-api',
      timestamp: new Date().toISOString(),
    };
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
