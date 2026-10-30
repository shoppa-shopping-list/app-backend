import type { ProductId, ShoppingListItem } from '../../shared/state/types.js';
import type { ShoppingListItemView } from './shopping-list.schema.js';

import { ApiError } from '../../shared/api-error.js';
import { activeList, activeListDraft } from '../../shared/state/lists.js';
import { mutate } from '../../shared/state/store.js';
import { compareByColorThenName } from '../../shared/state/types.js';

const ERROR_PRODUCT_NOT_FOUND = 'product_not_found';

// D14: same color-then-name order as catalog's listProducts() — a shared list is
// mostly read in aisle order. A dangling productId is tolerated (skipped) rather than
// thrown on (D17.3) — it should be structurally impossible since deleteProduct
// cascades into the same list's items, but the renderer must not be the thing that breaks.
export function listShoppingListItems(userId: number): ShoppingListItemView[] {
  const list = activeList(userId);
  return Object.entries(list.items)
    .flatMap(([productId, item]) => {
      const product = list.products[productId];
      return product === undefined
        ? []
        : [{ ...item, color: product.color, name: product.name, productId }];
    })
    .toSorted(compareByColorThenName);
}

// PUT, not POST: entries are keyed by productId (D10), so re-adding an already-listed
// product is an idempotent refresh of addedAt/addedBy, never a duplicate. 404 if the
// product doesn't exist in this list's own catalog (D17 defence #1) — checked and written
// with no `await` between, so nothing can delete the product out from under this call.
export function addShoppingListItem(productId: ProductId, addedBy: number): ShoppingListItemView {
  const product = activeList(addedBy).products[productId];
  if (product === undefined) {
    throw new ApiError(404, ERROR_PRODUCT_NOT_FOUND, 'product not found');
  }
  const item: ShoppingListItem = { addedAt: new Date().toISOString(), addedBy };
  mutate((draft) => {
    activeListDraft(draft, addedBy).items[productId] = item;
  });
  return { ...item, color: product.color, name: product.name, productId };
}

// Idempotent: absent is a 0-write no-op (no mutate(), no fsync, no ping), same shape as
// catalog's deleteProduct. Any authenticated user may call this — buying an item isn't
// restricted to whoever added it, and no route in this codebase checks item ownership.
export function removeShoppingListItem(productId: ProductId, userId: number): void {
  if (activeList(userId).items[productId] === undefined) {
    return;
  }
  mutate((draft) => {
    delete activeListDraft(draft, userId).items[productId];
  });
}
