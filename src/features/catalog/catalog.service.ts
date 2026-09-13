import type { DeepReadonly } from '../../shared/state/store.js';
import type { Product, ProductId } from '../../shared/state/types.js';
import type { CatalogProduct, ProductUpsertInput } from './catalog.schema.js';

import { ApiError } from '../../shared/api-error.js';
import { getState, mutate } from '../../shared/state/store.js';

// Idempotent: absent is a 0-write no-op (no mutate(), no fsync, no ping) so a repeated
// DELETE costs nothing (D7: each mutate() is 10-50ms on SD).
export function deleteProduct(productId: ProductId): void {
  if (getState().products[productId] === undefined) {
    return;
  }

  mutate((draft) => {
    // Re-check inside the mutation (D17 defence #2): delete entries first, then the
    // product, in one clone-and-swap — never an instant, and never a durable state on
    // disk, where an entry points at a deleted product.
    if (draft.products[productId] === undefined) {
      return;
    }
    for (const list of Object.values(draft.lists)) {
      delete list.entries[productId];
    }
    delete draft.products[productId];
  });
}

// D14: sort by category then name — concurrent reordering becomes structurally impossible.
export function listProducts(userId: number): CatalogProduct[] {
  return Object.values(getState().products)
    .map((product) => toCatalogProduct(product, userId))
    .toSorted((a, b) => {
      const categoryDiff = a.category.localeCompare(b.category);
      return categoryDiff === 0 ? a.name.localeCompare(b.name) : categoryDiff;
    });
}

function toCatalogProduct(product: DeepReadonly<Product>, userId: number): CatalogProduct {
  const { favouritedBy, ...rest } = product;
  return { ...rest, isFavourite: favouritedBy.includes(userId) };
}

// PUT, not POST: the client-supplied UUID makes create and edit the same call, and a retry
// a true no-op — createdAt is preserved on re-PUT (D11). Always 200, never 201-on-create.
export function upsertProduct(productId: ProductId, input: ProductUpsertInput): Product {
  return mutate((draft) => {
    const existing = draft.products[productId];
    const product: Product = {
      category: input.category,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      favouritedBy: existing?.favouritedBy ?? [],
      id: productId,
      name: input.name,
      ...(input.defaultUnit !== undefined && { defaultUnit: input.defaultUnit }),
    };
    draft.products[productId] = product;
    return { ...product };
  });
}

// Idempotent like deleteProduct (D7): already-favourited is a 0-write no-op. Unlike
// upsertProduct, this never creates a product — favouriting one that doesn't exist is a
// client error, not an implicit create.
export function setFavourite(productId: ProductId, userId: number): void {
  const product = requireProduct(productId);
  if (product.favouritedBy.includes(userId)) {
    return;
  }

  mutate((draft) => {
    const target = draft.products[productId];
    if (target !== undefined) {
      target.favouritedBy = [...target.favouritedBy, userId];
    }
  });
}

function requireProduct(productId: ProductId): DeepReadonly<Product> {
  const product = getState().products[productId];
  if (product === undefined) {
    throw new ApiError(404, 'product_not_found', `no product with id ${productId}`);
  }
  return product;
}

// Idempotent like deleteProduct (D7): a missing product or one that isn't favourited by
// this user is a 0-write no-op.
export function unsetFavourite(productId: ProductId, userId: number): void {
  const product = getState().products[productId];
  if (product?.favouritedBy.includes(userId) !== true) {
    return;
  }

  mutate((draft) => {
    const target = draft.products[productId];
    if (target !== undefined) {
      target.favouritedBy = target.favouritedBy.filter((id) => id !== userId);
    }
  });
}
