import { z } from 'zod';

import { productIdSchema, productSchema } from '../../shared/state/types.js';

export { productSchema } from '../../shared/state/types.js';

export const productParamsSchema = z.object({ productId: productIdSchema });

// No `id` in the body at all, so the client can't send an id that disagrees with the path
// param — there's no mismatch to validate (D11).
export const productUpsertBodySchema = productSchema.omit({ createdAt: true, id: true }).strict();
export type ProductUpsertInput = z.infer<typeof productUpsertBodySchema>;

export const catalogResponseSchema = z.object({ products: z.array(productSchema) });
