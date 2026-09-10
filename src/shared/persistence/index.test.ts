import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReadSnapshotResult, SnapshotSource } from './snapshot.js';

import { getState, resetStoreForTests } from '../state/store.js';
import { hydrate, seedEmptyState } from './index.js';
import { createLocalWriter } from './local.js';

function makeStatePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'shoppa-hydrate-'));
  return path.join(dir, 'state.json');
}

function makeSnapshot(overrides: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    readSnapshot: vi.fn((): Promise<ReadSnapshotResult> => Promise.resolve({ kind: 'no-pin' })),
    writeSnapshot: vi.fn((): Promise<number> => Promise.resolve(999)),
    ...overrides,
  };
}

beforeEach(() => {
  resetStoreForTests();
});

describe('hydrate', () => {
  it('seeds an empty state and pushes it to Telegram when the local file is absent and there is no pin', async () => {
    const statePath = makeStatePath();
    const writer = createLocalWriter({ log: pino(), statePath });
    const snapshot = makeSnapshot();

    await hydrate({ log: pino(), snapshot, writer });

    const state = getState();
    expect(state.version).toBe(1);
    const lists = Object.values(state.lists);
    expect(lists).toHaveLength(1);
    expect(lists[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(snapshot.writeSnapshot).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it('quarantines a corrupt file, resolves without crash-looping, and seeds', async () => {
    const statePath = makeStatePath();
    const originalBytes = 'not json';
    writeFileSync(statePath, originalBytes);
    const writer = createLocalWriter({ log: pino(), statePath });
    const snapshot = makeSnapshot();

    await hydrate({ log: pino(), snapshot, writer });

    const dir = path.dirname(statePath);
    const corruptFile = readdirSync(dir).find((name) => name.includes('state.json.corrupt-'));
    if (corruptFile === undefined) {
      throw new Error('expected a state.json.corrupt-* sibling file');
    }
    expect(readFileSync(path.join(dir, corruptFile), 'utf8')).toBe(originalBytes);

    expect(getState().version).toBe(1);
  });

  it('rethrows an unexpected IO error instead of seeding, and never touches Telegram', async () => {
    const snapshot = makeSnapshot();
    const writer = {
      quarantineCorrupt: (): string => {
        throw new Error('should not be called');
      },
      read: (): never => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      },
      writeLocalSync: (): void => {
        throw new Error('should not be called');
      },
    };

    await expect(hydrate({ log: pino(), snapshot, writer })).rejects.toThrow('EACCES');
    expect(snapshot.readSnapshot).not.toHaveBeenCalled();
  });

  // D25 test #1 — "the most important test in the project" (§8). Boot must refuse rather
  // than guess when Telegram is unreachable: seeding here would silently overwrite the
  // pin holding the only surviving copy the moment the first write lands (D6).
  it('rejects rather than seeding empty state when Telegram is unreachable', async () => {
    const statePath = makeStatePath();
    const writer = createLocalWriter({ log: pino(), statePath });
    const snapshot = makeSnapshot({
      readSnapshot: vi.fn((): Promise<ReadSnapshotResult> =>
        Promise.reject(new Error('relay timeout')),
      ),
    });

    await expect(hydrate({ log: pino(), snapshot, writer })).rejects.toThrow('relay timeout');
    expect(() => getState()).toThrow();
  });

  // §9.9: a pin that exists but isn't our document is the same hazard as unreachable, not
  // "no pin" — treating it as no-pin would seed empty and overwrite the pin holding the
  // only surviving copy, exactly the D6 disaster.
  it('rejects when a Telegram pin exists but is not the app snapshot document (§9.9)', async () => {
    const statePath = makeStatePath();
    const writer = createLocalWriter({ log: pino(), statePath });
    const snapshot = makeSnapshot({
      readSnapshot: vi.fn((): Promise<ReadSnapshotResult> =>
        Promise.resolve({ kind: 'pin-not-ours' }),
      ),
    });

    await expect(hydrate({ log: pino(), snapshot, writer })).rejects.toThrow(/not.*document/i);
    expect(() => getState()).toThrow();
  });

  it('hydrates from a found Telegram snapshot when the local file is absent', async () => {
    const statePath = makeStatePath();
    const writer = createLocalWriter({ log: pino(), statePath });
    const seeded = seedEmptyState();
    const snapshot = makeSnapshot({
      readSnapshot: vi.fn((): Promise<ReadSnapshotResult> =>
        Promise.resolve({ kind: 'found', messageId: 42, state: seeded }),
      ),
    });

    await hydrate({ log: pino(), snapshot, writer });

    const state = getState();
    expect(state.meta.snapshotMessageId).toBe(42);

    const read = writer.read();
    expect(read.kind).toBe('ok');
    const raw = (read as { kind: 'ok'; raw: unknown }).raw as {
      meta: { snapshotMessageId?: number };
    };
    expect(raw.meta.snapshotMessageId).toBe(42);
  });
});
