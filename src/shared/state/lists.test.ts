import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { State } from './types.js';

import { activateList, activeList, activeListId, createList, listSummaries } from './lists.js';
import { configureStore, installState, mutate, resetStoreForTests } from './store.js';
import { emptyState } from './test-helpers.js';
import { DEFAULT_LIST_ID, DEFAULT_LIST_NAME } from './types.js';

const TRAVELLER = 1;
const HOMEBODY = 2;

let writeLocalSync: ReturnType<typeof vi.fn<(next: State) => void>>;

beforeEach(() => {
  resetStoreForTests();
  installState(emptyState());
  writeLocalSync = vi.fn<(next: State) => void>();
  configureStore({ writeLocalSync });
});

describe('activeListId', () => {
  it('resolves a user with no pointer to the default list (D29)', () => {
    expect(activeListId(emptyState(), HOMEBODY)).toBe(DEFAULT_LIST_ID);
  });

  it('throws rather than guessing when the pointer dangles', () => {
    mutate((draft) => {
      draft.activeListByUser[String(TRAVELLER)] = '00000000-0000-4000-8000-00000000dead';
    });

    expect(() => activeList(TRAVELLER)).toThrow(/missing from state\.lists/);
  });
});

describe('createList / activateList', () => {
  it('switching one user leaves the other on the default list', () => {
    createList('Abroad');

    expect(activateList(TRAVELLER, 'Abroad')?.name).toBe('Abroad');
    expect(activeList(TRAVELLER).name).toBe('Abroad');
    expect(activeList(HOMEBODY).name).toBe(DEFAULT_LIST_NAME);
  });

  it('matches the name case-insensitively, trimming what was typed', () => {
    createList('Abroad');

    expect(activateList(TRAVELLER, '  abroad ')?.id).toBe(createList('Abroad').id);
  });

  it('an unknown name is a 0-write no-op, not a throw', () => {
    writeLocalSync.mockClear();

    expect(activateList(TRAVELLER, 'Mars')).toBeUndefined();
    expect(writeLocalSync).not.toHaveBeenCalled();
  });

  it('creating a list that already exists returns the existing one without writing', () => {
    const first = createList('Abroad');
    writeLocalSync.mockClear();

    expect(createList('abroad').id).toBe(first.id);
    expect(writeLocalSync).not.toHaveBeenCalled();
  });

  it('a new list starts empty, and summaries are name-ordered', () => {
    createList('Abroad');

    expect(listSummaries()).toEqual([
      { id: expect.any(String) as string, itemCount: 0, name: 'Abroad', productCount: 0 },
      { id: DEFAULT_LIST_ID, itemCount: 0, name: DEFAULT_LIST_NAME, productCount: 0 },
    ]);
  });
});
