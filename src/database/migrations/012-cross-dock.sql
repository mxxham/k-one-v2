-- ---------------------------------------------------------------------------
-- S25 Phase 7 — Cross-Docking
-- Earmark a specific inbound item to route straight to an outbound shipment
-- without normal putaway. Adds a nullable FK on inbound_items pointing at the
-- outbound order the item is pre-allocated/pre-sold to. The existing 'STAGING'
-- special location (already seeded in 001/007 and excluded from general stock
-- counts) is reused as the cross-dock staging location — no new location row.
-- ---------------------------------------------------------------------------
ALTER TABLE inbound_items
    ADD COLUMN IF NOT EXISTS cross_dock_outbound_order_id BIGINT REFERENCES outbound_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_items_cross_dock
    ON inbound_items (cross_dock_outbound_order_id);
