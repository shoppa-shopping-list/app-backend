import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { configureStore, installState, resetStoreForTests } from './state/store.js';
import { emptyState } from './state/test-helpers.js';

beforeEach(() => {
  resetStoreForTests();
  installState(emptyState());
  configureStore({ writeLocalSync: () => {} });
});

describe('app', () => {
  it('GET /api/catalog returns an empty product list', async () => {
    const app = await buildApp({ config: loadConfig({}), log: pino({ level: 'silent' }) });

    const response = await app.inject({ method: 'GET', url: '/api/catalog' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ products: [] });
  });

  it('PUT /api/catalog/:productId with a non-UUID path param returns 400', async () => {
    const app = await buildApp({ config: loadConfig({}), log: pino({ level: 'silent' }) });

    const response = await app.inject({
      method: 'PUT',
      payload: { category: 'Dairy', name: 'Milk' },
      url: '/api/catalog/not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
  });

  it('a full PUT succeeds and the product appears in a follow-up GET', async () => {
    const app = await buildApp({ config: loadConfig({}), log: pino({ level: 'silent' }) });
    const productId = '11111111-1111-4111-8111-111111111111';

    const putResponse = await app.inject({
      method: 'PUT',
      payload: { category: 'Dairy', name: 'Milk' },
      url: `/api/catalog/${productId}`,
    });
    expect(putResponse.statusCode).toBe(200);

    const followUpResponse = await app.inject({ method: 'GET', url: '/api/catalog' });
    expect(followUpResponse.json()).toEqual({
      products: [expect.objectContaining({ id: productId, name: 'Milk' })],
    });
  });

  it('GET /api/nope returns a JSON 404, not index.html', async () => {
    const app = await buildApp({ config: loadConfig({}), log: pino({ level: 'silent' }) });

    const response = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });
});
