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
- State: RAM + `data/state.json`, atomic fsync'd writes, clone-and-swap rollback in `mutate()`
  on any throw.
- **Telegram tier**: `shared/telegram.ts` and `shared/persistence/{snapshot,render}.ts` are fully
  implemented, not stubs. `hydrate()`'s absent/corrupt branches consult Telegram for a snapshot
  before falling back to empty state. Absent-data and can't-reach-Telegram are **separate
  branches** — collapsing them into `catch → seed` would silently wipe real state whenever
  Telegram is briefly unreachable, so don't merge them.

`npm test` runs the suite, covering catalog, persistence, and state.

## What's stubbed, and why

- **No auth — every `/api` route is open.** Safe only because Fastify binds `127.0.0.1` and
  nginx isn't proxying to it yet. **Do not add the nginx server block until auth exists.**
- **No `list` slice** — it's a copy of `catalog` plus a membership check per route, omitted so a
  half-built copy doesn't add noise without a decision.

See the root [`CLAUDE.md`](../CLAUDE.md) for gotchas that aren't discoverable from the code.
