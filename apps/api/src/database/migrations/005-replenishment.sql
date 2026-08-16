-- Migration 005: Replenishment Suggestions (Phase 3 of WMS upgrade — spec-4)
-- Per-location per-SKU pick-face thresholds used by the replenishment report.
-- location_master has no per-SKU fields, so thresholds live in their own table.

CREATE TABLE IF NOT EXISTS pick_face_targets (
    id          BIGSERIAL PRIMARY KEY,
    location_id BIGINT NOT NULL REFERENCES location_master(id),
    product_id  BIGINT NOT NULL REFERENCES products(id),
    min_qty     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
    max_qty     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (max_qty >= 0),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (location_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_pft_location ON pick_face_targets(location_id);
CREATE INDEX IF NOT EXISTS idx_pft_product  ON pick_face_targets(product_id);