import { randomUUID } from 'node:crypto';

import type { DeepReadonly } from './store.js';
import type { ListId, ShoppingList, State } from './types.js';

import { getState, mutate } from './store.js';
import { DEFAULT_LIST_ID, shoppingListSchema } from './types.js';

// What a caller outside the state module is allowed to keep: counts and identity, never a
// live reference into the committed state (which is only ever replaced wholesale by
// mutate(), §6.1).
export interface ListSummary {
  id: ListId;
  itemCount: number;
  name: string;
  productCount: number;
}

// D29/D34: every read resolves the caller's active list, so a slice never sees `lists` and
// can't accidentally reach across tenants. Throws rather than falling back to the default
// when the pointer dangles — a pointer at a list that isn't there means the state was
// edited by hand, and guessing would silently write into the wrong list (D6's rule).
export function activeList(userId: number): DeepReadonly<ShoppingList> {
  const state = getState();
  const id = activeListId(state, userId);
  const list = state.lists[id];
  if (list === undefined) {
    throw new Error(`active list ${id} for user is missing from state.lists`);
  }
  return list;
}

// The mutate()-side twin of activeList(): same resolution against the draft, so a write
// lands in the same list the matching read came from.
export function activeListDraft(draft: State, userId: number): ShoppingList {
  const id = activeListId(draft, userId);
  const list = draft.lists[id];
  if (list === undefined) {
    throw new Error(`active list ${id} for user is missing from state.lists`);
  }
  return list;
}

// Sparse map (D29): no entry means the default list, so the user who never travels has no
// row here and nothing to switch.
export function activeListId(state: DeepReadonly<State>, userId: number): ListId {
  return state.activeListByUser[String(userId)] ?? DEFAULT_LIST_ID;
}

export function listSummaries(): ListSummary[] {
  return Object.values(getState().lists)
    .map((list) => toSummary(list))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

// Idempotent on name so re-running the switch script can't end up with two "Abroad" lists;
// names are what a human types, and there is no UI to disambiguate duplicates (§5.6).
export function createList(name: string): ListSummary {
  // Validate here, not at the next boot: an over-long name would go through mutate()
  // unchecked and then fail stateSchema.parse() on restart, which quarantines the file and
  // silently replaces it with the Telegram snapshot (the hazard CLAUDE.md warns about).
  shoppingListSchema.shape.name.parse(name);
  const existing = findListByName(getState(), name);
  if (existing !== undefined) {
    return toSummary(existing);
  }
  const id = randomUUID();
  return mutate((draft) => {
    draft.lists[id] = emptyList(id, name);
    return { id, itemCount: 0, name, productCount: 0 };
  });
}

// Returns undefined (not a throw) for an unknown name so the script can print the list of
// names it does know — a typo at 2am shouldn't look like a crash. No-op write either way.
export function activateList(userId: number, name: string): ListSummary | undefined {
  const target = findListByName(getState(), name);
  if (target === undefined) {
    return undefined;
  }
  const summary = toSummary(target);
  mutate((draft) => {
    draft.activeListByUser[String(userId)] = summary.id;
  });
  return summary;
}

// Case-insensitive: the name is typed by hand on a phone keyboard, not copied.
function findListByName(
  state: DeepReadonly<State>,
  name: string,
): DeepReadonly<ShoppingList> | undefined {
  const needle = name.trim().toLowerCase();
  return Object.values(state.lists).find((list) => list.name.toLowerCase() === needle);
}

export function emptyList(id: ListId, name: string): ShoppingList {
  return { createdAt: new Date().toISOString(), id, items: {}, name, products: {} };
}

function toSummary(list: DeepReadonly<ShoppingList>): ListSummary {
  return {
    id: list.id,
    itemCount: Object.keys(list.items).length,
    name: list.name,
    productCount: Object.keys(list.products).length,
  };
}
