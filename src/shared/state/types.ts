import { z } from 'zod';

export const CURRENT_VERSION = 1;

// D11: a UUID keeps arbitrary strings out of the Record keyspace.
export const productIdSchema = z.uuid();
export type ProductId = z.infer<typeof productIdSchema>;

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

const metaSchema = z.object({
  snapshotMessageId: z.number().optional(), // required to WRITE the snapshot (D4)
  // Keyed by stringified chat_id — §4 never specifies the key shape; recorded as a decision.
  viewMessageIds: z.record(z.string(), z.number()),
});

export const stateSchema = z.object({
  meta: metaSchema,
  products: z.record(productIdSchema, productSchema),
  // .default({}): lets an old data/state.json (no `shoppingList` key yet) still parse
  // — no CURRENT_VERSION bump, no migrate() case needed (D27).
  shoppingList: z.record(productIdSchema, shoppingListItemSchema).default({}),
  version: z.literal(CURRENT_VERSION),
});
export type State = z.infer<typeof stateSchema>;
