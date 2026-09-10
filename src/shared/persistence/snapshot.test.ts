import { describe, expect, it, vi } from 'vitest';

import type { TelegramChat, TelegramClient } from '../telegram.js';

import { createSnapshotSource, SNAPSHOT_FILENAME } from './snapshot.js';

const CHAT_ID = 12_345;

function toArrayBuffer(text: string): ArrayBuffer {
  const bytes = Buffer.from(text, 'utf8');
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

function makeClient(overrides: Partial<TelegramClient> = {}): TelegramClient {
  return {
    downloadFile: vi.fn((): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(0))),
    editMessageMedia: vi.fn((): Promise<void> => Promise.resolve()),
    editMessageText: vi.fn((): Promise<void> => Promise.resolve()),
    getChat: vi.fn((): Promise<TelegramChat> => Promise.resolve({})),
    getFile: vi.fn((): Promise<{ filePath: string }> =>
      Promise.resolve({ filePath: 'documents/file.json' }),
    ),
    pinChatMessage: vi.fn((): Promise<void> => Promise.resolve()),
    sendDocument: vi.fn((): Promise<{ messageId: number }> => Promise.resolve({ messageId: 1 })),
    sendMessage: vi.fn((): Promise<{ messageId: number }> => Promise.resolve({ messageId: 1 })),
    ...overrides,
  };
}

describe('readSnapshot', () => {
  it('returns no-pin when getChat has no pinned_message', async () => {
    const client = makeClient({ getChat: vi.fn((): Promise<TelegramChat> => Promise.resolve({})) });
    const source = createSnapshotSource({ chatId: CHAT_ID, client });

    await expect(source.readSnapshot()).resolves.toEqual({ kind: 'no-pin' });
  });

  it('returns pin-not-ours when the pin is not our snapshot document', async () => {
    const client = makeClient({
      getChat: vi.fn((): Promise<TelegramChat> =>
        Promise.resolve({
          pinned_message: { document: { file_id: 'f1', file_name: 'notes.txt' }, message_id: 7 },
        }),
      ),
    });
    const source = createSnapshotSource({ chatId: CHAT_ID, client });

    await expect(source.readSnapshot()).resolves.toEqual({ kind: 'pin-not-ours' });
  });

  it('returns pin-not-ours when the pinned message has no document at all', async () => {
    const client = makeClient({
      getChat: vi.fn((): Promise<TelegramChat> =>
        Promise.resolve({ pinned_message: { message_id: 7 } }),
      ),
    });
    const source = createSnapshotSource({ chatId: CHAT_ID, client });

    await expect(source.readSnapshot()).resolves.toEqual({ kind: 'pin-not-ours' });
  });

  it('downloads and parses the snapshot when the pin is our document', async () => {
    const state = { hello: 'world' };
    const client = makeClient({
      downloadFile: vi.fn((): Promise<ArrayBuffer> =>
        Promise.resolve(toArrayBuffer(JSON.stringify(state))),
      ),
      getChat: vi.fn((): Promise<TelegramChat> =>
        Promise.resolve({
          pinned_message: {
            document: { file_id: 'f1', file_name: SNAPSHOT_FILENAME },
            message_id: 7,
          },
        }),
      ),
      getFile: vi.fn((): Promise<{ filePath: string }> =>
        Promise.resolve({ filePath: 'documents/f1.json' }),
      ),
    });
    const source = createSnapshotSource({ chatId: CHAT_ID, client });

    await expect(source.readSnapshot()).resolves.toEqual({ kind: 'found', messageId: 7, state });
    expect(client.getFile).toHaveBeenCalledWith('f1');
  });
});

describe('writeSnapshot', () => {
  it('sends a new document and pins it when there is no existing message id', async () => {
    const sendDocument = vi.fn(
      (_params: {
        caption?: string;
        chatId: number;
        document: { filename: string };
      }): Promise<{
        messageId: number;
      }> => Promise.resolve({ messageId: 55 }),
    );
    const client = makeClient({ sendDocument });
    const source = createSnapshotSource({ chatId: CHAT_ID, client });

    const messageId = await source.writeSnapshot('{}', undefined);

    expect(messageId).toBe(55);
    expect(sendDocument).toHaveBeenCalledWith(expect.objectContaining({ chatId: CHAT_ID }));
    const [call] = sendDocument.mock.calls;
    expect(call?.[0].document.filename).toBe(SNAPSHOT_FILENAME);
    expect(client.pinChatMessage).toHaveBeenCalledWith({ chatId: CHAT_ID, messageId: 55 });
  });

  it('edits the existing message and keeps the same id when one is already known', async () => {
    const client = makeClient();
    const source = createSnapshotSource({ chatId: CHAT_ID, client });

    const messageId = await source.writeSnapshot('{}', 42);

    expect(messageId).toBe(42);
    expect(client.editMessageMedia).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: CHAT_ID, messageId: 42 }),
    );
    expect(client.sendDocument).not.toHaveBeenCalled();
    expect(client.pinChatMessage).not.toHaveBeenCalled();
  });
});
