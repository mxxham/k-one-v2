-- =============================================================================
-- Migration 010: ABC Analysis / Velocity-Based Ranking
--  - products.velocity_class: A (fast-moving) / B (medium) / C (slow), computed
--    from pick outflow volume by the `abc` module's admin recompute action.
--    Nullable — recomputed periodically, not in real-time.
-- =============================================================================

BEGIN;

ALTER TABLE products ADD COLUMN IF NOT EXISTS velocity_class VARCHAR(1) CHECK (velocity_class IN ('A','B','C'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS velocity_class_at TIMESTAMP;

COMMIT;