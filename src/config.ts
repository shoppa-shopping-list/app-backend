import path from 'node:path';
import { z } from 'zod';

const booleanFlagValues = ['0', '1', 'false', 'true'] as const;

function toBoolean(value: (typeof booleanFlagValues)[number]): boolean {
  return value === '1' || value === 'true';
}

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'), // nginx owns 80/443; never bind 0.0.0.0 (§7)
  LOG_LEVEL: z.string().default('info'),
  LOG_PRETTY: z
    .enum(booleanFlagValues)
    .default('0') // off by default; never on the boot path
    .transform(toBoolean),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  STATE_PATH: z.string().default('./data/state.json'),
  STRICT_DIR_FSYNC: z
    .enum(booleanFlagValues)
    .optional()
    .transform((value) => (value === undefined ? undefined : toBoolean(value))),
});

export interface Config {
  host: string;
  logLevel: string;
  logPretty: boolean;
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  statePath: string;
  // undefined defers to createLocalWriter()'s own platform default (see local.ts) — the
  // single place that policy is computed.
  strictDirFsync?: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.parse(stripEmptyStrings(env));
  return {
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    logPretty: parsed.LOG_PRETTY,
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    // ./data/state.json resolves against process.cwd() — "/" under systemd with no
    // WorkingDirectory= — so it must be absolute before anything reads or writes it.
    statePath: path.resolve(parsed.STATE_PATH),
    ...(parsed.STRICT_DIR_FSYNC !== undefined && { strictDirFsync: parsed.STRICT_DIR_FSYNC }),
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
