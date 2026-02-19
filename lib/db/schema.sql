-- DhandhaPhone SQLite Schema v1
-- All business data in one file: contacts, transactions, inventory, etc.

-- ============================================
-- CONTACTS (people the owner does business with)
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  name_normalized TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  company         TEXT,
  type            TEXT DEFAULT 'customer',
  gstin           TEXT,
  notes           TEXT,
  balance         REAL DEFAULT 0,
  tags            TEXT,
  is_deleted      INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name_normalized);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);

-- ============================================
-- TRANSACTIONS (every money movement)
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  type                TEXT NOT NULL,
  amount              REAL NOT NULL,
  counterparty_id     INTEGER,
  counterparty_name   TEXT,
  method              TEXT,
  source              TEXT NOT NULL,
  category            TEXT,
  description         TEXT,
  reference_id        TEXT,
  invoice_number      TEXT,
  batch_id            TEXT,
  original_message    TEXT,
  confidence          REAL DEFAULT 1.0,
  is_confirmed        INTEGER DEFAULT 1,
  is_deleted          INTEGER DEFAULT 0,
  transaction_date    TEXT NOT NULL,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_txn_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_txn_counterparty ON transactions(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_txn_method ON transactions(method);
CREATE INDEX IF NOT EXISTS idx_txn_source ON transactions(source);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_txn_ref ON transactions(reference_id);

-- ============================================
-- TRANSACTION ITEMS (line items from invoices)
-- ============================================
CREATE TABLE IF NOT EXISTS transaction_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id  INTEGER NOT NULL REFERENCES transactions(id),
  name            TEXT NOT NULL,
  quantity        REAL DEFAULT 1,
  unit            TEXT,
  rate            REAL,
  amount          REAL,
  hsn_code        TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_txn ON transaction_items(transaction_id);

-- ============================================
-- CREDIT LEDGER (who owes whom, payment tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS credit_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id),
  transaction_id  INTEGER REFERENCES transactions(id),
  type            TEXT NOT NULL,
  amount          REAL NOT NULL,
  due_date        TEXT,
  notes           TEXT,
  is_settled      INTEGER DEFAULT 0,
  is_deleted      INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_contact ON credit_entries(contact_id);
CREATE INDEX IF NOT EXISTS idx_credit_settled ON credit_entries(is_settled);

-- ============================================
-- INVENTORY (for businesses that track stock)
-- ============================================
CREATE TABLE IF NOT EXISTS inventory (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  name_normalized TEXT,
  sku             TEXT,
  category        TEXT,
  unit            TEXT,
  quantity        REAL DEFAULT 0,
  min_quantity    REAL,
  purchase_price  REAL,
  selling_price   REAL,
  supplier_id     INTEGER REFERENCES contacts(id),
  is_active       INTEGER DEFAULT 1,
  is_deleted      INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_name ON inventory(name_normalized);
CREATE INDEX IF NOT EXISTS idx_inv_category ON inventory(category);

-- ============================================
-- INVENTORY MOVEMENTS (stock in/out log)
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id    INTEGER NOT NULL REFERENCES inventory(id),
  transaction_id  INTEGER REFERENCES transactions(id),
  type            TEXT NOT NULL,
  quantity        REAL NOT NULL,
  unit_price      REAL,
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_item ON inventory_movements(inventory_id);

-- ============================================
-- PRICES (supplier price tracking over time)
-- ============================================
CREATE TABLE IF NOT EXISTS price_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id    INTEGER REFERENCES inventory(id),
  item_name       TEXT NOT NULL,
  supplier_id     INTEGER REFERENCES contacts(id),
  price           REAL NOT NULL,
  unit            TEXT,
  source          TEXT,
  recorded_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_item ON price_history(inventory_id);
CREATE INDEX IF NOT EXISTS idx_price_supplier ON price_history(supplier_id);

-- ============================================
-- DOCUMENTS (OCR-processed documents)
-- ============================================
CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,
  file_path       TEXT,
  raw_text        TEXT,
  structured_data TEXT,
  transaction_id  INTEGER REFERENCES transactions(id),
  contact_id      INTEGER REFERENCES contacts(id),
  language        TEXT,
  confidence      REAL,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- REMINDERS (scheduled payment reminders)
-- ============================================
CREATE TABLE IF NOT EXISTS reminders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id),
  credit_entry_id INTEGER REFERENCES credit_entries(id),
  amount          REAL,
  message_draft   TEXT,
  scheduled_at    TEXT,
  sent_at         TEXT,
  channel         TEXT DEFAULT 'sms',
  status          TEXT DEFAULT 'pending',
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reminder_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminder_scheduled ON reminders(scheduled_at);

-- ============================================
-- SKILL PATTERNS (dynamically generated skills)
-- ============================================
CREATE TABLE IF NOT EXISTS skill_patterns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern         TEXT NOT NULL,
  category        TEXT,
  hit_count       INTEGER DEFAULT 1,
  skill_generated INTEGER DEFAULT 0,
  skill_name      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- OWNER PROFILE (key-value settings store)
-- ============================================
CREATE TABLE IF NOT EXISTS owner_profile (
  key             TEXT PRIMARY KEY,
  value           TEXT,
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- DEDUP LOG (prevents duplicate SMS/notification capture)
-- ============================================
CREATE TABLE IF NOT EXISTS dedup_log (
  hash            TEXT PRIMARY KEY,
  source          TEXT,
  transaction_id  INTEGER REFERENCES transactions(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- CATEGORY RULES (auto-categorization rules)
-- replaces accounting/categories.json
-- ============================================
CREATE TABLE IF NOT EXISTS category_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  category        TEXT NOT NULL,
  match_type      TEXT NOT NULL DEFAULT 'keyword',
  match_value     TEXT NOT NULL,
  priority        INTEGER DEFAULT 0,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catrules_category ON category_rules(category);

-- ============================================
-- MONTHLY REPORTS (P&L + ITC snapshots)
-- replaces accounting/pnl-YYYY-MM.json + itc-YYYY-MM.json
-- ============================================
CREATE TABLE IF NOT EXISTS monthly_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  month           TEXT NOT NULL,
  report_type     TEXT NOT NULL,
  data            TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(month, report_type)
);

CREATE INDEX IF NOT EXISTS idx_reports_month ON monthly_reports(month);

-- ============================================
-- FRAUD ALERTS
-- replaces accounting/fraud-alerts.jsonl
-- ============================================
CREATE TABLE IF NOT EXISTS fraud_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_type      TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info',
  description     TEXT,
  transaction_id  INTEGER REFERENCES transactions(id),
  data            TEXT,
  status          TEXT DEFAULT 'pending',
  resolved_at     TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fraud_status ON fraud_alerts(status);
CREATE INDEX IF NOT EXISTS idx_fraud_severity ON fraud_alerts(severity);

-- ============================================
-- FRAUD BASELINES (statistical baselines)
-- replaces accounting/txn-baseline.json
-- ============================================
CREATE TABLE IF NOT EXISTS fraud_baselines (
  key             TEXT PRIMARY KEY,
  value           TEXT,
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- PENDING ACTIONS
-- replaces pending/actions.json
-- ============================================
CREATE TABLE IF NOT EXISTS pending_actions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,
  target_contact_id INTEGER REFERENCES contacts(id),
  description     TEXT,
  due_date        TEXT,
  status          TEXT DEFAULT 'pending',
  data            TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_actions(status);
CREATE INDEX IF NOT EXISTS idx_pending_due ON pending_actions(due_date);

-- ============================================
-- ANON MAP (PII anonymization mappings)
-- replaces .anon-map.json
-- ============================================
CREATE TABLE IF NOT EXISTS anon_map (
  category        TEXT NOT NULL,
  original        TEXT NOT NULL,
  replacement     TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (category, original)
);

-- ============================================
-- BRAIN: ENTITIES (enriched business objects)
-- ============================================
CREATE TABLE IF NOT EXISTS brain_entities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,
  -- Types: customer_profile, supplier_profile, product_insight,
  --        pattern, event, business_snapshot, market_note
  name            TEXT NOT NULL,
  ref_id          INTEGER,
  ref_table       TEXT,
  -- FK to source: 'contacts', 'inventory', etc. Nullable.
  properties      TEXT NOT NULL DEFAULT '{}',
  confidence      REAL DEFAULT 0.5,
  is_active       INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brain_ent_type ON brain_entities(type);
CREATE INDEX IF NOT EXISTS idx_brain_ent_ref ON brain_entities(ref_table, ref_id);
CREATE INDEX IF NOT EXISTS idx_brain_ent_active ON brain_entities(is_active);
CREATE INDEX IF NOT EXISTS idx_brain_ent_name ON brain_entities(name);

-- ============================================
-- BRAIN: EDGES (relationships between entities)
-- ============================================
CREATE TABLE IF NOT EXISTS brain_edges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_entity_id  INTEGER NOT NULL REFERENCES brain_entities(id),
  to_entity_id    INTEGER REFERENCES brain_entities(id),
  type            TEXT NOT NULL,
  -- Types: buys_from, supplies_to, competes_with, has_behavior,
  --        triggered_by, related_to, depends_on, same_as
  weight          REAL DEFAULT 0.5,
  properties      TEXT NOT NULL DEFAULT '{}',
  last_refreshed  TEXT DEFAULT (datetime('now')),
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brain_edge_from ON brain_edges(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_edge_to ON brain_edges(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_edge_type ON brain_edges(type);

-- ============================================
-- BRAIN: OBSERVATIONS (agent's running notebook)
-- ============================================
CREATE TABLE IF NOT EXISTS brain_observations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,
  -- Types: anomaly, inference, intention, mood, insight, prediction, todo
  entity_id       INTEGER REFERENCES brain_entities(id),
  content         TEXT NOT NULL,
  properties      TEXT NOT NULL DEFAULT '{}',
  confidence      REAL DEFAULT 0.5,
  source          TEXT,
  -- heartbeat, conversation, calendar, analysis, heuristic
  language        TEXT,
  is_resolved     INTEGER DEFAULT 0,
  expires_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brain_obs_type ON brain_observations(type);
CREATE INDEX IF NOT EXISTS idx_brain_obs_entity ON brain_observations(entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_obs_active ON brain_observations(is_resolved, expires_at);

-- ============================================
-- NOTIFICATION LOG (tracks processed notifications)
-- ============================================
-- Separate from dedup_log because notifications need
-- additional metadata (package name, status) and the
-- dedup_log is shared across all channels.
-- ============================================
CREATE TABLE IF NOT EXISTS notification_log (
  hash            TEXT PRIMARY KEY,
  package_name    TEXT NOT NULL,
  status          TEXT NOT NULL,    -- 'captured', 'duplicate', 'skipped', 'error'
  transaction_id  INTEGER REFERENCES transactions(id),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_log_pkg ON notification_log(package_name);
CREATE INDEX IF NOT EXISTS idx_notif_log_status ON notification_log(status);

-- ============================================
-- VPA MAP (UPI VPA → contact resolution)
-- ============================================
CREATE TABLE IF NOT EXISTS vpa_map (
  vpa             TEXT PRIMARY KEY,
  contact_id      INTEGER REFERENCES contacts(id),
  contact_name    TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
