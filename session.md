# K-one-v2 — Session Context & Port Spec

> Purpose: resume the full rewrite (PHP MySQL → NestJS + PostgreSQL + Redis + BullMQ + Nginx) if context is lost.
> Source-of-truth files: `D:\K-one\k-one\{api\handlers\*.php, classes\*.php, database.sql, frontend\API.md, frontend\src\pages\*.tsx}`

## 0. Decisions (user-confirmed)
1. Backend **NestJS + TypeScript**
2. Frontend: **keep & adapt existing React SPA** (it's already React+Vite+TS), swap API layer
3. **1:1 parity** — same endpoints, same JSON shapes, same schema (Postgres port)
4. New monorepo at **`D:\K-one-v2`**; PHP original stays as reference

## 1. Environment
- Windows; PowerShell 5.1 shell (use `;` chaining, NOT `&&`; escape `$` as backtick in PS double-quoted strings)
- Node v26.5.1, npm 11.17.0, Docker 29.7.2, git 2.55
- Original runs in Docker: `kone-app` (php:8.2-apache), `kone-db` (mysql:8.0). DB: `sanchaya`? No — actual db = `sanchaya@mysql`, user `root`/`root` (from container env: DB_NAME=sanchaya DB_USER=root DB_PASS=root DB_HOST=db). Port 80.
- API base: `http://localhost/k-one/api/index.php?module=X&action=Y`, Bearer token auth, JSON `{success:true,...}|{success:false,message}`.
- Frontend currently at `http://localhost:5173` (Vite dev). Login `admin`/`admin123` (PHP bcrypt; API.md says seeded password `password`, but dev login used admin123).

## 2. Original system scope (line counts)
- classes: ActivityLogger 200, Auth 101, BinTransfer 408, Customer 83, ExcelExport 940, Inbound 1057, LocationManager 419, Outbound 1270, PalletHelper 169, Picklist 345, Product 230, Report 156, Stock 297, StockTake 618 (total ~6,293)
- handlers (25): auth, inbound(436), outbound(316), dashboard(177), master(337), stock(119), stocktake(185), bintransfer(79), picklist(88), ledger(99), import(89), import_auto(242), import_helpers(181), import_inbound(183), import_outbound(283), import_stock(228), import_templates(180), reports(92), report(3→routes to reports), products/customers/locations/users (3 each → master), activitylog(3), system(58)
- React pages: 22 (Dashboard, InboundList, InboundDetail, OutboundList, OutboundDetail, Stock, StockTakeList, StockTakeDetail, PicklistList, PicklistDetail, BinTransfer, Products, Customers, Locations, Users, Ledger, Reports, Import, AutoImport, ActivityLog, Login, ResetData)
- Components: Layout, Card, Modal, StatusBadge, Pagination, Spinner, Toast, Field, PageHeader, ConfirmButton, WebBtn

## 3. API contract (from frontend/API.md) — must match exactly
Auth: POST `auth/login` `{username,password}`→`{token,user}`; logout; GET auth/me. Roles: admin/warehouse/supervisor/operator/staff; `canWrite`=admin,operator,warehouse,supervisor,staff; `canAdmin`=admin.

Modules & key endpoints (all under `?module=&action=`):
- **dashboard/stats**, dashboard/aisle_detail&aisle=
- **inbound**: list(status,od_no,page,per_page), detail(id), stats, search_products(q), create, update, delete, add_item, update_item, update_item_qty, update_item_dates, update_item_pallet_no, update_item_status, delete_item, save_pallet_locations, save_item_location, advance_status, complete, repair_ledger
- **outbound**: list, detail, stats, search_products, check_stock(product_id,quantity,location)→{available,fefo}, create, update, add_item, pick_items, ship, complete, delete, delete_item, update_item_status
- **stock**: list(status,expiring,q,location), summary, expiring(days), by_location, locations, transfer, adjust
- **ledger**: list(product_id,start_date,end_date,limit), repair_all
- **picklist**: list, detail, stats, create_from_outbound(outbound_id), confirm, complete, delete, update_item, export_data(id)
- **stocktake**: list, detail, stats, get_locations, get_scope_locations, get_stock, create, add_item, auto_load, update, delete_item, delete, start_counting, save_counters, advance_to_c2, finish_counting, save_review, apply_adjustment
- **bintransfer**: list, detail, locations_with_stock(product_id), stock_at_location(product_id,location), create, execute, cancel
- **products**: list(search,page,per_page), all, detail, create, update, delete
- **customers**: list(search,page), all, detail, create, update, delete
- **locations**: list(zone,available_only), all, check(code), available(count,zone), zone_summary, suggest(quantity,uom,uom_per_pallet,zone), create, update, delete
- **users** (admin): list, create, update, delete
- **report**: daily(date,date_to), products, inbound, outbound, stock, ledger
- **activitylog**: list(module,limit), modules
- **import**: tpl_inbound, tpl_outbound, tpl_stock (download), inbound, outbound, stock_preview, stock_commit, auto
- **system**: reset_operational_data (probably in system.php handler — verify)

Status values (exact strings):
- Inbound order: Draft, Dues In, Receiving, Good Received, Goods Received, Unserviceable, Picked, ATP, Completed, Cancelled
- Inbound item in_process_status: Dues In, Goods Received, ATP, Unserviceable (note real code uses only `Goods Received` — the enum also lists `Good Received`)
- Outbound order: Open, Picking, Picked, Shipped, Delivered, Completed, Cancelled
- Picklist: Draft, Confirmed, Picking, Picked, Completed, Cancelled
- StockTake: Draft, Counting, Review, Adjusted (detail), list uses In Progress
- Stock stock_status: Available, Reserved, Expired, Dues In, Rejected, Pending

## 4. CRITICAL parity gotchas
1. **Two pallet-math conventions**: `Inbound/Outbound/Stock` use `ceil(qty/uomPerPallet)` (whole pallets) or level-A `round(...,2/4)`; `PalletHelper::calculatePallet` uses `floor`+integer `%` returning decomposed object. Preserve both; use per-context.
2. **NULL-safe batch match** `batch_number <=> ?` (= IS NOT DISTINCT FROM in Postgres) everywhere EXCEPT `Outbound::deleteItem` AND `deleteItem` stock lookups which use `= ?`.
3. **Two balance sources**: `Stock::adjust` balance = `SUM(stock.quantity)` where status='Available'; ledger write balances = `SUM(quantity_in)-SUM(quantity_out)` excluding `QUA_SHELL` location and `TRANSFER_IN/TRANSFER_OUT` types; `Outbound::addToLedger` balance = plain SUM(in)-SUM(out) over whole ledger for that product (no exclusions); `BinTransfer::execute` balance anchor = last ledger row balance for product.
4. **`Inbound::complete()` writes stock, NEVER ledger**; ledger written only by the real-time receive/status-change flow (`inbound_change_item_status` in handler) and `regenerateLedger`. `Outbound::pickItems` writes NO ledger (ledger at ship time). `Stock::transfer` writes NO ledger. `Picklist::complete/updateItem` touch NO stock.
5. **Level = 5th char of location code** (`loc[4]`, uppercase): level 'A' → fractional pallets `round(qty/upp,2)`; other levels → `int ceil`. Level-aware pallet calc used in inbound stock-build and picklist.
6. **`Outbound::update` nulls order-level ship_to_name/location/street** (never updates them); second UPDATE sets `shipped_by=currentUser, status=?` whenever shipped_date or status provided.
7. **`Outbound::addItemWithFEFO`**: FEFO allocation is in-memory only at add time — does NOT write outbound_item_locations/stock_locations/ledger, does NOT decrement stock. Decrement happens ONLY in `pickItems`.
8. **`expected_date` is stored but NEVER validated/required** in Outbound (handler pick_items needs it — verify handler; picklist create requires expected_date per API contract? spec says Outbound.php doesn't require — the pick_items handler may).
9. **Number generation** race-safe: prefix `IN/OUT-YYYYMM-` / `PKL-YYYYMM-` / `BTR-YYYYMM-` / `ST-YYYYMMDD-` (+ optional item counter). Find latest by LIKE prefix, seq=suffix+1, up to 20 tries, fallback `prefix+His+rand(10,99)`.
10. **Message parity**: exact Indonesian messages everywhere (quoted in specs). HTTP codes: validation 400, 401 unauthorized, 403 forbidden, 404 unknown.
11. **GROUP_CONCAT(DISTINCT x ORDER BY x SEPARATOR ', ')** → Postgres `string_agg(DISTINCT x, ', ' ORDER BY x)`; `SET SESSION group_concat_max_len=65536` → ignore.
12. **uthash**: `location_code` comparisons use COLLATE utf8mb4_general_ci → Postgres just use normal = on text.
13. **timezone**: Asia/Jakarta; `date('Y-m-d')` = server date; `CURDATE()`/`NOW()` → `CURRENT_DATE`/`NOW()`; DATEDIFF → `(expiry_date - CURRENT_DATE)` in days.
14. **Booleans/tinyint** → `smallint`/`boolean`; `ON DUPLICATE KEY UPDATE` → `INSERT ... ON CONFLICT ... DO UPDATE`.

## 5. MySQL→Postgres schema port (database.sql, 515 lines)
Tables (20): users, customers, products, location_master, warehouse_locations, inbound_orders, inbound_items, outbound_orders, outbound_destinations, outbound_items, stock, stock_locations, outbound_item_locations, location_allocations, stock_ledger, picklists, picklist_items, stock_take, stock_take_items, bin_transfers, activity_log, settings.
Key columns & enums:
- users(pk, username uniq, password, full_name, email uniq, role ENUM admin/warehouse/supervisor/operator/staff default staff, is_active tinyint→bool)
- customers(pk, customer_code uniq, customer_name, contact_person, phone, email, address, city, is_active)
- products(pk, product_code uniq, product_name, category, description, drums_per_pallet int default 4, uom_type ENUM Drum/Carton/Pail/EA/Bags default Drum, uom_per_pallet int default 4, liters_per_unit decimal, max_sku_qty default 44, max_trans_qty default 80, default_location, max_per_transaction default 80, reorder_level default 0, is_active)
- location_master(pk, location_code uniq, aisle, rack, row_name, position, zone, is_active) + idx aisle/zone
- warehouse_locations(location uniq, aisle, bay, row_code, slot, is_active)
- inbound_orders(pk, order_number uniq IN-YYYYMM-NNNN, order_date date, carrier_name, container_no, po_number, shipment_no, do_number, armada_no, production_date, expected_date, status ENUM(...), notes, remarks, received_by→users, received_by_name, received_date, created_by→users NOT NULL) idx created_by, received_by
- inbound_items(pk, inbound_order_id FK cascade, od_number, so_number, product_id FK, batch_no, location, quantity dec(10,2), uom, actual_qty, pallet, pallet_no, manufacture_date, exp_date, stock_status ENUM Accepted/Rejected/Pending, in_process_status ENUM Dues In/Goods Received/ATP/Unserviceable/Picked default Dues In, notes, batch_number) idx od/so
- outbound_orders(pk, order_number uniq OUT-YYYYMM-NNNN, order_date, customer_id FK, so_number, do_number, shipment_number, ship_to_name, ship_to_location, ship_to_street, destination, kota, armada_no, container_no, jenis_armada, expected_date, status ENUM Open/Picking/Picked/Shipped/Delivered/Completed/Cancelled default Open, shipped_date, notes, shipped_by FK, created_by FK)
- outbound_destinations(pk, outbound_id FK cascade, seq tinyint unsigned, ship_to_name, ship_to_location, ship_to_street, kota, destination, notes)
- outbound_items(pk, outbound_order_id FK cascade, product_id FK, quantity, uom, actual_qty, pallet, batch_no, exp_date, location, in_process_status ENUM Goods Received/ATP/Unserviceable default Goods Received, gr_plan_no, transaction_no, notes, od_number, so_number, destination_id FK, batch_number, stock_location_id FK) idx od/so/dest
- stock(pk, product_id FK, batch_number, location, quantity, uom, uom_type ENUM Drum/Carton/Pail default Drum, uom_per_pallet int default 4, pallet, manufacture_date, production_date, expiry_date, stock_status ENUM Available/Reserved/Expired/Dues In default Available) idx product, expiry, status, location, fefo(product,status,expiry)
- stock_locations(pk, stock_id FK, location_code, pallet_seq smallint default 1, quantity, original_quantity, uom, is_full_pallet tinyint, batch_number, inbound_item_id, status ENUM Available/Reserved/Picked/Empty default Available) idx stock/location/status/batch
- outbound_item_locations(pk, outbound_item_id FK, stock_location_id FK, quantity) uniq(item,loc)
- location_allocations(pk, reference_type ENUM Inbound/Outbound/Stock, reference_id, item_id, pallet_number, location, quantity, uom, is_full)
- stock_ledger(pk, transaction_date date, product_id FK, transaction_type ENUM IN/OUT/ADJUSTMENT/TRANSFER, reference_type, reference_id, reference_number, batch_number, quantity_in, quantity_out, uom, pallet, balance, location, notes) idx product/date/ref
- picklists(pk, outbound_order_id FK cascade, picklist_number uniq PKL-YYYYMM-NNNN, created_date, status ENUM Draft/Confirmed/Picking/Picked/Completed/Cancelled, notes, created_by→users, confirmed_at, picked_at, completed_at)
- picklist_items(pk, picklist_id FK cascade, product_id FK, batch_no NOT NULL, location, quantity, uom, pallet, picked_quantity, status ENUM Pending/Picked/Verified default Pending, picker_id, notes, picked_at, batch_number, stock_location_id, pallet_seq)
- stock_take(pk, take_number uniq ST-YYYYMMDD-NNNN, take_date, status ENUM Draft/In Progress/Completed/Cancelled + uses Counting/Review/Adjusted in code (verify), notes, created_by→users, counting_round)
- stock_take_items(pk, stock_take_id FK cascade, product_id FK, batch_number, uom, location, qty_system, counter_1, counter_2, counter_3, qty_physical, difference, status ENUM Plus/Minus/Clear, notes, counter_by)
- bin_transfers(pk, transfer_number uniq BTR-YYYYMM-NNNN, transfer_date, product_id FK, stock_id, batch_number, from_location, to_location, quantity dec(12,4), uom, reason, status ENUM Pending/Completed/Cancelled, created_by FK, completed_by FK, completed_at)
- activity_log(pk, user_id, username, full_name, action NOT NULL, module NOT NULL, reference_type, reference_id, reference_no, description, old_value, new_value, ip_address VARCHAR(45)) idx user/module/ref/created
- settings(pk, setting_key uniq, setting_value, updated_at)
- auth_tokens (created by api/index.php on demand): user_id, token uniq varchar(64), expires_at, created_at. Token: bin2hex(random_bytes(32)) = 64 hex chars; TTL 12h.
Seed: users admin (password hash of `password`), settings (warehouse_name='Shell CKB Warehouse', drums_per_pallet='4'), location_master QUA_SHELL/UNALLOCATED/STAGING.

NOTE: source of truth for live schema differences = the running mysql container (kone-db) — queries can be run via `docker exec kone-app php -r` with PDO, or check `database.sql`. The migration SQL in dev had extra columns (scope_locations, scope_type, counting_round on stock_take; stock_take uses statuses Counting/Review/Adjusted). Confirm against live DB before finalizing migration.

## 6. AUTH
- login: verify bcrypt (probably password_hash) → issue token (auth_tokens). In dev container: username `admin`, password `admin123` (from earlier login test). API.md seed says `password`. Provide both in seed or verify via PHP.
- Guards: any auth required for all except auth module & tpl downloads. write roles = admin,operator,warehouse,supervisor,staff. admin only: users, stock adjust (per contract), delete product, delete location, stocktake apply_adjustment, ledger repair_all, system reset.

## 7. IMPORT specs (critical — this is what originally caused the 500)
- All uses `import_raise_memory_limit()` to 512M (already implemented in PHP source: import_helpers.php line 159, called in import_read_sheet/import_auto_run/import_run_outbound). In Node, no memory limit needed — but use **streaming** for big files and run in BullMQ worker.
- import_helpers: import_parse_date (Excel serial >40000 → Y-m-d; YYYY-MM-DD; D/M/Y vs M/D/Y heuristic; null for empty/'0'), import_normalize_uom (car/ctn→Carton, drm→Drum, pal→Pail, bag→Bags, ea/pcs→EA), import_uom_per_pallet (drum→4, carton→product(44), pail→24, bags→1, ea→4), import_header_index, import_resolve_col (priority patterns, exact>substring), import_detect_header (max keyword score; score<1→index 0), import_getter (first non-empty non-'0'), import_is_meta_row.
- **import_stock_commit** returns `{imported, skipped, auto_created, auto_locations}`; mode add/replace/skip; duplicate key = stock(product,batch,location,status); ledger ref `'Stock Import'` / `'IST-YYYYMMDD-NNNN'`, notes `row.notes ?: 'Direct stock import'`.
- **import_auto pipeline** (single tx, rollback on any throw):
  1. Pass1 master: infer uom from upp (upp<=1→Bags, <=8→Drum, <=28→Pail, else Carton); create/update products; log "Master data: {c} produk baru, {u} diperbarui"
  2. Pass2 WMS+putaway→stock (wms forced Available), commit mode add; WMS→inbound grouped by manufacture_date ?: 'NO_GR_DATE'; order status Dues In, notes 'Auto import (WMS) — GR: {gr}'
  3. Pass3 schedule→outbound via import_outbound_process_sheet skipUnknown=true
  4. skip sheets = not master/wms/putaway/schedule
  - Return `{success:true, message:"Auto import selesai. Semua sheet diproses dalam satu aksi.", stats:{products_created, products_updated, stock_imported, stock_skipped, stock_auto_created, inbound_orders, inbound_items, outbound_orders, outbound_items, outbound_skipped, skipped_sheets:[...]}, log:[...]}`
  - Log templates quoted in spec doc (see "Order #N — Shipment: X", "SKIP (stok 0)...", "OD:... | FEFO OK (b@l)", etc.)
- **import_outbound_process_sheet** (shared, also standalone import/outbound): header keyword scan; group by shipment (empty→'NO_SHIPMENT_{n}'); per shipment create outbound via Outbound::create with shipment_number, ship_to, expected_date=planDate, notes 'Imported from Excel | Shipment: ...'; customer resolve/create code 'OUT-'+8-char uc alnum of name, ON DUPLICATE KEY keep name; items: product lookup (code→numeric-only→(int)material→prodname contains desc[:15]); FEFO allocate deliveryQty; skip when stok 0 or skipUnknown; bind stock_locations, INSERT IGNORE outbound_item_locations; log per-item FEFO line; delete order if 0 items; return `{success:true, message:"Import selesai: {o} orders, {i} items dari {n} shipments", stats:{orders_created, items_imported, rows_skipped, errors:0}, log:[...]}`
- **import_templates**: headers exactly (with `* ` on required): inbound (Shipment No, OD No, SO No, Item Code*, Uom*, ACTUAL QTY*, QTY ORDER, Pallet, Batch No, Manufacture date*, Exp Date*, Location, Remarks); outbound (Plan Date, Shipment Number*, Order No (OD), Purchasing Document, Ship-to Party Code, Material*, Description, Delivery quantity*, Sales Unit*, Name of Ship-To Party, Location of Ship-To Party, Street / Address, Goods Issue Date, SO Number, TRANSPORT); stock (`product_code*`, `batch_number`, `location`, `quantity*`, `uom`, `manufacture_date`, `expiry_date`, `stock_status`, `notes`).

## 8. STATUS / PROGRESS
- [x] Root-caused + fixed the original PHP memory bug (500 on big Excel): memory_limit 128M→512M via `import_raise_memory_limit()` + docker php.ini. VERIFIED web import of 1.15MB works (returns proper JSON error on duplicate, no crash).
- [x] Cleaned test data from PHP DB (all STR/SHP/ZTEST test rows, customers, locations removed). DB back to seed state (users 4, no products/orders/stock).
- [x] **S1 Scaffold** — monorepo at `D:\K-one-v2`; `apps/api` (NestJS 11, `pg` + raw SQL), `infra/docker-compose.dev.yml` (postgres+redis). `apps/worker` + `packages/shared` are stubs; `apps/web` deferred to S14/S15 (frontend = existing React app).
- [x] **S2 Schema** — `apps/api/src/database/migrations/001-schema.sql` (457 lines, all 20 tables ported) + `migrate.ts` seed.
- [x] **S3 Core infra** — config/env, DB pool, JWT auth + guards (write/admin), activity-logger, api-exception + global filter, date-util (Asia/Jakarta), number-gen (race-safe, 20-try), pallet helper, dispatcher gateway + action registry with per-action permissions. Decision: **`pg` + raw SQL** (not TypeORM).
- [x] **S4 Master data** — products / customers / locations (incl. zone_summary, available, suggest) / users (admin) in `master/master.actions.ts`; shared `master-data.service.ts`.
- [x] **S5 Stock + Ledger** — stock list/summary/expiring/by_location/detail/locations/transfer/adjust + ledger list/repair_all in `stock/stock.actions.ts`. Permissions: stock.adjust=admin, ledger.repair_all=admin.
- [x] **S6 Inbound** — `inbound/inbound.service.ts` (~1045 lines), `inbound.module.ts` wired into `app.module.ts`. Typecheck clean (verified this session via `tsc --noEmit`, 0 errors). The previously-tracked 3 errors are gone.
- [x] **S7 Outbound** — `outbound/{outbound.service.ts,outbound.actions.ts,outbound.module.ts}` wired into `app.module.ts`. `pickItems`/`ship` implemented (working tree contains a larger uncommitted rewrite of the whole outbound module relative to the last commit `59b9d18`). Typecheck + `nest build` clean.
- [x] **S8 Picklist** — `picklist/{picklist.service.ts,picklist.actions.ts,picklist.module.ts}` wired into `app.module.ts`. See todo.md S8 note for exact port details.
- [x] **S9 StockTake** — `stocktake/{stocktake.service.ts,stocktake.actions.ts,stocktake.module.ts}` wired into `app.module.ts`. Schema: `stock_take` gained `scope_locations TEXT`, `scope_type VARCHAR(20) DEFAULT 'full'`, `counting_round VARCHAR(10)`; status CHECK `('Draft','Counting','Review','Adjusted','Completed','Cancelled')`. See todo.md S9 for full port detail.
- [x] **S10 BinTransfer** — `bintransfer/{bintransfer.service.ts,bintransfer.actions.ts,bintransfer.module.ts}` wired into `app.module.ts`. Numbers `BTR-YYYYMM-`; errors → 409; ledger TRANSFER_OUT then TRANSFER_IN with same pre-transfer currentBalance. See todo.md S10 for full port detail.
- [x] **S11 Dashboard + reports + activitylog + system(reset)** — `report/{report.service.ts,report.actions.ts,report.module.ts}` wired into `app.module.ts`. See todo.md S11 for full port detail.
- [x] **S12 Import** — `import/{import.helpers.ts, import.service.ts, sheet.reader.ts, import-templates.ts, import.actions.ts, import.module.ts}` wired into `app.module.ts`. SheetJS (`xlsx`) reads uploaded .xlsx/.xls/.csv; ExcelJS builds templates (streamed via gateway `_binary` marker + StreamableFile); global multer memoryStorage middleware in `main.ts`. stock_preview/stock_commit/inbound/outbound/auto ported with exact Indonesian messages, FEFO inline on tx client, PHP `inTransaction()` parity for nested outbound-in-auto. Frontend `ImportPage`/`AutoImportPage` contracts verified. See todo.md S12 for full port detail.
- [x] **S13 BullMQ worker** — `apps/worker/src/{main.ts, import.engine.ts, sheet.reader.ts}` (real BullMQ Worker on `kone:import`, standalone auto-import engine in one DB tx, Redis task status); `packages/shared/src/{import-helpers.ts, date-util.ts, redis-lock.ts, queue.ts}`; API `import::auto_async` + `import::task_status` (ImportQueueProvider in ImportModule); fail-open `RedisLockService` (CommonModule) wrapping outbound pick_items/ship (`fefo:<id>`) and stocktake finish_counting/apply_adjustment (`stocktake:<id>`). Fixed worker TS18003 — root `npm run typecheck` clean. See todo.md S13 for details.
- [x] **S14 infra** — `infra/docker-compose.prod.yml` (postgres+redis+api+worker+web), `infra/{api,worker,web}.Dockerfile`, `infra/nginx.conf` (SPA + `/k-one/api` proxy), `infra/.env.example`, `infra/README.md`. Added `apps/{api,worker}/tsconfig.build.json` (rootDir src, shared→built dist) to fix nested build output; root `build` runs shared first. `docker compose config` validates. See todo.md S14 for details.
- [x] **S16 Verify** — live parity smoke tests against running Docker infra. Docker daemon up → `k2-postgres`(5544)/`k2-redis`(6389) started, API :3000 + worker on `kone-import`. Verified: `auth::login`; all 13 core JSON modules; `export::` XLSX (customers/products/stock/ledger/report/stocktake + inbound/outbound with data); `print::` HTML (inbound_receipt/putaway/outbound_do/surat_jalan/picklist by id & outbound_id idempotent/report types); import (stock_preview/commit, inbound, outbound, auto sync + async); full stocktake workflow (auto_load 1099 items, start/save_counters/advance/finish/review/stats). User's real workbook `Warehouse Management System_11 Agustus 2026_.xlsx` imports cleanly (366 products, 1161 stock, 70 inbound/1100 items, 13 outbound/64 items, 16 sheets skipped). See todo.md S16 for the full bugfix list.
- Working dir note: the v2 source of truth is `D:\K-one-v2\todo.md` + `session.md` (per `prompt.md`). The `todo.md`/`session.md` sitting in the PHP reference repo (`D:\K-one\k-one\todo.md`/`session.md`) are STALE leftovers from the earlier abandoned Express+mysql2 port and should be ignored (do not let them confuse the v2 tracker).

## 9. Frontend adapt notes
- `frontend/src/lib/api.ts` (helper `api(module, action, {params, body})`) must point to new base URL and keep Bearer token semantics; response shape identical so most pages should work unchanged.
- Pages already built against contract in frontend/API.md. Any drift → JSON field names must be preserved exactly.
- vite dev proxy currently → host api URL; update to new backend origin.
- Tailwind v3, React 18, react-router 6, lucide-react. Build: `npm run build` (tsc -b && vite build) → dist served by nginx/web container.

## 10. Decision log — S8 Picklist (2026-08-13)
- **PHP source found**: unlike the earlier session (which reported the PHP tree was absent), `D:\K-one\k-one\` IS present in this environment. S8 was ported directly from `classes/Picklist.php` + `api/handlers/picklist.php` + `frontend/src/pages/Picklist*.tsx` + `frontend/API.md` — no guessing needed. Docker daemon is NOT running, so live-DB cross-checks were not possible; schema facts below are from `database.sql` + the PHP code usage.
- **Schema gap fixed**: `picklist_items.outbound_item_id` is absent from both the MySQL `database.sql` and the S2 Postgres port, yet the PHP `createFromOutbound` INSERTs it and `getItems` JOINs `oi.id = pki.outbound_item_id` — the live DB must have it (an ad-hoc column not in `database.sql`). Added `outbound_item_id BIGINT REFERENCES outbound_items(id)` to `001-schema.sql`. For already-migrated DBs run `ALTER TABLE picklist_items ADD COLUMN IF NOT EXISTS outbound_item_id BIGINT REFERENCES outbound_items(id);` (or delete the `schema_migrations` row for `001-schema.sql` and re-run).
- **updateItem omits picker_id**: API.md lists `{item_id, picked_quantity?, status?, picker_id?}` but `Picklist::updateItem` only sets picked_quantity/status/location/batch_number/batch_no/notes/picked_at. Ported exactly (no picker_id).
- **createFromOutbound is pure mirror**: early-returns existing picklist id (PHP), header created as `Draft` (not Confirmed), one `picklist_items` row per allocated stock_locations row when allocations exist, else one row per decomposed pallet (level-aware `calcPalletByLocation`). Writes NO stock/ledger and does NOT touch outbound status (matches PHP — the spec-2 §2.3 note about `status='Picking'` was not in the actual PHP class).
- **Next**: S9 StockTake (`docs/spec-3-stocktake-report-import.md` §1 + `classes/StockTake.php` + `api/handlers/stocktake.php`).

## 11. Decision log — S9–S12 (2026-08-13)
- **S9 StockTake**: status CHECK replaced (`('Draft','Counting','Review','Adjusted','Completed','Cancelled')`); `scope_type`/`scope_locations`/`counting_round` columns added; counters shape `saveCounters {itemId:{c1,c2,c3}}`, `saveC1/saveC2 {itemId:value}`; `finishCounting` re-snapshots via `IS NOT DISTINCT FROM` batch; avg_accuracy ported from `classes/StockTake.php`.
- **S10 BinTransfer**: errors → 409 conflict; ledger writes TRANSFER_OUT then TRANSFER_IN, both with the SAME pre-transfer `currentBalance` (PHP quirk). Widened `stock_ledger.transaction_type` CHECK to include `TRANSFER_IN`,`TRANSFER_OUT` (MySQL enum in database.sql is stale — the PHP writes these live).
- **S11 reports**: `report` daily wrapped `{report:{...}}`; activitylog module filter + action_label/module_icon maps; `system` reset_operational_data truncates 16 tables in one tx (admin only).
- **S12 Import**: SheetJS `xlsx` (not ExcelJS) reads uploaded workbooks since ExcelJS cannot parse `.xls`; ExcelJS still writes the 3 templates (matching `import_templates.php` header styling). Multipart via global `multer({memoryStorage}).any()` in `main.ts` (512MB cap). Gateway streams binary template responses through a `_binary` marker → `StreamableFile`; PUBLIC_ACTIONS covers `import::tpl_inbound/outbound/stock`. `outboundProcessSheet` honors an already-open transaction (PHP `$db->inTransaction()` parity) so `runAuto` keeps a single tx; `stockCommitTx`, `fefoAllocation`, `generateInboundNumber` (`IN-YYYYMM-`), `generateOutboundNumber` (`OB-YYYYMMDD-`) all operate on the tx-bound `QFn`. Auto-create product defaults `liters_per_unit=209.00, max_sku_qty=44, max_trans_qty=80, reorder_level=0, is_active=1` (parity). Frontend contracts (`ImportPage`, `AutoImportPage`) verified field-by-field; typecheck + `nest build` clean.
- **Next**: S13 BullMQ worker (add `apps/worker/src` to fix TS18003 root typecheck) → S14 infra → S15 frontend API adapt → S16 verify.

## 12. Decision log — S13 Worker (2026-08-13)
- **Async import is additive, not replacing sync**: the existing frontend (`ImportPage`/`AutoImportPage`) uploads synchronously via `import::auto` and reads the result inline. Spec-3 §3.6 wants async with `task_id` + polling. Implemented both: sync parity path unchanged; new `import::auto_async` enqueues to `kone:import` and returns `{task_id}`, `import::task_status` polls Redis status. Frontend can adopt `auto_async` later (S15 optional) without breaking anything.
- **Standalone engine in worker**: the worker's `runAutoImport` is a self-contained port of `ImportService.runAuto` (sheet classify, stock parse/validate/commit, master → products, WMS→inbound by GR date, schedule→outbound with FEFO). It runs on a plain pg `PoolClient` with no Nest DI; pure helpers come from `@k-one/shared` (moved out of the API local copy).
- **Redis locks fail-open**: `RedisLockService.runLocked` proceeds without the lock when Redis is unreachable — the sync parity path must never hard-fail because Redis is down; DB transactions remain the source of truth. When Redis is up, FEFO/stock-take critical sections are serialized across API + worker processes.
- **Shared package**: `packages/shared` gained `import-helpers`, `date-util`, `redis-lock`, `queue` (lock/queue/task key constants). Its `index.ts` re-exports everything; `tsconfig` path mapping (`@k-one/shared` → `packages/shared/src`) works for both api and worker.
- **Next**: S14 infra (docker-compose postgres/redis/api/worker/web + nginx proxy).

## 13. Decision log — S14 Infra (2026-08-13)
- **Build layout fix**: importing `@k-one/shared` via the tsconfig `paths` source mapping made `tsc` pick the monorepo root as `rootDir`, emitting api/worker output under `dist/apps/...` and leaving `dist/main.js` stale. Fix: dedicated `tsconfig.build.json` per app sets `rootDir: "src"` and resolves `@k-one/shared` from its *built* `dist` (`../../packages/shared/dist`). `@k-one/shared` must build first (root `build` = `build:shared && api && worker`; `nest build` auto-uses tsconfig.build.json; worker `build` switched to `tsc -p tsconfig.build.json`).
- **Web image context**: the React SPA lives outside the v2 repo (`D:\K-one\k-one\frontend`). The web Dockerfile's build context is the repo root and it copies `./frontend`; users must `xcopy /E /I D:\K-one\k-one\frontend D:\K-one-v2\frontend` first (documented in infra/README.md).
- **nginx**: serves SPA `try_files → index.html`, proxies both `/k-one/api/` (default `VITE_API_BASE`) and `/api/` to `http://api:3000/index.php`, forwards Authorization header, 512m body limit, 600s proxy timeouts (import uploads / long reports).
- **Compose**: `name: k-one-v2`; web published on host `:8081`; postgres/redis internal-only with healthchecks; api/worker depend on healthy deps. `docker compose config` validated.
- **Next**: S15 frontend API adapt (point `@/lib/api` base URL + token at new backend; verify pages; fix field drift).

## 14. Decision log — S15 Frontend + binary print/export (2026-08-13)
- **Scope**: user chose "Implement binary endpoints in v2" for the print/export buttons instead of keeping PHP coupling. Every remaining `webBase()` page link now hits the v2 API.
- **Binary contract**: gateway detects handler return markers — `{_binary:true,buffer,filename,contentType}` → StreamableFile + `Content-Disposition: attachment` (XLSX); `{_html:true,html}` → inline `text/html` so the print document opens in a new tab for `window.print()` (no PDF lib — same as PHP, which uses browser print). Auth for new-tab links works via `apiHref()` appending `?token=` (gateway `resolveUser` falls back to `req.query.token`).
- **New `export` module** (`apps/api/src/export/{excel-export.service,print.service,export.actions,export.module}.ts`): `ExcelExportService` mirrors `ExcelExport.php` + the inline `ledger.php`/`stock.php`/`stocktake.php` exports (ExcelJS); `PrintService` mirrors `print_inbound.php`, `putaway_sheet.php`, `print_outbound.php`, `surat_jalan.php`, `print_picklist.php`, `print_report.php` (self-contained HTML + A4 print CSS). `ExportModule` imports Inbound/Outbound/Picklist/Report/StockTake modules (all export their services) and is wired into `app.module.ts`.
- **Action list**: `export::inbound|outbound|customers|products|ledger|stock|stocktake|report`; `print::inbound_receipt|putaway|outbound_do|surat_jalan|picklist|report`. `print::picklist` accepts `id` or `outbound_id` (idempotent `createFromOutbound` then render — mirrors `picklist_pdf.php` redirect); permission `write` for `print::picklist`, `any` otherwise (frontend gates buttons via canWrite).
- **Ledger export parity**: `GROUP BY sl.id`, dates 2000-01-01..2099-12-31, correlated subqueries for od_number/so_number/shipment_no (Inbound/Outbound/BinTransfer variants), TX labels Penerimaan/Pengiriman/Penyesuaian/Pindah Masuk/Pindah Keluar. **Stock export parity**: per-location detail with `string_agg(DISTINCT ... ORDER BY ...)` for od_numbers/shipment_nos + `calcExpiry` port (EXPIRED / X days left / X mo X d left). **StockTake export**: detail rows + Clear/Plus/Minus + accuracy summary.
- **Frontend repoint**: `apiHref(module,action,params)` (already existed) replaces `webBase()` hrefs in InboundList, OutboundList, CustomersPage, ProductsPage, LedgerPage, StockPage, StockTakeDetail, ReportsPage (daily→print+excel with date/date_to), InboundDetail, OutboundDetail, PicklistDetail. `webBase()` kept but unused.
- **Next**: S16 Verify — with Docker daemon up, run parity smoke tests (login → each export/print endpoint vs PHP response shapes; real workbook import) against the running Postgres + API.
## 15. Decision log - S16 Verify (2026-08-13)
- **BullMQ queue name**: v6 rejects ':' in queue names -> QUEUE.IMPORT changed 'kone:import' -> 'kone-import' (worker + ImportQueueProvider).
- **PG vs MySQL tx semantics**: PHP's try/catch-continue around statements silently poisons a PostgreSQL transaction ('current transaction is aborted' masks the real first error). Removed the swallow-and-fallback patterns (outbound_items INSERT, outbound_item_locations bind, customer upsert, outbound_destinations INSERT) in both import.service.ts and worker import.engine.ts; ON CONFLICT covers the duplicate cases and real errors propagate.
- **Ad-hoc schema columns**: outbound_items.customer_id (PHP Outbound.php inserts it), picklist_items.outbound_item_id, outbound_destinations.ship_to_street (not street_address), stock_take scope_locations/scope_type/counting_round + statuses Counting/Review/Adjusted. The migration file had most already; the live dev DB predated later edits -> recreated dev DB from migration (DROP SCHEMA public CASCADE + npm run migrate) for guaranteed parity.
- **Outbound import order_number**: v2 used shipment_number as order_number (dup-key on re-import); PHP always generates OUT-YYYYMM-NNNN -> always generate, prefix aligned to PHP.
- **Next**: S17 - manual parity walk of remaining detail paths (outbound pick/ship with stock_locations drain, picklist confirm/picking, inbound receipt/putaway status flows, bin transfer execute/cancel) against PHP on real data; then docker-compose.prod up.

## 16. Decision log - S17 Verify detail paths + prod compose (2026-08-13)
- **MySQL alias-in-SET is invalid in PG**: PHP habit \UPDATE stock s SET s.manufacture_date=…\ breaks under PG (\column "s" of relation … does not exist\). Hit in inbound.service.ts \syncBatchToOutbound\ (broke inbound::complete) and \updateItemDates\; also a \SET pki.\ / \SET oi.\ pair. Fixed all three to bare column names (alias allowed in FROM only). Added a grep guard: pattern \SET \w+\.\ should stay empty.
- **inbound::complete idempotency**: import's stock snapshot already materializes stock for (product,batch,location), so complete()'s unconditional INSERT duplicated rows. Now deletes unlinked Available/Dues-In/Pending stock for (product,batch,location) before INSERT in both branches. Verified idempotent across a re-complete. Ledger side already idempotent (changeItemStatus delLedger→insertLedger).
- **Ledger accounting note (data interpretation, not a code bug)**: importing BOTH the stock snapshot AND open inbound orders means completing an imported inbound order adds a second set of IN ledger rows for goods the snapshot already counts (stock rows get replaced, not doubled, but ledger shows IST-… + Inbound IN rows). For a real go-live, either import inbound orders pre-completed (snapshot only) or treat imported inbound orders as already-received. Flagged for the user rather than silently re-engineered.
- **bintransfer.addLedger arity**: 13 columns vs 14 VALUES expressions (\CURRENT_DATE\ + \$1..\, 12 params). Matched PHP's \CURDATE() + 12 ?\. Balance for both TRANSFER_OUT and TRANSFER_IN stays the pre-transfer currentBalance (PHP parity) — do NOT "fix" to currentBalance±qty.
- **nginx proxy for /index.php**: the SPA always calls \\/index.php?module=…\ (frontend/src/lib/api.ts). A \proxy_pass http://api:3000/index.php\ under \location /k-one/api/\ rewrites \/k-one/api/index.php\ → \/index.phpindex.php\ (nginx replaces the location prefix with the proxy_pass URI). Fix: prefix locations with explicit \ewrite …/index\.php$ /index.php break\ + no-URI \proxy_pass http://api:3000\. Validated end-to-end against a live API through a scratch nginx container.
- **TS incremental builds in Docker**: with \incremental: true\, copying the local \	sconfig.build.tsbuildinfo\ into the image (via \COPY apps apps\) made \
est build\ skip JS emit (dist had only .d.ts + assets) → runtime MODULE_NOT_FOUND. Fixed with \**/*.tsbuildinfo\ in .dockerignore. Also added \**/node_modules\, \**/dist\, logs to .dockerignore (build context was shipping node_modules before).
- **API image must self-migrate**: prod compose has no migrate step and the API doesn't migrate on boot; also migrate.ts compiles to dist but the .sql files never reached dist. Added nest-cli \compilerOptions.assets\ (database/migrations/*.sql → dist) and api.Dockerfile CMD \
ode dist/database/migrate.js && node dist/main.js\ (idempotent). Validated: fresh stack boots, schema_migrations gets 001-schema.sql, seed present.
- **Full prod stack validated** in an isolated compose project (\-p k2v\ + override renaming containers/ports) so the running dev infra (k2-postgres/k2-redis host 5544/6389) was untouched; torn down cleanly after.
- **Next**: S18 — reconcile ledger-vs-stock accounting decision (see note above), consider auto-completing imported inbound orders, and any follow-ups the user picks from the S17 findings.


## 17. Decision log - S18 ledger-vs-stock reconciliation (2026-08-13)
- **Decision (user chose Option 1)**: treat the stock snapshot as reality; imported inbound orders are ALREADY-RECEIVED historical documents. The snapshot provides stock + a single `Stock Import` ledger IN set; imported inbound orders are written as `status='Completed'` with items `in_process_status='ATP'`, `stock_status='Accepted'`, WITHOUT materializing new stock/ledger. This removes the double-ledger-count flagged in S17 without re-engineering the import.
- **Change**: status `'Dues In'`->`'Completed'` / items `'Pending','Dues In'`->`'Accepted','ATP'` in all 3 import sites (identical SQL):
  1. worker `import.engine.ts` `autoCreateInbound` (async `import::auto_async` path)
  2. api `import.service.ts` `autoCreateInbound` (sync `import::auto` path)
  3. api `import.service.ts` `runInbound` (sync `import::inbound` path)
  Manual inbound creation (`inbound.service.ts create`) is untouched (still Draft/Dues In).
- **Validated end-to-end** on isolated scratch DBs (dev infra untouched; only dev API :3000 + dev worker remain running):
  - Async worker path (scratch worker on redis db1 + scratch DB k_one_opt1): IN-202608-0001 status Completed, item ATP/Accepted, `stock_ledger` has exactly 1 row (`Stock Import`), stock 30@C-01-01, outbound Open w/ 1 item. Also surfaced a pre-existing quirk: `importGetter` is exact-key so the toy schedule sheet's `ship to name` never matches the engine candidates -> auto import falls back to any existing customer (needs >=1 customer in DB). Not touched (orthogonal; real SAP export uses a recognized column).
  - Sync `import::auto` (scratch API :3002 / k_one_opt2): same result (Completed, ATP/Accepted, single Stock Import ledger row).
  - Sync `import::inbound` (same API): SHP-9001 status Completed, 2 items ATP/Accepted, no Inbound ledger rows.
  - No `Inbound` reference_type ledger rows in any scratch DB (double-count eliminated).
  - Scratch stacks + DBs (k_one_opt1/k_one_opt2) + redis db1 flushed + temp enqueue script removed.
- **Note**: if a future workbook contains genuinely-new (not-yet-received) inbound orders, Option 1 would pre-mark them Completed and stock would be missing for them (snapshot-only). Current data (all past-dated GR docs) is consistent; revisit if forward-dated orders appear.
- **Next**: none outstanding; dev API (:3000) + worker rebuilt and running with Option 1.


## 18. Decision log - import header-alias fix (2026-08-13)
- **Context**: while validating S18 Option 1, the toy workbook surfaced a pre-existing import quirk: header resolution is exact-key, so a schedule sheet header of `ship to name` never matched the engine''s ship-to candidates (`name of ship-to party` / `ship-to party` / `destination`) -> auto import silently fell back to any existing customer (or threw ''Tidak ada customer'' on an empty DB). Similarly `master` sheets using a plain `code` column were skipped (''kolom Material tidak ditemukan'').
- **Fix (additive aliases, no behaviour change for existing headers)**: added shared header-alias constants to both helper copies (`packages/shared/src/import-helpers.ts` + `apps/api/src/import/import.helpers.ts` - API keeps a local copy): `SHIP_TO_NAME_KEYS` (adds `ship to name`, `ship-to name`), `SHIP_TO_LOC_KEYS` (adds `ship to location`, `ship-to location`), `MASTER_PRODUCT_CODE_KEYS` (adds plain `code` at lowest priority). All 12 outbound ship-to resolution sites (worker `getAlt`+`ga` x3 each, api same) now use the constants; master code resolution uses `[...MASTER_PRODUCT_CODE_KEYS]` in both files.
- **Validated** (scratch DB k_one_opt3, NO pre-seeded customer, isolated worker on redis db1): master sheet processed (products_created 1, ''Master data: 1 produk baru''), customer auto-created from `ship to name` -> `PT Test Dua` (code OUT-PTTESTDU, city Gresik), outbound OUT-202608-0001 references customer_id 1, inbound still Completed/ATP (Option 1 intact), `stock_ledger` still a single `Stock Import` row. Scratch stack + DB dropped, redis db1 flushed.
- **Supersedes** the ''Not touched (orthogonal)'' remark in Decision log 17.
- **Next**: none outstanding; dev API (:3000) + worker rebuilt and running.
