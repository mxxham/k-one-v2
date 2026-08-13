# K-one React SPA — API Contract & Build Guide

Base URL: `http://localhost/k-one/api/index.php?module=X&action=Y`
All requests carry header `Authorization: Bearer <token>` (the token is already added by `@/lib/api`).
Use the helper: `import { api } from '@/lib/api'` → `api(module, action, { params, body })`.
- `params` → query string, `body` → JSON POST body.
- Response: `{ success: true, ...data }` or throws `Error(message)` on failure.
- On HTTP 401 the message is "Unauthorized" — the auth guard handles redirect.

Shared UI (`@/components`):
- `PageHeader {title, subtitle?, actions?}` — teal gradient banner.
- `Card {title?, children, actions?, className?}` + `EmptyState {message}`.
- `Modal {open, onClose, title, children, size?}` — size sm/md/lg/xl.
- `StatusBadge {status}` — colored pill for order/stock statuses.
- `Pagination {page, totalPages, total?, onChange}`.
- `Spinner {label?}`, `ConfirmButton {label, onConfirm, confirmText?, children?}`.
- `Field {label, required?, hint?, children, className?}`, `TextInput`, `Select`, `TextArea`, `Grid {cols?}`.
- `useToast()` → `toast('success'|'error'|'info', message)`.
- `useAuth()` → `{ user, canWrite, canAdmin, logout, ... }`.
- `fmtNum(v, digits?)`, `fmtDate(v)`, `fmtDateTime(v)`, `todayISO()`, `expiryInfo(v)` → `{text, level}` from `@/lib/format`.

Status values per module:
- Inbound order: Draft, Dues In, Receiving, Good Received, Goods Received, Unserviceable, Picked, ATP, Completed, Cancelled
- Inbound item `in_process_status`: Dues In, Goods Received, ATP, Unserviceable
- Outbound order: Open, Picking, Picked, Shipped, Delivered, Completed, Cancelled
- Outbound item `in_process_status`: Goods Received, ATP, Unserviceable
- Picklist: Draft, Confirmed, Picking, Picked, Completed, Cancelled
- StockTake: Draft, Counting, Review, Adjusted (also "In Progress")
- Stock `stock_status`: Available, Reserved, Expired, Dues In, Rejected

---

## Endpoints

### auth
- POST `auth/login` body `{username,password}` → `{token, user:{id,username,full_name,email,role}}`
- POST `auth/logout` · GET `auth/me` → `{user}`

### dashboard
- GET `dashboard/stats` → `{kpi:{total_drums,total_pallets,expiring_soon,expired_items,dues_in,receiving_now,pending_outbound,dispatched_today,received_today,today_inbound,today_outbound,stock_by_uom:[{uom_type,total_qty,total_pallet}]}, expired_detail:[], stock_summary:[{id,product_code,product_name,uom_type,uom_per_pallet,batches,total_qty,total_pallet,nearest_expiry,expiring_count}], monthly_activity:[{month,inbound_qty,outbound_qty}], stock_by_location:[{aisle,total_locs,occupied_locs,total_qty,total_pallet}], recent_activity:[], pending_inbound:[{id,order_number,status,order_date,shipment_no,carrier_name,line_count,total_qty}], pending_outbound:[{id,order_number,status,order_date,shipment_number,line_count,total_qty}]}`
- GET `dashboard/aisle_detail&aisle=X` → `{locations:[{code,rack,row_name,zone,qty,pallet,uom,batch,expiry,product,product_code,uom_per_pallet,is_eceran,is_partial}], stats:{aisle,total,occupied,total_qty,total_pallet}}`

### inbound
- GET `inbound/list&status=&od_no=&page=&per_page=` → `{rows:[{id,order_number,order_date,carrier_name,po_number,shipment_no,do_number,container_no,armada_no,production_date,expected_date,status,notes,received_by_name,created_by_name,total_items,total_qty,total_pallet,od_numbers}], total, page, per_page, statuses}`
- GET `inbound/detail&id=` → `{order, items:[{id,inbound_order_id,od_number,so_number,product_id,product_code,product_name,batch_number,location,quantity,uom,actual_qty,pallet,pallet_no,manufacture_date,exp_date,stock_status,in_process_status,notes,uom_type,uom_per_pallet,pallet_locations:[{id,location_code,pallet_seq,quantity,original_quantity,status}]}], locations, item_pallet_counts:{itemId:count}, users:[{id,username,full_name,role}], products:[{id,product_code,product_name,uom,uom_per_pallet}]}`
- GET `inbound/stats` → `{stats:{this_month, by_status:[], dues_in, pending, receiving}}`
- GET `inbound/search_products&q=` → `{results:[{id,text,product_code,product_name,uom,uom_per_pallet,liters_per_unit,stock_qty,max_sku_qty,max_trans_qty}]}`
- POST `inbound/create` `{order_date, carrier_name?, po_number?, shipment_no?, do_number?, container_no?, armada_no?, production_date?, expected_date?, received_by?, received_date?, status?, notes?, items:[{product_id, batch_number?, od_number?, so_number?, location?, quantity, uom?, actual_qty?, pallet_no?, manufacture_date?, exp_date?, in_process_status?, notes?, pallet_locations?:[{location_code, pallet_seq, quantity, is_full}]}]}` → `{id, order_number}`
- POST `inbound/update` `{id, order_date, carrier_name?, po_number?, shipment_no?, do_number?, container_no?, armada_no?, production_date?, expected_date?, received_by?, received_date?, notes?}`
- POST `inbound/delete` `{id}`
- POST `inbound/add_item` `{inbound_id, item:{product_id, batch_number?, od_number?, so_number?, location?, quantity, uom?, actual_qty?, pallet_no?, manufacture_date?, exp_date?, in_process_status?, notes?, pallet_locations?}}` → `{item_id}`
- POST `inbound/update_item` `{item_id, ...fields}`
- POST `inbound/update_item_qty` `{item_id, quantity, inbound_id}`
- POST `inbound/update_item_dates` `{item_id, manufacture_date?, exp_date?}`
- POST `inbound/update_item_pallet_no` `{item_id, pallet_no?}`
- POST `inbound/update_item_status` `{item_id, inbound_id, status}` (Dues In|Goods Received|Unserviceable|ATP)
- POST `inbound/delete_item` `{item_id, inbound_id}`
- POST `inbound/save_pallet_locations` `{item_id, inbound_id, pallet_locations:[{location_code,pallet_seq,quantity,is_full}]}`
- POST `inbound/save_item_location` `{item_id, inbound_id, location}`
- POST `inbound/advance_status` `{id, status, received_by_id?, received_date?}` (status: Dues In|Receiving)
- POST `inbound/complete` `{id}` · POST `inbound/repair_ledger` `{id}`

### outbound
- GET `outbound/list&status=&od_no=&page=&per_page=` → `{rows:[{id,order_number,display_order_no,order_date,customer_id,customer_name,so_number,do_number,shipment_number,destination,kota,armada_no,container_no,jenis_armada,expected_date,status,notes,shipped_date,created_by_name,total_items,total_qty,total_pallet}], total, statuses}`
- GET `outbound/detail&id=` → `{order, items:[{id,product_code,product_name,batch_no,batch_number,location,quantity,uom,actual_qty,pallet,od_number,so_number,destination_id,in_process_status,notes,picked_locations:[]}], destinations:[{id,seq,ship_to_name,ship_to_location,ship_to_street,kota,notes}], customers:[{id,customer_code,customer_name}], products}`
- GET `outbound/stats` → `{stats}`
- GET `outbound/search_products&q=` → same as inbound
- GET `outbound/check_stock&product_id=&quantity=&location=` → `{available, fefo:[]}`
- POST `outbound/create` `{order_date, customer_id?, so_number?, do_number?, shipment_number?, destination?, kota?, armada_no?, container_no?, jenis_armada?, expected_date?, status?, notes?, items:[{product_id, quantity, uom?, actual_qty?, od_number?, so_number?, destination_id?, customer_id?}], destinations?:[{ship_to_name, ship_to_location, ship_to_street, kota, notes}]}` → `{id, warnings:[]}`
- POST `outbound/update` `{id, ...fields, destinations?}`
- POST `outbound/add_item` `{outbound_id, item:{product_id, quantity, uom?, actual_qty?, od_number?, so_number?, destination_id?, customer_id?, item_ship_to_name?, item_ship_to_location?, item_ship_to_street?}, manual_location?, manual_locs?}` → `{item_id}`
- POST `outbound/pick_items` `{id}` (requires expected_date)
- POST `outbound/ship` `{id}` · POST `outbound/complete` `{id}` · POST `outbound/delete` `{id}`
- POST `outbound/delete_item` `{outbound_id, item_id}`
- POST `outbound/update_item_status` `{item_id, outbound_id, status}` (Goods Received|ATP|Unserviceable)

### stock
- GET `stock/list&status=&expiring=&q=&location=` → `{rows:[{id,product_id,product_code,product_name,category,uom_type,uom_per_pallet,batch_number,location,quantity,uom,pallet,manufacture_date,expiry_date,stock_status}], summary}`
- GET `stock/summary` → `{summary:{total_products,total_drums,total_pallets,available_items,reserved_items,expired_items,dues_in_items,expiring_soon,critical,expired,total_qty}}`
- GET `stock/expiring&days=` → `{rows}`
- GET `stock/by_location` → `{rows:[{area,products,total_qty,total_pallet}]}`
- GET `stock/locations` → `{rows:[string]}`
- POST `stock/transfer` `{stock_id, to_location, quantity?}`
- POST `stock/adjust` `{stock_id, quantity, reason}` (admin)

### ledger
- GET `ledger/list&product_id=&start_date=&end_date=&limit=` → `{rows:[{id,transaction_date,product_code,product_name,transaction_type,reference_type,reference_number,batch_number,quantity_in,quantity_out,uom,pallet,balance,location,notes,created_at}], products}`
- POST `ledger/repair_all` (admin)

### picklist
- GET `picklist/list&status=&page=&per_page=` → `{rows:[{id,picklist_number,outbound_order_id,outbound_number,created_date,status,notes,created_by_name,total_items,total_qty}], total, statuses}`
- GET `picklist/detail&id=` → `{picklist, items:[{id,picklist_id,product_code,product_name,batch_no,batch_number,location,quantity,uom,pallet,picked_quantity,status,picker_id,picked_at,stock_location_id,pallet_seq}]}`
- GET `picklist/stats` → `{stats}`
- POST `picklist/create_from_outbound` `{outbound_id}` → `{id}`
- POST `picklist/confirm` `{id}` · POST `picklist/complete` `{id}` · POST `picklist/delete` `{id}`
- POST `picklist/update_item` `{item_id, picked_quantity?, status?, picker_id?}`
- GET `picklist/export_data&id=` → `{data}`

### stocktake
- GET `stocktake/list` → `{rows:[{id,take_number,take_date,status,notes,created_by_name,total_items,plus_count,minus_count,clear_count}], stats}`
- GET `stocktake/detail&id=` → `{stock_take, items:[{id,product_code,product_name,batch_number,uom,location,qty_system,counter_1,counter_2,counter_3,qty_physical,difference,status,notes,counter_by}], accuracy:{total_stock_take,plus,minus,clear,accuracy}, locked_locations:[]}`
- GET `stocktake/stats` · GET `stocktake/get_locations` → `{rows:[string]}` · GET `stocktake/get_scope_locations` → `{locations:[], locked:[]}`
- GET `stocktake/get_stock&product_id=&location=&batch=` → `{total_qty, rows:[]}`
- POST `stocktake/create` `{take_date, notes?, scope_locations?:[...]|null, auto_load?}` → `{id}`
- POST `stocktake/add_item` `{stock_take_id, item:{product_id,batch_number?,uom?,location?,qty_system,qty_physical,counter_1?,counter_2?,counter_3?}}`
- POST `stocktake/auto_load` `{stock_take_id, locations?}`
- POST `stocktake/update` `{id, take_date, status, notes?}`
- POST `stocktake/delete_item` `{item_id}` · POST `stocktake/delete` `{id}`
- POST `stocktake/start_counting` `{id}`
- POST `stocktake/save_counters` `{id, counters:{itemId:{c1,c2,c3}}}`
- POST `stocktake/advance_to_c2` `{id, counters:{...}}`
- POST `stocktake/finish_counting` `{id, counters?}`
- POST `stocktake/save_review` `{id, physicals:{itemId:qty}}`
- POST `stocktake/apply_adjustment` `{id}` (admin)

### bintransfer
- GET `bintransfer/list&status=&page=` → `{rows:[{id,transfer_number,transfer_date,product_id,product_code,product_name,batch_number,from_location,to_location,quantity,uom,reason,status,created_by_name,completed_by_name}], total, statuses}`
- GET `bintransfer/detail&id=` → `{transfer}`
- GET `bintransfer/locations_with_stock&product_id=` → `{rows:[{location,total_qty,uom,earliest_expiry,batch_count}]}`
- GET `bintransfer/stock_at_location&product_id=&location=` → `{rows:[]}`
- POST `bintransfer/create` `{product_id, transfer_date, from_location, to_location, quantity, uom?, reason?, batch_number?}` → `{id}`
- POST `bintransfer/execute` `{id}` · POST `bintransfer/cancel` `{id}`

### products
- GET `products/list&search=&page=&per_page=` → `{rows:[{id,product_code,product_name,category,description,drums_per_pallet,uom_type,uom_per_pallet,liters_per_unit,max_sku_qty,max_trans_qty,is_active,total_qty,total_pallets}], total, total_all, page, uom_stats}`
- GET `products/all` → `{rows}` · GET `products/detail&id=` → `{product}`
- POST `products/create` `{product_code, product_name, category?, description?, drums_per_pallet?, uom_type?, uom_per_pallet?, liters_per_unit?, max_sku_qty?, max_trans_qty?}`
- POST `products/update` `{id, ...}` · POST `products/delete` `{id}` (admin)

### customers
- GET `customers/list&search=&page=` → `{rows:[{id,customer_code,customer_name,contact_person,phone,email,address,city,is_active}], total, page, type_stats}`
- GET `customers/all` → `{rows}` · GET `customers/detail&id=`
- POST `customers/create` `{customer_code, customer_name, contact_person?, phone?, email?, address?, city?, is_active?}`
- POST `customers/update` `{id, ...}` · POST `customers/delete` `{id}`

### locations
- GET `locations/list&zone=&available_only=` → `{rows:[{id,location_code,aisle,rack,row_name,position,zone,is_active}], zones:[{zone,total,active}]}`
- GET `locations/all` → `{rows}` · GET `locations/check&code=` → `{available, info}`
- GET `locations/available&count=&zone=` → `{rows}` · GET `locations/zone_summary` → `{rows}`
- GET `locations/suggest&quantity=&uom=&uom_per_pallet=&zone=` → `{rows}`
- POST `locations/create` `{location_code, aisle?, rack?, row_name?, position?, zone?, is_active?}`
- POST `locations/update` `{id, ...}` · POST `locations/delete` `{id}` (admin)

### users (admin only)
- GET `users/list` → `{rows:[{id,username,full_name,email,role,is_active,created_at}], roles:[{key,label}]}`
- POST `users/create` `{username, password, full_name, email?, role, is_active?}`
- POST `users/update` `{id, username, full_name, email?, role, is_active?, password?}`
- POST `users/delete` `{id}`

### report
- GET `report/daily&date=&date_to=` → `{report:{date,date_to,stock_summary:[],inbound_activity:[],outbound_activity:[],expiring_items:[],low_stock:[],ledger_summary:{transactions_in,transactions_out,qty_in,qty_out}}}`
- GET `report/products` → `{rows}` · GET `report/inbound&start_date=&end_date=&status=` · GET `report/outbound&...=` · GET `report/stock` · GET `report/ledger&start_date=&end_date=`

### activitylog
- GET `activitylog/list&module=&limit=` → `{rows:[{id,username,full_name,action,action_label,module,module_icon,reference_type,reference_no,description,ip_address,created_at}]}`
- GET `activitylog/modules` → `{rows:[string]}`
