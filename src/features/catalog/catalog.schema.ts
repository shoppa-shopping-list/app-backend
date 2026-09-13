import { z } from 'zod';

import { productIdSchema, productSchema } from '../../shared/state/types.js';

export const productParamsSchema = z.object({ productId: productIdSchema });

// No `id` in the body at all, so the client can't send an id that disagrees with the path
// param — there's no mismatch to validate (D11). favouritedBy is excluded too: it's only
// ever changed via the favourite/unfavourite endpoints, never overwritten by a product edit.
export const productUpsertBodySchema = productSchema
  .omit({ createdAt: true, favouritedBy: true, id: true })
  .strict();
export type ProductUpsertInput = z.infer<typeof productUpsertBodySchema>;

// favouritedBy is every user's id who favourited the product — never echoed back as-is,
// not even to the product's own editor.
export const productResponseSchema = productSchema.omit({ favouritedBy: true });

// GET /catalog's DTO: favouritedBy collapses into a single isFavourite flag scoped to the
// requesting user.
export const catalogProductSchema = productResponseSchema.extend({ isFavourite: z.boolean() });
export type CatalogProduct = z.infer<typeof catalogProductSchema>;

export const catalogResponseSchema = z.object({ products: z.array(catalogProductSchema) });
