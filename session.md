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
- [ ] **S6 Inbound** — IN PROGRESS: `inbound/inbound.service.ts` (~981 lines) written but not wired (no `inbound.module.ts`; `app.module.ts` lacks InboundModule). 3 typecheck errors in inbound.service.ts (L379 rowCount-null, L382 rowCount-null, L654 `string | null | undefined`). Fix → add module → register in app.module → verify.
- [ ] S7 Outbound / S8 Picklist / S9 StockTake / S10 BinTransfer / S11 Dashboard+reports+activitylog+system / S12 Import / S13 Worker / S14 Infra / S15 Frontend / S16 Verify — not started.
- Working dir note: the v2 source of truth is `D:\K-one-v2\todo.md` + `session.md` (per `prompt.md`). The `todo.md`/`session.md` sitting in the PHP reference repo (`D:\K-one\k-one\todo.md`/`session.md`) are STALE leftovers from the earlier abandoned Express+mysql2 port and should be ignored (do not let them confuse the v2 tracker).

## 9. Frontend adapt notes
- `frontend/src/lib/api.ts` (helper `api(module, action, {params, body})`) must point to new base URL and keep Bearer token semantics; response shape identical so most pages should work unchanged.
- Pages already built against contract in frontend/API.md. Any drift → JSON field names must be preserved exactly.
- vite dev proxy currently → host api URL; update to new backend origin.
- Tailwind v3, React 18, react-router 6, lucide-react. Build: `npm run build` (tsc -b && vite build) → dist served by nginx/web container.