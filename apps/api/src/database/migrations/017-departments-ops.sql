-- ---------------------------------------------------------------------------
-- 017 — New "ops" (Operations) department — handheld menu set for putaway +
-- outbound operators (no dashboards).
--
-- Extends migration 004's users_department_check to include 'ops'. Server-side
-- module grants/denials live in the action modules (putaway/outbound/picklist
-- gain ops; dashboard excludes it). Idempotent: drop + re-add the constraint
-- (a strict widening — every value allowed before remains allowed).
-- ---------------------------------------------------------------------------

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_department_check;
ALTER TABLE users ADD CONSTRAINT users_department_check
  CHECK (department IN ('inbound','outbound','inventory','ops','all'));