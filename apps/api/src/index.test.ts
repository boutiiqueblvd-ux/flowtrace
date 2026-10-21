import { describe, expect, it } from 'vitest';
import { createApp } from './index.js';

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
