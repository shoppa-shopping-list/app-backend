import type { Entry, List, Product, ProductColor, ProductId } from '../state/types.js';

import { PRODUCT_COLORS } from '../state/types.js';

// Render a list to Telegram message text (§2.3, D17.3). Truncates to 4096 chars
// ("… and N more"), footer `updated HH:MM` so the text usually differs between flushes
// (dodges `400 message is not modified` — telegram.ts treats that as success anyway, D23).
// Entries whose product is missing (a dangling productId) are grouped under "Unsorted"
// rather than thrown on: a frozen flush is recoverable, a thrown renderer freezes the
// flush and the replica permanently (D17). "Unsorted" ranks after every real color,
// including "none", so a data-integrity fallback never masquerades as a chosen color.
const UNSORTED_RANK = PRODUCT_COLORS.length;
const UNSORTED_LABEL = 'Unsorted';

const MAX_CHARS = 4096;

const COLOR_LABELS: Record<ProductColor, string> = {
  black: '⚫ Black',
  blue: '🔵 Blue',
  brown: '🟤 Brown',
  green: '🟢 Green',
  none: 'No color',
  orange: '🟠 Orange',
  purple: '🟣 Purple',
  red: '🔴 Red',
  white: '⚪ White',
  yellow: '🟡 Yellow',
};

interface RenderEntry {
  groupLabel: string;
  groupRank: number;
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
    .toSorted((a, b) => a.groupRank - b.groupRank || a.name.localeCompare(b.name));

  const lines: string[] = [];
  let currentLabel: string | undefined;
  for (const item of items) {
    if (item.groupLabel !== currentLabel) {
      if (currentLabel !== undefined) {
        lines.push('');
      }
      lines.push(item.groupLabel);
      currentLabel = item.groupLabel;
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
  const groupRank = product === undefined ? UNSORTED_RANK : PRODUCT_COLORS.indexOf(product.color);
  const groupLabel = product === undefined ? UNSORTED_LABEL : COLOR_LABELS[product.color];
  return {
    groupLabel,
    groupRank,
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
