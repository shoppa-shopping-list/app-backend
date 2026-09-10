import { describe, expect, it } from 'vitest';

import type { Entry, List, Product, ProductId } from '../state/types.js';

import { renderList } from './render.js';

function makeProduct(overrides: { category: string; id: ProductId; name: string }): Product {
  return { createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
}

function makeEntry(overrides: {
  note?: string;
  productId: ProductId;
  quantity: number;
  unit?: string;
}): Entry {
  return {
    addedAt: '2026-01-01T00:00:00.000Z',
    addedBy: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeList(entries: List['entries']): List {
  return { entries, id: 'list-1', memberIds: [], name: 'Shopping list' };
}

function now(): Date {
  return new Date('2026-09-10T14:32:00.000Z');
}

describe('renderList', () => {
  const footer = `updated ${now().toTimeString().slice(0, 5)}`;

  it('groups entries by category then name, and appends the footer', () => {
    const products: Record<ProductId, Product> = {
      apples: makeProduct({ category: 'Produce', id: 'apples', name: 'Apples' }),
      cheese: makeProduct({ category: 'Dairy', id: 'cheese', name: 'Cheese' }),
      milk: makeProduct({ category: 'Dairy', id: 'milk', name: 'Milk' }),
    };
    const list = makeList({
      apples: makeEntry({ productId: 'apples', quantity: 6 }),
      cheese: makeEntry({ productId: 'cheese', quantity: 1, unit: 'pack' }),
      milk: makeEntry({ note: 'whole', productId: 'milk', quantity: 2 }),
    });

    const text = renderList(list, products, now);

    expect(text).toBe(
      `Dairy\n• Cheese — 1 pack\n• Milk — 2 (whole)\n\nProduce\n• Apples — 6\n\n${footer}`,
    );
  });

  it('groups an entry whose product is missing under Unsorted rather than throwing', () => {
    const list = makeList({ ghost: makeEntry({ productId: 'ghost', quantity: 1 }) });

    const text = renderList(list, {}, now);

    expect(text).toBe(`Unsorted\n• ghost — 1\n\n${footer}`);
  });

  it('truncates to 4096 chars with a "… and N more" marker, keeping the footer', () => {
    const products: Record<ProductId, Product> = {};
    const entries: List['entries'] = {};
    for (let i = 0; i < 400; i += 1) {
      const id = `p${String(i)}`;
      products[id] = makeProduct({
        category: 'Bulk',
        id,
        name: `Product number ${String(i)} with a needlessly long name`,
      });
      entries[id] = makeEntry({ productId: id, quantity: 1 });
    }
    const list = makeList(entries);

    const text = renderList(list, products, now);

    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('… and ');
    expect(text.endsWith(footer)).toBe(true);
  });

  it('fits well within 4096 chars for a realistic list (no truncation)', () => {
    const products: Record<ProductId, Product> = {
      milk: makeProduct({ category: 'Dairy', id: 'milk', name: 'Milk' }),
    };
    const list = makeList({ milk: makeEntry({ productId: 'milk', quantity: 2 }) });

    const text = renderList(list, products, now);

    expect(text).not.toContain('… and');
    expect(text.endsWith(footer)).toBe(true);
  });
});
