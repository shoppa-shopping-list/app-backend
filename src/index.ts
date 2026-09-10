import pino, { type Logger } from 'pino';

import { buildApp } from './app.js';
import { config } from './config.js';
import {
  configureTelegramFlush,
  flushNow,
  hydrate,
  scheduleTelegramFlush,
} from './shared/persistence/index.js';
import { createLocalWriter } from './shared/persistence/local.js';
import { createSnapshotSource, type SnapshotSource } from './shared/persistence/snapshot.js';
import { configureStore } from './shared/state/store.js';
import { createTelegramClient } from './shared/telegram.js';

const HARD_SHUTDOWN_TIMEOUT_MS = 25_000; // < systemd's TimeoutStopSec (30s, §7)

// sync: true so the last ERROR line survives process.exit() (landmine 9) — applies whether
// or not LOG_PRETTY is on, since this is the only logger in the process, boot through shutdown.
// pino-pretty is dynamically imported, and only when logPretty is on: it's a devDependency
// (LOG_PRETTY defaults off and is never meant on the boot path, see config.ts), so a
// `--omit=dev` production install doesn't have it — a static import would ERR_MODULE_NOT_FOUND
// at boot regardless of this branch, since ESM resolves imports before any code runs.
async function createLogger(): Promise<Logger> {
  let destination;
  if (config.logPretty) {
    const { default: PinoPretty } = await import('pino-pretty');
    destination = PinoPretty({ sync: true });
  } else {
    destination = pino.destination({ sync: true });
  }
  return pino({ level: config.logLevel }, destination);
}

const log = await createLogger();

async function main(): Promise<void> {
  const writer = createLocalWriter({
    log,
    statePath: config.statePath,
    ...(config.strictDirFsync !== undefined && { strictDirFsync: config.strictDirFsync }),
  });
  const snapshot = createSnapshot();

  // Writes via `writer` directly, never via mutate() — both precede configureStore().
  // hydrate() and buildApp() touch disjoint state (see each's own comment), so they run
  // concurrently rather than serializing disk I/O behind plugin registration.
  const [, app] = await Promise.all([
    hydrate({ log, snapshot, writer }),
    buildApp({ config, log }),
  ]);

  const { events } = app; // the SSE hub; only this (not the whole app) should outlive main()
  configureStore({
    emitChange: () => events.emit(),
    scheduleTelegramFlush,
    writeLocalSync: writer.writeLocalSync,
  });
  configureTelegramFlush({ debounceMs: config.flushDebounceMs, log, snapshot });

  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    const hardTimer = setTimeout(() => {
      log.error('shutdown timed out; forcing exit');
      process.exit(1);
    }, HARD_SHUTDOWN_TIMEOUT_MS);
    hardTimer.unref();

    // The flush happens here, not via fastify's onClose (which runs last-registered-first
    // and would race an open SSE stream blocking app.close()) — §3.2.
    // TODO(§3.3): stop scheduled jobs here once they exist — none are wired up yet.
    void (async (): Promise<void> => {
      try {
        await flushNow();
      } catch (error) {
        log.error({ err: error }, 'final flush failed');
      }
      app.events.closeAll();
      await app.close();
      process.exit(0);
    })();
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: config.host, port: config.port });
}

// Telegram is required, not optional — §3.1 always consults it once the local file is
// missing, corrupt, or fails to migrate, and D6 treats "not configured" the same as
// "unreachable": FATAL, not seed. A fresh clone with no .env still boots, because that
// branch is only reached when there's no usable local state to begin with; local dev
// almost always has one after the first run (see config.ts's BOT_TOKEN comment).
function createSnapshot(): SnapshotSource {
  const chatId = config.snapshotChatId ?? config.ownerUserId;
  if (
    chatId === undefined ||
    config.telegramApiBase === undefined ||
    config.botToken === undefined
  ) {
    const notConfigured = (): Promise<never> =>
      Promise.reject(
        new Error(
          'Telegram not configured: TELEGRAM_API_BASE, BOT_TOKEN, and OWNER_USER_ID ' +
            '(or SNAPSHOT_CHAT_ID) are all required (D26, §7)',
        ),
      );
    return { readSnapshot: notConfigured, writeSnapshot: notConfigured };
  }

  const client = createTelegramClient({
    log,
    telegramApiBase: config.telegramApiBase,
    ...(config.relaySecret !== undefined && { relaySecret: config.relaySecret }),
  });
  return createSnapshotSource({ chatId, client });
}

try {
  await main();
} catch (error) {
  log.error({ err: error }, 'fatal error during boot');
  process.exit(1);
}
