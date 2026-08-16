-- =============================================================================
-- Migration 009: Advance Shipping Notice (ASN)
--  - asn: supplier notifies inbound of an expected shipment before it arrives.
--  - asn_items: expected products/quantities (confirm-vs-expect at receiving).
--  - inbound_orders.asn_id: link an inbound order back to the ASN it was
--    created from; ASN flips Pending -> Received when that order completes.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS asn (
    id                    BIGSERIAL PRIMARY KEY,
    asn_number            VARCHAR(50) UNIQUE NOT NULL,
    supplier_name         VARCHAR(255),
    supplier_reference    VARCHAR(100),
    expected_arrival_date DATE,
    status                VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (
      status IN ('Pending','Received','Cancelled')),
    notes                 TEXT,
    created_by            BIGINT NOT NULL REFERENCES users(id),
    created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_asn_status      ON asn(status);
CREATE INDEX IF NOT EXISTS idx_asn_created_by  ON asn(created_by);
CREATE INDEX IF NOT EXISTS idx_asn_arrival     ON asn(expected_arrival_date);

CREATE TABLE IF NOT EXISTS asn_items (
    id            BIGSERIAL PRIMARY KEY,
    asn_id        BIGINT NOT NULL REFERENCES asn(id) ON DELETE CASCADE,
    product_id    BIGINT NOT NULL REFERENCES products(id),
    expected_qty  NUMERIC(10,2) NOT NULL DEFAULT 0,
    uom           VARCHAR(20)   NOT NULL DEFAULT 'Drum',
    batch_number  VARCHAR(100),
    exp_date      DATE,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_asn_items_asn     ON asn_items(asn_id);
CREATE INDEX IF NOT EXISTS idx_asn_items_product ON asn_items(product_id);

ALTER TABLE inbound_orders ADD COLUMN IF NOT EXISTS asn_id BIGINT REFERENCES asn(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_orders_asn ON inbound_orders(asn_id);

COMMIT;