-- ---------------------------------------------------------------------------
-- S28 Phase 10 — Cycle Count Scheduling
-- Recurring stock-take program. scope_type mirrors stock_take semantics
-- ('full' | 'location') plus 'velocity' (S26 velocity_class weighting). A
-- schedule is "due" when is_active AND next_run_date <= CURRENT_DATE; running
-- it reuses the EXISTING StockTakeService.create() and autoLoadByLocations(),
-- then advances next_run_date by frequency. No background scheduler in this
-- phase — an admin "Run Due Schedules" action triggers generation (a BullMQ
-- repeatable job in apps/worker is the future hook-in point).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_count_schedules (
    id               BIGSERIAL PRIMARY KEY,
    schedule_name    VARCHAR(150) NOT NULL,
    frequency        VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','quarterly')),
    scope_type       VARCHAR(20) NOT NULL DEFAULT 'full' CHECK (scope_type IN ('full','location','velocity')),
    scope_locations  TEXT,
    velocity_class   VARCHAR(1) CHECK (velocity_class IN ('A','B','C')),
    next_run_date    DATE NOT NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_by       BIGINT NOT NULL REFERENCES users(id),
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cycle_count_schedules_due
    ON cycle_count_schedules (is_active, next_run_date);

-- Link generated stock takes back to their schedule for traceability.
ALTER TABLE stock_take ADD COLUMN IF NOT EXISTS schedule_id BIGINT REFERENCES cycle_count_schedules(id) ON DELETE SET NULL;