import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReadSnapshotResult, SnapshotSource } from './shared/persistence/snapshot.js';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import {
  configureTelegramFlush,
  flushNow,
  resetTelegramFlushForTests,
  scheduleTelegramFlush,
} from './shared/persistence/index.js';
import { configureStore, installState, mutate, resetStoreForTests } from './shared/state/store.js';
import { emptyState } from './shared/state/test-helpers.js';
import { createShutdown } from './shutdown.js';

function makeSnapshot(overrides: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    readSnapshot: vi.fn((): Promise<ReadSnapshotResult> => Promise.resolve({ kind: 'no-pin' })),
    writeSnapshot: vi.fn((): Promise<number> => Promise.resolve(999)),
    ...overrides,
  };
}

beforeEach(() => {
  resetStoreForTests();
  resetTelegramFlushForTests();
});

afterEach(() => {
  resetTelegramFlushForTests();
});

describe('shutdown', () => {
  // §8 test #5: SIGTERM flushes with an SSE stream open. The flush must happen — and be
  // observable to have happened — even though a client is still connected to /api/events;
  // §3.2's whole point is that this must not be the thing that blocks shutdown.
  it('flushes the dirty state to Telegram and exits 0 while an SSE stream is open', async () => {
    const log = pino({ level: 'silent' });
    const app = await buildApp({ config: loadConfig({}), log });
    installState(emptyState());
    const snapshot = makeSnapshot();
    configureStore({ scheduleTelegramFlush, writeLocalSync: () => {} });
    configureTelegramFlush({ debounceMs: 15_000, log, snapshot });

    // Dirties the store via the real mutate()/scheduleTelegramFlush path, same as a
    // request handler would — flushNow() below must have real work to do.
    mutate((draft) => {
      draft.meta.viewMessageIds['list'] = 1;
    });

    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a bound TCP address');
    }
    // Opened and deliberately never closed or read from — this is the open SSE stream
    // that must not be allowed to block shutdown.
    const sseResponse = await fetch(`http://127.0.0.1:${String(address.port)}/api/events`);
    expect(sseResponse.status).toBe(200);

    const exit = vi.fn();
    const closeAll = vi.fn(() => {
      app.events.closeAll();
    });
    const shutdown = createShutdown({
      closeApp: () => app.close(),
      events: { closeAll },
      exit,
      flushNow,
      hardTimeoutMs: 1000,
      log,
    });

    shutdown();

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalled();
    });

    expect(snapshot.writeSnapshot).toHaveBeenCalledTimes(1);
    expect(closeAll).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    // The flush is sequenced before the SSE stream is torn down, not after or concurrently
    // — reversing that order (flushing after the stream that dirtied the state is already
    // gone) is exactly the regression §3.2 calls out.
    const writeOrder = vi.mocked(snapshot.writeSnapshot).mock.invocationCallOrder[0];
    const closeAllOrder = closeAll.mock.invocationCallOrder[0];
    if (writeOrder === undefined || closeAllOrder === undefined) {
      throw new Error('expected both writeSnapshot and closeAll to have been called');
    }
    expect(writeOrder).toBeLessThan(closeAllOrder);
  });
});
