import type { Entry, List, Product, ProductId } from '../state/types.js';

// Render a list to Telegram message text (§2.3, D17.3). Truncates to 4096 chars
// ("… and N more"), footer `updated HH:MM` so the text usually differs between flushes
// (dodges `400 message is not modified` — telegram.ts treats that as success anyway, D23).
// Entries whose product is missing (a dangling productId) are grouped under "Unsorted"
// rather than thrown on: a frozen flush is recoverable, a thrown renderer freezes the
// flush and the replica permanently (D17).

const MAX_CHARS = 4096;
const UNSORTED_CATEGORY = 'Unsorted';

interface RenderEntry {
  category: string;
  name: string;
  note?: string;
  quantity: number;
  unit?: string;
}

export function renderList(
  list: List,
  products: Record<ProductId, Product>,
  now: () => Date = () => new Date(),
): string {
  const lines = buildLines(list, products);
  const footer = `updated ${formatTime(now())}`;
  return truncate(lines, footer);
}

function buildLines(list: List, products: Record<ProductId, Product>): string[] {
  const items = Object.values(list.entries)
    .map((entry) => toRenderEntry(entry, products))
    .toSorted((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

  const lines: string[] = [];
  let currentCategory: string | undefined;
  for (const item of items) {
    if (item.category !== currentCategory) {
      if (currentCategory !== undefined) {
        lines.push('');
      }
      lines.push(item.category);
      currentCategory = item.category;
    }
    lines.push(formatEntryLine(item));
  }
  return lines;
}

function truncate(lines: string[], footer: string): string {
  const full = joinWithFooter(lines, footer);
  if (full.length <= MAX_CHARS) {
    return full;
  }

  for (let kept = lines.length - 1; kept >= 0; kept -= 1) {
    const dropped = lines.length - kept;
    const candidate = joinWithFooter(
      [...lines.slice(0, kept), `… and ${String(dropped)} more`],
      footer,
    );
    if (candidate.length <= MAX_CHARS) {
      return candidate;
    }
  }
  // Pathological: even a single "… and N more" marker plus the footer doesn't fit.
  return footer;
}

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

function toRenderEntry(entry: Entry, products: Record<ProductId, Product>): RenderEntry {
  const product = products[entry.productId];
  return {
    category: product?.category ?? UNSORTED_CATEGORY,
    name: product?.name ?? entry.productId,
    ...(entry.note !== undefined && { note: entry.note }),
    quantity: entry.quantity,
    ...(entry.unit !== undefined && { unit: entry.unit }),
  };
}

function formatEntryLine(item: RenderEntry): string {
  const quantity =
    item.unit === undefined ? String(item.quantity) : `${String(item.quantity)} ${item.unit}`;
  const note = item.note === undefined ? '' : ` (${item.note})`;
  return `• ${item.name} — ${quantity}${note}`;
}

function joinWithFooter(lines: string[], footer: string): string {
  return lines.length === 0 ? footer : `${lines.join('\n')}\n\n${footer}`;
}
