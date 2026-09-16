import { z } from 'zod';

import {
  productColorSchema,
  productIdSchema,
  shoppingListItemSchema,
} from '../../shared/state/types.js';

export const shoppingListItemParamsSchema = z.object({ productId: productIdSchema });

// productId/name/color are joined from `products` at read time (D27), never stored on
// the item itself.
export const shoppingListItemViewSchema = shoppingListItemSchema.extend({
  color: productColorSchema,
  name: z.string(),
  productId: productIdSchema,
});
export type ShoppingListItemView = z.infer<typeof shoppingListItemViewSchema>;

export const shoppingListResponseSchema = z.object({
  items: z.array(shoppingListItemViewSchema),
});
