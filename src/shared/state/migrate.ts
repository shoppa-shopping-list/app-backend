import { z } from 'zod';

import {
  CURRENT_VERSION,
  DEFAULT_LIST_ID,
  DEFAULT_LIST_NAME,
  metaSchema,
  productIdSchema,
  productSchema,
  shoppingListItemSchema,
  type State,
  stateSchema,
} from './types.js';

export class UnknownStateVersionError extends Error {
  version: unknown;

  constructor(version: unknown) {
    super(`Unknown state version: ${String(version)}`);
    this.name = 'UnknownStateVersionError';
    this.version = version;
  }
}

// THROWS on anything but a known version, and on a structurally invalid state — a rollback
// must never serve a wrong shape and write it back (D6, §3.1).
export function migrate(raw: unknown): State {
  const version = extractVersion(raw);

  switch (version) {
    case 1: {
      return stateSchema.parse(fromV1(raw));
    }
    case CURRENT_VERSION: {
      return stateSchema.parse(raw);
    }
    default: {
      throw new UnknownStateVersionError(version);
    }
  }
}

function extractVersion(raw: unknown): unknown {
  if (raw !== null && typeof raw === 'object' && 'version' in raw) {
    return raw.version;
  }
  return undefined;
}

// v1 -> v2 (D31): the one shared catalog and the one flat shopping list become the contents
// of a single list named Home, under a constant id. Nothing is dropped, renamed or re-keyed
// — `products` (favouritedBy included) and `shoppingList` move one level down and gain a
// parent. Validated against v1's own schema first so a malformed v1 file fails here rather
// than producing a half-shaped v2 that stateSchema then rejects with a confusing message.
function fromV1(raw: unknown): unknown {
  const v1 = v1StateSchema.parse(raw);
  return {
    activeListByUser: {},
    lists: {
      [DEFAULT_LIST_ID]: {
        createdAt: new Date().toISOString(),
        id: DEFAULT_LIST_ID,
        items: v1.shoppingList,
        name: DEFAULT_LIST_NAME,
        products: v1.products,
      },
    },
    meta: v1.meta,
    version: CURRENT_VERSION,
  };
}

const v1StateSchema = z.object({
  meta: metaSchema,
  products: z.record(productIdSchema, productSchema),
  shoppingList: z.record(productIdSchema, shoppingListItemSchema).default({}),
  version: z.literal(1),
});
