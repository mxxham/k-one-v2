# K-one-v2 — Full Rewrite TODO

Stack: **NestJS + TypeScript** backend · **PostgreSQL** · **Redis** · **BullMQ** worker · **Nginx** · keep existing React frontend (adapted). Location: `D:\K-one-v2`.

Decisions (confirmed by user):
- Backend: NestJS + TypeScript
- Frontend: KEEP & adapt existing React SPA (in `D:\K-one\k-one\frontend`) — swap API layer to hit new backend
- Parity: 1:1 API contract + same DB schema (ported MySQL→PostgreSQL)
- Location: new folder `D:\K-one-v2` (PHP original stays as reference)

Scope of original system (for reference):
- 14 PHP classes (~6,300 LOC), 25 API handlers (~3,450 LOC), 22 React pages (~9,100 LOC), 515-line MySQL schema (20 tables)
- Core domain: Inbound, Outbound (FEFO), Stock + Ledger, StockTake, BinTransfer, Picklist, Locations, Products, Customers, Users, Reports, ActivityLog, Excel Import (inbound/outbound/stock/auto), Dashboards

- [x] **S1 Scaffold monorepo** `D:\K-one-v2`
  - npm workspaces: `apps/api` (NestJS), `apps/worker` (BullMQ), `apps/web` (React), `infra/` (docker-compose + nginx), `packages/` (shared types)
  - Deps: pg (or TypeORM / Prisma), ioredis, bullmq, nestjs, exceljs, zod/class-validator, jsonwebtoken
  - NOTE: `apps/api` fully scaffolded. `apps/worker` + `packages/shared` exist as stubs (package.json + tsconfig only — real code in S13). `apps/web` not yet created (deferred to S14/S15 — frontend is the existing React app being adapted). `infra/docker-compose.dev.yml` exists (postgres + redis only).
- [x] **S2 PostgreSQL schema** — port `database.sql` (20 tables) via migration SQL + seed (users, settings, special locations QUA_SHELL/UNALLOCATED/STAGING)
  - Keep exact column names/enums; enums→CHECK constraints or pg enums; `<=>` NULL-safe handling via IS NOT DISTINCT FROM; CASE/COALESCE/GROUP_CONCAT→string_agg; `SET SESSION group_concat_max_len`→no-op
  - DONE: `apps/api/src/database/migrations/001-schema.sql` (457 lines). Seeding via `apps/api/src/database/migrate.ts`.
- [x] **S3 Core infra**: config/env, DB pool/ORM, JWT auth + guards (write/admin), activity logger service, unified error/response shape `{success:true,...}`/`{success:false,message}`, date util (Asia/Jakarta), number generation race-safe helper (IN-/OUT-/PKL-/BTR-/ST- numbers, 20-try retry + fallback)
  - DONE: `config/` (env), `database/` (pg pool + migrate), `auth/` (JWT issue/verify + guards), `common/` (activity-logger, api-exception, exception-filter, date-util, number-gen, pallet), `dispatcher/` (gateway controller + action registry with per-action permissions). Choose `pg` + raw SQL (matches known PHP queries).
- [x] **S4 Master data**: products, customers, locations, users (all handlers from api/handlers/master.php etc.)
  - DONE: `master/master.actions.ts` registers `products` (list/all/detail/create/update/delete), `customers`, `locations` (incl. zone_summary/suggest/available), `users` (admin-only CRUD). Plus `master-data.service.ts` shared lookups (e.g. productOptions for ledger).
- [x] **S5 Stock domain**: list/summary/expiring/by_location/locations, ledger list/repair_all, transfer, adjust (exact balance/pallet math)
  - DONE: `stock/stock.actions.ts` registers `stock` (list/summary/expiring/by_location/detail/locations/transfer/adjust) + `ledger` (list/repair_all). Admin-only: stock adjust, ledger repair_all.
- [ ] **S6 Inbound module**: full handler parity (list/detail/stats/create/update/delete/items/pallet-locations/status flow/advance/complete/repair_ledger)
  - IN PROGRESS: `inbound/inbound.service.ts` written (~981 lines). NOT yet wired into the app — no `inbound.module.ts`, `app.module.ts` does NOT import InboundModule. 3 typecheck errors to fix in inbound.service.ts (lines 379, 382, 654).
- [ ] **S7 Outbound module**: full handler parity (list/detail/stats/check_stock/create/add_item FEFO/pick/ship/complete/delete/status)
- [ ] **S8 Picklist module**: create_from_outbound/confirm/complete/delete/update_item/export
- [ ] **S9 StockTake module**: create/auto_load/start/save_counters/advance/finish/review/apply_adjustment
- [ ] **S10 BinTransfer module**: create/execute/cancel
- [ ] **S11 Dashboard + reports + activitylog + system(reset)**
- [ ] **S12 Import**: inbound/outbound/stock/auto Excel import + templates (ExcelJS) — exact header strings, error messages (Indonesian), log formats
- [ ] **S13 BullMQ worker**: async auto-import job + Redis locks (FEFO/stock-take locks)
- [ ] **S14 infra**: docker-compose (postgres, redis, api, worker, web) + Nginx proxy (+ existing React build served)
- [ ] **S15 Frontend adapt**: change `@/lib/api` base URL/token to new backend; verify all pages; fix any field-shape drift
- [ ] **S16 Verify**: parity tests against PHP API responses (contract from frontend/API.md); smoke test with real workbook

Every spec detail needed for the port is recorded in `docs/spec-*.md` (produced by subagents 1–3).

EXACT references to keep handy are in session.md -> Specs section.