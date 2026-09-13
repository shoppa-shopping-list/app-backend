import type { FastifyRequest } from 'fastify';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { ApiError } from './api-error.js';

const AUTH_DATE_FRESHNESS_MS = 5 * 60 * 1000; // D16: auth_date can't be refreshed, checked only at handshake
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // §5.1: "~12h"
export const SESSION_COOKIE_NAME = 'session';
const WEBAPP_DATA_HMAC_KEY = 'WebAppData';
// Confirmed against the Ed25519 (third-party) verification section of Telegram's bot
// docs, which spells out its excluded fields explicitly — the plain HMAC section only
// says "all received fields" without naming any. Both methods share the same base
// construction, so both exclusions apply here too. Resolves §9.3.
const EXCLUDED_INIT_DATA_FIELDS = new Set(['hash', 'signature']);

const ERROR_AUTH_NOT_CONFIGURED = 'auth_not_configured';
const ERROR_INVALID_INIT_DATA = 'invalid_init_data';
const ERROR_UNAUTHORIZED = 'unauthorized';
const ERROR_USER_NOT_ALLOWED = 'user_not_allowed';

const initDataUserSchema = z.object({ id: z.number() }).loose();
const sessionPayloadSchema = z.object({ exp: z.number(), userId: z.number() });
type SessionPayload = z.infer<typeof sessionPayloadSchema>;

export interface SessionUser {
  id: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

// Returns a preHandler rather than being one itself: `config.sessionSecret` may be
// unset at buildApp() time (openapi.ts and most tests call it with no env at all), so the
// "is this deployment even configured for auth" check has to happen per-request, not here.
export function createAuthPreHandler(
  sessionSecret: string | undefined,
): (request: FastifyRequest) => Promise<void> {
  // No actual async work — declared async only so Fastify awaits the returned promise. A
  // bare sync function with no `done` callback and no returned promise never signals
  // completion on the success path (only a throw is unambiguous either way), which stalls
  // every guarded request that doesn't fail.
  // eslint-disable-next-line @typescript-eslint/require-await -- see comment above
  return async function requireSession(request: FastifyRequest): Promise<void> {
    const secret = requireConfigured(sessionSecret, 'SESSION_SECRET');
    const cookie = request.cookies[SESSION_COOKIE_NAME];
    if (cookie === undefined) {
      throw new ApiError(401, ERROR_UNAUTHORIZED, 'missing session cookie');
    }
    const userId = verifySessionCookie(cookie, secret, Date.now());
    if (userId === undefined) {
      throw new ApiError(401, ERROR_UNAUTHORIZED, 'invalid or expired session cookie');
    }
    request.user = { id: userId };
  };
}

// Guarded routes call this instead of touching request.user directly: the field stays
// optional on FastifyRequest so an unguarded route can never assume it's set, so this is
// the one seam that narrows it back to SessionUser (and refuses if the guard's own
// preHandler somehow didn't run).
export function requireUser(request: FastifyRequest): SessionUser {
  if (request.user === undefined) {
    throw new ApiError(401, ERROR_UNAUTHORIZED, 'missing authenticated user');
  }
  return request.user;
}

// Pure and local, no network (D16/D26) — everything needed is the bot token plus the
// initData string itself.
export function validateInitData(
  initData: string,
  botToken: string,
  allowedUserIds: number[],
): SessionUser {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (receivedHash === null) {
    throw new ApiError(401, ERROR_INVALID_INIT_DATA, 'missing hash');
  }

  const dataCheckString = buildDataCheckString(params);
  const expectedHash = computeExpectedHash(botToken, dataCheckString);
  if (!constantTimeEqual(receivedHash.toLowerCase(), expectedHash)) {
    throw new ApiError(401, ERROR_INVALID_INIT_DATA, 'signature mismatch');
  }

  const authDate = parseAuthDate(params);
  if (Date.now() - authDate * 1000 > AUTH_DATE_FRESHNESS_MS) {
    throw new ApiError(401, ERROR_INVALID_INIT_DATA, 'stale auth_date');
  }

  const userId = parseUserId(params);
  if (!allowedUserIds.includes(userId)) {
    throw new ApiError(401, ERROR_USER_NOT_ALLOWED, 'user is not on the allowlist');
  }

  return { id: userId };
}

export function createSessionCookie(userId: number, secret: string, now: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: now + SESSION_TTL_MS, userId } satisfies SessionPayload),
  ).toString('base64url');
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifySessionCookie(
  value: string,
  secret: string,
  now: number,
): number | undefined {
  const [payload, signature] = value.split('.', 2);
  if (payload === undefined || signature === undefined) {
    return undefined;
  }
  if (!constantTimeEqual(signature, signPayload(payload, secret))) {
    return undefined;
  }
  const session = parseSessionPayload(payload);
  if (session === undefined || session.exp <= now) {
    return undefined;
  }
  return session.userId;
}

// Shared by createAuthPreHandler, validateInitData (via session.routes.ts) and
// createSessionCookie's callers: config that's optional at parse time (see config.ts's
// BOT_TOKEN comment) must fail loudly the first time it's actually needed, not silently
// no-op or crash with an unrelated error further down.
export function requireConfigured<T>(value: T | undefined, envVarName: string): T {
  if (value === undefined) {
    throw new ApiError(500, ERROR_AUTH_NOT_CONFIGURED, `${envVarName} is not set`);
  }
  return value;
}

// Data-check-string per Telegram's spec: every field except hash/signature, sorted
// alphabetically, `key=value` lines joined by `\n`.
function buildDataCheckString(params: URLSearchParams): string {
  return [...params]
    .filter(([key]) => !EXCLUDED_INIT_DATA_FIELDS.has(key))
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function computeExpectedHash(botToken: string, dataCheckString: string): string {
  // D16's implementation trap: the two HMAC calls take their operands in opposite
  // roles. secret is the HMAC of the bot token, keyed by the literal "WebAppData" — not
  // the reverse.
  const secret = hmacSha256(WEBAPP_DATA_HMAC_KEY, botToken);
  return hmacSha256(secret, dataCheckString).toString('hex');
}

function parseAuthDate(params: URLSearchParams): number {
  const raw = params.get('auth_date');
  const value = raw === null ? NaN : Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new ApiError(401, ERROR_INVALID_INIT_DATA, 'missing or malformed auth_date');
  }
  return value;
}

function parseUserId(params: URLSearchParams): number {
  const raw = params.get('user');
  if (raw === null) {
    throw new ApiError(401, ERROR_INVALID_INIT_DATA, 'missing user field');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError(401, ERROR_INVALID_INIT_DATA, 'malformed user field');
  }

  const result = initDataUserSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(401, ERROR_INVALID_INIT_DATA, 'malformed user field');
  }
  return result.data.id;
}

function signPayload(payload: string, secret: string): string {
  return hmacSha256(secret, payload).toString('base64url');
}

function parseSessionPayload(payload: string): SessionPayload | undefined {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
  const result = sessionPayloadSchema.safeParse(json);
  return result.success ? result.data : undefined;
}

// Equal-length check first: Node's timingSafeEqual throws RangeError on a length
// mismatch rather than returning false, which would otherwise surface a tampered or
// malformed value as a 500 instead of a 401.
function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}
