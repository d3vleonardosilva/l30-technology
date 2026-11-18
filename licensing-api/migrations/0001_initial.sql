PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trials (
  device_id TEXT PRIMARY KEY,
  customer_id TEXT,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_order_id TEXT UNIQUE,
  external_reference TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL,
  currency_code TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  expires_on TEXT NOT NULL,
  serial TEXT NOT NULL UNIQUE,
  key_id TEXT NOT NULL,
  token_version INTEGER NOT NULL,
  token_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_device ON orders(device_id);
CREATE INDEX IF NOT EXISTS idx_licenses_customer ON licenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_licenses_device ON licenses(device_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_licenses_active_device
  ON licenses(device_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed_at);
