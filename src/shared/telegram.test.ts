import type { Logger } from 'pino';

import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTelegramClient } from './telegram.js';

const BASE = 'https://relay.example';

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function silentLogger(): Logger {
  return pino({ level: 'silent' });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createTelegramClient', () => {
  it('sends the relay secret header and returns the parsed result on success', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit): Promise<Response> =>
      Promise.resolve(jsonResponse({ ok: true, result: {} })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createTelegramClient({
      log: silentLogger(),
      relaySecret: 'shh',
      telegramApiBase: BASE,
    });

    await client.getChat(123);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (call === undefined) {
      throw new Error('expected fetch to have been called');
    }
    const [url, init] = call;
    expect(url).toBe(`${BASE}/api/getChat`);
    expect((init.headers as Record<string, string>)['X-Relay-Secret']).toBe('shh');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('retries on 429 using retry_after, then succeeds', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.fn((): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          jsonResponse(
            {
              description: 'Too Many Requests',
              error_code: 429,
              ok: false,
              parameters: { retry_after: 1 },
            },
            429,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true, result: { message_id: 5 } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createTelegramClient({ log: silentLogger(), telegramApiBase: BASE });

    const resultPromise = client.sendMessage({ chatId: 1, text: 'hi' });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result).toEqual({ messageId: 5 });
    expect(calls).toBe(2);
  });

  it('treats "message is not modified" as success for an edit call, not an error', async () => {
    const fetchMock = vi.fn((): Promise<Response> =>
      Promise.resolve(
        jsonResponse(
          { description: 'Bad Request: message is not modified', error_code: 400, ok: false },
          400,
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createTelegramClient({ log: silentLogger(), telegramApiBase: BASE });

    await expect(
      client.editMessageText({ chatId: 1, messageId: 2, text: 'hi' }),
    ).resolves.toBeUndefined();
  });

  it('throws a descriptive error for a genuine API failure, without retrying', async () => {
    const fetchMock = vi.fn((): Promise<Response> =>
      Promise.resolve(
        jsonResponse(
          { description: 'Forbidden: bot was blocked by the user', error_code: 403, ok: false },
          403,
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createTelegramClient({ log: silentLogger(), telegramApiBase: BASE });

    await expect(client.getChat(1)).rejects.toThrow(/403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Caught live against the deployed relay: a bad/missing RELAY_SECRET returns a plain
  // "unauthorized" body (401), which is the relay's own response, not Telegram's JSON
  // envelope — response.json() threw an opaque SyntaxError instead of a useful message.
  it('surfaces a clear error for a non-JSON relay response (e.g. unauthorized)', async () => {
    const fetchMock = vi.fn((): Promise<Response> =>
      Promise.resolve(new Response('unauthorized', { status: 401 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createTelegramClient({ log: silentLogger(), telegramApiBase: BASE });

    await expect(client.getChat(1)).rejects.toThrow(/401.*unauthorized/);
  });
});
