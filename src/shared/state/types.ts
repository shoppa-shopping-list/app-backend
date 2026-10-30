import { z } from 'zod';

export const CURRENT_VERSION = 2;

// D11: a UUID keeps arbitrary strings out of the Record keyspace.
export const productIdSchema = z.uuid();
export type ProductId = z.infer<typeof productIdSchema>;

// Lists get the same treatment as products, for the same reason (D11's keyspace argument):
// a human slug like 'home' would read nicer in a URL but makes a rename an identity change.
export const listIdSchema = z.uuid();
export type ListId = z.infer<typeof listIdSchema>;

// A constant, never randomUUID(): the local file and the Telegram snapshot migrate
// independently on different boots, and a random id would hand a recovery boot a different
// list identity than the one the clients are holding (D31). Every unset pointer resolves
// here, which is why the non-travelling user never has to switch anything (D29).
export const DEFAULT_LIST_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_LIST_NAME = 'Home';

// Canonical order doubles as display/group rank (D14) — deliberate, not alphabetical,
// so 'none' sits predictably last instead of wherever it falls in string sort.
export const PRODUCT_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'brown',
  'black',
  'white',
  'none',
] as const;
export const productColorSchema = z.enum(PRODUCT_COLORS).default('none');
export type ProductColor = z.infer<typeof productColorSchema>;

// D14: sort by color rank, then name — shared by catalog's listProducts() and
// shopping-list's listShoppingListItems() so the ordering rule lives in one place.
export function compareByColorThenName(
  a: { color: ProductColor; name: string },
  b: { color: ProductColor; name: string },
): number {
  const colorDiff = PRODUCT_COLORS.indexOf(a.color) - PRODUCT_COLORS.indexOf(b.color);
  return colorDiff === 0 ? a.name.localeCompare(b.name) : colorDiff;
}

export const productSchema = z.object({
  color: productColorSchema,
  createdAt: z.iso.datetime(),
  defaultUnit: z.string().trim().min(1).max(16).optional(),
  favouritedBy: z.array(z.number()), // Telegram user ids who have favourited this product
  id: productIdSchema,
  name: z.string().trim().min(1).max(120),
});
export type Product = z.infer<typeof productSchema>;

// D27: one flat, shared shopping list — no separate item id, keyed by productId
// (D10), so a product is on the list at most once and a re-PUT is an idempotent
// refresh. name/color are joined from `products` at read time, never copied here
// (D27) — a catalog rename/recolor should show up everywhere, and copying would leave
// `deleteProduct`'s cascade (D17) removing an orphaned duplicate instead of a pointer.
export const shoppingListItemSchema = z.object({
  addedAt: z.iso.datetime(),
  addedBy: z.number(),
});
export type ShoppingListItem = z.infer<typeof shoppingListItemSchema>;

export const metaSchema = z.object({
  snapshotMessageId: z.number().optional(), // required to WRITE the snapshot (D4)
  // Keyed by stringified chat_id — §4 never specifies the key shape; recorded as a decision.
  viewMessageIds: z.record(z.string(), z.number()),
});

// D28/D33: the list is the tenant. Both of v1's top-level domain records — the catalog and
// the flat shopping list — live inside it, so a product belongs to exactly one list and a
// cross-list dangling reference is structurally impossible (which is what keeps
// deleteProduct's D17 cascade local instead of a sweep over every list).
export const shoppingListSchema = z.object({
  createdAt: z.iso.datetime(),
  id: listIdSchema,
  items: z.record(productIdSchema, shoppingListItemSchema).default({}),
  name: z.string().trim().min(1).max(60),
  products: z.record(productIdSchema, productSchema).default({}),
});
export type ShoppingList = z.infer<typeof shoppingListSchema>;

export const stateSchema = z.object({
  // Keyed by stringified Telegram user id, matching meta.viewMessageIds' convention.
  // Sparse on purpose (D29): a user with no entry is on DEFAULT_LIST_ID, so only the
  // travelling one ever gets a row here.
  activeListByUser: z.record(z.string(), listIdSchema).default({}),
  lists: z.record(listIdSchema, shoppingListSchema),
  meta: metaSchema,
  version: z.literal(CURRENT_VERSION),
});
export type State = z.infer<typeof stateSchema>;
