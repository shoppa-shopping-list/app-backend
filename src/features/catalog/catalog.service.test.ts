import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { State } from '../../shared/state/types.js';

import {
  configureStore,
  installState,
  mutate,
  resetStoreForTests,
} from '../../shared/state/store.js';
import { emptyState } from '../../shared/state/test-helpers.js';
import {
  deleteProduct,
  listProducts,
  setFavourite,
  unsetFavourite,
  upsertProduct,
} from './catalog.service.js';

const USER_ID = 1;
const OTHER_USER_ID = 2;

let writeLocalSync: ReturnType<typeof vi.fn<(next: State) => void>>;

beforeEach(() => {
  resetStoreForTests();
  installState(emptyState());
  writeLocalSync = vi.fn<(next: State) => void>();
  configureStore({ writeLocalSync });
});

describe('upsertProduct / listProducts', () => {
  it('an upserted product appears in listProducts(), sorted by category then name', () => {
    const bread = randomUUID();
    const milk = randomUUID();
    upsertProduct(bread, { category: 'Bakery', name: 'Bread' });
    upsertProduct(milk, { category: 'Dairy', name: 'Milk' });

    expect(listProducts(USER_ID).map((product) => product.name)).toEqual(['Bread', 'Milk']);
  });

  it('isFavourite is false for a product no one has favourited', () => {
    const productId = randomUUID();
    upsertProduct(productId, { category: 'Dairy', name: 'Milk' });

    expect(listProducts(USER_ID)).toEqual([expect.objectContaining({ isFavourite: false })]);
  });

  it('never echoes favouritedBy back in the catalog DTO', () => {
    const productId = randomUUID();
    upsertProduct(productId, { category: 'Dairy', name: 'Milk' });
    setFavourite(productId, USER_ID);

    expect(listProducts(USER_ID)[0]).not.toHaveProperty('favouritedBy');
  });

  it('preserves createdAt across a re-PUT (D11)', () => {
    const productId = randomUUID();
    const first = upsertProduct(productId, { category: 'Dairy', name: 'Milk' });
    const second = upsertProduct(productId, { category: 'Dairy', name: 'Whole Milk' });

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.name).toBe('Whole Milk');
  });
});

describe('deleteProduct', () => {
  it('removes the product and its entry in every list, in one write (D17.2)', () => {
    const productId = randomUUID();
    upsertProduct(productId, { category: 'Dairy', name: 'Milk' });
    mutate((draft) => {
      draft.lists['list-1'] = {
        entries: {
          [productId]: {
            addedAt: new Date().toISOString(),
            addedBy: 1,
            productId,
            quantity: 1,
            updatedAt: new Date().toISOString(),
          },
        },
        id: 'list-1',
        memberIds: [],
        name: 'Groceries',
      };
    });
    writeLocalSync.mockClear();

    deleteProduct(productId);

    expect(listProducts(USER_ID)).toEqual([]);
    expect(writeLocalSync).toHaveBeenCalledTimes(1);
    const [written] = writeLocalSync.mock.calls.at(-1) as [State];
    expect(written.lists['list-1']?.entries[productId]).toBeUndefined();
  });

  it('deleting an unknown id is a 0-write no-op', () => {
    deleteProduct(randomUUID());
    expect(writeLocalSync).not.toHaveBeenCalled();
  });

  it('deleting a product drops its favourites too — no orphan cleanup needed', () => {
    const productId = randomUUID();
    upsertProduct(productId, { category: 'Dairy', name: 'Milk' });
    setFavourite(productId, USER_ID);

    deleteProduct(productId);

    expect(listProducts(USER_ID)).toEqual([]);
  });
});

describe('setFavourite / unsetFavourite', () => {
  it('marks a product as favourite for that user only', () => {
    const productId = randomUUID();
    upsertProduct(productId, { category: 'Dairy', name: 'Milk' });

    setFavourite(productId, USER_ID);

    const [product] = listProducts(USER_ID);
    expect(product).toMatchObject({ isFavourite: true });
    const [asOtherUser] = listProducts(OTHER_USER_ID);
    expect(asOtherUser).toMatchObject({ isFavourite: false });
  });

  it('setting favourite on an unknown product throws (product_not_found)', () => {
    expect(() => setFavourite(randomUUID(), USER_ID)).toThrow(/no product with id/);
  });

  it('re-favouriting an already-favourited product is a 0-write no-op (D7)', () => {
    const productId = randomUUID();
    upsertProduct(productId, { category: 'Dairy', name: 'Milk' });
    setFavourite(productId, USER_ID);
    writeLocalSync.mockClear();

    setFavourite(productId, USER_ID);

    expect(writeLocalSync).not.toHaveBeenCalled();
  });

  it('unsetFavourite removes the flag for that user only', () => {
    const productId = randomUUID();
    upsertProduct(productId, { category: 'Dairy', name: 'Milk' });
    setFavourite(productId, USER_ID);
    setFavourite(productId, OTHER_USER_ID);

    unsetFavourite(productId, USER_ID);

    const [product] = listProducts(USER_ID);
    expect(product).toMatchObject({ isFavourite: false });
    const [asOtherUser] = listProducts(OTHER_USER_ID);
    expect(asOtherUser).toMatchObject({ isFavourite: true });
  });

  it('unsetting a non-favourite is a 0-write no-op (D7)', () => {
    const productId = randomUUID();
    upsertProduct(productId, { category: 'Dairy', name: 'Milk' });
    writeLocalSync.mockClear();

    unsetFavourite(productId, USER_ID);

    expect(writeLocalSync).not.toHaveBeenCalled();
  });

  it('unsetting favourite on an unknown product is a 0-write no-op', () => {
    unsetFavourite(randomUUID(), USER_ID);
    expect(writeLocalSync).not.toHaveBeenCalled();
  });
});
