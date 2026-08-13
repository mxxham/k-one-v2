# Spec 3 — StockTake / Report / Import

Source: `classes/StockTake.php`, `classes/Report.php`, `api/handlers/stocktake.php`, `reports.php`, `import_*.php`.

---

## 1. StockTake

### 1.1 take_number
`"ST-" . date('Ymd') . "-" . str_pad(rand(0,9999),4,'0')` (e.g. `ST-20240812-0042`). **No uniqueness collision check** — replicate as-is.

### 1.2 create(data) tx
- `created_by = user_id`. `status='Draft'`.
- `scope_locations = data.scope_locations` (JSON array or null).
- `scope_type`: `'location'` if scope_locations non-null AND not `[]`; else `'full'`.
- `take_date = date('Y-m-d')`.

### 1.3 autoLoadByLocations(takeId, scopeLocations) tx
```
SELECT s.id, s.product_id, s.batch_number, s.uom, s.quantity, s.expiry_date, s.location
FROM stock s
WHERE s.stock_status='Available' AND s.quantity>0
  AND s.location NOT IN ('QUA_SHELL','STAGING')
  [AND s.location IN (scope, ...)]   -- only when scope non-empty
ORDER BY s.location, s.product_id
```
For each row INSERT into stock_take_items:
`(stock_take_id, product_id, batch_number, uom, location, qty_system=stock.quantity, qty_physical=0, counter_1/2/3=NULL, status=NULL)`.
Returns count. Log `AUTO_LOAD`.

### 1.4 getSystemStock(productId, location?, batchNumber?)
```
SELECT COALESCE(SUM(quantity),0) total_qty FROM stock
WHERE product_id=? [AND location=?] [AND batch_number=?]   -- params only appended when non-null & non-empty
```
floatval. **No stock_status filter** (any row counts).

### 1.5 getActiveLockedLocations()
```
SELECT DISTINCT sti.location
FROM stock_take_items sti
JOIN stock_take st ON st.id = sti.stock_take_id
WHERE st.status IN ('Counting','Review') AND sti.location IS NOT NULL
```

### 1.6 Status flow
`Draft → In Progress → Completed → Cancelled` per DB enum `Draft/In Progress/Completed/Cancelled`, but code uses distinct states:
- `start_counting` → status `'Counting'` when first save_counters; states in code: `Draft`, `Counting`, `Review`, `Adjusted`, `Completed`, `Cancelled`.
- `advance_to_c2` → status `'Counting'` (already); etc.
- `finish_counting` (Review step) → status `'Review'`.
- `apply_adjustment` → status `'Adjusted'`, then `'Completed'`.
- `cancel` → `'Cancelled'`.
Verify DB enum vs code: DB has `Draft/In Progress/Completed/Cancelled` in schema but migration/dev created codes `Counting/Review/Adjusted`. Confirm on live mysql: `SHOW COLUMNS FROM stock_take LIKE 'status'`.

### 1.7 Steps
- `save_counters(takeId, items[][counter_1/2/3], userId)` tx.
- `advance_to_c2(takeId)` → rejects when status NOT IN ('Counting','Review'), else `UPDATE status='Counting'` (was counting_round).
- `save_review(takeId, items[][qty_physical], diffBy='Physical')` (Review step; from draft?): computes per item: `difference = qty_physical - qty_system`; status `'Plus'`/`'Minus'`/`'Clear'`.
- `finish_counting(takeId, userId)` → validates each item has physical count; `UPDATE stock_take SET status='Review', counting_round++?`, log FINISH_COUNTING.
- `apply_adjustment(takeId, items?=null)` tx:
  - Lock/validate status `'Review'`.
  - For each stock_take_item (either fetched or provided):
    - `systemQty = qty_system`, `physicalQty = qty_physical`.
    - If physicalQty != systemQty:
      - `UPDATE stock ...` — deduct physical difference from stock row at product/batch/location via:
        ```
        SELECT id, quantity FROM stock WHERE product_id=? AND batch_number<=>? AND location=? AND stock_status='Available' LIMIT 1
        ```
      - `UPDATE stock SET quantity = GREATEST(0, quantity - diff) WHERE id=?` (diff<0 → add back; impl per source).
      - Insert stock_ledger ADJUSTMENT row:
        `{transaction_type:'ADJUSTMENT', reference_type:'StockTake', reference_id:takeId, reference_number:takeNumber, batch_number, quantity_in / quantity_out=abs(diff), uom, pallet, balance=floatval(newStockQty), location, notes='[StockTake] {difference} | {take_number}'|'[StockTake] {difference} | {take_number} (physical: {qty_physical})'}`.
      - `UPDATE stock_take_items SET difference=?, status=? (Plus/Minus/Clear), qty_physical=?, qty_system=?`
  - Set status `'Completed'`.
- `getItems` ORDER BY `stock_take_items.id ASC`.

### 1.8 Accuracy
`{items_checked: n, matched: on hand, accuracy: %}`.

---

## 2. Report

### 2.1 daily(date, date_to)
`{summary:{...}, sections:{stock_summary:{...}, inbound_activity:{...}, outbound_activity:{...}, expiring_items:{...}, low_stock:{...}, ledger_summary:{...}}}` — exact SELECTs in `classes/Report.php`.

### 2.2 Other shapes
products / inbound / outbound / stock / ledger / picklist export data — shapes in `frontend/API.md` + `report_pdf/export.php` cells.

---

## 3. Excel Import — the full engine

### 3.1 Shared helpers (import_helpers.php)
- `import_parse_date`: Excel serial (>40000 → d M Y thunder 'Math floor' + convert epoch day), else `Y-m-d`, `d/m/Y` vs `m/d/Y` heuristic; empty/'0' → null; unparseable → null.
- `import_normalize_uom`: car/ctn→Carton, drm→Drum, pal→Pail, bag→Bags, ea/pcs→EA; else title-case trim.
- `import_uom_per_pallet`: drum→4, carton→product.uom_per_pallet ?? 44, pail→24, bags→1, ea→4.
- `import_header_index`, `import_resolve_col` (priority patterns; exact match > substring), `import_detect_header` (max keyword score; score <1 → index 0), `import_getter` (first non-empty non-'0'), `import_is_meta_row`.

### 3.2 import_stock_commit — returns `{imported, skipped, auto_created, auto_locations}`
- mode: `add` (only nonexistent), `replace` (delete first), `skip` (explicit skip of existing).
- duplicate key = `stock(product, batch, location, status)`.
- ledger: reference_type `'Stock Import'`, reference_id=0, reference_number=`'IST-YYYYMMDD-NNNN'`.
- notes `row.notes ?: 'Direct stock import'`.

### 3.3 import_auto pipeline (single transaction; rollback on any throw)
1. **Pass 1 — Master data**: infer uom from `uom_per_pallet` (upp<=1→Bags, <=8→Drum, <=28→Pail, else Carton); create/update products; log `"Master data: {c} produk baru, {u} diperbarui"`.
2. **Pass 2 — WMS + putaway → stock** (wms forced `stock_status='Available'`) commit mode `add`; **WMS → inbound** grouped by `manufacture_date ?: 'NO_GR_DATE'`; inbound status `'Dues In'`, notes `'Auto import (WMS) — GR: {gr}'`.
3. **Pass 3 — schedule → outbound** via `import_outbound_process_sheet(skipUnknown=true)`.
4. Non-master/wms/putaway/schedule sheets skipped.
- Returns:
```json
{success:true, message:"Auto import selesai. Semua sheet diproses dalam satu aksi.",
 stats:{products_created, products_updated, stock_imported, stock_skipped, stock_auto_created,
        inbound_orders, inbound_items, outbound_orders, outbound_items, outbound_skipped,
        skipped_sheets:["..."], log:["Order #N — Shipment: X", "SKIP (stok 0)...", "OD:... | FEFO OK (b@l)", ...]}}
```
- Log template set in import_auto.php (quoted verbatim in `session.md` §7 and this file gap).

### 3.4 import_outbound_process_sheet(shared sheet → outbound orders)
- Header keyword scan against the outbound template headers.
- Group rows by `shipment_no` (empty → `'NO_SHIPMENT_{i}'` counter).
- Per shipment: `Outbound::create({shipment_number, ship_to, expected_date: planDate, notes:'Imported from Excel | Shipment: ...'})`.
- Customer: code `'OUT-' + substr(strtoupper(preg_replace('/[^A-Za-z0-9]/','',name)),0,8)`; `INSERT ... ON DUPLICATE KEY UPDATE customer_name=customer_name` (keep first name).
- Items: product lookup order = product_code match → numeric-only product_code → (int)material → product_name LIKE %desc[:15]%.
- FEFO allocate `deliveryQty` (leaves 0 remainder → skip rest); skip when `stok==0` or `skipUnknown`.
- Bind allocated `stock_locations` → `INSERT IGNORE outbound_item_locations`.
- Log per item FEFO line `"OD:... | FEFO OK (b@l) | qty ..."`.
- Delete order if 0 items.
- Returns `{success:true, message:"Import selesai: {o} orders, {i} items dari {n} shipments", stats:{orders_created, items_imported, rows_skipped, errors:0}, log:[...]}`.

### 3.5 Templates (exact required headers)
inbound: `Shipment No, OD No, SO No, Item Code*, Uom*, ACTUAL QTY*, QTY ORDER, Pallet, Batch No, Manufacture date*, Exp Date*, Location, Remarks`.
outbound: `Plan Date, Shipment Number*, Order No (OD), Purchasing Document, Ship-to Party Code, Material*, Description, Delivery quantity*, Sales Unit*, Name of Ship-To Party, Location of Ship-To Party, Street / Address, Goods Issue Date, SO Number, TRANSPORT`.
stock: `product_code*, batch_number, location, quantity*, uom, manufacture_date, expiry_date, stock_status, notes`.

### 3.6 Memory / async
Original raised PHP memory to 512M for large sheets. In rewrite: imports run inside BullMQ worker (async), ExcelJS streaming, bounded memory — never on the HTTP request path. Response returns `{success:true, message:"Import sedang diproses", task_id}` and the frontend polls or receives a completion event.