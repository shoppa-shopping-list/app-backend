import type { TelegramClient } from '../telegram.js';

// The pinned JSON document (D4, D26): reading and writing are different problems.
//
// - Writing needs `meta.snapshotMessageId` (editMessageMedia/pinChatMessage take one; the
//   normal boot path never calls getChat).
// - Reading needs the *pin* — a stored message_id gives no route to a file_id, only
//   getChat -> pinned_message does.
//
// SNAPSHOT_FILENAME is the marker that answers open question §9.9: a pin exists but isn't
// our document (the owner pinned something else) is a distinct outcome from "no pin", and
// must be treated as unreachable (FATAL, D6) rather than as "no data" — an arbitrary pin
// isn't proof this app never had one.
export const SNAPSHOT_FILENAME = 'shoppa-state.json';

export type ReadSnapshotResult =
  | { kind: 'found'; messageId: number; state: unknown }
  | { kind: 'no-pin' }
  | { kind: 'pin-not-ours' };

export interface SnapshotSource {
  readSnapshot: () => Promise<ReadSnapshotResult>;
  // existingMessageId undefined -> first-ever snapshot: sendDocument + pin. Otherwise ->
  // editMessageMedia against that message (D23: confirmed to work, repeatedly, with the
  // pin staying put). Returns the message id to persist as meta.snapshotMessageId.
  writeSnapshot: (stateJson: string, existingMessageId: number | undefined) => Promise<number>;
}

export function createSnapshotSource(options: {
  chatId: number;
  client: TelegramClient;
}): SnapshotSource {
  const { chatId, client } = options;

  async function readSnapshot(): Promise<ReadSnapshotResult> {
    const chat = await client.getChat(chatId);
    const pinned = chat.pinned_message;
    if (pinned === undefined) {
      return { kind: 'no-pin' };
    }
    if (pinned.document?.file_name !== SNAPSHOT_FILENAME) {
      return { kind: 'pin-not-ours' };
    }

    const { filePath } = await client.getFile(pinned.document.file_id);
    const bytes = await client.downloadFile(filePath);
    const state = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    return { kind: 'found', messageId: pinned.message_id, state };
  }

  async function writeSnapshot(
    stateJson: string,
    existingMessageId: number | undefined,
  ): Promise<number> {
    const document = { bytes: Buffer.from(stateJson, 'utf8'), filename: SNAPSHOT_FILENAME };

    if (existingMessageId === undefined) {
      const { messageId } = await client.sendDocument({ chatId, document });
      await client.pinChatMessage({ chatId, messageId });
      return messageId;
    }

    await client.editMessageMedia({ chatId, document, messageId: existingMessageId });
    return existingMessageId;
  }

  return { readSnapshot, writeSnapshot };
}
