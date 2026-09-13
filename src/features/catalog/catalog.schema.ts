import { z } from 'zod';

import { productIdSchema, productSchema } from '../../shared/state/types.js';

export { productSchema } from '../../shared/state/types.js';

export const productParamsSchema = z.object({ productId: productIdSchema });

// No `id` in the body at all, so the client can't send an id that disagrees with the path
// param — there's no mismatch to validate (D11).
export const productUpsertBodySchema = productSchema.omit({ createdAt: true, id: true }).strict();
export type ProductUpsertInput = z.infer<typeof productUpsertBodySchema>;

export const catalogResponseSchema = z.object({ products: z.array(productSchema) });

// No `.min(1)`: an empty/whitespace-only `name` means "no filter", handled in
// listProducts() rather than rejected here — a search box that's been cleared sends
// exactly that. `.strict()` so a mistyped key (`?nmae=`) is a 400, not silently ignored
// (matches productUpsertBodySchema's `.strict()` above).
export const catalogQuerySchema = z
  .object({ name: z.string().trim().max(120).optional() })
  .strict();
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
