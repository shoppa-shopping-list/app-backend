import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { z } from 'zod';

import {
  catalogQuerySchema,
  catalogResponseSchema,
  productParamsSchema,
  productSchema,
  productUpsertBodySchema,
} from './catalog.schema.js';
import { deleteProduct, listProducts, upsertProduct } from './catalog.service.js';

// No slice work is async yet — the outer plugin function stays `async` only because
// FastifyPluginAsyncZod's type requires a Promise<void> return.
// eslint-disable-next-line @typescript-eslint/require-await -- see comment above
export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/catalog',
    { schema: { querystring: catalogQuerySchema, response: { 200: catalogResponseSchema } } },
    (request) => ({ products: listProducts(request.query) }),
  );

  app.put(
    '/catalog/:productId',
    {
      schema: {
        body: productUpsertBodySchema,
        params: productParamsSchema,
        response: { 200: productSchema },
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
};
