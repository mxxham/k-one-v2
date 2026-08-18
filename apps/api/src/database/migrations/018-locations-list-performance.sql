-- ---------------------------------------------------------------------------
-- 018 — Locations list performance
--
-- The locations list query (master.actions locationGetAll) joins location_master
-- against stock_locations on (location_code, status) and looks up the latest
-- stock row per location (ORDER BY id DESC LIMIT 1). The existing single-column
-- indexes (location_code, status, batch_number) can't serve either efficiently,
-- forcing a per-row scan. This composite index lets both the join and the
-- "latest row" lookup run as index-only scans.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_stock_locations_loc_status_id
  ON stock_locations(location_code, status, id DESC);