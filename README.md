# ShelfAware Backend

Cloudflare Worker (Hono) that ingests telemetry from the ShelfAware Raspberry Pi hardware and writes it to Supabase (PostgreSQL). The SvelteKit frontend reads from Supabase directly via `supabase-js`; it does not go through this Worker.

## Stack

- [Hono](https://hono.dev/) on Cloudflare Workers
- Supabase (PostgreSQL) for storage
- Vitest + `@cloudflare/vitest-pool-workers` for tests

## Prerequisites

- Node.js 20+
- A Cloudflare account, logged in via `npx wrangler login`
- Access to the Supabase project

## Setup

```bash
npm install
```

Create a `.dev.vars` file in the project root for local secrets (this file is gitignored):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-local-service-role-key
```

Non-secret config lives in `wrangler.jsonc` under `vars`. After changing `vars`, secrets, or bindings, regenerate the `Env` type:

```bash
npm run cf-typegen
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Worker locally via Wrangler (loads `.dev.vars`) |
| `npm test` | Run Vitest suite inside the Workers runtime |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` from `wrangler.jsonc` |

## Routes

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Service identity string |
| `GET` | `/health` | Liveness probe; returns `{ status, timestamp }` |

Feature routes (telemetry, shelves, auth) will be added in follow-up branches.

## Project layout

```
src/
  index.ts          # Hono app: middleware, health, error handling
test/
  index.spec.ts     # Smoke tests against the Hono app
wrangler.jsonc      # Worker config + non-secret vars
worker-configuration.d.ts  # Generated Env type (from cf-typegen)
```
