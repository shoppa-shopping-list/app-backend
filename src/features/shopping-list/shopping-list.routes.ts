import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { z } from 'zod';

import { requireUser } from '../../shared/auth.js';
import {
  shoppingListItemParamsSchema,
  shoppingListItemViewSchema,
  shoppingListResponseSchema,
} from './shopping-list.schema.js';
import {
  addShoppingListItem,
  listShoppingListItems,
  removeShoppingListItem,
} from './shopping-list.service.js';

// No slice work is async yet — the outer plugin function stays `async` only because
// FastifyPluginAsyncZod's type requires a Promise<void> return.
// eslint-disable-next-line @typescript-eslint/require-await -- see comment above
export const shoppingListRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/shopping-list', { schema: { response: { 200: shoppingListResponseSchema } } }, () => ({
    items: listShoppingListItems(),
  }));

  app.put(
    '/shopping-list/:productId',
    {
      schema: {
        params: shoppingListItemParamsSchema,
        response: { 200: shoppingListItemViewSchema },
      },
    },
    (request) => addShoppingListItem(request.params.productId, requireUser(request).id),
  );

  app.delete(
    '/shopping-list/:productId',
    { schema: { params: shoppingListItemParamsSchema, response: { 204: z.void() } } },
    (request, reply) => {
      removeShoppingListItem(request.params.productId);
      reply.code(204).send();
    },
  );
};
