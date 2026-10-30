import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { migrate, UnknownStateVersionError } from './migrate.js';
import { emptyState } from './test-helpers.js';
import { CURRENT_VERSION, DEFAULT_LIST_ID, DEFAULT_LIST_NAME } from './types.js';

function validV1(): Record<string, unknown> {
  return {
    meta: { viewMessageIds: {} },
    products: {},
    shoppingList: {},
    version: 1,
  };
}

describe('migrate', () => {
  it('parses a valid current-version state', () => {
    const state = migrate(emptyState());
    expect(state.version).toBe(CURRENT_VERSION);
  });

  it('throws UnknownStateVersionError on an unknown version, with the version in the message', () => {
    expect(() => migrate({ ...validV1(), version: 99 })).toThrow(UnknownStateVersionError);
    expect(() => migrate({ ...validV1(), version: 99 })).toThrow(/99/);
  });

  it('throws on a missing version', () => {
    const raw = validV1();
    delete raw['version'];
    expect(() => migrate(raw)).toThrow(UnknownStateVersionError);
  });

  it('throws on a structurally invalid version 1 state', () => {
    expect(() => migrate({ products: {}, version: 1 })).toThrow();
  });

  it('v1 -> v2 moves the catalog and the list into the default list, losing nothing', () => {
    const productId = randomUUID();
    const state = migrate({
      meta: { snapshotMessageId: 7, viewMessageIds: { '42': 5 } },
      products: {
        [productId]: {
          color: 'blue',
          createdAt: '2026-01-01T00:00:00.000Z',
          favouritedBy: [1],
          id: productId,
          name: 'Milk',
        },
      },
      shoppingList: { [productId]: { addedAt: '2026-01-02T00:00:00.000Z', addedBy: 1 } },
      version: 1,
    });

    expect(state.version).toBe(CURRENT_VERSION);
    expect(state.meta).toEqual({ snapshotMessageId: 7, viewMessageIds: { '42': 5 } });
    // Sparse on purpose: nobody is travelling yet, so every user resolves to the default.
    expect(state.activeListByUser).toEqual({});
    expect(Object.keys(state.lists)).toEqual([DEFAULT_LIST_ID]);

    const list = state.lists[DEFAULT_LIST_ID];
    expect(list?.name).toBe(DEFAULT_LIST_NAME);
    expect(list?.products[productId]?.favouritedBy).toEqual([1]);
    expect(list?.products[productId]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(list?.items[productId]?.addedBy).toBe(1);
  });

  it('is idempotent in effect: re-running it on its own output is a no-op', () => {
    const once = migrate(validV1());
    expect(migrate(structuredClone(once))).toEqual(once);
  });
});
