import { CURRENT_VERSION, type State, stateSchema } from './types.js';

export class UnknownStateVersionError extends Error {
  version: unknown;

  constructor(version: unknown) {
    super(`Unknown state version: ${String(version)}`);
    this.name = 'UnknownStateVersionError';
    this.version = version;
  }
}

// THROWS on anything but the current version, and on a structurally invalid current
// version — a rollback must never serve a wrong shape and write it back (D6, §3.1).
export function migrate(raw: unknown): State {
  const version = extractVersion(raw);

  // eslint-disable-next-line sonarjs/no-small-switch -- switch is the seam for future versions (§8)
  switch (version) {
    case CURRENT_VERSION: {
      return stateSchema.parse(raw);
    }
    default: {
      throw new UnknownStateVersionError(version);
    }
  }
}

function extractVersion(raw: unknown): unknown {
  if (raw !== null && typeof raw === 'object' && 'version' in raw) {
    return raw.version;
  }
  return undefined;
}
