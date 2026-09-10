import type { List, Product, ProductId } from '../state/types.js';

// TODO(§2.3, D17.3): render a list to Telegram message text. Truncate to 4096 chars
// ("… and N more"), footer `updated HH:MM` so the text always differs (dodges 400 "message
// is not modified"). D17.3: group entries whose product is missing (a dangling productId)
// under "Unsorted" rather than throwing — a frozen flush is recoverable, a thrown renderer
// freezes the flush and the replica permanently. See docs/architecture-design.md §2.3, D17.
export function renderList(_list: List, _products: Record<ProductId, Product>): string {
  throw new Error('not implemented: renderList (§2.3, D17) — see docs/architecture-design.md');
}
