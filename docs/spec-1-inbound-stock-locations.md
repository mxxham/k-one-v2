# Spec 1 — Inbound / Stock / LocationManager / PalletHelper / ActivityLogger

Source: `classes/Inbound.php`, `classes/Stock.php`, `classes/LocationManager.php`, `classes/PalletHelper.php`, `classes/ActivityLogger.php` + receiving flow in `api/handlers/inbound.php`.

---

## 1. Inbound

### 1.1 Order number — `Inbound::generateNumber()`
- Prefix `"IN-{YYYY}{mm}-"` (server date).
- Find last: `SELECT order_number FROM inbound_orders WHERE order_number LIKE 'IN-YYYYmm-%' ORDER BY order_number DESC LIMIT 1`.
- `seq = trailing int (after final '-') + 1` else 1. Loop ≤20 tries, candidate `prefix . str_pad(seq,4,'0')`, check `SELECT id FROM inbound_orders WHERE order_number=? LIMIT 1`. First free wins; else fallback `prefix . date('His') . rand(10,99)`.
- **Override:** `create()` uses `$data['shipment_no']` (non-empty) as `order_number`, else generateNumber(). (shipment_no also stored in own column.)

### 1.2 Statuses & flow
- `inbound_orders.status` default `'Draft'`: Draft → Dues In → Receiving → Completed, + Cancelled. (Good Received/Goods Received appear only as item-level.)
- `advance_status` allows only `['Dues In','Receiving']`:
  - To Receiving: requires `received_by_id` + `received_date` non-empty else `"Received By dan Received Date wajib diisi saat Start Receiving."`. Sets status, received_by, received_date in one UPDATE.
  - To Dues In: status-only UPDATE.
  - Logs `ADVANCE_INBOUND_STATUS`.
- Delete guard: order `status IN ('Completed','Cancelled')` → 409 `"Order sudah selesai/dibatalkan dan tidak dapat dihapus."`
- Item delete guard (parent status): Completed/Cancelled → 409 `"Order sudah selesai/dibatalkan dan tidak dapat diedit."`; item `in_process_status='Goods Received'` deletable only by admin (403 otherwise).
- `complete()` precondition: `COUNT(*) FROM inbound_items WHERE inbound_order_id=? AND in_process_status NOT IN ('ATP','Unserviceable')` > 0 → 409 `"Tidak dapat complete: masih ada N item yang belum ATP atau Unserviceable…"`.

`inbound_items.in_process_status` (item): `Dues In` (default), `Goods Received`, `ATP`, `Unserviceable`. Only `Goods Received` spelling used in code.
`inbound_items.stock_status`: Dues In→`Pending` (default), Goods Received→`Pending`, ATP→`Accepted`, Unserviceable→`Rejected`.

**Item status transitions** (`update_item_status`): allowed `['Dues In','Goods Received','Unserviceable','ATP']`, else `"Status tidak valid."`

**Side effects** (`inbound_change_item_status` in api/handlers/inbound.php) — the real-time receiving writer:
1. `UPDATE inbound_items SET in_process_status=?, stock_status=?` (+ `location='QUA_SHELL'` when new=Unserviceable; `location=NULL` when old=Unserviceable and leaving).
2. `plt = ceil(totalQty/uom_per_pallet)`, `totalQty = actual_qty ?: quantity`.
3. Always first: `DELETE FROM stock_ledger WHERE reference_type='Inbound' AND reference_id=? AND product_id=? AND batch_number<=>?`.
4. Recompute running balance (see §1.8) then insert one ledger row `('IN','Inbound', inbound_order_id, order_number, date('Y-m-d'))`.
- → ATP: delete stock linked via stock_locations to item; `UPDATE stock_locations SET stock_id=NULL WHERE inbound_item_id=?`; if old was Unserviceable delete QUA_SHELL/Rejected stock; ledger `{qty_in=totalQty, pallet=plt, balance=cur+totalQty, location=item.location, notes='[Inbound] ATP | In-Process: ATP | {order_number}'}`.
- → Goods Received: if old was ATP also `DELETE FROM stock WHERE product_id=? AND batch_number<=>? AND stock_status='Available'`; if old was Unserviceable delete QUA_SHELL stock; notes `'[Inbound] Goods Received | In-Process: Goods Received | {order_number}'`.
- → Unserviceable: delete linked stock; `DELETE FROM stock_locations WHERE inbound_item_id=?`; `DELETE FROM stock WHERE ... stock_status IN ('Available','Dues In','Pending')`; insert stock `(product, batch, 'QUA_SHELL', totalQty, uom, plt, mfg, exp, 'Rejected')`; ledger with `location='QUA_SHELL'`, `balance=cur` (unchanged), notes `'[Inbound] Unserviceable (QUA_SHELL) | In-Process: Unserviceable | {order_number}'`.
- → Dues In: delete linked stock; `UPDATE stock_locations SET stock_id=NULL`; `DELETE FROM stock WHERE ... stock_status IN ('Available','Dues In','Pending','Rejected')`; delete ledger row; **no** ledger insert.
- Logs `UPDATE_ITEM_STATUS` `"Status item ID {itemId}: {old} → {new}"`.

### 1.3 create / update
`create($data)` tx: order_number = shipment_no override or generated; INSERT inbound_orders (order_number, order_date, carrier_name, po_number, shipment_no, do_number, container_no, armada_no, production_date, expected_date, received_by, received_date, status, notes, created_by); `status ?? 'Draft'`; `created_by = $_SESSION['user_id']`. `received_by` resolution: numeric→int; else `SELECT id FROM users WHERE full_name=? LIMIT 1`. Then loop items→addItem(). Commit; return inbound_id.
`update($id,$data)`: single UPDATE (order_date, carrier_name, po_number, shipment_no, do_number, container_no, armada_no, production_date, expected_date, status default 'Draft', notes). If received_date/received_by present → second UPDATE (name resolution same; fallback current user).

### 1.4 addItem($inboundId, $item)
1. `SELECT uom_type, uom_per_pallet, liters_per_unit, max_sku_qty, max_trans_qty FROM products WHERE id=?`; missing → `Exception("Product not found")`.
2. `quantity=floatval`, `uom = item.uom ?? product.uom_type`, `uomPerPallet = max(1,intval(uom_per_pallet ?? 4))`.
3. `pallet = calculatePallet(quantity, uomPerPallet)` = `ceil(qty/uomPerPallet)` (0 if divisor 0).
4. **Expiry auto-calc precedence:** manufacture_date non-empty → `exp_date = mfg + 4y` (overrides any provided exp); else if exp empty AND order has production_date → `exp = production + 4y`; else keep provided exp.
5. `batchNumber = item.batch_number ?? item.batch_no ?? null`; column always `batch_number`.
6. `firstLocation = item.pallet_locations[0].location_code ?? item.location ?? null`.
7. INSERT inbound_items (…, stock_status ?? 'Pending', in_process_status ?? 'Dues In'); `actual_qty = item.actual_qty ?? quantity`.
8. **Pallet-location skip:** if `in_process_status=='Unserviceable'` OR `stock_status=='Rejected'` → NO stock_locations rows.
9. Else if pallet_locations non-empty → `saveItemLocations(itemId, null, pallet_locations, batch, uom)`. Else if location non-empty → `calculatePalletDistribution(quantity,uomPerPallet)` attach `location_code=item.location`, `saveItemLocations`.

### 1.5 saveItemLocations($itemId, $stockId, $pallets, $batch, $uom='EA')
1. `DELETE FROM stock_locations WHERE inbound_item_id=?`.
2. Per pallet insert `(stock_id, location_code, pallet_seq=p.pallet_seq??p.pallet_number??1, quantity=floatval, original_quantity=same, uom, is_full_pallet=(p.is_full??true)?1:0, batch_number, inbound_item_id, status='Available')`.

### 1.6 Pallet math
- `calculatePallet($qty,$upp)`: 0 if upp==0 else `ceil(qty/upp)`.
- `calcPalletByLocation($qty,$upp,$loc)`: upp<=0→0; `level=strtoupper(loc[4])??'B'` (5th char); 'A'→`round(qty/upp,2)`; else `(int)ceil`.
- `calculatePalletDistribution($qty,$upp)`: `fullPallets=intdiv(qty,upp)`, `rem=qty%upp`; fullPallets entries `{pallet_seq:1..N, quantity:upp, is_full:true}` + remainder entry `{pallet_seq:N+1, quantity:rem, is_full:false}` if rem>0.
- `calculateExpiryDate($prodDate,$years=4)`: `+{years} years` → Y-m-d; null if empty/unparseable.

### 1.7 Item update/delete
- `updateItem($itemId,$data)`: UPDATE inbound_items (batch_number, location, quantity, uom, actual_qty, manufacture_date, exp_date, stock_status default 'Accepted', notes; uom default 'EA', quantity??0, actual_qty??quantity??0). If OK and pallet_locations non-empty → saveItemLocations.
- `updateItemDates($itemId,$mfg,$exp)`: writes dates (empty→NULL). If order status Completed: (a) `UPDATE stock s JOIN stock_locations sl ON sl.stock_id=s.id SET s.manufacture_date=?, s.expiry_date=? WHERE sl.inbound_item_id=?`; (b) `UPDATE stock SET manufacture_date=?, expiry_date=? WHERE product_id=? AND batch_number<=>?`.
- `updateItemPalletNo($itemId,$palletNo)`: trim + strtoupper; empty→null.
- `updateItemQty($itemId,$newQty)` tx: load item+order status+upp; `"Item tidak ditemukan"` if absent; `"Hanya item berstatus Dues In yang bisa diedit qty-nya"` if in_process_status!=='Dues In'; `"Qty harus lebih dari 0"` if newQty<=0. `newPallet=ceil(newQty/max(1,upp))`; `UPDATE inbound_items SET quantity=?, actual_qty=?, pallet=?`; `UPDATE stock SET quantity=?, pallet=?, updated_at=NOW() WHERE product_id=? AND batch_number<=>? AND stock_status IN ('Dues In','Pending')`. If stock_locations with stock_id IS NULL exist (ordered pallet_seq ASC): recompute distribution, reuse location codes positionally (fallback last), saveItemLocations.
- `deleteItem($itemId)` tx: load item+inbound_status. If order Completed and batch non-null and `qty=actual_qty?:quantity>0`: find `SELECT id, quantity, pallet FROM stock WHERE product_id=? AND batch_number=?` (+`AND location=?` if item.location) LIMIT 1. If found: newQty=max(0,qty-qty); palletRatio=qty/stock.quantity (else 1); newPlt=max(0,pallet-pallet*palletRatio); newQty<=0→DELETE else UPDATE. Ledger: `INSERT stock_ledger (transaction_date=NOW(), product_id, transaction_type='OUT', reference_type='Inbound-Reversal', reference_id=inbound_order_id, batch_number, quantity_in=0, quantity_out=qty, uom=item.uom??'Drum', balance=0, notes='Item deleted from completed inbound')` — no reference_number/pallet/location. Always: `DELETE FROM stock_locations WHERE inbound_item_id=?`; `DELETE FROM inbound_items WHERE id=?`.

### 1.8 Ledger balance (shared)
```
SELECT COALESCE(SUM(quantity_in),0)-COALESCE(SUM(quantity_out),0) AS running_balance
FROM stock_ledger WHERE product_id=?
  AND (location IS NULL OR location != 'QUA_SHELL')
  AND transaction_type NOT IN ('TRANSFER_IN','TRANSFER_OUT')
```
`balance = isRejected ? current : current + ledgerQty`; `ledgerQty = actual_qty>0?actual_qty:quantity`; `isRejected = in_process_status=='Unserviceable' || stock_status=='Rejected'`.

### 1.9 regenerateLedger($id) / addToLedger
regenerateLedger tx: `DELETE FROM stock_ledger WHERE reference_type='Inbound' AND reference_id=?`; for each item (skip `Dues In`) addToLedger. Returns true.
addToLedger writes one row: `('IN','Inbound', inbound.id, order_number, batchVal??item.batch, ledgerQty, 0, item.uom, ceil(ledgerQty/max(1,upp)), balance, isRejected?'QUA_SHELL':item.location, notes)`.
- transaction_date = `date('Y-m-d')` (not NOW()).
- notes rejected: `[Inbound] Unserviceable (QUA_SHELL) | In-Process: {label} | {order_number}`; else `[Inbound] {label} | In-Process: {label} | {order_number}`; label = in_process_status ?? (rejected?'Unserviceable':'ATP').

**Note:** `complete()` writes NO ledger (real-time receive flow does).

### 1.10 complete($id) tx
1. Load order+items. Map in_process_status→stock_status: ATP→Available, Picked→Available, Dues In→Dues In, Unserviceable→Rejected; fallback Available.
2. Skip items with in_process_status in ('Dues In','Goods Received').
3. Per item (pid, totalQty=actual_qty?:quantity, upp=max(1,uom_per_pallet??4), batchVal):
   - Cleanup: delete stock joined to stock_locations where inbound_item_id; `UPDATE stock_locations SET stock_id=NULL WHERE inbound_item_id=?`; delete stock product+batch at UNALLOCATED/null location without stock_locations; delete stock status IN ('Dues In','Pending') without stock_locations.
   - Unserviceable: `UPDATE inbound_items SET stock_status='Rejected', location='QUA_SHELL' WHERE id=?`; delete its stock_locations; delete stock QUA_SHELL/Rejected; insert stock (product,batch,'QUA_SHELL',totalQty,uom,ceil(totalQty/upp),mfg,exp,'Rejected'); continue.
   - Palletized (item locations non-empty): if |sum(rows.quantity)-totalQty|>0.001 → scale each `round(qty*totalQty/sum,4)`. Group by `location_code??'UNALLOCATED'.'|'.batch`; per group level=loc[4]; 'A'→`plt=round(qty/upp,4)` else `plt=count(rows)`; `plt=max(1,plt)`; INSERT stock (product,batch,loc,qty,item.uom,plt,mfg,exp,stockTarget); `UPDATE stock_locations SET stock_id=? WHERE id=?` per row. Remainder=totalQty-assigned; if >0.001 insert stock at 'UNALLOCATED' plt=max(1,ceil(rem/upp)); insert stock_locations (UNALLOCATED, pallet_seq=999, is_full=0, status='Available').
   - Non-palletized: loc=item.location??'UNALLOCATED'; plt=max(1,ceil(totalQty/upp)); insert one stock row; `UPDATE stock_locations SET stock_id=? WHERE inbound_item_id=?`.
   - `UPDATE inbound_items SET stock_status=(stockTarget==='Available'?'Accepted':'Pending') WHERE id=?`.
   - If stockTarget Available → `syncBatchToOutbound(pid,batchVal,exp_date)`.
4. `UPDATE inbound_orders SET status='Completed' WHERE id=?`; commit.

### 1.11 syncBatchToOutbound(pid,batch,expDate)
Skip if batch empty.
```
UPDATE outbound_items oi JOIN outbound_orders oo ON oi.outbound_order_id=oo.id
SET oi.batch_number=?, oi.batch_no=?, oi.exp_date=? WHERE oi.product_id=? AND (oi.batch_number IS NULL OR oi.batch_number='') AND oo.status IN ('Open','Picking','Draft')
UPDATE picklist_items pki JOIN picklists pkl ON pki.picklist_id=pkl.id JOIN outbound_orders oo ON pkl.outbound_order_id=oo.id
SET pki.batch_number=?, pki.batch_no=? WHERE pki.product_id=? AND (pki.batch_number IS NULL OR pki.batch_number='') AND pkl.status IN ('Draft','Confirmed') AND oo.status IN ('Open','Picking','Draft')
```

### 1.12 delete($id) tx
Per item: delete stock via stock_locations stock_id; if not unserviceable `DELETE FROM stock WHERE product_id=? AND batch_number<=>? AND stock_status IN ('Available','Dues In','Reserved')`; if unserviceable delete QUA_SHELL/Rejected; `DELETE FROM stock_ledger WHERE reference_type='Inbound' AND reference_id=? AND product_id=?`. Then: `DELETE FROM stock_ledger WHERE reference_type='Inbound' AND reference_id=?`; delete stock_locations via items; `DELETE FROM location_allocations WHERE reference_type='Inbound' AND reference_id=?`; delete inbound_items; delete inbound_orders.

### 1.13 Read queries
- `getAll($status,$limit,$offset,$odNo)`: `SET SESSION group_concat_max_len=65536`. Filters `io.status=?`, `ii.od_number LIKE '%..%'`. Select io.*, created_by_name, received_by_name, COUNT(DISTINCT ii.id) total_items, SUM(ii.actual_qty) total_qty, SUM(ii.pallet) total_pallet, GROUP_CONCAT(DISTINCT ii.od_number ORDER BY ii.id SEPARATOR ', ') od_numbers. GROUP BY io.id, `ORDER BY COALESCE(NULLIF(TRIM(io.shipment_no),''),io.order_number) DESC, io.order_date DESC, io.created_at DESC`; LIMIT/OFFSET.
- `countAll`: COUNT(DISTINCT io.id).
- `getItems`: join products (product_code, product_name, uom_type, uom_per_pallet), ORDER BY ii.id.
- `getItemLocations`: `SELECT sl.*, COALESCE(sl.original_quantity, sl.quantity) AS display_quantity ... ORDER BY sl.pallet_seq`.
- `getOrderLocations`: joins items+products, ORDER BY sl.pallet_seq.
- `getStats`: this_month (YEAR/MONTH of order_date=now), by_status group, dues_in count status='Dues In', pending=dues_in, receiving count status='Receiving'.

---

## 2. Stock

### 2.1 Identity
De-facto key = `product_id` + `batch_number` (always `<=>` null-safe), optionally + `location`. stock_status enum: Available, Dues In, Pending, Reserved, Rejected, Expired (Expired only in summary counts). uom copied on transfer.

### 2.2 Queries
- `getAll($status,$expiring)`: `SELECT s.*, p.product_code, p.product_name, p.category, p.uom_type, p.uom_per_pallet FROM stock s JOIN products p ON s.product_id=p.id WHERE s.quantity>0` + `AND s.stock_status=?` if status. expiring: `AND s.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) ORDER BY s.expiry_date ASC`; else `ORDER BY p.product_name, s.expiry_date ASC`.
- `getByProduct($pid)`: `WHERE product_id=? AND quantity>0 ORDER BY expiry_date ASC`.
- `getSummary`: COUNT(DISTINCT product_id) total_products, SUM(quantity) total_drums, SUM(pallet) total_pallets, COUNT(status='Available') available_items, +Reserved/Expired/Dues In from `WHERE quantity>0`. expiring = 30d+Available; critical=120d; expired=`expiry_date < CURDATE() AND quantity>0`; total_qty=floatval(total_drums).
- `getExpiringSoon($days=30)`: joins products, DATEDIFF days_until_expiry, `WHERE expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY) AND quantity>0 AND stock_status='Available' ORDER BY expiry_date ASC`.
- `getExpiryInfo($exp)`: red if expired; critical totalDays<=120; warning <=180. Text `"Expired {n} days ago"` or `"{months}m {days}d left"`.
- `getMovement($pid,$start,$end,$limit=100)`: joins products; optional product_id/date filters; `ORDER BY sl.transaction_date DESC, sl.created_at DESC`; LIMIT.
- `getStockByLocation`: `SUBSTRING_INDEX(location,'-',1) as area`, COUNT(DISTINCT product_id), SUM(quantity), SUM(pallet) WHERE quantity>0 AND location IS NOT NULL GROUP BY area ORDER BY area.

### 2.3 transfer($stockId,$newLoc,$qty=null) tx
- transferQty=qty??stock.quantity; >stock.quantity → `Exception("Transfer quantity exceeds available stock")`.
- Partial: `UPDATE stock SET quantity=quantity-?, pallet=pallet-? WHERE id=?` (palletReduction=ceil(transferQty/(stock.uom_per_pallet??4))); INSERT new stock (product,batch,qty=transferQty,uom=stock.uom,pallet=palletReduction,mfg,exp,newLoc,status). New row keeps batch/dates/uom/status.
- Full: `UPDATE stock SET location=? WHERE id=?`.
- **No ledger rows.**
- `adjust($stockId,$newQty,$reason)` tx: difference=newQty-oldQty; `UPDATE stock SET quantity=?, pallet=ceil(newQty/(upp??4))`; balance=`SUM(quantity) FROM stock WHERE product_id=? AND stock_status='Available'`; type=diff>0?'IN':'OUT'; ledger: `(CURDATE(), product_id, batch_number, type, qIn=qty if IN else 0, qOut=abs(diff) if OUT else 0, uom=stock.uom_type??stock.uom, pallet=difference/uomPerPallet (raw fractional!), reference_number='ADJ-{YmdHis}', reference_type='Adjustment', balance=balance+(IN?diff:0), location=stock.location, notes=reason)`.

---

## 3. LocationManager

### 3.1 Domain
location_master (id, location_code, aisle, rack, row_name, position, zone, is_active). Occupancy = stock_locations status IN ('Available','Reserved'). zone is free-text ordering hint only. Level = `row_name`. Occupancy comparisons use `location_code` with utf8mb4_general_ci collation.

### 3.2 Methods
- `getAll($zone,$availableOnly)`: master + occupancy as in source (exact SQL in original file); availability = 'Occupied' if any Available row; current_batch/stock_id from MOST RECENT row (max id); ORDER BY aisle,rack,row_name,position.
- `getAvailableLocations($count=20,$preferZone)`: fully empty locations (`NOT IN (SELECT DISTINCT location_code FROM stock_locations WHERE status IN ('Available','Reserved'))`); ORDER BY preferZone then aisle/rack/row/pos; LIMIT.
- `getAvailableLocationsByLevel($count=20,$preferZone,$levels=['B','C','D','E'])`: + `AND lm.row_name IN (levels)`.
- `isAvailable($loc)`: count==0.
- `getLocationInfo($loc)`: master LEFT JOIN sl(status A/R), stock, products LIMIT 1.
- `suggestLocationsForInbound($qty,$uom,$upp=4,$preferZone)`: upp<=0→4; fullPallets=intdiv, remainder=fmod, totalPallets=full+(rem>0?1:0). Fetch fullPallets+20 via levels BCDE, top up with plain. canAssignFull=min(full,count). Partial: try levels ['A'], else first available not among chosen, fallback 'STAGING'. Result `{pallet_seq, location_code, quantity, is_full, uom}`. success=(canAssignFull===fullPallets); failure msg `"Hanya {x}/{n} lokasi full pallet tersedia — sisanya tidak ter-assign"`. Returns {success,message,pallets,total_pallets}.
- `commitInboundLocations($stockId,$itemId,$batch,$pallets)`: INSERT stock_locations (stock_id, location_code, pallet_seq, quantity, uom default 'EA', is_full_pallet, batch_number, inbound_item_id, status='Available') ON DUPLICATE KEY UPDATE quantity, status='Available'.
- `getFEFOByLocation($pid,$requiredQty)`: exact SQL joins stock_locations+stock, `WHERE st.product_id=? AND sl.status='Available' AND sl.quantity>0 AND (st.expiry_date IS NULL OR st.expiry_date > CURDATE()) ORDER BY (expiry IS NULL), expiry ASC, sl.id ASC`. Walk rows take=min(qty,remaining); allocation `{sl_id, stock_id, location_code, pallet_seq, batch_number, expiry_date, quantity:take, uom, is_full:(take==row.quantity)}`. If remaining>0 → `{success:false, message:'Stok tidak cukup. Tersedia: {x}, Dibutuhkan: {y}', allocations:[]}` else {success:true, allocations}.
- `reserveForOutbound(allocations)`: current<=take→`UPDATE stock_locations SET status='Reserved' WHERE id=?`; else decrement + INSERT new row `(stock_id, location_code, pallet_seq, quantity=take, uom, is_full_pallet=0, batch_number, inbound_item_id, status='Reserved')`.
- `deductAfterShip(allocations)`: `UPDATE stock_locations SET status='Picked' WHERE id=?`; `UPDATE stock SET quantity=GREATEST(0,quantity-?) WHERE id=?`.
- `releaseReservation(allocations)`: `UPDATE stock_locations SET status='Available' WHERE id=?`.
- `getPicklistLocations($outboundItemId)`: stock_locations + location_master.zone, `WHERE sl.status IN ('Reserved','Available') AND sl.id IN (SELECT stock_location_id FROM outbound_items WHERE id=?) ORDER BY sl.pallet_seq`.
- `getZoneSummary()`: GROUP BY zone totals.

---

## 4. PalletHelper
- UOM_PALLET: Drum=4 | Carton=[36,44,48] | Pail=24. DEFAULT_PALLET: Drum=4|Carton=44|Pail=24.
- `calculatePallet($qty,$uom='Drum',$custom=null)`: capacity=custom??DEFAULT??4; pallets=floor(qty/capacity); remainder=qty%capacity; returns `{units, pallets, pallet_decimal:round(qty/capacity,2), remainder, pallet_capacity}` (**floor/% not ceil**).
- `palletToUnits(pallets,uom,custom)`: pallets*capacity.
- `getPalletCapacity(uom)`: DEFAULT[uom]??4.
- `validateQuantity($pid,$qty,$pdo)`: loads max_sku_qty(??44), max_trans_qty(??80); qty>maxTrans → `{valid:false,message:"Quantity exceeds maximum transaction limit ({maxTrans}). Maximum allowed: {maxTrans} units"}`; currentStock=SUM(Available); (cur+qty)>maxSku → `{valid:false,message:"Total stock would exceed maximum SKU limit ({maxSku}). Current: {cur}, Adding: {qty}, Max allowed: {maxSku}"}`; else valid.
- `calculateExpiryDate($prodDate,$years=4)`: +P{years}Y → Y-m-d (throws on invalid).
- `getExpiryInfo($exp)`: null→`{days:null,months:null,text:'No expiry',is_critical:false}`; else `{days, months:y*12+m, remaining_days:invert?-days:days, text, is_critical:invert||days<=120, is_expired:invert}`; text `"Expired {days} days ago"`/`"{months}m {d}d left"`.
- `generateLocations($totalPallets,$base='SUB50')`: `{pallet_number:i, location:'{base}-P'+pad2, is_full:true}`.
- `getProductUOMInfo($pid,$pdo)`: uom_type??'Drum', uom_per_pallet??4, liters_per_unit??209.
- `calculateLiters($qty,$lpu=209)`: qty*lpu.

---

## 5. ActivityLogger
Table: activity_log(id, user_id, username, full_name, action NOT NULL, module NOT NULL, reference_type, reference_id, reference_no, description, old_value, new_value, ip_address, created_at) + idx user/module/ref.
- `log(action, module, refType=null, refId=null, refNo=null, desc=null, old=null, new=null)`: user context from session; ip=REMOTE_ADDR; **action stored strtoupper; module stored strtolower**; old/new stored as `json_encode(..., JSON_UNESCAPED_UNICODE)` if non-null. Never throws; on Throwable → error_log + append `activity_log_debug.txt`.
- `getRecent($limit=50,$offset=0,$module,$userId,$refType,$refId)`: `SELECT al.*, u.full_name user_full_name, u.role user_role FROM activity_log al LEFT JOIN users u ON al.user_id=u.id WHERE {filters} ORDER BY al.created_at DESC LIMIT {n} OFFSET {m}`.
- `getForReference(refType,refId)` = getRecent(200).
- `countRecent(...)` / `actionLabel` / `moduleIcon` / `moduleColor`.

Call sites & actions (module lowercase, refType): inbound: CREATE_INBOUND, UPDATE_INBOUND, DELETE_INBOUND, ADD_INBOUND_ITEM, UPDATE_INBOUND_ITEM_QTY, DELETE_INBOUND_ITEM, UPDATE_ITEM_STATUS, UPDATE_PALLET_NO, UPDATE_ITEM_DATES, SAVE_PALLET_LOCATIONS, ASSIGN_LOCATION, ADVANCE_INBOUND_STATUS, COMPLETE_INBOUND, REPAIR_LEDGER (refType Inbound) · outbound: CREATE_OUTBOUND, UPDATE_OUTBOUND, DELETE_OUTBOUND, ADD_OUTBOUND_ITEM, DELETE_OUTBOUND_ITEM, PICK_OUTBOUND, SHIP_OUTBOUND, COMPLETE_OUTBOUND, UPDATE_ITEM_STATUS, UPDATE_OB_ITEM_STATUS (Outbound) · bin_transfer: BIN_TRANSFER, COMPLETE_BIN_TRANSFER, CANCEL_BIN_TRANSFER, CREATE_BIN_TRANSFER, EXECUTE_BIN_TRANSFER (BinTransfer) · stock/stocktake: CREATE_STOCKTAKE, ADD_STOCKTAKE_ITEM, UPDATE_STOCKTAKE, DELETE_STOCKTAKE_ITEM, DELETE_STOCKTAKE, START_COUNTING, ADVANCE_C2, FINISH_COUNTING, APPLY_ADJUSTMENT, APPLY_STOCKTAKE_ADJUSTMENT (StockTake) · stock: STOCK_TRANSFER, STOCK_ADJUST, REPAIR_ALL_LEDGER (Stock) · picklist: CREATE_PICKLIST, CONFIRM_PICKLIST, COMPLETE_PICKLIST, DELETE_PICKLIST (Picklist) · ledger: REPAIR_LEDGER · master: ADD_LOCATION/EDIT_LOCATION/DELETE_LOCATION (Location), CREATE_USER/UPDATE_USER/DELETE_USER (User), CREATE_PRODUCT/UPDATE_PRODUCT/DELETE_PRODUCT (Product), CREATE_CUSTOMER/UPDATE_CUSTOMER/DELETE_CUSTOMER (Customer) · auth: LOGIN/LOGOUT (User) · system: RESET_OPERATIONAL_DATA (System) · import_stock: IMPORT_STOCK (refType null).
- `actionLabel` map: CREATE_INBOUND 'Buat Inbound', UPDATE_INBOUND 'Edit Inbound', DELETE_INBOUND 'Hapus Inbound', ADD_INBOUND_ITEM 'Tambah Item Inbound', DELETE_INBOUND_ITEM 'Hapus Item Inbound', UPDATE_ITEM_STATUS 'Update Status Item', RECEIVE_INBOUND 'Terima Inbound', CREATE_OUTBOUND 'Buat Outbound', UPDATE_OUTBOUND 'Edit Outbound', DELETE_OUTBOUND 'Hapus Outbound', ADD_OUTBOUND_ITEM 'Tambah Item Outbound', DELETE_OUTBOUND_ITEM 'Hapus Item Outbound', PICK_OUTBOUND 'Pick Outbound', SHIP_OUTBOUND 'Kirim Outbound', COMPLETE_OUTBOUND 'Selesai Outbound', BIN_TRANSFER 'Transfer Bin-to-Bin', COMPLETE_BIN_TRANSFER 'Selesai Bin Transfer', CANCEL_BIN_TRANSFER 'Batal Bin Transfer'; fallback title-case.
- moduleIcon: inbound 'fas fa-arrow-down', outbound 'fas fa-arrow-up', bin_transfer 'fas fa-exchange-alt', stock 'fas fa-boxes', user 'fas fa-user', fallback 'fas fa-circle'. moduleColor: inbound #014f4e, outbound #026766, bin_transfer #026766, stock #e65100, user #37474f, fallback #607d8b.

---

## Cross-cutting gotchas
1. Two pallet conventions coexist (ceil vs floor) — preserve both per context.
2. `batch_number <=> ?` everywhere except Outbound::deleteItem (= ?).
3. Two balance sources (stock.quantity Available vs stock_ledger sums excl QUA_SHELL/TRANSFER).
4. complete() writes stock never ledger; ledger only from receive flow + regenerateLedger.
5. Level = 5th char of location code; only 'A' gets fractional pallets.
6. transfer() writes no ledger; adjust() writes one row with unrounded pallet=difference/upp, ref_number 'ADJ-{YmdHis}', ref_type 'Adjustment'.
