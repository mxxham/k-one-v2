-- =============================================================================
-- Migration 007: Zoning, UOM physical limits, Putaway rules & pallet conversion
-- Builds on 001 (location_master, stock, stock_locations) and 005 (pick_face_targets).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ZONES master — structured zone definitions used by putaway/replenishment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zones (
    id          BIGSERIAL PRIMARY KEY,
    zone_code   VARCHAR(20) UNIQUE NOT NULL,
    zone_name   VARCHAR(100) NOT NULL,
    zone_type   VARCHAR(20) NOT NULL DEFAULT 'RESERVE' CHECK (
      zone_type IN ('PICK_FAST','RESERVE','BULK','QUARANTINE','STAGING','UNALLOCATED')),
    priority    INT NOT NULL DEFAULT 10,          -- lower = preferred first
    is_active   SMALLINT NOT NULL DEFAULT 1,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_zones_type ON zones(zone_type);

-- ---------------------------------------------------------------------------
-- 2. location_master — explicit level + zone columns (derived from row_name).
--    Keeps legacy zone text; adds structured zone_code + pick-face flag.
-- ---------------------------------------------------------------------------
ALTER TABLE location_master ADD COLUMN IF NOT EXISTS level VARCHAR(2);
ALTER TABLE location_master ADD COLUMN IF NOT EXISTS level_height SMALLINT;
ALTER TABLE location_master ADD COLUMN IF NOT EXISTS zone_code VARCHAR(20);
ALTER TABLE location_master ADD COLUMN IF NOT EXISTS is_pick_face SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE location_master ADD COLUMN IF NOT EXISTS max_weight_kg NUMERIC(10,2);
ALTER TABLE location_master ADD COLUMN IF NOT EXISTS max_height_cm NUMERIC(10,2);

UPDATE location_master
   SET level = row_name,
       level_height = CASE row_name
                        WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3
                        WHEN 'D' THEN 4 WHEN 'E' THEN 5 END,
       is_pick_face = CASE WHEN row_name = 'A' THEN 1 ELSE 0 END
 WHERE row_name IS NOT NULL
   AND (level IS NULL OR level_height IS NULL);

UPDATE location_master
   SET zone_code = CASE zone
                     WHEN 'Quarantine' THEN 'QUARANTINE'
                     WHEN 'Staging'     THEN 'STAGING'
                     WHEN 'Unallocated' THEN 'UNALLOCATED'
                     ELSE NULL END
 WHERE zone_code IS NULL;

-- ---------------------------------------------------------------------------
-- 3. UOM physical limits — level / weight / equipment constraints per UOM.
--    max_level is the highest rack tier an item of this UOM may occupy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uom_physical_limits (
    uom_type            VARCHAR(20) PRIMARY KEY
                        CHECK (uom_type IN ('Drum','Carton','Pail','EA','Bags')),
    min_level           VARCHAR(2) NOT NULL DEFAULT 'A',
    max_level           VARCHAR(2) NOT NULL DEFAULT 'E',
    allow_pick_face     SMALLINT NOT NULL DEFAULT 1,
    max_weight_kg       NUMERIC(10,2),
    max_height_cm       NUMERIC(10,2),
    requires_equipment  SMALLINT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. product_putaway_rules — per-product putaway overrides.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_putaway_rules (
    product_id           BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    preferred_zone_code  VARCHAR(20) NOT NULL DEFAULT 'RESERVE',
    max_level            VARCHAR(2),
    allow_pick_face      SMALLINT,
    full_pallet_to_pick  SMALLINT NOT NULL DEFAULT 0,  -- keep one full pallet at pick face
    min_pick_face_qty    NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_pick_face_qty    NUMERIC(10,2) NOT NULL DEFAULT 0,
    consolidate          SMALLINT NOT NULL DEFAULT 1,
    updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. bin_transfers — classify movement origin (manual / putaway / replenish).
-- ---------------------------------------------------------------------------
ALTER TABLE bin_transfers ADD COLUMN IF NOT EXISTS transfer_type VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
  CHECK (transfer_type IN ('MANUAL','PUTAWAY','REPLENISHMENT','MOVE'));
ALTER TABLE bin_transfers ADD COLUMN IF NOT EXISTS pick_face_target_id BIGINT;
ALTER TABLE bin_transfers ADD COLUMN IF NOT EXISTS is_breakdown SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_bin_transfers_type ON bin_transfers(transfer_type);

-- ---------------------------------------------------------------------------
-- 6. stock_locations — pallet function: RESERVE (upper / bulk) vs PICK_FACE.
--    A pallet pulled from reserve to cover a pick-face shortage becomes a
--    pick-face: contents are broken down for picking, no longer full-pallet.
-- ---------------------------------------------------------------------------
ALTER TABLE stock_locations ADD COLUMN IF NOT EXISTS pallet_function VARCHAR(20) NOT NULL DEFAULT 'RESERVE'
  CHECK (pallet_function IN ('RESERVE','PICK_FACE','MIXED'));

UPDATE stock_locations sl
   SET pallet_function = 'PICK_FACE'
  FROM location_master lm
 WHERE lm.location_code = sl.location_code
   AND lm.is_pick_face = 1
   AND sl.pallet_function = 'RESERVE';

-- ---------------------------------------------------------------------------
-- 7. Seed zones + UOM limits.
--    NOTE: DRUM max_level is 'E' per business rule (cannot go above Level E).
--    Tighten to 'D' (or lower) here if the top rack tier cannot handle drum
--    weight/dimensions — the putaway validator enforces this value dynamically.
-- ---------------------------------------------------------------------------
INSERT INTO zones (zone_code, zone_name, zone_type, priority) VALUES
  ('PICK_FAST',   'Pick-Fast (Level A)', 'PICK_FAST', 1),
  ('RESERVE',     'Reserve / Bulk (Level B-E)', 'RESERVE', 10),
  ('BULK',        'Bulk Storage', 'BULK', 15),
  ('QUARANTINE',  'Quarantine', 'QUARANTINE', 100),
  ('STAGING',     'Staging', 'STAGING', 90),
  ('UNALLOCATED', 'Unallocated', 'UNALLOCATED', 99)
ON CONFLICT (zone_code) DO NOTHING;

INSERT INTO uom_physical_limits
  (uom_type, min_level, max_level, allow_pick_face, max_weight_kg, max_height_cm, requires_equipment)
VALUES
  ('Drum',   'A', 'E', 1, 1000, 200, 1),
  ('Carton', 'A', 'E', 1,  300, 180, 0),
  ('Pail',   'A', 'E', 1,  400, 160, 0),
  ('EA',     'A', 'E', 1,  NULL, NULL, 0),
  ('Bags',   'A', 'E', 1,  NULL, NULL, 0)
ON CONFLICT (uom_type) DO NOTHING;

COMMIT;