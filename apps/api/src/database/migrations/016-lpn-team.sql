-- ---------------------------------------------------------------------------
-- 016 — LPN + two-person putaway team assignment (extends S42 task queue).
--
-- 1. putaway_task_items.lpn_code — a unique per-pallet License Plate Number,
--    generated at Goods Received (same moment the S42 task rows are created).
--    It is the barcode the warehouse prints onto the pallet label; the mobile
--    checklist-partner flow scans it to confirm the pallet before putaway.
-- 2. putaway_tasks.forklift_operator_id / checklist_partner_id — the 2-person
--    team that executes a putaway task. S42's assigned_to stays as the claim
--    field; these two carry the named operator + checklist partner assigned by
--    the inbound operator on the task list screen.
-- ---------------------------------------------------------------------------

ALTER TABLE putaway_task_items ADD COLUMN IF NOT EXISTS lpn_code TEXT UNIQUE;

ALTER TABLE putaway_tasks ADD COLUMN IF NOT EXISTS forklift_operator_id BIGINT REFERENCES users(id);
ALTER TABLE putaway_tasks ADD COLUMN IF NOT EXISTS checklist_partner_id BIGINT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_putaway_tasks_forklift ON putaway_tasks (forklift_operator_id);
CREATE INDEX IF NOT EXISTS idx_putaway_tasks_checklist_partner ON putaway_tasks (checklist_partner_id, status);