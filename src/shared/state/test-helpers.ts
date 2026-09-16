import type { State } from './types.js';

export function emptyState(): State {
  return {
    meta: { viewMessageIds: {} },
    products: {},
    shoppingList: {},
    version: 1,
  };
}
