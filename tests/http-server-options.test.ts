import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { HTTP_SERVER_OPTIONS } from '../src/lib/http-server-options';

test('first calculation response survives the old 30s server and 45s client windows', async () => {
  const app = new Elysia({ serve: HTTP_SERVER_OPTIONS })
    .post('/compatibility', async () => {
      await Bun.sleep(46_000);
      return { analysis: 'ผลคำทำนาย', cached: false };
    })
    .listen({ port: 0, hostname: '127.0.0.1' });

  try {
    const response = await fetch(`http://127.0.0.1:${app.server!.port}/compatibility`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ analysis: 'ผลคำทำนาย', cached: false });
  } finally {
    await app.stop();
  }
}, 55_000);
