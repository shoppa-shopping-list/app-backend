#!/usr/bin/env bash
# Deploys app-backend to malina (§7 of docs/architecture-design.md).
# Build happens here, on the dev machine — tsc on the Pi's 906 MB RAM is a bad time (D24).
set -euo pipefail

HOST=malina
REMOTE_DIR=/home/lit/projects/shoppa-app-backend
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

# public/ is gitignored — the rsync --delete below would wipe the deployed frontend if it's empty.
if [[ ! -f public/index.html ]]; then
  echo "public/index.html missing — run 'npm run build:backend' in app-frontend first" >&2
  exit 1
fi

echo "==> building"
npm run build

echo "==> ensuring remote dir exists"
ssh "$HOST" "mkdir -p $REMOTE_DIR"

echo "==> syncing dist/ and public/ (siblings under REMOTE_DIR — app.ts resolves public/ from dist/'s location)"
rsync -az --delete dist/ "$HOST:$REMOTE_DIR/dist/"
rsync -az --delete public/ "$HOST:$REMOTE_DIR/public/"

echo "==> syncing package manifests"
rsync -az package.json package-lock.json "$HOST:$REMOTE_DIR/"

echo "==> npm ci --omit=dev on the Pi"
ssh "$HOST" "cd $REMOTE_DIR && /usr/local/bin/npm ci --omit=dev"

echo "==> restarting service (no-op if not installed yet — see deploy/README.md)"
ssh "$HOST" "sudo systemctl restart shoppa-backend 2>/dev/null || echo 'shoppa-backend.service not installed yet'"

echo "==> done"
