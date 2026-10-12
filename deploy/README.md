## One-time host setup (already done on malina, 2026-09-10)

Node — Debian 12's apt only has nodejs 18.x, and this repo pins 26 (`.nvmrc`,
`package.json` engines). Installed straight from the official arm64 tarball instead of
adding a NodeSource apt source to a box that also runs nginx/Docker:

```
curl -fsSL -o node.tar.xz https://nodejs.org/dist/v26.8.2/node-v26.8.2-linux-arm64.tar.xz
sudo tar -xJf node.tar.xz -C /usr/local/lib/nodejs
sudo ln -sf /usr/local/lib/nodejs/node-v26.8.2/bin/{node,npm,npx} /usr/local/bin/
```

systemd unit (one-time; `../deploy.sh` doesn't install it, only restarts it if present):

```
scp deploy/shoppa-backend.service malina:/tmp/
ssh malina 'sudo mv /tmp/shoppa-backend.service /etc/systemd/system/ && \
  sudo systemctl daemon-reload && sudo systemctl enable --now shoppa-backend'
```

## Repeat deploys — automatic (pull-based)

Push to `main` here, or to `main` in `app-frontend`: its CI's `trigger-deploy` job
dispatches this repo's CI using the `BACKEND_DEPLOY_TOKEN` secret, a fine-grained PAT
scoped to this repo with Actions: read & write only. That token expires, and when it
does, frontend pushes stop deploying (the job warns and skips if the secret is missing).
`workflow_dispatch` works by hand too. CI's `release`
job builds `app-frontend@main` into `public/`, bundles `dist/` + `public/` + prod
`node_modules` into `shoppa-backend.tar.gz`, attests it (Sigstore build provenance) and
publishes it as the latest `deploy-*` GitHub Release (keeps 5).

On malina, `pull-deploy.sh` runs from `lit`'s crontab every 3 min. It only acts when
the latest release tag differs from `current/RELEASE`. It then verifies the attestation
offline with `gh attestation verify`: signer must be this repo's `ci.yml`, on
`refs/heads/main`, on a GitHub-hosted runner. If that passes, it unpacks to
`releases/<tag>`, swaps `current`, restarts the service and health-checks
`127.0.0.1:3000/`. If the health check fails, it rolls back. If the rollback comes up
healthy, the new tag is marked in `failed/` and isn't retried (`rm failed/<tag>` to retry
it). If the rollback is unhealthy too, the problem is the environment (e.g. the Telegram
relay), so nothing is marked and the next poll tries again. GitHub holds no credentials
for malina, and nothing new listens inbound.

Layout under `~/projects/shoppa-app-backend/`: `.env` and `data/` stay in the parent (the
unit's `WorkingDirectory`; `STATE_PATH` is relative to it), code lives in
`releases/<tag>/`, `current` → the live one. Log: `pull-deploy.log` next to it.

One-time setup (2026-10-12):

```
# gh CLI, from the official arm64 tarball, same as Node (no apt repo on a shared box)
curl -fsSL -o gh.tgz https://github.com/cli/cli/releases/download/v2.102.0/gh_2.102.0_linux_arm64.tar.gz
sudo tar -xzf gh.tgz -C /usr/local/lib && sudo ln -sf /usr/local/lib/gh_2.102.0_linux_arm64/bin/gh /usr/local/bin/gh
# script + unit (ExecStart now runs current/dist/index.js)
scp deploy/pull-deploy.sh malina:projects/shoppa-app-backend/
scp deploy/shoppa-backend.service malina:/tmp/ && ssh malina 'sudo mv /tmp/shoppa-backend.service /etc/systemd/system/ && sudo systemctl daemon-reload'
# cron
*/3 * * * * /home/lit/projects/shoppa-app-backend/pull-deploy.sh >> /home/lit/projects/shoppa-app-backend/pull-deploy.log 2>&1
```

Rollback by hand: `ln -sfn releases/<older-tag> current.tmp && mv -T current.tmp current &&
sudo systemctl restart shoppa-backend`, then `touch PAUSE` so the poller leaves it alone.

## Repeat deploys — manual fallback

```
./deploy.sh
```

Builds locally, ships a `releases/manual-<timestamp>` into the same layout, swaps
`current`, restarts, and drops a `PAUSE` file so the poller doesn't revert it. `rm PAUSE`
on the Pi to hand control back to CI.

## Public HTTPS (set up 2026-10-06, D19)

`https://shoppabot.duckdns.org` — the Telegram Mini App URL.

- **DNS**: DuckDNS. `~lit/projects/duckdns/update.sh` (cron, every 5 min, logs to
  `run.log` there) re-points the name at the home IP; its token sits next to it in a
  `600` file, not in this repo.
- **Router**: forwards 80 and 443 to malina. 80 stays needed — certbot's HTTP-01
  renewals use it (the `certbot.timer` that ships with the package renews).
- **nginx**: `nginx-shoppa.conf` here is a copy of `/etc/nginx/sites-available/shoppa` as
  deployed, certbot-managed TLS lines included. `/api/events` has buffering off (SSE).
  To recreate from scratch: install the file without the `# managed by Certbot` lines and
  the second `server` block, then
  `sudo certbot --nginx -d shoppabot.duckdns.org --register-unsafely-without-email --redirect`.

## `.env` on malina

`BOT_TOKEN`, `SESSION_SECRET`, and `ALLOWED_USER_IDS` need to be set for the handshake to
work at all; `TELEGRAM_API_BASE` + `RELAY_SECRET` point at the Cloudflare relay (D26) —
see `.env.example`.
