import type { Logger } from 'pino';

// Outbound-only Telegram client, routed through the Cloudflare Worker relay (D26) —
// `telegramApiBase` points at the Worker, never api.telegram.org directly, and the bot
// token stays a Worker secret (`relaySecret` authenticates this Pi to the Worker instead).
// Every call handles 429 with `retry_after`. Errors are logged, never thrown, only by
// *callers* on the Telegram tier (D8) — this module itself always rejects on failure so
// the boot path (D6) can FATAL on an unreachable relay.
// See docs/architecture-design.md D26.

const RELAY_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 4; // 1 try + up to 3 retries on 429

export interface TelegramMessage {
  document?: { file_id: string; file_name?: string };
  message_id: number;
}

export interface TelegramChat {
  pinned_message?: TelegramMessage;
}

export interface TelegramDocument {
  // Buffer, not Uint8Array: @types/node's Uint8Array<ArrayBufferLike> (which admits
  // SharedArrayBuffer) isn't assignable to DOM's BlobPart, Buffer's is.
  bytes: Buffer;
  filename: string;
}

export interface TelegramClient {
  downloadFile: (filePath: string) => Promise<ArrayBuffer>;
  editMessageMedia: (params: {
    caption?: string;
    chatId: number;
    document: TelegramDocument;
    messageId: number;
  }) => Promise<void>;
  editMessageText: (params: { chatId: number; messageId: number; text: string }) => Promise<void>;
  getChat: (chatId: number) => Promise<TelegramChat>;
  getFile: (fileId: string) => Promise<{ filePath: string }>;
  pinChatMessage: (params: { chatId: number; messageId: number }) => Promise<void>;
  sendDocument: (params: {
    caption?: string;
    chatId: number;
    document: TelegramDocument;
  }) => Promise<{ messageId: number }>;
  sendMessage: (params: { chatId: number; text: string }) => Promise<{ messageId: number }>;
}

interface TelegramErrorResponse {
  description: string;
  error_code: number;
  ok: false;
  parameters?: { retry_after?: number };
}
interface TelegramOkResponse<T> {
  ok: true;
  result: T;
}
type TelegramResponse<T> = TelegramErrorResponse | TelegramOkResponse<T>;

export interface CreateTelegramClientOptions {
  log: Logger;
  relaySecret?: string;
  telegramApiBase: string;
}

export function createTelegramClient(options: CreateTelegramClientOptions): TelegramClient {
  const { log, relaySecret, telegramApiBase } = options;

  async function getChat(chatId: number): Promise<TelegramChat> {
    return call<TelegramChat>('getChat', { chat_id: chatId });
  }

  async function getFile(fileId: string): Promise<{ filePath: string }> {
    const result = await call<{ file_path?: string }>('getFile', { file_id: fileId });
    if (result.file_path === undefined) {
      throw new Error(`telegram getFile returned no file_path for ${fileId}`);
    }
    return { filePath: result.file_path };
  }

  async function downloadFile(filePath: string): Promise<ArrayBuffer> {
    const response = await fetchWithTimeout(`${telegramApiBase}/file/${filePath}`, {
      headers: buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`telegram file download failed: ${String(response.status)} ${filePath}`);
    }
    return response.arrayBuffer();
  }

  async function sendDocument(params: {
    caption?: string;
    chatId: number;
    document: TelegramDocument;
  }): Promise<{ messageId: number }> {
    const form = documentForm(params.chatId, params.document);
    if (params.caption !== undefined) {
      form.append('caption', params.caption);
    }
    const result = await call<TelegramMessage>('sendDocument', form);
    return { messageId: result.message_id };
  }

  async function editMessageMedia(params: {
    caption?: string;
    chatId: number;
    document: TelegramDocument;
    messageId: number;
  }): Promise<void> {
    const form = new FormData();
    form.append('chat_id', String(params.chatId));
    form.append('message_id', String(params.messageId));
    form.append(
      'media',
      JSON.stringify({
        ...(params.caption !== undefined && { caption: params.caption }),
        media: 'attach://document',
        type: 'document',
      }),
    );
    appendDocumentBlob(form, params.document);
    await callEdit('editMessageMedia', form);
  }

  async function sendMessage(params: { chatId: number; text: string }): Promise<{
    messageId: number;
  }> {
    const result = await call<TelegramMessage>('sendMessage', {
      chat_id: params.chatId,
      text: params.text,
    });
    return { messageId: result.message_id };
  }

  async function editMessageText(params: {
    chatId: number;
    messageId: number;
    text: string;
  }): Promise<void> {
    await callEdit('editMessageText', {
      chat_id: params.chatId,
      message_id: params.messageId,
      text: params.text,
    });
  }

  async function pinChatMessage(params: { chatId: number; messageId: number }): Promise<void> {
    await call<true>('pinChatMessage', {
      chat_id: params.chatId,
      disable_notification: true,
      message_id: params.messageId,
    });
  }

  // Succeeds on Telegram's own success AND on "400: message is not modified" (D23) —
  // cheap insurance even though the smoke test never triggered it for a document; expected
  // in practice for editMessageText once two flushes render identical text within the same
  // minute (§2.3's HH:MM footer usually, not always, dodges it).
  async function callEdit(method: string, body: FormData | Record<string, unknown>): Promise<void> {
    const payload = await request<TelegramMessage>(method, body);
    if (payload.ok || isNotModified(payload)) {
      return;
    }
    throw new Error(
      `telegram ${method} failed: ${String(payload.error_code)} ${payload.description}`,
    );
  }

  async function call<T>(method: string, body: FormData | Record<string, unknown>): Promise<T> {
    const payload = await request<T>(method, body);
    if (!payload.ok) {
      throw new Error(
        `telegram ${method} failed: ${String(payload.error_code)} ${payload.description}`,
      );
    }
    return payload.result;
  }

  // The one place that talks to the relay. Retries 429 up to MAX_ATTEMPTS; any other
  // Telegram-level error is returned (not thrown) so callEdit can special-case "not
  // modified" — only a network/timeout failure throws here.
  async function request<T>(
    method: string,
    body: FormData | Record<string, unknown>,
  ): Promise<TelegramResponse<T>> {
    const isForm = body instanceof FormData;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const response = await fetchWithTimeout(`${telegramApiBase}/api/${method}`, {
        body: isForm ? body : JSON.stringify(body),
        headers: buildHeaders(isForm ? undefined : 'application/json'),
        method: 'POST',
      });
      const payload = await parseTelegramResponse<T>(response);
      if (payload.ok) {
        return payload;
      }
      if (payload.error_code === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfterMs = (payload.parameters?.retry_after ?? 1) * 1000;
        log.warn({ attempt, method, retryAfterMs }, 'telegram 429, retrying');
        await sleep(retryAfterMs);
        continue;
      }
      return payload;
    }
    // Unreachable: MAX_ATTEMPTS >= 1 and every branch above returns or continues, and the
    // final iteration's `attempt < MAX_ATTEMPTS` is always false, forcing the `return payload`
    // branch. Required for TS's control-flow analysis, which can't see that.
    throw new Error(`telegram ${method}: retries exhausted`);
  }

  function buildHeaders(contentType?: string): Record<string, string> {
    return {
      ...(contentType !== undefined && { 'Content-Type': contentType }),
      ...(relaySecret !== undefined && { 'X-Relay-Secret': relaySecret }),
    };
  }

  return {
    downloadFile,
    editMessageMedia,
    editMessageText,
    getChat,
    getFile,
    pinChatMessage,
    sendDocument,
    sendMessage,
  };
}

function documentForm(chatId: number, document: TelegramDocument): FormData {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  appendDocumentBlob(form, document);
  return form;
}

function appendDocumentBlob(form: FormData, document: TelegramDocument): void {
  // A fresh Uint8Array(length) is always ArrayBuffer-backed; Buffer's own type param is
  // ArrayBufferLike (admits SharedArrayBuffer), which isn't assignable to BlobPart.
  const bytes = new Uint8Array(document.bytes.byteLength);
  bytes.set(document.bytes);
  form.append('document', new Blob([bytes], { type: 'application/json' }), document.filename);
}

// The relay's own error responses (401 bad secret, 403 disallowed method, 404) are plain
// text, not Telegram's `{ok:false, ...}` JSON envelope — parsing those as JSON threw an
// opaque SyntaxError instead of a useful message (caught live: a flush failure logged
// "Unexpected token 'u', \"unauthorized\" is not valid JSON" with no hint why). Fall back
// to a synthetic error response instead of letting JSON.parse throw.
async function parseTelegramResponse<T>(response: Response): Promise<TelegramResponse<T>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as TelegramResponse<T>;
  } catch {
    return {
      description: text.length > 0 ? text : `HTTP ${String(response.status)}`,
      error_code: response.status,
      ok: false,
    };
  }
}

function isNotModified(payload: TelegramErrorResponse): boolean {
  return (
    payload.error_code === 400 &&
    payload.description.toLowerCase().includes('message is not modified')
  );
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, RELAY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
