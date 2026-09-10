import type { Logger } from 'pino';

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

import { errorHandler } from './shared/error-handler.js';
import { catalogRoutes } from './slices/catalog/catalog.routes.js';
import { createEventsHub, eventsRoutes } from './slices/events/events.routes.js';

export interface BuildAppOptions {
  // Accepted for parity with the index.ts composition wiring; nothing reads it yet.
  config: Config;
  log: Logger;
}

// Never hydrates state — that's index.ts's job. Lets openapi.ts and app.inject() tests
// run with no data/state.json.
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
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

  // Slices register under ONE /api scope: that scope is where the auth preHandler goes later.
  await app.register(
    async (api) => {
      await api.register(catalogRoutes);
      await api.register(eventsRoutes);
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
