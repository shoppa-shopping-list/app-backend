import { readFileSync, writeFileSync } from 'node:fs';
import pino from 'pino';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const OPENAPI_PATH = new URL('../openapi.json', import.meta.url);

async function main(): Promise<void> {
  const spec = await generateSpec();

  if (process.argv.includes('--check')) {
    const current = readFileSync(OPENAPI_PATH, 'utf8');
    if (current !== spec) {
      process.stderr.write('openapi.json is out of date — run `npm run openapi`\n');
      process.exit(1);
    }
    return;
  }

  writeFileSync(OPENAPI_PATH, spec);
}

// Never loadConfig(process.env) here: the spec must be identical whether CI runs with no
// .env or a developer has one, or `openapi:check` fails on the first push for no real reason.
async function generateSpec(): Promise<string> {
  const app = await buildApp({ config: loadConfig({}), log: pino({ level: 'silent' }) });
  await app.ready(); // swagger's onRoute hooks must run before app.swagger()
  return `${JSON.stringify(app.swagger(), undefined, 2)}\n`;
}

await main();
