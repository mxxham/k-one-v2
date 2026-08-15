-- Migration 006: Wave Planning (Phase 4 of WMS upgrade — spec-4)

-- Wave header. A wave groups one or more outbound orders into a single
-- consolidated picklist for pick-path efficiency.
CREATE TABLE IF NOT EXISTS waves (
    id           BIGSERIAL PRIMARY KEY,
    wave_number  VARCHAR(50) UNIQUE NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'Planning' CHECK (
      status IN ('Planning','Active','Completed','Cancelled')),
    carrier      VARCHAR(100),
    cutoff_time  TIMESTAMP,
    created_by   BIGINT NOT NULL REFERENCES users(id),
    created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waves_status ON waves(status);
CREATE INDEX IF NOT EXISTS idx_waves_created_by ON waves(created_by);

-- Wave ↔ outbound orders (many-to-many).
CREATE TABLE IF NOT EXISTS wave_orders (
    wave_id           BIGINT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    outbound_order_id BIGINT NOT NULL REFERENCES outbound_orders(id) ON DELETE CASCADE,
    PRIMARY KEY (wave_id, outbound_order_id)
);
CREATE INDEX IF NOT EXISTS idx_wave_orders_outbound ON wave_orders(outbound_order_id);

-- A picklist may belong to a wave (consolidated across many orders).
ALTER TABLE picklists ADD COLUMN IF NOT EXISTS wave_id BIGINT REFERENCES waves(id);
CREATE INDEX IF NOT EXISTS idx_picklists_wave ON picklists(wave_id);

-- Wave picklists span many orders, so outbound_order_id becomes nullable.
-- Single-order picklists continue to set it (additive — not a replacement).
ALTER TABLE picklists ALTER COLUMN outbound_order_id DROP NOT NULL;