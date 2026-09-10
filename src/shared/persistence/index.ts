import type { Logger } from 'pino';

import { randomUUID } from 'node:crypto';

import type { State } from '../state/types.js';
import type { LocalWriter } from './local.js';

import { migrate } from '../state/migrate.js';
import { installState } from '../state/store.js';

export interface HydrateOptions {
  log: Logger;
  writer: LocalWriter;
}

type MissingLocalStateReason =
  { err: unknown; kind: 'corrupt' | 'migrate-failed' } | { kind: 'absent' };

// TODO(D26, §3.2): synchronous final flush used by the SIGTERM handler. Stubbed until the
// relay exists; must handle 429/retry_after and never throw (D8) once implemented.
export function flushNow(): Promise<void> {
  return Promise.resolve();
}

// hydrate() only ever consults the local file today. §3.1's Telegram branch — reached when
// the local file is absent or corrupt — is deliberately not implemented: D6 ("boot refuses
// rather than guesses") requires that path to distinguish "no data" from "can't reach
// Telegram" and FATAL/exit(1) on the latter. Wiring `catch → seed` here would be exactly the
// silent-data-loss bug D6 exists to prevent. See docs/architecture-design.md §3.1, D6.
//
// Declared `async` (with no `await` yet) so that a synchronous throw from `writer.read()`
// becomes a rejected promise rather than a synchronous exception at the call site — the
// caller always does `await hydrate(...)` and expects errors to surface that way (D6: boot
// fails loudly). The awaits arrive with the Telegram branch above.
// eslint-disable-next-line @typescript-eslint/require-await -- see comment above
export async function hydrate(options: HydrateOptions): Promise<void> {
  const { log, writer } = options;
  const result = writer.read();

  switch (result.kind) {
    case 'absent': {
      resolveMissingLocalState({ kind: 'absent' }, writer, log);
      return;
    }
    case 'corrupt': {
      resolveMissingLocalState({ err: result.err, kind: 'corrupt' }, writer, log);
      return;
    }
    case 'ok': {
      try {
        const state = migrate(result.raw);
        installState(state);
        log.info('hydrated from local state');
        return;
      } catch (error) {
        resolveMissingLocalState({ err: error, kind: 'migrate-failed' }, writer, log);
        return;
      }
    }
  }
}

// TODO(D26): debounced (~15s, §2.1) flush to the pinned Telegram snapshot. Stubbed until
// the Cloudflare Worker relay exists — see docs/architecture-design.md D26.
export function scheduleTelegramFlush(): void {}

// Single seam for every "local file can't be trusted" path, so that D6's future Telegram
// branch (try the pinned snapshot, FATAL/exit(1) if unreachable — never fall through
// silently) only needs to be wired up once, not once per caller.
// TODO(§3.1, D6): try the pinned Telegram snapshot before seeding empty, and FATAL
// (exit(1)) rather than seed if Telegram is unreachable — never fall through silently.
function resolveMissingLocalState(
  reason: MissingLocalStateReason,
  writer: LocalWriter,
  log: Logger,
): void {
  switch (reason.kind) {
    case 'absent': {
      log.warn('no local state found; seeding empty state');
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
  seedAndInstall(writer);
}

function seedAndInstall(writer: LocalWriter): State {
  const seeded = seedEmptyState();
  writer.writeLocalSync(seeded);
  installState(seeded);
  return seeded;
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
