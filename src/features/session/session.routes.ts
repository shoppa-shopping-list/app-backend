import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { z } from 'zod';

import type { Config } from '../../config.js';

import { ApiError } from '../../shared/api-error.js';
import {
  createSessionCookie,
  requireConfigured,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  validateInitData,
} from '../../shared/auth.js';
import { sessionHeadersSchema } from './session.schema.js';

const INIT_DATA_PREFIX = 'tma ';

export function createSessionRoutes(config: Config): FastifyPluginAsyncZod {
  // No slice work is async yet — the outer plugin function stays `async` only because
  // FastifyPluginAsyncZod's type requires a Promise<void> return (matches events.routes.ts).
  // eslint-disable-next-line @typescript-eslint/require-await -- see comment above
  return async (app) => {
    app.post(
      '/session',
      { schema: { headers: sessionHeadersSchema, response: { 204: z.void() } } },
      (request, reply) => {
        const { authorization } = request.headers;
        if (!authorization.startsWith(INIT_DATA_PREFIX)) {
          throw new ApiError(
            401,
            'invalid_init_data',
            `Authorization must start with "${INIT_DATA_PREFIX}"`,
          );
        }

        const botToken = requireConfigured(config.botToken, 'BOT_TOKEN');
        const allowedUserIds = requireConfigured(config.allowedUserIds, 'ALLOWED_USER_IDS');
        const sessionSecret = requireConfigured(config.sessionSecret, 'SESSION_SECRET');

        const initData = authorization.slice(INIT_DATA_PREFIX.length);
        const user = validateInitData(initData, botToken, allowedUserIds);
        const cookie = createSessionCookie(user.id, sessionSecret, Date.now());

        reply
          .setCookie(SESSION_COOKIE_NAME, cookie, {
            httpOnly: true,
            maxAge: SESSION_TTL_MS / 1000,
            path: '/',
            sameSite: 'lax',
            // Secure in production (deployed behind nginx HTTPS per D19, and
            // deploy/shoppa-backend.service pins NODE_ENV=production) — off in
            // development/test, where the server has no TLS and a Secure cookie would be
            // silently dropped by any real client, breaking the local handshake entirely.
            secure: config.nodeEnv === 'production',
          })
          .code(204)
          .send();
      },
    );
  };
}
