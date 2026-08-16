-- Migration 004: Department-based access (Phase 0 of WMS upgrade — new-roles.md)
-- Adds a functional "department" dimension alongside the existing seniority
-- "role". users.role stays as-is (admin/supervisor/operator/staff);
-- users.department controls which functional dashboard/access the user gets.
--
--   'inbound'    → receiving / putaway dashboards
--   'outbound'   → picking / shipping dashboards
--   'inventory'  → stock / stocktake / bintransfer dashboards
--   'all'        → admin / supervisor cross-department visibility (DEFAULT)

-- 1. users.department column (idempotent)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department VARCHAR(20) NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_department_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_department_check
      CHECK (department IN ('inbound','outbound','inventory','all'));
  END IF;
END $$;

-- 2. Seed sensible department values for existing users by role:
--    admin/supervisor stay 'all'; warehouse/supervisor->inventory; operator->outbound
UPDATE users SET department = CASE
  WHEN role IN ('admin','supervisor') THEN 'all'
  WHEN role IN ('warehouse')         THEN 'inventory'
  WHEN role IN ('operator')          THEN 'outbound'
  WHEN role IN ('staff')             THEN 'inventory'
  ELSE 'all'
END
WHERE department = 'all';
