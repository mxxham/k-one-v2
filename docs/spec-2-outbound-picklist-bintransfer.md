# Spec 2 — Outbound / Picklist / Bin Transfer

Source: `classes/Outbound.php`, `classes/Picklist.php`, `classes/BinTransfer.php` + handlers `api/handlers/outbound.php`, `picklist.php`, `bintransfer.php`.

---

## 1. Outbound

### 1.1 Number generation
Prefix `"OUT-{YYYY}{MM}-"`. Lookup: `SELECT order_number FROM outbound_orders WHERE order_number LIKE 'OUT-YYYYMM-%' ORDER BY order_number DESC LIMIT 1`. `seq = (int)substr(last, -4) + 1` else 1 (exactly 4-digit suffix). Loop ≤20 tries: `candidate = prefix . str_pad(seq,4,'0')`, check `SELECT id FROM outbound_orders WHERE order_number=? LIMIT 1`. First free wins; else `seq++`. Fallback after 20: `prefix . date('His') . rand(10,99)`.

### 1.2 Status flow
`Open` (default) → `Picking` → `Shipped` → `Completed`; `Cancelled` set manually via `update`. `pickItems` requires status `Open`, refuses otherwise. `ship` → status `Shipped`, `shipped_by`=user, `shipped_date`=`date('Y-m-d')`. `complete` → status `Completed` (requires not Cancelled; refuses when already Completed with message). `update`/`updateItem`/`deleteItem` refuse on Completed/Cancelled.

### 1.3 getStats
`{this_month: {count, total_quantity}, by_status: {each status: count}, pending: count where status IN ('Open','Picking')}`.

### 1.4 check_stock ($productId,$qty,$location='')
Returns `{available: true, message, fefo: []?}` — in-memory FEFO feasibility check for a qty against current Available stock ordered by expiry; insufficient → available:false + message `"Stok tidak cukup. Tersedia: {x} ({loc}), Dibutuhkan: {y}"`.

### 1.5 addItemWithFEFO(binding fields: product_id, od_number, so_number, quantity, uom) — **in-memory only**
- Loads product for uom_per_pallet/max limits.
- qty = floatval; uom = binding.uom ?? product.uom_type.
- pallet = calculatePallet(qty, uomPerPallet) → ceil.
- **FEFO in-memory decrement simulation:**
  ```
  SELECT sl.id, sl.stock_id, st.batch_number, st.expiry_date, sl.location_code, sl.pallet_seq, sl.quantity, sl.uom, st.uom_per_pallet
  FROM stock_locations sl JOIN stock st ON sl.stock_id = st.id
  WHERE st.product_id=? AND st.stock_status='Available'
    AND sl.status='Available' AND sl.quantity>0
    AND (st.expiry_date IS NULL OR st.expiry_date > CURDATE())
  [AND sl.location_code = ?]  -- when binding.location_code present
  ORDER BY (st.expiry_date IS NULL) ASC, st.expiry_date ASC, sl.id ASC
  ```
- Walk rows, take = min(qty, row.quantity), append `{sl_id, stock_id, batch_number, expiry_date, location_code, pallet_seq, quantity:take, uom, is_full:(take==row.quantity)}` to `fe segments`; decrement remaining.
- remaining > 0 → `Exception("Stok tidak cukup. Tersedia: {sum}, Dibutuhkan: {qty}")` (fake took 0, rollback in-memory list).
- Does NOT write outbound_item_locations / stock_locations / stock / ledger; does NOT decrement anything. Only stores `outbound_items` row with `location = first allocation location_code`, `batch_number` withheld (set later by syncBatchToOutbound when inbound completes).
- Manual override (manual_location + manual_locs textarea) → forced rows skipped from FEFO logic; allocations serialized to JSON below.

### 1.6 pickItems(outboundId, outboundItemIds, pickerId?) tx
- `UPDATE outbound_item_locations` delete. Refuse unless status `Open` (`"Hanya order berstatus Open yang bisa di-pick"`).
- Load order, items. Per item: FEFO query above (with manual_locs json if present); allocate, take, remaining. Insufficient → `Exception("Stok tidak cukup untuk item {pid}: tersedia {x}, dibutuhkan {y}")`.
- **Extra picks scan:**
  ```
  SELECT sl.id, sl.stock_id, st.batch_number, st.expiry_date, sl.location_code, sl.pallet_seq, sl.quantity ... 
  ORDER BY (st.expiry_date IS NULL) ASC, st.expiry_date ASC, sl.id ASC
  ```
  for additional (same product batch already allocated to another item? no — pick all remaining rows for product to satisfy "picker picks full pallets"). Allocation: take rows until cumulative >= pending.
- Build allocations per item: for each allocation, if `sl.quantity <= take` set `status='Reserved'` on stock_locations; else decrement + insert new Reserved row (Ledger NOT written yet).
- Write `outbound_item_locations` INSERT for each allocation `(outbound_item_id, stock_location_id, quantity)`.
- Insert picklist rows per outbound item (product, batch_no=batchViaLocation ?? 'BAIK', location, quantity, uom, pallet, picked_quantity=0, status='Pending', picker_id). Per-item one picklist row.
- `UPDATE outbound_orders SET status='Picking', picked_by=?, picked_at=? WHERE id=?`.
- Log `PICK_OUTBOUND`.
- **Rollback semantics:** if `pickerId` empty → `picker = null`. Does NOT auto-set trimmed batch numbers.

### 1.7 ship(outboundId) tx
- Update item `in_process_status` per statuses (Picked/ATP handled per handler), `picked_by`, `picked_at`.
- Per item: calculate pallets from stock_locations where selected id; insert Ledger OUT row with balance = sum leading `quantity_in`/`quantity_out` for product; `location = selected stock_locations.location_code`.
- `UPDATE outbound_orders SET status='Shipped', shipped_by=?, shipped_date=? WHERE id=?`.
- Mark stock_locations `status='Picked'`; decrement stock.quantity by allocated total.
- Log `SHIP_OUTBOUND`.

### 1.8 complete(outboundId, shipmentNumber?, note?) tx
- Refuse Completed/Cancelled (`"Order sudah selesai/dibatalkan"`).
- Refuse when any order item `in_process_status` in ('Goods Received','ATP','Unserviceable','Picked') still outstanding with `actual_qty` — `complete` sets `status='Completed'` regardless unless cancellation logic mismatches. Actually: requires `status != 'Cancelled'` else message; when Completed already → return true + message `"Order sudah completed"`.
- `outbound_items.status='Completed'` batch update; `outbound_orders.status='Completed'`. shipment_number/note updated on orders row.
- Log `COMPLETE_OUTBOUND`.

### 1.9 deleteItem(outboundItemId) tx — **uses `=` not `<=>`**
- Load item + order status; `Completed/Cancelled` refuse (`"Order sudah selesai/dibatalkan dan tidak dapat diedit"`).
- Delete `outbound_item_locations where outbound_item_id=?`; release any Reserved stock_locations rows back to Available that match.
- `UPDATE outbound_items SET ... status/status_negated ... ` (per handler). Actually per source: refuses when order `status IN ('Completed','Cancelled')`. Reserved rows released; if `batch_number` set, `SELECT id FROM stock WHERE product_id=? AND batch_number=? AND stock_status='Reserved' LIMIT 1` → decrement/release via `releaseReservation(allocations)` single-level:
  `DELETE FROM stock_locations WHERE stock_location_id=? ...` hmm — confirmation from source.

### 1.10 update(outboundId, data) tx
- Load status; refuse `Completed`/`Cancelled`.
- `UPDATE outbound_orders SET ship_to_name=? (only non-empty), ship_to_location=?, ship_to_street=?, destination=?, kota=?, armada_no=?, container_no=?, so_number=?, do_number=?, shipment_number=?, expected_date=?, notes=?, status=COALESCE(data.status, current)`.
- **Ship-to fields NULLed always (never updated with new values);** SECOND UPDATE when `shipped_date` or `status` in data: `UPDATE outbound_orders SET shipped_by=?, status=? WHERE id=?` where status = data.status, and shipped_by=currentUser. (Ship fields stay null because only 4th UPDATE writes first 3 with `IF(data.field, data.field, current)`.)
- status changes → `status` stripped from data before first UPDATE; so only `status`+`shipped_by` matched.
- Log `UPDATE_OUTBOUND`.

---

## 2. Picklist

### 2.1 Number
`PKL-{YYYYMM}-NNNN`; same race-safe generateNumber pattern as Outbound.

### 2.2 Status flow
Draft → Confirmed → Picking → Picked → Completed → Cancelled. `confirm` → Confirmed (with confirmed_at=now), `complete` → Completed (requires picked_quantity=quantity per item; completed_at), `cancel` → Cancelled, `updateItem` changes picked_quantity/status=Picked + picker_id.

### 2.3 createFromOutbound(outboundId) tx
- Requires `expected_date` per API contract (handler validates) and picks `outbound_items` where `outbound_order_id=? AND status IN ('Open','Picking')` maybe — verify.
- Creates picklist + picklist_items mapping product/batch/location/pallet.
- `UPDATE outbound_orders SET status='Picking', picked_by=?, picked_at=?` on source.

### 2.4 complete / updateItem — touch NO stock/ledger
`Picklist::complete` updates picklist status only. Note: real pick/stock happens in Outbound::pickItems; picklist mirrors it. `updateItem` only sets picked_quantity + status + picked_at; does not decrement stock.

### 2.5 export_data(picklistId)
Two shapes (A4/F4): `{picklist, items: [{product_code, product_name, batch_no, location, quantity, uom, pallet, picked_quantity, status}]}`.

---

## 3. Bin Transfer

### 3.1 create(binTransfer) tx
- Validate `from_location != to_location`, product exists, `quantity>0`, `stock_id` optional.
- `INSERT bin_transfers (transfer_number=BTR-..., product_id, stock_id, batch_number, from_location, to_location, quantity, uom, reason, status='Pending', created_by)`.
- Log `CREATE_BIN_TRANSFER` (`"BinTransfer dibuat: {from} → {to} {qty}"`).

### 3.2 execute(id) tx
- Only `status='Pending'` allowed else `"Hanya BinTransfer berstatus Pending yang bisa dieksekusi"`.
- If order Cancelled → refuse.
- Load transfer + product `uom_per_pallet`.
- From stock: `UPDATE stock SET quantity = GREATEST(0, quantity - qty), pallet = GREATEST(0, pallet - palletDeduction)`; to stock: find `WHERE product_id=? AND batch_number<=>? AND location=? AND stock_status='Available'` → if exists `UPDATE ... quantity+?` + `pallet+?`; else INSERT new Available row (batch/dates/uom copied; pallet=palletDeduction).
- Note: `palletDeduction = ceil(qty / max(1, uom_per_pallet))`.
- **Ledger:** balance anchor = `SELECT balance FROM stock_ledger WHERE product_id=? ORDER BY id DESC LIMIT 1` for new `location`; then insert `(IN, TRANSFER_IN, ref=bin_transfer.id)` @ to-location with balance=anchor+qty, and `(OUT, TRANSFER_OUT, ref)` @ from-location with balance=anchor-qty.
- `UPDATE bin_transfers SET status='Completed', completed_by=?, completed_at=NOW()`, `completed_by=user`.
- Log `EXECUTE_BIN_TRANSFER`.

### 3.3 cancel(id) tx
- Only `Pending` allowed else `"Hanya BinTransfer berstatus Pending yang bisa dibatalkan"`.
- `UPDATE bin_transfers SET status='Cancelled'`.
- Log `CANCEL_BIN_TRANSFER`.

---

## Cross-cutting gotchas
1. `Outbound::deleteItem` uses `batch_number = ?` (plain `=`) while everything else uses `<=>`.
2. `pickItems` is the ONLY writer of outbound allocations + Reserved stock_locations + stock decrement; addItemWithFEFO touches nothing.
3. Ledger for stock_locations-based decrement is written ONLY in `ship` (per-item balance = whole-ledger sum, no seed rows).
4. Ship-to fields on Outbound::update are NULLed/never refreshed.
5. Picklist mirrors real pick state but never writes stock/ledger.