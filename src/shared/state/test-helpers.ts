import type { State } from './types.js';

import { emptyList } from './lists.js';
import { CURRENT_VERSION, DEFAULT_LIST_ID, DEFAULT_LIST_NAME } from './types.js';

export function emptyState(): State {
  return {
    activeListByUser: {},
    lists: { [DEFAULT_LIST_ID]: emptyList(DEFAULT_LIST_ID, DEFAULT_LIST_NAME) },
    meta: { viewMessageIds: {} },
    version: CURRENT_VERSION,
  };
}
