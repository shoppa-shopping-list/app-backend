import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { buildInitData, TEST_BOT_TOKEN, TEST_USER_ID } from './auth-test-helpers.js';
import { createSessionCookie } from './auth.js';
import { configureStore, installState, resetStoreForTests } from './state/store.js';
import { emptyState } from './state/test-helpers.js';

const TEST_SESSION_SECRET = 'test-session-secret';
const OTHER_USER_ID = TEST_USER_ID + 1;

const TEST_CONFIG = loadConfig({
  ALLOWED_USER_IDS: `${String(TEST_USER_ID)},${String(OTHER_USER_ID)}`,
  BOT_TOKEN: TEST_BOT_TOKEN,
  SESSION_SECRET: TEST_SESSION_SECRET,
});

function sessionCookieHeader(userId = TEST_USER_ID): string {
  return `session=${createSessionCookie(userId, TEST_SESSION_SECRET, Date.now())}`;
}

beforeEach(() => {
  resetStoreForTests();
  installState(emptyState());
  configureStore({ writeLocalSync: () => {} });
});

describe('app', () => {
  it('GET /api/catalog returns an empty product list', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });

    const response = await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'GET',
      url: '/api/catalog',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ products: [] });
  });

  it('PUT /api/catalog/:productId with a non-UUID path param returns 400', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });

    const response = await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'PUT',
      payload: { category: 'Dairy', name: 'Milk' },
      url: '/api/catalog/not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
  });

  it('a full PUT succeeds and the product appears in a follow-up GET', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });
    const productId = '11111111-1111-4111-8111-111111111111';

    const putResponse = await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'PUT',
      payload: { category: 'Dairy', name: 'Milk' },
      url: `/api/catalog/${productId}`,
    });
    expect(putResponse.statusCode).toBe(200);

    const followUpResponse = await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'GET',
      url: '/api/catalog',
    });
    expect(followUpResponse.json()).toEqual({
      products: [expect.objectContaining({ id: productId, name: 'Milk' })],
    });
  });

  it('GET /api/nope returns a JSON 404, not index.html', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });

    const response = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });
});

describe('auth', () => {
  it('GET /api/catalog without a cookie is rejected', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });

    const response = await app.inject({ method: 'GET', url: '/api/catalog' });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/catalog with a tampered cookie is rejected', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });
    const tampered = `session=${sessionCookieHeader().slice(0, -1)}x`;

    const response = await app.inject({
      headers: { cookie: tampered },
      method: 'GET',
      url: '/api/catalog',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/events (SSE) without a cookie is rejected', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });

    const response = await app.inject({ method: 'GET', url: '/api/events' });

    expect(response.statusCode).toBe(401);
  });

  it('POST /api/session with a validly signed initData sets a session cookie', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });

    const response = await app.inject({
      headers: { authorization: `tma ${buildInitData()}` },
      method: 'POST',
      url: '/api/session',
    });

    expect(response.statusCode).toBe(204);
    const sessionCookie = response.cookies.find((cookie) => cookie.name === 'session');
    if (sessionCookie === undefined) {
      throw new Error('expected a session cookie to be set');
    }
    expect(sessionCookie.httpOnly).toBe(true);
    // TEST_CONFIG has no NODE_ENV, so this exercises the development default: not Secure,
    // since the dev server has no TLS and a Secure cookie would be silently dropped.
    // Secure is a bare attribute (present/absent), so an absent flag parses as
    // undefined, not `false` — assert on truthiness, not identity.
    expect(sessionCookie.secure).toBeFalsy();
  });

  it('sets a Secure cookie in production (deployed behind nginx HTTPS, D19)', async () => {
    const productionConfig = loadConfig({
      ALLOWED_USER_IDS: String(TEST_USER_ID),
      BOT_TOKEN: TEST_BOT_TOKEN,
      NODE_ENV: 'production',
      SESSION_SECRET: TEST_SESSION_SECRET,
    });
    const app = await buildApp({ config: productionConfig, log: pino({ level: 'silent' }) });

    const response = await app.inject({
      headers: { authorization: `tma ${buildInitData()}` },
      method: 'POST',
      url: '/api/session',
    });

    const sessionCookie = response.cookies.find((cookie) => cookie.name === 'session');
    if (sessionCookie === undefined) {
      throw new Error('expected a session cookie to be set');
    }
    expect(sessionCookie.secure).toBe(true);
  });

  it('POST /api/session with a tampered initData is rejected', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });
    // Mutate after signing (see the equivalent auth.test.ts comment) — otherwise this
    // just signs a different, still-valid message.
    const tampered = buildInitData().replace(/query_id=[^&]+/, 'query_id=tampered');

    const response = await app.inject({
      headers: { authorization: `tma ${tampered}` },
      method: 'POST',
      url: '/api/session',
    });

    expect(response.statusCode).toBe(401);
  });

  it('a cookie minted by POST /api/session authorizes a follow-up guarded request', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });

    const sessionResponse = await app.inject({
      headers: { authorization: `tma ${buildInitData()}` },
      method: 'POST',
      url: '/api/session',
    });
    const sessionCookie = sessionResponse.cookies.find((cookie) => cookie.name === 'session');
    if (sessionCookie === undefined) {
      throw new Error('expected a session cookie to be set');
    }

    const catalogResponse = await app.inject({
      headers: { cookie: `session=${sessionCookie.value}` },
      method: 'GET',
      url: '/api/catalog',
    });

    expect(catalogResponse.statusCode).toBe(200);
  });
});

describe('favourites', () => {
  it('PUT then GET reflects isFavourite for the user who favourited it, not for others', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });
    const productId = '11111111-1111-4111-8111-111111111111';
    await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'PUT',
      payload: { category: 'Dairy', name: 'Milk' },
      url: `/api/catalog/${productId}`,
    });

    const putResponse = await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'PUT',
      url: `/api/catalog/${productId}/favourite`,
    });
    expect(putResponse.statusCode).toBe(204);

    const asFavouriter = await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'GET',
      url: '/api/catalog',
    });
    expect(asFavouriter.json()).toEqual({
      products: [expect.objectContaining({ isFavourite: true })],
    });

    const asOtherUser = await app.inject({
      headers: { cookie: sessionCookieHeader(OTHER_USER_ID) },
      method: 'GET',
      url: '/api/catalog',
    });
    expect(asOtherUser.json()).toEqual({
      products: [expect.objectContaining({ isFavourite: false })],
    });
  });

  it('DELETE .../favourite unsets it again', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });
    const productId = '11111111-1111-4111-8111-111111111111';
    await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'PUT',
      payload: { category: 'Dairy', name: 'Milk' },
      url: `/api/catalog/${productId}`,
    });
    await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'PUT',
      url: `/api/catalog/${productId}/favourite`,
    });

    const unfavouriteResponse = await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'DELETE',
      url: `/api/catalog/${productId}/favourite`,
    });
    expect(unfavouriteResponse.statusCode).toBe(204);

    const catalogResponse = await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'GET',
      url: '/api/catalog',
    });
    expect(catalogResponse.json()).toEqual({
      products: [expect.objectContaining({ isFavourite: false })],
    });
  });

  it('PUT .../favourite on an unknown product is a 404', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });

    const response = await app.inject({
      headers: { cookie: sessionCookieHeader() },
      method: 'PUT',
      url: '/api/catalog/11111111-1111-4111-8111-111111111111/favourite',
    });

    expect(response.statusCode).toBe(404);
  });

  it('PUT .../favourite without a cookie is rejected', async () => {
    const app = await buildApp({ config: TEST_CONFIG, log: pino({ level: 'silent' }) });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/catalog/11111111-1111-4111-8111-111111111111/favourite',
    });

    expect(response.statusCode).toBe(401);
  });
});
