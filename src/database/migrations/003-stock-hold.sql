-- Migration 003: Stock Hold / Quarantine Status (Phase 1 of WMS upgrade)
-- Adds hold tracking columns to `stock` and widens stock_ledger transaction_type
-- so hold/release events are audit-traceable (HOLD / RELEASE types, 0 qty).

-- 1. stock hold columns (idempotent for existing DBs)
ALTER TABLE stock
  ADD COLUMN IF NOT EXISTS hold_status VARCHAR(20) NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS hold_by BIGINT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS hold_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_hold_status_check') THEN
    ALTER TABLE stock ADD CONSTRAINT stock_hold_status_check
      CHECK (hold_status IN ('available','on_hold','quarantine','damaged'));
  END IF;
END $$;

-- 2. widen stock_ledger.transaction_type CHECK to include HOLD / RELEASE
ALTER TABLE stock_ledger DROP CONSTRAINT IF EXISTS stock_ledger_transaction_type_check;
ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_transaction_type_check
  CHECK (transaction_type IN ('IN','OUT','ADJUSTMENT','TRANSFER','TRANSFER_IN','TRANSFER_OUT','HOLD','RELEASE'));