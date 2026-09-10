import type { Logger } from 'pino';

import { randomUUID } from 'node:crypto';

import type { State } from '../state/types.js';
import type { LocalWriter } from './local.js';
import type { SnapshotSource } from './snapshot.js';

import { migrate } from '../state/migrate.js';
import { getState, installState, mutate } from '../state/store.js';

export interface HydrateOptions {
  log: Logger;
  snapshot: SnapshotSource;
  writer: LocalWriter;
}

type MissingLocalStateReason =
  { err: unknown; kind: 'corrupt' | 'migrate-failed' } | { kind: 'absent' };

export interface TelegramFlushOptions {
  debounceMs: number;
  log: Logger;
  snapshot: SnapshotSource;
}

// hydrate() consults the local file first, then falls back to Telegram (§3.1) when it's
// absent, corrupt, or fails to migrate. D6 ("boot refuses rather than guesses") requires
// "no data" and "can't reach Telegram" to stay separate branches all the way down —
// wiring `catch -> seed` here would be exactly the silent-data-loss bug D6 exists to
// prevent. See docs/architecture-design.md §3.1, D6.
export async function hydrate(options: HydrateOptions): Promise<void> {
  const { log, snapshot, writer } = options;
  const result = writer.read();

  switch (result.kind) {
    case 'absent': {
      await resolveMissingLocalState({ kind: 'absent' }, writer, snapshot, log);
      return;
    }
    case 'corrupt': {
      await resolveMissingLocalState({ err: result.err, kind: 'corrupt' }, writer, snapshot, log);
      return;
    }
    case 'ok': {
      try {
        const state = migrate(result.raw);
        installState(state);
        log.info('hydrated from local state');
        return;
      } catch (error) {
        await resolveMissingLocalState(
          { err: error, kind: 'migrate-failed' },
          writer,
          snapshot,
          log,
        );
        return;
      }
    }
  }
}

// Single seam for every "local file can't be trusted" path, so that the Telegram fallback
// only needs to be wired up once, not once per caller.
async function resolveMissingLocalState(
  reason: MissingLocalStateReason,
  writer: LocalWriter,
  snapshot: SnapshotSource,
  log: Logger,
): Promise<void> {
  switch (reason.kind) {
    case 'absent': {
      log.warn('no local state found; consulting Telegram (§3.1)');
      break;
    }
    case 'corrupt': {
      const quarantined = writer.quarantineCorrupt();
      log.error({ err: reason.err, quarantined }, 'local state was corrupt; quarantined');
      break;
    }
    case 'migrate-failed': {
      const quarantined = writer.quarantineCorrupt();
      log.error({ err: reason.err, quarantined }, 'local state failed to migrate; quarantined');
      break;
    }
  }
  await recoverFromTelegram(writer, snapshot, log);
}

// §3.1's Telegram branch. Four outcomes, not three — §9.9 adds a fourth beyond the
// original flowchart: a pin that exists but isn't our snapshot document (the owner pinned
// something else, D5) is exactly the same hazard as unreachable, not "no pin". Treating it
// as no-pin would seed empty and overwrite the pin holding the only surviving copy — D6's
// disaster, arriving through the branch D6 was written to close.
//
// A transport failure (readSnapshot rejects: timeout, 5xx, relay/config missing) is left
// to propagate — the caller (ultimately index.ts's boot try/catch) logs FATAL and
// exit(1)s. That is the point: refuse rather than guess.
async function recoverFromTelegram(
  writer: LocalWriter,
  snapshot: SnapshotSource,
  log: Logger,
): Promise<void> {
  const result = await snapshot.readSnapshot();

  switch (result.kind) {
    case 'found': {
      const state = migrate(result.state);
      state.meta.snapshotMessageId = result.messageId;
      writer.writeLocalSync(state);
      installState(state);
      log.warn(
        'hydrated from Telegram snapshot; local file was missing or unusable — this may lag',
      );
      return;
    }
    case 'no-pin': {
      const seeded = seedEmptyState();
      writer.writeLocalSync(seeded);
      try {
        seeded.meta.snapshotMessageId = await snapshot.writeSnapshot(
          JSON.stringify(seeded),
          undefined,
        );
        writer.writeLocalSync(seeded);
      } catch (error) {
        log.error(
          { err: error },
          'seeded empty state but failed to push it to Telegram; will retry on next flush',
        );
      }
      installState(seeded);
      return;
    }
    case 'pin-not-ours': {
      throw new Error(
        "boot refuses: a Telegram pin exists in the snapshot chat but is not this app's " +
          'document (§9.9) — resolve manually (re-pin the real snapshot, or clear the pin) ' +
          'before restarting',
      );
    }
  }
}

let flushOptions: TelegramFlushOptions | undefined;
let flushTimer: NodeJS.Timeout | undefined;
let dirty = false;

// Called once from index.ts's composition root, after configureStore() — before that,
// mutate()'s sinks aren't wired and scheduleTelegramFlush() must be a safe no-op (matches
// the pre-existing stub behaviour for hydrate(), tests, and any script that never calls it).
export function configureTelegramFlush(options: TelegramFlushOptions): void {
  flushOptions = options;
}

// Debounced (~15s, §2.1) flush to the pinned Telegram snapshot, triggered by every
// mutate() (via the store's scheduleTelegramFlush sink). Not a scheduled job (D22) — it's
// change-triggered, which is strictly better than clock-triggered for a replica.
export function scheduleTelegramFlush(): void {
  if (flushOptions === undefined) {
    return;
  }
  dirty = true;
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    void performFlush();
  }, flushOptions.debounceMs);
  flushTimer.unref(); // must not hold the process open, same as events.routes.ts's keep-alive
}

// Synchronous-final-flush used by the SIGTERM handler (§3.2). Skips the debounce wait —
// if dirty, flushes immediately; otherwise a no-op. Never throws (D3, D8): performFlush
// catches and logs internally, same as every other Telegram-tier call site.
export async function flushNow(): Promise<void> {
  if (flushOptions === undefined || !dirty) {
    return;
  }
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  await performFlush();
}

async function performFlush(): Promise<void> {
  if (flushOptions === undefined) {
    return;
  }
  const { log, snapshot } = flushOptions;
  dirty = false;
  flushTimer = undefined;

  const state = getState();
  try {
    const messageId = await snapshot.writeSnapshot(
      JSON.stringify(state),
      state.meta.snapshotMessageId,
    );
    if (messageId !== state.meta.snapshotMessageId) {
      // Bookkeeping, not domain data — silent per §5.2, same as viewMessageIds.
      mutate(
        (draft) => {
          draft.meta.snapshotMessageId = messageId;
        },
        { silent: true },
      );
    }
    log.info('flushed snapshot to telegram');
  } catch (error) {
    log.error({ err: error }, 'telegram flush failed');
  }
}

export function resetTelegramFlushForTests(): void {
  flushOptions = undefined;
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
  }
  flushTimer = undefined;
  dirty = false;
}

export function seedEmptyState(): State {
  const listId = randomUUID();
  return {
    lists: {
      [listId]: {
        entries: {},
        id: listId,
        memberIds: [],
        name: 'Shopping list',
      },
    },
    meta: { viewMessageIds: {} },
    products: {},
    version: 1,
  };
}
