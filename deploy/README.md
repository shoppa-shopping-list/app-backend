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

## Repeat deploys

```
./deploy.sh
```

Builds locally, rsyncs `dist/` + `public/` + package manifests, `npm ci --omit=dev` on
the Pi, restarts the service.

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
