-- ---------------------------------------------------------------------------
-- 014 — Backfill pallet_function for stock_locations rows written AFTER 007.
--
-- saveItemLocations / savePalletLocations never set pallet_function (the column
-- defaults to 'RESERVE'), so every bin written by auto-putaway / manual save
-- was reported as RESERVE even at Level A pick-face. Re-run the 007 backfill
-- so Level A bins are PICK_FACE; rows at B-E stay RESERVE (bulk).
-- Idempotent: PICK_FACE rows are untouched by the RESERVE predicate.
-- ---------------------------------------------------------------------------
UPDATE stock_locations sl
   SET pallet_function = 'PICK_FACE'
  FROM location_master lm
 WHERE lm.location_code = sl.location_code
   AND lm.is_pick_face = 1
   AND sl.pallet_function = 'RESERVE';