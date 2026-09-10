import type { State } from './types.js';

export function emptyState(): State {
  return {
    lists: {},
    meta: { viewMessageIds: {} },
    products: {},
    version: 1,
  };
}
