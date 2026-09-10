import type { Logger } from 'pino';

import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

export interface CreateLocalWriterOptions {
  fsyncDir?: (fd: number) => void;
  log: Logger;
  now?: () => Date;
  statePath: string;
  strictDirFsync?: boolean;
}

export type LocalRead =
  { err: unknown; kind: 'corrupt' } | { kind: 'absent' } | { kind: 'ok'; raw: unknown };

export interface LocalWriter {
  quarantineCorrupt: () => string; // rename → state.json.corrupt-<ISO>; returns the new path
  read: () => LocalRead;
  writeLocalSync: (next: unknown) => void;
}

export function createLocalWriter(options: CreateLocalWriterOptions): LocalWriter {
  const dir = path.dirname(options.statePath);
  const strictDirFsync = options.strictDirFsync ?? process.platform === 'linux';
  const fsyncDir = options.fsyncDir ?? fsyncSync;
  const now = options.now ?? ((): Date => new Date());

  mkdirSync(dir, { recursive: true });

  function writeLocalSync(next: unknown): void {
    // Rename is only atomic within a filesystem — the temp file must live in the same dir.
    const tempPath = path.join(dir, `.tmp-${randomUUID()}`);
    let fd: number | undefined;
    try {
      fd = openSync(tempPath, 'w');
      writeSync(fd, JSON.stringify(next, null, 2));
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(tempPath, options.statePath);
    } catch (error) {
      if (fd !== undefined) {
        closeSync(fd);
      }
      try {
        unlinkSync(tempPath);
      } catch {
        // best-effort cleanup; the original error is what matters
      }
      throw error;
    }

    try {
      const dirFd = openSync(dir, 'r');
      try {
        fsyncDir(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch (error) {
      // D7's fsync reasoning is about ext4 on the Pi; on macOS a directory fsync commonly
      // returns EINVAL/ENOTSUP and must not brick `npm run dev`. STRICT_DIR_FSYNC controls
      // this per-platform default.
      if (strictDirFsync) {
        throw error;
      }
      options.log.warn({ err: error }, 'directory fsync failed (non-strict, continuing)');
    }
  }

  function read(): LocalRead {
    let text: string;
    try {
      text = readFileSync(options.statePath, 'utf8');
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return { kind: 'absent' };
      }
      // Any other IO error (EACCES, EIO) is THROWN, not returned: we cannot distinguish
      // "no data" from "can't see the data", so D6's logic applies to the disk too.
      throw error;
    }

    try {
      return { kind: 'ok', raw: JSON.parse(text) as unknown };
    } catch (error) {
      return { err: error, kind: 'corrupt' };
    }
  }

  function quarantineCorrupt(): string {
    const target = `${options.statePath}.corrupt-${now().toISOString()}`;
    renameSync(options.statePath, target);
    return target;
  }

  return { quarantineCorrupt, read, writeLocalSync };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
