import type { Logger } from 'pino';

import type { EventsHub } from './features/events/events.routes.js';

export interface ShutdownDeps {
  closeApp: () => Promise<void>;
  events: Pick<EventsHub, 'closeAll'>;
  exit: (code: number) => void;
  flushNow: () => Promise<void>;
  hardTimeoutMs: number;
  log: Logger;
}

// Extracted from index.ts so §8 test #5 (SIGTERM flushes with an SSE stream open) can
// exercise the real sequencing without a subprocess. `exit` is injected rather than calling
// process.exit() directly — a spied process.exit returns in tests instead of terminating,
// which would let the async continuation past it run unobserved.
export function createShutdown(deps: ShutdownDeps): () => void {
  let shuttingDown = false;

  return function shutdown(): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    const hardTimer = setTimeout(() => {
      deps.log.error('shutdown timed out; forcing exit');
      deps.exit(1);
    }, deps.hardTimeoutMs);
    hardTimer.unref();

    // The flush happens here, not via fastify's onClose (which runs last-registered-first
    // and would race an open SSE stream blocking app.close()) — §3.2.
    // TODO(§3.3): stop scheduled jobs here once they exist — none are wired up yet.
    void (async (): Promise<void> => {
      try {
        await deps.flushNow();
      } catch (error) {
        deps.log.error({ err: error }, 'final flush failed');
      }
      deps.events.closeAll();
      await deps.closeApp();
      deps.exit(0);
    })();
  };
}
