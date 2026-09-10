// TODO(D26): outbound-only Telegram client, routed through the Cloudflare Worker relay —
// TELEGRAM_API_BASE points at the Worker, never api.telegram.org directly, and the bot
// token stays a Worker secret (RELAY_SECRET authenticates this Pi to the Worker instead).
// Every call must handle 429 with `retry_after`; errors are logged, never thrown (D8) —
// Telegram is authoritative for nothing (D3). See docs/architecture-design.md D26.
export interface TelegramClient {
  editMessageMedia: () => Promise<unknown>;
  getChat: () => Promise<unknown>;
  getFile: () => Promise<unknown>;
  pinChatMessage: () => Promise<unknown>;
  sendDocument: () => Promise<unknown>;
}

export function createTelegramClient(): TelegramClient {
  throw new Error('not implemented: createTelegramClient (D26) — see docs/architecture-design.md');
}
