-- ---------------------------------------------------------------------------
-- 015 — Putaway task queue.
--
-- Turns the one-off putaway suggestion (putaway::recommend at Goods Received)
-- into a batched, tracked worklist: each inbound receipt becomes a putaway
-- task whose pallet rows pre-compute the engine's suggested bins. Operators
-- claim the task, confirm / override each pallet's bin (re-validated), and
-- completing the task materialises the stock_locations rows. Every pallet
-- records who/when (labour tracking) for reports + dashboards.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS putaway_tasks (
  id BIGSERIAL PRIMARY KEY,
  task_number VARCHAR(30) NOT NULL UNIQUE,
  inbound_order_id BIGINT REFERENCES inbound_orders(id),
  status VARCHAR(20) NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','In Progress','Completed','Cancelled')),
  priority INT NOT NULL DEFAULT 5,
  assigned_to BIGINT REFERENCES users(id),
  notes TEXT,
  created_by BIGINT REFERENCES users(id),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancelled_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_putaway_tasks_status ON putaway_tasks (status);
CREATE INDEX IF NOT EXISTS idx_putaway_tasks_inbound ON putaway_tasks (inbound_order_id);

CREATE TABLE IF NOT EXISTS putaway_task_items (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES putaway_tasks(id) ON DELETE CASCADE,
  inbound_item_id BIGINT REFERENCES inbound_items(id),
  product_id BIGINT REFERENCES products(id),
  batch_number VARCHAR(255),
  uom VARCHAR(20),
  pallet_seq INT NOT NULL DEFAULT 1,
  quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
  suggested_location VARCHAR(30),
  actual_location VARCHAR(30),
  pallet_function VARCHAR(20) NOT NULL DEFAULT 'RESERVE',
  reason VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Done','Cancelled')),
  completed_by BIGINT REFERENCES users(id),
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_putaway_task_items_task ON putaway_task_items (task_id, status);
CREATE INDEX IF NOT EXISTS idx_putaway_task_items_item ON putaway_task_items (inbound_item_id);