import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Product, State } from '../../shared/state/types.js';

import {
  configureStore,
  installState,
  mutate,
  resetStoreForTests,
} from '../../shared/state/store.js';
import { emptyState } from '../../shared/state/test-helpers.js';
import {
  addShoppingListItem,
  listShoppingListItems,
  removeShoppingListItem,
} from './shopping-list.service.js';

let writeLocalSync: ReturnType<typeof vi.fn<(next: State) => void>>;

beforeEach(() => {
  resetStoreForTests();
  installState(emptyState());
  writeLocalSync = vi.fn<(next: State) => void>();
  configureStore({ writeLocalSync });
});

// Seeds a product directly via mutate() rather than importing catalog's service — the
// no-restricted-imports rule blocks features from reaching into each other (§6.2).
function seedProduct(overrides?: Partial<Product>): Product {
  const product: Product = {
    color: 'blue',
    createdAt: new Date().toISOString(),
    id: randomUUID(),
    name: 'Milk',
    ...overrides,
  };
  mutate((draft) => {
    draft.products[product.id] = product;
  });
  return product;
}

describe('addShoppingListItem / listShoppingListItems', () => {
  it('an added item appears in listShoppingListItems(), joined with the product name/color', () => {
    const product = seedProduct();

    addShoppingListItem(product.id, 1);

    expect(listShoppingListItems()).toEqual([
      {
        addedAt: expect.any(String) as string,
        addedBy: 1,
        color: product.color,
        name: product.name,
        productId: product.id,
      },
    ]);
  });

  it('re-adding an already-listed product refreshes it in place (D10), not a duplicate', () => {
    const product = seedProduct();

    addShoppingListItem(product.id, 1);
    addShoppingListItem(product.id, 2);

    const items = listShoppingListItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.addedBy).toBe(2);
  });

  it('adding an unknown product throws a 404', () => {
    expect(() => addShoppingListItem(randomUUID(), 1)).toThrow('product not found');
  });

  it('sorts by color then name (D14), same as the catalog', () => {
    const bread = seedProduct({ color: 'blue', name: 'Bread' });
    const milk = seedProduct({ color: 'red', name: 'Milk' });

    addShoppingListItem(bread.id, 1);
    addShoppingListItem(milk.id, 1);

    expect(listShoppingListItems().map((item) => item.name)).toEqual(['Milk', 'Bread']);
  });
});

describe('removeShoppingListItem', () => {
  it('removes the item', () => {
    const product = seedProduct();
    addShoppingListItem(product.id, 1);
    writeLocalSync.mockClear();

    removeShoppingListItem(product.id);

    expect(listShoppingListItems()).toEqual([]);
    expect(writeLocalSync).toHaveBeenCalledTimes(1);
  });

  it('removing an item not on the list is a 0-write no-op', () => {
    removeShoppingListItem(randomUUID());

    expect(writeLocalSync).not.toHaveBeenCalled();
  });
});
