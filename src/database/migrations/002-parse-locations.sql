-- Migration: Parse and update location_master with structured fields
-- This updates the rack, row_name (level), position, and aisle fields based on location_code
-- Format: CD01A02 → rack=CD01, aisle=CD, row_name=A, position=02

-- Update location_master by parsing location_code
-- Pattern: 2 letters + 2 digits + 1 letter + 2 digits
-- Example: CD01A02
UPDATE location_master
SET 
  aisle = SUBSTRING(location_code, 1, 2),           -- CD (rack identifier)
  rack = SUBSTRING(location_code, 1, 4),            -- CD01 (full rack)
  row_name = SUBSTRING(location_code, 5, 1),        -- A (level)
  position = SUBSTRING(location_code, 6, 2)         -- 02 (position)
WHERE 
  location_code ~ '^[A-Z]{2}\d{2}[A-E]\d{2}$'      -- Only update valid format
  AND (
    aisle IS NULL OR 
    rack IS NULL OR 
    row_name IS NULL OR 
    position IS NULL
  );

-- Verify the update
SELECT 
  location_code,
  aisle,
  rack,
  row_name,
  position,
  CASE row_name
    WHEN 'A' THEN 'Bottom'
    WHEN 'B' THEN 'Lower'
    WHEN 'C' THEN 'Middle'
    WHEN 'D' THEN 'Upper'
    WHEN 'E' THEN 'Top'
    ELSE row_name
  END as level_name
FROM location_master
WHERE location_code ~ '^[A-Z]{2}\d{2}[A-E]\d{2}$'
ORDER BY aisle, rack, row_name, position
LIMIT 20;
