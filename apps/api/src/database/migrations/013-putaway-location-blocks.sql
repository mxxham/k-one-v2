-- 013-putaway-location-blocks.sql
-- Putaway Location Blocking: an admin can block an aisle (aisle_prefix, matches
-- a prefix of location_code, e.g. 'CF' -> CF*) or an exact bin (location_code)
-- from automated putaway suggestions AND manual saves. Soft-delete via
-- is_active=false so history is kept. Deliberately named "block" — "hold"
-- already means stock quarantine elsewhere in the system.
--
-- Enforcement lives in the putaway engine: recommendLocations() excludes
-- blocked bins and validatePlacement() rejects saves into them.

CREATE TABLE IF NOT EXISTS putaway_location_blocks (
    id            BIGSERIAL PRIMARY KEY,
    scope_type    VARCHAR(10) NOT NULL CHECK (scope_type IN ('aisle','location')),
    aisle_prefix  VARCHAR(10),
    location_code VARCHAR(20),
    reason        TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    blocked_by    BIGINT REFERENCES users(id),
    blocked_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_putaway_block_target CHECK (
      (scope_type = 'aisle'    AND aisle_prefix  IS NOT NULL AND location_code IS NULL) OR
      (scope_type = 'location' AND location_code IS NOT NULL AND aisle_prefix  IS NULL)
    )
);

-- Fast lookups during recommend / validate / rack render.
CREATE INDEX IF NOT EXISTS idx_putaway_blocks_scope_active
  ON putaway_location_blocks(scope_type, is_active);

-- Only ONE active block per target. Partial unique indexes so deactivated rows
-- never collide (re-blocking after a deactivate is allowed).
CREATE UNIQUE INDEX IF NOT EXISTS uq_putaway_blocks_active_aisle
  ON putaway_location_blocks(aisle_prefix)
  WHERE is_active = TRUE AND aisle_prefix IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_putaway_blocks_active_loc
  ON putaway_location_blocks(location_code)
  WHERE is_active = TRUE AND location_code IS NOT NULL;