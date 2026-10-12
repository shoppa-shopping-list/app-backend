#!/usr/bin/env bash
# Manual fallback deploy to malina (§7 of docs/architecture-design.md). The normal path is
# CI → GitHub Release → deploy/pull-deploy.sh on the Pi; see deploy/README.md.
# Build happens here, on the dev machine — tsc on the Pi's 906 MB RAM is a bad time (D24).
# Ships into the same releases/<tag> + current layout and drops PAUSE so the poller doesn't
# revert this within minutes — `ssh malina rm ~/projects/shoppa-app-backend/PAUSE` to resume.
set -euo pipefail

# Not HOST — the app itself reads HOST from env, an exported dev value would redirect this.
DEPLOY_HOST=${DEPLOY_HOST:-malina}
REMOTE_DIR=/home/lit/projects/shoppa-app-backend
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TAG="manual-$(date +%Y%m%d-%H%M%S)"

cd "$SCRIPT_DIR"

# public/ is gitignored — shipping without it would deploy a frontend-less release.
if [[ ! -f public/index.html ]]; then
  echo "public/index.html missing — run 'npm run build:backend' in app-frontend first" >&2
  exit 1
fi

echo "==> building"
npm run build

echo "==> assembling $TAG (prod node_modules built here — runtime deps are pure JS)"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r dist public package.json package-lock.json "$STAGE/"
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
printf '%s\nbackend=%s (local)\n' "$TAG" "$(git rev-parse HEAD)" > "$STAGE/RELEASE"

echo "==> pausing the poller, uploading"
ssh "$DEPLOY_HOST" "mkdir -p $REMOTE_DIR/releases && touch $REMOTE_DIR/PAUSE"
rsync -az "$STAGE/" "$DEPLOY_HOST:$REMOTE_DIR/releases/$TAG/"

echo "==> switching current and restarting"
ssh "$DEPLOY_HOST" "cd $REMOTE_DIR && ln -sfn releases/$TAG current.tmp && mv -T current.tmp current && sudo systemctl restart shoppa-backend"

echo "==> done ($TAG). Poller paused — remove $REMOTE_DIR/PAUSE on the Pi to resume auto-deploys."
