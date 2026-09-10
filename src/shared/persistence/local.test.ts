import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { createLocalWriter } from './local.js';

function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'shoppa-local-'));
}

describe('createLocalWriter', () => {
  it('writes, then reads back an identical value with no .tmp- residue', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'nested', 'state.json');
    const writer = createLocalWriter({ log: pino(), statePath });

    writer.writeLocalSync({ hello: 'world' });

    const read = writer.read();
    expect(read).toEqual({ kind: 'ok', raw: { hello: 'world' } });
    expect(readdirSync(path.join(dir, 'nested')).some((name) => name.includes('.tmp-'))).toBe(
      false,
    );
  });

  it('an overwrite is readable', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'state.json');
    const writer = createLocalWriter({ log: pino(), statePath });

    writer.writeLocalSync({ n: 1 });
    writer.writeLocalSync({ n: 2 });

    expect(writer.read()).toEqual({ kind: 'ok', raw: { n: 2 } });
    expect(JSON.parse(readFileSync(statePath, 'utf8')) as unknown).toEqual({ n: 2 });
  });

  it('strictDirFsync: false logs a WARN and still commits the write when directory fsync fails', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'state.json');
    const logger = pino();
    const warnSpy = vi.spyOn(logger, 'warn');
    const writer = createLocalWriter({
      fsyncDir: () => {
        throw Object.assign(new Error('EINVAL'), { code: 'EINVAL' });
      },
      log: logger,
      statePath,
      strictDirFsync: false,
    });

    writer.writeLocalSync({ ok: true });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(writer.read()).toEqual({ kind: 'ok', raw: { ok: true } });
  });

  it('strictDirFsync: true throws when directory fsync fails', () => {
    const dir = makeTempDir();
    const statePath = path.join(dir, 'state.json');
    const writer = createLocalWriter({
      fsyncDir: () => {
        throw Object.assign(new Error('EINVAL'), { code: 'EINVAL' });
      },
      log: pino(),
      statePath,
      strictDirFsync: true,
    });

    expect(() => writer.writeLocalSync({ ok: true })).toThrow('EINVAL');
  });
});
