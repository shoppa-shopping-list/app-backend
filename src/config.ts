import path from 'node:path';
import { z } from 'zod';

const booleanFlagValues = ['0', '1', 'false', 'true'] as const;

function toBoolean(value: (typeof booleanFlagValues)[number]): boolean {
  return value === '1' || value === 'true';
}

const envSchema = z.object({
  // Required locally too (not just as a Worker secret) for initData HMAC (D16, §7) —
  // optional at parse time so a fresh clone with no .env still boots; the Telegram tier
  // fails loudly (D6) rather than at config-load time if it's actually reached unset.
  BOT_TOKEN: z.string().optional(),
  FLUSH_DEBOUNCE_MS: z.coerce.number().int().positive().default(15_000), // §2.1
  HOST: z.string().default('127.0.0.1'), // nginx owns 80/443; never bind 0.0.0.0 (§7)
  LOG_LEVEL: z.string().default('info'),
  LOG_PRETTY: z
    .enum(booleanFlagValues)
    .default('0') // off by default; never on the boot path
    .transform(toBoolean),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  OWNER_USER_ID: z.coerce.number().int().optional(), // default snapshot chat (§7)
  PORT: z.coerce.number().int().positive().default(3000),
  RELAY_SECRET: z.string().optional(), // authenticates this Pi to the Worker (D26)
  SNAPSHOT_CHAT_ID: z.coerce.number().int().optional(), // optional override, e.g. a private channel (§7)
  STATE_PATH: z.string().default('./data/state.json'),
  STRICT_DIR_FSYNC: z
    .enum(booleanFlagValues)
    .optional()
    .transform((value) => (value === undefined ? undefined : toBoolean(value))),
  TELEGRAM_API_BASE: z.string().optional(), // the Worker relay URL, NOT api.telegram.org (D26)
});

export interface Config {
  botToken?: string;
  flushDebounceMs: number;
  host: string;
  logLevel: string;
  logPretty: boolean;
  nodeEnv: 'development' | 'production' | 'test';
  // undefined means "use OWNER_USER_ID" — resolved where it's read, not here (§7).
  ownerUserId?: number;
  port: number;
  relaySecret?: string;
  snapshotChatId?: number;
  statePath: string;
  // undefined defers to createLocalWriter()'s own platform default (see local.ts) — the
  // single place that policy is computed.
  strictDirFsync?: boolean;
  telegramApiBase?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.parse(stripEmptyStrings(env));
  return {
    ...(parsed.BOT_TOKEN !== undefined && { botToken: parsed.BOT_TOKEN }),
    flushDebounceMs: parsed.FLUSH_DEBOUNCE_MS,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    logPretty: parsed.LOG_PRETTY,
    nodeEnv: parsed.NODE_ENV,
    ...(parsed.OWNER_USER_ID !== undefined && { ownerUserId: parsed.OWNER_USER_ID }),
    port: parsed.PORT,
    ...(parsed.RELAY_SECRET !== undefined && { relaySecret: parsed.RELAY_SECRET }),
    ...(parsed.SNAPSHOT_CHAT_ID !== undefined && { snapshotChatId: parsed.SNAPSHOT_CHAT_ID }),
    // ./data/state.json resolves against process.cwd() — "/" under systemd with no
    // WorkingDirectory= — so it must be absolute before anything reads or writes it.
    statePath: path.resolve(parsed.STATE_PATH),
    ...(parsed.STRICT_DIR_FSYNC !== undefined && { strictDirFsync: parsed.STRICT_DIR_FSYNC }),
    // Trailing slash would double up when telegram.ts joins `${base}/api/${method}`.
    ...(parsed.TELEGRAM_API_BASE !== undefined && {
      telegramApiBase: parsed.TELEGRAM_API_BASE.endsWith('/')
        ? parsed.TELEGRAM_API_BASE.slice(0, -1)
        : parsed.TELEGRAM_API_BASE,
    }),
  };
}

function stripEmptyStrings(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    // z.coerce.number() turns PORT= into 0 rather than falling back to the default —
    // an empty env var must be treated as unset.
    if (value !== undefined && value !== '') {
      result[key] = value;
    }
  }
  return result;
}

export const config = loadConfig(process.env);
