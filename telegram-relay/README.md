# shoppa-telegram-relay

Cloudflare Worker that proxies outbound Telegram Bot API calls for `app-backend` running
on malina. `api.telegram.org` is blocked from that network (measured — see
`app-backend/docs/architecture-design.md` D26); Cloudflare's edge is not.

The bot token lives here as a Worker secret and is never sent to or stored on the Pi as
part of a URL. The Pi authenticates to this Worker with a separate `RELAY_SECRET` header.

Named `SHOPPA_BOT_TOKEN` rather than plain `BOT_TOKEN` — this Cloudflare account already
hosts another bot's relay (`tg-relay`); a generic secret name on a shared account invites
exactly the kind of cross-project mixup this avoids.

## Deploy

From this directory:

```sh
npx wrangler login          # one-time interactive Cloudflare auth (opens a browser)
npx wrangler secret put SHOPPA_BOT_TOKEN
npx wrangler secret put RELAY_SECRET   # same value that goes into app-backend's RELAY_SECRET
npx wrangler deploy
```

`wrangler deploy` prints the Worker's URL (`https://shoppa-telegram-relay.<subdomain>.workers.dev`).
That URL is `app-backend`'s `TELEGRAM_API_BASE` — no trailing slash.

To deploy non-interactively (e.g. from an agent or CI with no browser), set
`CLOUDFLARE_API_TOKEN` (a token with Workers Scripts Edit permission) in the environment
instead of running `wrangler login`, then `npx wrangler deploy` and set secrets via
`npx wrangler secret put <NAME>` (each prompts on stdin, or pipe a value in:
`echo -n "$VALUE" | npx wrangler secret put NAME`).

## Routes

- `POST /api/<method>` → `https://api.telegram.org/bot<TOKEN>/<method>`, forwarded as-is
  (JSON or multipart body). `<method>` must be one of the methods this app actually uses
  (`ALLOWED_METHODS` in `src/index.js`) — anything else is refused with `403`, per D26
  ("the Worker should also refuse any method it doesn't need").
- `GET /file/<file_path>` → `https://api.telegram.org/file/bot<TOKEN>/<file_path>`, for
  downloading a file after `getFile` returns its `file_path`.
- `GET /` → `200 ok`, no auth — a cheap reachability check
  (`curl https://<worker-url>/`).

All other routes, and any request missing a matching `X-Relay-Secret` header, get `401`/`404`.

## Local dev

`npx wrangler dev` runs the Worker locally; put `SHOPPA_BOT_TOKEN`/`RELAY_SECRET` in a
`.dev.vars` file (gitignored) for that — see Wrangler's docs on `.dev.vars`.
