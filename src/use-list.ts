import pino from 'pino';

import { config } from './config.js';
import { createLocalWriter } from './shared/persistence/local.js';
import { activateList, createList, listSummaries } from './shared/state/lists.js';
import { migrate } from './shared/state/migrate.js';
import { configureStore, installState } from './shared/state/store.js';

// The manual switch (D32, §5.6). Deliberately not a route and not a bot command: the switch
// happens about twice per trip, and every mechanism that would make it self-service costs
// more than it saves. Run it with the unit STOPPED, or RAM wins and the write is lost (D3),
// from the unit's WorkingDirectory (STATE_PATH is relative), as the unit's own user (the
// atomic rename hands the new file that user's ownership), and with --env-file: systemd
// supplies .env through EnvironmentFile, a hand-run node does not.
//
//   cd /home/lit/projects/shoppa-app-backend
//   touch PAUSE && sudo systemctl stop shoppa-backend
//   node --env-file=.env current/dist/use-list.js use Abroad
//   sudo systemctl start shoppa-backend && rm PAUSE
//
// PAUSE is what keeps pull-deploy.sh's every-minute cron from restarting the unit mid-edit.
// `list` writes nothing, so it is safe to run while the unit is up.
const USAGE = `usage: node --env-file=.env current/dist/use-list.js <command>

  list                      show every list, with product and item counts
  create <name>             add an empty list (no-op if the name already exists)
  use <name>                point OWNER_USER_ID at that list
  use-for <userId> <name>   point that Telegram user at that list

Run with the service stopped; see the header of src/use-list.ts.`;

const EXIT_USAGE = 2;

const log = pino({ level: config.logLevel }, pino.destination({ sync: true }));

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  hydrateFromLocalFile();

  switch (command ?? '') {
    case 'create': {
      const name = requireName(rest);
      const summary = createList(name);
      process.stdout.write(`${summary.name} (${summary.id})\n`);
      return;
    }
    case 'list': {
      for (const summary of listSummaries()) {
        process.stdout.write(
          `${summary.name}\t${String(summary.productCount)} products` +
            `\t${String(summary.itemCount)} on the list\n`,
        );
      }
      return;
    }
    case 'use': {
      switchTo(config.ownerUserId, requireName(rest));
      return;
    }
    case 'use-for': {
      const [rawUserId, ...nameParts] = rest;
      switchTo(Number(rawUserId), requireName(nameParts));
      return;
    }
    default: {
      fail(USAGE, EXIT_USAGE);
    }
  }
}

// Local file only. A script must never reach the Telegram branch of hydrate(): that branch
// exists to recover a booting server, and here it would quarantine a readable-but-stale file
// or seed an empty one over the real data. Nothing is written unless the file parsed and
// migrated cleanly.
function hydrateFromLocalFile(): void {
  const writer = createLocalWriter({
    log,
    statePath: config.statePath,
    ...(config.strictDirFsync !== undefined && { strictDirFsync: config.strictDirFsync }),
  });
  const read = writer.read();
  if (read.kind !== 'ok') {
    fail(
      `refusing to continue: ${config.statePath} is ${read.kind}. ` +
        'Start the service and let hydrate() resolve it (D6), then re-run.',
    );
  }
  installState(migrate(read.raw));
  // writeLocalSync only: emitChange and scheduleTelegramFlush keep the store's no-op
  // defaults, so this process neither opens an SSE hub nor talks to Telegram. The snapshot
  // therefore lags until the restarted service's next mutate() — harmless, since Telegram is
  // authoritative for nothing (D3).
  configureStore({ writeLocalSync: writer.writeLocalSync });
}

function requireName(parts: string[]): string {
  const name = parts.join(' ').trim();
  if (name === '') {
    fail(USAGE, EXIT_USAGE);
  }
  return name;
}

function switchTo(userId: number | undefined, name: string): void {
  if (userId === undefined || !Number.isFinite(userId)) {
    fail('no user id: pass `use-for <userId> <name>`, or set OWNER_USER_ID in .env');
  }
  const summary = activateList(userId, name);
  if (summary === undefined) {
    fail(`no list named ${JSON.stringify(name)} — \`list\` shows the names that exist`);
  }
  process.stdout.write(
    `now on ${summary.name}: ${String(summary.productCount)} products, ` +
      `${String(summary.itemCount)} on the list\n`,
  );
}

// `never` so the callers above don't need an unreachable return after it.
function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

main();
