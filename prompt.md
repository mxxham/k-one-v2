# K-one-v2 — Continuation Prompt

Paste this prompt into a fresh session to continue the full rewrite of the **K-one warehouse management system**.

---

You are continuing a full rewrite of a warehouse management system (WMS) called **K-one**

("Sanchaya WMS / CKB × Shell Warehouse"). You must work ONLY from the files described below; ignore anything else on disk.

## Context files (read these first, in order)
1. `D:\K-one-v2\todo.md` — the full task checklist (S1–S16). Follow it in order.
2. `D:\K-one-v2\session.md` — architectural decisions, the API contract, exact parity gotchas, status enum values, MySQL→PostgreSQL schema notes, import specs, auth, and current progress.

## Project layout
- Target monorepo: `D:\K-one-v2` (create it). npm workspaces: `apps/api` (NestJS + TypeScript), `apps/worker` (BullMQ), `apps/web` (React), `infra/` (docker-compose + nginx), plus shared types package.
- Stack (fixed, do not change): NestJS + TypeScript backend · PostgreSQL · Redis · BullMQ worker · Nginx proxy · keep existing React frontend (adapt, don't rewrite).
- The ORIGINAL PHP system is the behavioral reference and lives at `D:\K-one\k-one\`:
  - API handlers: `D:\K-one\k-one\api\handlers\*.php` (25 files)
  - Business logic classes: `D:\K-one\k-one\classes\*.php` (14 files)
  - Schema: `D:\K-one\k-one\database.sql`
  - API contract doc: `D:\K-one\k-one\frontend\API.md`
  - Existing React frontend: `D:\K-one\k-one\frontend\src\` (pages, components, `lib\api.ts`)
- The original system can be queried live for exact behavioral parity: Docker containers `kone-app` (php) and `kone-db` (mysql). DB connect via `docker exec kone-app php -r '...PDO...'`. It serves the API at `http://localhost/k-one/api/index.php?module=X&action=Y`.

## Non-negotiable requirements
1. **1:1 parity**: same endpoints, same JSON shapes, same exact column/enum names, same HTTP codes (400/401/403/404), same exact Indonesian error/success messages as the PHP system. Read the PHP source (handlers + classes) before implementing each module and mirror its SQL WHERE/ORDER, pallet math, ledger writes, and status transitions exactly.
2. **Preserve parity gotchas** listed in session.md §4 (two pallet-math conventions, NULL-safe batch `<=>` → `IS NOT DISTINCT FROM`, two balance sources, when ledger is/isn't written, level = 5th char of location code, FEFO rules, number-generation algorithm with 20-try retry).
3. PostgreSQL port of the schema: enums → CHECK constraints or pg enums, `GROUP_CONCAT` → `string_agg`, `<=>` → `IS NOT DISTINCT FROM`, `CURDATE()` → locality, `ON DUPLICATE KEY` → `ON CONFLICT`. For any schema field the spec is uncertain about, verify against the LIVE mysql container (`kone-db`) before finalizing, and note it.
4. Excel import (inbound/outbound/stock/auto) must replicate exact header strings, exact validation/error messages (Indonesian), exact log templates, and exact transaction semantics from §7 of session.md. Large-file safety: imports run inside the BullMQ worker (async), never blocking an HTTP request; still use streaming (ExcelJS) and bounded memory.
5. The React frontend is NOT rewritten from scratch — you adapt `frontend/src/lib/api.ts` and the Vite proxy to the new backend URL, then verify every page against the contract. Fix only field-shape drift.
6. Async auto-import: `POST import/auto` should enqueue a BullMQ job and return an accepted status; worker does the pipeline; UI will poll. Keep the PARITY return shape for the job result payload (stats + log).
7. Provide Docker Compose (postgres, redis, api, worker, web-with-nginx) plus an Nginx config that proxies `/api` (or the configured route) to the NestJS app and serves the built React app. Use ports that don't collide with the existing PHP stack (`80` is taken by kone-app) — e.g. 8081 web / 3000 api.
8. Environment: Windows, PowerShell 5.1 (do not use `&&` between commands, chain with `;`; escape `$` as `$` via backtick inside PS double-quoted strings). Node v26, npm 11, Docker available.

## Working style
- Work through todo.md S1→S16 in order. Update `D:\K-one-v2\todo.md` as items complete (check off `[ ]`).
- After every substantive module step, run lint/typecheck/build for that app and fix errors before moving on.
- Decide ORM/pool: simplest reliable option is `pg` + raw SQL (queries already known), or TypeORM — pick ONE and stay consistent; document the choice in session.md.
- When a verification step needs the original vs new system compared, run the equivalent request against BOTH `http://localhost/k-one/api/...` (original) and the new dev server, and diff field names/shapes for the module you just built.
- Keep a running log of decisions/differences at the bottom of `D:\K-one-v2\session.md`.

## Definition of done
All 16 todos in todo.md complete, parity verified with a real multi-sheet workbook (master/wms/putaway/schedule) end-to-end, and `docker compose up` at `D:\K-one-v2` runs api + worker + postgres + redis + web, with the frontend app functional against the new API.

Start by reading `D:\K-one-v2\todo.md` and `D:\K-one-v2\session.md`, then begin with todo S1.