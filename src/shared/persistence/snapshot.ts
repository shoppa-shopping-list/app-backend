// TODO(D4, D26): read the pinned JSON document via getChat -> getFile -> JSON.parse. Needs
// the Cloudflare Worker relay (D26) — TELEGRAM_API_BASE, not api.telegram.org directly.
export function readSnapshot(): Promise<unknown> {
  throw new Error('not implemented: readSnapshot (D4, D26) — see docs/architecture-design.md');
}

// TODO(D4, D23, D26): write the snapshot via editMessageMedia (confirmed working, D23),
// keeping meta.snapshotMessageId in sync — required to write, useless for reading (D4).
export function writeSnapshot(): Promise<void> {
  throw new Error(
    'not implemented: writeSnapshot (D4, D23, D26) — see docs/architecture-design.md',
  );
}
