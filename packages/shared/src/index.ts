export const STATUS = {
  INBOUND_ORDER: ['Draft', 'Dues In', 'Receiving', 'Good Received', 'Goods Received', 'Unserviceable', 'Picked', 'ATP', 'Completed', 'Cancelled'],
  INBOUND_ITEM_PROCESS: ['Dues In', 'Goods Received', 'ATP', 'Unserviceable'],
  INBOUND_ITEM_STOCK: ['Accepted', 'Rejected', 'Pending'],
  OUTBOUND_ORDER: ['Open', 'Picking', 'Picked', 'Shipped', 'Delivered', 'Completed', 'Cancelled'],
  PICKLIST: ['Draft', 'Confirmed', 'Picking', 'Picked', 'Completed', 'Cancelled'],
  STOCK_TAKE: ['Draft', 'In Progress', 'Completed', 'Cancelled'],
  STOCK_TAKE_CODE: ['Draft', 'Counting', 'Review', 'Adjusted', 'Completed', 'Cancelled'],
  STOCK: ['Available', 'Reserved', 'Expired', 'Dues In', 'Rejected', 'Pending'],
  LEDGER: ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'],
  UOM: ['Drum', 'Carton', 'Pail', 'EA', 'Bags'],
  BIN_TRANSFER: ['Pending', 'Completed', 'Cancelled'],
  PICKLIST_ITEM: ['Pending', 'Picked', 'Verified'],
} as const;

export const ROLE = {
  ADMIN: 'admin',
  WAREHOUSE: 'warehouse',
  SUPERVISOR: 'supervisor',
  OPERATOR: 'operator',
  STAFF: 'staff',
} as const;

export const WRITE_ROLES = ['admin', 'operator', 'warehouse', 'supervisor', 'staff'] as const;
export const ADMIN_ROLES = ['admin'] as const;

export const UOM_PALLET_DEFAULT: Record<string, number> = {
  Drum: 4,
  Carton: 44,
  Pail: 24,
};
