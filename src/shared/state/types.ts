import { z } from 'zod';

export const CURRENT_VERSION = 1;

// D11: a UUID keeps arbitrary strings out of the Record keyspace.
export const productIdSchema = z.uuid();
export type ProductId = z.infer<typeof productIdSchema>;

export const listIdSchema = z.uuid();
export type ListId = z.infer<typeof listIdSchema>;

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

export const productSchema = z.object({
  color: productColorSchema,
  createdAt: z.iso.datetime(),
  defaultUnit: z.string().trim().min(1).max(16).optional(),
  favouritedBy: z.array(z.number()), // Telegram user ids who have favourited this product
  id: productIdSchema,
  name: z.string().trim().min(1).max(120),
});
export type Product = z.infer<typeof productSchema>;

export const entrySchema = z.object({
  addedAt: z.iso.datetime(),
  addedBy: z.number(),
  note: z.string().trim().max(500).optional(),
  productId: productIdSchema,
  quantity: z.number().positive(),
  unit: z.string().trim().min(1).max(16).optional(),
  updatedAt: z.iso.datetime(), // server receipt time (D13)
});
export type Entry = z.infer<typeof entrySchema>;

export const listSchema = z.object({
  entries: z.record(productIdSchema, entrySchema),
  id: listIdSchema,
  memberIds: z.array(z.number()),
  name: z.string().trim().min(1).max(120),
});
export type List = z.infer<typeof listSchema>;

const metaSchema = z.object({
  snapshotMessageId: z.number().optional(), // required to WRITE the snapshot (D4)
  // Keyed by stringified chat_id — §4 never specifies the key shape; recorded as a decision.
  viewMessageIds: z.record(z.string(), z.number()),
});

export const stateSchema = z.object({
  lists: z.record(listIdSchema, listSchema),
  meta: metaSchema,
  products: z.record(productIdSchema, productSchema),
  version: z.literal(CURRENT_VERSION),
});
export type State = z.infer<typeof stateSchema>;
