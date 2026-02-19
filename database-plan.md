# DhandhaPhone — Database Layer Plan

## The Problem

The current architecture stores everything in flat files:
- `ledger.jsonl` — append-only transaction log
- `summary.json` — running totals
- `contacts.json` — all contacts as one JSON blob
- `credit-log.jsonl` — credit/debit history

This breaks down fast. A kirana store doing 30-50 transactions a day
hits 1,000+ entries in a month. When the owner asks "how much did
Sharma pay me last week?" or "cash vs UPI breakdown for February",
the agent has to:
1. Read the entire JSONL file into memory
2. Parse every line
3. Filter, group, and aggregate in JavaScript

At 10K+ transactions (6-8 months of data), this becomes:
- **Slow**: 2-5 seconds just to parse and filter
- **Memory-hungry**: Entire transaction history loaded into RAM
- **Fragile**: One corrupted line breaks the whole file
- **Query-limited**: Can't do JOINs, GROUP BY, date ranges efficiently
- **No indexing**: Every query is a full scan

We need a real database. But it has to run on an Android phone
inside Termux with zero setup complexity.

---

## Evaluation of Options

### The Constraints

1. **Runs in Termux** on Android (ARM64, aarch64)
2. **Node.js gateway** — needs JS/Node bindings
3. **No native compilation** — `node-gyp` is unreliable on Termux
4. **Single file** — easy backup, restore, transfer
5. **Lightweight** — can't hog phone RAM/CPU
6. **ACID compliant** — financial data can't be corrupted
7. **Single-user** — no concurrent access needed
8. **Handles 50K+ rows** comfortably (1-2 years of data)
9. **Agent-friendly** — the LLM generates SQL, so the syntax matters

### Option 1: DuckDB
**The "SQLite for Analytics" — columnar, blazing fast for OLAP.**

| Pros | Cons |
|---|---|
| Best-in-class analytical queries | Android support is "experimental" |
| Columnar storage, great for aggregation | Old Node.js bindings (`duckdb` npm) deprecated |
| Can query JSON/CSV/Parquet natively | New bindings (`@duckdb/node-api`) no ARM64 Android prebuilts |
| Fantastic for dashboards and reports | Extensions don't ship for `linux_arm64_android` |
| | Overkill for our scale (thousands of rows, not billions) |
| | ~150MB binary — heavy for a phone |
| | OLAP-first design, less ideal for frequent single-row writes |

**Verdict: Too risky.** Android/Termux is a second-class citizen.
The Node.js binding situation is in flux. And DuckDB is designed for
analytical workloads on large datasets — our data is transactional
(OLTP) first, analytical second. At our scale (tens of thousands of
rows, not millions), SQLite handles analytics just fine.

### Option 2: better-sqlite3
**The fastest SQLite library for Node.js. Synchronous API.**

| Pros | Cons |
|---|---|
| Fastest SQLite for Node.js (benchmarked) | Requires native compilation via `node-gyp` |
| Synchronous API — simple, predictable | **FAILS to build in Termux** (multiple GitHub issues) |
| Used by thousands of projects | No prebuilt binaries for `android/arm64` |
| Excellent prepared statement support | Depends on C++ toolchain in Termux |
| WAL mode support built-in | |

**Verdict: Would be perfect, except it doesn't build on Termux.**
Multiple users have reported build failures on Android ARM64.
The native compilation dependency makes this a non-starter for us.

### Option 3: node:sqlite (Node.js Built-in)
**Zero-dependency SQLite built right into Node.js 22.5+.**

| Pros | Cons |
|---|---|
| Zero dependencies — ships with Node.js | Still experimental (`--experimental-sqlite` flag) |
| No compilation, no npm install | Only synchronous API (DatabaseSync) |
| Maintained by Node.js core team | Limited API compared to better-sqlite3 |
| Persistent file-based storage | Requires Node.js 22.5+ (must verify Termux version) |
| | May have breaking changes before going stable |
| | No user-defined functions yet |

**Verdict: Strong contender. IF Termux ships Node 22.5+, this is the
simplest possible option. But relying on an experimental API for
financial data is risky. We use this as our PRIMARY choice with
a fallback plan.**

### Option 4: node-sqlite3-wasm
**SQLite compiled to WebAssembly for Node.js with direct file access.**

| Pros | Cons |
|---|---|
| No native compilation needed (pure WASM) | ~3-5x slower than native SQLite |
| Direct file system access (persistent) | Smaller community (2K weekly downloads) |
| Works on ANY platform that runs Node.js | Manual memory management (must close db) |
| API similar to better-sqlite3 | WASM binary adds ~2MB to package |
| SQLite under the hood — ACID, proven | |
| BigInt support for large numbers | |
| Single .db file — easy backup/restore | |

**Verdict: The safest fallback. Guaranteed to work on Termux
regardless of Node version. Slightly slower but more than adequate
for our scale.**

### Option 5: sql.js
**SQLite compiled to WASM/asm.js — the original.**

| Pros | Cons |
|---|---|
| Oldest, most battle-tested WASM SQLite | **In-memory only** — entire DB loaded into RAM |
| No native compilation | Must manually export/save to disk |
| Pure JavaScript, works everywhere | Risk of data loss on crash (if not saved) |
| | At 50K+ rows, memory usage gets problematic |
| | Not designed for persistent server-side use |

**Verdict: No. The in-memory-only model with manual persistence is
too dangerous for financial data. A phone crash between writes means
data loss.**

---

## The Decision: Two-Tier Strategy

### Primary: `node:sqlite` (Built-in)
If the phone has Node.js 22.5+ (which Termux likely does — their
package repo tracks recent releases), we use the built-in module.

**Why:**
- Zero dependencies — nothing to `npm install` for the DB
- Maintained by Node.js core — will only get better
- Synchronous API is actually BETTER for our single-threaded gateway
  (no callback hell, no race conditions)
- Same SQLite semantics as better-sqlite3
- `--experimental-sqlite` flag is trivial to add to our start script

### Fallback: `node-sqlite3-wasm`
If `node:sqlite` is unavailable or unstable, we drop in the WASM
version. Same SQL, same schema, same queries — just a different
driver. Our abstraction layer (`db.js`) hides the difference.

```javascript
// gateway/db/db.js — auto-detects which driver to use

let Database;

try {
  // Try built-in first (Node 22.5+)
  const { DatabaseSync } = require('node:sqlite');
  Database = DatabaseSync;
  console.log('[DB] Using node:sqlite (built-in)');
} catch (e) {
  // Fall back to WASM
  const { Database: WasmDB } = require('node-sqlite3-wasm');
  Database = WasmDB;
  console.log('[DB] Using node-sqlite3-wasm (fallback)');
}
```

---

## Schema Design

### Design Principles

1. **Normalize intelligently** — Contacts, transactions, and items
   are separate tables with foreign keys. But don't over-normalize —
   a denormalized `counterparty_name` on transactions avoids JOINs
   for the most common query.

2. **Timestamps everywhere** — Every row gets `created_at` and
   `updated_at`. The agent needs temporal queries constantly.

3. **Soft deletes** — Never hard-delete financial data. Use
   `is_deleted` flag. The owner might need to undo.

4. **Source tracking** — Every transaction records WHERE it came from
   (manual, SMS, notification, OCR, voice). This is audit trail.

5. **Text-friendly** — Counterparty names stored as-is (original
   script: Hindi, Telugu, etc). No transliteration forced.

6. **Agent-query-friendly** — Column names are clear English that
   an LLM can understand and generate SQL for. No abbreviations.

### Tables

```sql
-- ============================================
-- CONTACTS (people the owner does business with)
-- ============================================
CREATE TABLE IF NOT EXISTS contacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,             -- "Krishna Traders" or "कृष्णा ट्रेडर्स"
  name_normalized TEXT,                      -- lowercase, stripped for search
  phone           TEXT,                      -- "+919876543210"
  email           TEXT,
  address         TEXT,
  company         TEXT,
  type            TEXT DEFAULT 'customer',   -- customer, supplier, staff, other
  gstin           TEXT,                      -- GST number if known
  notes           TEXT,                      -- free-form notes
  balance         REAL DEFAULT 0,            -- running balance (+ = they owe us, - = we owe them)
  tags            TEXT,                      -- comma-separated: "vip,regular,wholesale"
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
  type                TEXT NOT NULL,          -- 'credit' or 'debit'
  amount              REAL NOT NULL,          -- always positive
  counterparty_id     INTEGER,               -- FK to contacts (nullable for unknown)
  counterparty_name   TEXT,                   -- denormalized for fast display
  method              TEXT,                   -- 'CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE', 'OTHER'
  source              TEXT NOT NULL,          -- 'manual', 'sms', 'notification', 'ocr', 'voice', 'bank_import'
  category            TEXT,                   -- 'sale', 'purchase', 'salary', 'rent', 'utility', 'other'
  description         TEXT,                   -- "Rice 10 bags from Krishna Traders"
  reference_id        TEXT,                   -- UPI ref, cheque number, invoice number
  invoice_number      TEXT,                   -- if from OCR invoice
  batch_id            TEXT,                   -- groups bank statement imports
  original_message    TEXT,                   -- raw SMS or voice transcript that created this
  confidence          REAL DEFAULT 1.0,       -- 0-1, how sure are we (lower for auto-parsed)
  is_confirmed        INTEGER DEFAULT 1,      -- owner confirmed this entry
  is_deleted          INTEGER DEFAULT 0,
  transaction_date    TEXT NOT NULL,          -- when the transaction actually happened
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
  name            TEXT NOT NULL,              -- "Basmati Rice 25kg"
  quantity        REAL DEFAULT 1,
  unit            TEXT,                       -- "kg", "pcs", "bags", "litre"
  rate            REAL,                       -- price per unit
  amount          REAL,                       -- quantity × rate
  hsn_code        TEXT,                       -- HST/SAC code if from GST invoice
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
  type            TEXT NOT NULL,              -- 'gave' (we gave credit) or 'received' (they paid back)
  amount          REAL NOT NULL,
  due_date        TEXT,                       -- when payment is expected
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
  name            TEXT NOT NULL,              -- "Basmati Rice 25kg"
  name_normalized TEXT,
  sku             TEXT,
  category        TEXT,
  unit            TEXT,                       -- "kg", "pcs", "bags"
  quantity        REAL DEFAULT 0,             -- current stock
  min_quantity    REAL,                       -- reorder alert threshold
  purchase_price  REAL,                       -- last known purchase price
  selling_price   REAL,                       -- current selling price
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
  type            TEXT NOT NULL,              -- 'in' (purchase/restock) or 'out' (sale/usage)
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
  item_name       TEXT NOT NULL,              -- denormalized, for items not in inventory
  supplier_id     INTEGER REFERENCES contacts(id),
  price           REAL NOT NULL,
  unit            TEXT,
  source          TEXT,                       -- 'invoice_ocr', 'manual', 'price_list'
  recorded_at     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_item ON price_history(inventory_id);
CREATE INDEX IF NOT EXISTS idx_price_supplier ON price_history(supplier_id);

-- ============================================
-- DOCUMENTS (OCR-processed documents)
-- ============================================
CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,              -- 'invoice', 'receipt', 'bank_statement', 'business_card', etc.
  file_path       TEXT,                       -- path to original image/PDF on phone
  raw_text        TEXT,                       -- full extracted text from Sarvam Vision
  structured_data TEXT,                       -- JSON of parsed fields
  transaction_id  INTEGER REFERENCES transactions(id),
  contact_id      INTEGER REFERENCES contacts(id),
  language        TEXT,                       -- detected language
  confidence      REAL,                       -- OCR confidence
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
  message_draft   TEXT,                       -- generated reminder text
  scheduled_at    TEXT,                       -- when to send
  sent_at         TEXT,                       -- when actually sent (null = pending)
  channel         TEXT DEFAULT 'sms',         -- 'sms', 'whatsapp'
  status          TEXT DEFAULT 'pending',     -- 'pending', 'sent', 'cancelled'
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reminder_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminder_scheduled ON reminders(scheduled_at);

-- ============================================
-- SKILLS (dynamically generated skills)
-- ============================================
CREATE TABLE IF NOT EXISTS skill_patterns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern         TEXT NOT NULL,              -- what the owner asked
  category        TEXT,                       -- grouped pattern category
  hit_count       INTEGER DEFAULT 1,          -- how many times asked
  skill_generated INTEGER DEFAULT 0,          -- whether a skill was created
  skill_name      TEXT,                       -- name of generated skill
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- OWNER PROFILE (business settings)
-- ============================================
CREATE TABLE IF NOT EXISTS owner_profile (
  key             TEXT PRIMARY KEY,
  value           TEXT,
  updated_at      TEXT DEFAULT (datetime('now'))
);
-- Stores: name, business_name, business_type, language_preference,
--         phone, city, state, onboarding_complete, etc.

-- ============================================
-- DEDUP LOG (prevents duplicate SMS/notification capture)
-- ============================================
CREATE TABLE IF NOT EXISTS dedup_log (
  hash            TEXT PRIMARY KEY,           -- SHA256 of (amount + date + ref/sender)
  source          TEXT,                       -- 'sms' or 'notification'
  transaction_id  INTEGER REFERENCES transactions(id),
  created_at      TEXT DEFAULT (datetime('now'))
);
```

---

## The Database Abstraction Layer

### `gateway/db/db.js` — Core Database Module

```javascript
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class DhandhaDB {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(
      process.env.DHANDHA_DATA_DIR || '.',
      'dhandhaphone.db'
    );

    // Auto-detect driver
    this.db = this._initDriver();

    // Enable WAL mode (faster writes, concurrent reads)
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');

    // Create schema
    this._initSchema();
  }

  _initDriver() {
    try {
      const { DatabaseSync } = require('node:sqlite');
      console.log('[DB] Using node:sqlite (built-in)');
      return new DatabaseSync(this.dbPath);
    } catch (e) {
      const { Database } = require('node-sqlite3-wasm');
      console.log('[DB] Using node-sqlite3-wasm (fallback)');
      return new Database(this.dbPath);
    }
  }

  _initSchema() {
    // Read and execute schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(schema);
  }

  // === TRANSACTIONS (financial) ===

  addTransaction(txn) {
    const stmt = this.db.prepare(`
      INSERT INTO transactions
        (type, amount, counterparty_id, counterparty_name, method,
         source, category, description, reference_id, invoice_number,
         batch_id, original_message, confidence, is_confirmed,
         transaction_date)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      txn.type, txn.amount, txn.counterparty_id, txn.counterparty_name,
      txn.method, txn.source, txn.category, txn.description,
      txn.reference_id, txn.invoice_number, txn.batch_id,
      txn.original_message, txn.confidence || 1.0,
      txn.is_confirmed !== undefined ? txn.is_confirmed : 1,
      txn.transaction_date || new Date().toISOString().split('T')[0]
    );
    return result.lastInsertRowid;
  }

  getTransactions(filters = {}) {
    let sql = 'SELECT * FROM transactions WHERE is_deleted = 0';
    const params = [];

    if (filters.type) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }
    if (filters.from_date) {
      sql += ' AND transaction_date >= ?';
      params.push(filters.from_date);
    }
    if (filters.to_date) {
      sql += ' AND transaction_date <= ?';
      params.push(filters.to_date);
    }
    if (filters.counterparty_id) {
      sql += ' AND counterparty_id = ?';
      params.push(filters.counterparty_id);
    }
    if (filters.method) {
      sql += ' AND method = ?';
      params.push(filters.method);
    }
    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters.source) {
      sql += ' AND source = ?';
      params.push(filters.source);
    }

    sql += ' ORDER BY transaction_date DESC, created_at DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  // === SUMMARIES (agent's most common queries) ===

  getDailySummary(date) {
    const stmt = this.db.prepare(`
      SELECT
        type,
        COUNT(*) as count,
        SUM(amount) as total,
        method,
        category
      FROM transactions
      WHERE transaction_date = ? AND is_deleted = 0
      GROUP BY type, method, category
    `);
    return stmt.all(date);
  }

  getDateRangeSummary(fromDate, toDate) {
    const stmt = this.db.prepare(`
      SELECT
        type,
        COUNT(*) as count,
        SUM(amount) as total
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ? AND is_deleted = 0
      GROUP BY type
    `);
    return stmt.all(fromDate, toDate);
  }

  getMethodBreakdown(fromDate, toDate) {
    const stmt = this.db.prepare(`
      SELECT
        method,
        type,
        COUNT(*) as count,
        SUM(amount) as total
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ? AND is_deleted = 0
      GROUP BY method, type
    `);
    return stmt.all(fromDate, toDate);
  }

  getTopCounterparties(fromDate, toDate, limit = 10) {
    const stmt = this.db.prepare(`
      SELECT
        counterparty_name,
        counterparty_id,
        COUNT(*) as transaction_count,
        SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as total_received,
        SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as total_paid
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ?
        AND is_deleted = 0
        AND counterparty_name IS NOT NULL
      GROUP BY counterparty_id
      ORDER BY (total_received + total_paid) DESC
      LIMIT ?
    `);
    return stmt.all(fromDate, toDate, limit);
  }

  getRevenueByDay(fromDate, toDate) {
    const stmt = this.db.prepare(`
      SELECT
        transaction_date as date,
        SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as revenue,
        SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as expenses,
        SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) as net
      FROM transactions
      WHERE transaction_date BETWEEN ? AND ? AND is_deleted = 0
      GROUP BY transaction_date
      ORDER BY transaction_date
    `);
    return stmt.all(fromDate, toDate);
  }

  // === CONTACTS ===

  addContact(contact) {
    const stmt = this.db.prepare(`
      INSERT INTO contacts
        (name, name_normalized, phone, email, address, company,
         type, gstin, notes, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      contact.name,
      (contact.name || '').toLowerCase().trim(),
      contact.phone, contact.email, contact.address, contact.company,
      contact.type || 'customer', contact.gstin, contact.notes,
      contact.tags
    );
    return result.lastInsertRowid;
  }

  findContact(query) {
    // Fuzzy search by name, phone, or company
    const normalized = (query || '').toLowerCase().trim();
    const stmt = this.db.prepare(`
      SELECT * FROM contacts
      WHERE is_deleted = 0
        AND (name_normalized LIKE ?
             OR phone LIKE ?
             OR company LIKE ?)
      LIMIT 10
    `);
    return stmt.all(`%${normalized}%`, `%${query}%`, `%${normalized}%`);
  }

  updateContactBalance(contactId, delta) {
    const stmt = this.db.prepare(`
      UPDATE contacts
      SET balance = balance + ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(delta, contactId);
  }

  getReceivables() {
    const stmt = this.db.prepare(`
      SELECT
        c.id, c.name, c.phone, c.balance,
        MIN(ce.created_at) as oldest_credit_date,
        julianday('now') - julianday(MIN(ce.created_at)) as days_overdue
      FROM contacts c
      LEFT JOIN credit_entries ce ON ce.contact_id = c.id
        AND ce.is_settled = 0 AND ce.type = 'gave'
      WHERE c.balance > 0 AND c.is_deleted = 0
      GROUP BY c.id
      ORDER BY c.balance DESC
    `);
    return stmt.all();
  }

  // === DEDUPLICATION ===

  isDuplicate(amount, date, reference) {
    const raw = `${amount}|${date}|${reference || ''}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const stmt = this.db.prepare(
      'SELECT 1 FROM dedup_log WHERE hash = ?'
    );
    return stmt.get(hash) !== undefined;
  }

  markProcessed(amount, date, reference, source, transactionId) {
    const raw = `${amount}|${date}|${reference || ''}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO dedup_log (hash, source, transaction_id)
      VALUES (?, ?, ?)
    `);
    stmt.run(hash, source, transactionId);
  }

  // === AGENT QUERY INTERFACE ===

  /**
   * Execute a raw SQL query from the agent.
   * ONLY SELECT queries are allowed. The agent generates SQL
   * and we validate it before execution.
   *
   * @param {string} sql — SQL query (must start with SELECT)
   * @param {Array} params — bound parameters
   * @returns {Array} — query results
   */
  agentQuery(sql, params = []) {
    // Safety: only allow SELECT
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT')) {
      throw new Error('Agent queries must be SELECT only');
    }
    // Safety: block dangerous patterns
    const blocked = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER',
                     'CREATE', 'ATTACH', 'DETACH', 'PRAGMA'];
    for (const word of blocked) {
      if (trimmed.includes(word)) {
        throw new Error(`Agent queries cannot contain ${word}`);
      }
    }
    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  // === BACKUP ===

  backup(destPath) {
    // Simple file copy (SQLite in WAL mode handles this safely
    // if we checkpoint first)
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(this.dbPath, destPath);
  }

  close() {
    this.db.close();
  }
}

module.exports = { DhandhaDB };
```

### `gateway/db/schema.sql`
Contains all the CREATE TABLE statements above. Stored as a separate
file so it's easy to version and review.

### `gateway/db/migrate.js`
Handles schema migrations as we evolve.

```javascript
const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema',
    up: (db) => {
      // schema.sql handles this
    }
  },
  {
    version: 2,
    description: 'Add GST fields to transactions',
    up: (db) => {
      db.exec(`
        ALTER TABLE transactions ADD COLUMN cgst_amount REAL;
        ALTER TABLE transactions ADD COLUMN sgst_amount REAL;
        ALTER TABLE transactions ADD COLUMN igst_amount REAL;
      `);
    }
  },
  // Future migrations go here
];

function runMigrations(db) {
  // Create migrations table if needed
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      description TEXT,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const applied = db.prepare(
    'SELECT MAX(version) as v FROM _migrations'
  ).get();
  const currentVersion = applied?.v || 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      console.log(`[DB] Running migration ${migration.version}: ${migration.description}`);
      migration.up(db);
      db.prepare(
        'INSERT INTO _migrations (version, description) VALUES (?, ?)'
      ).run(migration.version, migration.description);
    }
  }
}
```

---

## How the Agent Uses the Database

### The Agent-SQL Pattern

The agent doesn't write raw SQL. Instead, we give the LLM a
**database context** in its system prompt that describes the tables,
and provide **pre-built query functions** it can call. For complex
ad-hoc questions, it generates SQL that goes through `agentQuery()`.

#### System Prompt Addition (to SOUL.md):

```markdown
## Database Access

You have access to a SQLite database with the owner's business data.

Tables available:
- transactions: All money movements (type, amount, counterparty, method, category, date)
- contacts: People (name, phone, type, balance)
- credit_entries: Credit/debit tracking (who owes what)
- inventory: Stock items (name, quantity, prices)
- documents: OCR-processed documents

Pre-built functions you can call:
- db.getDailySummary(date) — today's revenue/expenses by method/category
- db.getDateRangeSummary(from, to) — totals for a period
- db.getMethodBreakdown(from, to) — cash vs UPI vs card breakdown
- db.getTopCounterparties(from, to) — biggest customers/suppliers
- db.getRevenueByDay(from, to) — daily trend data
- db.getReceivables() — who owes money and how overdue
- db.findContact(query) — search contacts by name or phone

For complex queries the pre-built functions don't cover, you can
generate a SELECT query:
- db.agentQuery(sql, params) — runs a read-only SELECT query

Rules:
- NEVER generate INSERT/UPDATE/DELETE SQL. All writes go through
  the dedicated functions (addTransaction, addContact, etc.)
- Use date format 'YYYY-MM-DD' for all date comparisons
- Amount is always positive; type ('credit'/'debit') indicates direction
- counterparty_name is denormalized — you can filter without JOINs
```

#### Example Agent Interactions:

```
Owner: "Aaj kitna hua?" (How much today?)
Agent thinks: → db.getDailySummary('2026-02-18')
Response: "Aaj ₹47,200 aaye, ₹12,800 gaye. Net: +₹34,400"

Owner: "Sharma ji se kitna lena hai?"
Agent thinks: → db.findContact("Sharma") → gets contact_id
             → db.agentQuery("SELECT SUM(amount) FROM credit_entries
                WHERE contact_id = ? AND type = 'gave'
                AND is_settled = 0", [contactId])
Response: "Sharma ji se ₹15,000 lena baaki hai, 12 din se pending."

Owner: "Last month cash vs UPI?"
Agent thinks: → db.getMethodBreakdown('2026-01-01', '2026-01-31')
Response: "January mein: Cash ₹2,45,000 (62%), UPI ₹1,48,000 (38%)"

Owner: "Top 5 customers this quarter"
Agent thinks: → db.getTopCounterparties('2026-01-01', '2026-03-31', 5)
Response: "1. Lakshmi Stores ₹3.2L, 2. Rajan Medical ₹2.8L..."
```

---

## Migration from JSONL Files

For existing users who have data in the old flat-file format,
we need a one-time migration.

### `gateway/db/import-legacy.js`

```javascript
function importLegacyData(db, workspacePath) {
  const fs = require('fs');
  const path = require('path');

  // 1. Import contacts
  const contactsFile = path.join(workspacePath, 'contacts.json');
  if (fs.existsSync(contactsFile)) {
    const contacts = JSON.parse(fs.readFileSync(contactsFile, 'utf8'));
    for (const [name, contact] of Object.entries(contacts)) {
      db.addContact({
        name: contact.name || name,
        phone: contact.phone,
        type: contact.type || 'customer',
        notes: contact.notes,
        balance: contact.balance || 0,
      });
    }
    console.log(`[Migration] Imported ${Object.keys(contacts).length} contacts`);
  }

  // 2. Import transactions from ledger.jsonl
  const ledgerFile = path.join(workspacePath, 'ledger.jsonl');
  if (fs.existsSync(ledgerFile)) {
    const lines = fs.readFileSync(ledgerFile, 'utf8')
      .split('\n')
      .filter(line => line.trim());

    let count = 0;
    for (const line of lines) {
      try {
        const txn = JSON.parse(line);
        db.addTransaction({
          type: txn.type,
          amount: txn.amount,
          counterparty_name: txn.counterparty || txn.from || txn.to,
          method: txn.method || 'OTHER',
          source: txn.source || 'manual',
          category: txn.category,
          description: txn.notes || txn.description,
          reference_id: txn.reference,
          transaction_date: txn.date || txn.timestamp?.split('T')[0],
        });
        count++;
      } catch (e) {
        console.warn(`[Migration] Skipped malformed line: ${e.message}`);
      }
    }
    console.log(`[Migration] Imported ${count} transactions`);
  }

  // 3. Import credit entries
  const creditFile = path.join(workspacePath, 'credit-log.jsonl');
  if (fs.existsSync(creditFile)) {
    // Similar pattern...
  }

  console.log('[Migration] Legacy import complete');
}
```

---

## File Structure

```
gateway/
├── db/                          # Database layer
│   ├── db.js                    # DhandhaDB class (main interface)
│   ├── schema.sql               # Table definitions
│   ├── migrate.js               # Schema migration runner
│   └── import-legacy.js         # One-time JSONL → SQLite migration
├── sarvam/                      # Shared Sarvam API module
├── voice/                       # Voice pipeline
├── documents/                   # Document processing
├── skills/
├── config/
└── index.js
```

Data file on phone:
```
~/dhandhaphone/
├── dhandhaphone.db              # Single SQLite file (~1-5MB for a year of data)
├── dhandhaphone.db-wal          # Write-ahead log (auto-managed)
├── dhandhaphone.db-shm          # Shared memory (auto-managed)
├── backups/                     # Periodic backups
│   ├── dhandhaphone-2026-02-18.db
│   └── dhandhaphone-2026-02-17.db
└── documents/                   # Original photos/PDFs
```

---

## Backup Strategy

### Automatic Daily Backup
The heartbeat cron (already scheduled) triggers a daily backup:

```javascript
// In HEARTBEAT.md cron:
// Every day at 11 PM — backup database
async function dailyBackup() {
  const today = new Date().toISOString().split('T')[0];
  const backupPath = path.join(BACKUP_DIR, `dhandhaphone-${today}.db`);
  db.backup(backupPath);

  // Keep only last 7 backups
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .sort()
    .reverse();
  for (const old of backups.slice(7)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
  }
}
```

### Manual Backup (owner can trigger)
Owner: "Backup le lo" → triggers immediate backup
Owner: "Data export karo" → exports to CSV (human-readable)

---

## Performance Expectations

### At Scale: 50 transactions/day × 365 days = ~18,250 rows/year

| Operation | Expected Latency |
|---|---|
| Insert transaction | < 1ms |
| Today's summary | < 5ms |
| Monthly breakdown | < 10ms |
| Search contact by name | < 5ms |
| Full year revenue by day | < 20ms |
| Complex 3-table JOIN | < 50ms |
| Full table scan (18K rows) | < 100ms |

SQLite handles this effortlessly. These are toy numbers for SQLite,
which routinely handles millions of rows on phones.

### Storage
- 18K transactions/year ≈ 2-3 MB
- With indexes ≈ 4-5 MB
- WAL overhead ≈ 1-2 MB
- **Total: ~7 MB per year of operation**

For reference, a single WhatsApp photo is 3-5 MB.

---

## Implementation Schedule

### Day 1: Foundation
- [ ] Create `gateway/db/schema.sql` with all tables
- [ ] Create `gateway/db/db.js` with driver auto-detection
- [ ] Test on Mac with `node:sqlite` (Node 22+)
- [ ] Test with `node-sqlite3-wasm` fallback
- [ ] Write unit tests for all CRUD operations

### Day 2: Query Layer
- [ ] Implement all summary/analytics functions
- [ ] Implement `agentQuery()` with safety checks
- [ ] Test common agent queries (daily summary, method breakdown, etc.)
- [ ] Implement dedup logic
- [ ] Write migration runner

### Day 3: Integration
- [ ] Wire db.js into gateway/index.js
- [ ] Update money-tracker skill to use db instead of JSONL
- [ ] Update people-memory skill to use db instead of contacts.json
- [ ] Update daily-intel skill to query db for summaries
- [ ] Update business-brain for inventory/price tracking
- [ ] Add database context to SOUL.md

### Day 4: Migration & Phone Test
- [ ] Write JSONL → SQLite import script
- [ ] Deploy to phone (Termux)
- [ ] Verify `node:sqlite` works in Termux Node version
- [ ] If not, verify `node-sqlite3-wasm` fallback works
- [ ] Run sample 100 transactions through full pipeline
- [ ] Verify backup/restore cycle

### Day 5: Agent Testing
- [ ] Test 20 common owner queries against real data
- [ ] Verify agent-generated SQL is safe and correct
- [ ] Stress test: 1000 rapid inserts
- [ ] Verify WAL mode handles heartbeat reads during writes
- [ ] Measure actual latency on phone hardware

---

## What Changes in Existing Architecture

### Files That Change

| File | Change |
|---|---|
| `gateway/index.js` | Initialize DhandhaDB on startup, pass to skills |
| `config/SOUL.md` | Add database context and query functions |
| `config/HEARTBEAT.md` | Use db queries for summaries, add daily backup |
| `skills/money-tracker/SKILL.md` | All ledger ops → db calls |
| `skills/people-memory/SKILL.md` | All contact ops → db calls |
| `skills/daily-intel/SKILL.md` | Briefing queries → db.getDailySummary() |
| `skills/business-brain/SKILL.md` | Inventory/price ops → db calls |

### Files That Go Away (replaced by DB)

| Old File | Replaced By |
|---|---|
| `workspace/ledger.jsonl` | `transactions` table |
| `workspace/summary.json` | computed from `transactions` table on-demand |
| `workspace/contacts.json` | `contacts` table |
| `workspace/credit-log.jsonl` | `credit_entries` table |
| `workspace/patterns.jsonl` | `skill_patterns` table |
| `workspace/prices/*` | `price_history` table |
| `workspace/inventory/*` | `inventory` + `inventory_movements` tables |

The `workspace/` directory still exists for:
- Generated skills (SKILL.md files)
- Temporary files
- Document photos

---

## Why Not Something More Exotic?

**Why not Turso/LibSQL?** — Requires network. DhandhaPhone is
offline-first. LibSQL's local mode could work but adds complexity
for no benefit over plain SQLite at our scale.

**Why not LevelDB/RocksDB?** — Key-value stores can't do SQL
queries. The agent NEEDS SQL — it's the natural language of
structured data queries, and LLMs are very good at generating it.

**Why not MongoDB/NeDB?** — Document stores are tempting for
"just dump JSON" but terrible for the aggregation queries the
agent needs constantly. "Sum of all UPI payments last week
grouped by counterparty" is one line of SQL, a nightmare in a
document store.

**Why not Deno KV / Bun SQLite?** — We're on Node.js in Termux.
Deno and Bun aren't available in this environment.

**Why not PostgreSQL/MySQL?** — Running a full database server on
an Android phone is insane. SQLite is designed for exactly this:
embedded, single-user, single-file, zero-config.
