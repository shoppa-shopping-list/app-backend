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

## Not wired up here

No nginx server block, no TLS, no Cloudflare relay — `/api` stays unauthenticated
(CLAUDE.md), so the service is reachable only as `127.0.0.1:3000` on the Pi itself.
See architecture-design.md §7 for what's still open before this is internet-facing.
