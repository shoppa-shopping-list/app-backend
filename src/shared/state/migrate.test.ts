import { describe, expect, it } from 'vitest';

import { migrate, UnknownStateVersionError } from './migrate.js';

function validV1(): Record<string, unknown> {
  return {
    lists: {},
    meta: { viewMessageIds: {} },
    products: {},
    version: 1,
  };
}

describe('migrate', () => {
  it('parses a valid version 1 state', () => {
    const state = migrate(validV1());
    expect(state.version).toBe(1);
  });

  it('throws UnknownStateVersionError on an unknown version, with the version in the message', () => {
    expect(() => migrate({ ...validV1(), version: 2 })).toThrow(UnknownStateVersionError);
    expect(() => migrate({ ...validV1(), version: 2 })).toThrow(/2/);
  });

  it('throws on a missing version', () => {
    const raw = validV1();
    delete raw['version'];
    expect(() => migrate(raw)).toThrow(UnknownStateVersionError);
  });

  it('throws on a structurally invalid version 1 state', () => {
    expect(() => migrate({ lists: {}, products: {}, version: 1 })).toThrow();
  });
});
