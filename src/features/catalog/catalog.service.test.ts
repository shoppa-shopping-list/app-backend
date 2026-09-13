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
  it('an upserted product appears in listProducts(), sorted by color then name', () => {
    const bread = randomUUID();
    const milk = randomUUID();
    // Bread's name sorts first alphabetically, but blue ranks after red (PRODUCT_COLORS),
    // so color must win the tiebreak for this to prove sort-by-color-then-name.
    upsertProduct(bread, { color: 'blue', name: 'Bread' });
    upsertProduct(milk, { color: 'red', name: 'Milk' });

    expect(listProducts().map((product) => product.name)).toEqual(['Milk', 'Bread']);
  });

  it('preserves createdAt across a re-PUT (D11), and a re-PUT can change name and color', () => {
    const productId = randomUUID();
    const first = upsertProduct(productId, { color: 'blue', name: 'Milk' });
    const second = upsertProduct(productId, { color: 'green', name: 'Whole Milk' });

    expect(second.createdAt).toBe(first.createdAt);
    expect(second.name).toBe('Whole Milk');
    expect(second.color).toBe('green');
  });

  it('filters by a case-insensitive substring match on name', () => {
    upsertProduct(randomUUID(), { color: 'blue', name: 'Whole Milk' });
    upsertProduct(randomUUID(), { color: 'blue', name: 'Oat Milk' });
    upsertProduct(randomUUID(), { color: 'green', name: 'Bread' });

    expect(listProducts({ name: 'milk' }).map((product) => product.name)).toEqual([
      'Oat Milk',
      'Whole Milk',
    ]);
  });

  it('an unmatched name filter returns an empty list', () => {
    upsertProduct(randomUUID(), { color: 'blue', name: 'Milk' });

    expect(listProducts({ name: 'bread' })).toEqual([]);
  });

  it('an empty or whitespace-only name filter is the same as no filter', () => {
    upsertProduct(randomUUID(), { color: 'blue', name: 'Milk' });

    expect(listProducts({ name: '' }).map((product) => product.name)).toEqual(['Milk']);
    expect(listProducts({ name: ' '.repeat(3) }).map((product) => product.name)).toEqual(['Milk']);
  });
});

describe('deleteProduct', () => {
  it('removes the product and its entry in every list, in one write (D17.2)', () => {
    const productId = randomUUID();
    upsertProduct(productId, { color: 'blue', name: 'Milk' });
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
