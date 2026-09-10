import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { getState, resetStoreForTests } from '../state/store.js';
import { hydrate } from './index.js';
import { createLocalWriter } from './local.js';

function makeStatePath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'shoppa-hydrate-'));
  return path.join(dir, 'state.json');
}

beforeEach(() => {
  resetStoreForTests();
});

describe('hydrate', () => {
  it('seeds an empty state when the local file is absent', async () => {
    const statePath = makeStatePath();
    const writer = createLocalWriter({ log: pino(), statePath });

    await hydrate({ log: pino(), writer });

    const state = getState();
    expect(state.version).toBe(1);
    const lists = Object.values(state.lists);
    expect(lists).toHaveLength(1);
    expect(lists[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('quarantines a corrupt file, resolves without crash-looping, and seeds', async () => {
    const statePath = makeStatePath();
    const originalBytes = 'not json';
    writeFileSync(statePath, originalBytes);
    const writer = createLocalWriter({ log: pino(), statePath });

    await hydrate({ log: pino(), writer });

    const dir = path.dirname(statePath);
    const corruptFile = readdirSync(dir).find((name) => name.includes('state.json.corrupt-'));
    if (corruptFile === undefined) {
      throw new Error('expected a state.json.corrupt-* sibling file');
    }
    expect(readFileSync(path.join(dir, corruptFile), 'utf8')).toBe(originalBytes);

    expect(getState().version).toBe(1);
  });

  it('rethrows an unexpected IO error instead of seeding', async () => {
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

    await expect(hydrate({ log: pino(), writer })).rejects.toThrow('EACCES');
  });
});
