import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { z } from 'zod';

import { requireUser } from '../../shared/auth.js';
import {
  catalogResponseSchema,
  productParamsSchema,
  productResponseSchema,
  productUpsertBodySchema,
} from './catalog.schema.js';
import {
  deleteProduct,
  listProducts,
  setFavourite,
  unsetFavourite,
  upsertProduct,
} from './catalog.service.js';

// No slice work is async yet — the outer plugin function stays `async` only because
// FastifyPluginAsyncZod's type requires a Promise<void> return.
// eslint-disable-next-line @typescript-eslint/require-await -- see comment above
export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/catalog', { schema: { response: { 200: catalogResponseSchema } } }, (request) => ({
    products: listProducts(requireUser(request).id),
  }));

  app.put(
    '/catalog/:productId',
    {
      schema: {
        body: productUpsertBodySchema,
        params: productParamsSchema,
        response: { 200: productResponseSchema },
      },
    },
    (request) => upsertProduct(request.params.productId, request.body),
  );

  app.delete(
    '/catalog/:productId',
    { schema: { params: productParamsSchema, response: { 204: z.void() } } },
    (request, reply) => {
      deleteProduct(request.params.productId);
      reply.code(204).send();
    },
  );

  app.put(
    '/catalog/:productId/favourite',
    { schema: { params: productParamsSchema, response: { 204: z.void() } } },
    (request, reply) => {
      setFavourite(request.params.productId, requireUser(request).id);
      reply.code(204).send();
    },
  );

  app.delete(
    '/catalog/:productId/favourite',
    { schema: { params: productParamsSchema, response: { 204: z.void() } } },
    (request, reply) => {
      unsetFavourite(request.params.productId, requireUser(request).id);
      reply.code(204).send();
    },
  );
};
