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
import { deleteProduct, listProducts, upsertProduct } from './catalog.service.js';

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

    expect(listProducts().map((product) => product.name)).toEqual(['Bread', 'Milk']);
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

    expect(listProducts()).toEqual([]);
    expect(writeLocalSync).toHaveBeenCalledTimes(1);
    const [written] = writeLocalSync.mock.calls.at(-1) as [State];
    expect(written.lists['list-1']?.entries[productId]).toBeUndefined();
  });

  it('deleting an unknown id is a 0-write no-op', () => {
    deleteProduct(randomUUID());
    expect(writeLocalSync).not.toHaveBeenCalled();
  });
});
