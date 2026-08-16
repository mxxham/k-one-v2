-- =============================================================================
-- Migration 008: Zoning page upgrade
--  - Widen UOM lists to real-world UOMs (CAR / Fluidbag / IBC)
--  - Zone ↔ aisle/level bindings (aisle-level zoning)
--  - Equipment-accessibility flag per location (hard DRUM/heavy-UOM cap)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Widen UOM master lists. The live workbook stores CAR (cartons),
--    Fluidbag and IBC; the old CHECK constraints only allowed Drum/Carton/
--    Pail/EA/Bags so those UOMs could not be configured.
-- ---------------------------------------------------------------------------
ALTER TABLE uom_physical_limits DROP CONSTRAINT IF EXISTS uom_physical_limits_uom_type_check;
ALTER TABLE uom_physical_limits ADD CONSTRAINT uom_physical_limits_uom_type_check
  CHECK (uom_type IN ('Drum','Carton','CAR','Pail','EA','Bags','Fluidbag','IBC'));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_uom_type_check;
ALTER TABLE products ADD CONSTRAINT products_uom_type_check
  CHECK (uom_type IN ('Drum','Carton','CAR','Pail','EA','Bags','Fluidbag','IBC'));

-- ---------------------------------------------------------------------------
-- 2. Equipment accessibility per location. Heavy UOMs (DRUM, Fluidbag, IBC)
--    are hard-blocked from upper tiers (D/E) unless the rack is reachable by
--    heavy equipment. Default 0; operators flag accessible racks explicitly.
-- ---------------------------------------------------------------------------
ALTER TABLE location_master ADD COLUMN IF NOT EXISTS equipment_accessible SMALLINT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3. Zone ↔ aisle/level bindings. Lets a zone own a specific aisle+level
--    range (e.g. RESERVE = CD/CE D–E), so putaway targets the right racks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zone_aisles (
    id         BIGSERIAL PRIMARY KEY,
    zone_code  VARCHAR(20) NOT NULL REFERENCES zones(zone_code) ON DELETE CASCADE,
    aisle      VARCHAR(10) NOT NULL,
    min_level  VARCHAR(2)  NOT NULL DEFAULT 'A',
    max_level  VARCHAR(2)  NOT NULL DEFAULT 'E',
    is_active  SMALLINT    NOT NULL DEFAULT 1,
    created_at TIMESTAMP   NOT NULL DEFAULT NOW(),
    UNIQUE (zone_code, aisle, min_level, max_level)
);
CREATE INDEX IF NOT EXISTS idx_zone_aisles_zone  ON zone_aisles(zone_code);
CREATE INDEX IF NOT EXISTS idx_zone_aisles_aisle ON zone_aisles(aisle);

-- ---------------------------------------------------------------------------
-- 4. Seed UOM limits for the real UOMs found in the workbook.
--    - DRUM keeps max_level 'E' per business rule but requires heavy
--      equipment (hard-blocked at D/E unless equipment_accessible).
--    - Fluidbag / IBC capped lower (heavy, bulky).
--    - CAR is the carton alias used by stock data.
-- ---------------------------------------------------------------------------
INSERT INTO uom_physical_limits
  (uom_type, min_level, max_level, allow_pick_face, max_weight_kg, max_height_cm, requires_equipment, updated_at)
VALUES
  ('CAR',      'A', 'E', 1,  300, 180, 0, NOW()),
  ('Fluidbag', 'A', 'D', 1,  800, 200, 1, NOW()),
  ('IBC',      'A', 'C', 0, 1500, 220, 1, NOW())
ON CONFLICT (uom_type) DO NOTHING;

UPDATE uom_physical_limits SET requires_equipment = 1 WHERE uom_type = 'Drum' AND requires_equipment = 0;

-- ---------------------------------------------------------------------------
-- 5. Default zone bindings: PICK_FAST owns Level A, RESERVE owns Levels B–E,
--    across every aisle (CA–CG). Operators refine per aisle later in the UI.
-- ---------------------------------------------------------------------------
INSERT INTO zone_aisles (zone_code, aisle, min_level, max_level)
SELECT 'PICK_FAST', a, 'A', 'A'
FROM (VALUES ('CA'),('CB'),('CC'),('CD'),('CE'),('CF'),('CG')) AS v(a)
ON CONFLICT (zone_code, aisle, min_level, max_level) DO NOTHING;

INSERT INTO zone_aisles (zone_code, aisle, min_level, max_level)
SELECT 'RESERVE', a, 'B', 'E'
FROM (VALUES ('CA'),('CB'),('CC'),('CD'),('CE'),('CF'),('CG')) AS v(a)
ON CONFLICT (zone_code, aisle, min_level, max_level) DO NOTHING;

COMMIT;