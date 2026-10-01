# AGENTS.md — Any-Endpoint-V2 (MyProxy SaaS)

Guidance for AI coding agents working on or deploying this repository. Read this file first.

## What this project is

A secure proxy service that lets users call an OpenAI-compatible API using their ChatGPT subscription's Codex access:

```
User → MyProxy API Key (sk-myproxy-xxx) → Proxy Gateway → ChatGPT Token → Upstream API
```

Users authenticate their ChatGPT account via OAuth device-code flow; tokens are stored AES-256-GCM-encrypted in PostgreSQL. Users generate `sk-myproxy-xxx` API keys (HMAC-SHA256 hashed at rest) and use them against the proxy gateway, which exposes OpenAI-style endpoints (`/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/models`).

## Repository layout

| Path | Purpose |
|------|---------|
| `src/web/` | Web API server (Fastify, port 3000) — auth sessions, API keys, credentials, Codex connection routes |
| `src/proxy/` | Proxy gateway (Fastify, port 8080) — API-key auth, upstream forwarding, SSE streaming |
| `src/worker/` | BullMQ background worker — token refresh scheduler/processors |
| `src/codex/` | ChatGPT OAuth + device-code flow implementation |
| `src/db/` | Prisma client |
| `src/utils/` | API-key generation/hashing, encryption helpers |
| `src/config.ts` | Central config, reads env vars |
| `src/scripts/generate-keys.ts` | Generates `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `API_KEY_HASH_SECRET` |
| `prisma/` | Schema + migrations (PostgreSQL) |
| `frontend/` | Vite + React 19 + shadcn/ui dashboard; built to static files, served by nginx |
| `frontend/deploy/nginx.conf` | Reverse proxy: TLS termination, routes to web API and proxy |
| `docker-compose.yml` | Full stack: postgres, redis, web, proxy, frontend |
| `Dockerfile.backend` | Multi-stage build shared by `web` and `proxy` services |

## Tech stack

- Node.js >= 20.18, TypeScript (ESM, run via `tsx`; `npm run build` = `tsc --noEmit` type check only)
- Fastify 5, Prisma 5 + PostgreSQL 16, BullMQ + Redis 7, ioredis, ws
- Frontend: Vite, React 19, Tailwind, shadcn/ui (Radix), vitest
- Deploy: Docker Compose + nginx + Let's Encrypt (certbot webroot at `certbot/webroot`)

## Setup on a fresh server (full guide)

### Prerequisites

- Docker with the Compose plugin, and Node.js >= 20.18 (only needed for local dev / key generation outside Docker)
- A domain with DNS A-record pointing at the server (production TLS)
- Google OAuth credentials (for user login)
- OpenAI/ChatGPT upstream access details

### 1. Clone and configure environment

```bash
git clone https://github.com/arianmahmud87-ctrl/Any-Endpoint-V2.git
cd Any-Endpoint-V2
cp .env.example .env
```

Generate the secrets (requires Node deps for `tsx`; alternatively use `npx tsx`):

```bash
npm install
npx tsx src/scripts/generate-keys.ts >> .env
```

Then edit `.env` and fill in:

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Defaults work with the compose Postgres (`myproxy:myproxy@postgres:5432/myproxy`); the compose file overrides it for containers anyway |
| `REDIS_URL` | `redis://redis:6379` inside compose |
| `AUTH_SECRET` | From generate-keys output |
| `TOKEN_ENCRYPTION_KEY` | 64-char hex from generate-keys output — **back this up; losing it makes stored tokens unrecoverable** |
| `API_KEY_HASH_SECRET` | From generate-keys output |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth app (authorized redirect URI: `https://<domain>/api/auth/callback/google` — check `src/web/auth-session.ts` for the exact callback path) |
| `UPSTREAM_BASE_URL` | Upstream API base URL the proxy forwards to |
| `DOMAIN` | e.g. `https://your-domain.example` |

**Do not commit `.env`.** It is gitignored (`.env*` except `.env.example`).

### 2. Configure the domain (production)

- Edit `frontend/deploy/nginx.conf`: replace every occurrence of `anyendpoint.online` with your domain (server_name, ssl_certificate paths).
- Update `DOMAIN` in `.env` to match.

### 3. Issue TLS certificates (production)

The frontend container mounts `/etc/letsencrypt` read-only and `certbot/webroot` for the ACME challenge:

```bash
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w ./certbot/webroot -d your-domain.example -d www.your-domain.example
```

(Port 80 must be reachable; bring the frontend container up once on plain HTTP, or run certbot standalone before starting the stack.)

For local development, skip TLS and run the dev servers instead (see "Local development").

### 4. Build and start the stack

```bash
docker compose build
docker compose up -d
```

The `web` container runs `npx prisma migrate deploy` automatically on start. Verify:

```bash
docker compose ps
docker compose logs -f web      # migrations applied, server on :3000
docker compose logs -f proxy    # gateway on :8080
```

The worker (`src/worker`) is **not** in docker-compose; if token auto-refresh is needed, run it as an additional container/process:

```bash
docker compose run -d --name worker web node --import tsx src/worker/index.ts
```

(or add a proper `worker` service mirroring `web` with that command).

### 5. Smoke test

```bash
# Web API up
curl http://localhost:3000/api/keys        # expect 401/auth error, not connection refused

# Proxy gateway up
curl http://localhost:8080/v1/models -H "Authorization: Bearer sk-myproxy-invalid"   # expect 401

# Through nginx (production)
curl https://your-domain.example/v1/models -H "Authorization: Bearer sk-myproxy-invalid"
```

Then in the UI: sign in with Google, connect a ChatGPT account via the device-code flow, create an API key, and make a test call:

```bash
curl https://your-domain.example/v1/chat/completions \
  -H "Authorization: Bearer sk-myproxy-xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

### Migrating from an existing server

The repo does **not** contain runtime data. To move an existing deployment, also transfer:

1. **Database** — `pg_dump` the `myproxy` database on the old server, restore into the new Postgres volume.
2. **`.env`** — the exact same `TOKEN_ENCRYPTION_KEY` and `API_KEY_HASH_SECRET` are required, or all stored ChatGPT tokens and existing API keys become invalid.
3. **Let's Encrypt certs** — `/etc/letsencrypt` (or just re-issue on the new server).

## Local development (no Docker for app processes)

```bash
docker compose up -d postgres redis
npm install
npm run db:generate
npm run db:migrate
npm run dev:web      # terminal 1 — web API :3000
npm run dev:proxy    # terminal 2 — gateway :8080
npm run dev:worker   # terminal 3 — background worker
cd frontend && npm install && npm run dev   # terminal 4 — Vite dev server
```

## Common commands

| Task | Command |
|------|---------|
| Type check | `npm run build` (root) |
| Prisma client | `npm run db:generate` |
| Dev migration | `npm run db:migrate` |
| Prod migration | `npx prisma migrate deploy` |
| Frontend build | `cd frontend && npm run build` |
| Frontend tests | `cd frontend && npm test` |
| Frontend lint | `cd frontend && npm run lint` |

## Conventions and gotchas for agents

- **Never commit secrets**: `.env`, `frontend/.env.production`, any `**/auth.json`. The repo lives in a home directory — never `git add .`; add explicit paths only, and never stage `.aws/`, `.ssh/`, `.config/`, shell history, etc.
- `frontend-source/` is a nested, unrelated git repo (contains only `rork.json`) — leave it alone unless asked.
- Backend runs TypeScript directly via `tsx`; there is no compiled `dist` output. `npm run build` is a type check — keep it green.
- Prisma migrations are deployed with `migrate deploy` in containers; create new migrations with `npm run db:migrate` locally.
- Ports: web API 3000, proxy 8080, nginx 80/443. Both backend containers share `Dockerfile.backend`; the command differs in compose.
- Token encryption is AES-256-GCM (`src/utils/encryption.ts`); API keys are shown to the user exactly once, then only HMAC-SHA256 hashes are stored (`src/utils/api-key.ts`).
- Frontend uses `npm install --legacy-peer-deps` (see `frontend/Dockerfile`) due to React 19 peer ranges — match that if install fails.
- nginx upstream names (`web_api`, `proxy_api`) are defined in `frontend/deploy/nginx.conf`; check it before changing container names or ports.
