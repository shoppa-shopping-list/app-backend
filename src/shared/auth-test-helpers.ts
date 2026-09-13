import { createHmac } from 'node:crypto';

export const TEST_BOT_TOKEN = '123456:test-bot-token';
export const TEST_USER_ID = 42;

// Named rather than inlined below: an inline string literal in the createHmac key
// position reads as a hardcoded secret to static analysis, even though this is
// Telegram's own public protocol constant (D16), not anything sensitive.
const WEBAPP_DATA_HMAC_KEY = 'WebAppData';

// Computed independently from shared/auth.ts, per Telegram's documented algorithm (D16) —
// this is what actually pins the field-exclusion and operand-order decisions, not a
// round trip through the code under test.
export function buildInitData(
  overrides: Partial<Record<string, string>> = {},
  botToken: string = TEST_BOT_TOKEN,
): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAH-test-query-id',
    signature: 'not-part-of-the-digest',
    user: JSON.stringify({ first_name: 'Ada', id: TEST_USER_ID }),
    ...overrides,
  };
  const dataCheckString = Object.entries(fields)
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const hash = overrides['hash'] ?? computeHash(botToken, dataCheckString);
  return new URLSearchParams({ ...fields, hash }).toString();
}

function computeHash(botToken: string, dataCheckString: string): string {
  const secret = hmacSha256(WEBAPP_DATA_HMAC_KEY, botToken);
  return hmacSha256(secret, dataCheckString).toString('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}
