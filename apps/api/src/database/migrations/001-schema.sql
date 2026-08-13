-- =============================================================================
-- K-one v2 — PostgreSQL schema (ported from MySQL database.sql)
-- Parity: exact column names; ENUMs -> TEXT + CHECK constraints
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- MASTER DATA
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL PRIMARY KEY,
    username    VARCHAR(50)  UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    full_name   VARCHAR(100) NOT NULL,
    email       VARCHAR(100) UNIQUE NOT NULL,
    role        VARCHAR(20)  NOT NULL DEFAULT 'staff'
                CHECK (role IN ('admin','warehouse','supervisor','operator','staff')),
    is_active   SMALLINT     NOT NULL DEFAULT 1,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
    id             BIGSERIAL PRIMARY KEY,
    customer_code  VARCHAR(50)  UNIQUE NOT NULL,
    customer_name  VARCHAR(255) NOT NULL,
    contact_person VARCHAR(100),
    phone          VARCHAR(50),
    email          VARCHAR(100),
    address        TEXT,
    city           VARCHAR(100),
    is_active      SMALLINT     NOT NULL DEFAULT 1,
    created_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id                 BIGSERIAL PRIMARY KEY,
    product_code       VARCHAR(50)   UNIQUE NOT NULL,
    product_name       VARCHAR(255)  NOT NULL,
    category           VARCHAR(100),
    description        TEXT,
    drums_per_pallet   INT           NOT NULL DEFAULT 4,
    uom_type           VARCHAR(20)   NOT NULL DEFAULT 'Drum'
                       CHECK (uom_type IN ('Drum','Carton','Pail','EA','Bags')),
    uom_per_pallet     INT           NOT NULL DEFAULT 4,
    liters_per_unit    NUMERIC(10,2) NOT NULL DEFAULT 209.00,
    max_sku_qty        INT           NOT NULL DEFAULT 44,
    max_trans_qty      INT           NOT NULL DEFAULT 80,
    default_location   VARCHAR(50),
    max_per_transaction INT          NOT NULL DEFAULT 80,
    reorder_level      INT           NOT NULL DEFAULT 0,
    is_active          SMALLINT      NOT NULL DEFAULT 1,
    created_at         TIMESTAMP     NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- LOCATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location_master (
    id            BIGSERIAL PRIMARY KEY,
    location_code VARCHAR(20) UNIQUE NOT NULL,
    aisle         VARCHAR(10),
    rack          VARCHAR(10),
    row_name      VARCHAR(10),
    position      VARCHAR(10),
    zone          VARCHAR(20),
    is_active     SMALLINT  NOT NULL DEFAULT 1,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_location_master_aisle ON location_master(aisle);
CREATE INDEX IF NOT EXISTS idx_location_master_zone ON location_master(zone);

CREATE TABLE IF NOT EXISTS warehouse_locations (
    id         BIGSERIAL PRIMARY KEY,
    location   VARCHAR(20) UNIQUE NOT NULL,
    aisle      VARCHAR(5),
    bay        INT,
    row_code   VARCHAR(2),
    slot       INT,
    is_active  SMALLINT  NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- INBOUND
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbound_orders (
    id               BIGSERIAL PRIMARY KEY,
    order_number     VARCHAR(50) UNIQUE NOT NULL,
    order_date       DATE        NOT NULL,
    carrier_name     VARCHAR(100),
    container_no     VARCHAR(50),
    po_number        VARCHAR(50),
    shipment_no      VARCHAR(100),
    do_number        VARCHAR(100),
    armada_no        VARCHAR(50),
    production_date  DATE,
    expected_date    DATE,
    status           VARCHAR(20) NOT NULL DEFAULT 'Draft' CHECK (
      status IN ('Draft','Dues In','Receiving','Good Received','Goods Received',
                 'Unserviceable','Picked','ATP','Completed','Cancelled')),
    notes            TEXT,
    remarks          TEXT,
    received_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    received_by_name VARCHAR(100),
    received_date    DATE,
    created_by       BIGINT NOT NULL REFERENCES users(id),
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbound_orders_status ON inbound_orders(status);
CREATE INDEX IF NOT EXISTS idx_inbound_orders_created_by ON inbound_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_inbound_orders_received_by ON inbound_orders(received_by);

CREATE TABLE IF NOT EXISTS inbound_items (
    id                BIGSERIAL PRIMARY KEY,
    inbound_order_id  BIGINT NOT NULL REFERENCES inbound_orders(id) ON DELETE CASCADE,
    od_number         VARCHAR(100),
    so_number         VARCHAR(100),
    product_id        BIGINT NOT NULL REFERENCES products(id),
    batch_no          VARCHAR(100),
    location          VARCHAR(30),
    quantity          NUMERIC(10,2) NOT NULL DEFAULT 0,
    uom               VARCHAR(20)   NOT NULL DEFAULT 'Drum',
    actual_qty        NUMERIC(10,2) NOT NULL DEFAULT 0,
    pallet            NUMERIC(10,2) NOT NULL DEFAULT 0,
    pallet_no         VARCHAR(50),
    manufacture_date  DATE,
    exp_date          DATE,
    stock_status      VARCHAR(20) NOT NULL DEFAULT 'Pending'
                      CHECK (stock_status IN ('Accepted','Rejected','Pending')),
    in_process_status VARCHAR(20) NOT NULL DEFAULT 'Dues In' CHECK (
      in_process_status IN ('Dues In','Goods Received','ATP','Unserviceable','Picked')),
    notes             TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    batch_number      VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_inbound_items_od ON inbound_items(od_number);
CREATE INDEX IF NOT EXISTS idx_inbound_items_so ON inbound_items(so_number);
CREATE INDEX IF NOT EXISTS idx_inbound_items_order ON inbound_items(inbound_order_id);
CREATE INDEX IF NOT EXISTS idx_inbound_items_product ON inbound_items(product_id);

-- ---------------------------------------------------------------------------
-- OUTBOUND
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_orders (
    id               BIGSERIAL PRIMARY KEY,
    order_number     VARCHAR(50) UNIQUE NOT NULL,
    order_date       DATE        NOT NULL,
    customer_id      BIGINT      NOT NULL REFERENCES customers(id),
    so_number        VARCHAR(50),
    do_number        VARCHAR(50),
    shipment_number  VARCHAR(50),
    ship_to_name     VARCHAR(255),
    ship_to_location VARCHAR(100),
    ship_to_street   VARCHAR(500),
    destination      VARCHAR(255),
    kota             VARCHAR(100),
    armada_no        VARCHAR(50),
    container_no     VARCHAR(50),
    jenis_armada     VARCHAR(50),
    expected_date    DATE,
    status           VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (
      status IN ('Open','Picking','Picked','Shipped','Delivered','Completed','Cancelled')),
    shipped_date     DATE,
    notes            TEXT,
    shipped_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_by       BIGINT NOT NULL REFERENCES users(id),
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbound_orders_status ON outbound_orders(status);
CREATE INDEX IF NOT EXISTS idx_outbound_orders_customer ON outbound_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_outbound_orders_created_by ON outbound_orders(created_by);

CREATE TABLE IF NOT EXISTS outbound_destinations (
    id               BIGSERIAL PRIMARY KEY,
    outbound_id      BIGINT NOT NULL REFERENCES outbound_orders(id) ON DELETE CASCADE,
    seq              SMALLINT NOT NULL DEFAULT 1,
    ship_to_name     VARCHAR(200),
    ship_to_location VARCHAR(200),
    ship_to_street   VARCHAR(300),
    kota             VARCHAR(100),
    destination      VARCHAR(300),
    notes            TEXT,
    created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbound_destinations_order ON outbound_destinations(outbound_id);

CREATE TABLE IF NOT EXISTS outbound_items (
    id                 BIGSERIAL PRIMARY KEY,
    outbound_order_id  BIGINT NOT NULL REFERENCES outbound_orders(id) ON DELETE CASCADE,
    product_id         BIGINT NOT NULL REFERENCES products(id),
    quantity           NUMERIC(10,2) NOT NULL DEFAULT 0,
    uom                VARCHAR(20) NOT NULL DEFAULT 'Drum',
    actual_qty         NUMERIC(10,2) NOT NULL DEFAULT 0,
    pallet             NUMERIC(10,2) NOT NULL DEFAULT 0,
    batch_no           VARCHAR(100),
    exp_date           DATE,
    location           VARCHAR(30),
    in_process_status  VARCHAR(20) NOT NULL DEFAULT 'Goods Received' CHECK (
      in_process_status IN ('Goods Received','ATP','Unserviceable')),
    gr_plan_no         VARCHAR(100),
    transaction_no     VARCHAR(100),
    notes              TEXT,
    od_number          VARCHAR(100),
    so_number          VARCHAR(100),
    destination_id     BIGINT,
    customer_id        BIGINT REFERENCES customers(id),
    created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
    batch_number       VARCHAR(100),
    stock_location_id  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_outbound_items_order ON outbound_items(outbound_order_id);
CREATE INDEX IF NOT EXISTS idx_outbound_items_product ON outbound_items(product_id);
CREATE INDEX IF NOT EXISTS idx_outbound_items_od ON outbound_items(od_number);
CREATE INDEX IF NOT EXISTS idx_outbound_items_so ON outbound_items(so_number);
CREATE INDEX IF NOT EXISTS idx_outbound_items_dest ON outbound_items(destination_id);

-- ---------------------------------------------------------------------------
-- STOCK
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock (
    id               BIGSERIAL PRIMARY KEY,
    product_id       BIGINT NOT NULL REFERENCES products(id),
    batch_number     VARCHAR(100),
    location         VARCHAR(30),
    quantity         NUMERIC(10,2) NOT NULL DEFAULT 0,
    uom              VARCHAR(20) NOT NULL DEFAULT 'Drum',
    uom_type         VARCHAR(20) NOT NULL DEFAULT 'Drum'
                     CHECK (uom_type IN ('Drum','Carton','Pail')),
    uom_per_pallet   INT NOT NULL DEFAULT 4,
    pallet           NUMERIC(10,2) NOT NULL DEFAULT 0,
    manufacture_date DATE,
    production_date  DATE,
    expiry_date      DATE,
    stock_status     VARCHAR(20) NOT NULL DEFAULT 'Available' CHECK (
      stock_status IN ('Available','Reserved','Expired','Dues In')),
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_expiry ON stock(expiry_date);
CREATE INDEX IF NOT EXISTS idx_stock_status ON stock(stock_status);
CREATE INDEX IF NOT EXISTS idx_stock_location ON stock(location);
CREATE INDEX IF NOT EXISTS idx_stock_fefo ON stock(product_id, stock_status, expiry_date);

CREATE TABLE IF NOT EXISTS stock_locations (
    id                BIGSERIAL PRIMARY KEY,
    stock_id          BIGINT,
    location_code     VARCHAR(20) NOT NULL,
    pallet_seq        SMALLINT    NOT NULL DEFAULT 1,
    quantity          NUMERIC(10,2) NOT NULL DEFAULT 0,
    original_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
    uom               VARCHAR(20) NOT NULL DEFAULT 'EA',
    is_full_pallet    SMALLINT    NOT NULL DEFAULT 1,
    batch_number      VARCHAR(100),
    inbound_item_id   BIGINT,
    status            VARCHAR(20) NOT NULL DEFAULT 'Available' CHECK (
      status IN ('Available','Reserved','Picked','Empty')),
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_locations_stock ON stock_locations(stock_id);
CREATE INDEX IF NOT EXISTS idx_stock_locations_location ON stock_locations(location_code);
CREATE INDEX IF NOT EXISTS idx_stock_locations_status ON stock_locations(status);
CREATE INDEX IF NOT EXISTS idx_stock_locations_batch ON stock_locations(batch_number);

CREATE TABLE IF NOT EXISTS outbound_item_locations (
    id                BIGSERIAL PRIMARY KEY,
    outbound_item_id  BIGINT NOT NULL,
    stock_location_id BIGINT NOT NULL,
    quantity          NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (outbound_item_id, stock_location_id)
);
CREATE INDEX IF NOT EXISTS idx_oil_item ON outbound_item_locations(outbound_item_id);
CREATE INDEX IF NOT EXISTS idx_oil_sl ON outbound_item_locations(stock_location_id);

CREATE TABLE IF NOT EXISTS location_allocations (
    id             BIGSERIAL PRIMARY KEY,
    reference_type VARCHAR(10) NOT NULL CHECK (reference_type IN ('Inbound','Outbound','Stock')),
    reference_id   BIGINT NOT NULL,
    item_id        BIGINT NOT NULL,
    pallet_number  INT    NOT NULL,
    location       VARCHAR(50) NOT NULL,
    quantity       NUMERIC(10,2) NOT NULL,
    uom            VARCHAR(20) NOT NULL DEFAULT 'Drum',
    is_full        SMALLINT NOT NULL DEFAULT 1,
    created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_location_allocations_ref ON location_allocations(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS stock_ledger (
    id               BIGSERIAL PRIMARY KEY,
    transaction_date DATE NOT NULL,
    product_id       BIGINT NOT NULL REFERENCES products(id),
    transaction_type VARCHAR(20) NOT NULL CHECK (
      transaction_type IN ('IN','OUT','ADJUSTMENT','TRANSFER','TRANSFER_IN','TRANSFER_OUT')),
    reference_type   VARCHAR(50),
    reference_id     BIGINT,
    reference_number VARCHAR(50),
    batch_number     VARCHAR(100),
    quantity_in      NUMERIC(10,2) NOT NULL DEFAULT 0,
    quantity_out     NUMERIC(10,2) NOT NULL DEFAULT 0,
    uom              VARCHAR(20) NOT NULL DEFAULT 'Drum',
    pallet           NUMERIC(10,2) NOT NULL DEFAULT 0,
    balance          NUMERIC(10,2) NOT NULL DEFAULT 0,
    location         VARCHAR(50),
    notes            TEXT,
    created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_product ON stock_ledger(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_date ON stock_ledger(transaction_date);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_ref ON stock_ledger(reference_type, reference_id);

-- ---------------------------------------------------------------------------
-- PICKLIST
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS picklists (
    id                BIGSERIAL PRIMARY KEY,
    outbound_order_id BIGINT NOT NULL REFERENCES outbound_orders(id) ON DELETE CASCADE,
    picklist_number   VARCHAR(50) UNIQUE NOT NULL,
    created_date      DATE NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'Draft' CHECK (
      status IN ('Draft','Confirmed','Picking','Picked','Completed','Cancelled')),
    notes             TEXT,
    created_by        BIGINT NOT NULL REFERENCES users(id),
    confirmed_at      TIMESTAMP,
    picked_at         TIMESTAMP,
    completed_at      TIMESTAMP,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS picklist_items (
    id                BIGSERIAL PRIMARY KEY,
    picklist_id       BIGINT NOT NULL REFERENCES picklists(id) ON DELETE CASCADE,
    outbound_item_id  BIGINT REFERENCES outbound_items(id),
    product_id        BIGINT NOT NULL REFERENCES products(id),
    batch_no          VARCHAR(100) NOT NULL,
    location          VARCHAR(30),
    quantity          NUMERIC(10,2) NOT NULL,
    uom               VARCHAR(20) NOT NULL,
    pallet            NUMERIC(10,2) NOT NULL,
    picked_quantity   NUMERIC(10,2) NOT NULL DEFAULT 0,
    status            VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (
      status IN ('Pending','Picked','Verified')),
    picker_id         BIGINT,
    notes             TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    picked_at         TIMESTAMP,
    batch_number      VARCHAR(100),
    stock_location_id BIGINT,
    pallet_seq        SMALLINT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_picklist_items_picklist ON picklist_items(picklist_id);
CREATE INDEX IF NOT EXISTS idx_picklist_items_product ON picklist_items(product_id);

-- ---------------------------------------------------------------------------
-- STOCK TAKE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_take (
    id              BIGSERIAL PRIMARY KEY,
    take_number     VARCHAR(50) UNIQUE NOT NULL,
    take_date       DATE NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'Draft' CHECK (
      status IN ('Draft','Counting','Review','Adjusted','Completed','Cancelled')),
    notes           TEXT,
    scope_locations TEXT,
    scope_type      VARCHAR(20) NOT NULL DEFAULT 'full',
    counting_round  VARCHAR(10),
    created_by      BIGINT NOT NULL REFERENCES users(id),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_take_items (
    id            BIGSERIAL PRIMARY KEY,
    stock_take_id BIGINT NOT NULL REFERENCES stock_take(id) ON DELETE CASCADE,
    product_id    BIGINT NOT NULL REFERENCES products(id),
    batch_number  VARCHAR(100),
    uom           VARCHAR(20),
    location      VARCHAR(100),
    qty_system    NUMERIC(10,2) NOT NULL DEFAULT 0,
    counter_1     NUMERIC(10,2),
    counter_2     NUMERIC(10,2),
    counter_3     NUMERIC(10,2),
    qty_physical  NUMERIC(10,2) NOT NULL DEFAULT 0,
    difference    NUMERIC(10,2) NOT NULL DEFAULT 0,
    status        VARCHAR(10) NOT NULL DEFAULT 'Clear' CHECK (
      status IN ('Plus','Minus','Clear')),
    notes         TEXT,
    counter_by    VARCHAR(100),
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- BIN TRANSFER
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bin_transfers (
    id              BIGSERIAL PRIMARY KEY,
    transfer_number VARCHAR(50) UNIQUE NOT NULL,
    transfer_date   DATE NOT NULL,
    product_id      BIGINT NOT NULL REFERENCES products(id),
    stock_id        BIGINT,
    batch_number    VARCHAR(100),
    from_location   VARCHAR(100) NOT NULL,
    to_location     VARCHAR(100) NOT NULL,
    quantity        NUMERIC(12,4) NOT NULL,
    uom             VARCHAR(20) NOT NULL DEFAULT 'Drum',
    reason          TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (
      status IN ('Pending','Completed','Cancelled')),
    created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    completed_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    completed_at    TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bin_transfers_date ON bin_transfers(transfer_date);
CREATE INDEX IF NOT EXISTS idx_bin_transfers_product ON bin_transfers(product_id);
CREATE INDEX IF NOT EXISTS idx_bin_transfers_from ON bin_transfers(from_location);
CREATE INDEX IF NOT EXISTS idx_bin_transfers_to ON bin_transfers(to_location);

-- ---------------------------------------------------------------------------
-- ACTIVITY LOG / SETTINGS / TOKENS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
    id             BIGSERIAL PRIMARY KEY,
    user_id        BIGINT,
    username       VARCHAR(100),
    full_name      VARCHAR(100),
    action         VARCHAR(100) NOT NULL,
    module         VARCHAR(50)  NOT NULL,
    reference_type VARCHAR(50),
    reference_id   BIGINT,
    reference_no   VARCHAR(100),
    description    TEXT,
    old_value      TEXT,
    new_value      TEXT,
    ip_address     VARCHAR(45),
    created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_module ON activity_log(module);
CREATE INDEX IF NOT EXISTS idx_activity_ref ON activity_log(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);

CREATE TABLE IF NOT EXISTS settings (
    id            BIGSERIAL PRIMARY KEY,
    setting_key   VARCHAR(50) UNIQUE NOT NULL,
    setting_value TEXT,
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL,
    token      VARCHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

-- ---------------------------------------------------------------------------
-- SEED
-- ---------------------------------------------------------------------------
INSERT INTO users (username, password, full_name, email, role, is_active) VALUES
  ('admin',      '$2y$10$n2jAlRXBXHYD0njcCfiBw.a.tPAkbUBU2cGAq4kyLFRzUuvsZRxw2', 'Administrator',       'admin@sanchaya.com',      'admin',      1),
  ('warehouse',  '$2y$10$4xXDxQnKQkVTTVzQl9BJc.aal4czR3m8l.SDtwEvlvP94egJkjb72', 'Warehouse Manager',   'warehouse@sanchaya.com', 'warehouse',  1),
  ('operator',   '$2y$10$YEycbXQYHYaCSt/tVd9e8eLzNU1tmo/GQXNnv9shNjfrJMM2XJxD2', 'Warehouse Operator',  'operator@sanchaya.com',  'operator',   1),
  ('supervisor', '$2y$10$BxRn7nZX1CR3XMyKikHuQOLj6aM7mVVu/yBTK6kA870xsZIcNLa9q', 'Warehouse Supervisor','supervisor@sanchaya.com','supervisor', 1)
ON CONFLICT (username) DO NOTHING;

INSERT INTO settings (setting_key, setting_value) VALUES
  ('warehouse_name',   'Shell CKB Warehouse'),
  ('drums_per_pallet', '4')
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;

INSERT INTO location_master (location_code, aisle, rack, row_name, position, zone, is_active) VALUES
  ('QUA_SHELL',   'QUA', 'SHELL', 'A', '01', 'Quarantine',   1),
  ('UNALLOCATED', 'UNA', NULL,    NULL, NULL, 'Unallocated', 1),
  ('STAGING',     'STG', NULL,    NULL, NULL, 'Staging',     1)
ON CONFLICT (location_code) DO NOTHING;

COMMIT;