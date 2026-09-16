# app-backend

Fastify + TypeScript backend for Shoppa, a two-person shopping-list Telegram Mini App.

**This is a skeleton, not a full implementation.** The directory structure and toolchain are
real; one vertical slice (`catalog`) is wired end to end with the thinnest logic that proves
it. Read [What's stubbed, and why](#whats-stubbed-and-why) before extending it.

> `docs/architecture-design.md` has the full design and is gitignored (local-only) — it isn't
> in this repo. The two hazards below are the load-bearing parts of it; everything else you can
> re-derive from the code.

## Quickstart

```bash
node -v          # must be v26.x — see .nvmrc
npm install       # expect zero EBADENGINE warnings
npm run dev       # tsx watch; binds 127.0.0.1:3000; no .env needed, see .env.example
```

`npm run check` is the CI gate (lint, format, typecheck, tests, openapi drift, build) — run it
before pushing.

## What's implemented

- **`catalog`** slice: `GET /api/catalog`, `PUT /api/catalog/:productId`, `DELETE
/api/catalog/:productId`. The reference slice — copy its three-file shape (`*.schema.ts` /
  `*.service.ts` / `*.routes.ts`) for anything new.
- **`events`** slice: `GET /api/events`, an opaque SSE "something changed" ping.
- **`shopping-list`** slice: `GET /api/shopping-list`, `PUT /api/shopping-list/:productId`,
  `DELETE /api/shopping-list/:productId`. One flat, shared list — items are `{ addedAt,
addedBy }` keyed by `productId`, joined against `products` for `name`/`color` at read
  time (D27 in `docs/architecture-design.md`).
- **Auth**: `POST /api/session` exchanges a Telegram `initData` payload (local HMAC, no
  network call) for a signed `httpOnly` session cookie; every other `/api` route sits behind
  a preHandler that requires it. See `shared/auth.ts` and `features/session/`.
- State: RAM + `data/state.json`, atomic fsync'd writes, clone-and-swap rollback in `mutate()`
  on any throw.
- **Telegram tier**: `shared/telegram.ts` and `shared/persistence/{snapshot,render}.ts` are fully
  implemented, not stubs. `hydrate()`'s absent/corrupt branches consult Telegram for a snapshot
  before falling back to empty state. Absent-data and can't-reach-Telegram are **separate
  branches** — collapsing them into `catch → seed` would silently wipe real state whenever
  Telegram is briefly unreachable, so don't merge them.

`npm test` runs the suite, covering catalog, shopping-list, persistence, and state.

## What's stubbed, and why

- **No public HTTPS exposure yet.** Auth exists now (see above), but the nginx server block
  is still deliberately not added — that's gated on a domain + cert decision (D19), not on
  auth. The service is reachable only as `127.0.0.1:3000` on the Pi itself. **Do not add the
  nginx server block until that's resolved.**

See the root [`CLAUDE.md`](../CLAUDE.md) for gotchas that aren't discoverable from the code.
