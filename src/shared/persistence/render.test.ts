import { describe, expect, it } from 'vitest';

import type { Product, ProductColor, ProductId, ShoppingListItem } from '../state/types.js';

import { renderList } from './render.js';

function makeProduct(overrides: { color: ProductColor; id: ProductId; name: string }): Product {
  return { createdAt: '2026-01-01T00:00:00.000Z', favouritedBy: [], ...overrides };
}

function makeItem(): ShoppingListItem {
  return { addedAt: '2026-01-01T00:00:00.000Z', addedBy: 1 };
}

function now(): Date {
  return new Date('2026-09-10T14:32:00.000Z');
}

describe('renderList', () => {
  const footer = `updated ${now().toTimeString().slice(0, 5)}`;

  it('groups items by color then name, and appends the footer', () => {
    const products: Record<ProductId, Product> = {
      apples: makeProduct({ color: 'green', id: 'apples', name: 'Apples' }),
      cheese: makeProduct({ color: 'blue', id: 'cheese', name: 'Cheese' }),
      milk: makeProduct({ color: 'blue', id: 'milk', name: 'Milk' }),
    };
    const shoppingList: Record<ProductId, ShoppingListItem> = {
      apples: makeItem(),
      cheese: makeItem(),
      milk: makeItem(),
    };

    const text = renderList(shoppingList, products, now);

    // green ranks before blue in PRODUCT_COLORS, so its group heads the list even
    // though "Apples" sorts after "Cheese"/"Milk" alphabetically.
    expect(text).toBe(`🟢 Green\n• Apples\n\n🔵 Blue\n• Cheese\n• Milk\n\n${footer}`);
  });

  it('groups products with no color under "No color", ranked after every real color', () => {
    const products: Record<ProductId, Product> = {
      milk: makeProduct({ color: 'none', id: 'milk', name: 'Milk' }),
      salt: makeProduct({ color: 'red', id: 'salt', name: 'Salt' }),
    };
    const shoppingList: Record<ProductId, ShoppingListItem> = {
      milk: makeItem(),
      salt: makeItem(),
    };

    const text = renderList(shoppingList, products, now);

    expect(text).toBe(`🔴 Red\n• Salt\n\nNo color\n• Milk\n\n${footer}`);
  });

  it('groups an item whose product is missing under Unsorted rather than throwing', () => {
    const shoppingList: Record<ProductId, ShoppingListItem> = { ghost: makeItem() };

    const text = renderList(shoppingList, {}, now);

    expect(text).toBe(`Unsorted\n• ghost\n\n${footer}`);
  });

  it('truncates to 4096 chars with a "… and N more" marker, keeping the footer', () => {
    const products: Record<ProductId, Product> = {};
    const shoppingList: Record<ProductId, ShoppingListItem> = {};
    for (let i = 0; i < 400; i += 1) {
      const id = `p${String(i)}`;
      products[id] = makeProduct({
        color: 'blue',
        id,
        name: `Product number ${String(i)} with a needlessly long name`,
      });
      shoppingList[id] = makeItem();
    }

    const text = renderList(shoppingList, products, now);

    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text).toContain('… and ');
    expect(text.endsWith(footer)).toBe(true);
  });

  it('fits well within 4096 chars for a realistic list (no truncation)', () => {
    const products: Record<ProductId, Product> = {
      milk: makeProduct({ color: 'blue', id: 'milk', name: 'Milk' }),
    };
    const shoppingList: Record<ProductId, ShoppingListItem> = { milk: makeItem() };

    const text = renderList(shoppingList, products, now);

    expect(text).not.toContain('… and');
    expect(text.endsWith(footer)).toBe(true);
  });
});
