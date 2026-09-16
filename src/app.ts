import type { Logger } from 'pino';

import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import path from 'node:path';

import type { Config } from './config.js';

import { catalogRoutes } from './features/catalog/catalog.routes.js';
import { createEventsHub, eventsRoutes } from './features/events/events.routes.js';
import { createSessionRoutes } from './features/session/session.routes.js';
import { shoppingListRoutes } from './features/shopping-list/shopping-list.routes.js';
import { createAuthPreHandler } from './shared/auth.js';
import { errorHandler } from './shared/error-handler.js';

export interface BuildAppOptions {
  config: Config;
  log: Logger;
}

// Never hydrates state — that's index.ts's job. Lets openapi.ts and app.inject() tests
// run with no data/state.json.
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({
    forceCloseConnections: true,
    // The cast below looks unneeded at this call site, but without it TS infers
    // FastifyInstance's logger generic as pino's concrete Logger instead of
    // FastifyBaseLogger, which then fails to assign to the FastifyInstance return type
    // below (exactOptionalPropertyTypes + a getter-only `msgPrefix` mismatch).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- see above
    loggerInstance: options.log as FastifyBaseLogger,
  });

  // Compilers must be set before any route is registered.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySwagger, {
    openapi: { info: { title: 'Shoppa API', version: '0.1.0' }, servers: [{ url: '/' }] },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  app.decorate('events', createEventsHub());

  // POST /api/session is the one unauthenticated route (§5); every other /api route
  // sits in the sibling "guarded" scope below, behind its own preHandler — Fastify
  // encapsulation does the exemption, so there's no path allowlist to keep in sync (D16).
  await app.register(
    async (api) => {
      await api.register(fastifyCookie);
      await api.register(createSessionRoutes(config));

      await api.register(async (guarded) => {
        guarded.addHook('preHandler', createAuthPreHandler(config.sessionSecret));
        await guarded.register(catalogRoutes);
        await guarded.register(eventsRoutes);
        await guarded.register(shoppingListRoutes);
      });
    },
    { prefix: '/api' },
  );

  await app.register(fastifyStatic, {
    root: path.resolve(import.meta.dirname, '../public'),
  });

  // Landmine 6: the SPA fallback must not swallow an /api typo as index.html.
  app.setNotFoundHandler((request, reply): void => {
    if (request.url.startsWith('/api')) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      reply.sendFile('index.html');
      return;
    }
    reply.code(404).send({ error: 'not_found' });
  });

  app.setErrorHandler(errorHandler);

  return app;
}
