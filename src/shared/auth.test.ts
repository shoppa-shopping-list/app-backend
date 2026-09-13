import { describe, expect, it } from 'vitest';

import { ApiError } from './api-error.js';
import { buildInitData, TEST_BOT_TOKEN, TEST_USER_ID } from './auth-test-helpers.js';
import { createSessionCookie, validateInitData, verifySessionCookie } from './auth.js';

const ALLOWED_USER_IDS = [TEST_USER_ID];

describe('validateInitData', () => {
  it('accepts a correctly signed initData and extracts the user id', () => {
    expect(validateInitData(buildInitData(), TEST_BOT_TOKEN, ALLOWED_USER_IDS)).toEqual({
      id: TEST_USER_ID,
    });
  });

  it('excludes signature from the digest — tampering it alone still validates (§9.3)', () => {
    const initData = buildInitData({ signature: 'completely-different-value' });
    expect(validateInitData(initData, TEST_BOT_TOKEN, ALLOWED_USER_IDS)).toEqual({
      id: TEST_USER_ID,
    });
  });

  it('rejects a tampered field', () => {
    // Mutate the wire string *after* signing — overriding a field before buildInitData
    // signs it would just produce a validly-signed message for the new value, not a
    // tampered one.
    const tampered = buildInitData().replace(/query_id=[^&]+/, 'query_id=tampered');
    expect(() => validateInitData(tampered, TEST_BOT_TOKEN, ALLOWED_USER_IDS)).toThrow(ApiError);
  });

  it('rejects a wrong-content hash', () => {
    const initData = buildInitData({ hash: '0'.repeat(64) });
    expect(() => validateInitData(initData, TEST_BOT_TOKEN, ALLOWED_USER_IDS)).toThrow(ApiError);
  });

  // Regression guard for D16's specific warning: timingSafeEqual throws RangeError on a
  // length mismatch, which must not escape as an uncaught error / 500.
  it('rejects a wrong-length hash as a 401, not an unrelated throw', () => {
    const initData = buildInitData({ hash: 'ab' });
    expect(() => validateInitData(initData, TEST_BOT_TOKEN, ALLOWED_USER_IDS)).toThrow(ApiError);
  });

  it('rejects a missing hash field', () => {
    const authDate = String(Math.floor(Date.now() / 1000));
    const params = new URLSearchParams({
      auth_date: authDate,
      user: JSON.stringify({ id: TEST_USER_ID }),
    });
    expect(() => validateInitData(params.toString(), TEST_BOT_TOKEN, ALLOWED_USER_IDS)).toThrow(
      ApiError,
    );
  });

  it('rejects a stale auth_date', () => {
    const staleSeconds = Math.floor(Date.now() / 1000) - 6 * 60;
    const initData = buildInitData({ auth_date: String(staleSeconds) });
    expect(() => validateInitData(initData, TEST_BOT_TOKEN, ALLOWED_USER_IDS)).toThrow(ApiError);
  });

  it('rejects a user id not on the allowlist', () => {
    expect(() => validateInitData(buildInitData(), TEST_BOT_TOKEN, [999])).toThrow(ApiError);
  });
});

describe('session cookie', () => {
  const SECRET = 'test-session-secret';

  it('round-trips a userId through create/verify', () => {
    const now = Date.now();
    const cookie = createSessionCookie(TEST_USER_ID, SECRET, now);
    expect(verifySessionCookie(cookie, SECRET, now)).toBe(TEST_USER_ID);
  });

  it('rejects a tampered cookie value', () => {
    const now = Date.now();
    const cookie = createSessionCookie(TEST_USER_ID, SECRET, now);
    const flippedLastChar = cookie.endsWith('a') ? 'b' : 'a';
    const tampered = `${cookie.slice(0, -1)}${flippedLastChar}`;
    expect(verifySessionCookie(tampered, SECRET, now)).toBeUndefined();
  });

  it('rejects an expired cookie', () => {
    const now = Date.now();
    const cookie = createSessionCookie(TEST_USER_ID, SECRET, now);
    const afterTtl = now + 13 * 60 * 60 * 1000; // past the 12h TTL
    expect(verifySessionCookie(cookie, SECRET, afterTtl)).toBeUndefined();
  });

  it('rejects a cookie signed with a different secret', () => {
    const now = Date.now();
    const cookie = createSessionCookie(TEST_USER_ID, SECRET, now);
    expect(verifySessionCookie(cookie, 'wrong-secret', now)).toBeUndefined();
  });
});
