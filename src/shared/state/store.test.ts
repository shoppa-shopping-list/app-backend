import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureStore, getState, installState, mutate, resetStoreForTests } from './store.js';
import { emptyState } from './test-helpers.js';

beforeEach(() => {
  resetStoreForTests();
});

describe('getState / mutate before installState', () => {
  it('getState() throws before hydrate', () => {
    expect(() => getState()).toThrow(/before hydrate/);
  });

  it('mutate() throws before hydrate', () => {
    expect(() => mutate((draft) => draft)).toThrow(/before hydrate/);
  });
});

describe('default sinks', () => {
  it('mutate() throws when writeLocalSync is not configured', () => {
    installState(emptyState());
    expect(() => mutate((draft) => draft)).toThrow(/writeLocalSync sink missing/);
  });
});

describe('mutate rollback', () => {
  it('a throwing mutator leaves state untouched and calls no sinks', () => {
    installState(emptyState());
    const writeLocalSync = vi.fn();
    const emitChange = vi.fn();
    configureStore({ emitChange, writeLocalSync });

    const before = getState();
    expect(() =>
      mutate(() => {
        throw new Error('mutator failed');
      }),
    ).toThrow('mutator failed');

    expect(getState()).toEqual(before);
    expect(writeLocalSync).not.toHaveBeenCalled();
    expect(emitChange).not.toHaveBeenCalled();
  });

  it('a throwing writeLocalSync propagates, leaves state untouched, and calls no other sinks', () => {
    installState(emptyState());
    const scheduleTelegramFlush = vi.fn();
    const emitChange = vi.fn();
    configureStore({
      emitChange,
      scheduleTelegramFlush,
      writeLocalSync: () => {
        throw new Error('disk full');
      },
    });

    const before = getState();
    expect(() => mutate((draft) => draft)).toThrow('disk full');

    expect(getState()).toEqual(before);
    expect(scheduleTelegramFlush).not.toHaveBeenCalled();
    expect(emitChange).not.toHaveBeenCalled();
  });
});

describe('silent mutations', () => {
  it('{ silent: true } skips emitChange but still schedules the Telegram flush', () => {
    installState(emptyState());
    const scheduleTelegramFlush = vi.fn();
    const emitChange = vi.fn();
    configureStore({ emitChange, scheduleTelegramFlush, writeLocalSync: () => {} });

    mutate((draft) => draft, { silent: true });

    expect(scheduleTelegramFlush).toHaveBeenCalledTimes(1);
    expect(emitChange).not.toHaveBeenCalled();
  });
});

describe('never capture state across a mutation', () => {
  it('getState() returns a new reference after a commit', () => {
    installState(emptyState());
    configureStore({ writeLocalSync: () => {} });

    const before = getState();
    mutate((draft) => draft);

    expect(getState()).not.toBe(before);
  });
});
