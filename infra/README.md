# K-one v2 — infra

## docker-compose.prod.yml
Full stack: postgres + redis + api (NestJS) + worker (BullMQ) + web (nginx serving the React SPA and proxying `/k-one/api` → api).

```powershell
# 1. Make the frontend available to the web image build context.
#    The web image expects ./frontend relative to the repo root.
xcopy /E /I /Y D:\K-one\k-one\frontend D:\K-one-v2\frontend

# 2. (optional) env overrides
Copy-Item infra\.env.example .env

# 3. Bring everything up
docker compose -f infra/docker-compose.prod.yml up -d --build
```

- Web UI: http://localhost:8081
- API: http://localhost:8081/k-one/api/index.php?module=&action=  (proxied)
- Postgres/Redis are internal (not published on host).

## docker-compose.dev.yml
Reference stack for local development (postgres on host `:5544`, redis on `:6389`).

## Images
- `api.Dockerfile` — builds `@k-one/shared` then `@k-one/api`; runs `node apps/api/dist/main.js`.
- `worker.Dockerfile` — builds `@k-one/shared` then `@k-one/worker`; runs `node apps/worker/dist/main.js`.
- `web.Dockerfile` — builds the React SPA (`VITE_API_BASE`, default `/k-one/api`) and serves `dist` via nginx.

## Build order (important)
`@k-one/shared` must be built before `@k-one/api` / `@k-one/worker` — the app `tsconfig.build.json`
files resolve `@k-one/shared` to its built `dist`. Root: `npm run build` handles this (`build:shared` first).