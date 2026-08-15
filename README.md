# k-one-v2

A warehouse management system (WMS) built with **NestJS + TypeScript**, **PostgreSQL**, **Redis**, and a **BullMQ** worker, with a **React + Vite** frontend. Originally ported 1:1 from a PHP/MySQL system, now extended with department-based roles, stock hold/quarantine, barcode scanning, replenishment suggestions, wave planning, and zoning.

## Stack

| Layer | Tech |
|---|---|
| API | NestJS, TypeScript, raw SQL via `pg` (no ORM) |
| Worker | BullMQ (Redis-backed queue) — async imports |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 |
| Frontend | React, Vite, TypeScript, Tailwind CSS |
| Tests | Jest + Supertest (API e2e), Vitest (web + shared unit) |
| CI | GitHub Actions |

## Project structure

```
apps/
  api/      NestJS backend (dispatcher/action-registry pattern — see apps/api/src/dispatcher)
  worker/   BullMQ worker for async imports
  web/      React frontend
packages/
  shared/   Code shared between api/worker (import helpers, date utils, redis locks)
infra/
  docker-compose.dev.yml    Postgres + Redis for local dev
  docker-compose.prod.yml   Full stack (postgres, redis, api, worker, web + nginx)
docs/
  spec-*.md                 Module-by-module port specs (inbound, outbound, stocktake, WMS upgrade)
```

## Prerequisites

- Node.js **>= 20**
- Docker (for Postgres + Redis in dev)

## Setup

**1. Clone and install**

```bash
git clone https://github.com/mxxham/k-one-v2.git
cd k-one-v2
npm install
```

**2. Start Postgres + Redis**

```bash
npm run dev:infra
```

This runs `infra/docker-compose.dev.yml`, which starts Postgres on host port **5544** and Redis on host port **6389** (not the defaults — see `infra/docker-compose.dev.yml` if you need to change ports).

**3. Create your environment file**

Create `apps/api/.env` (this file is gitignored — you need to create it yourself):

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5544
DB_NAME=k_one
DB_USER=kone
DB_PASS=kone
REDIS_HOST=localhost
REDIS_PORT=6389
JWT_SECRET=replace-with-a-long-random-string
JWT_EXPIRES_HOURS=12
```

**4. Run database migrations**

```bash
npm run build:shared
cd apps/api
npm run migrate
cd ../..
```

**5. Start everything**

```bash
npm run dev
```

This starts the API (`:3000`), worker, and web frontend (`:5173`) together via `concurrently`.

## Common scripts (run from repo root)

| Command | What it does |
|---|---|
| `npm run dev` | Start infra + api + worker + web together |
| `npm run dev:infra` | Start Postgres + Redis only |
| `npm run stop:infra` | Stop Postgres + Redis |
| `npm run dev:api` / `dev:worker` / `dev:web` | Start one service individually |
| `npm run build` | Build shared package, then api, worker, web |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run lint` | Same as typecheck (`tsc --noEmit`) |

## Testing

```bash
# API e2e tests (spins up an isolated k_one_test database, requires Postgres reachable per apps/api/.env)
npm run test -w @k-one/api

# Web component tests
npm run test -w @k-one/web

# Shared unit tests
npm run test -w @k-one/shared
```

API e2e tests never touch your `k_one` database — they create and migrate a separate `k_one_test` database automatically. See `test-report.md` for test architecture notes and bugs the suite has caught.

CI (`.github/workflows/ci.yml`) runs typecheck, all three test suites, and a full build on every push/PR against Postgres + Redis service containers.

## Production deployment

```bash
cd infra
cp .env.example .env   # then edit values
docker compose -f docker-compose.prod.yml up -d --build
```

This builds and runs postgres, redis, api, worker, and web (served via nginx) as one stack, with the API migrating on boot.

## Documentation

- `docs/spec-1..4-*.md` — module-by-module specs from the original PHP→NestJS port
- `test-report.md` — test harness architecture, bugs found and fixed
- `new-roles.md` — department-based roles & permission matrix
- `deepseek-wms-upgrade-prompt.md` — WMS feature upgrade roadmap (hold/quarantine, barcode scanning, replenishment, wave planning)
- `todo.md` — full build history and current status

## License

Private/internal project.
