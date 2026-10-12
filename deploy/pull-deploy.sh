#!/usr/bin/env bash
# Pull-based deploy, run from lit's crontab on malina. Polls the latest GitHub Release built
# by ci.yml's `release` job, verifies its Sigstore provenance (built by this repo's ci.yml,
# on refs/heads/main, on a GitHub-hosted runner), and swaps it in. GitHub holds no
# credentials for this box — the attestation is the only thing that makes a tarball trusted.
#
# Layout under BASE (WorkingDirectory of shoppa-backend.service — .env and data/ live here,
# never inside a release, because STATE_PATH=./data/state.json resolves against it):
#   releases/<tag>/   dist/ public/ node_modules/ package*.json RELEASE
#   current -> releases/<tag>
#   failed/<tag>      marker: unhealthy while the previous release was fine — not retried
set -euo pipefail

REPO=shoppa-shopping-list/app-backend
BASE=/home/lit/projects/shoppa-app-backend
KEEP=3
HEALTH_URL=http://127.0.0.1:3000/
GH=/usr/local/bin/gh
DL="https://github.com/$REPO/releases"

cd "$BASE"
# deploy.sh (manual fallback) drops this file so the poller doesn't revert a hand deploy.
[[ -e PAUSE ]] && exit 0
exec 9>"$BASE/.pull-deploy.lock"
flock -n 9 || exit 0

log() { echo "$(date -Is) $*"; }

latest=$(curl -fsSL --max-time 30 "$DL/latest/download/VERSION" | head -n1)
[[ "$latest" =~ ^deploy-[0-9]+\.[0-9]+-[0-9a-f]{7}$ ]] || { log "bad VERSION from GitHub: '$latest'"; exit 1; }

deployed=$(head -n1 current/RELEASE 2>/dev/null || true)
[[ "$latest" == "$deployed" ]] && exit 0
[[ -e "failed/$latest" ]] && exit 0

log "new release $latest (deployed: ${deployed:-none})"
work=$(mktemp -d "$BASE/.incoming.XXXXXX")
trap 'rm -rf "$work"' EXIT

curl -fsSL --max-time 300 -o "$work/shoppa-backend.tar.gz" "$DL/download/$latest/shoppa-backend.tar.gz"
curl -fsSL --max-time 60 -o "$work/bundle.json" "$DL/download/$latest/shoppa-backend.tar.gz.sigstore.json"

# Offline verification against the bundle — no GitHub login needed on the Pi.
GH_NO_UPDATE_NOTIFIER=1 "$GH" attestation verify "$work/shoppa-backend.tar.gz" \
  --bundle "$work/bundle.json" \
  --repo "$REPO" \
  --signer-workflow "$REPO/.github/workflows/ci.yml" \
  --source-ref refs/heads/main \
  --deny-self-hosted-runners >/dev/null
log "provenance verified"

mkdir -p releases failed "$work/tree"
tar -xzf "$work/shoppa-backend.tar.gz" -C "$work/tree" --no-same-owner
[[ "$(head -n1 "$work/tree/RELEASE")" == "$latest" ]] || { log "RELEASE inside tarball doesn't match $latest"; exit 1; }
[[ -f "$work/tree/dist/index.js" ]] || { log "tarball has no dist/index.js"; exit 1; }
rm -rf "releases/$latest"
mv "$work/tree" "releases/$latest"

previous=$(readlink current 2>/dev/null || true)

swap_to() {
  ln -sfn "$1" current.tmp
  mv -T current.tmp current
  sudo systemctl restart shoppa-backend
}

healthy() {
  for _ in $(seq 1 30); do
    sleep 2
    curl -fs --max-time 3 -o /dev/null "$HEALTH_URL" && return 0
  done
  return 1
}

swap_to "releases/$latest"
if healthy; then
  log "deployed $latest"
else
  log "health check failed for $latest — rolling back to ${previous:-nothing}"
  [[ -n "$previous" ]] || exit 1
  swap_to "$previous"
  if healthy; then
    # Only blame the release when the old one still boots — if both fail it's the environment
    # (e.g. Telegram relay down → hydrate() is fatal), and the next poll should retry.
    touch "failed/$latest"
    log "rollback healthy; $latest marked failed (rm failed/$latest to retry)"
  else
    log "rollback ALSO unhealthy — environment problem? will retry $latest next poll"
  fi
  exit 1
fi

# Prune: keep the newest $KEEP releases, never the one `current` points at.
keep_target=$(readlink current)
ls -1dt releases/*/ | sed 's#/$##' | tail -n +$((KEEP + 1)) | while read -r old; do
  [[ "$old" == "$keep_target" ]] || rm -rf "$old"
done
